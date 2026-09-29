/**
 * Nettbrett-målingen (ADR-0005 port 1, robusthet.md §7 D10.2 b, vedtatt
 * 2026-09-05): én kopierbar JSON per kjøring med alt panelet trenger for å
 * skille «for få kjerner», «små kjerner» og «dyrere etiketter på ARM» fra
 * hverandre — per medlem, ikke bare veggklokke. Ren datamodell + ren
 * bygging; DOM-en lever i `weather-ui.ts`.
 *
 * **Skjemaversjon (§6.4, D13.2 a):** `workerHeapMB`/`workerSlot` per medlem
 * og `workerMemoryApi`/`maxWorkerHeapMB` på toppnivå er lagt til UTEN å
 * bumpe `morild-nettbrett-maaling/1`: ingen eksisterende felt har endret
 * navn, type eller betydning, så en leser av gamle filer bare ser feltene
 * mangle (= «ikke målt da»). En bump ville gjort de tre allerede innsamlede
 * nettbrett-JSON-ene «foreldet» uten at noe i dem var blitt feil.
 */
import type { MemberOutcome } from "./ensemble.js";
import type { WavePointLoad } from "./wave-points-client.js";

/**
 * Punktbølgen kjøringen var fryst på (ADR-0007, `docs/specs/punktbolge.md`
 * §3): `hash` og `fetchedAtEpochS` så to målinger kan sammenlignes på
 * samme bølge. Lagt til uten skjemabump (samme regel som over).
 */
export interface WavePointsMeasurement {
  readonly source: WavePointLoad["kind"];
  readonly hash: string | null;
  readonly fetchedAtEpochS: number | null;
  readonly sourceStatus: "ok" | "degraded" | "failed" | null;
  readonly points: number | null;
}

export function waveMeasurement(load: WavePointLoad): WavePointsMeasurement {
  if (load.kind === "mangler") {
    return { source: "mangler", hash: null, fetchedAtEpochS: null, sourceStatus: null, points: null };
  }
  return {
    source: load.kind,
    hash: load.set.hash,
    fetchedAtEpochS: load.set.fetchedAtEpochS,
    sourceStatus: load.set.sourceStatus,
    points: load.set.points.length,
  };
}

export interface MemberMeasurement {
  readonly memberIndex: number;
  readonly classification: MemberOutcome["classification"];
  /** Rekkefølgen svaret kom inn i (0 = først). */
  readonly arrivalOrder: number;
  /** Orakelets rang (D10.5, 0 = søkt først); null uten orakel. Mot `durationS` gir dette orakelets treffsikkerhet. */
  readonly oracleRank: number | null;
  /** Rundtur hovedtråd→worker→hovedtråd. */
  readonly elapsedMs: number | null;
  readonly decodeMs: number | null;
  readonly fieldMs: number | null;
  readonly searchMs: number | null;
  /** Bail-out-profilen (kun kontrollen, egen fase). */
  readonly bailoutMs: number | null;
  readonly labelsCreated: number | null;
  readonly iterations: number | null;
  /** Realisert seilingstid — for orakelets treffsikkerhet (D10.5). */
  readonly durationS: number | null;
  readonly reachesDestination: boolean | null;
  /** Heap i Worker-konteksten etter søket (MB); null = API-et finnes ikke der (eller feil). */
  readonly workerHeapMB: number | null;
  /** Pool-plassen (0…pool−1); null for kontroll-Workeren og ved feil. */
  readonly workerSlot: number | null;
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
  /**
   * Om minst én Worker leverte `performance.memory` (D13.2 a). `false` ⇒
   * ingen per-Worker-heap finnes i denne målingen: da gjelder den analytiske
   * grensen (§6.2) og en manuell kontroll — ikke et tall vi later som vi har.
   */
  readonly workerMemoryApi: boolean;
  /** Største `workerHeapMB` over kontroll + medlemmer; null når API-et mangler. */
  readonly maxWorkerHeapMB: number | null;
  readonly control: MemberMeasurement | null;
  /**
   * Veggklokke fra kontrollen var ferdig til siste medlem kom inn.
   * **Inkluderer nødhavnprofilen** (`control.bailoutMs`, ~2,2 s på Tab S7
   * FE): den kjører sekvensielt på kontroll-Workeren FØR medlemmene startes
   * (`runEnsemble`). Selve ensemblet er `ensembleWallMs − control.bailoutMs`
   * — det er det tallet måleprogrammets poolsveip (uten nødhavn) sammenlignes med.
   */
  readonly ensembleWallMs: number | null;
  readonly members: readonly MemberMeasurement[];
  /** Punktbølgen (ADR-0007); `null` = ikke kjent for denne målingen. */
  readonly wavePoints: WavePointsMeasurement | null;
}

export function memberMeasurement(outcome: MemberOutcome, arrivalOrder: number): MemberMeasurement {
  const d = outcome.result?.diagnostics;
  return {
    memberIndex: outcome.memberIndex,
    classification: outcome.classification,
    arrivalOrder,
    oracleRank: outcome.oracleRank ?? null,
    elapsedMs: outcome.elapsedMs ?? null,
    decodeMs: outcome.workerTiming?.decodeMs ?? null,
    fieldMs: outcome.workerTiming?.fieldMs ?? null,
    searchMs: outcome.workerTiming?.searchMs ?? null,
    bailoutMs: outcome.workerTiming?.bailoutMs ?? null,
    labelsCreated: d?.labelsCreated ?? null,
    iterations: d?.iterations ?? null,
    durationS: outcome.result?.totals.durationS ?? null,
    reachesDestination: outcome.result?.safety.reachesDestination ?? null,
    workerHeapMB: outcome.workerTiming?.workerHeapMB ?? null,
    workerSlot: outcome.workerTiming?.workerSlot ?? null,
  };
}

/** Toppnivå-feltene for per-Worker heap (D13.2 a) — ren, delt med måleprogrammet. */
export function workerHeapSummary(
  measurements: readonly { readonly workerHeapMB: number | null }[],
): { readonly workerMemoryApi: boolean; readonly maxWorkerHeapMB: number | null } {
  const heaps = measurements.map((m) => m.workerHeapMB).filter((h): h is number => h !== null);
  return {
    workerMemoryApi: heaps.length > 0,
    maxWorkerHeapMB: heaps.length > 0 ? Math.max(...heaps) : null,
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
  readonly wavePoints?: WavePointsMeasurement | null | undefined;
}): EnsembleMeasurement {
  const toMB = (b: number | undefined): number | null =>
    b === undefined ? null : Math.round(b / (1024 * 1024));
  const heap = workerHeapSummary(args.control === null ? args.members : [args.control, ...args.members]);
  return {
    schema: "morild-nettbrett-maaling/1",
    runAt: args.env.now(),
    userAgent: args.env.userAgent,
    hardwareConcurrency: args.env.hardwareConcurrency ?? null,
    poolSize: args.poolSize,
    jsHeapSizeLimitMB: toMB(args.env.memory?.jsHeapSizeLimit),
    usedJSHeapSizeMB: toMB(args.env.memory?.usedJSHeapSize),
    periodicBackgroundSyncSupported: args.env.periodicBackgroundSyncSupported,
    workerMemoryApi: heap.workerMemoryApi,
    maxWorkerHeapMB: heap.maxWorkerHeapMB,
    control: args.control,
    ensembleWallMs: args.ensembleWallMs,
    members: [...args.members].sort((a, b) => a.memberIndex - b.memberIndex),
    wavePoints: args.wavePoints ?? null,
  };
}
