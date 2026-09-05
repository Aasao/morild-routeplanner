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
import { resolveGuardBandKn } from "./expand.js";
import type { RouteOptions } from "./options.js";
import { withDefaults } from "./options.js";
import type { AbortReason, RouteStep } from "./result.js";
import type { RouteInput } from "./search.js";
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
 *
 * **Vaktbånd på pålandsvinden (funn 2026-09-04, D7.3-gjennomgangen).**
 * Pålandsvind-testen er en *hard* TWS-sammenligning, akkurat som
 * `checkHardNode`s — og den manglet vaktbåndet fra `vaerpakker.md` §9.5.
 * Vind lagres som u/v og kan dekodes for **lavt**; en havn med sann
 * pålandsvind over grensen kunne dermed blitt erklært anløpbar fordi
 * kvantiseringen tilfeldigvis pekte nedover. Det er den farligste retningen
 * feilen kan ha: en nødhavn man ikke kan gå inn i, presentert som en man kan.
 * Grensen som håndheves er derfor `maxOnshoreTwsKn − bånd`, der båndet er
 * flisens eget når feltet kan oppgi det (`resolveGuardBandKn`, D7.3).
 *
 * Hs trenger ikke samme behandling: bølgehøyde avrundes alltid **opp** i
 * pakkeformatet (§9.3), så en kvantisert Hs kan aldri skjule en
 * overskridelse.
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
  const guardBandKn = resolveGuardBandKn(
    weather,
    harbour.position.lat,
    harbour.position.lon,
    epochS,
  );
  if (onshore && wind.speedKn > harbour.maxOnshoreTwsKn - guardBandKn) {
    return {
      approachable: false,
      reason:
        `pålandsvind ${wind.speedKn.toFixed(0)} kn fra ${wind.fromDeg.toFixed(0)}° ` +
        `over ${harbour.name}s grense ${harbour.maxOnshoreTwsKn} kn` +
        (guardBandKn > 0
          ? ` (vaktbånd ${guardBandKn.toFixed(2)} kn for dekodefeil)`
          : ""),
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
   * Hvor langt tilbake langs ruten re-søket starter, i **sekunder fysisk
   * tid**. Standard `min(Δt, 1800 s)` der Δt er søkets tidssteg
   * (`RouteOptions.timeStepS`) — ADR-0005, `docs/specs/robusthet.md` §3.1
   * pkt. 2.
   *
   * **Hvorfor det trengs backoff i det hele tatt.** Måleplanens §6.1 sier «et
   * punkt p på ruten der *fortsettelsen* feiler hardt». Evaluatoren
   * rapporterer avvisningen i posisjonen båten står i når feilen oppdages — og
   * ved `boatLimits` er været *der* allerede over båtens grense. Et re-søk
   * derfra kan per konstruksjon ikke ta et eneste steg (`checkHardNode` feller
   * startnoden), og R2 ville degenerert til en omskrivning av «hard
   * avvisning» — samme svar for alle varianter, og målingens viktigste
   * kriterium ville vært tomt. Backoffen stiller i stedet det seilbare
   * spørsmålet: **da du sist var lovlig, kunne du ha kommet deg i havn?**
   *
   * **Hvorfor fysisk tid og ikke steg** (erstattet `backoffSteps` 2026-09-04,
   * ADR-0005; panelets funn i `ekspertpanel-4a-robusthet-2026-09-04.md`):
   * evaluatorens tidssteg er *ikke* uniformt. Det siste steget inn mot hvert
   * veipunkt er et **delsteg** (`opts.timeStepS * fraction` i `evaluate.ts`),
   * og med en kandidatrute hvis veipunkter er rutens egne steg er delsteg
   * regelen, ikke unntaket. «Ett steg tilbake» kunne dermed bety alt fra
   * sekunder til en hel time avhengig av hvor langs ruten feilen traff — en
   * skranke som varierer med diskretiseringen er ingen skranke. Med backoff
   * i sekunder er startpunktet det samme uansett hvordan ruten er samplet.
   *
   * `0` gir den bokstavelige lesningen av §6.1 (start i feilpunktet) og er
   * beholdt slik at målingen kan rapportere begge.
   */
  readonly backoffS?: number | undefined;
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
  /** Punktet re-søket startet fra (etter `backoffS`). */
  readonly from: LatLon | null;
  /** Sekunder siden avgang i `from`. */
  readonly fromTS: number | null;
  readonly reachedHarbour: string | null;
  readonly attempts: readonly BailoutAttempt[];
  /** Kostnadskolonne (§6.6): antall re-søk R2 måtte kjøre. */
  readonly searchCount: number;
}

export const R2_LIMIT_S = 6 * 3600;

/**
 * Taket i standardbackoffen: `backoffS = min(Δt, R2_BACKOFF_CAP_S)`
 * (ADR-0005). Taket finnes fordi et grovt tidssteg ellers ville gitt
 * seileren mer «forutseenhet» jo dårligere oppløsning søket kjørte med —
 * en kjent optimistisk skjevhet måleplanen noterte, og som taket avgrenser.
 */
export const R2_BACKOFF_CAP_S = 1800;

/** Standardbackoffen for et gitt tidssteg: `min(Δt, 1800 s)`. */
export function defaultBackoffS(timeStepS: number): number {
  return Math.min(timeStepS, R2_BACKOFF_CAP_S);
}

/**
 * Indeksen i `steps` re-søket starter fra: det **siste** rutepunktet med
 * `tS <= t_feil - backoffS`, aldri før avgang (indeks 0).
 *
 * `steps` er sortert stigende på `tS` per konstruksjon (kostnaden vokser
 * monotont), så lineær baklengs søking finner det største slike punktet. Er
 * `failureIndex` negativ eller listen tom, returneres `-1` og kalleren
 * faller tilbake til selve feilpunktet.
 */
export function backoffStartIndex(
  steps: readonly RouteStep[],
  failureIndex: number,
  backoffS: number,
): number {
  if (steps.length === 0 || failureIndex < 0) return -1;
  const from = Math.min(failureIndex, steps.length - 1);
  const targetS = steps[from]!.tS - backoffS;
  let i = from;
  while (i > 0 && steps[i]!.tS > targetS) i--;
  return i;
}

/**
 * Inn-objektet R2s re-søk kjøres med — eksponert som ren funksjon fordi
 * `docs/specs/robusthet.md` §5.1 krever en test som *beviser* at re-søket
 * aldri arver en delt Tub-bound eller et delt A\*-felt, og at fasitens
 * modus er `pareto`.
 *
 * Beviset er strukturelt, ikke ved inspeksjon: `RouteInput.tubBoundS` og
 * `RouteInput.field` finnes ikke i noen av kanalene inn hit
 * (`R2Input.options` og `R2Config.searchOptions` er begge
 * `Partial<RouteOptions>`, og `RouteOptions` har ingen av dem), og de settes
 * ikke her. Delt Tub i et bail-out-søk ville vært en skranke utledet fra en
 * *helt annen* reise — «kom du fram til Skagen i tide» — brukt til å beskjære
 * spørsmålet «kan du komme deg i havn». Den ville kuttet nettopp de lange,
 * ikke-opplagte utveiene R2 finnes for å finne (robusthet.md §4.1: «Tub gis
 * aldri til R2-søk»).
 */
export function r2SearchInput(args: {
  readonly from: LatLon;
  readonly harbour: LatLon;
  readonly departEpochS: number;
  readonly weather: WeatherField;
  readonly mask: NavigabilityMask | undefined;
  readonly boat: BoatModel;
  readonly options: Partial<RouteOptions> | undefined;
  readonly searchOptions: Partial<RouteOptions> | undefined;
  readonly maxIterations: number;
  readonly scalarSearchMode: boolean;
}): RouteInput {
  return {
    start: args.from,
    dest: args.harbour,
    departEpochS: args.departEpochS,
    weather: args.weather,
    mask: args.mask,
    boat: args.boat,
    // Ingen `field`, ingen `tubBoundS` — se doc-kommentaren over. Og ingen
    // EGEN Tub-bound heller (D11.2, vedtatt 2026-09-05): «kan du komme deg i
    // havn» er et eksistensspørsmål, og et anslag skal aldri kutte en
    // kandidat der. Kostnaden bæres til havnefeltet (D8.10) gjør
    // bail-out billig; det er en sikkerhetsdefault, ikke en optimalisering.
    noTubBound: true,
    options: {
      ...(args.options ?? {}),
      ...(args.searchOptions ?? {}),
      maxIterations: args.maxIterations,
      // Nødhavn-anløp er ikke underlagt dagslyskravet.
      requireDaylightArrival: false,
      // Settes **eksplisitt** begge veier: kalleren kan ha slått på
      // skalarmodus for sitt eget medlemssøk (variant A), og fasitens
      // re-søk skal aldri arve det.
      scalarSearchMode: args.scalarSearchMode,
    },
  };
}

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
  const opts = withDefaults(input.options ?? {});
  const backoffS = cfg.backoffS ?? defaultBackoffS(opts.timeStepS);
  const mode: R2SearchMode = cfg.mode ?? "pareto";
  const isCorridorMode = mode === "korridor-skalar";
  const isScalarSearch = mode !== "pareto";

  // Startpunktet: `backoffS` sekunder tilbake i FYSISK tid fra der feilen ble
  // oppdaget. `failure.stepIndex` er antall steg som lå i listen da feilen
  // oppstod, så `stepIndex - 1` er posisjonen båten stod i.
  const startIndex = backoffStartIndex(steps, failure.stepIndex - 1, backoffS);
  const startStep = startIndex < 0 ? undefined : steps[startIndex];
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
    const result = planRoute(
      r2SearchInput({
        from,
        harbour: harbour.position,
        departEpochS,
        weather: input.weather,
        mask: searchMask,
        boat: input.boat,
        options: input.options,
        searchOptions: cfg.searchOptions,
        maxIterations,
        scalarSearchMode: isScalarSearch,
      }),
    );

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
