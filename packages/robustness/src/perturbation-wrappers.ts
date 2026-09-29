/**
 * Perturbasjons-innpakninger (`docs/specs/robusthet.md` §4.4, D8.4 c).
 *
 * Motoren har ingen cruising-faktor eller strømskalering (og skal ikke ha
 * det — «motoren kjenner ikke ensemble»). Perturbasjonen gjøres derfor
 * som rene dekoratorer rundt kontraktene motoren allerede konsumerer:
 * en `BoatModel` som seiler `factor` ganger så fort, og et `WeatherField`
 * der strømmen er skalert. Alt annet delegeres uendret, så et perturbert
 * søk er det samme fulle Pareto-søket med samme opsjoner (ADR-0005) —
 * bare med en annen båt eller et annet hav.
 *
 * Konservativitet: `maxCurrentKn` er en øvre skranke motoren bruker til
 * Vmax/Tub. Skaleres strømmen opp, må skranken opp; skaleres den ned,
 * beholdes den (en for stor skranke er trygg, en for liten er det ikke).
 */
import type { BoatModel, CurrentSample, WeatherField } from "@morild/routing";

/** Båten seiler `factor` × polarfart. Motorfart/-forbruk og harde grenser røres ikke. */
export function withCruisingFactor(boat: BoatModel, factor: number): BoatModel {
  if (!(factor > 0) || !Number.isFinite(factor)) {
    throw new Error(`withCruisingFactor: faktor må være > 0 og endelig (fikk ${factor})`);
  }
  return {
    boatSpeedKn: (twsKn, twaDeg) => boat.boatSpeedKn(twsKn, twaDeg) * factor,
    waveFactor: (hsM, tpS, relDirDeg) => boat.waveFactor(hsM, tpS, relDirDeg),
    maxTwsKn: boat.maxTwsKn,
    maxHsM: boat.maxHsM,
    motorThresholdKn: boat.motorThresholdKn,
    motorSpeedKn: boat.motorSpeedKn,
    motorFuelLPerH: boat.motorFuelLPerH,
    // Dybdegatens felt — eksplisitt, ikke spread: `BoatModel` kan være en
    // klasseinstans med metoder på prototypen (review-funn 4, bølge 4).
    draughtM: boat.draughtM,
    depthClearanceM: boat.depthClearanceM,
  };
}

/** Strømmen (u, v) skalert med `factor`; vind/bølger/dekning uendret. */
export function withCurrentScale(weather: WeatherField, factor: number): WeatherField {
  if (!(factor >= 0) || !Number.isFinite(factor)) {
    throw new Error(`withCurrentScale: faktor må være ≥ 0 og endelig (fikk ${factor})`);
  }
  const scaled: WeatherField = {
    wind: (lat, lon, epochS) => weather.wind(lat, lon, epochS),
    waves: (lat, lon, epochS) => weather.waves(lat, lon, epochS),
    current: (lat, lon, epochS): CurrentSample | undefined => {
      const c = weather.current(lat, lon, epochS);
      return c === undefined ? undefined : { u: c.u * factor, v: c.v * factor };
    },
    maxTwsKn: weather.maxTwsKn,
    // Øvre skranke: aldri mindre enn den var (se toppkommentaren).
    maxCurrentKn: weather.maxCurrentKn * Math.max(1, factor),
    maxDecodeErrorKn: weather.maxDecodeErrorKn,
    validFromS: weather.validFromS,
    validToS: weather.validToS,
    header: weather.header,
  };
  // Kystmasken (D15.2) og punktbølgens avstand (punktbolge.md §3) er
  // uavhengige av strømmens størrelse — sendes uendret videre. Bølgen selv
  // går allerede uendret gjennom `waves` over (samme fryste punktsett).
  const coastal = weather.currentCoastal?.bind(weather);
  const wavePointDistance = weather.wavePointDistanceNm?.bind(weather);
  const withCoastal: WeatherField = {
    ...scaled,
    ...(coastal !== undefined ? { currentCoastal: coastal } : {}),
    ...(wavePointDistance !== undefined ? { wavePointDistanceNm: wavePointDistance } : {}),
  };
  if (weather.maxDecodeErrorKnAt !== undefined) {
    const at = weather.maxDecodeErrorKnAt.bind(weather);
    return { ...withCoastal, maxDecodeErrorKnAt: at };
  }
  return withCoastal;
}
