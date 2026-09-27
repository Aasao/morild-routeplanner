import { describe, expect, it } from "vitest";
import {
  classifyMember,
  runEnsemble,
  summarizeEnsemble,
  type FromWorker,
  type MemberJob,
  type MemberOutcome,
  type WorkerLike,
  type ToWorker,
  type OracleVerdict,
  worstFirstOrder,
} from "./ensemble.js";
import { HEADER, fakeResult } from "./test-support/fake-route-result.js";

describe("classifyMember — ADR-0005 inkonklusiv-regel", () => {
  it("gjennomførbar når reachesDestination og full værdekning", () => {
    expect(classifyMember(fakeResult({ reachesDestination: true, weatherCoverage: "full" }))).toBe("feasible");
  });

  it("ugjennomførbar når reachesDestination er false og værdekningen er FULL (ekte umulig, ikke datamangel)", () => {
    expect(classifyMember(fakeResult({ reachesDestination: false, weatherCoverage: "full" }))).toBe("infeasible");
  });

  it("partial + nådd mål ⇒ inkonklusiv «dekning-felt» (D11.1 vedtatt; regelen bor i @morild/robustness)", () => {
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
  /** Valgfri kanal for orakelmeldinger: returner et svar, eller `undefined` for å falle til `resultFor`. */
  intercept?: (message: ToWorker) => FromWorker | undefined,
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
      // Orkestratoren ber om bail-out-profil etter kontrollen (default på);
      // attrappen har ingen havnebok og svarer ærlig med feil, så utfallet
      // får `bailout` udefinert — aldri en oppdiktet profil.
      const response: FromWorker =
        message.type === "bailout-profile"
          ? { type: "error", memberIndex: message.memberIndex, message: "attrapp uten havnebok" }
          : (intercept?.(message) ?? resultFor(message.memberIndex));
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

describe("verste-først-orakelet (D10.5)", () => {
  it("worstFirstOrder: ugjennomførbare først, så tregeste, så uten svar — deterministisk", () => {
    const jobs = [1, 2, 3, 4, 5].map((i) => job(i, false));
    const verdicts = new Map<number, OracleVerdict | null>([
      [1, { memberIndex: 1, feasible: true, durationS: 40_000 }],
      [2, { memberIndex: 2, feasible: false, durationS: 10_000 }],
      [3, null],
      [4, { memberIndex: 4, feasible: true, durationS: 50_000 }],
      [5, { memberIndex: 5, feasible: false, durationS: 20_000 }],
    ]);
    const ordered = worstFirstOrder(jobs, verdicts);
    expect(ordered.map((j) => j.memberIndex)).toEqual([2, 5, 4, 1, 3]);
    expect(ordered.map((j) => j.oracleRank)).toEqual([0, 1, 2, 3, 4]);
  });

  it("runEnsemble med worstFirst søker i orakelets rekkefølge og gir samme sammendrag som uten", async () => {
    const searchOrder: number[] = [];
    const durations = new Map<number, number>([
      [1, 40_000],
      [2, 50_000],
      [3, 30_000],
    ]);
    const factory = (): WorkerLike =>
      mockWorker((memberIndex) => ({
        type: "plan-route-member-result",
        memberIndex,
        isControl: memberIndex === 0,
        result: fakeResult({ reachesDestination: true, weatherCoverage: "full", steps: 3 }),
      }), undefined, (message) => {
        if (message.type === "evaluate-control") {
          return {
            type: "evaluate-control-result",
            memberIndex: message.memberIndex,
            feasible: message.memberIndex !== 3,
            durationS: durations.get(message.memberIndex) ?? 0,
          };
        }
        searchOrder.push(message.memberIndex);
        return undefined;
      });
    const jobs = [job(0, true), job(1, false), job(2, false), job(3, false)];
    const withOracle = await runEnsemble(jobs, 1, factory, {}, { worstFirst: true });
    // 3 er ugjennomførbar i kontrollruten ⇒ først; så 2 (50 000 s) før 1 (40 000 s).
    expect(searchOrder).toEqual([0, 3, 2, 1]);
    expect(withOracle.outcomes.find((o) => o.memberIndex === 3)?.oracleRank).toBe(0);
    const without = await runEnsemble(jobs, 1, factory, {});
    expect(withOracle.summary).toEqual(without.summary);
  });
});

describe("runEnsemble", () => {
  it("perturbasjonsfasen (§4.4): fem søk på kontrollen (cruising ×3, strøm ×2) + ett på verste gjennomførbare medlem, flisene hentes på nytt", async () => {
    const tilesRequested: number[] = [];
    const perturbationsSeen: Array<{ memberIndex: number; kind: string; factor: number }> = [];
    const durations: Record<number, number> = { 0: 10 * 3600, 1: 11 * 3600, 2: 14 * 3600, 3: 12 * 3600 };
    const workerFactory = (): WorkerLike => {
      const base = mockWorker((memberIndex) => ({
        type: "plan-route-member-result",
        memberIndex,
        isControl: memberIndex === 0,
        result: fakeResult({ reachesDestination: true, weatherCoverage: "full", durationS: durations[memberIndex] ?? 9 * 3600 }),
      }));
      return {
        ...base,
        postMessage(message, transfer) {
          if (message.type === "plan-route-member" && message.perturbation !== undefined) {
            perturbationsSeen.push({ memberIndex: message.memberIndex, ...message.perturbation });
          }
          base.postMessage(message, transfer);
        },
      };
    };
    const jobs = [job(0, true), job(1, false), job(2, false), job(3, false)];
    const { sensitivity } = await runEnsemble(jobs, 2, workerFactory, {}, {
      perturbation: {
        tilesFor: (memberIndex) => {
          tilesRequested.push(memberIndex);
          return Promise.resolve(job(memberIndex, false).tiles);
        },
      },
    });
    expect(sensitivity).not.toBeNull();
    expect(sensitivity!.runs).toHaveLength(6);
    expect(sensitivity!.label).toBe("basert på kontrollvær");
    // Fem på kontrollen (medlem 0), én på verste gjennomførbare (medlem 2, 14 t).
    expect(perturbationsSeen.filter((p) => p.memberIndex === 0)).toHaveLength(5);
    expect(perturbationsSeen.filter((p) => p.memberIndex === 2)).toEqual([{ memberIndex: 2, kind: "cruising", factor: 0.85 }]);
    expect(new Set(tilesRequested)).toEqual(new Set([0, 2]));
    expect(sensitivity!.conflict).toBe(false);
  });

  it("uten perturbation-opsjon: ingen følsomhetsrapport og ingen ekstra søk", async () => {
    const workerFactory = () =>
      mockWorker((memberIndex) => ({
        type: "plan-route-member-result",
        memberIndex,
        isControl: memberIndex === 0,
        result: fakeResult({ reachesDestination: true, weatherCoverage: "full" }),
      }));
    const { sensitivity } = await runEnsemble([job(0, true), job(1, false)], 1, workerFactory);
    expect(sensitivity).toBeNull();
  });

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
          seen.set(message.memberIndex, message.type === "plan-route-member" ? message.sharedField : undefined);
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
