/**
 * Ensemble-forberedelse (ADR-0005, oppdragets punkt 3): kontrollmedlemmet
 * kjøres FØRST og alene, deretter strømmes de øvrige medlemmene progressivt
 * gjennom en worker-pool (`navigator.hardwareConcurrency` Workere, hver
 * kjørende `workers/weather-routing.worker.ts`). Aggregeringen
 * (P50/P90, gjennomførbarhetsandel, inkonklusiv-andel) er en REN funksjon
 * over ferdige `RouteResult`-er — testbar uten en eneste ekte Worker (se
 * `WorkerLike`/`WorkerFactory`-injeksjonen under).
 *
 * **Inkonklusiv-regelen (ADR-0005, lagt til 2026-09-02):** et medlem der
 * `coverage.weather === "partial"` (feltet tok slutt før seilasen, §9.1
 * pkt. 4s 48 t-medlemshorisont) telles ALDRI som gjennomførbart eller
 * ugjennomførbart — kun som inkonklusivt. > 20 % inkonklusive på en avgang
 * er horisont-porten (ADR-0005 punkt 4): et flagg, ikke en feil.
 */
import type { RouteResult } from "@morild/routing";
import type { PackageHeader } from "@morild/protocol";

/**
 * Strukturell kopi av `workers/weather-routing.worker.ts`s meldingstyper —
 * IKKE importert derfra. Samme begrunnelse som `hello-route.ts`s
 * toppkommentar: `apps/pwa/tsconfig.json` (DOM-lib, hovedtråden) og
 * `tsconfig.worker.json` (WebWorker-lib) er bevisst separate TS-prosjekter
 * med `src/workers` ekskludert fra hovedtrådens `include` — en direkte
 * import ville krysset den grensen. Hold de to i synk manuelt hvis formen
 * endres.
 */
export interface PlanRouteMemberRequest {
  readonly type: "plan-route-member";
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly windHeader: PackageHeader;
  readonly windBuffer: ArrayBuffer;
  readonly departEpochS: number;
}

export interface PlanRouteMemberOk {
  readonly type: "plan-route-member-result";
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly result: RouteResult;
}

export interface PlanRouteMemberError {
  readonly type: "error";
  readonly memberIndex: number;
  readonly message: string;
}

export type FromWorker = PlanRouteMemberOk | PlanRouteMemberError;

export interface MemberJob {
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly windHeader: PackageHeader;
  readonly windBuffer: ArrayBuffer;
  readonly departEpochS: number;
}

export type MemberClassification = "feasible" | "infeasible" | "inconclusive";

/** ADR-0005: partial vær-dekning ⇒ inkonklusiv, uansett `reachesDestination`. */
export function classifyMember(result: RouteResult): MemberClassification {
  if (result.coverage.weather === "partial") return "inconclusive";
  return result.safety.reachesDestination ? "feasible" : "infeasible";
}

export interface MemberOutcome {
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly classification: MemberClassification | "error";
  readonly result?: RouteResult;
  readonly errorMessage?: string;
}

export interface EnsembleSummary {
  readonly totalMembers: number;
  readonly feasibleCount: number;
  readonly infeasibleCount: number;
  readonly inconclusiveCount: number;
  readonly errorCount: number;
  readonly feasibleFraction: number;
  readonly inconclusiveFraction: number;
  /** ADR-0005 horisont-port (punkt 4): > 20 % inkonklusive ⇒ horisonten er trolig for kort for denne seilasen. */
  readonly horizonTooShortWarning: boolean;
  /** Varighet i sekunder — KUN blant gjennomførbare medlemmer (§7.4-mønsteret: inkonklusive/ugjennomførbare forurenser ikke fordelingen). */
  readonly durationP50S?: number;
  readonly durationP90S?: number;
}

function percentile(sortedAscending: readonly number[], p: number): number | undefined {
  if (sortedAscending.length === 0) return undefined;
  const idx = Math.min(sortedAscending.length - 1, Math.floor((p / 100) * sortedAscending.length));
  return sortedAscending[idx];
}

/** Ren aggregering — ingen Worker, ingen I/O. */
export function summarizeEnsemble(outcomes: readonly MemberOutcome[]): EnsembleSummary {
  const total = outcomes.length;
  const feasible = outcomes.filter((o) => o.classification === "feasible");
  const infeasibleCount = outcomes.filter((o) => o.classification === "infeasible").length;
  const inconclusiveCount = outcomes.filter((o) => o.classification === "inconclusive").length;
  const errorCount = outcomes.filter((o) => o.classification === "error").length;
  const durations = feasible
    .map((o) => o.result?.totals.durationS)
    .filter((d): d is number => d !== undefined)
    .sort((a, b) => a - b);
  const p50 = percentile(durations, 50);
  const p90 = percentile(durations, 90);
  return {
    totalMembers: total,
    feasibleCount: feasible.length,
    infeasibleCount,
    inconclusiveCount,
    errorCount,
    feasibleFraction: total > 0 ? feasible.length / total : 0,
    inconclusiveFraction: total > 0 ? inconclusiveCount / total : 0,
    horizonTooShortWarning: total > 0 && inconclusiveCount / total > 0.2,
    ...(p50 !== undefined ? { durationP50S: p50 } : {}),
    ...(p90 !== undefined ? { durationP90S: p90 } : {}),
  };
}

// --------------------------------------------------------- worker-drift

/** Den delmengden av `Worker` orkestratoren faktisk bruker — injiserbar for tester (ingen ekte Worker-tråd nødvendig). */
export interface WorkerLike {
  postMessage(message: PlanRouteMemberRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (ev: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: "error", listener: (ev: ErrorEvent) => void): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

function runOnWorker(worker: WorkerLike, job: MemberJob): Promise<MemberOutcome> {
  return new Promise((resolve) => {
    const message: PlanRouteMemberRequest = {
      type: "plan-route-member",
      memberIndex: job.memberIndex,
      isControl: job.isControl,
      windHeader: job.windHeader,
      windBuffer: job.windBuffer,
      departEpochS: job.departEpochS,
    };
    worker.addEventListener("message", (ev: MessageEvent<FromWorker>) => {
      const data = ev.data;
      if (data.type === "plan-route-member-result") {
        resolve({
          memberIndex: data.memberIndex,
          isControl: data.isControl,
          classification: classifyMember(data.result),
          result: data.result,
        });
      } else {
        resolve({
          memberIndex: data.memberIndex,
          isControl: job.isControl,
          classification: "error",
          errorMessage: data.message,
        });
      }
    });
    worker.addEventListener("error", (ev: ErrorEvent) => {
      resolve({
        memberIndex: job.memberIndex,
        isControl: job.isControl,
        classification: "error",
        errorMessage: ev.message,
      });
    });
    worker.postMessage(message, [job.windBuffer]);
  });
}

export interface EnsembleCallbacks {
  readonly onControlResult?: (outcome: MemberOutcome) => void;
  readonly onMemberResult?: (outcome: MemberOutcome, runningSummary: EnsembleSummary) => void;
}

/**
 * Kjører kontrollen ALENE og FØRST (progressiv UX, oppdragets punkt 3),
 * deretter de øvrige jobbene fordelt over en pool på `poolSize` Workere —
 * strømmet, ikke ventet på alle samtidig. `jobs[0]` MÅ være kontrollen
 * (`isControl: true`); dette håndheves ikke her (kalleren bygger
 * jobblisten), men brytes kontrakten kaster funksjonen tidlig i stedet for
 * å late som resultatet er meningsfullt.
 */
export async function runEnsemble(
  jobs: readonly MemberJob[],
  poolSize: number,
  workerFactory: WorkerFactory,
  callbacks: EnsembleCallbacks = {},
): Promise<{ readonly outcomes: readonly MemberOutcome[]; readonly summary: EnsembleSummary }> {
  const [controlJob, ...memberJobs] = jobs;
  if (controlJob === undefined) {
    return { outcomes: [], summary: summarizeEnsemble([]) };
  }
  if (!controlJob.isControl) {
    throw new Error("runEnsemble: jobs[0] må være kontrollmedlemmet (isControl: true)");
  }

  const outcomes: MemberOutcome[] = [];

  const controlWorker = workerFactory();
  const controlOutcome = await runOnWorker(controlWorker, controlJob);
  controlWorker.terminate();
  outcomes.push(controlOutcome);
  callbacks.onControlResult?.(controlOutcome);
  callbacks.onMemberResult?.(controlOutcome, summarizeEnsemble(outcomes));

  if (memberJobs.length > 0) {
    const effectivePoolSize = Math.max(1, Math.min(poolSize, memberJobs.length));
    const workers = Array.from({ length: effectivePoolSize }, () => workerFactory());
    let nextIndex = 0;
    const takeNext = (): MemberJob | undefined => {
      if (nextIndex >= memberJobs.length) return undefined;
      const job = memberJobs[nextIndex];
      nextIndex += 1;
      return job;
    };

    async function drain(worker: WorkerLike): Promise<void> {
      for (;;) {
        const job = takeNext();
        if (job === undefined) return;
        const outcome = await runOnWorker(worker, job);
        outcomes.push(outcome);
        callbacks.onMemberResult?.(outcome, summarizeEnsemble(outcomes));
      }
    }

    await Promise.all(workers.map((w) => drain(w)));
    workers.forEach((w) => w.terminate());
  }

  return { outcomes, summary: summarizeEnsemble(outcomes) };
}

/**
 * Ekte `WorkerFactory` for bruk i nettleseren — samme
 * `new Worker(new URL(...), {type:"module"})`-mønster som `hello-route.ts`
 * bruker for `routing.worker.ts`. Duck-typed cast til `WorkerLike` (samme
 * begrunnelse som `map.ts::isSetDataCapable`): DOM-ets `Worker`-type er
 * strukturelt bredere (generisk `MessageEvent<any>`) enn den snevre
 * kontrakten orkestratoren faktisk bruker, og lar seg derfor ikke tildele
 * uten en eksplisitt cast — testet indirekte via `WorkerLike`-mock-baserte
 * tester (ekte Worker-tråder kjører ikke i Vitest/jsdom).
 */
export function createRealWeatherWorker(): WorkerLike {
  const worker = new Worker(new URL("../workers/weather-routing.worker.ts", import.meta.url), {
    type: "module",
  });
  return worker as unknown as WorkerLike;
}
