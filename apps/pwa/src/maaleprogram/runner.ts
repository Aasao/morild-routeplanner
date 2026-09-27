/**
 * Måleprogrammets kjøring (robusthet.md §6.4, D13.5 bolk 1). Ingen ny
 * motorlogikk: hver kjøring er `runEnsemble` fra `weather/ensemble.ts` med
 * samme `weather-routing.worker.ts` og samme jobbliste som appens værflyt
 * (`prepareEnsembleInputs`), hentet ÉN gang.
 *
 * - **Poolsveip:** `runEnsemble(alle jobber, pool, …)` med verste-først som
 *   i appen, men uten perturbasjon og nødhavnprofil.
 * - **Solo («ett medlem alene på én Worker»):** `runEnsemble([kontrolljobben],
 *   1, …)` uten nødhavnprofil. `runEnsemble` kjører alltid kontrollen alene
 *   på en egen, fersk Worker før poolen — med en jobbliste som bare
 *   inneholder kontrollen, er det nøyaktig ett `plan-route-member` på én
 *   Worker, via den eksisterende protokollen. Ingen ny meldingstype.
 * - **Solo + dummy-last:** som solo, mens k dummy-Workere
 *   (`workers/dummy-load.worker.ts`) går; de startes før, meldes klare,
 *   får `DUMMY_SETTLE_MS` innsvingning og termineres etter målesøket.
 *
 * All I/O er injisert (`RunnerDeps`) — kjøringen kan testes med attrapp-
 * Workere; DOM-en lever i `ui.ts`.
 */
import { runEnsemble, type MemberJob, type MemberOutcome, type WorkerFactory } from "../weather/ensemble.js";
import type { EnsembleInputs } from "../weather/pipeline.js";
import { DUMMY_SETTLE_MS, DUMMY_STREAM_BYTES, PAUSE_MS, type DummyVariant } from "./constants.js";
import type { RunSpec } from "./plan.js";
import type { MemberTuple, RunRecord } from "./progress.js";

/** Meldinger til/fra dummy-Workeren — strukturell kopi av `workers/dummy-load.worker.ts`. */
export interface StartDummyMessage {
  readonly type: "start-dummy";
  readonly variant: DummyVariant;
  readonly streamBytes: number;
}
export interface DummyReadyMessage {
  readonly type: "dummy-ready";
  readonly variant: DummyVariant;
}

export interface DummyWorkerLike {
  postMessage(message: StartDummyMessage): void;
  addEventListener(type: "message", listener: (ev: MessageEvent<DummyReadyMessage>) => void, options?: { once?: boolean }): void;
  addEventListener(type: "error", listener: (ev: ErrorEvent) => void, options?: { once?: boolean }): void;
  terminate(): void;
}

export interface RunnerDeps {
  readonly workerFactory: WorkerFactory;
  readonly dummyFactory: () => DummyWorkerLike;
  /** `performance.now()`. */
  readonly clockMs: () => number;
  readonly now: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  /** Sant hvis siden har vært skjult siden forrige kall (nullstilles ved kall). */
  readonly takeHiddenFlag: () => boolean;
}

const round1 = (x: number | null | undefined): number | null =>
  x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;

/** Ett utfall som tuppel — se `MemberTuple`. */
export function memberTuple(outcome: MemberOutcome): MemberTuple {
  const t = outcome.workerTiming;
  return [
    outcome.memberIndex,
    t?.workerSlot ?? null,
    round1(t?.searchMs),
    outcome.result?.diagnostics.labelsCreated ?? null,
    round1(t?.decodeMs),
    t?.workerHeapMB ?? null,
  ];
}

/**
 * Ferske kopier av flisbufferne: `runEnsemble` overfører (transfer) dem til
 * Workerne, og måleprogrammet kjører samme jobbliste 75 ganger.
 */
export function cloneJobs(jobs: readonly MemberJob[]): MemberJob[] {
  return jobs.map((j) => ({
    ...j,
    tiles: j.tiles.map((t) => ({ ...t, windBuffer: t.windBuffer.slice(0) })),
  }));
}

function startDummies(deps: RunnerDeps, k: number, variant: DummyVariant): Promise<DummyWorkerLike[]> {
  const workers = Array.from({ length: k }, () => deps.dummyFactory());
  const ready = workers.map(
    (w) =>
      new Promise<void>((resolve, reject) => {
        w.addEventListener("message", () => resolve(), { once: true });
        w.addEventListener("error", (ev) => reject(new Error(`dummy-Worker feilet: ${ev.message}`)), { once: true });
        w.postMessage({ type: "start-dummy", variant, streamBytes: DUMMY_STREAM_BYTES });
      }),
  );
  return Promise.all(ready).then(
    () => workers,
    (err: unknown) => {
      workers.forEach((w) => w.terminate());
      throw err;
    },
  );
}

/** Kjører én konfigurasjon og returnerer posten (uten pausen). */
export async function runOne(
  spec: RunSpec,
  index: number,
  inputs: EnsembleInputs,
  deps: RunnerDeps,
): Promise<RunRecord> {
  const startedAt = deps.now();
  deps.takeHiddenFlag();
  const control = inputs.jobs[0];
  if (control === undefined) throw new Error("måleprogram: jobblisten er tom");

  let dummies: DummyWorkerLike[] = [];
  if (spec.kind === "dummy") {
    dummies = await startDummies(deps, spec.k, spec.variant);
    await deps.sleep(DUMMY_SETTLE_MS);
  }
  try {
    const jobs = spec.kind === "pool" ? cloneJobs(inputs.jobs) : cloneJobs([control]);
    const pool = spec.kind === "pool" ? spec.pool : 1;
    let controlDoneMs: number | null = null;
    const t0 = deps.clockMs();
    const { outcomes } = await runEnsemble(
      jobs,
      pool,
      deps.workerFactory,
      {
        onControlResult: () => {
          controlDoneMs = deps.clockMs();
        },
      },
      // Poolsveipen: fullt ensemble som i appen (verste-først), men uten
      // perturbasjon og nødhavnprofil (spec-en pkt. 1). Solo: bare søket.
      { worstFirst: spec.kind === "pool", bailout: false, context: inputs.context },
    );
    const t1 = deps.clockMs();
    const controlOutcome = outcomes.find((o) => o.isControl) ?? null;
    const members = outcomes
      .filter((o) => !o.isControl)
      .map(memberTuple)
      .sort((a, b) => a[0] - b[0]);
    return {
      index,
      id: spec.id,
      kind: spec.kind,
      pool: spec.kind === "pool" ? spec.pool : null,
      k: spec.kind === "dummy" ? spec.k : null,
      variant: spec.kind === "dummy" ? spec.variant : null,
      repeat: spec.repeat,
      startedAt,
      wallMs: round1(t1 - t0) ?? 0,
      controlMs: round1(controlOutcome?.elapsedMs),
      ensembleWallMs: spec.kind === "pool" && controlDoneMs !== null ? round1(t1 - controlDoneMs) : null,
      control: controlOutcome === null ? null : memberTuple(controlOutcome),
      members,
      errors: outcomes.filter((o) => o.classification === "error").length,
      hiddenDuringRun: deps.takeHiddenFlag(),
    };
  } finally {
    dummies.forEach((w) => w.terminate());
  }
}

/** Termisk hvile mellom kjøringer (ikke medregnet). */
export function pause(deps: RunnerDeps): Promise<void> {
  return deps.sleep(PAUSE_MS);
}
