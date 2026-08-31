/**
 * **R2 — felle-definisjonen** (måleplanens §6.1, låst før kjøring).
 *
 *   *Felle* i medlem m ⇔ det finnes et punkt p på ruten der fortsettelsen
 *   feiler **hardt** i m (farbarhet/no-go, maxTws/maxHs, TSS — ikke ren
 *   treghet), og re-søk fra (p, t(p)) under medlemmets vær ikke finner farbar
 *   vei til noen bail-out-havn innen **6 timer** seilingstid. Anløpbarhet
 *   vurderes under **medlemmets** vær: pålandsvind eller for høy sjø ved havnen
 *   diskvalifiserer havnen i det medlemmet.
 *
 * Fasiten (variant F) kjører re-søket som **fullt Pareto-søk**; variant B
 * kjører det som korridorbegrenset skalarsøk. Mekanikken er derfor en
 * parameter her (`mode`) og ikke bakt inn: fasiten skal være uavhengig av
 * variant Bs mekanikk (djevelens advokat, steg3-planen §3).
 *
 * **Ingen felt- eller screeningmetode har lov til å definere felle-settet.**
 * Denne filen gjør ett eksakt re-søk per havn og bruker motorens egne harde
 * sjekker. Det er dyrt med vilje.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`. Havne-
 * listen kommer inn som data (interim-liste i
 * `docs/research/bailout-interim.md`, erstattes av F4.6-boken i fase 4).
 */
import type { LatLon } from "@morild/geo";
import { angDiff, haversineNm } from "@morild/geo";
import { corridorMask } from "./corridor.js";
import type {
  BoatModel,
  NavigabilityMask,
  WeatherField,
} from "./contracts.js";
import type { EvalRejection, EvalRejectionKind } from "./evaluate.js";
import { evaluateRoute } from "./evaluate.js";
import type { RouteOptions } from "./options.js";
import { withDefaults } from "./options.js";
import type { AbortReason, RouteStep } from "./result.js";
import { planRoute } from "./search.js";

/**
 * Hvilke avvisninger som teller som **hard** feil i R2s forstand.
 *
 * `noWeather`, `noSpeed`, `noProgress` og `stepBudget` er *treghet eller
 * degradering* — måleplanen sier eksplisitt at de ikke skal telle.
 * `daylightArrival` er et brukerkrav, ikke en fare, og teller heller ikke.
 */
export const HARD_REJECTION_KINDS: ReadonlySet<EvalRejectionKind> =
  new Set<EvalRejectionKind>(["boatLimits", "point", "clearance", "segment", "tss"]);

export function isHardRejection(rejection: EvalRejection | null): boolean {
  return rejection !== null && HARD_REJECTION_KINDS.has(rejection.kind);
}

/**
 * En nødhavn. Eksponeringen er en grov, men eksplisitt, modell: havnen er
 * åpen mot en sektor, og pålandsvind eller sjø over grensene gjør anløp
 * uforsvarlig i det medlemmet.
 */
export interface BailoutHarbour {
  readonly name: string;
  readonly position: LatLon;
  /** Senterretningen havnen er eksponert mot (vind FRA denne retningen). */
  readonly exposedFromDeg: number;
  /** Halv sektorbredde i grader. */
  readonly exposedHalfWidthDeg: number;
  /** Maks TWS fra den eksponerte sektoren før anløp regnes som uforsvarlig. */
  readonly maxOnshoreTwsKn: number;
  /** Maks Hs ved havnen, uansett retning. */
  readonly maxHsM: number;
}

export type HarbourVerdict =
  | { readonly approachable: true; readonly reason: string }
  | { readonly approachable: false; readonly reason: string };

/**
 * Er havnen anløpbar under medlemmets vær på ankomsttidspunktet?
 *
 * Mangler værdata i havnen, er svaret **nei** — vi later aldri som om en
 * udekket havn er en trygg havn (N2 «ærlig degradering»).
 */
export function harbourApproachable(
  harbour: BailoutHarbour,
  weather: WeatherField,
  epochS: number,
): HarbourVerdict {
  const wind = weather.wind(
    harbour.position.lat,
    harbour.position.lon,
    epochS,
  );
  if (wind === undefined) {
    return {
      approachable: false,
      reason: `ingen værdata ved ${harbour.name} på ankomsttidspunktet`,
    };
  }
  const waves = weather.waves(
    harbour.position.lat,
    harbour.position.lon,
    epochS,
  );
  if (waves !== undefined && waves.hsM > harbour.maxHsM) {
    return {
      approachable: false,
      reason: `Hs ${waves.hsM.toFixed(1)} m over ${harbour.name}s grense ${harbour.maxHsM} m`,
    };
  }
  const onshore =
    angDiff(wind.fromDeg, harbour.exposedFromDeg) <=
    harbour.exposedHalfWidthDeg;
  if (onshore && wind.speedKn > harbour.maxOnshoreTwsKn) {
    return {
      approachable: false,
      reason:
        `pålandsvind ${wind.speedKn.toFixed(0)} kn fra ${wind.fromDeg.toFixed(0)}° ` +
        `over ${harbour.name}s grense ${harbour.maxOnshoreTwsKn} kn`,
    };
  }
  return { approachable: true, reason: "anløpbar" };
}

/**
 * Mekanikken re-søket kjøres med — én per målevariant. Fasiten bruker
 * `pareto`.
 *
 *  - `pareto` (variant F): fullt Pareto-re-søk på hele masken.
 *  - `skalar` (variant A): ett etikettslot per tilstand, men hele masken.
 *  - `korridor-skalar` (variant B): skalart re-søk begrenset til et rør rundt
 *    rømningslinjen.
 *
 * `skalar` ble lagt til 2026-08-31, FØR kjøring, av en grunn som er verdt å
 * skrive ned: uten den måtte variant A låne enten fasitens eller variant Bs
 * re-søksmekanikk, og felle-settet til A ville da vært identisk med den den
 * lånte fra — per konstruksjon, ikke som måleresultat. §4s viktigste kriterium
 * ville vært tomt for A. Dette er en operasjonalisering av variant A, ikke en
 * endring av fasiten (`pareto` er urørt) eller av noe kriterium.
 */
export type R2SearchMode = "pareto" | "skalar" | "korridor-skalar";

export interface R2Config {
  readonly harbours: readonly BailoutHarbour[];
  /** Skranken i sekunder. Måleplanen: 6 timer. */
  readonly limitS?: number | undefined;
  readonly mode?: R2SearchMode | undefined;
  /** Rørets halvbredde for `korridor-skalar`. Standard 4 nm. */
  readonly tubeNm?: number | undefined;
  /**
   * Hvor mange tidssteg tilbake langs ruten re-søket starter.
   *
   * **Standard 1, og valget er ikke kosmetisk.** Måleplanens §6.1 sier «et
   * punkt p på ruten der *fortsettelsen* feiler hardt». Evaluatoren
   * rapporterer avvisningen i posisjonen båten står i når feilen oppdages — og
   * ved `boatLimits` er været *der* allerede over båtens grense. Et re-søk
   * derfra kan per konstruksjon ikke ta et eneste steg (`checkHardNode` feller
   * startnoden), og R2 ville degenerert til en omskrivning av «hard avvisning»
   * — samme svar for alle varianter, og målingens viktigste kriterium ville
   * vært tomt.
   *
   * Med `backoffSteps: 1` stilles i stedet det seilbare spørsmålet: **da du
   * sist var lovlig, kunne du ha kommet deg i havn?** Det er også det eneste
   * spørsmålet som kan skille en variant fra fasiten.
   *
   * `backoffSteps: 0` gir den bokstavelige lesningen og er beholdt slik at
   * målingen kan rapportere begge.
   */
  readonly backoffSteps?: number | undefined;
  /** Opsjoner for re-søket. Slås sammen med rutens egne. */
  readonly searchOptions?: Partial<RouteOptions> | undefined;
}

export type BailoutOutcome =
  /** Re-søket nådde havnen innen skranken, og havnen var anløpbar. */
  | "naadd"
  /** Re-søket nådde havnen, men for sent. */
  | "for-sent"
  /** Havnen ligger så langt unna at den er uoppnåelig innen skranken. */
  | "for-langt"
  /** Re-søket fant ingen farbar vei. */
  | "ingen-vei"
  /** Framme i tide, men havnen er ikke anløpbar i dette medlemmets vær. */
  | "ikke-anloepbar"
  /** Ikke forsøkt: en tidligere havn i listen lyktes. */
  | "ikke-forsokt";

export interface BailoutAttempt {
  readonly harbour: string;
  readonly outcome: BailoutOutcome;
  readonly reason: string;
  /** Seilingstid til havnen i sekunder, når re-søket kom fram. */
  readonly durationS: number | null;
  readonly abortReason: AbortReason | null;
  readonly distanceNm: number;
}

export interface R2Verdict {
  /** Er medlemmet en **felle**? */
  readonly isTrap: boolean;
  /** Den harde avvisningen. `null` ⇒ ruten holdt, og da er `isTrap` false. */
  readonly failure: EvalRejection | null;
  /** Punktet re-søket startet fra (etter `backoffSteps`). */
  readonly from: LatLon | null;
  /** Sekunder siden avgang i `from`. */
  readonly fromTS: number | null;
  readonly reachedHarbour: string | null;
  readonly attempts: readonly BailoutAttempt[];
  /** Kostnadskolonne (§6.6): antall re-søk R2 måtte kjøre. */
  readonly searchCount: number;
}

export const R2_LIMIT_S = 6 * 3600;

const NO_FAILURE: R2Verdict = Object.freeze({
  isTrap: false,
  failure: null,
  from: null,
  fromTS: null,
  reachedHarbour: null,
  attempts: Object.freeze([]),
  searchCount: 0,
});

export interface R2Input {
  /** Kandidatruten, som veipunkter. */
  readonly route: readonly LatLon[];
  readonly departEpochS: number;
  /** Medlemmets værfelt. */
  readonly weather: WeatherField;
  readonly mask: NavigabilityMask | undefined;
  readonly boat: BoatModel;
  readonly options?: Partial<RouteOptions> | undefined;
  readonly r2: R2Config;
}

/**
 * R2-dommen for ett medlem: evaluer ruten, finn første harde feil, og prøv å
 * seile fra det siste lovlige punktet til en nødhavn innen skranken.
 */
export function r2Verdict(input: R2Input): R2Verdict {
  const evaluation = evaluateRoute({
    waypoints: input.route,
    departEpochS: input.departEpochS,
    weather: input.weather,
    mask: input.mask,
    boat: input.boat,
    options: input.options,
  });
  if (!isHardRejection(evaluation.rejection)) return NO_FAILURE;
  const failure = evaluation.rejection!;
  return r2FromFailure(input, failure, evaluation.steps);
}

/**
 * Samme dom, men for en feil som allerede er funnet (variant B gjenbruker sin
 * egen korridorevaluering i stedet for å evaluere på nytt).
 */
export function r2FromFailure(
  input: R2Input,
  failure: EvalRejection,
  steps: readonly RouteStep[],
): R2Verdict {
  const cfg = input.r2;
  const limitS = cfg.limitS ?? R2_LIMIT_S;
  const backoff = cfg.backoffSteps ?? 1;
  const mode: R2SearchMode = cfg.mode ?? "pareto";
  const isCorridorMode = mode === "korridor-skalar";
  const isScalarSearch = mode !== "pareto";
  const opts = withDefaults(input.options ?? {});

  // Startpunktet: `backoff` tidssteg tilbake fra der feilen ble oppdaget.
  // `failure.stepIndex` er antall steg som lå i listen da feilen oppstod, så
  // `stepIndex - 1` er posisjonen båten stod i.
  const startIndex = Math.max(0, failure.stepIndex - 1 - backoff);
  const startStep = steps[startIndex];
  const from: LatLon =
    startStep === undefined
      ? { lat: failure.lat, lon: failure.lon }
      : { lat: startStep.lat, lon: startStep.lon };
  const fromTS = startStep === undefined ? failure.tS : startStep.tS;
  const departEpochS = input.departEpochS + fromTS;

  // Øvre fartsgrense for forhåndsfiltreringen: raskeste polarfart i feltets
  // sterkeste vind, motor og strøm. Bevisst raus — den skal aldri kunne
  // utelukke en havn som faktisk var innen rekkevidde.
  let vmaxKn = input.boat.motorThresholdKn > 0 ? input.boat.motorSpeedKn : 0;
  for (let twa = 0; twa <= 180; twa += 5) {
    const v = input.boat.boatSpeedKn(
      Math.min(input.weather.maxTwsKn, input.boat.maxTwsKn),
      twa,
    );
    if (v > vmaxKn) vmaxKn = v;
  }
  vmaxKn += input.weather.maxCurrentKn;
  const reachNm = (vmaxKn * limitS) / 3600;

  const attempts: BailoutAttempt[] = [];
  let searchCount = 0;
  let reachedHarbour: string | null = null;

  for (const harbour of cfg.harbours) {
    if (reachedHarbour !== null) {
      attempts.push({
        harbour: harbour.name,
        outcome: "ikke-forsokt",
        reason: `${reachedHarbour} var allerede nådd`,
        durationS: null,
        abortReason: null,
        distanceNm: haversineNm(from, harbour.position),
      });
      continue;
    }
    const distanceNm = haversineNm(from, harbour.position);
    if (distanceNm > reachNm) {
      attempts.push({
        harbour: harbour.name,
        outcome: "for-langt",
        reason: `${distanceNm.toFixed(1)} nm er mer enn ${reachNm.toFixed(1)} nm på ${(limitS / 3600).toFixed(0)} t`,
        durationS: null,
        abortReason: null,
        distanceNm,
      });
      continue;
    }

    const searchMask = isCorridorMode
      ? corridorMask({
            route: [from, harbour.position],
            tubeNm: cfg.tubeNm ?? 4,
            mask: input.mask,
          })
        : input.mask;

    // Iterasjonstaket er **skranken**, ikke en algoritmisk grense: én
    // iterasjon er ett tidssteg, så taket er 6 t uttrykt i motorens egen
    // valuta. Et `iterationCap` her skal derfor rapporteres som «for sent»,
    // aldri som en algoritmisk abort (måleplanens §4).
    const maxIterations = Math.ceil(limitS / opts.timeStepS) + 1;
    searchCount++;
    const result = planRoute({
      start: from,
      dest: harbour.position,
      departEpochS,
      weather: input.weather,
      mask: searchMask,
      boat: input.boat,
      options: {
        ...(input.options ?? {}),
        ...(cfg.searchOptions ?? {}),
        maxIterations,
        // Nødhavn-anløp er ikke underlagt dagslyskravet.
        requireDaylightArrival: false,
        // Settes **eksplisitt** begge veier: kalleren kan ha slått på
        // skalarmodus for sitt eget medlemssøk (variant A), og fasitens
        // re-søk skal aldri arve det.
        scalarSearchMode: isScalarSearch,
      },
    });

    if (!result.safety.reachesDestination) {
      attempts.push({
        harbour: harbour.name,
        outcome: result.abortReason === "iterationCap" ? "for-sent" : "ingen-vei",
        reason:
          result.abortReason === null
            ? `ruten stoppet ${result.finalLeg.shortfallNm.toFixed(2)} nm fra havnen (${result.finalLeg.status})`
            : `søket ga opp: ${result.abortReason}`,
        durationS: null,
        abortReason: result.abortReason,
        distanceNm,
      });
      continue;
    }
    if (result.totals.durationS > limitS) {
      attempts.push({
        harbour: harbour.name,
        outcome: "for-sent",
        reason: `${(result.totals.durationS / 3600).toFixed(1)} t over skranken ${(limitS / 3600).toFixed(0)} t`,
        durationS: result.totals.durationS,
        abortReason: null,
        distanceNm,
      });
      continue;
    }

    const verdict = harbourApproachable(
      harbour,
      input.weather,
      result.totals.arrivalEpochS,
    );
    if (!verdict.approachable) {
      attempts.push({
        harbour: harbour.name,
        outcome: "ikke-anloepbar",
        reason: verdict.reason,
        durationS: result.totals.durationS,
        abortReason: null,
        distanceNm,
      });
      continue;
    }

    reachedHarbour = harbour.name;
    attempts.push({
      harbour: harbour.name,
      outcome: "naadd",
      reason: `framme etter ${(result.totals.durationS / 3600).toFixed(1)} t`,
      durationS: result.totals.durationS,
      abortReason: null,
      distanceNm,
    });
  }

  return {
    isTrap: reachedHarbour === null,
    failure,
    from,
    fromTS,
    reachedHarbour,
    attempts,
    searchCount,
  };
}
