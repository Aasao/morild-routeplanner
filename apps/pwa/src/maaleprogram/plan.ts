/**
 * Kjøreplanen for måleprogrammet (robusthet.md §6.4): ren, deterministisk
 * liste over konfigurasjoner i den rekkefølgen de kjøres. Gjenopptak etter
 * omlasting går på indeks i denne listen, så den MÅ være lik fra gang til
 * gang for samme konstanter (`id`-ene sjekkes ved gjenopptak).
 */
import {
  DUMMY_COUNTS,
  DUMMY_REPEATS,
  DUMMY_VARIANTS,
  POOL_REPEATS,
  POOL_SIZES,
  SOLO_REPEATS,
  type DummyVariant,
} from "./constants.js";

export type RunSpec =
  | { readonly kind: "pool"; readonly id: string; readonly pool: number; readonly repeat: number }
  | { readonly kind: "solo"; readonly id: string; readonly repeat: number }
  | {
      readonly kind: "dummy";
      readonly id: string;
      readonly k: number;
      readonly variant: DummyVariant;
      readonly repeat: number;
    };

/**
 * Vekselvis rekkefølge: runde r er verdiene rotert r plasser —
 * (4, 5, 6, 7), (5, 6, 7, 4), (6, 7, 4, 5), … Hver verdi kjøres like mange
 * ganger, og ingen verdi står fast først (termisk drift og cache-oppvarming
 * fordeles på alle, ikke på én pool-størrelse).
 */
export function alternatingOrder<T>(values: readonly T[], repeats: number): T[] {
  const n = values.length;
  const out: T[] = [];
  if (n === 0) return out;
  for (let r = 0; r < repeats; r += 1) {
    for (let i = 0; i < n; i += 1) {
      out.push(values[(r + i) % n]!);
    }
  }
  return out;
}

export interface PlanConstants {
  readonly poolSizes: readonly number[];
  readonly poolRepeats: number;
  readonly soloRepeats: number;
  readonly dummyCounts: readonly number[];
  readonly dummyVariants: readonly DummyVariant[];
  readonly dummyRepeats: number;
}

export const DEFAULT_PLAN_CONSTANTS: PlanConstants = {
  poolSizes: POOL_SIZES,
  poolRepeats: POOL_REPEATS,
  soloRepeats: SOLO_REPEATS,
  dummyCounts: DUMMY_COUNTS,
  dummyVariants: DUMMY_VARIANTS,
  dummyRepeats: DUMMY_REPEATS,
};

/**
 * Poolsveip → solo → solo + dummy-last. I dummy-delen er gjentaket
 * ytterst, så hver (k, variant) får én kjøring per «runde» og drift over
 * programmets ~45 min ikke havner på én kombinasjon.
 */
export function buildRunPlan(c: PlanConstants = DEFAULT_PLAN_CONSTANTS): RunSpec[] {
  const plan: RunSpec[] = [];
  const seen = new Map<number, number>();
  for (const pool of alternatingOrder(c.poolSizes, c.poolRepeats)) {
    const repeat = seen.get(pool) ?? 0;
    seen.set(pool, repeat + 1);
    plan.push({ kind: "pool", id: `pool-${pool}-r${repeat}`, pool, repeat });
  }
  for (let repeat = 0; repeat < c.soloRepeats; repeat += 1) {
    plan.push({ kind: "solo", id: `solo-r${repeat}`, repeat });
  }
  for (let repeat = 0; repeat < c.dummyRepeats; repeat += 1) {
    for (const k of c.dummyCounts) {
      for (const variant of c.dummyVariants) {
        plan.push({ kind: "dummy", id: `dummy-${variant}-k${k}-r${repeat}`, k, variant, repeat });
      }
    }
  }
  return plan;
}
