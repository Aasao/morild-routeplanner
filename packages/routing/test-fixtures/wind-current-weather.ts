/**
 * Vind-mot-strøm-felt: friskt vindfelt over et strømbånd som setter **mot**
 * vinden, slik at sjøen blir høyere og kortere der de to møtes.
 *
 * Grunnlaget for S-8 (måleplanens §6.2): «Skagerrak-fella». Mekanismen er en
 * annen enn frontfiksturens — der er det timing, her er det **bølgebratthet**
 * (F3.2) — og det er hele poenget med å ha den med.
 *
 * Fysikken er modellert eksplisitt og enkelt, ikke hentet fra en
 * bølgemodell:
 *
 *   opp  = |strøm| · max(0, −cos∠(strøm-mot, vind-mot))     [kn mot vinden]
 *   Hs   = Hs₀ · (1 + 0,30·opp)
 *   Tp   = Tp₀ · (1 − 0,16·opp)
 *
 * Med Hs₀ = 0,10·TWS og Tp₀ = 3,2 + 0,16·TWS gir 24 kn vind mot 2,4 kn strøm
 * Hs 4,1 m og Tp 5,3 s — altså bratthet S = 2πHs/(g·Tp²) ≈ 0,09, like under
 * bryteterskelen ~0,1, og Hs over testbåtens `maxHsM = 4` ⇒ hard forkastelse.
 * Uten motstrøm er de samme tallene 2,4 m / 7,0 s og S ≈ 0,03: en helt vanlig
 * sjø. Tallene er en **kalibrert karikatur**, ikke en validert bølgemodell —
 * de er valgt slik at bratthetsderatingen og den harde grensen begge kan
 * aktiveres innenfor et realistisk parameterrom.
 *
 * Strømmen ligger i et bånd med `cos²`-avtrapping i bredderetningen, slik at
 * feltet er glatt (ingen kunstige diskontinuiteter for søket å snuble i).
 */
import { angDiff, norm360 } from "@morild/geo";
import type {
  CurrentSample,
  WaveSample,
  WeatherField,
  WindSample,
} from "../src/index.js";
import { SYNTHETIC_HEADER } from "./synthetic-weather.js";

export interface WindCurrentWeatherOptions {
  readonly windSpeedKn: number;
  readonly windFromDeg: number;
  /** Strømbåndets senter, breddegrad. */
  readonly bandCenterLat: number;
  /** Halv båndbredde i grader bredde; utenfor dette er strømmen null. */
  readonly bandHalfWidthDeg: number;
  /** Strømfart i båndets senter, knop. */
  readonly currentKn: number;
  /** Retningen strømmen setter MOT, grader rettvisende. */
  readonly currentTowardDeg: number;
  readonly validFromS: number;
  readonly validToS: number;
}

/** Strømfarten i en breddegrad — cos²-profil over båndet. */
export function bandCurrentKn(o: WindCurrentWeatherOptions, lat: number): number {
  const rel = Math.abs(lat - o.bandCenterLat) / o.bandHalfWidthDeg;
  if (rel >= 1) return 0;
  return o.currentKn * Math.cos((Math.PI / 2) * rel) ** 2;
}

/** Komponenten av strømmen som står mot vinden, i knop. Aldri negativ. */
export function oppositionKn(
  o: WindCurrentWeatherOptions,
  lat: number,
): number {
  const currentKn = bandCurrentKn(o, lat);
  if (currentKn <= 0) return 0;
  const windTowardDeg = norm360(o.windFromDeg + 180);
  const delta = angDiff(o.currentTowardDeg, windTowardDeg);
  return currentKn * Math.max(0, -Math.cos((delta * Math.PI) / 180));
}

/** Bølgebratthet S = 2πHs/(g·Tp²) — samme mål som deratingen bruker. */
export function steepness(hsM: number, tpS: number): number {
  return (2 * Math.PI * hsM) / (9.81 * tpS * tpS);
}

export function windAgainstCurrentWeather(
  o: WindCurrentWeatherOptions,
): WeatherField {
  const inTime = (epochS: number): boolean =>
    epochS >= o.validFromS && epochS <= o.validToS;

  const wind: WindSample = Object.freeze({
    speedKn: o.windSpeedKn,
    fromDeg: o.windFromDeg,
  });

  const hs0 = 0.1 * o.windSpeedKn;
  const tp0 = 3.2 + 0.16 * o.windSpeedKn;

  const waves = (lat: number): WaveSample => {
    const opp = oppositionKn(o, lat);
    return {
      hsM: hs0 * (1 + 0.3 * opp),
      tpS: tp0 * (1 - 0.16 * opp),
      fromDeg: o.windFromDeg,
    };
  };

  const current = (lat: number): CurrentSample => {
    const kn = bandCurrentKn(o, lat);
    const rad = (o.currentTowardDeg * Math.PI) / 180;
    return { u: kn * Math.sin(rad), v: kn * Math.cos(rad) };
  };

  return {
    wind: (_lat, _lon, epochS) => (inTime(epochS) ? wind : undefined),
    waves: (lat, _lon, epochS) => (inTime(epochS) ? waves(lat) : undefined),
    current: (lat, _lon, epochS) => (inTime(epochS) ? current(lat) : undefined),
    maxTwsKn: o.windSpeedKn,
    maxCurrentKn: o.currentKn,
    validFromS: o.validFromS,
    validToS: o.validToS,
    header: SYNTHETIC_HEADER,
  };
}
