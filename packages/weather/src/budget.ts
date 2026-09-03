/**
 * Budsjett-hjelper (`docs/specs/vaerpakker.md` §8): regner en overslags-
 * pakkestørrelse for en gitt bbox/horisont, etter §8s formler. Brukes i
 * bølge 2 for F2.2-regelen (≤ 30 MB, budsjettrevisjon til ~40 MB hvis en
 * ekte, målt pakke lander over). Dette er ESTIMATET — §8 er eksplisitt om
 * at regnskapet skal reverifiseres mot en faktisk bygget pakke
 * (`src/budget.test.ts` gjør en liten, ekte krysssjekk av per-byte-
 * konstantene mot `package-format.ts`).
 *
 * Formlene følger §8s tabell rad for rad — se JSDoc per funksjon for hvilken
 * rad.
 */
import { KM_PER_DEG_LAT, lonStepDegForKm } from "./tiles.js";

export interface BudgetBbox {
  readonly latMin: number;
  readonly latMax: number;
  readonly lonMin: number;
  readonly lonMax: number;
}

function nodeCount(bbox: BudgetBbox, resolutionKm: number): number {
  const latSpanKm = (bbox.latMax - bbox.latMin) * KM_PER_DEG_LAT;
  const midLat = (bbox.latMin + bbox.latMax) / 2;
  const lonStepDeg = lonStepDegForKm(resolutionKm, midLat);
  const lonNodes = (bbox.lonMax - bbox.lonMin) / lonStepDeg + 1;
  const latNodes = latSpanKm / resolutionKm + 1;
  return Math.ceil(latNodes) * Math.ceil(lonNodes);
}

export interface WindBudgetInput {
  readonly bbox: BudgetBbox;
  readonly resolutionKm: number; // 2,5 km, låst (§9.1)
  readonly memberCount: number; // 30
  readonly memberHorizonH: number; // 48, låst (§9.1 pkt. 4)
  readonly controlHorizonH: number; // ~61–66
  readonly timeStepH: number; // 1, låst for harde felt (§9.2)
  readonly bitsPerSample: 8 | 10; // 8 i normaldrift
}

/** §8 rad "Vind, kontroll": 2 var × punkt × full horisont × bit. */
export function windControlBytes(input: WindBudgetInput): number {
  const points = nodeCount(input.bbox, input.resolutionKm);
  const steps = Math.floor(input.controlHorizonH / input.timeStepH) + 1;
  const bytesPerSample = input.bitsPerSample <= 8 ? 1 : 2;
  return 2 * points * steps * bytesPerSample;
}

/** §8 rad "Vind, 30 medlemmer": 2 var × medlemmer × punkt × (0–48t) × bit. */
export function windMembersBytes(input: WindBudgetInput): number {
  const points = nodeCount(input.bbox, input.resolutionKm);
  const steps = Math.floor(input.memberHorizonH / input.timeStepH) + 1;
  const bytesPerSample = input.bitsPerSample <= 8 ? 1 : 2;
  return 2 * input.memberCount * points * steps * bytesPerSample;
}

export interface CurrentBudgetInput {
  readonly bbox: BudgetBbox;
  /** Andel av bboxen som er kystsone (§9.4) — [0,1]. */
  readonly coastalFraction: number;
  readonly coastalResolutionKm: number; // 0,8 km
  readonly offshoreResolutionKm: number; // 1,6 km
  readonly horizonH: number;
  readonly timeStepH: number;
  readonly bitsPerSample: 8 | 10;
}

/** §8 rad "Strøm": sonevariert nett — kystsone 800 m, utaskjærs 1,6 km (§9.4). */
export function currentBytes(input: CurrentBudgetInput): number {
  const steps = Math.floor(input.horizonH / input.timeStepH) + 1;
  const bytesPerSample = input.bitsPerSample <= 8 ? 1 : 2;
  const coastalPoints =
    nodeCount(input.bbox, input.coastalResolutionKm) * input.coastalFraction;
  const offshorePoints =
    nodeCount(input.bbox, input.offshoreResolutionKm) * (1 - input.coastalFraction);
  return 2 * (coastalPoints + offshorePoints) * steps * bytesPerSample;
}

export interface WaveBudgetInput {
  readonly bbox: BudgetBbox;
  readonly resolutionKm: number;
  readonly horizonH: number;
  readonly timeStepH: number;
  readonly bitsPerSample: 8 | 10;
  /** Hs + Tp (+ retning) — 2 eller 3 kanaler. */
  readonly channels: 2 | 3;
}

/** §8 rad "Bølger": Hs (+Tp, +retning), samme størrelsesorden som strøm. */
export function waveBytes(input: WaveBudgetInput): number {
  const points = nodeCount(input.bbox, input.resolutionKm);
  const steps = Math.floor(input.horizonH / input.timeStepH) + 1;
  const bytesPerSample = input.bitsPerSample <= 8 ? 1 : 2;
  return input.channels * points * steps * bytesPerSample;
}

export interface MetadataBudgetInput {
  readonly subtileCount: number;
  readonly fieldCount: number;
  readonly timeSteps: number;
  /** Bytes per (subflis, felt, tidssteg) — scale+offset = 2×f64 = 16 byte i denne implementasjonen. */
  readonly bytesPerSubtileTimestepField?: number;
}

/** §8 rad "Metadata": fast overhead × antall subfliser × antall felt × tidssteg. */
export function metadataBytes(input: MetadataBudgetInput): number {
  const perUnit = input.bytesPerSubtileTimestepField ?? 16;
  return input.subtileCount * input.fieldCount * input.timeSteps * perUnit;
}

export interface PackageBudgetInput {
  readonly wind: WindBudgetInput;
  readonly current: CurrentBudgetInput;
  readonly wave: WaveBudgetInput;
  readonly metadata: MetadataBudgetInput;
  readonly tideMetAlertsBytes?: number;
  /** §8/§19: delta+gzip gir 1,5–2,5× reduksjon på de rå tallene. */
  readonly deltaGzipFactor?: number;
}

export interface PackageBudgetBreakdown {
  readonly windControlBytes: number;
  readonly windMembersBytes: number;
  readonly currentBytes: number;
  readonly waveBytes: number;
  readonly metadataBytes: number;
  readonly tideMetAlertsBytes: number;
  readonly rawTotalBytes: number;
  readonly estimatedTotalBytes: number;
  readonly deltaGzipFactor: number;
}

/** §8s fulle regnskap — se hver post-funksjon for hvilken tabellrad den svarer til. */
export function estimatePackageBudget(input: PackageBudgetInput): PackageBudgetBreakdown {
  const wc = windControlBytes(input.wind);
  const wm = windMembersBytes(input.wind);
  const cur = currentBytes(input.current);
  const wav = waveBytes(input.wave);
  const meta = metadataBytes(input.metadata);
  const tideMetAlerts = input.tideMetAlertsBytes ?? 0.05 * 1024 * 1024;
  const rawTotal = wc + wm + cur + wav + meta + tideMetAlerts;
  const deltaGzipFactor = input.deltaGzipFactor ?? 1 / 2; // midtpunkt av 1,5–2,5× (§8, §19)
  return {
    windControlBytes: wc,
    windMembersBytes: wm,
    currentBytes: cur,
    waveBytes: wav,
    metadataBytes: meta,
    tideMetAlertsBytes: tideMetAlerts,
    rawTotalBytes: rawTotal,
    estimatedTotalBytes: rawTotal * deltaGzipFactor,
    deltaGzipFactor,
  };
}

/** ≤ 30 MB (F2.2). Overstiges dette, gjelder budsjettregelen i §8 (degrader, flagg, aldri stille kutt). */
export const BUDGET_LIMIT_BYTES = 30 * 1024 * 1024;
/** Betinget revisjon (§8) hvis en ekte, målt pakke lander over grensen. */
export const BUDGET_REVISED_LIMIT_BYTES = 40 * 1024 * 1024;
