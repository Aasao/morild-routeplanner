import { describe, expect, it } from "vitest";
import type { MemberOutcome, MemberSummary } from "./outcome.js";
import { computeFeasibleEstimates, nearestRankValue } from "./estimators.js";

function makeSummary(overrides: Partial<MemberSummary> = {}): MemberSummary {
  return {
    durationS: 0,
    distanceNm: 60,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    beatAtNightS: 0,
    fuelL: 0,
    arrivalEpochS: 1_700_000_000,
    daylightArrival: true,
    flags: 0,
    safetyVerdict: "trygt",
    coverageWeather: "full",
    prunedBound: 0,
    tubBoundS: null,
    departEpochS: 1_700_000_000,
    hourlyTrack: [],
    ...overrides,
  };
}

function makeFeasible(memberIndex: number, overrides: Partial<MemberSummary> = {}): MemberOutcome {
  return { memberIndex, kind: "feasible", summary: makeSummary(overrides) };
}

describe("nearestRankValue — §4.2.1 håndregnede fasiter", () => {
  // k = ⌈p·n/100⌉, 1-indeksert, over verdiene 1..n (så x_k = k).
  const cases: readonly { readonly n: number; readonly p50k: number; readonly p90k: number }[] = [
    { n: 1, p50k: 1, p90k: 1 },
    { n: 9, p50k: 5, p90k: 9 },
    { n: 10, p50k: 5, p90k: 9 },
    { n: 11, p50k: 6, p90k: 10 },
    { n: 12, p50k: 6, p90k: 11 },
    { n: 29, p50k: 15, p90k: 27 },
    { n: 30, p50k: 15, p90k: 27 },
  ];

  for (const { n, p50k, p90k } of cases) {
    it(`nF=${n}: P50 -> x(${p50k})=${p50k}, P90 -> x(${p90k})=${p90k}`, () => {
      const values = Array.from({ length: n }, (_, i) => i + 1);
      expect(nearestRankValue(values, 50)).toBe(p50k);
      expect(nearestRankValue(values, 90)).toBe(p90k);
      // durationWorstS = x_(nF) = P100.
      expect(nearestRankValue(values, 100)).toBe(n);
    });
  }

  it("null ved nF = 0", () => {
    expect(nearestRankValue([], 50)).toBeNull();
    expect(nearestRankValue([], 90)).toBeNull();
  });
});

describe("computeFeasibleEstimates", () => {
  it("returnerer alle null ved 0 gjennomførbare", () => {
    const est = computeFeasibleEstimates([]);
    expect(est).toEqual({
      durationWorstS: null,
      durationP50S: null,
      durationP90S: null,
      beatShareP50: null,
      beatShareP90: null,
      motorShareP50: null,
      motorShareP90: null,
      fuelWorstL: null,
    });
  });

  it("durationWorstS/P50/P90 følger fasitene over durationS", () => {
    // 10 medlemmer, durationS = 1..10 timer (i sekunder). k50=5 -> 5t, k90=9 -> 9t.
    const feasible = Array.from({ length: 10 }, (_, i) =>
      makeFeasible(i + 1, { durationS: (i + 1) * 3600 }),
    );
    const est = computeFeasibleEstimates(feasible);
    expect(est.durationP50S).toBe(5 * 3600);
    expect(est.durationP90S).toBe(9 * 3600);
    expect(est.durationWorstS).toBe(10 * 3600);
  });

  it("beatShare/motorShare beregnes uavhengig av duration-sorteringen", () => {
    // Konstruert slik at rangeringen på beatShare er ULIK rangeringen på durationS.
    const feasible = [
      makeFeasible(1, { durationS: 3600, beatS: 0 }), // beatShare 0,0 — lengst duration-rang først
      makeFeasible(2, { durationS: 7200, beatS: 7200 }), // beatShare 1,0
      makeFeasible(3, { durationS: 10800, beatS: 5400 }), // beatShare 0,5
    ];
    const est = computeFeasibleEstimates(feasible);
    // Sortert på beatShare: [0,0 (m1), 0,5 (m3), 1,0 (m2)]. n=3: k50=⌈1.5⌉=2 -> 0,5. k90=⌈2.7⌉=3 -> 1,0.
    expect(est.beatShareP50).toBeCloseTo(0.5);
    expect(est.beatShareP90).toBeCloseTo(1.0);
  });

  it("motorShare = 0 når durationS === 0 (unngår divisjon på null)", () => {
    const feasible = [makeFeasible(1, { durationS: 0, motorS: 0 })];
    const est = computeFeasibleEstimates(feasible);
    expect(est.motorShareP50).toBe(0);
    expect(est.motorShareP90).toBe(0);
  });

  it("fuelWorstL er maks fuelL blant gjennomførbare", () => {
    const feasible = [
      makeFeasible(1, { fuelL: 12 }),
      makeFeasible(2, { fuelL: 30 }),
      makeFeasible(3, { fuelL: 5 }),
    ];
    expect(computeFeasibleEstimates(feasible).fuelWorstL).toBe(30);
  });

  it("tie-break på memberIndex ved like verdier endrer ikke resultatet (kun rekkefølgestabilitet)", () => {
    const feasible = [
      makeFeasible(3, { durationS: 3600 }),
      makeFeasible(1, { durationS: 3600 }),
      makeFeasible(2, { durationS: 7200 }),
    ];
    const est = computeFeasibleEstimates(feasible);
    expect(est.durationP50S).toBe(3600);
    expect(est.durationWorstS).toBe(7200);
  });
});
