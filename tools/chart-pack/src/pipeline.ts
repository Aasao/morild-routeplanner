/**
 * tools/chart-pack — kjernen i polygonalgebra-pipelinen (spec §4 steg 4–7).
 *
 * Rene funksjoner: tar inn allerede parsede rå-features (fra `gml.ts`) og
 * bygger dybdebånd, trekker fra tørrfall/skjær/grunne, legger på farled og
 * datakvalitet, og fliser resultatet. All I/O (henting, filskriving) lever i
 * `build.ts` — denne fila er det testbare laget (§6.1).
 */
import type {
  DepthBand,
  DryFallZone,
  BufferedHazardPoint,
  FarledZone,
  DataQualityZone,
  CatzocClass,
  PackedPolygon,
} from "@morild/charts";
import { tileIdForPoint, tileBounds } from "@morild/charts";
import type { ChartTileId } from "@morild/charts";
import * as turf from "@turf/turf";
import type { BBox } from "geojson";
import {
  bufferPoint,
  difference,
  isValidPolygon,
  ringToPolygonFeature,
  toPackedPolygons,
  unionAll,
  type PolyFeature,
} from "./geometry.js";
import type {
  DybdekurveFeature,
  KystverketLineFeature,
  KystverketPolygonFeature,
  PointFeature,
  PolygonFeature,
} from "./gml.js";

export interface BuildIssue {
  readonly stage: string;
  readonly featureId: string;
  readonly reason: string;
}

export interface BandBuildResult {
  readonly bands: readonly DepthBand[];
  readonly issues: readonly BuildIssue[];
  readonly skippedOpenRings: number;
  readonly skippedInvalidRings: number;
}

/**
 * Bygger nøstede dybdebånd (§3.4) fra rå dybdekurver. KUN lukkede ringer
 * brukes — åpne konturlinjer (som krysser kartbladgrensen) krever
 * sammenstitching på tvers av kartblad, som er utenfor denne bølgens omfang
 * (se README "Avvik fra spec"). Dette telles og rapporteres, aldri stille
 * droppet (N2).
 */
export function buildDepthBands(
  curves: readonly DybdekurveFeature[],
): BandBuildResult {
  const issues: BuildIssue[] = [];
  let skippedOpenRings = 0;
  let skippedInvalidRings = 0;

  const byDepth = new Map<number, PolyFeature[]>();
  for (const curve of curves) {
    if (!curve.ring.closed) {
      skippedOpenRings++;
      continue;
    }
    const feature = ringToPolygonFeature(curve.ring);
    if (!feature) {
      skippedInvalidRings++;
      issues.push({
        stage: "buildDepthBands",
        featureId: curve.id,
        reason: "Kunne ikke bygge polygon fra ring",
      });
      continue;
    }
    if (!isValidPolygon(feature)) {
      skippedInvalidRings++;
      issues.push({
        stage: "buildDepthBands",
        featureId: curve.id,
        reason: "Selvskjærende polygon (turf.kinks)",
      });
      continue;
    }
    const list = byDepth.get(curve.dybdeM) ?? [];
    list.push(feature);
    byDepth.set(curve.dybdeM, list);
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const unions = new Map<number, PolyFeature>();
  for (const depth of depths) {
    const features = byDepth.get(depth);
    if (!features) continue;
    const merged = unionAll(features);
    if (merged) unions.set(depth, merged);
  }

  const bands: DepthBand[] = [];
  let previousDepth = 0;
  let previousUnion: PolyFeature | undefined;
  for (const depth of depths) {
    const currentUnion = unions.get(depth);
    if (!currentUnion) continue;
    const bandGeometry = difference(currentUnion, previousUnion);
    if (bandGeometry) {
      bands.push({
        lowerBoundM: previousDepth,
        upperBoundM: depth,
        polygons: toPackedPolygons(bandGeometry),
      });
    } else {
      issues.push({
        stage: "buildDepthBands",
        featureId: `bånd ${previousDepth}-${depth}`,
        reason:
          "Differansen ga tomt resultat (uventet — nabokurver bør ikke være identiske)",
      });
    }
    previousDepth = depth;
    previousUnion = currentUnion;
  }

  return { bands, issues, skippedOpenRings, skippedInvalidRings };
}

function bboxOverlaps(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/**
 * Trekker en liste med farepolygoner (tørrfall, eller buffrede skjær/grunne)
 * fra alle bånd (§4 steg 4). Returnerer nye bånd — muterer ikke input.
 *
 * Ytelsesmerknad (funn fra turf-vs-geos-spiken, se README.md, to runder):
 * (1) å unionere ALLE farepolygoner i hele datasettet og differansere hvert
 * BÅND (som helhet) mot den ene store unionen tok >2 minutter for
 * testområdet (2308 tørrfallspolygoner) — boolsk differanse mellom to
 * store, komplekse multipolygoner skalerer dårlig i JSTS/turf. (2) Å
 * bbox-filtrere hazard-lista mot BÅNDETS samlede bounding box hjalp lite
 * (~60 s) — det grunneste båndet er selv en multipolygon spredt over hele
 * flisen, så nesten alle farer "overlapper" den ytre boksen uansett.
 * Løsningen som faktisk virker: filtrer PER ENKELTPOLYGON i bandet (hver
 * øy/skjærgård-flekk har sin egen, mye trangere bounding box), differanser
 * kun mot de få farene som faktisk overlapper DEN — bringer kjøretiden ned
 * til under ett sekund for samme datasett (se `pnpm --filter
 * @morild/chart-pack spike`-loggen i README).
 */
export function subtractHazardsFromBands(
  bands: readonly DepthBand[],
  hazardFeatures: readonly PolyFeature[],
): DepthBand[] {
  if (hazardFeatures.length === 0) return [...bands];
  const hazardBboxes = hazardFeatures.map((f) => ({
    feature: f,
    bbox: turf.bbox(f),
  }));

  return bands.map((band) => {
    const resultPolygons: PackedPolygon[] = [];
    for (const packed of band.polygons) {
      const polyFeature = turf.polygon(
        packed.rings.map((ring) => ring.map(([lon, lat]) => [lon, lat])),
      );
      const polyBbox = turf.bbox(polyFeature);
      const relevant = hazardBboxes
        .filter((h) => bboxOverlaps(polyBbox, h.bbox))
        .map((h) => h.feature);
      if (relevant.length === 0) {
        resultPolygons.push(packed);
        continue;
      }
      const localHazardUnion = unionAll(relevant);
      const diffed = localHazardUnion
        ? difference(polyFeature, localHazardUnion)
        : polyFeature;
      if (diffed) resultPolygons.push(...toPackedPolygons(diffed));
    }
    return { ...band, polygons: resultPolygons };
  });
}

export interface DryFallBuildResult {
  readonly zones: readonly DryFallZone[];
  /** Individuelle (ikke-unionerte) polygon-features — brukes for lokal,
   * bbox-filtrert differanse i `subtractHazardsFromBands` (se ytelsesmerknaden der). */
  readonly features: readonly PolyFeature[];
  readonly issues: readonly BuildIssue[];
}

export function buildDryFallZones(
  features: readonly PolygonFeature[],
): DryFallBuildResult {
  const issues: BuildIssue[] = [];
  const polys: PolyFeature[] = [];
  for (const f of features) {
    const rings = f.rings.filter((r) => r.closed);
    if (rings.length !== f.rings.length) {
      issues.push({
        stage: "buildDryFallZones",
        featureId: f.id,
        reason: "En eller flere ringer er ikke lukket",
      });
    }
    if (rings.length === 0) continue;
    const outer = rings[0];
    if (!outer) continue;
    const coordRings = rings.map((r) =>
      r.coords.map(([lon, lat]) => [lon, lat]),
    );
    polys.push(turf.polygon(coordRings));
  }
  const zones: DryFallZone[] = polys.map((p) => ({
    polygon: toPackedPolygons(p)[0] ?? { rings: [] },
  }));
  return { zones, features: polys, issues };
}

export interface HazardBuildResult {
  readonly points: readonly BufferedHazardPoint[];
  readonly features: readonly PolyFeature[];
}

/** §4 steg 4: buffer skjær/grunne-punkter med `bufferRadiusM` (standard 20 m, konfigurerbar). */
export function buildBufferedHazards(
  skjaer: readonly PointFeature[],
  grunne: readonly PointFeature[],
  bufferRadiusM: number,
): HazardBuildResult {
  const points: BufferedHazardPoint[] = [];
  const features: PolyFeature[] = [];
  for (const p of skjaer) {
    const buffered = bufferPoint(p.point[0], p.point[1], bufferRadiusM);
    features.push(buffered);
    const polygon = toPackedPolygons(buffered)[0];
    if (polygon) points.push({ kind: "skjaer", bufferRadiusM, polygon });
  }
  for (const p of grunne) {
    // Merk: Grunne-punkter behandles alltid som no-go når buffret, uansett
    // ev. dybdeattributt (spec §3.4: "presise punkt-/arealfarer, ikke
    // dybdekurve-baserte") — se docs/legal-notat i README om hvorfor dette
    // er en bevisst konservativ tolkning verdt å bekrefte med Magnus.
    const buffered = bufferPoint(p.point[0], p.point[1], bufferRadiusM);
    features.push(buffered);
    const polygon = toPackedPolygons(buffered)[0];
    if (polygon) points.push({ kind: "grunne", bufferRadiusM, polygon });
  }
  return { points, features };
}

export function buildFarledZones(
  lines: readonly KystverketLineFeature[],
  multiPolygons: readonly KystverketPolygonFeature[],
): readonly FarledZone[] {
  const zones: FarledZone[] = [];
  for (const mp of multiPolygons) {
    for (const rings of mp.polygons) {
      const closedRings = rings.filter((r) => r.closed);
      if (closedRings.length === 0) continue;
      const coordRings = closedRings.map((r) =>
        r.coords.map(([lon, lat]) => [lon, lat]),
      );
      const feature = turf.polygon(coordRings);
      const polygon = toPackedPolygons(feature)[0];
      if (polygon)
        zones.push({ navn: `Kystverket farledsareal ${mp.id}`, polygon });
    }
  }
  // Hovedled-senterlinjene (layer_552) er linjer, ikke arealer — de brukes i
  // denne bølgen kun som kontekst (ikke som eget tillitsløft-polygon), se
  // README "Avvik fra spec": ekte tillitsløft kommer fra `Farledsareal`
  // (layer_554), som faktisk er polygondata.
  void lines;
  return zones;
}

export function buildDataQualityZones(
  features: readonly PolygonFeature[],
): DataQualityZone[] {
  const zones: DataQualityZone[] = [];
  for (const f of features) {
    if (!f.catzoc) continue;
    const rings = f.rings.filter((r) => r.closed);
    if (rings.length === 0) continue;
    const coordRings = rings.map((r) =>
      r.coords.map(([lon, lat]) => [lon, lat]),
    );
    const feature = turf.polygon(coordRings);
    const polygon = toPackedPolygons(feature)[0];
    if (polygon) zones.push({ catzoc: f.catzoc as CatzocClass, polygon });
  }
  return zones;
}

function touchedTiles(
  polygons: readonly PackedPolygon[],
  grid: { readonly lonStepDeg: number; readonly latStepDeg: number },
): ChartTileId[] {
  const seen = new Map<string, ChartTileId>();
  for (const p of polygons) {
    for (const ring of p.rings) {
      for (const [lon, lat] of ring) {
        const id = tileIdForPoint(lat, lon, grid);
        seen.set(`${id.latIndex}_${id.lonIndex}`, id);
      }
    }
  }
  return [...seen.values()];
}

/** Klipper en `PackedPolygon` til en flis' grense (§4 steg 6). `undefined` hvis ingenting gjenstår. */
export function clipPolygonToTile(
  polygon: PackedPolygon,
  bounds: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  },
): PackedPolygon | undefined {
  const feature = turf.polygon(
    polygon.rings.map((ring) => ring.map(([lon, lat]) => [lon, lat])),
  );
  const clipped = turf.bboxClip(feature, [
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north,
  ]);
  if (clipped.geometry.coordinates.length === 0) return undefined;
  const packed = toPackedPolygons(clipped as PolyFeature)[0];
  return packed && packed.rings.length > 0 ? packed : undefined;
}

/**
 * Klipper alle lag til flisrutenettet (§3.1). En flis som ikke berøres av
 * noe lag i det hele tatt utelates fra manifestet (den finnes rett og slett
 * ikke i denne testpakken, jf. §5s skille mellom "ikke i pipelinen" og
 * "ikke synket lokalt").
 */
export function buildTilePayloads(
  bands: readonly DepthBand[],
  dryFall: readonly DryFallZone[],
  bufferedHazards: readonly BufferedHazardPoint[],
  farled: readonly FarledZone[],
  dataQuality: readonly DataQualityZone[],
  grid: { readonly lonStepDeg: number; readonly latStepDeg: number },
): {
  id: ChartTileId;
  bands: DepthBand[];
  dryFall: DryFallZone[];
  bufferedHazards: BufferedHazardPoint[];
  farled: FarledZone[];
  dataQuality: DataQualityZone[];
}[] {
  const allTiles = new Map<string, ChartTileId>();
  const noteAll = (polys: readonly PackedPolygon[]) => {
    for (const id of touchedTiles(polys, grid))
      allTiles.set(`${id.latIndex}_${id.lonIndex}`, id);
  };
  noteAll(bands.flatMap((b) => b.polygons));
  noteAll(dryFall.map((z) => z.polygon));
  noteAll(bufferedHazards.map((h) => h.polygon));
  noteAll(farled.map((f) => f.polygon));
  noteAll(dataQuality.map((d) => d.polygon));

  const result: {
    id: ChartTileId;
    bands: DepthBand[];
    dryFall: DryFallZone[];
    bufferedHazards: BufferedHazardPoint[];
    farled: FarledZone[];
    dataQuality: DataQualityZone[];
  }[] = [];
  for (const id of allTiles.values()) {
    const bounds = tileBounds(id, grid);
    const clippedBands: DepthBand[] = bands
      .map((b) => ({
        ...b,
        polygons: b.polygons
          .map((p) => clipPolygonToTile(p, bounds))
          .filter((p): p is PackedPolygon => !!p),
      }))
      .filter((b) => b.polygons.length > 0);
    const clippedDryFall = dryFall
      .map((z) => clipPolygonToTile(z.polygon, bounds))
      .filter((p): p is PackedPolygon => !!p)
      .map((polygon) => ({ polygon }));
    const clippedHazards = bufferedHazards.flatMap((h) => {
      const p = clipPolygonToTile(h.polygon, bounds);
      return p ? [{ ...h, polygon: p }] : [];
    });
    const clippedFarled = farled.flatMap((f) => {
      const p = clipPolygonToTile(f.polygon, bounds);
      return p ? [{ ...f, polygon: p }] : [];
    });
    const clippedQuality = dataQuality.flatMap((d) => {
      const p = clipPolygonToTile(d.polygon, bounds);
      return p ? [{ ...d, polygon: p }] : [];
    });
    result.push({
      id,
      bands: clippedBands,
      dryFall: clippedDryFall,
      bufferedHazards: clippedHazards,
      farled: clippedFarled,
      dataQuality: clippedQuality,
    });
  }
  return result;
}

export { tileBounds };
