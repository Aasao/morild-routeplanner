import { describe, expect, it } from "vitest";
import type { FromWorker, MemberJob, ToWorker, WorkerLike } from "../weather/ensemble.js";
import type { EnsembleInputs } from "../weather/pipeline.js";
import { HEADER, fakeResult } from "../weather/test-support/fake-route-result.js";
import { cloneJobs, runOne, type DummyWorkerLike, type RunnerDeps } from "./runner.js";

/** Attrapp-Worker: svarer som `weather-routing.worker.ts`, med ekko av `workerSlot` og en heap-verdi. */
function mockWorker(log: ToWorker[], heapMB: number | null): WorkerLike {
  const listeners = new Map<string, Set<(ev: MessageEvent<FromWorker>) => void>>();
  return {
    postMessage(message) {
      log.push(message);
      let response: FromWorker;
      if (message.type === "evaluate-control") {
        response = { type: "evaluate-control-result", memberIndex: message.memberIndex, feasible: true, durationS: 3600 };
      } else if (message.type === "plan-route-member") {
        const result = fakeResult({ reachesDestination: true, weatherCoverage: "full", steps: 3 });
        response = {
          type: "plan-route-member-result",
          memberIndex: message.memberIndex,
          isControl: message.isControl,
          result: { ...result, diagnostics: { ...result.diagnostics, labelsCreated: 1000 + message.memberIndex } },
          timing: { decodeMs: 2.04, fieldMs: 1, searchMs: 40.26, workerHeapMB: heapMB, workerSlot: message.workerSlot ?? null },
        };
      } else {
        response = { type: "error", memberIndex: message.memberIndex, message: "ikke støttet" };
      }
      queueMicrotask(() => {
        const set = listeners.get("message");
        if (!set) return;
        for (const fn of [...set]) {
          set.delete(fn);
          fn({ data: response } as MessageEvent<FromWorker>);
        }
      });
    },
    addEventListener(type: string, listener: unknown) {
      if (type !== "message") return;
      const set = listeners.get(type) ?? new Set();
      set.add(listener as (ev: MessageEvent<FromWorker>) => void);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: unknown) {
      listeners.get(type)?.delete(listener as (ev: MessageEvent<FromWorker>) => void);
    },
    terminate() {},
  };
}

function job(memberIndex: number): MemberJob {
  return {
    memberIndex,
    isControl: memberIndex === 0,
    tiles: [{ tileId: "t0", windHeader: HEADER, windBuffer: new ArrayBuffer(16) }],
    departEpochS: 0,
  };
}

function inputs(members: number): EnsembleInputs {
  return {
    jobs: Array.from({ length: members + 1 }, (_, i) => job(i)),
    context: {
      expectedMembers: members,
      departEpochS: 0,
      stamp: {
        maskVersion: "m",
        packageId: "p",
        packageInitEpochS: 0,
        memberAgesS: [],
        optionsHash: "o",
        estimator: "naermeste-rang-v1",
        thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
      },
    },
    memberCount: members,
    byMember: new Map(),
    blobHashes: [],
    packageInit: "2026-09-27T00:00:00Z",
  };
}

function deps(opts: { log: ToWorker[]; heapMB?: number | null; dummies?: { started: string[]; terminated: number } }): RunnerDeps {
  let t = 0;
  return {
    workerFactory: () => mockWorker(opts.log, opts.heapMB === undefined ? 11.5 : opts.heapMB),
    dummyFactory: (): DummyWorkerLike => {
      let onMessage: (() => void) | null = null;
      return {
        postMessage(m) {
          opts.dummies?.started.push(m.variant);
          queueMicrotask(() => onMessage?.());
        },
        addEventListener(type: string, listener: unknown) {
          if (type === "message") onMessage = listener as () => void;
        },
        terminate() {
          if (opts.dummies) opts.dummies.terminated += 1;
        },
      };
    },
    clockMs: () => (t += 100),
    now: () => "2026-09-27T12:00:00Z",
    sleep: () => Promise.resolve(),
    takeHiddenFlag: () => false,
  };
}

describe("måleprogrammets kjøring (gjenbruker runEnsemble/protokollen)", () => {
  it("poolsveip: alle medlemmer som tupler, workerSlot 0…pool−1, ingen nødhavn/perturbasjon", async () => {
    const log: ToWorker[] = [];
    const rec = await runOne({ kind: "pool", id: "pool-4-r0", pool: 4, repeat: 0 }, 0, inputs(8), deps({ log }));
    expect(rec.members).toHaveLength(8);
    expect(rec.members.map((m) => m[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const slots = new Set(rec.members.map((m) => m[1]));
    expect([...slots].every((s) => s !== null && s >= 0 && s < 4)).toBe(true);
    expect(rec.control).toEqual([0, null, 40.3, 1000, 2, 11.5]);
    expect(rec.members[0]).toEqual([1, expect.any(Number), 40.3, 1001, 2, 11.5]);
    expect(log.some((m) => m.type === "bailout-profile")).toBe(false);
    expect(log.some((m) => m.type === "plan-route-member" && m.perturbation !== undefined)).toBe(false);
    expect(rec.ensembleWallMs).not.toBeNull();
    expect(rec.errors).toBe(0);
  });

  it("solo: nøyaktig ett plan-route-member (medlem 0) på én Worker", async () => {
    const log: ToWorker[] = [];
    const rec = await runOne({ kind: "solo", id: "solo-r0", repeat: 0 }, 20, inputs(8), deps({ log }));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ type: "plan-route-member", memberIndex: 0, isControl: true });
    expect(rec.members).toEqual([]);
    expect(rec.control?.[0]).toBe(0);
    expect(rec.ensembleWallMs).toBeNull();
  });

  it("dummy-last: k Workere startes før og termineres etter målesøket", async () => {
    const log: ToWorker[] = [];
    const dummies = { started: [] as string[], terminated: 0 };
    const rec = await runOne(
      { kind: "dummy", id: "dummy-stream-k3-r0", k: 3, variant: "stream", repeat: 0 },
      30,
      inputs(8),
      deps({ log, dummies }),
    );
    expect(dummies.started).toEqual(["stream", "stream", "stream"]);
    expect(dummies.terminated).toBe(3);
    expect(rec).toMatchObject({ kind: "dummy", k: 3, variant: "stream", pool: null });
    expect(log).toHaveLength(1);
  });

  it("Worker uten performance.memory: heap-feltet er null, ikke 0", async () => {
    const log: ToWorker[] = [];
    const rec = await runOne({ kind: "solo", id: "solo-r0", repeat: 0 }, 0, inputs(2), deps({ log, heapMB: null }));
    expect(rec.control?.[5]).toBeNull();
  });

  it("cloneJobs: ferske buffere hver gang, originalen røres ikke", () => {
    const original = [job(0)];
    const copy = cloneJobs(original);
    expect(copy[0]!.tiles[0]!.windBuffer).not.toBe(original[0]!.tiles[0]!.windBuffer);
    expect(copy[0]!.tiles[0]!.windBuffer.byteLength).toBe(16);
  });
});
