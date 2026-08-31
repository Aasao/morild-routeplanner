/**
 * packages/charts — rene punkt-/polygonprimitiver for oppslag (F1.0: "ingen
 * geometriberegning på klienten utover polygon-/punkttester" — dette ER de
 * tillatte punkttestene, ikke boolsk polygonalgebra).
 *
 * Bevisst uten `@turf/turf`-avhengighet: turf brukes i byggetid
 * (`tools/chart-pack`) for union/differanse/buffer, men klienten trenger
 * kun ray-casting punkt-i-polygon og punkt-til-linje-avstand — å dra inn
 * hele turf-bunten i klientbundlet for det ville vært unødvendig vekt i en
 * PWA (N6).
 */
import type { LatLon } from "@morild/geo";
import { bearing, haversineNm } from "@morild/geo";
import type { PackedPolygon, Ring } from "./pack-format.js";

/** Ray-casting punkt-i-ring — standard even-odd-algoritme på `[lon, lat]`-par. */
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Punkt-i-polygon med hull: ytre ring (index 0) må inneholde punktet, og
 * punktet må IKKE ligge i noen av hullene (index 1..n).
 */
export function pointInPolygon(point: LatLon, polygon: PackedPolygon): boolean {
  const [outer, ...holes] = polygon.rings;
  if (!outer || !pointInRing(point.lon, point.lat, outer)) return false;
  for (const hole of holes) {
    if (pointInRing(point.lon, point.lat, hole)) return false;
  }
  return true;
}

export function pointInAnyPolygon(
  point: LatLon,
  polygons: readonly PackedPolygon[],
): boolean {
  return polygons.some((p) => pointInPolygon(point, p));
}

/** Korteste avstand (nm) fra punkt til et linjesegment, flat approksimasjon. */
function distanceToSegmentNm(point: LatLon, a: LatLon, b: LatLon): number {
  // Enkel projeksjon i grader (gyldig for korte segmenter/skjærgårdsskala,
  // samme presisjonsnivå som packages/geo sin stepLatLon-approksimasjon).
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const ax = a.lon * cosLat;
  const ay = a.lat;
  const bx = b.lon * cosLat;
  const by = b.lat;
  const px = point.lon * cosLat;
  const py = point.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nearest: LatLon = { lat: ay + t * dy, lon: (ax + t * dx) / cosLat };
  return haversineNm(point, nearest);
}

/** Korteste avstand (nm) fra punkt til ringens kant (ikke til interiøret). */
export function distanceToRingNm(point: LatLon, ring: Ring): number {
  let min = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (!a || !b) continue;
    const d = distanceToSegmentNm(point, { lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
    if (d < min) min = d;
  }
  return min;
}

export function distanceToPolygonNm(point: LatLon, polygon: PackedPolygon): number {
  let min = Infinity;
  for (const ring of polygon.rings) {
    const d = distanceToRingNm(point, ring);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Nærmeste punkt på ringens kant, med avstand (nm) og initial peiling
 * (grader) fra `point` til det punktet — brukt av `nermesteFareAvstandNm`.
 */
export function nearestRingPoint(
  point: LatLon,
  ring: Ring,
): { readonly avstandNm: number; readonly retningGrader: number } | null {
  let min = Infinity;
  let nearest: LatLon | undefined;
  for (const c of ring) {
    if (!c) continue;
    const candidate: LatLon = { lon: c[0], lat: c[1] };
    const d = haversineNm(point, candidate);
    if (d < min) {
      min = d;
      nearest = candidate;
    }
  }
  if (!nearest) return null;
  return { avstandNm: min, retningGrader: bearing(point, nearest) };
}
