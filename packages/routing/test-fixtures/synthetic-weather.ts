/**
 * Syntetiske, deterministiske værfelt for enhets-, egenskaps- og
 * golden-tester.
 *
 * Golden-grunnlaget er **syntetisk i fase 2** (bekreftet 2026-08-30, spec §9
 * spm. 11): ekte MEPS-uttrekk finnes ikke før fase 3, og et frosset
 * syntetisk felt gir akkurat den egenskapen golden-testene trenger — at
 * inputen er bit-identisk fra kjøring til kjøring. Feltene er merket som
 * syntetiske i `header.model`, slik at ingen forveksler dem med prognoser.
 */
import type { PackageHeader } from "@morild/protocol";
import type {
  CurrentSample,
  WaveSample,
  WeatherField,
  WindSample,
} from "../src/index.js";
import { mulberry32 } from "./seeded-random.js";

export const SYNTHETIC_HEADER: PackageHeader = Object.freeze({
  formatVersion: "1.0.0",
  producedAt: "2026-08-30T00:00:00Z",
  model: "SYNTETISK-TESTFELT",
  init: "2026-08-30T00:00:00Z",
  resolution: "analytisk",
  sourceStatus: { status: "ok" as const },
});

const YEAR_S = 365 * 24 * 3600;

export interface ConstantWeatherOptions {
  readonly speedKn: number;
  readonly fromDeg: number;
  readonly hsM?: number;
  readonly tpS?: number;
  readonly waveFromDeg?: number;
  readonly currentU?: number;
  readonly currentV?: number;
  readonly validFromS?: number;
  readonly validToS?: number;
}

/** Homogent felt: samme vind overalt, til alle tider. */
export function constantWeather(o: ConstantWeatherOptions): WeatherField {
  const wind: WindSample = { speedKn: o.speedKn, fromDeg: o.fromDeg };
  const waves: WaveSample | undefined =
    o.hsM === undefined
      ? undefined
      : {
          hsM: o.hsM,
          ...(o.tpS === undefined ? {} : { tpS: o.tpS }),
          ...(o.waveFromDeg === undefined ? {} : { fromDeg: o.waveFromDeg }),
        };
  const current: CurrentSample | undefined =
    o.currentU === undefined && o.currentV === undefined
      ? undefined
      : { u: o.currentU ?? 0, v: o.currentV ?? 0 };

  const validFromS = o.validFromS ?? 0;
  const validToS = o.validToS ?? validFromS + YEAR_S;

  return {
    wind: (_lat, _lon, epochS) =>
      epochS >= validFromS && epochS <= validToS ? wind : undefined,
    waves: (_lat, _lon, epochS) =>
      epochS >= validFromS && epochS <= validToS ? waves : undefined,
    current: (_lat, _lon, epochS) =>
      epochS >= validFromS && epochS <= validToS ? current : undefined,
    maxTwsKn: o.speedKn,
    maxCurrentKn: Math.hypot(o.currentU ?? 0, o.currentV ?? 0),
    // Analytisk felt, ingen kvantisering ⇒ ingen dekodefeil (vaerpakker §9.5).
    maxDecodeErrorKn: 0,
    validFromS,
    validToS,
    header: SYNTHETIC_HEADER,
  };
}

export interface FieldWeatherOptions {
  /** Seed for de romlige variasjonene. Samme seed → samme felt, alltid. */
  readonly seed: number;
  readonly baseSpeedKn: number;
  readonly baseFromDeg: number;
  /** Amplituden på den romlige/tidsmessige variasjonen i vindstyrke. */
  readonly speedVariationKn: number;
  /** Amplituden på retningsvariasjonen i grader. */
  readonly dirVariationDeg: number;
  readonly baseHsM?: number;
  readonly validFromS: number;
  readonly validToS: number;
  /** Utenfor denne boksen finnes ingen data — for degraderingstestene. */
  readonly bbox?: {
    readonly latMin: number;
    readonly latMax: number;
    readonly lonMin: number;
    readonly lonMax: number;
  };
}

/**
 * Glatt, deterministisk felt: en sum av sinusledd med seedete faser. Ingen
 * interpolasjon og ingen tabell — funksjonen *er* feltet, og den er ren.
 */
export function syntheticField(o: FieldWeatherOptions): WeatherField {
  const rnd = mulberry32(o.seed);
  const phase = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()].map(
    (v) => v * Math.PI * 2,
  );
  const p = (i: number): number => phase[i] ?? 0;

  const inBox = (lat: number, lon: number): boolean =>
    o.bbox === undefined ||
    (lat >= o.bbox.latMin &&
      lat <= o.bbox.latMax &&
      lon >= o.bbox.lonMin &&
      lon <= o.bbox.lonMax);

  const inTime = (epochS: number): boolean =>
    epochS >= o.validFromS && epochS <= o.validToS;

  const hours = (epochS: number): number => (epochS - o.validFromS) / 3600;

  return {
    wind(lat, lon, epochS) {
      if (!inBox(lat, lon) || !inTime(epochS)) return undefined;
      const t = hours(epochS);
      const speedKn =
        o.baseSpeedKn +
        o.speedVariationKn *
          (0.6 * Math.sin(lat * 1.7 + p(0)) +
            0.3 * Math.sin(lon * 2.3 + p(1)) +
            0.4 * Math.sin(t / 9 + p(2)));
      const fromDeg =
        (((o.baseFromDeg +
          o.dirVariationDeg *
            (0.7 * Math.sin(lat * 1.1 + p(3)) +
              0.5 * Math.sin(lon * 0.9 + p(4)) +
              0.6 * Math.sin(t / 13 + p(5)))) %
          360) +
          360) %
        360;
      return { speedKn: Math.max(0.5, speedKn), fromDeg };
    },
    waves(lat, lon, epochS) {
      if (o.baseHsM === undefined) return undefined;
      if (!inBox(lat, lon) || !inTime(epochS)) return undefined;
      const t = hours(epochS);
      const hsM = Math.max(
        0,
        o.baseHsM * (1 + 0.4 * Math.sin(lat * 1.3 + t / 11 + p(0))),
      );
      return { hsM, tpS: 6 + 2 * Math.sin(lon + p(1)), fromDeg: o.baseFromDeg };
    },
    current(lat, lon, epochS) {
      if (!inBox(lat, lon) || !inTime(epochS)) return undefined;
      return {
        u: 0.3 * Math.sin(lat * 2.1 + p(2)),
        v: 0.3 * Math.cos(lon * 1.9 + p(3)),
      };
    },
    maxTwsKn:
      o.baseSpeedKn + o.speedVariationKn * 1.3,
    maxCurrentKn: 0.5,
    maxDecodeErrorKn: 0,
    validFromS: o.validFromS,
    validToS: o.validToS,
    header: SYNTHETIC_HEADER,
  };
}

/** Felt uten vær i det hele tatt — for `noWeatherAtStart`-testen. */
export function emptyWeather(validFromS = 0, validToS = YEAR_S): WeatherField {
  return {
    wind: () => undefined,
    waves: () => undefined,
    current: () => undefined,
    maxTwsKn: 0,
    maxCurrentKn: 0,
    maxDecodeErrorKn: 0,
    validFromS,
    validToS,
    header: SYNTHETIC_HEADER,
  };
}

/** Rektangulær lon/lat-boks — brukt av `withMissingTile`. */
export interface MissingTileBox {
  readonly latMin: number;
  readonly latMax: number;
  readonly lonMin: number;
  readonly lonMax: number;
}

/**
 * Et felt der **strøm og/eller bølge** mangler i en boks, mens vinden står
 * (ADR-0008-fiksturen). Signaturen til NorKysts fyllverdier nær land eller
 * et bølgepunkt utenfor rekkevidde: søket ekspanderer som før, men
 * miljøoppslaget i boksen gir `current`/`waves === undefined`.
 */
export function withMissingEnvFields(
  base: WeatherField,
  box: MissingTileBox,
  fields: { readonly current?: boolean; readonly waves?: boolean },
): WeatherField {
  const inHole = (lat: number, lon: number): boolean =>
    lat >= box.latMin &&
    lat <= box.latMax &&
    lon >= box.lonMin &&
    lon <= box.lonMax;
  return {
    ...base,
    waves: (lat, lon, epochS) =>
      fields.waves === true && inHole(lat, lon)
        ? undefined
        : base.waves(lat, lon, epochS),
    current: (lat, lon, epochS) =>
      fields.current === true && inHole(lat, lon)
        ? undefined
        : base.current(lat, lon, epochS),
  };
}

/**
 * Et felt der ÉN flis mangler (D7.2-fiksturen).
 *
 * Innenfor boksen svarer feltet `undefined` på alt, mens `validFromS`/
 * `validToS` er uendret — altså nøyaktig signaturen til «en værflis ble ikke
 * lastet ned», til forskjell fra «prognosen tok slutt». Det er den
 * situasjonen `pruned.noWeatherInWindow` teller og flagget
 * `VAERDEKNING_BEGRENSET` rapporterer.
 */
export function withMissingTile(
  base: WeatherField,
  box: MissingTileBox,
): WeatherField {
  const inHole = (lat: number, lon: number): boolean =>
    lat >= box.latMin &&
    lat <= box.latMax &&
    lon >= box.lonMin &&
    lon <= box.lonMax;
  return {
    ...base,
    wind: (lat, lon, epochS) =>
      inHole(lat, lon) ? undefined : base.wind(lat, lon, epochS),
    waves: (lat, lon, epochS) =>
      inHole(lat, lon) ? undefined : base.waves(lat, lon, epochS),
    current: (lat, lon, epochS) =>
      inHole(lat, lon) ? undefined : base.current(lat, lon, epochS),
  };
}
