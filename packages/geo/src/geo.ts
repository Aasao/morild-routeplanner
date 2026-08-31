/**
 * packages/geo — ren geometri- og navigasjonsmatematikk. Ingen I/O, ingen
 * avhengighet til andre pakker (håndhevet av tools/arch-tests).
 *
 * Portert fra v1 (C:\RoutePlanner, SKRIVEBESKYTTET fasit):
 *  - haversineNm, bearing, stepLatLon, angDiff:
 *    morild_weather_router.html, linje 282–291.
 *  - norm360, norm180:
 *    morild_bridge.js, linje 20–22.
 *
 * Formlene er bevisst uendret fra v1 (samme konstant, samme flate
 * approksimasjon for stepLatLon) — kun navngitt og typet for TypeScript
 * strict-modus. Se docs/00-kravspek.md F3.1 (isokron-porten arver v1s
 * geometri) og docs/01-prosjektplan.md fase 2.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Jordradius i nautiske mil — samme konstant som v1 (RNM). */
const EARTH_RADIUS_NM = 3440.065;

const degToRad = (deg: number): number => (deg * Math.PI) / 180;
const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Storsirkelavstand mellom to punkt, i nautiske mil (haversine).
 * v1: `haversineNm(a,b)`.
 */
export function haversineNm(a: LatLon, b: LatLon): number {
  const dLat = degToRad(b.lat - a.lat);
  const dLon = degToRad(b.lon - a.lon);
  const la1 = degToRad(a.lat);
  const la2 = degToRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial storsirkelpeiling fra a til b, i grader [0, 360).
 * v1: `bearing(a,b)`.
 */
export function bearing(a: LatLon, b: LatLon): number {
  const la1 = degToRad(a.lat);
  const la2 = degToRad(b.lat);
  const dLon = degToRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (radToDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Punkt `distanceNm` nautiske mil unna (lat, lon), i retning `heading`
 * grader — flat (ikke-storsirkel) approksimasjon, gyldig for korte
 * isokron-steg. v1: `stepLatLon(lat,lon,h,d)`.
 */
export function stepLatLon(
  lat: number,
  lon: number,
  heading: number,
  distanceNm: number,
): LatLon {
  const dLat = (distanceNm * Math.cos(degToRad(heading))) / 60;
  const dLon =
    (distanceNm * Math.sin(degToRad(heading))) / (60 * Math.cos(degToRad(lat)));
  return { lat: lat + dLat, lon: lon + dLon };
}

/**
 * Minste absolutte vinkeldifferanse mellom to peilinger/retninger, i
 * grader [0, 180]. v1: `angDiff(a,b)`.
 */
export function angDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Tverravvik (cross-track) fra storsirkelen a→b til punktet p, i nautiske
 * mil. Positivt = p ligger til styrbord for kursen a→b, negativt = babord.
 *
 * Brukes av golden-harnessen (korridorsammenligning, spec §8.2) og av
 * egenskapstesten «rett linje på åpent hav ≈ storsirkel». Ny i v2 — v1
 * hadde ingen XTE-funksjon.
 */
export function crossTrackNm(a: LatLon, b: LatLon, p: LatLon): number {
  const d13 = haversineNm(a, p) / EARTH_RADIUS_NM;
  if (d13 === 0) return 0;
  const brg13 = degToRad(bearing(a, p));
  const brg12 = degToRad(bearing(a, b));
  return Math.asin(Math.sin(d13) * Math.sin(brg13 - brg12)) * EARTH_RADIUS_NM;
}

/**
 * Langs-sporet-avstand fra a mot b for punktet p, i nautiske mil.
 * Negativ verdi = p ligger bak a; verdi > |ab| = p ligger forbi b.
 */
export function alongTrackNm(a: LatLon, b: LatLon, p: LatLon): number {
  const d13 = haversineNm(a, p) / EARTH_RADIUS_NM;
  if (d13 === 0) return 0;
  const xt = crossTrackNm(a, b, p) / EARTH_RADIUS_NM;
  const cosRatio = Math.cos(d13) / Math.cos(xt);
  const sign =
    Math.abs(angDiff(bearing(a, p), bearing(a, b))) > 90 ? -1 : 1;
  return sign * Math.acos(Math.max(-1, Math.min(1, cosRatio))) * EARTH_RADIUS_NM;
}

/** Normaliser vinkel til [0, 360). v1 (morild_bridge.js): `norm360(a)`. */
export function norm360(a: number): number {
  return ((a % 360) + 360) % 360;
}

/**
 * Normaliser vinkel til (-180, 180]. v1 (morild_bridge.js): `norm180(a)`.
 * Merk: 180 forblir 180 (ikke -180) — bevisst identisk med v1s semantikk.
 */
export function norm180(a: number): number {
  const n = norm360(a);
  return n > 180 ? n - 360 : n;
}
