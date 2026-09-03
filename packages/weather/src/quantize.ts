/**
 * Kvantiseringsprimitiver — den delte kjernen `tools/weather-pack` (batch-
 * encoder, kommer i en senere bølge) og `packages/weather` (klient-dekoder)
 * begge skal bruke, slik at ingen av dem kan drifte fra hverandre.
 *
 * Grunnlag: `docs/specs/vaerpakker.md` §9 (LÅST), §9.9 (kontrakten under,
 * ordrett), §9.6 (sentinelverdi).
 *
 * Rent og synkront — ingen I/O, ingen tilstand (samme regel som
 * `docs/specs/rutemotor.md` §5.1 stiller til rutemotoren selv).
 */

/**
 * `nearest` er vanlig avrunding. `up`/`down` runder **alltid** i én retning
 * i kompaktindeks-rommet (se `compactToRaw` under) — brukt av Hs (alltid
 * `up`, §9.3) og Tp (`down` når feltet mater bratthetsderating, §9.5,
 * umålt terskel).
 */
export type RoundingMode = "nearest" | "up" | "down";

/**
 * §9.9 — låst kontrakt, ikke lenger placeholder. `sentinelRawValue` er en
 * TS-literal `255`, bevisst: sentinelen skal ALDRI kunne variere per felt
 * eller bit-bredde (se `docs/specs/vaerpakker.md` §9.6 og endringsloggen
 * her for hvordan dette håndteres ved 10-bit, der 255 ikke er toppkoden).
 */
export interface QuantizationParams {
  /** 8 for vind/strøm/Hs/Tp i normaldrift. 10 kun for de to smale
   *  5 km-unntakene (§9.1 pkt. 3). 16 reservert via formatVersion, ikke
   *  brukt i v2.0. */
  readonly bitsPerSample: 8 | 10;
  /** Verdi per kompakt-indekstrinn (se `compactToRaw`/`rawToCompact`). */
  readonly scale: number;
  /** Fysisk verdi ved kompakt indeks 0. */
  readonly offset: number;
  readonly roundingMode: RoundingMode;
  readonly sentinelRawValue: 255;
}

export const SENTINEL_RAW_VALUE = 255 as const;

/** Antall rå byteverdier bit-bredden kan uttrykke (256 for 8-bit, 1024 for 10-bit). */
export function rawCodeSpace(bitsPerSample: 8 | 10): number {
  return 2 ** bitsPerSample;
}

/**
 * **Sentinel-hull, generalisert over bit-bredde** (avvik/presisering —
 * dokumentert i spec-ens endringslogg, `docs/specs/vaerpakker.md` §19,
 * 2026-09-03): §9.9 låser `sentinelRawValue` til den bokstavelige verdien
 * `255` for BÅDE 8-bit og 10-bit, ikke «toppkoden». For 8-bit faller dette
 * sammen med toppkoden (2⁸−1 = 255), og resultatet er identisk med «reserver
 * øverste kode» — ingen endring i den dominerende, testede stien. For 10-bit
 * (2¹⁰ = 1024 koder) er `255` en verdi midt i det gyldige området, ikke
 * toppen. Regelen som gjør begge tilfellene konsistente og som holder
 * `decode(encode(x))` eksakt (bortsett fra selve kvantiseringsfeilen): rå
 * byteverdier telles **fortløpende og hoppes over ved 255** — en
 * «kompakt indeks» 0..N-2 mappes til rå byteverdi `ci < 255 ? ci : ci + 1`.
 * For 8-bit blir N-2 = 254, og `ci` når aldri 255, så formelen reduserer
 * seg nøyaktig til «koder 0..254, ingen hull» — bit-for-bit den intuitive
 * 8-bit-oppførselen. For 10-bit brukes hele restarealet (1023 brukbare
 * koder), ikke bare de 254 laveste — én ekstra kvantiseringsnyanse der det
 * faktisk trengs mest (10-bit finnes nettopp for P90-halen, §9.1 pkt. 3).
 */
export function maxCompactIndex(bitsPerSample: 8 | 10): number {
  return rawCodeSpace(bitsPerSample) - 2; // −1 for sentinelen, −1 for at indeks er 0-basert
}

export function compactToRaw(compactIndex: number): number {
  return compactIndex < SENTINEL_RAW_VALUE ? compactIndex : compactIndex + 1;
}

export function rawToCompact(raw: number): number {
  return raw < SENTINEL_RAW_VALUE ? raw : raw - 1;
}

function roundCompact(t: number, mode: RoundingMode): number {
  if (mode === "up") return Math.ceil(t);
  if (mode === "down") return Math.floor(t);
  return Math.round(t);
}

/**
 * Regner skala/offset for et lineært kanalområde `[lo, hi]` slik at
 * `hi` alltid er representerbart uten å bryte sentinel-garantien (§9.6):
 * det reelle maksimumet i subflisen skal aldri kunne kode til 255.
 *
 * Degenerert område (`lo === hi`, hele subflisen er konstant i denne
 * kanalen): `scale = 0`. Dekoding blir da eksakt `lo` for enhver gyldig
 * verdi — kvantiseringsfeilen er null, ikke bare liten (dette er
 * mekanismen bak golden-bro-testen som krever `maxDecodeErrorKn = 0`,
 * `src/golden-bridge.test.ts`).
 */
export function computeLinearParams(
  lo: number,
  hi: number,
  bitsPerSample: 8 | 10,
  roundingMode: RoundingMode,
): QuantizationParams {
  if (!(hi >= lo)) {
    throw new Error(`computeLinearParams: hi (${hi}) < lo (${lo})`);
  }
  const levels = maxCompactIndex(bitsPerSample);
  const span = hi - lo;
  const scale = span > 0 ? span / levels : 0;
  return Object.freeze({
    bitsPerSample,
    scale,
    offset: lo,
    roundingMode,
    sentinelRawValue: SENTINEL_RAW_VALUE,
  });
}

/**
 * Koder en fysisk verdi til rå byte. `undefined`/`NaN` → sentinel (§9.6).
 * Klipper til det representerbare området — en verdi utenfor `[lo, hi]`
 * (kan skje ved gridsamplingsfeil ved kant av subflisen) kodes til
 * nærmeste ende, ikke kastet.
 */
export function encodeLinear(
  value: number | undefined,
  params: QuantizationParams,
): number {
  if (value === undefined || Number.isNaN(value)) {
    return params.sentinelRawValue;
  }
  const levels = maxCompactIndex(params.bitsPerSample);
  if (params.scale === 0) {
    return compactToRaw(0);
  }
  const t = (value - params.offset) / params.scale;
  const ci = Math.max(0, Math.min(levels, roundCompact(t, params.roundingMode)));
  return compactToRaw(ci);
}

/** Dekoder rå byte til fysisk verdi. Sentinel → `undefined` (§9.6, §12). */
export function decodeLinear(
  raw: number,
  params: QuantizationParams,
): number | undefined {
  if (raw === params.sentinelRawValue) return undefined;
  const ci = rawToCompact(raw);
  return params.offset + ci * params.scale;
}

// --------------------------------------------------------------- vinkelkanal

/**
 * Sykliske kanaler (bølgeretning) har intet naturlig `lo/hi` — de dekker
 * alltid `[0, 360)` med wraparound, samme prinsipp som
 * `packages/routing/test-fixtures/pack-degradation.ts`s `"vinkel"`-kanal,
 * men med sentinel-hullet (over) slik at «retning mangler» er
 * representerbart (§12: `waves().fromDeg` er valgfri).
 */
export function computeAngleParams(
  bitsPerSample: 8 | 10,
  roundingMode: RoundingMode = "nearest",
): QuantizationParams {
  const steps = maxCompactIndex(bitsPerSample) + 1;
  return Object.freeze({
    bitsPerSample,
    scale: 360 / steps,
    offset: 0,
    roundingMode,
    sentinelRawValue: SENTINEL_RAW_VALUE,
  });
}

export function encodeAngleDeg(
  deg: number | undefined,
  params: QuantizationParams,
): number {
  if (deg === undefined || Number.isNaN(deg)) return params.sentinelRawValue;
  const steps = maxCompactIndex(params.bitsPerSample) + 1;
  const norm = ((deg % 360) + 360) % 360;
  const ci = ((Math.round(norm / params.scale) % steps) + steps) % steps;
  return compactToRaw(ci);
}

export function decodeAngleDeg(
  raw: number,
  params: QuantizationParams,
): number | undefined {
  if (raw === params.sentinelRawValue) return undefined;
  const ci = rawToCompact(raw);
  return ci * params.scale;
}
