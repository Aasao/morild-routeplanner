/**
 * **S-8 — vind mot strøm.** Måleplanens §6.2: en fellemekanisme ingen av de
 * øvrige scenarioene dekker. Der S-3 handler om *timing* og S-7 om *topologi*,
 * handler S-8 om **bølgebratthet** (F3.2): den samme bølgehøyden er ufarlig på
 * 7 sekunders periode og alvorlig på 5.
 *
 * Geometri: Skjæløy → Skagen. Tvers over strekket (57,85–58,55° N) ligger et
 * strømbånd som setter mot NØ (060°) — Jyllandsstrømmen inn i Skagerrak. Over
 * det står frisk NØ-lig vind, altså **rett mot strømmen**. Båten må krysse
 * båndet for å komme fram; det finnes ingen vei utenom.
 *
 * Fast to-parameter-tabell, uten RNG:
 *
 *  - **strømstyrke** i båndets senter: 0,4 / 0,9 / 1,4 / 1,8 / 2,1 / 2,4 kn
 *  - **vindretning**: 30 / 45 / 60 / 100 / 140°. De tre første står mot
 *    strømmen (∠ 150–180° ⇒ full bratthetseffekt og `VIND_MOT_STROM`-flagg),
 *    100° gir delvis motstrøm (∠ 140°, akkurat over flaggets 135°-terskel), og
 *    140° gir nesten ingen (∠ 100° — under terskelen, ingen flagg).
 *
 * Utfallsrommet spenner dermed fra «vanlig sjø, ingen derating» til «Hs 4,1 m
 * på 5,3 s ⇒ hard forkastelse». Medlemmene med hard forkastelse er
 * `hardRejectionMemberIds`.
 *
 * Båten er `testBoat({ steepnessDerating: true })` — det er den eneste
 * fiksturen som slår på bratthetsderatingen, og den er av som standard nettopp
 * for at S-8 ikke skal kunne endre noen annen fikstur eller golden-rute.
 */
import type { RouteOptions } from "../src/index.js";
import type { EnsembleFixture, EnsembleMember } from "./ensemble.js";
import { memberId } from "./ensemble.js";
import {
  GOLDEN_DEPART_S,
  SKAGEN,
  SKAGERRAK_LAND,
  SKJAELOY,
} from "./golden-scenarios.js";
import { rectMask } from "./synthetic-mask.js";
import { testBoat } from "./test-boat.js";
import {
  windAgainstCurrentWeather,
  type WindCurrentWeatherOptions,
} from "./wind-current-weather.js";

/** Strømstyrke i båndets senter, knop. */
const CURRENT_KN = [0.4, 0.9, 1.4, 1.8, 2.1, 2.4] as const;
/** Vindretning (FRA), grader. Strømmen setter mot 060°. */
const WIND_FROM_DEG = [30, 45, 60, 100, 140] as const;

const WIND_SPEED_KN = 24;
const BAND_CENTER_LAT = 58.2;
const BAND_HALF_WIDTH_DEG = 0.35;
const CURRENT_TOWARD_DEG = 60;

export const S8_OPTIONS: Partial<RouteOptions> = Object.freeze({
  headingStepDeg: 10,
  timeStepS: 3600,
});

export interface S8Options {
  readonly departEpochS?: number;
}

function fieldOptions(
  departEpochS: number,
  currentKn: number,
  windFromDeg: number,
): WindCurrentWeatherOptions {
  return {
    windSpeedKn: WIND_SPEED_KN,
    windFromDeg,
    bandCenterLat: BAND_CENTER_LAT,
    bandHalfWidthDeg: BAND_HALF_WIDTH_DEG,
    currentKn,
    currentTowardDeg: CURRENT_TOWARD_DEG,
    validFromS: departEpochS - 3600,
    validToS: departEpochS + 3 * 24 * 3600,
  };
}

export function s8WindAgainstCurrentEnsemble(
  options: S8Options = {},
): EnsembleFixture {
  const departEpochS = options.departEpochS ?? GOLDEN_DEPART_S;
  const boat = testBoat({ steepnessDerating: true });

  const members: EnsembleMember[] = [];
  const hardRejectionMemberIds: string[] = [];

  for (const currentKn of CURRENT_KN) {
    for (const windFromDeg of WIND_FROM_DEG) {
      const index = members.length;
      const id = memberId(index);
      const fo = fieldOptions(departEpochS, currentKn, windFromDeg);
      const weather = windAgainstCurrentWeather(fo);
      // Verste Hs i feltet ligger i båndets senter. Vi leser det ut av feltet
      // selv i stedet for å regne det på nytt her — én sannhet.
      const worst = weather.waves(BAND_CENTER_LAT, SKJAELOY.lon, departEpochS);
      if (worst !== undefined && worst.hsM > boat.maxHsM) {
        hardRejectionMemberIds.push(id);
      }
      members.push({
        id,
        index,
        params: {
          currentKn,
          windFromDeg,
          worstHsM: Math.round((worst?.hsM ?? 0) * 1000) / 1000,
          worstTpS: Math.round((worst?.tpS ?? 0) * 1000) / 1000,
        },
        weather,
      });
    }
  }

  return {
    name: "s8-vind-mot-strom",
    purpose:
      "Strømbånd tvers over Skagerrak som setter mot frisk NØ-lig vind. " +
      "Fellemekanismen er bølgebratthet (F3.2): kort, høy sjø deraterer " +
      "farten kraftig, og i de sterkeste medlemmene går Hs over båtens grense.",
    start: SKJAELOY,
    dest: SKAGEN,
    departEpochS,
    mask: rectMask({ noGo: SKAGERRAK_LAND }),
    boat,
    options: S8_OPTIONS,
    // Kontrollfeltet: moderat strøm og vindretning midt i tabellen.
    control: windAgainstCurrentWeather(fieldOptions(departEpochS, 1.1, 50)),
    members,
    hardRejectionMemberIds,
  };
}

export const S8_BAND = Object.freeze({
  centerLat: BAND_CENTER_LAT,
  halfWidthDeg: BAND_HALF_WIDTH_DEG,
  currentTowardDeg: CURRENT_TOWARD_DEG,
  windSpeedKn: WIND_SPEED_KN,
});
