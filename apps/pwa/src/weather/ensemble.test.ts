import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import type { RouteResult } from "@morild/routing";
import {
  classifyMember,
  runEnsemble,
  summarizeEnsemble,
  type FromWorker,
  type MemberJob,
  type MemberOutcome,
  type WorkerLike,
} from "./ensemble.js";

const HEADER: PackageHeader = {
  formatVersion: "1.0.0",
  producedAt: "2026-09-03T00:00:00Z",
  model: "MEPS",
  init: "2026-09-03T00:00:00Z",
  resolution: "2.5km",
  sourceStatus: { status: "ok" },
};

/** Minimal, gyldig `RouteResult` — kun feltene klassifiseringen/aggregeringen faktisk ser er variert per test. */
function fakeResult(overrides: {
  readonly weatherCoverage?: "full" | "partial";
  readonly reachesDestination?: boolean;
  readonly durationS?: number;
}): RouteResult {
  const durationS = overrides.durationS ?? 12 * 3600;
  return {
    provenance: "planRoute",
    reached: overrides.reachesDestination ?? true,
    abortReason: null,
    // Rute-nivå flagg (D7.2) — tomt i den minimale fiksturen.
    flags: 0,
    flagNames: [],
    legs: [],
    steps: [],
    totals: {
      durationS,
      distanceNm: 87,
      beatS: 0,
      motorS: 0,
      nightS: 0,
      beatAtNightS: 0,
      fuelL: 0,
      arrivalEpochS: 1_700_000_000 + durationS,
      daylightArrival: true,
      violatesDaylightRequirement: false,
      exceedsMaxContinuousLeg: false,
    },
    finalLeg: { status: "ikke-nodvendig", reason: null, shortfallNm: 0 },
    safety: {
      verdict: "trygt",
      reachesDestination: overrides.reachesDestination ?? true,
      recheckPassed: true,
      failingSegments: [],
      flaggedSegments: [],
    },
    coverage: {
      mask: "full",
      weather: overrides.weatherCoverage ?? "full",
      fieldUsed: true,
      weatherHeader: HEADER,
      chartSources: [],
    },
    alternatives: [],
    isochrones: [],
    diagnostics: {
      iterations: 0,
      labelsCreated: 0,
      peakActiveLabels: 0,
      fieldCells: 0,
      tubBoundS: null,
      vmaxKn: 0,
      clearance: {
        gatePass: 0,
        gateMiss: 0,
        midpointChecks: 0,
        maxDepth: 0,
        clearanceCalls: 0,
        rejections: 0,
        exemptChords: 0,
        uncertified: 0,
      },
      clearanceRecheck: {
        gatePass: 0,
        gateMiss: 0,
        midpointChecks: 0,
        maxDepth: 0,
        clearanceCalls: 0,
        rejections: 0,
        exemptChords: 0,
        uncertified: 0,
      },
      pruned: {
        dominated: 0,
        bound: 0,
        deadEnd: 0,
        hardConstraint: 0,
        hardConstraintBoatLimits: 0,
        hardConstraintPoint: 0,
        hardConstraintClearance: 0,
        hardConstraintSegment: 0,
        hardConstraintTss: 0,
        hardConstraintDaylight: 0,
        capEvicted: 0,
        noWeather: 0,
        noWeatherInWindow: 0,
        cone: 0,
        outsideDomain: 0,
      },
    },
  };
}

describe("classifyMember — ADR-0005 inkonklusiv-regel", () => {
  it("gjennomførbar når reachesDestination og full værdekning", () => {
    expect(classifyMember(fakeResult({ reachesDestination: true, weatherCoverage: "full" }))).toBe("feasible");
  });

  it("ugjennomførbar når reachesDestination er false og værdekningen er FULL (ekte umulig, ikke datamangel)", () => {
    expect(classifyMember(fakeResult({ reachesDestination: false, weatherCoverage: "full" }))).toBe("infeasible");
  });

  it("inkonklusiv når værdekningen er 'partial' — SELV OM reachesDestination er true", () => {
    expect(classifyMember(fakeResult({ reachesDestination: true, weatherCoverage: "partial" }))).toBe("inconclusive");
  });

  it("inkonklusiv når værdekningen er 'partial' og reachesDestination er false (aldri ugjennomførbar av datamangel)", () => {
    expect(classifyMember(fakeResult({ reachesDestination: false, weatherCoverage: "partial" }))).toBe("inconclusive");
  });
});

function outcome(classification: MemberOutcome["classification"], durationS?: number): MemberOutcome {
  return {
    memberIndex: 0,
    isControl: false,
    classification,
    ...(classification !== "error"
      ? {
          result: fakeResult({
            weatherCoverage: classification === "inconclusive" ? "partial" : "full",
            reachesDestination: classification === "feasible",
            ...(durationS !== undefined ? { durationS } : {}),
          }),
        }
      : {}),
  };
}

describe("summarizeEnsemble", () => {
  it("teller feasible/infeasible/inconclusive/error korrekt og regner andeler", () => {
    const outcomes = [
      outcome("feasible", 10 * 3600),
      outcome("feasible", 12 * 3600),
      outcome("infeasible"),
      outcome("inconclusive"),
      outcome("error"),
    ];
    const summary = summarizeEnsemble(outcomes);
    expect(summary.totalMembers).toBe(5);
    expect(summary.feasibleCount).toBe(2);
    expect(summary.infeasibleCount).toBe(1);
    expect(summary.inconclusiveCount).toBe(1);
    expect(summary.errorCount).toBe(1);
    expect(summary.feasibleFraction).toBeCloseTo(0.4, 5);
    expect(summary.inconclusiveFraction).toBeCloseTo(0.2, 5);
  });

  it("P50/P90 regnes KUN blant gjennomførbare medlemmer", () => {
    const outcomes = [outcome("feasible", 10 * 3600), outcome("feasible", 20 * 3600), outcome("inconclusive", 1)];
    const summary = summarizeEnsemble(outcomes);
    expect(summary.durationP50S).toBeDefined();
    expect(summary.durationP90S).toBeDefined();
    expect(summary.durationP50S).toBeLessThanOrEqual(20 * 3600);
  });

  it("horizonTooShortWarning slår inn over 20 % inkonklusive (ADR-0005 horisont-port)", () => {
    const outcomes = [
      outcome("feasible"),
      outcome("feasible"),
      outcome("feasible"),
      outcome("feasible"),
      outcome("inconclusive"), // 1/5 = 20 % — akkurat på grensen, IKKE over
    ];
    expect(summarizeEnsemble(outcomes).horizonTooShortWarning).toBe(false);

    const overThreshold = [...outcomes, outcome("inconclusive")]; // 2/6 ≈ 33 % — over
    expect(summarizeEnsemble(overThreshold).horizonTooShortWarning).toBe(true);
  });

  it("tom liste gir null-summary uten å dele på null", () => {
    const summary = summarizeEnsemble([]);
    expect(summary.totalMembers).toBe(0);
    expect(summary.feasibleFraction).toBe(0);
    expect(summary.durationP50S).toBeUndefined();
  });
});

/** Minimal `WorkerLike`-mock: svarer synkront (via microtask) med et forhåndsbestemt resultat per medlemsindeks. */
function mockWorker(
  resultFor: (memberIndex: number) => FromWorker,
  registry?: { live: number; maxLive: number },
): WorkerLike {
  // Emulerer ekte EventTarget-semantikk for det orkestratoren bruker:
  // `{ once: true }` fjerner lytteren etter første kall, og
  // `removeEventListener` fjerner den eksplisitt. `registry` teller antall
  // registrerte lyttere som lever samtidig — lekkasjetesten under.
  type Listener = (ev: MessageEvent<FromWorker>) => void;
  const listeners = new Map<string, Set<{ fn: Listener; once: boolean }>>();
  const bump = (delta: number): void => {
    if (!registry) return;
    registry.live += delta;
    registry.maxLive = Math.max(registry.maxLive, registry.live);
  };
  return {
    postMessage(message) {
      const response = resultFor(message.memberIndex);
      queueMicrotask(() => {
        const set = listeners.get("message");
        if (!set) return;
        for (const entry of [...set]) {
          if (entry.once) {
            set.delete(entry);
            bump(-1);
          }
          entry.fn({ data: response } as MessageEvent<FromWorker>);
        }
      });
    },
    addEventListener(type, listener, options) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add({ fn: listener as Listener, once: options?.once === true });
      bump(1);
    },
    removeEventListener(type, listener) {
      const set = listeners.get(type);
      if (!set) return;
      for (const entry of set) {
        if (entry.fn === (listener as Listener)) {
          set.delete(entry);
          bump(-1);
        }
      }
    },
    terminate() {
      /* no-op */
    },
  };
}

function job(memberIndex: number, isControl: boolean): MemberJob {
  return {
    memberIndex,
    isControl,
    tiles: [{ tileId: "t0", windHeader: HEADER, windBuffer: new ArrayBuffer(8) }],
    departEpochS: 0,
  };
}

describe("runEnsemble", () => {
  it("delt A*-felt: kontrollens fieldData går videre til alle medlemsjobber (robusthet.md §4.1)", async () => {
    const sharedField = {
      key: "test|58,10|57,11",
      data: { lat0: 58, lon0: 10, cellDeg: 0.01, width: 2, height: 2, d: new Float64Array([1, 2, 3, 4]) },
    };
    const seen = new Map<number, unknown>();
    const workerFactory = (): WorkerLike => {
      const base = mockWorker((memberIndex) => ({
        type: "plan-route-member-result",
        memberIndex,
        isControl: memberIndex === 0,
        result: fakeResult({ reachesDestination: true, weatherCoverage: "full" }),
        ...(memberIndex === 0 ? { sharedField } : {}),
      }));
      return {
        ...base,
        postMessage(message, transfer) {
          seen.set(message.memberIndex, message.sharedField);
          base.postMessage(message, transfer);
        },
      };
    };
    const jobs = [job(0, true), job(1, false), job(2, false)];
    const { outcomes } = await runEnsemble(jobs, 2, workerFactory);
    expect(seen.get(0)).toBeUndefined(); // kontrollen bygger feltet selv
    expect(seen.get(1)).toBe(sharedField);
    expect(seen.get(2)).toBe(sharedField);
    expect(outcomes[0]?.sharedField).toBe(sharedField);
  });

  it("lekker ingen lyttere: hver jobb registrerer ett par og fjerner det ved svar (robusthet.md §4.1)", async () => {
    const registry = { live: 0, maxLive: 0 };
    const workerFactory = () =>
      mockWorker(
        (memberIndex) => ({
          type: "plan-route-member-result",
          memberIndex,
          isControl: memberIndex === 0,
          result: fakeResult({ reachesDestination: true, weatherCoverage: "full" }),
        }),
        registry,
      );
    const jobs = [job(0, true), ...Array.from({ length: 12 }, (_, i) => job(i + 1, false))];
    await runEnsemble(jobs, 2, workerFactory);
    // Per jobb i flukt: nøyaktig én message- og én error-lytter; poolen på
    // 2 + kontrollen alene ⇒ aldri mer enn 2 jobber i flukt samtidig.
    expect(registry.maxLive).toBeLessThanOrEqual(4);
    expect(registry.live).toBe(0);
  });

  it("kjører kontrollen FØRST og alene, deretter medlemmene over en pool", async () => {
    const order: number[] = [];
    const workerFactory = () =>
      mockWorker((memberIndex) => {
        order.push(memberIndex);
        return {
          type: "plan-route-member-result",
          memberIndex,
          isControl: memberIndex === 0,
          result: fakeResult({ reachesDestination: true, weatherCoverage: "full" }),
        };
      });

    const jobs = [job(0, true), job(1, false), job(2, false), job(3, false)];
    const { outcomes, summary } = await runEnsemble(jobs, 2, workerFactory);

    expect(order[0]).toBe(0); // kontrollen kjørte først
    expect(outcomes).toHaveLength(4);
    expect(summary.totalMembers).toBe(4);
    expect(summary.feasibleCount).toBe(4);
  });

  it("kaller onControlResult og onMemberResult progressivt", async () => {
    const workerFactory = () =>
      mockWorker((memberIndex) => ({
        type: "plan-route-member-result",
        memberIndex,
        isControl: memberIndex === 0,
        result: fakeResult({ reachesDestination: true, weatherCoverage: "full" }),
      }));

    const controlResults: number[] = [];
    const memberResults: number[] = [];
    await runEnsemble([job(0, true), job(1, false)], 1, workerFactory, {
      onControlResult: (o) => controlResults.push(o.memberIndex),
      onMemberResult: (o) => memberResults.push(o.memberIndex),
    });

    expect(controlResults).toEqual([0]);
    expect(memberResults).toEqual([0, 1]); // kontrollen teller også som "medlemsresultat" i den løpende summeringen
  });

  it("en worker-feil klassifiseres som 'error', stopper ikke resten av poolen", async () => {
    const workerFactory = () =>
      mockWorker((memberIndex) => {
        if (memberIndex === 2) {
          return { type: "error", memberIndex, message: "boom" };
        }
        return {
          type: "plan-route-member-result",
          memberIndex,
          isControl: memberIndex === 0,
          result: fakeResult({ reachesDestination: true, weatherCoverage: "full" }),
        };
      });

    const { outcomes, summary } = await runEnsemble([job(0, true), job(1, false), job(2, false)], 2, workerFactory);
    expect(outcomes).toHaveLength(3);
    expect(summary.errorCount).toBe(1);
  });

  it("kaster hvis jobs[0] ikke er kontrollen — bygger aldri et resultat på feil premiss", async () => {
    const workerFactory = () => mockWorker(() => ({ type: "error", memberIndex: 0, message: "ubrukt" }));
    await expect(runEnsemble([job(1, false)], 1, workerFactory)).rejects.toThrow();
  });
});
