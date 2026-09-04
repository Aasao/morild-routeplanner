/**
 * packages/weather — værfeltmodell, kvantisering/dekoding og pakkeformat
 * (`docs/specs/vaerpakker.md`).
 *
 * Delt av batch-encoderen (`tools/weather-pack`, bygges parallelt) og
 * klienten. Ren og deterministisk — ingen I/O, ingen `@morild/routing`-
 * import (arkitekturgrensen, `tools/arch-tests`).
 *
 * Fase 0-placeholderen (`WEATHER_PACKAGE_PLACEHOLDER`) beholdes til noen
 * fortsatt importerer den; nytt kode bør bruke navnene under.
 */
export const WEATHER_PACKAGE_PLACEHOLDER = "weather" as const;

export * from "./samples.js";
export * from "./quantize.js";
export * from "./wind-codec.js";
export * from "./interpolation.js";
export * from "./delta.js";
export * from "./tiles.js";
export * from "./package-format.js";
export * from "./field.js";
export * from "./weather-field-adapter.js";
export * from "./age.js";
export * from "./budget.js";
export * from "./certificate.js";

// ---------------------------------------------------------------------------
// Kompatibilitetsaliaser mot `tools/weather-pack/src/{format-contract,quantize}.ts`
// (`TODO: erstattes av @morild/weather`-kommentarene der). Samme
// funksjonsnavn/semantikk, slik at overgangen er en importendring, ikke en
// omskriving, når den fila slettes til fordel for denne pakken. Se
// `docs/specs/vaerpakker.md` §19 (endringslogg, 2026-09-03) for
// bakgrunnen — to samtidige bølger konvergerte uavhengig mot samme
// grensesnittnavn fra samme spec, dette er broen mellom dem.
import {
  computeLinearParams as _computeLinearParams,
  decodeLinear as _decodeLinear,
  encodeLinear as _encodeLinear,
} from "./quantize.js";
import {
  combineChannelDecodeErrorsKn as _combineChannelDecodeErrorsKn,
  uvToWind as _uvToWind,
  windToUV as _windSampleToComponents,
} from "./wind-codec.js";
import { windLayerMaxDecodeErrorKn as _windLayerMaxDecodeErrorKn } from "./field.js";
import type { QuantizationParams as _QuantizationParams } from "./quantize.js";
import type { CurrentSample as _CurrentSample } from "./samples.js";

/** Alias for `computeLinearParams(min,max,bits,"nearest") → {scale,offset}`. */
export function computeScaleOffset(input: {
  readonly min: number;
  readonly max: number;
  readonly bitsPerSample: 8 | 10;
}): { readonly scale: number; readonly offset: number } {
  const p = _computeLinearParams(input.min, input.max, input.bitsPerSample, "nearest");
  return { scale: p.scale, offset: p.offset };
}

/** Alias for `encodeLinear`. */
export function encodeValue(value: number, params: _QuantizationParams): number {
  return _encodeLinear(value, params);
}

/** Alias for `decodeLinear`. */
export function decodeValue(raw: number, params: _QuantizationParams): number | undefined {
  return _decodeLinear(raw, params);
}

/** Alias for `uvToWind`. */
export function windComponentsToSample(u: number, v: number): ReturnType<typeof _uvToWind> {
  return _uvToWind(u, v);
}

/** Alias for `windToUV`, returnert som `{u,v}` i stedet for en tuppel. */
export function windSampleToComponents(speedKn: number, fromDeg: number): _CurrentSample {
  const [u, v] = _windSampleToComponents(speedKn, fromDeg);
  return { u, v };
}

/**
 * Alias — delegerer til `wind-codec.ts::combineChannelDecodeErrorsKn`, den
 * ENE bindende hypot-utledningen (review-funn 3, 2026-09-03: denne
 * funksjonen brukte tidligere en egen, løsere `√2 · max(uScale,vScale)`-
 * formel som kunne drifte fra `field.ts::windLayerMaxDecodeErrorKn`s
 * `hypot(uErr,vErr)`. Begge veier til samme resultat nå — se
 * `index.test.ts` for en likhetstest mot `field.ts`-varianten).
 */
export function computeMaxDecodeErrorKn(uScale: number, vScale: number): number {
  const oneSided = 0.5; // nearest — vind bruker aldri opp/ned (§9.5)
  return _combineChannelDecodeErrorsKn(oneSided * uScale, oneSided * vScale);
}

/** Alias for `field.ts::windLayerMaxDecodeErrorKn` — foretrukket når begge lag-objekter finnes. */
export { _windLayerMaxDecodeErrorKn as windLayerMaxDecodeErrorKnFromLayers };

/** §9.5: TWS-hardgrensen sammenlignes mot et vaktbånd. Speiler `expand.ts::twsExceedsHardLimit`. */
export function twsExceedsHardLimitWithGuardBand(
  decodedTwsKn: number,
  maxTwsKn: number,
  maxDecodeErrorKn: number,
): boolean {
  return decodedTwsKn > maxTwsKn - maxDecodeErrorKn;
}

/**
 * Alias for `computeLinearParams(min, max, bitsPerSample, "up")` — §9.3s
 * låste énsidighetsregel for Hs, som TS-typen ikke lar overstyre
 * (`roundingMode` er hardkodet, ikke et parameter).
 */
export function buildHsParams(min: number, max: number, bitsPerSample: 8 | 10 = 8): _QuantizationParams {
  return _computeLinearParams(min, max, bitsPerSample, "up");
}

/**
 * §3 punkt 3: strøm er MOT, ingen FRA-konvertering — denne funksjonen
 * finnes for å gjøre fraværet av en FRA-konvertering eksplisitt og
 * testbart (samme begrunnelse som `wind-codec.ts`s toppkommentar).
 */
export function currentComponentsToSample(u: number, v: number): _CurrentSample {
  return { u, v };
}

/**
 * Verifiserer at INGEN verdi i en gitt liste ville kode til rå sentinel
 * (§17 pkt. 10 — byggetids-garanti for `tools/weather-pack`s egen QA).
 */
export function verifiesSentinelNeverCollides(
  values: readonly number[],
  params: _QuantizationParams,
): boolean {
  return values.every((v) => _encodeLinear(v, params) !== params.sentinelRawValue);
}
