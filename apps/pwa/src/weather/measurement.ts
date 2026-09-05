/**
 * Nettbrett-målingen (ADR-0005 port 1, robusthet.md §7 D10.2 b, vedtatt
 * 2026-09-05): én kopierbar JSON per kjøring med alt panelet trenger for å
 * skille «for få kjerner», «små kjerner» og «dyrere etiketter på ARM» fra
 * hverandre — per medlem, ikke bare veggklokke. Ren datamodell + ren
 * bygging; DOM-en lever i `weather-ui.ts`.
 */
import type { MemberOutcome } from "./ensemble.js";

export interface MemberMeasurement {
  readonly memberIndex: number;
  readonly classification: MemberOutcome["classification"];
  /** Rekkefølgen svaret kom inn i (0 = først) — orakelrang når verste-først-orakelet kommer (D10.5). */
  readonly arrivalOrder: number;
  /** Rundtur hovedtråd→worker→hovedtråd. */
  readonly elapsedMs: number | null;
  readonly decodeMs: number | null;
  readonly fieldMs: number | null;
  readonly searchMs: number | null;
  readonly labelsCreated: number | null;
  readonly iterations: number | null;
  /** Realisert seilingstid — for orakelets treffsikkerhet (D10.5). */
  readonly durationS: number | null;
  readonly reachesDestination: boolean | null;
}

export interface EnsembleMeasurement {
  readonly schema: "morild-nettbrett-maaling/1";
  readonly runAt: string;
  readonly userAgent: string;
  readonly hardwareConcurrency: number | null;
  readonly poolSize: number;
  /** `performance.memory` finnes bare i Chromium; ellers null (N2: manglende data vises). */
  readonly jsHeapSizeLimitMB: number | null;
  readonly usedJSHeapSizeMB: number | null;
  readonly periodicBackgroundSyncSupported: boolean;
  readonly control: MemberMeasurement | null;
  /** Veggklokke fra kontrollen var ferdig til siste medlem kom inn. */
  readonly ensembleWallMs: number | null;
  readonly members: readonly MemberMeasurement[];
}

export function memberMeasurement(outcome: MemberOutcome, arrivalOrder: number): MemberMeasurement {
  const d = outcome.result?.diagnostics;
  return {
    memberIndex: outcome.memberIndex,
    classification: outcome.classification,
    arrivalOrder,
    elapsedMs: outcome.elapsedMs ?? null,
    decodeMs: outcome.workerTiming?.decodeMs ?? null,
    fieldMs: outcome.workerTiming?.fieldMs ?? null,
    searchMs: outcome.workerTiming?.searchMs ?? null,
    labelsCreated: d?.labelsCreated ?? null,
    iterations: d?.iterations ?? null,
    durationS: outcome.result?.totals.durationS ?? null,
    reachesDestination: outcome.result?.safety.reachesDestination ?? null,
  };
}

interface MemoryLike {
  readonly jsHeapSizeLimit?: number;
  readonly usedJSHeapSize?: number;
}

/** Miljøfakta lest fra nettleseren — injiserbart for tester. */
export interface MeasurementEnvironment {
  readonly userAgent: string;
  readonly hardwareConcurrency: number | undefined;
  readonly memory: MemoryLike | undefined;
  readonly periodicBackgroundSyncSupported: boolean;
  readonly now: () => string;
}

export function browserMeasurementEnvironment(): MeasurementEnvironment {
  const perf = performance as unknown as { readonly memory?: MemoryLike };
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    memory: perf.memory,
    periodicBackgroundSyncSupported:
      typeof ServiceWorkerRegistration !== "undefined" &&
      "periodicSync" in ServiceWorkerRegistration.prototype,
    now: () => new Date().toISOString(),
  };
}

export function buildEnsembleMeasurement(args: {
  readonly env: MeasurementEnvironment;
  readonly poolSize: number;
  readonly control: MemberMeasurement | null;
  readonly ensembleWallMs: number | null;
  readonly members: readonly MemberMeasurement[];
}): EnsembleMeasurement {
  const toMB = (b: number | undefined): number | null =>
    b === undefined ? null : Math.round(b / (1024 * 1024));
  return {
    schema: "morild-nettbrett-maaling/1",
    runAt: args.env.now(),
    userAgent: args.env.userAgent,
    hardwareConcurrency: args.env.hardwareConcurrency ?? null,
    poolSize: args.poolSize,
    jsHeapSizeLimitMB: toMB(args.env.memory?.jsHeapSizeLimit),
    usedJSHeapSizeMB: toMB(args.env.memory?.usedJSHeapSize),
    periodicBackgroundSyncSupported: args.env.periodicBackgroundSyncSupported,
    control: args.control,
    ensembleWallMs: args.ensembleWallMs,
    members: [...args.members].sort((a, b) => a.memberIndex - b.memberIndex),
  };
}
