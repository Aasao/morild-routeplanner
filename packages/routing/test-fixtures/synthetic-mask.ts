/**
 * Syntetisk farbarhetsmaske for tester: rektangler i lat/lon som no-go eller
 * usikkert areal, pluss en valgfri TSS-korridor.
 *
 * Dette er *ikke* en forenklet utgave av den ekte masken — det er en
 * uavhengig, triviell implementasjon av den samme kontrakten. Poenget er at
 * motoren skal testes mot kontrakten, ikke mot kartpakkens indre liv.
 * Geometrien er eksakt (Liang–Barsky-klipping), ikke samplet, slik at
 * segmenttesten ikke kan gi falske positive mellom to samplingspunkter.
 */
import type {
  ChartSourceRef,
  NavigabilityMask,
  SegmentVerdict,
  TssVerdict,
} from "../src/index.js";
import { angDiff, bearing } from "@morild/geo";

export interface Rect {
  readonly latMin: number;
  readonly latMax: number;
  readonly lonMin: number;
  readonly lonMax: number;
  readonly reason?: string;
}

export interface TssCorridor extends Rect {
  /** Ledaksens retning (dit trafikken skal gå), grader rettvisende. */
  readonly axisDeg: number;
  /** Kurser innenfor denne av aksen regnes som «langs leden». */
  readonly alongToleranceDeg?: number;
}

export interface RectMaskOptions {
  readonly noGo?: readonly Rect[];
  readonly uncertain?: readonly Rect[];
  readonly tss?: readonly TssCorridor[];
  readonly coverage?: "full" | "partial" | "none";
  readonly sources?: readonly ChartSourceRef[];
}

const PASSABLE_SAFE: SegmentVerdict = Object.freeze({
  passable: true,
  tillit: "trygt",
});

function pointInRect(lat: number, lon: number, r: Rect): boolean {
  return (
    lat >= r.latMin && lat <= r.latMax && lon >= r.lonMin && lon <= r.lonMax
  );
}

/**
 * Liang–Barsky: krysser linjestykket a→b rektangelet? Eksakt, uten sampling.
 */
export function segmentIntersectsRect(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  r: Rect,
): boolean {
  if (pointInRect(aLat, aLon, r) || pointInRect(bLat, bLon, r)) return true;
  const dx = bLon - aLon;
  const dy = bLat - aLat;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [aLon - r.lonMin, r.lonMax - aLon, aLat - r.latMin, r.latMax - aLat];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return false;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

/** Avstand fra punkt til rektangel i nautiske mil (0 hvis inni). */
export function pointToRectNm(lat: number, lon: number, r: Rect): number {
  const dLat = Math.max(r.latMin - lat, 0, lat - r.latMax);
  const dLon = Math.max(r.lonMin - lon, 0, lon - r.lonMax);
  const nmLat = dLat * 60;
  const nmLon = dLon * 60 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(nmLat, nmLon);
}

export function rectMask(options: RectMaskOptions = {}): NavigabilityMask {
  const noGo = options.noGo ?? [];
  const uncertain = options.uncertain ?? [];
  const tss = options.tss ?? [];

  const pointVerdict = (lat: number, lon: number): SegmentVerdict => {
    for (const r of noGo) {
      if (pointInRect(lat, lon, r)) {
        return {
          passable: false,
          tillit: "no-go",
          reason: r.reason ?? "innenfor no-go-areal",
        };
      }
    }
    for (const r of uncertain) {
      if (pointInRect(lat, lon, r)) {
        return {
          passable: true,
          tillit: "usikkert",
          reason: r.reason ?? "usikker dekning",
        };
      }
    }
    return PASSABLE_SAFE;
  };

  return {
    pointVerdict,
    segmentVerdict(aLat, aLon, bLat, bLon) {
      for (const r of noGo) {
        if (segmentIntersectsRect(aLat, aLon, bLat, bLon, r)) {
          return {
            passable: false,
            tillit: "no-go",
            reason: r.reason ?? "segmentet krysser no-go-areal",
          };
        }
      }
      for (const r of uncertain) {
        if (segmentIntersectsRect(aLat, aLon, bLat, bLon, r)) {
          return {
            passable: true,
            tillit: "usikkert",
            reason: r.reason ?? "usikker dekning",
          };
        }
      }
      return PASSABLE_SAFE;
    },
    clearanceNm(lat, lon, maxNm) {
      let best = maxNm;
      for (const r of noGo) {
        const d = pointToRectNm(lat, lon, r);
        if (d < best) best = d;
      }
      return best;
    },
    tssVerdict(aLat, aLon, bLat, bLon): TssVerdict {
      const midLat = (aLat + bLat) / 2;
      const midLon = (aLon + bLon) / 2;
      for (const corridor of tss) {
        if (!pointInRect(midLat, midLon, corridor)) continue;
        const course = bearing({ lat: aLat, lon: aLon }, { lat: bLat, lon: bLon });
        const toAxis = angDiff(course, corridor.axisDeg);
        const tolerance = corridor.alongToleranceDeg ?? 45;
        const angleToLane = Math.min(toAxis, 180 - toAxis);
        if (angleToLane < tolerance) {
          return { kind: "along", withDirection: toAxis < 90 };
        }
        return { kind: "crossing", angleDeg: angleToLane };
      }
      return { kind: "none" };
    },
    coverage: options.coverage ?? "full",
    sources: options.sources ?? [
      { name: "SYNTETISK-TESTMASKE", datum: "WGS84" },
    ],
  };
}

/** Maske uten hindringer i det hele tatt — åpent hav. */
export const OPEN_SEA_MASK: NavigabilityMask = rectMask();
