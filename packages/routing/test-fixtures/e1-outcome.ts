/**
 * **Én sannhet for hva et E1′-medlem er verdt** — delt mellom målescriptet
 * (`tools/e1-maaling/maaling.mjs`) og forkravstestene
 * (`src/e1-forkrav.test.ts`).
 *
 * Grunnen til at dette er en egen modul og ikke to kopier: måleplanens §8.2
 * krever at **algoritmisk abort og vær-ugjennomførbarhet telles likt i alle
 * tre variantene**. Et krav om at to tellinger er like, er verdiløst hvis de
 * to tellingene er skrevet ned to ganger. Her er klassifiseringen skrevet én
 * gang, testen beviser at den er variantnøytral, og målescriptet bruker
 * nøyaktig den samme koden.
 *
 * Variantene (måleplanens §1.4):
 *
 *  - **A** — eget skalart søk per medlem; R2-re-søk skalart på hele masken.
 *  - **B** — korridorevaluering av kandidatruten; R2-re-søk korridorbegrenset.
 *  - **F** — eget fullt Pareto-søk per medlem; fullt Pareto-re-søk. **Fasit.**
 *
 * Rent og deterministisk: ingen I/O, ingen klokke, ingen RNG.
 */
import type { LatLon } from "@morild/geo";
import type {
  BailoutHarbour,
  BoatModel,
  EvalRejection,
  NavigabilityMask,
  R2SearchMode,
  R2Verdict,
  RouteOptions,
  WeatherField,
} from "../src/index.js";
import {
  corridorMemberOutcome,
  evaluateRoute,
  isHardRejection,
  planRoute,
  planRouteScalar,
  r2FromFailure,
} from "../src/index.js";

export type E1Variant = "A" | "B" | "F";

/** R2-mekanikken per variant. Fasiten bruker `pareto` (måleplanens §6.1). */
export const R2_MODE: Readonly<Record<E1Variant, R2SearchMode>> = Object.freeze({
  A: "skalar",
  B: "korridor-skalar",
  F: "pareto",
});

/** Variant Bs rør i nm. Måleplanens §1.4: 3–5. */
export const E1_TUBE_NM = 4;

export interface MemberOutcome {
  readonly gjennomfoerbar: boolean;
  /** Ankomsttid i timer, `null` når medlemmet ikke kom fram. */
  readonly timerH: number | null;
  readonly beatH: number | null;
  readonly motorH: number | null;
  readonly nightH: number | null;
  readonly distanceNm: number | null;
  /** Hvorfor det ikke gikk. `null` når det gikk. */
  readonly avbrudd: string | null;
  /**
   * **Algoritmisk** abort (måleplanens §3.2 og §4: kravet er null).
   *
   * Det er en abort i *mekanikken*, ikke en fysisk umulighet: søket ga opp
   * fordi det gikk tomt for etiketter eller sluttet å forbedre seg.
   * `noExpandableLabels`, `noWeather*` og enhver `boatLimits`-avvisning er
   * **ikke** algoritmiske aborter — de er ærlige svar om at veien ikke finnes
   * eller at været er for hardt. `iterationCap` inne i R2 er skranken, ikke en
   * abort (§7.3), og telles ikke her fordi den aldri når medlemsutfallet.
   */
  readonly algoritmiskAbort: boolean;
  /** Rutens spor. For variant B er det kandidatruten — den følger planen. */
  readonly track: readonly LatLon[];
  readonly sok: number;
  readonly evalueringer: number;
}

export interface MemberInputE1 {
  readonly variant: E1Variant;
  readonly start: LatLon;
  readonly dest: LatLon;
  readonly departEpochS: number;
  readonly weather: WeatherField;
  readonly mask: NavigabilityMask;
  readonly boat: BoatModel;
  readonly options: Partial<RouteOptions>;
  /** Kandidatruten fra kontrollmedlemmet. Variant B evaluerer denne. */
  readonly route: readonly LatLon[];
  readonly harbours: readonly BailoutHarbour[];
  readonly tubeNm?: number | undefined;
}

/** Avbrudd som er algoritmiske i søket. Alt annet er et ærlig svar. */
const ALGORITMISKE_ABORTER: ReadonlySet<string> = new Set([
  "labelCap",
  "stagnation",
]);

/**
 * Evaluatorens motstykke: `stepBudget` er en grense i evaluatorens mekanikk,
 * på nøyaktig samme måte som `labelCap` er det i søkets. `noProgress` er
 * derimot et ærlig svar («båten kommer ikke videre»), og teller ikke.
 */
const ALGORITMISKE_EVAL_AVBRUDD: ReadonlySet<string> = new Set(["stepBudget"]);

export function memberOutcome(input: MemberInputE1): MemberOutcome {
  if (input.variant === "B") {
    const ut = corridorMemberOutcome({
      route: input.route,
      departEpochS: input.departEpochS,
      weather: input.weather,
      mask: input.mask,
      boat: input.boat,
      options: input.options,
      tubeNm: input.tubeNm ?? E1_TUBE_NM,
      harbours: input.harbours,
    });
    const e = ut.evaluation;
    const avbrudd = e.rejection === null ? null : e.rejection.kind;
    return {
      gjennomfoerbar: e.feasible,
      timerH: e.feasible ? e.cost.tS / 3600 : null,
      beatH: e.feasible ? e.cost.beatS / 3600 : null,
      motorH: e.feasible ? e.cost.motorS / 3600 : null,
      nightH: e.feasible ? e.cost.nightS / 3600 : null,
      distanceNm: e.feasible ? e.distanceNm : null,
      avbrudd,
      algoritmiskAbort:
        avbrudd !== null && ALGORITMISKE_EVAL_AVBRUDD.has(avbrudd),
      // Variant B har per konstruksjon ingen egen topologi.
      track: input.route,
      sok: ut.searchCount,
      evalueringer: ut.evaluationCount,
    };
  }

  const searchInput = {
    start: input.start,
    dest: input.dest,
    departEpochS: input.departEpochS,
    weather: input.weather,
    mask: input.mask,
    boat: input.boat,
    options: input.options,
  };
  const result =
    input.variant === "A" ? planRouteScalar(searchInput) : planRoute(searchInput);
  const framme = result.safety.reachesDestination;
  const avbrudd =
    result.abortReason ?? (framme ? null : result.finalLeg.status);
  return {
    gjennomfoerbar: framme,
    timerH: framme ? result.totals.durationS / 3600 : null,
    beatH: framme ? result.totals.beatS / 3600 : null,
    motorH: framme ? result.totals.motorS / 3600 : null,
    nightH: framme ? result.totals.nightS / 3600 : null,
    distanceNm: framme ? result.totals.distanceNm : null,
    avbrudd,
    algoritmiskAbort:
      result.abortReason !== null &&
      ALGORITMISKE_ABORTER.has(result.abortReason),
    track: result.steps.map((s) => ({ lat: s.lat, lon: s.lon })),
    sok: 1,
    evalueringer: 0,
  };
}

export interface TrapVerdict {
  readonly felle: boolean;
  /** Fantes det en hard feil langs kandidatruten i det hele tatt? */
  readonly hardFeil: boolean;
  readonly failure: EvalRejection | null;
  readonly verdict: R2Verdict | null;
  readonly sok: number;
}

/**
 * Felle-dommen for ett medlem under én variants R2-mekanikk.
 *
 * **Feildeteksjonen er delt** — samme evaluator, samme kandidatrute, samme
 * `isHardRejection`. Det eneste som skiller variantene er *re-søket*. Det er
 * en bevisst konstruksjon: fasiten skal ikke kunne skilles fra variantene av
 * noe annet enn mekanikken den ble bedt om å måle (måleplanens §6.1).
 */
export function trapVerdict(
  input: Omit<MemberInputE1, "variant" | "start" | "dest">,
  mode: R2SearchMode,
  /**
   * Backoff i **sekunder fysisk tid** (ADR-0005, `bailout.ts`s `backoffS`).
   * `undefined` ⇒ `min(Δt, 1800 s)`, som er det målingen kjørte med.
   * Erstattet `backoffSteps` 2026-09-04; sensitivitetskolonnen 0/1/2 steg
   * uttrykkes nå som 0 / Δt / 2·Δt sekunder.
   */
  backoffS: number | undefined = undefined,
  /**
   * Opsjoner som **kun** gjelder re-søket (lagt til 2026-09-01 for de billige
   * variantene F12/A12, som kjører grovere kursoppløsning).
   *
   * Den er bevisst skilt fra `input.options`: `evaluateRoute` under er den
   * **delte** feildeteksjonen (måleplanens §6.1 — fasiten skal ikke kunne
   * skilles fra variantene av noe annet enn re-søksmekanikken), og den skal
   * derfor aldri se variantens egne søkeopsjoner. Uten override er kallet
   * bit-identisk med kjøringen 2026-08-31.
   */
  searchOptions?: Partial<RouteOptions> | undefined,
): TrapVerdict {
  const evaluation = evaluateRoute({
    waypoints: input.route,
    departEpochS: input.departEpochS,
    weather: input.weather,
    mask: input.mask,
    boat: input.boat,
    options: input.options,
  });
  if (!isHardRejection(evaluation.rejection)) {
    return {
      felle: false,
      hardFeil: false,
      failure: evaluation.rejection,
      verdict: null,
      sok: 0,
    };
  }
  const verdict = r2FromFailure(
    {
      route: input.route,
      departEpochS: input.departEpochS,
      weather: input.weather,
      mask: input.mask,
      boat: input.boat,
      options: input.options,
      r2: {
        harbours: input.harbours,
        mode,
        tubeNm: input.tubeNm ?? E1_TUBE_NM,
        ...(backoffS === undefined ? {} : { backoffS }),
        ...(searchOptions === undefined ? {} : { searchOptions }),
      },
    },
    evaluation.rejection!,
    evaluation.steps,
  );
  return {
    felle: verdict.isTrap,
    hardFeil: true,
    failure: evaluation.rejection,
    verdict,
    sok: verdict.searchCount,
  };
}
