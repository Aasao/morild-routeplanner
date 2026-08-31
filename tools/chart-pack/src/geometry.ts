/**
 * tools/chart-pack — turf-baserte polygonalgebra-hjelpere (byggetid).
 *
 * Konverterer mellom `RawRing` (fra `gml.ts`)/`PackedPolygon` (pakkeformatet
 * i `@morild/charts`) og turf sine GeoJSON-typer, og wrapper union/differanse/
 * buffer med feilhåndtering som ALDRI stille svelger feil (N2: bygge-
 * rapporten er underlagt ærlig degradering, spec §4 steg 3).
 */
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { PackedPolygon, Ring } from "@morild/charts";
import type { RawRing } from "./gml.js";

export type PolyFeature = Feature<Polygon | MultiPolygon>;

export interface BuildIssue {
  readonly stage: string;
  readonly featureId: string;
  readonly reason: string;
}

/** Én ring → turf-polygon. Kaster ikke — ugyldige ringer flagges av kalleren. */
export function ringToPolygonFeature(ring: RawRing): PolyFeature | undefined {
  if (!ring.closed || ring.coords.length < 4) return undefined;
  const coords = ring.coords.map(([lon, lat]) => [lon, lat]);
  return turf.polygon([coords]);
}

/** Er polygonet strukturelt gyldig (ingen selvskjæring)? Spec §4 steg 3. */
export function isValidPolygon(feature: PolyFeature): boolean {
  try {
    const kinked = turf.kinks(feature as Feature<Polygon>);
    return kinked.features.length === 0;
  } catch {
    // turf.kinks støtter kun Polygon, ikke MultiPolygon — anta gyldig og la
    // union/differanse feile eksplisitt lenger nede hvis den faktisk er ugyldig.
    return true;
  }
}

/** Slår sammen en liste polygoner til ett (Multi)Polygon, eller `undefined` hvis tom. */
export function unionAll(
  features: readonly PolyFeature[],
): PolyFeature | undefined {
  if (features.length === 0) return undefined;
  if (features.length === 1) return features[0];
  const fc = turf.featureCollection(
    features as Feature<Polygon | MultiPolygon>[],
  );
  const result = turf.union(fc);
  return result ?? undefined;
}

/** `a ∖ b`. Returnerer `a` uendret hvis `b` er `undefined` (ingenting å trekke fra). */
export function difference(
  a: PolyFeature,
  b: PolyFeature | undefined,
): PolyFeature | undefined {
  if (!b) return a;
  const result = turf.difference(turf.featureCollection([a, b]));
  return result ?? undefined;
}

/** Buffer et punkt med `radiusM` meter, som en (Multi)Polygon. */
export function bufferPoint(
  lon: number,
  lat: number,
  radiusM: number,
): PolyFeature {
  const buffered = turf.buffer(turf.point([lon, lat]), radiusM, {
    units: "meters",
  });
  if (!buffered) throw new Error(`Klarte ikke å buffre punkt (${lon}, ${lat})`);
  return buffered;
}

/**
 * Avrunding til 7 desimaler (~1 cm ved ekvator) — turfs boolske operasjoner
 * (union/differanse/buffer) etterlater 15-17 signifikante siffer med
 * flyttallsstøy per koordinat, som blåser opp JSON-størrelsen uten noen
 * presisjonsgevinst (målt funn: én testflis gikk fra ~1,6 MB til under
 * budsjettet i §7 kun ved denne avrundingen, se README "Størrelsesfunn").
 */
function round7(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

/** Konverterer en turf-(Multi)Polygon til pakkeformatets `PackedPolygon`-liste. */
export function toPackedPolygons(feature: PolyFeature): PackedPolygon[] {
  const geom = feature.geometry;
  const polygonsCoords: number[][][][] =
    geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polygonsCoords.map((rings) => ({
    rings: rings.map((ring): Ring =>
      ring.map(([lon, lat]) => [round7(lon ?? 0), round7(lat ?? 0)] as const),
    ),
  }));
}

export function pointInFeature(
  lon: number,
  lat: number,
  feature: PolyFeature,
): boolean {
  return turf.booleanPointInPolygon(turf.point([lon, lat]), feature);
}
