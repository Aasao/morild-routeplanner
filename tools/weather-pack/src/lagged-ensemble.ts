/**
 * Lagged-ensemble-politikk (`docs/specs/vaerpakker.md` §11, besluttet
 * 2026-09-02 §18 pkt. 2).
 *
 * MEPS-ensemblet leveres «lagged»: batch-jobben henter siste komplette
 * 30-medlemmers kjøring — ALDRI et sammensurium av medlemmer fra ulike
 * kjøringstidspunkter satt sammen selv (det er MET sin jobb).
 *
 * Fallback-regelen: er siste kjøring ufullstendig (< `requiredMembers`),
 * gå MAKS `maxRunsBack` kjøringer tilbake (§18 pkt. 2: 2 kjøringer, ~12 t).
 * Er ingen av dem komplett, er svaret «ingen brukbart ensemble» — pipelinen
 * leter IKKE videre bakover (villedende eldre ensemble er verre enn intet
 * ensemble, N2).
 */

export interface EnsembleRun {
  /** ISO 8601 init-tidspunkt for kjøringen (nyest først forventes i input-lista). */
  readonly init: string;
  readonly memberCount: number;
  /** Har kontrollmedlemmet (medlem 0) i det hele tatt data, uavhengig av ensemblets fullstendighet? */
  readonly hasControlMember: boolean;
}

export type EnsembleSelection =
  | {
      readonly outcome: "complete";
      readonly run: EnsembleRun;
      readonly runsBack: number;
      readonly sourceStatus: { readonly status: "ok" } | { readonly status: "degraded"; readonly reason: string };
    }
  | {
      readonly outcome: "no-usable-ensemble";
      /** Kontrollmedlemmet kan fortsatt leveres alene fra siste kjøring, hvis den har det. */
      readonly controlOnlyRun: EnsembleRun | undefined;
      readonly sourceStatus: { readonly status: "degraded"; readonly reason: string };
    };

export interface LaggedEnsembleOptions {
  readonly requiredMembers: number; // 30 i produksjon
  readonly maxRunsBack: number; // 2 (§18 pkt. 2)
}

export const DEFAULT_LAGGED_ENSEMBLE_OPTIONS: LaggedEnsembleOptions = {
  requiredMembers: 30,
  maxRunsBack: 2,
};

/**
 * `runs` skal være sortert nyest først (samme rekkefølge batch-jobben
 * naturlig oppdager dem i THREDDS-katalogen). `runsBack: 0` betyr siste
 * kjøring var komplett; `runsBack: 1` betyr forrige kjøring (§18 pkt. 2s
 * "0-6t aldersspenn" er MET-produktets EGET spenn INNAD i én kjøring og
 * krever ingen spesialbehandling her — se §11).
 */
export function selectEnsembleRun(
  runs: readonly EnsembleRun[],
  options: LaggedEnsembleOptions = DEFAULT_LAGGED_ENSEMBLE_OPTIONS,
): EnsembleSelection {
  const candidateCount = Math.min(runs.length, options.maxRunsBack + 1);
  for (let i = 0; i < candidateCount; i++) {
    const run = runs[i];
    if (run && run.memberCount >= options.requiredMembers) {
      return {
        outcome: "complete",
        run,
        runsBack: i,
        sourceStatus:
          i === 0
            ? { status: "ok" }
            : {
                status: "degraded",
                reason: `Siste kjøring ufullstendig — falt tilbake ${i} kjøring(er) til ${run.init}`,
              },
      };
    }
  }
  const latest = runs[0];
  return {
    outcome: "no-usable-ensemble",
    controlOnlyRun: latest?.hasControlMember ? latest : undefined,
    sourceStatus: {
      status: "degraded",
      reason:
        `Ingen komplett ensemble (>= ${options.requiredMembers} medlemmer) funnet innenfor ` +
        `${options.maxRunsBack} kjøring(er) tilbake` +
        (latest ? ` (siste kjøring ${latest.init} hadde ${latest.memberCount} medlemmer)` : " (ingen kjøringer tilgjengelig)"),
    },
  };
}
