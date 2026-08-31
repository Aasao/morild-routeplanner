/**
 * Korridor-begrensning (**målevariant B**, E1′ §1.4).
 *
 * En tynn dekoratør rundt farbarhetsmasken som i tillegg stenger alt som
 * ligger mer enn `tubeNm` fra en gitt rute — «røret». Variant B evaluerer
 * kandidatruten inne i røret og, når evalueringen feiler hardt, søker på nytt
 * inne i et rør rundt rømningslinjen. Det er nettopp den avgrensningen som
 * gjør varianten billigere enn et fritt søk, og som målingen skal avgjøre om
 * er god nok.
 *
 * **Dette er ikke produksjonskode.** Motoren i produksjon kjenner ingen
 * korridor; dekoratøren lever bak en egen inngang og brukes kun av målingen og
 * dens tester (`docs/research/maaleplan-e1-2026-08-31.md`).
 *
 * Semantikken er den samme som for enhver annen maske:
 *  - `pointVerdict` utenfor røret er **hard** avvisning (`no-go`);
 *  - `clearanceNm` returnerer avstanden til det nærmeste av *rørveggen* og
 *    underliggende fare — altså aldri en overestimering, som er forutsetningen
 *    R3-gaten hviler på (`clearance.ts`);
 *  - alt annet delegeres til den underliggende masken.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 */
import type { LatLon } from "@morild/geo";
import type {
  ChartSourceRef,
  NavigabilityMask,
  SegmentVerdict,
  TssVerdict,
} from "./contracts.js";

/**
 * Antall prøvepunkter på en korde når Lipschitz-argumentet ikke rekker.
 *
 * Rørveggen er ingen sikkerhetsgrense — den er en **målebegrensning** — så her
 * er sampling akseptabelt der `clearance.ts` krever sertifisering. Grensen mot
 * den ekte farbarheten er fortsatt eksakt: den kommer fra den underliggende
 * masken, som testes uendret.
 */
const CHORD_SAMPLES = 16;

/** Avstand fra punkt til linjestykke i nm, flat projeksjon om `lat0`. */
function pointToSegmentNm(
  p: LatLon,
  a: LatLon,
  b: LatLon,
  lat0: number,
): number {
  const k = Math.cos((lat0 * Math.PI) / 180) * 60;
  const px = p.lon * k;
  const py = p.lat * 60;
  const ax = a.lon * k;
  const ay = a.lat * 60;
  const bx = b.lon * k;
  const by = b.lat * 60;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Korteste avstand fra `p` til rutens polylinje, i nm. */
export function distanceToRouteNm(
  route: readonly LatLon[],
  p: LatLon,
): number {
  const first = route[0];
  if (first === undefined) return Number.POSITIVE_INFINITY;
  const lat0 = first.lat;
  if (route.length === 1) return pointToSegmentNm(p, first, first, lat0);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < route.length; i++) {
    const d = pointToSegmentNm(p, route[i - 1]!, route[i]!, lat0);
    if (d < best) best = d;
  }
  return best;
}

const OUTSIDE: SegmentVerdict = Object.freeze({
  passable: false,
  tillit: "no-go",
  reason: "utenfor målekorridoren",
});

const INSIDE: SegmentVerdict = Object.freeze({
  passable: true,
  tillit: "trygt",
});

export interface CorridorMaskOptions {
  /** Ruten røret legges rundt. Minst ett punkt. */
  readonly route: readonly LatLon[];
  /** Rørets halvbredde i nm (måleplanen: 3–5). */
  readonly tubeNm: number;
  /** Masken røret legges oppå. `undefined` ⇒ bare røret begrenser. */
  readonly mask?: NavigabilityMask | undefined;
}

export function corridorMask(o: CorridorMaskOptions): NavigabilityMask {
  const { route, tubeNm, mask } = o;

  const outside = (p: LatLon): boolean => distanceToRouteNm(route, p) > tubeNm;

  /** Forlater korden røret noe sted? Konservativ: usikkerhet ⇒ «ja». */
  const chordLeavesTube = (a: LatLon, b: LatLon): boolean => {
    const dA = distanceToRouteNm(route, a);
    const dB = distanceToRouteNm(route, b);
    if (dA > tubeNm || dB > tubeNm) return true;
    for (let i = 1; i < CHORD_SAMPLES; i++) {
      const t = i / CHORD_SAMPLES;
      const p = {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
      };
      if (distanceToRouteNm(route, p) > tubeNm) return true;
    }
    return false;
  };

  const sources: readonly ChartSourceRef[] = mask?.sources ?? [
    { name: "MÅLEKORRIDOR", datum: "WGS84" },
  ];

  return {
    pointVerdict(lat, lon) {
      if (outside({ lat, lon })) return OUTSIDE;
      return mask === undefined ? INSIDE : mask.pointVerdict(lat, lon);
    },
    segmentVerdict(aLat, aLon, bLat, bLon) {
      if (chordLeavesTube({ lat: aLat, lon: aLon }, { lat: bLat, lon: bLon })) {
        return OUTSIDE;
      }
      return mask === undefined
        ? INSIDE
        : mask.segmentVerdict(aLat, aLon, bLat, bLon);
    },
    clearanceNm(lat, lon, maxNm) {
      const toWall = tubeNm - distanceToRouteNm(route, { lat, lon });
      const base = mask === undefined ? maxNm : mask.clearanceNm(lat, lon, maxNm);
      return Math.max(0, Math.min(base, toWall, maxNm));
    },
    tssVerdict(aLat, aLon, bLat, bLon): TssVerdict {
      return mask === undefined
        ? { kind: "none" }
        : mask.tssVerdict(aLat, aLon, bLat, bLon);
    },
    coverage: mask?.coverage ?? "full",
    sources,
  };
}
