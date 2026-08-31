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
import { tileBounds } from "@morild/charts";
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

/**
 * §4 steg 4: buffer skjær/grunne-punkter med `bufferRadiusM` (standard 20 m,
 * konfigurerbar).
 *
 * **VALSOU-modellen (E4, beslutning 2026-08-31):** Grunne-punktets
 * `dybde`-attributt bæres nå gjennom til pakkeformatet
 * (`BufferedHazardPoint.dybdeM`) i stedet for å bli forkastet. Selve
 * no-go-avgjørelsen for Grunne flyttes til oppslagstidspunktet i
 * `packages/charts` (§3.4) — her bygges kun geometrien + det rå tallet.
 * Skjær har ALDRI dybdeattributt i kildedataene (578 av 578 uten
 * `app:dybde` i fase 1-bølge 2-fixturen) og forblir alltid no-go, se
 * `chart-source.ts`.
 */
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
    if (polygon)
      points.push({
        kind: "skjaer",
        bufferRadiusM,
        polygon,
        centerLon: p.point[0],
        centerLat: p.point[1],
      });
  }
  for (const p of grunne) {
    const buffered = bufferPoint(p.point[0], p.point[1], bufferRadiusM);
    features.push(buffered);
    const polygon = toPackedPolygons(buffered)[0];
    if (polygon)
      points.push({
        kind: "grunne",
        bufferRadiusM,
        polygon,
        centerLon: p.point[0],
        centerLat: p.point[1],
        ...(p.dybdeM !== undefined ? { dybdeM: p.dybdeM } : {}),
      });
  }
  return { points, features };
}

export interface SoundingBandViolation {
  readonly featureId: string;
  readonly soundedDepthM: number;
  readonly bandLowerBoundM: number;
  readonly bandUpperBoundM: number;
  readonly point: readonly [number, number]; // [lon, lat]
}

export interface SoundingQaResult {
  readonly violations: readonly SoundingBandViolation[];
  /** Antall soundinger som faktisk hadde et dybdeattributt og ble sjekket. */
  readonly checkedCount: number;
}

/**
 * QA-validator (byggetids-steg, beslutning 2026-08-31, marinkartolog-
 * vurderingens felle 2): et bånd `(lowerBoundM, upperBoundM)` er konstruert
 * for å bety "dette arealet er dypere enn `lowerBoundM`". En dybdepunkt-
 * sondering med kjent dybde som havner GEOMETRISK innenfor et bånd, men
 * viser en dybde grunnere enn båndets nedre grense, avslører enten en
 * feilkonstruert kurve (selvskjæring, sammenblanding med en
 * depresjonskurve — "kurven omslutter alt grunnere" er IKKE alltid sant for
 * S-57-data) eller en reell topologifeil i kildedataene. Brudd
 * rapporteres/flagges her — ALDRI stille slukt (N2) — men stopper ikke
 * bygget alene: en enkelt avvikende sondering skal ikke blokkere en hel
 * nattlig kjøring (samme filosofi som `BuildIssue[]` i `buildDepthBands`).
 * Kalleren (`build.ts`) setter pakkens `sourceStatus` til `"degraded"` med
 * antall brudd hvis denne rapporten er ikke-tom, slik at bruddet er synlig
 * i pakkemetadata i stedet for i en byggefeil-logg ingen leser.
 *
 * **Datagrunnlag i denne bølgen:** kildeuttrekket har ingen egen
 * `Dybdepunkt`-lag (generelle enkeltsonderinger) — validatoren kjøres derfor
 * mot `Grunne`-punktene (som har `app:dybde` og er reelle, navngitte
 * dybdemålinger) som tilgjengelig ground-truth-proxy. Et ekte
 * `Dybdepunkt`-lag bør legges til i en senere bølge for full dekning
 * (ærlig degradering: proxy-dekningen er dokumentert, ikke skjult).
 */
export function validateSoundingsAgainstBands(
  bands: readonly DepthBand[],
  soundings: readonly PointFeature[],
): SoundingQaResult {
  const violations: SoundingBandViolation[] = [];
  let checkedCount = 0;
  for (const sounding of soundings) {
    if (sounding.dybdeM === undefined) continue;
    checkedCount++;
    for (const band of bands) {
      const hit = band.polygons.some((poly) => {
        const feature = turf.polygon(
          poly.rings.map((ring) => ring.map(([lon, lat]) => [lon, lat])),
        );
        return turf.booleanPointInPolygon(
          turf.point([sounding.point[0], sounding.point[1]]),
          feature,
        );
      });
      if (hit && sounding.dybdeM < band.lowerBoundM) {
        violations.push({
          featureId: sounding.id,
          soundedDepthM: sounding.dybdeM,
          bandLowerBoundM: band.lowerBoundM,
          bandUpperBoundM: band.upperBoundM,
          point: sounding.point,
        });
      }
    }
  }
  return { violations, checkedCount };
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

/** Bounding box (`[west, south, east, north]`) over ALLE ringer i et polygon. */
function polygonBBox(polygon: PackedPolygon): BBox | undefined {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of polygon.rings) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return Number.isFinite(west) ? [west, south, east, north] : undefined;
}

/**
 * Fliser et polygon KAN berøre — R2-fiks (code-review 2026-08-31): den
 * forrige implementasjonen samlet kun flisen for hvert ring-HJØRNE, så et
 * polygon som dekker en mellomflis fullstendig UTEN å ha noe hjørne inni den
 * (f.eks. en smal, langstrakt polygon som strekker seg over tre fliser på
 * rad) falt stille ut av den mellomste flisen — ingen feilmelding, bare et
 * hull i dekningen.
 *
 * Fiksen bruker i stedet polygonets bounding box mot flis-rutenettets
 * indekser: alle fliser hvis grenser overlapper bboksen tas med. Dette er en
 * bevisst OVER-approksimasjon (en L-formet polygon sin bbox kan dekke et
 * hjørne polygonet aldri faktisk berører) — trygt her fordi den påfølgende
 * `clipPolygonToTile` uansett fjerner alt som ikke faktisk overlapper
 * flisen (se `buildTilePayloads`, som filtrerer bort fliser der ALLE lag ble
 * tomme etter klipping). Over-inkludering koster kun litt ekstra klipping,
 * aldri en stille tapt geometri — motsatt av hjørne-tilnærmingen.
 */
function touchedTiles(
  polygons: readonly PackedPolygon[],
  grid: { readonly lonStepDeg: number; readonly latStepDeg: number },
): ChartTileId[] {
  const seen = new Map<string, ChartTileId>();
  for (const p of polygons) {
    const bbox = polygonBBox(p);
    if (!bbox) continue;
    const [west, south, east, north] = bbox;
    const lonMin = Math.floor(west / grid.lonStepDeg);
    const lonMax = Math.floor(east / grid.lonStepDeg);
    const latMin = Math.floor(south / grid.latStepDeg);
    const latMax = Math.floor(north / grid.latStepDeg);
    for (let latIndex = latMin; latIndex <= latMax; latIndex++) {
      for (let lonIndex = lonMin; lonIndex <= lonMax; lonIndex++) {
        seen.set(`${latIndex}_${lonIndex}`, { lonIndex, latIndex });
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
    // R2-fiks: `touchedTiles` er nå bbox-basert (bevisst over-approksimasjon,
    // se kommentaren der) — en flis kan derfor havne i `allTiles` uten at
    // NOE lag faktisk overlapper den etter eksakt klipping. Slike tomme
    // fliser filtreres bort her, slik at manifest-kontrakten over («en flis
    // som ikke berøres av noe lag utelates») fortsatt holder.
    if (
      clippedBands.length === 0 &&
      clippedDryFall.length === 0 &&
      clippedHazards.length === 0 &&
      clippedFarled.length === 0 &&
      clippedQuality.length === 0
    ) {
      continue;
    }
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
