/**
 * TSS-regelen (docs/specs/rutemotor.md §5.4, F1.5, ADR-0004 avvik 4).
 *
 * Egen, navngitt funksjon — **ikke** en generisk sonekostnad. Grunnen er
 * hard/myk-prinsippet: en tilstrekkelig høy myk kostnad kan i prinsippet
 * fortsatt vinne mot et alternativ som er enda dyrere på andre dimensjoner.
 * Et sikkerhets- og regelkrav skal aldri kunne tapes i en avveining.
 *
 * Vinkelgrensen er uttrykt slik COLREG regel 10 faktisk er formulert — «så
 * nær rett vinkel som praktisk mulig» — altså som et **avvik fra tvers**:
 * kryssing er tillatt innenfor ±30° fra tvers (besluttet 2026-08-30), som
 * svarer til en vinkel mot ledaksen på ≥ 60°.
 */
import type { TssVerdict } from "./contracts.js";

export type TssOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "reject"; readonly reason: string }
  | { readonly kind: "along-with-direction" };

export interface TssRuleParams {
  /** Tillatt avvik fra tvers ved kryssing. Standard 30°. */
  readonly crossToleranceFromBeamDeg: number;
}

export const DEFAULT_TSS_PARAMS: TssRuleParams = Object.freeze({
  crossToleranceFromBeamDeg: 30,
});

/** Minste tillatte vinkel mot ledaksen, utledet av toleransen fra tvers. */
export function minCrossingAngleDeg(params: TssRuleParams): number {
  return 90 - params.crossToleranceFromBeamDeg;
}

/**
 * Anvender regelen på en TSS-vurdering.
 *
 * | verdict | utfall |
 * |---|---|
 * | `none` | ok |
 * | `crossing`, vinkel ≥ 60° | ok, ingen kostnad |
 * | `crossing`, vinkel < 60° | **hard avvisning** — kryss på tvers, ikke skrått |
 * | `along`, med retningen | tillatt, flagges (og kan gis myk kostnad) |
 * | `along`, mot retningen | **hard avvisning** |
 */
export function applyTssRule(
  verdict: TssVerdict,
  params: TssRuleParams = DEFAULT_TSS_PARAMS,
): TssOutcome {
  switch (verdict.kind) {
    case "none":
      return { kind: "ok" };
    case "crossing": {
      const minAngle = minCrossingAngleDeg(params);
      if (verdict.angleDeg >= minAngle) return { kind: "ok" };
      return {
        kind: "reject",
        reason: `TSS krysses ${verdict.angleDeg.toFixed(0)}° mot ledaksen — krever minst ${minAngle}°`,
      };
    }
    case "along":
      if (verdict.withDirection) return { kind: "along-with-direction" };
      return { kind: "reject", reason: "TSS følges mot trafikkretningen" };
  }
}
