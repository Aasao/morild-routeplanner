/**
 * **Målevariantene i E1′** (`docs/research/maaleplan-e1-2026-08-31.md` §1.4).
 *
 * Tre måter å regne ut ett ensemble-medlem på:
 *
 *  - **A — skalart søk:** eget søk per medlem, men med ett etikettslot per
 *    tilstand (`scalarSearchMode`). Billigst av søkene.
 *  - **B — korridor + R2-re-søk:** ingen søk per medlem. Kandidatruten
 *    evalueres inne i et rør på 3–5 nm; feiler evalueringen hardt, kjøres et
 *    korridorbegrenset skalart re-søk mot nødhavnene. Billigst totalt.
 *  - **F — full Pareto:** eget fullt Pareto-søk per medlem, og fullt
 *    Pareto-re-søk i R2. **Fasiten** de to andre måles mot.
 *
 * Alle tre er **egne innganger**. Produksjonsmotoren er uendret: `planRoute`
 * uten opsjoner gjør nøyaktig det den gjorde før, og
 * `variants.test.ts`/golden-testene beviser det.
 *
 * Ren og deterministisk som resten av motoren.
 */
import type { LatLon } from "@morild/geo";
import type { BailoutHarbour, R2Config, R2Verdict } from "./bailout.js";
import { isHardRejection, r2FromFailure } from "./bailout.js";
import { corridorMask } from "./corridor.js";
import type { RouteEvaluation } from "./evaluate.js";
import { evaluateRoute } from "./evaluate.js";
import type { RouteOptions } from "./options.js";
import type { RouteResult } from "./result.js";
import type { RouteInput } from "./search.js";
import { planRoute } from "./search.js";

/** Variant A: samme søk som i produksjon, men skalart. */
export function planRouteScalar(input: RouteInput): RouteResult {
  return planRoute({
    ...input,
    options: { ...(input.options ?? {}), scalarSearchMode: true },
  });
}

/** Variant F: fullt Pareto-søk per medlem — motoren slik den er. */
export function planRouteParetoReference(input: RouteInput): RouteResult {
  return planRoute(input);
}

// Gjenbruker motorens egne kontrakter uten å re-eksportere dem her.
type WeatherFieldLike = RouteInput["weather"];
type MaskLike = RouteInput["mask"];
type BoatLike = RouteInput["boat"];

/** R2-innstillinger varianten selv ikke eier (`harbours`/`mode` er gitt). */
export type CorridorR2Overrides = Omit<Partial<R2Config>, "harbours" | "mode">;

export interface CorridorMemberInput {
  /** Kandidatruten (fra kontrollmedlemmet), som veipunkter. */
  readonly route: readonly LatLon[];
  readonly departEpochS: number;
  /** Medlemmets værfelt. */
  readonly weather: WeatherFieldLike;
  readonly mask: MaskLike;
  readonly boat: BoatLike;
  readonly options?: Partial<RouteOptions> | undefined;
  /** Rørets halvbredde i nm. Måleplanen: 3–5. Standard 4. */
  readonly tubeNm?: number | undefined;
  /** Nødhavner og skranke for re-søket. */
  readonly harbours: readonly BailoutHarbour[];
  readonly r2?: CorridorR2Overrides | undefined;
}

export interface CorridorMemberResult {
  /** Evalueringen inne i røret. */
  readonly evaluation: RouteEvaluation;
  /**
   * R2-dommen. `null` når evalueringen ikke feilet hardt — da er medlemmet
   * per definisjon ingen felle, og re-søket kjøres aldri.
   */
  readonly r2: R2Verdict | null;
  /** Kostnadskolonne (§6.6): antall søk varianten måtte kjøre. */
  readonly searchCount: number;
  /** Kostnadskolonne: antall ruteevalueringer. */
  readonly evaluationCount: number;
}

/**
 * **Variant B** for ett medlem.
 *
 * Røret gjør to ting: (1) det gjør evalueringen ærlig — driver båten mer enn
 * `tubeNm` av kandidatruten i dette medlemmets vær og strøm, er korridor-
 * antagelsen brutt og evalueringen stopper hardt i stedet for å late som om
 * ruten fortsatt gjelder; (2) det avgrenser re-søket, som er det varianten
 * sparer tid på.
 */
export function corridorMemberOutcome(
  input: CorridorMemberInput,
): CorridorMemberResult {
  const tubeNm = input.tubeNm ?? 4;
  const tube = corridorMask({
    route: input.route,
    tubeNm,
    mask: input.mask,
  });
  const evaluation = evaluateRoute({
    waypoints: input.route,
    departEpochS: input.departEpochS,
    weather: input.weather,
    mask: tube,
    boat: input.boat,
    // Havneunntaket skal måles mot rutens egne ender, ikke mot rørets.
    harbourEnds: {
      start: input.route[0]!,
      dest: input.route[input.route.length - 1]!,
    },
    options: input.options,
  });
  if (!isHardRejection(evaluation.rejection)) {
    return { evaluation, r2: null, searchCount: 0, evaluationCount: 1 };
  }
  const r2 = r2FromFailure(
    {
      route: input.route,
      departEpochS: input.departEpochS,
      weather: input.weather,
      mask: input.mask,
      boat: input.boat,
      options: input.options,
      r2: {
        ...(input.r2 ?? {}),
        harbours: input.harbours,
        mode: "korridor-skalar",
        tubeNm: input.r2?.tubeNm ?? tubeNm,
      },
    },
    evaluation.rejection!,
    evaluation.steps,
  );
  return {
    evaluation,
    r2,
    searchCount: r2.searchCount,
    evaluationCount: 1,
  };
}
