/**
 * Golden-scenarioene (docs/specs/rutemotor.md §8.2).
 *
 * Hvert scenario er en **frossen, deterministisk input**: syntetiske felt med
 * fast seed, syntetisk maske av rektangler, og en fast avgangstid. Ingenting
 * her henter data, og ingenting avhenger av klokka.
 *
 * Feltene er syntetiske i fase 2 (bekreftet 2026-08-30, spec §9 spm. 11) og
 * byttes til ekte MEPS-uttrekk når F2.5s frosne testpakke lander. Da er det
 * *inputen* som byttes, ikke harnessen.
 *
 * Geografien er ekte: Skjæløy (Hvaler) → Skagen er v1s referansestrekk.
 * Land- og TSS-geometrien er en grov, men fast, karikatur — poenget er
 * regresjon mot oss selv, ikke navigasjonsrealisme.
 */
import type { RouteInput } from "../src/index.js";
import { rectMask, type Rect, type TssCorridor } from "./synthetic-mask.js";
import { constantWeather, syntheticField } from "./synthetic-weather.js";
import { testBoat } from "./test-boat.js";

/** Skjæløy, Hvaler — v1s referansestart. */
export const SKJAELOY = { lat: 59.1032, lon: 10.9327 };
/** Skagen, Danmark. */
export const SKAGEN = { lat: 57.7211, lon: 10.5836 };

/** 2026-06-15 04:00:00 UTC. Fast avgang, aldri fra klokka. */
export const GOLDEN_DEPART_S = 1781668800;

/** 2026-11-15 16:00:00 UTC — mørk årstid, for natt-/dagslysscenarioene. */
export const GOLDEN_DEPART_WINTER_S = 1794844800;

/**
 * Skagerrak-siden av Skjæløy → Skagen: den svenske vestkysten i øst og
 * Jyllands nordspiss i vest, slik at det finnes en åpen korridor imellom.
 */
export const SKAGERRAK_LAND: readonly Rect[] = [
  {
    latMin: 57.4,
    latMax: 59.4,
    lonMin: 11.35,
    lonMax: 12.6,
    reason: "Bohuslän",
  },
  { latMin: 56.6, latMax: 57.72, lonMin: 8.0, lonMax: 10.5, reason: "Jylland" },
  { latMin: 59.25, latMax: 60.2, lonMin: 9.5, lonMax: 11.4, reason: "Østfold" },
];

/** TSS-en ved Skagen: trafikken går mot nordøst, inn i Kattegat. */
const SKAGEN_TSS: readonly TssCorridor[] = [
  {
    latMin: 57.72,
    latMax: 57.95,
    lonMin: 10.55,
    lonMax: 11.15,
    axisDeg: 45,
    reason: "Skagen TSS",
  },
];

/** Trangt skjærgårdsbilde: en rekke skjær med smale sund imellom. */
const BOHUSLAN_SKERRIES: readonly Rect[] = [
  {
    latMin: 58.2,
    latMax: 58.26,
    lonMin: 11.05,
    lonMax: 11.22,
    reason: "skjær A",
  },
  {
    latMin: 58.28,
    latMax: 58.34,
    lonMin: 11.12,
    lonMax: 11.3,
    reason: "skjær B",
  },
  {
    latMin: 58.36,
    latMax: 58.42,
    lonMin: 11.02,
    lonMax: 11.2,
    reason: "skjær C",
  },
  {
    latMin: 58.3,
    latMax: 58.35,
    lonMin: 10.88,
    lonMax: 10.98,
    reason: "skjær D",
  },
];

export interface GoldenScenario {
  readonly name: string;
  /** Hva scenariet skal fange — leses av den som får en uforklart diff. */
  readonly purpose: string;
  readonly input: RouteInput;
}

function skagerrakWeather(departS: number) {
  return syntheticField({
    seed: 20260615,
    baseSpeedKn: 12,
    baseFromDeg: 240,
    speedVariationKn: 4,
    dirVariationDeg: 35,
    baseHsM: 1.0,
    validFromS: departS - 3600,
    validToS: departS + 8 * 24 * 3600,
  });
}

export function goldenScenarios(): readonly GoldenScenario[] {
  return [
    {
      name: "skjaeloy-skagen-apent",
      purpose:
        "v1s referansestrekk over Skagerrak, slør, uten land i veien. Fanger " +
        "grunnleggende fart, bautstraff og totaler.",
      input: {
        start: SKJAELOY,
        dest: SKAGEN,
        departEpochS: GOLDEN_DEPART_S,
        weather: skagerrakWeather(GOLDEN_DEPART_S),
        mask: rectMask({ noGo: SKAGERRAK_LAND }),
        boat: testBoat(),
        options: { headingStepDeg: 6, timeStepS: 3600 },
      },
    },
    {
      name: "bohuslan-trange-sund",
      purpose:
        "Skjærgård med smale sund. Fanger maskeavhengighet og hvordan " +
        "sektor-tilstandsrommet oppfører seg der det er verst.",
      input: {
        start: { lat: 58.15, lon: 11.15 },
        dest: { lat: 58.48, lon: 11.05 },
        departEpochS: GOLDEN_DEPART_S,
        weather: syntheticField({
          seed: 424242,
          baseSpeedKn: 10,
          baseFromDeg: 200,
          speedVariationKn: 3,
          dirVariationDeg: 30,
          validFromS: GOLDEN_DEPART_S - 3600,
          validToS: GOLDEN_DEPART_S + 4 * 24 * 3600,
        }),
        mask: rectMask({ noGo: BOHUSLAN_SKERRIES }),
        boat: testBoat(),
        options: {
          headingStepDeg: 10,
          timeStepS: 1800,
          minOffingNm: 0.15,
          offingExemptNearEndsNm: 1.0,
        },
      },
    },
    {
      name: "ren-kryssetappe",
      purpose:
        "Målet ligger rett mot vinden. Fanger bautstraffen og " +
        "halseside-logikken — den skal krysse, ikke motorseile rett fram.",
      input: {
        start: { lat: 58.0, lon: 10.6 },
        dest: { lat: 58.6, lon: 10.6 },
        departEpochS: GOLDEN_DEPART_S,
        weather: constantWeather({
          speedKn: 14,
          fromDeg: 0,
          validFromS: GOLDEN_DEPART_S - 3600,
          validToS: GOLDEN_DEPART_S + 4 * 24 * 3600,
        }),
        mask: rectMask(),
        // Motoren av: vi vil se seilingen, ikke motorseilingen.
        boat: testBoat({ motorThresholdKn: 0 }),
        options: { headingStepDeg: 6, timeStepS: 1800 },
      },
    },
    {
      name: "tss-ved-skagen",
      purpose:
        "Etappe gjennom TSS-en ved Skagen. Fanger retningsregelen: kryssing " +
        "på tvers er tillatt, langs i feil retning er hard avvisning.",
      input: {
        start: { lat: 58.05, lon: 11.0 },
        dest: SKAGEN,
        departEpochS: GOLDEN_DEPART_S,
        weather: skagerrakWeather(GOLDEN_DEPART_S),
        mask: rectMask({ noGo: SKAGERRAK_LAND, tss: SKAGEN_TSS }),
        boat: testBoat(),
        options: { headingStepDeg: 8, timeStepS: 1800 },
      },
    },
    {
      name: "uoppnaelig-mal",
      purpose:
        "Målet er murt inne av land. Fanger ærlig avbrudd: reached=false " +
        "med riktig abortReason, og at beste delrute likevel returneres.",
      input: {
        start: { lat: 58.6, lon: 10.6 },
        dest: { lat: 58.0, lon: 9.2 },
        departEpochS: GOLDEN_DEPART_S,
        weather: skagerrakWeather(GOLDEN_DEPART_S),
        mask: rectMask({
          noGo: [
            ...SKAGERRAK_LAND,
            {
              latMin: 57.6,
              latMax: 58.4,
              lonMin: 8.8,
              lonMax: 9.6,
              reason: "innelåst",
            },
          ],
        }),
        boat: testBoat(),
        options: {
          headingStepDeg: 12,
          timeStepS: 3600,
          stagnationIterations: 20,
        },
      },
    },
    {
      name: "hull-i-vaerfeltet",
      purpose:
        "Værfeltet slutter midtveis i tid og rom. Fanger degraderingen: " +
        "coverage.weather = partial og ærlig stopp der dataene tar slutt.",
      input: {
        start: { lat: 58.6, lon: 10.6 },
        dest: { lat: 57.9, lon: 10.6 },
        departEpochS: GOLDEN_DEPART_S,
        weather: syntheticField({
          seed: 7,
          baseSpeedKn: 11,
          baseFromDeg: 270,
          speedVariationKn: 3,
          dirVariationDeg: 20,
          validFromS: GOLDEN_DEPART_S,
          // Feltet dekker bare de første seks timene.
          validToS: GOLDEN_DEPART_S + 6 * 3600,
          bbox: { latMin: 58.2, latMax: 59.0, lonMin: 10.2, lonMax: 11.0 },
        }),
        mask: rectMask(),
        boat: testBoat(),
        options: { headingStepDeg: 10, timeStepS: 1800 },
      },
    },
    {
      name: "natt-og-dagslysankomst",
      purpose:
        "Vinteravgang i mørket. Fanger natt-akkumulering, kryss-i-mørket i " +
        "totals, og at dagslyskravet flytter ankomsten.",
      input: {
        start: { lat: 58.6, lon: 10.6 },
        dest: { lat: 57.9, lon: 10.6 },
        departEpochS: GOLDEN_DEPART_WINTER_S,
        weather: constantWeather({
          speedKn: 13,
          fromDeg: 20,
          validFromS: GOLDEN_DEPART_WINTER_S - 3600,
          validToS: GOLDEN_DEPART_WINTER_S + 4 * 24 * 3600,
        }),
        mask: rectMask(),
        boat: testBoat(),
        options: { headingStepDeg: 10, timeStepS: 1800 },
      },
    },
  ];
}
