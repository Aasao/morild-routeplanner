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

/**
 * Segment-mot-segment-kryssingstest (§6.4 eksakt geometritest, R1-fiks,
 * code-review 2026-08-31 — erstatter tidligere 20-punkts sampling i
 * `segmentTest()`). Standard orientering-basert kryssingstest, inkl.
 * kolineær overlapp.
 *
 * Presisjonsmerknad: testen kjøres direkte på rå `[lon, lat]`-grader (samme
 * flat-jord-tilnærming som `pointInRing` over) — den er en topologisk
 * kryssingstest, ikke en avstandsberegning, så den er upåvirket av at
 * lon/lat-planet ikke er en isometrisk projeksjon: en uniform (men
 * anisotropisk) akseskalering endrer aldri OM to segmenter krysser
 * hverandre, kun formen på figuren.
 */
function orientation(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(
  a: readonly [number, number],
  b: readonly [number, number],
  p: readonly [number, number],
): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

export function segmentsIntersect(
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  p4: readonly [number, number],
): boolean {
  const d1 = orientation(p3, p4, p1);
  const d2 = orientation(p3, p4, p2);
  const d3 = orientation(p1, p2, p3);
  const d4 = orientation(p1, p2, p4);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

function segmentIntersectsRing(a: LatLon, b: LatLon, ring: Ring): boolean {
  const p1: [number, number] = [a.lon, a.lat];
  const p2: [number, number] = [b.lon, b.lat];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ri = ring[i];
    const rj = ring[j];
    if (!ri || !rj) continue;
    if (segmentsIntersect(p1, p2, ri, rj)) return true;
  }
  return false;
}

/**
 * Krysser korden (a→b) polygonets fylte areal (ytre ring minus hull) i det
 * hele tatt — dvs. berører den faren polygonet representerer NOE sted langs
 * korden, ikke bare i endepunktene? Dette er den eksakte erstatningen for
 * punktsampling langs et segment (§6.4, R1).
 *
 * Presisjonsbegrensning (dokumentert, ikke skjult): for polygoner MED hull
 * behandles «korden krysser en hull-kant» som «korden treffer polygonet»
 * (fordi det betyr korden går inn i eller ut av hullet, og det andre siden
 * av den krysningen ligger i det fylte arealet så lenge hull-kanten ikke
 * også sammenfaller med ytre ring i akkurat det punktet). Denne degenererte
 * topologien (hull som tangerer ytterkanten) forekommer ikke i
 * kildedataene her — dybdebånd-hull oppstår ved polygon-differanse mot
 * separate farepolygoner et stykke inne i bandet, ikke ved kant-tangering.
 */
export function segmentIntersectsPolygon(
  a: LatLon,
  b: LatLon,
  polygon: PackedPolygon,
): boolean {
  const [outer, ...holes] = polygon.rings;
  if (!outer) return false;
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return true;
  if (segmentIntersectsRing(a, b, outer)) return true;
  for (const hole of holes) {
    if (segmentIntersectsRing(a, b, hole)) return true;
  }
  return false;
}

export function segmentIntersectsAnyPolygon(
  a: LatLon,
  b: LatLon,
  polygons: readonly PackedPolygon[],
): boolean {
  return polygons.some((p) => segmentIntersectsPolygon(a, b, p));
}

/**
 * Ligger HELE korden (a→b) innenfor unionen av `polygons`? Brukt for
 * §3.4 steg 4-tillitsløftet (farled/god datakvalitet) — strengere enn
 * `segmentIntersectsAnyPolygon` fordi et segment kun er `trygt` i hele sin
 * lengde, ikke bare delvis.
 *
 * Konservativ tilnærming for UNIONER av flere overlappende polygoner:
 * funksjonen krever i tillegg at korden ikke krysser NOEN ringkant i settet
 * — korrekt for ett enkelt polygon (uten selvskjæring), men kan gi et falskt
 * "usikkert" (aldri et falskt "trygt") for en kord som glir fra ett polygon
 * til et overlappende naboareal i unionen akkurat der de to kantene møtes.
 * Det er den trygge retningen å bomme i (føre-var, F1.3) — se §2.
 */
export function segmentEntirelyWithinAnyPolygon(
  a: LatLon,
  b: LatLon,
  polygons: readonly PackedPolygon[],
): boolean {
  if (!pointInAnyPolygon(a, polygons) || !pointInAnyPolygon(b, polygons)) {
    return false;
  }
  for (const p of polygons) {
    for (const ring of p.rings) {
      if (segmentIntersectsRing(a, b, ring)) return false;
    }
  }
  return true;
}

/**
 * Nærmeste punkt på et linjesegment, flat gradeprojeksjon (samme
 * presisjonsnivå som `packages/geo`s `stepLatLon`-approksimasjon — gyldig
 * for korte segmenter/skjærgårdsskala). Delt hjelper for `distanceToSegmentNm`
 * og `nearestPolygonPoint` slik at begge er garantert konsistente (samme
 * projeksjon, samme nærmeste-punkt-logikk).
 */
function nearestPointOnSegment(point: LatLon, a: LatLon, b: LatLon): LatLon {
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
  return { lat: ay + t * dy, lon: (ax + t * dx) / cosLat };
}

/** Korteste avstand (nm) fra punkt til et linjesegment, flat approksimasjon. */
export function distanceToSegmentNm(point: LatLon, a: LatLon, b: LatLon): number {
  return haversineNm(point, nearestPointOnSegment(point, a, b));
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
 * Nærmeste punkt PÅ POLYGONETS KANT — edge-basert, ikke bare hjørner
 * (konservativitets-fiks, beslutning 2026-08-31, se
 * `docs/specs/farbarhetsmaske.md` "Konservativitets-garanti"). Brukt av
 * `nermesteFareAvstandNm` for lag der polygonet ER den sanne
 * faregeometrien (tørrfall, dybdebånd) — IKKE for punkt+radius-farer
 * (skjær/grunne), der senterpunkt+radius er den sanne geometrien og
 * `polygon` kun er en innskrevet tilnærming (§4.1); for de lagene skal
 * kalleren bruke eksakt sirkelavstand i stedet (samme mønster som
 * `pointWithinHazardBuffer`/`distanceToSegmentNm`-bruken i `segmentTest`).
 *
 * **Erstatter den tidligere `nearestRingPoint`**, som kun sammenlignet mot
 * ringens HJØRNER. Hjørner er en delmengde av kantens punkter, så et
 * vertex-only minimum kan rapportere en STØRRE avstand enn den faktiske
 * korteste avstanden til kanten (f.eks. et punkt rett utenfor midten av en
 * lang kant, langt fra begge hjørnene) — det er OVERESTIMERING av avstand
 * til fare, et kontraktsbrudd for `nermesteFareAvstandNm` (spec-en krever at
 * denne funksjonen ALDRI overestimerer).
 */
export function nearestPolygonPoint(
  point: LatLon,
  polygon: PackedPolygon,
): { readonly avstandNm: number; readonly retningGrader: number } | null {
  let min = Infinity;
  let nearest: LatLon | undefined;
  for (const ring of polygon.rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!a || !b) continue;
      const candidate = nearestPointOnSegment(
        point,
        { lon: a[0], lat: a[1] },
        { lon: b[0], lat: b[1] },
      );
      const d = haversineNm(point, candidate);
      if (d < min) {
        min = d;
        nearest = candidate;
      }
    }
  }
  if (!nearest) return null;
  return { avstandNm: min, retningGrader: bearing(point, nearest) };
}
