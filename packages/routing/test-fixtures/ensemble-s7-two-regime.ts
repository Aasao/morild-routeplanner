/**
 * **S-7 — to-regime-blanding.** Måleplanens §6.2, lagt til etter
 * djevelens-advokat-reviewen: perturbasjonsfamilien tidsskyv/rotasjon/
 * skalering er **unimodal**, og en unimodal spredning kan ikke skille
 * variantene fra hverandre der det gjelder mest — når medlemmene er uenige om
 * *hvilken vei* ruten skal gå.
 *
 * Fiksturen er derfor diskret bimodal, med 15 medlemmer i hvert regime:
 *
 *  - **passerer** — fronten trekker SØ med 12–24 kn og har passert
 *    startpunktet etter ~2 t. Resten av seilasen er postfrontal NV 28–32 kn.
 *  - **stopper** — fronten står stille (`c = 0`) eller trekker **retrograd**
 *    (`c = −4`, `−8` kn). Da når den aldri ruten, og hele seilasen er
 *    prefrontal SV 13–15 kn.
 *
 * **Topologien tvinges fram av geometrien.** Midt på strekket ligger
 * «Skagerrakbanken», et syntetisk no-go-areal rett over den direkte linjen,
 * med farbar vei på begge sider. Målt oppførsel (medoidene m07 og m21,
 * korridoravvik **15,8 nm**):
 *
 *  - **stopper** — prefrontal SV 13–15 kn hele veien. Båten ligger bidevind på
 *    TWA ~40° og runder banken på **vestsiden**; ~24 t.
 *  - **passerer** — fronten er over ruten etter ~2 t, og postfrontal NV
 *    28–32 kn gir romskjøts. Båten legger seg **øst** for banken for å ta den
 *    nye vinden på beste vinkel; ~14 t.
 *
 * **Motoren er slått av i denne fiksturen** (`motorThresholdKn: 0`), som i
 * golden-scenariet «ren-kryssetappe». Med testbåtens 7 kn motorfart mot en
 * skrogfart på maks 8,5 kn er motorseiling raskere enn bidevind i alt under
 * ~18 kn vind; da blir kursvalget ren geometri og begge regimene tar den
 * korteste veien rundt banken (målt: korridoravvik 4,4 nm, samme side).
 * Fiksturen skal måle topologi som følge av **seiling**, så motoren står av
 * her. Motor-dimensjonen måles i S-3 og S-8, der den er på.
 *
 * Alle medlemmer har Hs godt under båtens `maxHsM`: her skal ingenting
 * forkastes hardt. S-7 måler **topologi**, S-3 måler feller.
 */
import type { RouteOptions } from "../src/index.js";
import type { EnsembleFixture, EnsembleMember } from "./ensemble.js";
import { memberId } from "./ensemble.js";
import { frontWeather, type FrontWeatherOptions } from "./front-weather.js";
import {
  GOLDEN_DEPART_S,
  SKAGEN,
  SKAGERRAK_LAND,
  SKJAELOY,
} from "./golden-scenarios.js";
import { rectMask, type Rect } from "./synthetic-mask.js";
import { testBoat } from "./test-boat.js";

/**
 * Syntetisk grunne midt i Skagerrak, lagt rett over den direkte linjen
 * Skjæløy→Skagen (som passerer ~10,755° Ø ved 58,4° N). Banken ligger litt
 * øst for linjen, slik at vestre omvei er den korteste.
 */
export const SKAGERRAKBANKEN: Rect = Object.freeze({
  latMin: 58.28,
  latMax: 58.52,
  lonMin: 10.70,
  lonMax: 10.95,
  reason: "Skagerrakbanken (syntetisk)",
});

/** Frontfarter der fronten faktisk passerer ruten, i knop. */
const PASSING_SPEEDS_KN = [12, 15, 18, 21, 24] as const;
/** Frontfarter der fronten stopper (0) eller snur (negativ). */
const STALLED_SPEEDS_KN = [0, -4, -8] as const;

/** Fronten skal ha nådd startpunktet etter så mange timer i «passerer». */
const FRONT_AT_START_H = 2;

/**
 * Styrkenivåer. Som i S-3 skalerer parameteren både den prefrontale og den
 * postfrontale siden, slik at medlemmene i «stopper»-regimet — der den
 * postfrontale luften aldri når ruten — likevel er forskjellige.
 */
const STRENGTHS = [
  { preTwsKn: 13.0, preFromDeg: 232, postTwsKn: 28, postHsM: 2.6 },
  { preTwsKn: 14.0, preFromDeg: 230, postTwsKn: 30, postHsM: 2.9 },
  { preTwsKn: 15.0, preFromDeg: 228, postTwsKn: 32, postHsM: 3.2 },
  { preTwsKn: 13.5, preFromDeg: 231, postTwsKn: 29, postHsM: 2.7 },
  { preTwsKn: 14.5, preFromDeg: 229, postTwsKn: 31, postHsM: 3.0 },
] as const;

const OFFSET_NM = 170;

function baseFront(
  departEpochS: number,
): Omit<
  FrontWeatherOptions,
  | "timingShiftH"
  | "speedKn"
  | "preTwsKn"
  | "preFromDeg"
  | "postTwsKn"
  | "postHsM"
> {
  return {
    reference: SKJAELOY,
    referenceEpochS: departEpochS,
    moveTowardDeg: 135,
    offsetNm: OFFSET_NM,
    widthNm: 15,
    postFromDeg: 298,
    lullTwsKn: 5,
    lullHalfWidthNm: 5,
    swellHsM: 1.8,
    swellFromDeg: 225,
    swellTpS: 8,
    swellPersistH: 9,
    postWaveFromDeg: 300,
    postTpS: 5.5,
    validFromS: departEpochS - 3600,
    validToS: departEpochS + 3 * 24 * 3600,
  };
}

export const S7_OPTIONS: Partial<RouteOptions> = Object.freeze({
  headingStepDeg: 10,
  timeStepS: 3600,
});

export type S7Regime = "passerer" | "stopper";

export interface S7Options {
  readonly departEpochS?: number;
}

export function s7TwoRegimeEnsemble(options: S7Options = {}): EnsembleFixture {
  const departEpochS = options.departEpochS ?? GOLDEN_DEPART_S;
  const base = baseFront(departEpochS);

  const members: EnsembleMember[] = [];
  const push = (
    regime: S7Regime,
    speedKn: number,
    speedIndex: number,
    levelIndex: number,
  ): void => {
    const strength = STRENGTHS[levelIndex]!;
    // «Passerer»: tidsskyvet velges slik at fronten når startpunktet etter
    // FRONT_AT_START_H timer uansett frontfart. «Stopper»: ikke noe skyv —
    // fronten ligger 170 nm unna og blir der (eller trekker vekk).
    const timingShiftH =
      regime === "passerer" ? OFFSET_NM / speedKn - FRONT_AT_START_H : 0;
    // I «stopper»-regimet når den postfrontale luften aldri ruten, så
    // frontfarten alene ville gitt tre bit-identiske kopier av hvert
    // styrkenivå. Vi lar derfor frontfarten også dreie og styrke varmsektor-
    // flyten litt (0,35 kn og 0,8° per trinn) — samme kobling som at en
    // stillestående eller retrograd front hører til et annet trykkmønster.
    const preTwsKn =
      strength.preTwsKn + (regime === "stopper" ? 0.35 * speedIndex : 0);
    const preFromDeg =
      strength.preFromDeg + (regime === "stopper" ? 0.8 * speedIndex : 0);
    const index = members.length;
    members.push({
      id: memberId(index),
      index,
      params: {
        regime,
        frontSpeedKn: speedKn,
        strengthLevel: levelIndex,
        timingShiftH: Math.round(timingShiftH * 1000) / 1000,
        preTwsKn,
        preFromDeg,
        postTwsKn: strength.postTwsKn,
      },
      weather: frontWeather({
        ...base,
        speedKn,
        timingShiftH,
        preTwsKn,
        preFromDeg,
        postTwsKn: strength.postTwsKn,
        postHsM: strength.postHsM,
      }),
    });
  };

  PASSING_SPEEDS_KN.forEach((speedKn, speedIndex) => {
    for (let level = 0; level < 3; level++) {
      push("passerer", speedKn, speedIndex, level);
    }
  });
  STALLED_SPEEDS_KN.forEach((speedKn, speedIndex) => {
    for (let level = 0; level < 5; level++) {
      push("stopper", speedKn, speedIndex, level);
    }
  });

  return {
    name: "s7-to-regime",
    purpose:
      "Diskret bimodalt ensemble: 15 medlemmer der fronten passerer ruten, " +
      "15 der den står stille eller trekker retrograd. Regimene favoriserer " +
      "hver sin side av Skagerrakbanken — topologisk splitt, ikke bare " +
      "kvantitativ spredning.",
    start: SKJAELOY,
    dest: SKAGEN,
    departEpochS,
    mask: rectMask({ noGo: [...SKAGERRAK_LAND, SKAGERRAKBANKEN] }),
    boat: testBoat({ motorThresholdKn: 0 }),
    options: S7_OPTIONS,
    // Kontrollfeltet ligger mellom regimene: fronten trekker med 12 kn uten
    // tidsskyv og rekker startpunktet først etter ~14 t. Kandidatruten seiles
    // altså først prefrontalt og så postfrontalt — den er ikke født i noen av
    // de to modiene, og skal ikke ha hjemmebanefordel i noen av dem.
    control: frontWeather({
      ...base,
      speedKn: 12,
      timingShiftH: 0,
      preTwsKn: 14,
      preFromDeg: 230,
      postTwsKn: 30,
      postHsM: 2.9,
    }),
    members,
    // Ingen medlemmer kan forkastes hardt: Hs ≤ 3,2 m mot båtens 4 m.
    hardRejectionMemberIds: [],
  };
}

/** Medoidene testene og målingen bruker som representant for hvert regime. */
export const S7_MEDOIDS: Readonly<Record<S7Regime, string>> = Object.freeze({
  // c = 18 kn, midterste styrkenivå.
  passerer: memberId(7),
  // c = −4 kn, midterste styrkenivå.
  stopper: memberId(21),
});
