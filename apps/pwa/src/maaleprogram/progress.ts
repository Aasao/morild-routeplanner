/**
 * Måleprogrammets fremdrift og resultat-JSON (robusthet.md §6.4) — rene
 * funksjoner over et injisert lager (`StorageLike`), testbare uten
 * nettleser. Fremdriften lagres etter hver kjøring; lastes siden på nytt
 * mens programmet går (fanen forkastet, omstart), fortsetter det fra neste
 * ukjørte konfigurasjon, og avbruddet telles i `interruptions` og logges som
 * hendelse. Den halvferdige kjøringen som ble avbrutt, kjøres på nytt fra
 * start — ingen delvise tall lagres.
 */
import {
  MAX_INTERRUPTIONS_PER_RUN,
  PROGRAM_CONSTANTS,
  PROGRAM_SCHEMA,
  PROGRESS_STORAGE_KEY,
  type DummyVariant,
} from "./constants.js";
import type { RunSpec } from "./plan.js";
import { workerHeapSummary } from "../weather/measurement.js";

/** Den delmengden av `localStorage` vi bruker. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DeviceInfo {
  readonly userAgent: string;
  readonly hardwareConcurrency: number | null;
  /** `navigator.deviceMemory` (GB, grovt avrundet) — kun Chromium; null ellers. */
  readonly deviceMemoryGB: number | null;
}

/** Pakken programmet måler på — hentet én gang (spec-en: «pakke-hash i JSON»). */
export interface PackageIdentity {
  /** FNV-1a-64 (hex) over de sorterte blob-SHA-256-ene — se `packageFingerprint`. */
  readonly hash: string;
  readonly hashAlgorithm: "fnv1a64-over-sorterte-blob-sha256";
  readonly init: string;
  readonly blobCount: number;
  /** Medlemmer uten kontrollen. */
  readonly memberCount: number;
}

export type ProgramEventKind =
  | "program-start"
  | "resume"
  | "interruption"
  | "wake-lock-acquired"
  | "wake-lock-released"
  | "wake-lock-denied"
  | "visibility"
  | "run-error"
  | "package-mismatch"
  | "storage-error"
  | "program-done";

export interface ProgramEvent {
  readonly at: string;
  readonly kind: ProgramEventKind;
  readonly detail?: string;
}

/**
 * Ett medlem i én kjøring, som tuppel for å holde JSON-en kompakt:
 * `[memberIndex, workerSlot, searchMs, labelsCreated, decodeMs, workerHeapMB]`
 * (spec-en §6.4 pkt. 1, ordrett rekkefølge). `null` = ikke målt/ikke tilgjengelig.
 */
export type MemberTuple = readonly [
  memberIndex: number,
  workerSlot: number | null,
  searchMs: number | null,
  labelsCreated: number | null,
  decodeMs: number | null,
  workerHeapMB: number | null,
];

export interface RunRecord {
  /** Plass i kjøreplanen. */
  readonly index: number;
  readonly id: string;
  readonly kind: RunSpec["kind"];
  readonly pool: number | null;
  readonly k: number | null;
  readonly variant: DummyVariant | null;
  readonly repeat: number;
  readonly startedAt: string;
  /** Hele kjøringen (kontroll + medlemmer), ekskl. pause og dummy-oppstart. */
  readonly wallMs: number;
  /** Kontrollens rundtur (hovedtråd→Worker→hovedtråd). */
  readonly controlMs: number | null;
  /** Fra kontrollen var ferdig til siste medlem kom inn; null for solo/dummy. */
  readonly ensembleWallMs: number | null;
  readonly control: MemberTuple | null;
  /** Ikke-kontroll-medlemmer, sortert på memberIndex; tom for solo/dummy. */
  readonly members: readonly MemberTuple[];
  readonly errors: number;
  /** Om siden var skjult (visibilitychange) en gang under kjøringen. */
  readonly hiddenDuringRun: boolean;
}

export interface ProgramProgress {
  readonly schema: typeof PROGRAM_SCHEMA;
  readonly status: "running" | "done";
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly device: DeviceInfo;
  readonly package: PackageIdentity;
  /** Kjøreplanens id-er — gjenopptak krever samme plan. */
  readonly planIds: readonly string[];
  /** Neste ukjørte konfigurasjon (= `runs.length`). */
  readonly nextIndex: number;
  readonly runs: readonly RunRecord[];
  readonly events: readonly ProgramEvent[];
  readonly interruptions: number;
  /**
   * Avbrudd på AKTUELL `nextIndex` (nullstilles når en kjøring registreres).
   * En kjøring som selv krasjer fanen (f.eks. minne ved dummy-last) ville
   * ellers gjenopptas i det uendelige — se `isCrashLooping`. Valgfri så
   * fremdrift lagret før feltet fantes, tåles.
   */
  readonly interruptionsAtNext?: number;
}

export interface ProgramResult {
  readonly schema: typeof PROGRAM_SCHEMA;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** Alle konfigurasjoner i planen er kjørt. */
  readonly complete: boolean;
  readonly device: DeviceInfo;
  readonly package: PackageIdentity;
  readonly constants: typeof PROGRAM_CONSTANTS;
  readonly memberTupleFields: readonly string[];
  readonly interruptions: number;
  /** Om minst én Worker leverte `performance.memory` (D13.2 a). */
  readonly workerMemoryApi: boolean;
  readonly maxWorkerHeapMB: number | null;
  readonly plannedRuns: number;
  readonly runs: readonly RunRecord[];
  readonly events: readonly ProgramEvent[];
}

export const MEMBER_TUPLE_FIELDS = [
  "memberIndex",
  "workerSlot",
  "searchMs",
  "labelsCreated",
  "decodeMs",
  "workerHeapMB",
] as const;

/** FNV-1a 64-bit, hex. Deterministisk, uten `crypto.subtle` (som krever sikker kontekst). */
export function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

/** Pakkens identitet fra blob-hashene (rekkefølgeuavhengig). */
export function packageFingerprint(args: {
  readonly blobHashes: readonly string[];
  readonly init: string;
  readonly memberCount: number;
}): PackageIdentity {
  const sorted = [...args.blobHashes].sort();
  return {
    hash: fnv1a64(sorted.join("\n")),
    hashAlgorithm: "fnv1a64-over-sorterte-blob-sha256",
    init: args.init,
    blobCount: sorted.length,
    memberCount: args.memberCount,
  };
}

export function startProgress(args: {
  readonly now: string;
  readonly device: DeviceInfo;
  readonly pkg: PackageIdentity;
  readonly plan: readonly RunSpec[];
}): ProgramProgress {
  return {
    schema: PROGRAM_SCHEMA,
    status: args.plan.length === 0 ? "done" : "running",
    startedAt: args.now,
    finishedAt: args.plan.length === 0 ? args.now : null,
    device: args.device,
    package: args.pkg,
    planIds: args.plan.map((p) => p.id),
    nextIndex: 0,
    runs: [],
    events: [{ at: args.now, kind: "program-start", detail: `pakke ${args.pkg.hash}, ${args.plan.length} kjøringer` }],
    interruptions: 0,
  };
}

function isProgress(value: unknown): value is ProgramProgress {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Record<keyof ProgramProgress, unknown>>;
  return (
    v.schema === PROGRAM_SCHEMA &&
    (v.status === "running" || v.status === "done") &&
    typeof v.startedAt === "string" &&
    typeof v.nextIndex === "number" &&
    Array.isArray(v.runs) &&
    Array.isArray(v.events) &&
    Array.isArray(v.planIds) &&
    typeof v.interruptions === "number" &&
    typeof v.package === "object" &&
    v.package !== null
  );
}

/** Lagret fremdrift, eller null når ingen/ødelagt/annet skjema. Kaster aldri. */
export function loadProgress(storage: StorageLike): ProgramProgress | null {
  let raw: string | null;
  try {
    raw = storage.getItem(PROGRESS_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isProgress(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Lagrer; `false` når lageret nekter (kvote, privat modus) — kalleren logger det. */
export function saveProgress(storage: StorageLike, progress: ProgramProgress): boolean {
  try {
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function clearProgress(storage: StorageLike, extraKeys: readonly string[] = []): void {
  for (const key of [PROGRESS_STORAGE_KEY, ...extraKeys]) {
    try {
      storage.removeItem(key);
    } catch {
      /* ingenting å rydde i et lager som ikke virker */
    }
  }
}

export type ResumeDecision =
  | { readonly kind: "resume"; readonly progress: ProgramProgress }
  | { readonly kind: "done"; readonly progress: ProgramProgress }
  /** Planen er endret (andre konstanter) — fremdriften kan ikke gjenopptas ærlig. */
  | { readonly kind: "plan-changed"; readonly progress: ProgramProgress }
  | { readonly kind: "none" };

/**
 * Avgjør hva en sideinnlasting skal gjøre med lagret fremdrift. En lagret
 * `running` betyr at siden forsvant midt i programmet: det telles som ett
 * avbrudd og logges, og programmet fortsetter på `nextIndex`.
 */
export function resumeFrom(
  stored: ProgramProgress | null,
  plan: readonly RunSpec[],
  now: string,
): ResumeDecision {
  if (stored === null) return { kind: "none" };
  if (stored.status === "done") return { kind: "done", progress: stored };
  const ids = plan.map((p) => p.id);
  const samePlan = ids.length === stored.planIds.length && ids.every((id, i) => stored.planIds[i] === id);
  if (!samePlan || stored.nextIndex > ids.length) return { kind: "plan-changed", progress: stored };
  const at = plan[stored.nextIndex];
  const progress: ProgramProgress = {
    ...stored,
    interruptions: stored.interruptions + 1,
    interruptionsAtNext: (stored.interruptionsAtNext ?? 0) + 1,
    events: [
      ...stored.events,
      {
        at: now,
        kind: "interruption",
        detail: `siden ble lastet på nytt; fortsetter på kjøring ${stored.nextIndex}${at ? ` (${at.id})` : ""}`,
      },
    ],
  };
  return { kind: "resume", progress };
}

/**
 * Samme pakke gjennom hele programmet (§6.4): ved gjenopptak må pakken som
 * hentes nå ha samme fingeravtrykk som den programmet startet med — ellers
 * ville et cron-bytte av pekeren blande to værpakker i én måleserie.
 */
export function packageCheck(stored: ProgramProgress, fetched: PackageIdentity): "same" | "mismatch" {
  return stored.package.hash === fetched.hash ? "same" : "mismatch";
}

/**
 * Har samme kjøring avbrutt siden `MAX_INTERRUPTIONS_PER_RUN` ganger? Da
 * er det trolig kjøringen selv som tar ned fanen, og den hoppes over (logges
 * som feil) i stedet for å gjenopptas i en evig omlastingsløkke.
 */
export function isCrashLooping(progress: ProgramProgress): boolean {
  return (progress.interruptionsAtNext ?? 0) >= MAX_INTERRUPTIONS_PER_RUN;
}

export function appendEvent(progress: ProgramProgress, event: ProgramEvent): ProgramProgress {
  return { ...progress, events: [...progress.events, event] };
}

/** Legger til en ferdig kjøring og flytter `nextIndex`; siste kjøring ⇒ `done`. */
export function recordRun(progress: ProgramProgress, run: RunRecord, now: string): ProgramProgress {
  const nextIndex = progress.nextIndex + 1;
  const done = nextIndex >= progress.planIds.length;
  return {
    ...progress,
    runs: [...progress.runs, run],
    nextIndex,
    interruptionsAtNext: 0,
    status: done ? "done" : "running",
    finishedAt: done ? now : null,
    events: done ? [...progress.events, { at: now, kind: "program-done" }] : progress.events,
  };
}

/** Resultat-JSON-en (skjema `morild-maaleprogram/1`) — også fra et ufullstendig program. */
export function buildProgramResult(progress: ProgramProgress): ProgramResult {
  const tuples = progress.runs.flatMap((r) => (r.control === null ? r.members : [r.control, ...r.members]));
  const heap = workerHeapSummary(tuples.map((t) => ({ workerHeapMB: t[5] })));
  return {
    schema: PROGRAM_SCHEMA,
    startedAt: progress.startedAt,
    finishedAt: progress.finishedAt,
    complete: progress.status === "done" && progress.runs.length === progress.planIds.length,
    device: progress.device,
    package: progress.package,
    constants: PROGRAM_CONSTANTS,
    memberTupleFields: MEMBER_TUPLE_FIELDS,
    interruptions: progress.interruptions,
    workerMemoryApi: heap.workerMemoryApi,
    maxWorkerHeapMB: heap.maxWorkerHeapMB,
    plannedRuns: progress.planIds.length,
    runs: progress.runs,
    events: progress.events,
  };
}
