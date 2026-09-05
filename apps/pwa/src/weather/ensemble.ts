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
import type { DistanceFieldData, LatLon, RouteResult } from "@morild/routing";
import type { PackageHeader } from "@morild/protocol";
import {
  classifyMember as classifyRobust,
  nextAction,
  summarizeDeparture,
  summarizeMember,
  type DepartureSummary,
  type InconclusiveReason,
  type MemberClassification as RobustClassification,
  type MemberOutcome as RobustMemberOutcome,
  type RobustnessStamp,
} from "@morild/robustness";

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
  /** Omkjøring uten motorens egen Tub-bound (§4.1-ventilen; maks én per medlem, D9.4). */
  readonly noTubBound?: boolean | undefined;
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
  /** Nettbrett-målingen (D10.2 b): tid i workeren, delt opp — se `WorkerTiming`. */
  readonly timing?: WorkerTiming | undefined;
}

/**
 * Tid målt INNE i workeren (ADR-0005 port 1 / D10.2 b), så nettbrett-tallet
 * kan skille dekoding, feltbygging og selve søket fra worker-overhead
 * (`MemberOutcome.elapsedMs` er rundturen sett fra hovedtråden).
 */
export interface WorkerTiming {
  readonly decodeMs: number;
  readonly fieldMs: number;
  readonly searchMs: number;
}

export interface PlanRouteMemberError {
  readonly type: "error";
  readonly memberIndex: number;
  readonly message: string;
}

/**
 * Verste-først-orakelet (robusthet.md §4.1, D10.5 vedtatt 2026-09-05):
 * kontrollruten evaluert i medlemmets vær. Svaret styrer KUN i hvilken
 * rekkefølge medlemmene søkes (ADR-0005s rekkefølge-klausul) — det vises
 * aldri og teller aldri. Strukturell kopi i `workers/weather-routing.worker.ts`.
 */
export interface EvaluateControlRequest {
  readonly type: "evaluate-control";
  readonly memberIndex: number;
  readonly tiles: readonly TileWindSource[];
  readonly departEpochS: number;
  readonly waypoints: readonly LatLon[];
}

export interface EvaluateControlResult {
  readonly type: "evaluate-control-result";
  readonly memberIndex: number;
  readonly feasible: boolean;
  readonly durationS: number;
}

export type ToWorker = PlanRouteMemberRequest | EvaluateControlRequest;
export type FromWorker = PlanRouteMemberOk | PlanRouteMemberError | EvaluateControlResult;

export interface MemberJob {
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly tiles: readonly TileWindSource[];
  readonly departEpochS: number;
  /** Settes av orkestratoren fra kontrollens svar — se `PlanRouteMemberRequest.sharedField`. */
  readonly sharedField?: SharedField | undefined;
  /** Orakelets plass i køen (0 = søkes først). Settes av orkestratoren; kun til målingen. */
  readonly oracleRank?: number | undefined;
  /** Settes av orkestratoren for omkjøringen (§4.1-ventilen). */
  readonly noTubBound?: boolean | undefined;
}

export type MemberClassification = "feasible" | "infeasible" | "inconclusive";

/**
 * Klassifisering etter robusthet.md §3.2 via `@morild/robustness` (bølge 3
 * koblet den inn — før lå en egen, enklere regel her). Ventilen
 * («kjør om uten bound») håndteres av `runMemberWithRerun`; kalles denne
 * direkte på et resultat som krever omkjøring, gis ærlig `inconclusive`
 * (grunn «bound») — aldri `infeasible` uten bevis.
 *
 * «partial + nådd mål» er inkonklusiv med grunn «dekning-felt» (D11.1,
 * vedtatt 2026-09-05) — regelen bor i `@morild/robustness`, ikke her.
 */
export function classifyMember(result: RouteResult): MemberClassification | "error" {
  return nextAction(classifyRobust(result), 1).kind as MemberClassification | "error";
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
  /** Tid inne i workeren (D10.2 b); udefinert ved feil. */
  readonly workerTiming?: WorkerTiming | undefined;
  /** Orakelets rang (D10.5) — kun for nettbrett-målingen/treffsikkerhet, aldri et tall i UI. */
  readonly oracleRank?: number | undefined;
  /** Antall omkjøringer uten bound (§4.1-ventilen, maks 1 — D9.4). */
  readonly rerunCount?: 0 | 1 | undefined;
  /** Intern: første pass ba om omkjøring (`runMemberWithRerun` avgjør). */
  readonly needsRerun?: boolean | undefined;
  /** Hvorfor medlemmet er inkonklusivt (D9.2): dekning / budsjett / bound. */
  readonly inconclusiveReason?: InconclusiveReason | undefined;
}

/** Robusthetslagets form av utfallet — det `summarizeDeparture` regner på. */
export function toRobustOutcome(outcome: MemberOutcome): RobustMemberOutcome {
  const result = outcome.result;
  if (result === undefined) {
    return {
      memberIndex: outcome.memberIndex,
      kind: "error",
      summary: null,
      ...(outcome.errorMessage !== undefined ? { error: outcome.errorMessage } : {}),
    };
  }
  const kind = outcome.classification;
  return {
    memberIndex: outcome.memberIndex,
    kind,
    summary: summarizeMember(result),
    full: result,
    ...(kind === "inconclusive" && outcome.inconclusiveReason !== undefined
      ? { inconclusiveReason: outcome.inconclusiveReason }
      : {}),
  };
}

/** Konteksten `summarizeDeparture` trenger (§3.3/§3.6) — bygges av pipelinen. */
export interface EnsembleContext {
  readonly expectedMembers: number;
  readonly departEpochS: number;
  readonly stamp: RobustnessStamp;
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
  /**
   * Avgangssammendraget fra `@morild/robustness` (§3.3: tellinger, eksakte
   * skranker, trafikklys, sertifikat). `null` uten kontekst (tester uten
   * stempel) eller uten kontrollutfall.
   */
  readonly departure: DepartureSummary | null;
}

function percentile(sortedAscending: readonly number[], p: number): number | undefined {
  if (sortedAscending.length === 0) return undefined;
  const idx = Math.min(sortedAscending.length - 1, Math.floor((p / 100) * sortedAscending.length));
  return sortedAscending[idx];
}

/** Ren aggregering — ingen Worker, ingen I/O. */
export function summarizeEnsemble(
  outcomes: readonly MemberOutcome[],
  context?: EnsembleContext,
): EnsembleSummary {
  const control = outcomes.find((o) => o.isControl);
  const departure =
    context === undefined || control === undefined
      ? null
      : summarizeDeparture({
          departEpochS: context.departEpochS,
          control: toRobustOutcome(control),
          members: outcomes.filter((o) => !o.isControl).map(toRobustOutcome),
          expectedMembers: context.expectedMembers,
          thresholds: [],
          stamp: context.stamp,
        });
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
    departure,
  };
}

// --------------------------------------------------------- worker-drift

/** Den delmengden av `Worker` orkestratoren faktisk bruker — injiserbar for tester (ingen ekte Worker-tråd nødvendig). */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer: Transferable[]): void;
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

/**
 * §4.1-ventilen (D9.2 generisk, D9.4 tak = 1): et medlem som ikke nådde
 * målet mens motorens Tub-bound beskar noe, er ikke bevist ugjennomførbart
 * og kjøres om én gang uten bound. Svaret fra omkjøringen er det som
 * teller; krever den fortsatt omkjøring, blir medlemmet ærlig
 * `inconclusive` med grunn «bound» (`nextAction`).
 */
async function runMemberWithRerun(worker: WorkerLike, job: MemberJob): Promise<MemberOutcome> {
  const first = await runOnWorker(worker, job);
  if (first.needsRerun !== true || job.noTubBound === true) {
    return { ...first, rerunCount: 0 };
  }
  const second = await runOnWorker(worker, { ...job, noTubBound: true });
  return {
    ...second,
    rerunCount: 1,
    elapsedMs:
      first.elapsedMs !== undefined && second.elapsedMs !== undefined
        ? first.elapsedMs + second.elapsedMs
        : second.elapsedMs,
  };
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
      ...(job.noTubBound === true ? { noTubBound: true } : {}),
    };
    // Én jobb = ett lytterpar, fjernet ved første svar (robusthet.md §4.1:
    // «Lytterne registreres med { once: true } per jobb»). Før lå alle
    // jobbers lyttere igjen på pool-workeren for hele ensemblet — hver
    // melding vekket N lyttere, og lukkingene holdt på gamle jobbers
    // flisbuffere til poolen ble terminert.
    const onMessage = (ev: MessageEvent<FromWorker>): void => {
      worker.removeEventListener("error", onError);
      const data = ev.data;
      if (data.type === "evaluate-control-result") {
        // Et orakelsvar på en søkejobb er en programmeringsfeil — aldri stille.
        resolve({
          memberIndex: job.memberIndex,
          isControl: job.isControl,
          classification: "error",
          errorMessage: "uventet evaluate-control-result under søk",
          elapsedMs: elapsed(),
        });
      } else if (data.type === "plan-route-member-result") {
        const raw: RobustClassification = classifyRobust(data.result);
        // «rerun-without-bound» oversettes av `runMemberWithRerun`; her
        // stemples den foreløpig inconclusive/bound så ingen kan lese den
        // som et tall.
        const cls = nextAction(raw, 1);
        resolve({
          memberIndex: data.memberIndex,
          isControl: data.isControl,
          classification: cls.kind as MemberClassification | "error",
          ...(cls.kind === "inconclusive" ? { inconclusiveReason: cls.reason } : {}),
          ...(raw.kind === "rerun-without-bound" ? { needsRerun: true } : {}),
          result: data.result,
          elapsedMs: elapsed(),
          ...(data.sharedField !== undefined ? { sharedField: data.sharedField } : {}),
          ...(data.timing !== undefined ? { workerTiming: data.timing } : {}),
          ...(job.oracleRank !== undefined ? { oracleRank: job.oracleRank } : {}),
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

export interface EnsembleOptions {
  /**
   * Verste-først (D10.5): evaluer kontrollruten i hvert medlems vær før
   * søkene og søk de verste først, så advarselssertifikater kan slå til
   * tidlig. Påvirker aldri tall — bare rekkefølgen. Av i tester som ikke
   * har et orakelsvarende worker-mock.
   */
  readonly worstFirst?: boolean | undefined;
  /** Kontekst for avgangssammendraget (§3.3); uten den er `summary.departure` null. */
  readonly context?: EnsembleContext | undefined;
}

/** Orakelsvar for ett medlem; `null` når evalueringen feilet (medlemmet søkes sist). */
export interface OracleVerdict {
  readonly memberIndex: number;
  readonly feasible: boolean;
  readonly durationS: number;
}

function evaluateOnWorker(
  worker: WorkerLike,
  job: MemberJob,
  waypoints: readonly LatLon[],
): Promise<OracleVerdict | null> {
  return new Promise((resolve) => {
    const onMessage = (ev: MessageEvent<FromWorker>): void => {
      worker.removeEventListener("error", onError);
      const data = ev.data;
      if (data.type === "evaluate-control-result") {
        resolve({ memberIndex: data.memberIndex, feasible: data.feasible, durationS: data.durationS });
      } else {
        resolve(null);
      }
    };
    const onError = (): void => {
      worker.removeEventListener("message", onMessage);
      resolve(null);
    };
    worker.addEventListener("message", onMessage, { once: true });
    worker.addEventListener("error", onError, { once: true });
    // INGEN transfer: flisbufferne trengs igjen til selve søket (705 kB
    // kopieres — 0,6 ms målt, panelet D10 §1.4).
    worker.postMessage(
      {
        type: "evaluate-control",
        memberIndex: job.memberIndex,
        tiles: job.tiles,
        departEpochS: job.departEpochS,
        waypoints,
      },
      [],
    );
  });
}

/**
 * Ren sortering (D10.5): ugjennomførbare i kontrollruten først (stigende
 * memberIndex), så gjennomførbare etter synkende evaluert seilingstid
 * (tie-break memberIndex), så medlemmer uten orakelsvar i opprinnelig
 * rekkefølge. Deterministisk — og påvirker per konstruksjon ingen tall.
 */
export function worstFirstOrder(
  jobs: readonly MemberJob[],
  verdicts: ReadonlyMap<number, OracleVerdict | null>,
): readonly MemberJob[] {
  const rank = (j: MemberJob): [number, number, number] => {
    const v = verdicts.get(j.memberIndex) ?? null;
    if (v === null) return [2, 0, j.memberIndex];
    if (!v.feasible) return [0, 0, j.memberIndex];
    return [1, -v.durationS, j.memberIndex];
  };
  return [...jobs]
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    })
    .map((j, i) => ({ ...j, oracleRank: i }));
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
  options: EnsembleOptions = {},
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
  const controlOutcome = await runMemberWithRerun(controlWorker, controlJob);
  controlWorker.terminate();
  outcomes.push(controlOutcome);
  callbacks.onControlResult?.(controlOutcome);
  callbacks.onMemberResult?.(controlOutcome, summarizeEnsemble(outcomes, options.context));

  // Delt A*-felt: kontrollens felt går til alle medlemmer (robusthet.md
  // §4.1). Mangler det (kontrollen feilet/feltet lot seg ikke bygge), bygger
  // hvert medlem sitt eget — samme resultat, bare dyrere.
  const sharedField = controlOutcome.sharedField;
  const memberJobsWithField: readonly MemberJob[] =
    sharedField === undefined
      ? memberJobs
      : memberJobs.map((j) => (j.sharedField === undefined ? { ...j, sharedField } : j));

  if (memberJobsWithField.length > 0) {
    const effectivePoolSize = Math.max(1, Math.min(poolSize, memberJobsWithField.length));
    const workers = Array.from({ length: effectivePoolSize }, () => workerFactory());

    // Orakelfasen (D10.5): kontrollruten evaluert i hvert medlems vær over
    // samme pool, så søkene kjøres verste-først. Uten kontrollrute (kontrollen
    // feilet) eller uten opt-in: opprinnelig rekkefølge.
    const controlSteps = controlOutcome.result?.steps ?? [];
    let memberJobs: readonly MemberJob[] = memberJobsWithField;
    if (options.worstFirst === true && controlSteps.length >= 2) {
      const waypoints: LatLon[] = controlSteps.map((s) => ({ lat: s.lat, lon: s.lon }));
      const verdicts = new Map<number, OracleVerdict | null>();
      let evalIndex = 0;
      async function drainOracle(worker: WorkerLike): Promise<void> {
        for (;;) {
          const job = memberJobsWithField[evalIndex];
          if (job === undefined) return;
          evalIndex += 1;
          verdicts.set(job.memberIndex, await evaluateOnWorker(worker, job, waypoints));
        }
      }
      await Promise.all(workers.map((w) => drainOracle(w)));
      memberJobs = worstFirstOrder(memberJobsWithField, verdicts);
    }

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
        const outcome = await runMemberWithRerun(worker, job);
        outcomes.push(outcome);
        callbacks.onMemberResult?.(outcome, summarizeEnsemble(outcomes, options.context));
      }
    }

    await Promise.all(workers.map((w) => drain(w)));
    workers.forEach((w) => w.terminate());
  }

  return { outcomes, summary: summarizeEnsemble(outcomes, options.context) };
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
