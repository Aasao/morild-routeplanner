/**
 * **S-3 — frontpassasje med timing-spredning.** Måleplanens viktigste fikstur
 * (`docs/research/maaleplan-e1-2026-08-31.md` §2 og §6.3): uten den er
 * felle-deteksjon utestet.
 *
 * Geometri: v1s referansestrekk Skjæløy → Skagen, 84 nm over åpent Skagerrak.
 * Været er den analytiske kaldfronten i `front-weather.ts`, kalibrert mot
 * v1-ankeret 1. august 2026 (kun vindparametrene — se den filen).
 *
 * **To parametre varieres uavhengig** (§6.3), i en fast tabell uten RNG:
 *
 *  1. **timing** — seks tidsskyv (+9, +6, +3, −3, −6, −9 t). Positivt skyv =
 *     fronten kommer tidligere. Med `offsetNm = 170` og `c = 18 kn` treffer
 *     fronten båten omtrent slik (kontrollruten, ~6 kn framdrift):
 *
 *     | Δt | fronten treffer båten |
 *     |---|---|
 *     | +9 t | ~0,6 t etter avgang |
 *     | +6 t | ~4,3 t |
 *     | +3 t | ~8,1 t |
 *     | −3 t | ~15,7 t (ved/etter ankomst) |
 *     | −6 t | ~19,9 t (aldri under seilasen) |
 *     | −9 t | ~24,1 t (aldri) |
 *
 *  2. **postfrontal styrke/Hs** — seks nivåer, der nivå 4 (Hs 4,6 m) ligger
 *     over `testBoat().maxHsM = 4` og gir **hard forkastelse**.
 *
 * Fordi de to varieres uavhengig, er felle-settet *ikke* en terskel-blokk:
 * nivå 4 forekommer både der fronten rekker båten (Δt = +9, +6, +3) og der den
 * aldri gjør det (Δt = −9). Det siste medlemmet er den innebygde kontrollen
 * mot falske positive — dødelig postfrontal sjø som ruten aldri møter, skal
 * ikke gi felle.
 *
 * Merk at nivå 4 har TWS 34 kn, altså **under** båtens 35 kn: fella er
 * utvetydig sjøgang (Hs > maxHs), ikke vind. Det gjør avvisningsårsaken
 * entydig når felle-settet skal tolkes.
 *
 * ## Navigasjonsfellen (§8.2, lagt til 2026-08-31 FØR kjøring)
 *
 * Medlem **m24** er byttet ut med et eget felt (`nav-trap.ts`): der er ikke
 * feilen det interessante, men **utveien**. Nærmeste nødhavner er
 * værdiskvalifisert, den rette linjen til den ene anløpbare havnen er stengt av
 * en TSS-retningsregel, og den reelle utveien er en 9,6 nm bred omvei som
 * starter med å seile *bort* fra havnen. Fullt Pareto-re-søk finner den på
 * 4,35 t; et korridorbegrenset re-søk i 4 nm rør gjør det ikke. Uten dette
 * medlemmet hadde felle-kriteriet i §4 ingen diskrimineringskraft mellom
 * variantene — hele felle-settet oppstod via delt `checkHardNode`-kode.
 *
 * Positiv kontroll: `hardRejectionMemberIds` (fire medlemmer med Hs > maxHs,
 * pluss navigasjonsfelle-medlemmet).
 * Negativ kontroll: `s3FrontEnsemble({ withTrapMembers: false })` — samme
 * fikstur der nivå 4 er byttet mot nivå 3 (Hs 3,7 m), altså ingen hard
 * forkastelse noe sted.
 *
 * ## Målt oppførsel 2026-08-31 (standardavgang, `ensemble-fixtures.test.ts`)
 *
 * - Kontrollruten: 14,3 t / 85,2 nm, fronten passerer båten rundt 12 t.
 * - Ankomstspredning over medlemmene (evaluering av kontrollruten): 12,6–15,7 t.
 * - Harde forkastelser: **m04 @ 2,0 t**, **m09 @ 5,0 t**, **m14 @ 9,4 t** —
 *   alle `boatLimits` med «Hs over båtens grense» — pluss **m24 @ 2,2 t**
 *   (navigasjonsfellen, egen mekanisme, se under). m29 har samme dødelige
 *   postfrontale sjø, men fronten rekker aldri ruten: den er gjennomførbar.
 * - R2 (fullt Pareto-re-søk, 6 t, interim havneliste): felle-settet er
 *   **{m04, m09, m14}** for frontmedlemmene. m04 er marginal og derfor
 *   verdifull — re-søket stopper 1,08 nm fra Skjæløy. Navigasjonsfelle-
 *   medlemmet m24 er **ikke** en felle under fasiten (utveien finnes), men er
 *   det under variant Bs korridor-re-søk — se under.
 * - Sanity (steg3-planens krav): forward-søk fra rutens midtpunkt gir 6,2–6,5 t
 *   i alle 27 øvrige medlemmer, men `reached: false` (`noExpandableLabels`) i
 *   m04, m09 og m14. **Fella er forkastelse, ikke treg seiling.**
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
import { navTrapWeather, SKAGERRAK_LANE } from "./nav-trap.js";
import { rectMask } from "./synthetic-mask.js";
import { testBoat } from "./test-boat.js";

/** Tidsskyv i timer. Positivt = fronten kommer tidligere (§6.3: ±3–9 t). */
const TIMING_SHIFTS_H = [9, 6, 3, -3, -6, -9] as const;

/**
 * Frontens styrke. Nivå 4 er det dødelige (Hs over båtens `maxHsM = 4`);
 * nivå 5 er et mellomnivå som finnes for at hver timing-rad skal kunne ha
 * fem *forskjellige* styrker uten at nivå 4 må brukes.
 *
 * Styrkeparameteren skalerer også den prefrontale strømningen litt: 13–15,2 kn
 * (innenfor oppskriftens 12–16 kn) og 228–232° retning. Det er fysisk riktig —
 * en kraftigere front har også kraftigere og mer bakket varmsektorflyt — og
 * det er nødvendig for at medlemmene der fronten aldri rekker båten
 * (Δt = −6, −9) skal skille seg fra hverandre i det hele tatt. Uten det ville
 * ti av tretti medlemmer hatt bit-identisk utfall, og P50/P90 ville målt en
 * degenerert fordeling.
 */
const STRENGTHS = [
  { preTwsKn: 13.0, preFromDeg: 232, postTwsKn: 25, postHsM: 2.4 },
  { preTwsKn: 13.6, preFromDeg: 231, postTwsKn: 28, postHsM: 2.9 },
  { preTwsKn: 14.2, preFromDeg: 230, postTwsKn: 31, postHsM: 3.3 },
  { preTwsKn: 14.8, preFromDeg: 229, postTwsKn: 33, postHsM: 3.7 },
  { preTwsKn: 15.2, preFromDeg: 228, postTwsKn: 34, postHsM: 4.6 },
  { preTwsKn: 14.5, preFromDeg: 230.5, postTwsKn: 30, postHsM: 3.1 },
] as const;

/** Indeksen på det dødelige styrkenivået. */
const LETHAL_STRENGTH = 4;

/**
 * Fast to-parameter-tabell: rad = tidsskyv, kolonne = medlem innen raden,
 * verdi = styrkenivå. Hver rad har fem forskjellige nivåer, og nivå 4
 * forekommer i radene +9, +6, +3 og −9 — tre der fronten rekker båten og én
 * der den ikke gjør det.
 */
const STRENGTH_TABLE: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4], // Δt = +9
  [1, 2, 3, 5, 4], // Δt = +6
  [2, 3, 5, 0, 4], // Δt = +3
  [3, 5, 0, 1, 2], // Δt = −3
  [5, 0, 1, 2, 3], // Δt = −6
  [0, 2, 3, 5, 4], // Δt = −9
];

/**
 * Medlemmet som bærer **navigasjonsfellen** (måleplanens §8.2). Indeksen er
 * valgt i raden Δt = −6, der fronten aldri rekker ruten: medlemmet var før
 * dette et av de fem uinteressante «ingenting skjer»-medlemmene, og
 * frontgeometrien har derfor ingenting å si når det byttes ut.
 */
export const S3_NAV_TRAP_INDEX = 24;
export const S3_NAV_TRAP_ID = memberId(S3_NAV_TRAP_INDEX);

export interface S3FrontOptions {
  readonly departEpochS?: number;
  /**
   * `false` ⇒ **negativ kontroll**: styrkenivå 4 byttes mot nivå 3,
   * navigasjonsfelle-medlemmet byttes tilbake til sitt frontfelt, og ingen
   * medlemmer kan gi hard forkastelse. Måleplanens §6.3 krever begge.
   */
  readonly withTrapMembers?: boolean;
}

/** Grunnparametrene alle medlemmene deler. Kalibrering: se `front-weather.ts`. */
function baseFront(
  departEpochS: number,
): Omit<
  FrontWeatherOptions,
  "timingShiftH" | "preTwsKn" | "preFromDeg" | "postTwsKn" | "postHsM"
> {
  return {
    reference: SKJAELOY,
    referenceEpochS: departEpochS,
    // Klassisk kaldfront over Skagerrak: linjen ligger NV–SØ og trekker SØ.
    moveTowardDeg: 135,
    speedKn: 18,
    offsetNm: 170,
    widthNm: 15,
    // 68° dreining — ankerets 65–70°.
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

export const S3_OPTIONS: Partial<RouteOptions> = Object.freeze({
  headingStepDeg: 10,
  timeStepS: 3600,
});

/** Styrkenivået medlem `index` bruker, etter eventuell felle-fjerning. */
function levelOf(index: number, withTraps: boolean): number {
  const raw = STRENGTH_TABLE[Math.floor(index / 5)]![index % 5]!;
  return !withTraps && raw === LETHAL_STRENGTH ? 3 : raw;
}

/**
 * De **eksakte** frontparametrene medlem `index` er bygget av.
 *
 * Eksponert slik at tester og analyse kan lese geometrien uten å kopiere
 * tallene — en kopi ville før eller siden drevet fra fiksturen.
 */
export function s3FrontOptionsFor(
  index: number,
  options: S3FrontOptions = {},
): FrontWeatherOptions {
  const departEpochS = options.departEpochS ?? GOLDEN_DEPART_S;
  const strength = STRENGTHS[levelOf(index, options.withTrapMembers ?? true)]!;
  return {
    ...baseFront(departEpochS),
    timingShiftH: TIMING_SHIFTS_H[Math.floor(index / 5)]!,
    preTwsKn: strength.preTwsKn,
    preFromDeg: strength.preFromDeg,
    postTwsKn: strength.postTwsKn,
    postHsM: strength.postHsM,
  };
}

export function s3FrontEnsemble(options: S3FrontOptions = {}): EnsembleFixture {
  const departEpochS = options.departEpochS ?? GOLDEN_DEPART_S;
  const withTraps = options.withTrapMembers ?? true;
  const base = baseFront(departEpochS);

  const members: EnsembleMember[] = [];
  const hardRejectionMemberIds: string[] = [];

  for (let index = 0; index < 30; index++) {
    const level = levelOf(index, withTraps);
    const front = s3FrontOptionsFor(index, options);
    const id = memberId(index);

    // Navigasjonsfelle-medlemmet (§8.2): eget felt, ikke frontfeltet. Det er
    // det eneste medlemmet der variantene kan være uenige om *utveien*.
    if (withTraps && index === S3_NAV_TRAP_INDEX) {
      hardRejectionMemberIds.push(id);
      members.push({
        id,
        index,
        params: {
          mekanisme: "navigasjonsfelle",
          twsKn: 32,
          twdDeg: 250,
          hsTerskelLat: 58.931,
          utveiHavn: "Fredrikstad",
        },
        weather: navTrapWeather({
          validFromS: departEpochS - 3600,
          validToS: departEpochS + 3 * 24 * 3600,
        }),
      });
      continue;
    }

    if (level === LETHAL_STRENGTH) hardRejectionMemberIds.push(id);
    members.push({
      id,
      index,
      params: {
        timingShiftH: front.timingShiftH,
        strengthLevel: level,
        preTwsKn: front.preTwsKn,
        preFromDeg: front.preFromDeg,
        postTwsKn: front.postTwsKn,
        postHsM: front.postHsM,
      },
      weather: frontWeather(front),
    });
  }

  return {
    name: withTraps ? "s3-frontpassasje" : "s3-frontpassasje-uten-feller",
    purpose:
      "Kaldfront over Skjæløy→Skagen med to uavhengige parametre " +
      "(timing × postfrontal styrke). Felle-deteksjon: fella skapes av HARD " +
      "forkastelse (Hs > maxHs), ikke av treg seiling." +
      (withTraps ? "" : " NEGATIV KONTROLL: ingen medlemmer kan forkastes."),
    start: SKJAELOY,
    dest: SKAGEN,
    departEpochS,
    // Leden er inert for alt S-3 gjorde før — kontrollruten seiler med
    // trafikkretningen, og felle-settet {m04, m09, m14} er uendret (målt).
    // Den finnes for navigasjonsfellen, der utveien nordover er ulovlig.
    mask: rectMask({ noGo: SKAGERRAK_LAND, tss: [SKAGERRAK_LANE] }),
    boat: testBoat(),
    options: S3_OPTIONS,
    // Kontrollfeltet: ingen tidsskyv, moderat postfrontal styrke. Fronten
    // treffer kontrollruten omtrent midtveis (~12 t).
    control: frontWeather({
      ...base,
      timingShiftH: 0,
      // v1-ankeret: prefrontal S–SSW, skalert til oppskriftens 12–16 kn.
      preTwsKn: 14,
      preFromDeg: 230,
      postTwsKn: STRENGTHS[1]!.postTwsKn,
      postHsM: STRENGTHS[1]!.postHsM,
    }),
    members,
    hardRejectionMemberIds,
  };
}
