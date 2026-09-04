/**
 * Ensemble-forberedelse (ADR-0005, oppdragets punkt 3): kontrollmedlemmet
 * kjøres FØRST og alene, deretter strømmes de øvrige medlemmene progressivt
 * gjennom en worker-pool (`defaultPoolSize`: hardwareConcurrency − 1,
 * 1–6 Workere, hver kjørende `workers/weather-routing.worker.ts`). Aggregeringen
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
import type { DistanceFieldData, RouteResult } from "@morild/routing";
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
/**
 * Ett medlems vinddata for ÉN flis (review-funn fase 3 bølge 2, funn 2: en
 * rute kan krysse en flisgrense, §7, og trenger da vinddata fra FLERE
 * fliser for samme medlem — Workeren syr dem sammen med
 * `@morild/weather`s `compositeWeatherField`).
 */
export interface TileWindSource {
  readonly tileId: string;
  readonly windHeader: PackageHeader;
  readonly windBuffer: ArrayBuffer;
}

export interface PlanRouteMemberRequest {
  readonly type: "plan-route-member";
  readonly memberIndex: number;
  readonly isControl: boolean;
  /** Én kilde per flis som dekker ruten OG har dette medlemmet (§7). */
  readonly tiles: readonly TileWindSource[];
  readonly departEpochS: number;
  /**
   * Delt A*-felt (robusthet.md §4.1, D8.2): bygget én gang av kontroll-
   * workeren (`buildFieldForInput`) og sendt som strukturert klone til hvert
   * medlem — bit-identisk resultat med og uten (`shared-field.test.ts`).
   * Udefinert for kontrollen (den bygger feltet) og ved fallback.
   */
  readonly sharedField?: SharedField | undefined;
}

/**
 * Et A*-felt er kun gyldig for ett (start, mål, maske)-triplett. `key`
 * binder feltet strukturelt til det trippelet det ble bygget for
 * (review-funn bølge 1, middels): mottakeren sammenligner med sin egen
 * nøkkel og bygger heller selv enn å bruke et felt for feil strekk.
 */
export interface SharedField {
  readonly key: string;
  readonly data: DistanceFieldData;
}

export interface PlanRouteMemberOk {
  readonly type: "plan-route-member-result";
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly result: RouteResult;
  /** Kun fra kontrollen: feltet den bygde, til gjenbruk i medlemmene. */
  readonly sharedField?: SharedField | undefined;
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
  readonly tiles: readonly TileWindSource[];
  readonly departEpochS: number;
  /** Settes av orkestratoren fra kontrollens svar — se `PlanRouteMemberRequest.sharedField`. */
  readonly sharedField?: SharedField | undefined;
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
  /**
   * Veggklokketid i ms fra jobben ble sendt til Workeren til svaret kom
   * (inkluderer strukturert kloning av flisene + dekoding + søk). Dette er
   * nettbrett-tallet ADR-0005 port 1 venter på — målt der det skjer, ikke
   * anslått fra PC. Udefinert kun når `performance` mangler (testmiljø).
   */
  readonly elapsedMs?: number | undefined;
  /** Kontrollens delte A*-felt (kun på kontrollens utfall). */
  readonly sharedField?: SharedField | undefined;
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
  addEventListener(
    type: "message",
    listener: (ev: MessageEvent<FromWorker>) => void,
    options?: { once?: boolean },
  ): void;
  addEventListener(
    type: "error",
    listener: (ev: ErrorEvent) => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "message", listener: (ev: MessageEvent<FromWorker>) => void): void;
  removeEventListener(type: "error", listener: (ev: ErrorEvent) => void): void;
  terminate(): void;
}

/**
 * Pool-størrelse (robusthet.md §4.1): `hardwareConcurrency − 1`, minimum 1,
 * maksimum 6 — én kjerne holdes fri til hovedtråden/UI, og taket står til
 * nettbrett-målingen (ADR-0005 port 1) sier noe annet.
 */
export function defaultPoolSize(hardwareConcurrency: number | undefined): number {
  const cores = hardwareConcurrency && hardwareConcurrency > 0 ? hardwareConcurrency : 4;
  return Math.max(1, Math.min(6, cores - 1));
}

export type WorkerFactory = () => WorkerLike;

function nowMs(): number | undefined {
  return typeof performance !== "undefined" ? performance.now() : undefined;
}

function runOnWorker(worker: WorkerLike, job: MemberJob): Promise<MemberOutcome> {
  return new Promise((resolve) => {
    const startedMs = nowMs();
    const elapsed = (): number | undefined => {
      const end = nowMs();
      return startedMs !== undefined && end !== undefined ? end - startedMs : undefined;
    };
    const message: PlanRouteMemberRequest = {
      type: "plan-route-member",
      memberIndex: job.memberIndex,
      isControl: job.isControl,
      tiles: job.tiles,
      departEpochS: job.departEpochS,
      ...(job.sharedField !== undefined ? { sharedField: job.sharedField } : {}),
    };
    // Én jobb = ett lytterpar, fjernet ved første svar (robusthet.md §4.1:
    // «Lytterne registreres med { once: true } per jobb»). Før lå alle
    // jobbers lyttere igjen på pool-workeren for hele ensemblet — hver
    // melding vekket N lyttere, og lukkingene holdt på gamle jobbers
    // flisbuffere til poolen ble terminert.
    const onMessage = (ev: MessageEvent<FromWorker>): void => {
      worker.removeEventListener("error", onError);
      const data = ev.data;
      if (data.type === "plan-route-member-result") {
        resolve({
          memberIndex: data.memberIndex,
          isControl: data.isControl,
          classification: classifyMember(data.result),
          result: data.result,
          elapsedMs: elapsed(),
          ...(data.sharedField !== undefined ? { sharedField: data.sharedField } : {}),
        });
      } else {
        resolve({
          memberIndex: data.memberIndex,
          isControl: job.isControl,
          classification: "error",
          errorMessage: data.message,
          elapsedMs: elapsed(),
        });
      }
    };
    const onError = (ev: ErrorEvent): void => {
      worker.removeEventListener("message", onMessage);
      resolve({
        memberIndex: job.memberIndex,
        isControl: job.isControl,
        classification: "error",
        errorMessage: ev.message,
        elapsedMs: elapsed(),
      });
    };
    worker.addEventListener("message", onMessage, { once: true });
    worker.addEventListener("error", onError, { once: true });
    worker.postMessage(
      message,
      job.tiles.map((t) => t.windBuffer),
    );
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

  // Delt A*-felt: kontrollens felt går til alle medlemmer (robusthet.md
  // §4.1). Mangler det (kontrollen feilet/feltet lot seg ikke bygge), bygger
  // hvert medlem sitt eget — samme resultat, bare dyrere.
  const sharedField = controlOutcome.sharedField;
  const memberJobsWithField: readonly MemberJob[] =
    sharedField === undefined
      ? memberJobs
      : memberJobs.map((j) => (j.sharedField === undefined ? { ...j, sharedField } : j));

  if (memberJobsWithField.length > 0) {
    const memberJobs = memberJobsWithField;
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
