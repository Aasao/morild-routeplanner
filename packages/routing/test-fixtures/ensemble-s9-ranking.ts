/**
 * **S-9 — rangeringsfikstur (`docs/specs/robusthet.md` §5.4, D8.9).**
 *
 * Bygget PÅ S-7-generatoren (`ensemble-s7-two-regime.ts`): samme geometri
 * (Skjæløy→Skagen), samme syntetiske grunne («Skagerrakbanken»), samme
 * frontmodell (`front-weather.ts`) og samme båt/opsjoner — men med to
 * FORSKJELLIGE avganger, konstruert for å skille to rangeringsnøkler
 * (`durationP50S` og `durationP90S`, §4.2.1/§4.3) fra hverandre:
 *
 * - **Avgang A** — 25 «raske» + 5 «sene» medlemmer, ALLE bygget med
 *   «fronten alt passert HELE ruten fra `t = 0`»-oppskriften (stor negativ
 *   `offsetNm`, se `buildDepartureB`s kommentar for geometrien), bare med
 *   ulik vindstyrke: de 25 raske i det empirisk raskeste båndet for denne
 *   ruten/masken/båten (24–28 kn), de 5 sene i et empirisk MYE tregere
 *   (men fortsatt trygt gjennomførbart) bånd (13–15 kn). Median (P50,
 *   k=⌈50·30/100⌉=15) faller innenfor de 25 raske; P90 (k=⌈90·30/100⌉=27)
 *   faller innenfor de 5 sene (25 < 27 ≤ 30). A får altså en RASK median
 *   og en DÅRLIG (høy) P90.
 * - **Avgang B** — samme oppskrift for ALLE 30 medlemmer, i et bånd (~17–18
 *   kn) som empirisk ligger MELLOM As to bånd: tregere enn As raske gruppe,
 *   men raskere enn As sene hale. Ingen medlemmer sitter fast prefrontalt —
 *   B får en jevn, moderat median OG en jevn, moderat P90 (ingen sen-hale).
 *
 * **Hvorfor «alt passert»-oppskriften for ALLE grupper, ikke S-7s ekte
 * to-regime-splitt (front som faktisk passerer/står stille)?** Et
 * grundig empirisk forsøk (`_scratch*.damage.test.ts`, slettet før commit —
 * se tuning-merknaden ved `A_SLOW_TWS_LEVELS_KN`) viste at S-7s ekte
 * «stopper»-medlemmer (prefrontal vind, fronten når aldri fram) i DAGENS
 * motor ender `reachesDestination: false` — de blir `inconclusive`
 * («dekning»), ikke `feasible` med lang varighet. Det er ikke en feil i
 * denne fiksturen; det er hvordan `classifyMember` (§3.2) i dag leser
 * `coverage.weather === "partial"` (som også oppstår på grener som
 * FORKASTES underveis i søket, ikke bare på den returnerte ruten). En «sen
 * hale» bygget på S-7s ekte stopper-regime ville derfor gjort avgang A
 * `nF < 30` og endret hvilken rang P90 lander på — presist den typen
 * avhengighet av søkeinternaler denne fiksturen skal unngå. Løsningen: bruk
 * SAMME, robust `reachesDestination: true`-oppskrift for alle 30×2
 * medlemmer, og la KUN vindstyrken variere.
 *
 * **Forhåndsregistrert (D8.9, før S-9 er kjørt gjennom motoren):**
 *
 *     argmin P50 = A     (As 25 raske medlemmer slår Bs jevnt moderate fart)
 *     argmin P90 = B     (Bs jevne flåte slår As 5-medlemmers hale)
 *
 * Aksept (§5.4): rangeringen (`rankDepartures`, `packages/robustness`) skal
 * gi dette resultatet, og være invariant under leave-one-out for hvert av
 * de 30 medlemmene i BEGGE avganger (`ranking.damage.test.ts`).
 *
 * Ren og deterministisk: ingen RNG, ingen klokke, ingen I/O — som resten av
 * testgrunnlaget.
 */
import type { RouteOptions } from "../src/index.js";
import type { EnsembleFixture, EnsembleMember } from "./ensemble.js";
import { memberId } from "./ensemble.js";
import { frontWeather, type FrontWeatherOptions } from "./front-weather.js";
import { GOLDEN_DEPART_S, SKAGEN, SKAGERRAK_LAND, SKJAELOY } from "./golden-scenarios.js";
import { SKAGERRAKBANKEN } from "./ensemble-s7-two-regime.js";
import { rectMask } from "./synthetic-mask.js";
import { testBoat } from "./test-boat.js";

/** Samme søkeoppløsning som S-7 (full oppløsning, ADR-0005). */
export const S9_OPTIONS: Partial<RouteOptions> = Object.freeze({
  headingStepDeg: 10,
  timeStepS: 3600,
});

/**
 * Fronten er allerede langt bak startpunktet ved avgang: en stor negativ
 * `offsetNm` gjør `d = c·(t+Δt) − offset − n·(x−x₀) > 0` (postfrontalt) for
 * ALLE punkter langs ruten og for ALLE tider i vinduet — se
 * `front-weather.ts`s geometrikommentar. `speedKn`/`timingShiftH` er
 * irrelevante så lenge margen er stor nok (1000 nm mot en ~170 nm rute).
 */
const PASSED_OFFSET_NM = -1000;

/**
 * `postHsM` som funksjon av `postTwsKn`, brukt for ALLE grupper i S-9 —
 * samme formel som ble brukt i parametersveipet som fant de tre båndene
 * under, så Hs holder seg innenfor det empirisk sjekkede vinduet.
 */
function windDependentHsM(postTwsKn: number): number {
  return 2.0 + (postTwsKn - 22) * 0.08;
}

/**
 * Avgang As 25 raske medlemmer: empirisk RASKESTE bånd funnet for denne
 * ruten/masken/båten (~44 000–44 300 s). Duration er IKKE monoton i
 * vindstyrke her — 30+ kn er faktisk TREGERE (se `A_SLOW_TWS_LEVELS_KN`s
 * kommentar) — dette båndet er funnet empirisk, ikke antatt.
 */
const A_FAST_TWS_LEVELS_KN = [24, 25, 26, 27, 28] as const;

/**
 * Avgang As 5 sene medlemmer.
 *
 * **Tuning-merknad (empirisk, tre forsøk før dette landet):**
 *
 * 1. S-7s ekte «passerer»-oppskrift (front ankommer etter et par timer,
 *    med overgang+lull) med sterk vind (28–32 kn) ga `durationP50S(A) =
 *    51 693 s` mot `durationP50S(B) = 44 175 s` — B slo A på median, fordi
 *    As «raske» medlemmer likevel måtte gjennom en prefrontal/lull-
 *    forsinkelse først.
 * 2. Samme «alt passert»-oppskrift som B, men 30–34 kn for den raske
 *    gruppen: fortsatt tapte A (47 734 mot 44 175 s). Et parametersveip
 *    viste at varigheten IKKE er monoton i vindstyrke: det finnes et smalt
 *    RASKERE bånd rundt 24–28 kn (~44 000–44 300 s), mens 30+ kn er
 *    tregere (47 700+ s) eller ikke når fram (bølgehøyde/derating ved sterk
 *    vind, jf. `windDependentHsM`). Dette ble `A_FAST_TWS_LEVELS_KN`.
 * 3. For den SENE gruppen ble S-7s ekte «stopper»-regime (front stille/
 *    retrograd, prefrontal for alltid) først forsøkt — S-7s egen
 *    dokumentasjon sier «~24 t». Kjørt gjennom DAGENS motor ga det derimot
 *    `reachesDestination: false` (`inconclusive`, «dekning») — bekreftet
 *    også med S-7s egen medoid (`S7_MEDOIDS.stopper`, samme resultat). Et
 *    medlem som ikke klassifiseres `feasible` faller helt ut av
 *    persentil-beregningen (§4.2.1), som ville endret HVOR P90 lander —
 *    nøyaktig den typen skjørhet denne fiksturen skal unngå. Løsningen:
 *    bruk SAMME «alt passert»-oppskrift som resten av S-9, men i et bånd
 *    empirisk MYE tregere enn både As raske gruppe og Bs bånd (13–15 kn,
 *    ~51 200–52 150 s — se `B_TWS_LEVELS_KN` for hvorfor 17–18 kn ikke
 *    holder som «sen» bånd: for nær Bs eget bånd til å gi margin under LOO).
 *
 * Verifisert i `ranking.damage.test.ts`: `durationP50S(A) < durationP50S(B)`
 * og `durationP90S(B) < durationP90S(A)`, invariant under leave-one-out.
 */
const A_SLOW_TWS_LEVELS_KN = [13, 13.5, 14, 14.5, 15] as const;

/**
 * Avgang Bs 30 medlemmer: samme oppskrift, i et bånd som empirisk ligger
 * MELLOM As to bånd (tregere enn 24–28 kn, klart raskere enn As 13–15 kn-
 * hale) — 6 nivåer × 5 mindre variasjoner (kun kosmetisk etter
 * frontpassasjen, siden hele ruten er postfrontal fra `t = 0`), for et
 * 30-medlemmers utvalg uten to bit-identiske vær.
 */
const B_TWS_LEVELS_KN = [17.0, 17.2, 17.4, 17.6, 17.8, 18.0] as const;
const MINOR_VARIANTS = [0, 1, 2, 3, 4] as const;

function baseFrontOptions(
  departEpochS: number,
): Omit<
  FrontWeatherOptions,
  "timingShiftH" | "speedKn" | "offsetNm" | "preTwsKn" | "preFromDeg" | "postTwsKn" | "postHsM"
> {
  return {
    reference: SKJAELOY,
    referenceEpochS: departEpochS,
    moveTowardDeg: 135,
    widthNm: 15,
    postFromDeg: 298,
    lullTwsKn: 5,
    lullHalfWidthNm: 5,
    swellHsM: 1.8,
    swellFromDeg: 225,
    swellTpS: 8,
    // Full værdekning (D11.1, vedtatt 2026-09-05): uten strømfelt ville alle
    // medlemmer vært inkonklusive «dekning-felt», og F4.2-tallene ville
    // ikke hatt noe å regne på. Stille strøm er en bevisst, dokumentert
    // forenkling for rangeringsfiksturen — ikke en påstand om Skagerrak.
    current: { u: 0, v: 0 },
    swellPersistH: 9,
    postWaveFromDeg: 300,
    postTpS: 5.5,
    validFromS: departEpochS - 3600,
    validToS: departEpochS + 3 * 24 * 3600,
  };
}

/** Delt maske/geometri for begge avganger (identisk med S-7). */
function sharedMask() {
  return rectMask({ noGo: [...SKAGERRAK_LAND, SKAGERRAKBANKEN] });
}

/** Ett medlem i «alt passert»-oppskriften — samme oppskrift for A og B, kun `postTwsKn` og `regime` skiller. */
function pushPassedMember(
  members: EnsembleMember[],
  base: ReturnType<typeof baseFrontOptions>,
  regime: string,
  postTwsKn: number,
  variant: number,
): void {
  const index = members.length;
  const preTwsKn = 14 + variant * 0.1; // kosmetisk — aldri sett, fronten er alt passert.
  const preFromDeg = 230 + variant * 0.5;
  members.push({
    id: memberId(index),
    index,
    params: { regime, postTwsKn, variant },
    weather: frontWeather({
      ...base,
      speedKn: 15,
      offsetNm: PASSED_OFFSET_NM,
      timingShiftH: 0,
      preTwsKn,
      preFromDeg,
      postTwsKn,
      postHsM: windDependentHsM(postTwsKn),
    }),
  });
}

/** Avgang A: 25 raske + 5 sene medlemmer (§5.4 — se tuning-merknadene over). */
function buildDepartureA(departEpochS: number): EnsembleFixture {
  const base = baseFrontOptions(departEpochS);
  const members: EnsembleMember[] = [];

  A_FAST_TWS_LEVELS_KN.forEach((postTwsKn) => {
    MINOR_VARIANTS.forEach((variant) => pushPassedMember(members, base, "s9-a-rask", postTwsKn, variant));
  });
  A_SLOW_TWS_LEVELS_KN.forEach((postTwsKn) => pushPassedMember(members, base, "s9-a-sen", postTwsKn, 0));

  return {
    name: "s9-avgang-a-hale",
    purpose:
      "S-9 (§5.4, D8.9): 25 raske + 5 sene medlemmer. Rask median (P50 i den " +
      "raske gruppen), dårlig P90 (i den sene halen). Forhåndsregistrert " +
      "argmin P50 = A.",
    start: SKJAELOY,
    dest: SKAGEN,
    departEpochS,
    mask: sharedMask(),
    boat: testBoat({ motorThresholdKn: 0 }),
    options: S9_OPTIONS,
    control: frontWeather({
      ...base,
      speedKn: 15,
      offsetNm: PASSED_OFFSET_NM,
      timingShiftH: 0,
      preTwsKn: 14,
      preFromDeg: 230,
      postTwsKn: 26,
      postHsM: windDependentHsM(26),
    }),
    members,
    hardRejectionMemberIds: [],
  };
}

/** Avgang B: alle 30 medlemmer i ett jevnt, moderat bånd (§5.4). */
function buildDepartureB(departEpochS: number): EnsembleFixture {
  const base = baseFrontOptions(departEpochS);
  const members: EnsembleMember[] = [];

  B_TWS_LEVELS_KN.forEach((postTwsKn) => {
    MINOR_VARIANTS.forEach((variant) => pushPassedMember(members, base, "s9-b-jevn", postTwsKn, variant));
  });

  return {
    name: "s9-avgang-b-alle-postfrontalt",
    purpose:
      "S-9 (§5.4, D8.9): alle 30 medlemmer i et jevnt, moderat bånd (~17–18 " +
      "kn) — mellom As raske (24–28 kn) og As sene hale (13–15 kn). Jevn " +
      "median OG jevn P90, INGEN sen hale. Forhåndsregistrert argmin P90 = B.",
    start: SKJAELOY,
    dest: SKAGEN,
    departEpochS,
    mask: sharedMask(),
    boat: testBoat({ motorThresholdKn: 0 }),
    options: S9_OPTIONS,
    control: frontWeather({
      ...base,
      speedKn: 15,
      offsetNm: PASSED_OFFSET_NM,
      timingShiftH: 0,
      preTwsKn: 14,
      preFromDeg: 230,
      postTwsKn: 17.5,
      postHsM: windDependentHsM(17.5),
    }),
    members,
    hardRejectionMemberIds: [],
  };
}

export interface S9RankingFixture {
  readonly departureA: EnsembleFixture;
  readonly departureB: EnsembleFixture;
}

export interface S9Options {
  /** Avgang As avgangstid. Avgang B legges 1 t senere (F4.5s avgangsvindu). */
  readonly departEpochS?: number;
}

export function s9RankingFixture(options: S9Options = {}): S9RankingFixture {
  const departEpochSA = options.departEpochS ?? GOLDEN_DEPART_S;
  const departEpochSB = departEpochSA + 3600;
  return {
    departureA: buildDepartureA(departEpochSA),
    departureB: buildDepartureB(departEpochSB),
  };
}

/** D8.9s forhåndsregistrerte forventning — se toppkommentaren. */
export const S9_EXPECTED_ARGMIN_P50: "A" | "B" = "A";
export const S9_EXPECTED_ARGMIN_P90: "A" | "B" = "B";
