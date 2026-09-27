import { describe, expect, it } from "vitest";
import { buildEnsembleMeasurement, memberMeasurement, workerHeapSummary, type MeasurementEnvironment } from "./measurement.js";
import type { MemberOutcome } from "./ensemble.js";
import { fakeResult } from "./test-support/fake-route-result.js";

const env: MeasurementEnvironment = {
  userAgent: "test",
  hardwareConcurrency: 8,
  memory: undefined,
  periodicBackgroundSyncSupported: false,
  now: () => "2026-09-27T00:00:00Z",
};

function outcome(memberIndex: number, heap: number | null, slot: number | null): MemberOutcome {
  return {
    memberIndex,
    isControl: memberIndex === 0,
    classification: "feasible",
    result: fakeResult({}),
    workerTiming: { decodeMs: 1, fieldMs: 1, searchMs: 10, workerHeapMB: heap, workerSlot: slot },
  };
}

describe("nettbrett-målingen: per-Worker heap og slot (robusthet.md §6.4, D13.2 a)", () => {
  it("per medlem workerHeapMB/workerSlot; toppnivå workerMemoryApi og maxWorkerHeapMB", () => {
    const m = buildEnsembleMeasurement({
      env,
      poolSize: 2,
      control: memberMeasurement(outcome(0, 30.2, null), 0),
      ensembleWallMs: 1000,
      members: [memberMeasurement(outcome(2, 41.5, 1), 0), memberMeasurement(outcome(1, 39, 0), 1)],
    });
    expect(m.schema).toBe("morild-nettbrett-maaling/1");
    expect(m.members.map((x) => [x.memberIndex, x.workerSlot, x.workerHeapMB])).toEqual([
      [1, 0, 39],
      [2, 1, 41.5],
    ]);
    expect(m.control?.workerSlot).toBeNull();
    expect(m.workerMemoryApi).toBe(true);
    expect(m.maxWorkerHeapMB).toBe(41.5);
  });

  it("API-et fraværende i Workerne: false/null, ikke et oppdiktet tall", () => {
    expect(workerHeapSummary([{ workerHeapMB: null }, { workerHeapMB: null }])).toEqual({
      workerMemoryApi: false,
      maxWorkerHeapMB: null,
    });
    // Eldre Worker-svar uten feltene gir også null.
    const old: MemberOutcome = { ...outcome(3, null, null), workerTiming: { decodeMs: 1, fieldMs: 1, searchMs: 1 } };
    expect(memberMeasurement(old, 0)).toMatchObject({ workerHeapMB: null, workerSlot: null });
  });
});
