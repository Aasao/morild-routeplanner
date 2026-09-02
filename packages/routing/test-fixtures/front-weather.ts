/**
 * Analytisk kaldfront som værfelt — grunnlaget for S-3 (frontpassasje) og
 * S-7 (to-regime) i E1′-målingen.
 *
 * Oppskriften er `docs/research/steg3-plan-2026-08-31.md` §«Frontfikstur-
 * oppskriften» (astrofysiker + værruting + lateral), kalibrert mot det eneste
 * ekte ankeret vi har: `docs/research/v1-frontpassasjer.md` (1. august 2026,
 * Oslofjorden).
 *
 * **Bare VINDparametrene fra ankeret er gyldige.** Båtresponsen i den loggen
 * var motorkjøring (STW = 0, SOG 5 kn stabilt), og den er derfor ikke brukt
 * til noe her. Det som er arvet fra ankeret:
 *
 *  - dreiningen gjennom fronten: ~65–70° (190° → 255–260°) — fiksturen bruker
 *    68°;
 *  - lull-signaturen på selve linjen: ankeret målte 0,8 kn i et 5-sekunders
 *    punktsample. Et 2,5 km/1 t-felt kan ikke bære den verdien, og oppskriften
 *    ber om 4–8 kn over ~10 nm; fiksturen bruker 5 kn med 5 nm halvbredde og
 *    dokumenterer avviket her i stedet for å late som om 0,8 kn er en
 *    gridverdi;
 *  - strukturen «prefrontal svak og skjev → lull → postfrontal sterkere og
 *    dreid», som er den seilbåt-uavhengige delen av observasjonen.
 *
 * Postfrontal STYRKE er bevisst skalert opp fra ankeret (13,5 kn) til
 * oppskriftens 25–35 kn: 1. august var en svak sommerfront, og fiksturen skal
 * være farlig. Det er en eksplisitt ekstrapolasjon, ikke en måling.
 *
 * **Geometri.** Signert avstand til frontlinjen, i nautiske mil:
 *
 *     d(x, t) = c·(t + Δt) − offset − n·(x − x₀)
 *
 * der `n` er enhetsvektoren fronten beveger seg langs (`moveTowardDeg`), `c`
 * frontens fart, `Δt` medlemmets tidsskyv (positivt = fronten kommer
 * tidligere) og `offset` hvor langt bak referansepunktet linjen ligger ved
 * t = 0. **d > 0 ⇒ postfrontal** (fronten har passert punktet).
 *
 * Vinden er oppskriftens tanh-blanding, `s = (1 + tanh(d/w))/2`, med
 * retningen interpolert langs korteste bue og en gaussisk vindstille-stripe
 * lagt oppå. Bølgefeltet er **frikoblet**: den gamle SV-sjøen står igjen etter
 * skiftet og dør ut over `swellPersistH` timer, mens den postfrontale
 * vindsjøen bygger seg med `s`. Det er nettopp «lull + krysshav» som knekker
 * rutere, og det er hele poenget med fiksturen.
 *
 * Rent og deterministisk som resten av testgrunnlaget: ingen RNG, ingen
 * klokke, ingen I/O. Feltet er en funksjon.
 */
import type { LatLon } from "@morild/geo";
import { norm180, norm360 } from "@morild/geo";
import type {
  CurrentSample,
  WaveSample,
  WeatherField,
  WindSample,
} from "../src/index.js";
import { SYNTHETIC_HEADER } from "./synthetic-weather.js";

export interface FrontWeatherOptions {
  /** Punktet frontgeometrien måles fra (typisk rutens startpunkt). */
  readonly reference: LatLon;
  /** t = 0 for frontgeometrien (typisk avgangstiden). */
  readonly referenceEpochS: number;

  /** Retningen fronten beveger seg MOT, grader rettvisende. */
  readonly moveTowardDeg: number;
  /** Frontens fart i knop. 0 = stillestående, negativ = retrograd. */
  readonly speedKn: number;
  /** Hvor langt bak referansepunktet frontlinjen ligger ved t = 0, i nm. */
  readonly offsetNm: number;
  /** Overgangsbredden `w` i tanh-blandingen, nm (oppskriften: 10–20). */
  readonly widthNm: number;
  /** Medlemmets tidsskyv i timer. Positivt = fronten kommer tidligere. */
  readonly timingShiftH: number;

  readonly preTwsKn: number;
  readonly preFromDeg: number;
  readonly postTwsKn: number;
  readonly postFromDeg: number;

  /** Vindstille-stripa på linjen (oppskriften: 4–8 kn). */
  readonly lullTwsKn: number;
  /** Halvbredden på stripa i nm; ~5 gir en stripe på ~10 nm. */
  readonly lullHalfWidthNm: number;

  /** Gammel, frikoblet SV-sjø. */
  readonly swellHsM: number;
  readonly swellFromDeg: number;
  readonly swellTpS: number;
  /** Hvor mange timer den gamle sjøen består etter skiftet (6–12). */
  readonly swellPersistH: number;

  /** Postfrontal vindsjø, fullt utviklet. */
  readonly postHsM: number;
  readonly postWaveFromDeg: number;
  readonly postTpS: number;

  /** Konstant strøm, hvis fiksturen trenger den. */
  readonly current?: CurrentSample | undefined;

  readonly validFromS: number;
  readonly validToS: number;
}

/** Frontgeometrien alene — eksponert fordi testene må kunne påvise den. */
export interface FrontGeometry {
  /** Signert avstand i nm. Positiv = postfrontal. */
  signedDistanceNm(lat: number, lon: number, epochS: number): number;
  /** Blandingsvekten `s ∈ (0,1)`; 0 = rent prefrontal, 1 = rent postfrontal. */
  blend(lat: number, lon: number, epochS: number): number;
  /** Timer siden fronten passerte punktet. Negativ = ikke passert enda. */
  hoursSincePassage(lat: number, lon: number, epochS: number): number;
}

/** Projeksjon av (x − x₀) på frontens bevegelsesretning, i nm. */
function alongNormalNm(o: FrontWeatherOptions, lat: number, lon: number): number {
  const north = (lat - o.reference.lat) * 60;
  const east =
    (lon - o.reference.lon) * 60 * Math.cos((o.reference.lat * Math.PI) / 180);
  const rad = (o.moveTowardDeg * Math.PI) / 180;
  return north * Math.cos(rad) + east * Math.sin(rad);
}

function signedDistanceNm(
  o: FrontWeatherOptions,
  lat: number,
  lon: number,
  epochS: number,
): number {
  const tH = (epochS - o.referenceEpochS) / 3600;
  const frontNm = o.speedKn * (tH + o.timingShiftH) - o.offsetNm;
  return frontNm - alongNormalNm(o, lat, lon);
}

/**
 * Timer siden fronten passerte punktet.
 *
 * For en stillestående eller retrograd front (`c ≤ 0`) finnes ingen
 * passasjetid: det postfrontale området har «alltid» vært postfrontalt, og det
 * prefrontale blir det aldri. Vi returnerer da et tall som gir samme svar —
 * ferdig utdødd gammel sjø bak linjen, uberørt gammel sjø foran den.
 */
function hoursSincePassage(o: FrontWeatherOptions, d: number): number {
  if (o.speedKn > 0.01) return d / o.speedKn;
  return d > 0 ? o.swellPersistH * 4 : -1;
}

export function frontGeometry(o: FrontWeatherOptions): FrontGeometry {
  return {
    signedDistanceNm: (lat, lon, epochS) => signedDistanceNm(o, lat, lon, epochS),
    blend: (lat, lon, epochS) =>
      (1 + Math.tanh(signedDistanceNm(o, lat, lon, epochS) / o.widthNm)) / 2,
    hoursSincePassage: (lat, lon, epochS) =>
      hoursSincePassage(o, signedDistanceNm(o, lat, lon, epochS)),
  };
}

export function frontWeather(o: FrontWeatherOptions): WeatherField {
  const inTime = (epochS: number): boolean =>
    epochS >= o.validFromS && epochS <= o.validToS;

  const wind = (lat: number, lon: number, epochS: number): WindSample => {
    const d = signedDistanceNm(o, lat, lon, epochS);
    const s = (1 + Math.tanh(d / o.widthNm)) / 2;
    const fromDeg = norm360(
      o.preFromDeg + norm180(o.postFromDeg - o.preFromDeg) * s,
    );
    const blended = o.preTwsKn + (o.postTwsKn - o.preTwsKn) * s;
    // Vindstille-stripa: gaussisk søkk sentrert på selve linjen.
    const g = Math.exp(-((d / o.lullHalfWidthNm) ** 2));
    const speedKn = blended * (1 - g) + o.lullTwsKn * g;
    return { speedKn, fromDeg };
  };

  const waves = (lat: number, lon: number, epochS: number): WaveSample => {
    const d = signedDistanceNm(o, lat, lon, epochS);
    const s = (1 + Math.tanh(d / o.widthNm)) / 2;
    const windseaHsM = o.postHsM * s;
    const sinceH = hoursSincePassage(o, d);
    const swellFactor =
      sinceH <= 0 ? 1 : Math.max(0, 1 - sinceH / o.swellPersistH);
    const swellHsM = o.swellHsM * swellFactor;
    const hsM = Math.hypot(swellHsM, windseaHsM);
    // Den dominerende komponenten gir retning og periode. Rundt skiftet er de
    // to nesten like store og retningen hopper ~75° — det er krysshavet.
    const swellDominates = swellHsM >= windseaHsM;
    return {
      hsM,
      tpS: swellDominates ? o.swellTpS : o.postTpS,
      fromDeg: swellDominates ? o.swellFromDeg : o.postWaveFromDeg,
    };
  };

  return {
    wind: (lat, lon, epochS) =>
      inTime(epochS) ? wind(lat, lon, epochS) : undefined,
    waves: (lat, lon, epochS) =>
      inTime(epochS) ? waves(lat, lon, epochS) : undefined,
    current: (_lat, _lon, epochS) =>
      inTime(epochS) ? o.current : undefined,
    // Blandingen kan aldri overstige endepunktene, og stripa senker bare.
    maxTwsKn: Math.max(o.preTwsKn, o.postTwsKn),
    maxCurrentKn: Math.hypot(o.current?.u ?? 0, o.current?.v ?? 0),
    maxDecodeErrorKn: 0,
    validFromS: o.validFromS,
    validToS: o.validToS,
    header: SYNTHETIC_HEADER,
  };
}
