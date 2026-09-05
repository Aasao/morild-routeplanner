import { describe, expect, it } from "vitest";
import type { MemberOutcome, MemberSummary } from "./outcome.js";
import { rankDepartures } from "./ranking.js";
import type { DepartureSummary, RobustnessStamp } from "./summary.js";

function makeMemberSummary(overrides: Partial<MemberSummary> = {}): MemberSummary {
  return {
    durationS: 3600 * 10,
    distanceNm: 60,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    beatAtNightS: 0,
    fuelL: 0,
    arrivalEpochS: 1_700_036_000,
    daylightArrival: true,
    flags: 0,
    safetyVerdict: "trygt",
    coverageWeather: "full",
    prunedBound: 0,
    tubBoundS: null,
    hourlyTrack: [],
    ...overrides,
  };
}

function makeControl(durationS: number): MemberOutcome {
  return { memberIndex: 0, kind: "feasible", summary: makeMemberSummary({ durationS }) };
}

const STAMP: RobustnessStamp = {
  maskVersion: "test-mask-1",
  packageId: "test-package-1",
  packageInitEpochS: 1_700_000_000,
  memberAgesS: [],
  optionsHash: "test-hash",
  estimator: "naermeste-rang-v1",
  thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
};

interface DepartureOverrides {
  readonly departEpochS: number;
  readonly complete?: boolean;
  readonly nF?: number;
  readonly durationP90S?: number | null;
  readonly feasibleShare?: number | null;
  readonly controlDurationS?: number;
}

function makeDeparture(overrides: DepartureOverrides): DepartureSummary {
  const nF = overrides.nF ?? 20;
  const complete = overrides.complete ?? true;
  return {
    departEpochS: overrides.departEpochS,
    control: makeControl(overrides.controlDurationS ?? 36000),
    members: [],
    complete,
    expectedMembers: 30,
    nF,
    nInf: 30 - nF,
    nInc: 0,
    nErr: 0,
    feasibleShare: overrides.feasibleShare === undefined ? nF / 30 : overrides.feasibleShare,
    feasibleShareBounds: { min: nF / 30, max: nF / 30 },
    inconclusiveShare: 0,
    horizonTooShort: false,
    durationWorstS: overrides.durationP90S ?? null,
    durationP50S: overrides.durationP90S ?? null,
    durationP90S: overrides.durationP90S === undefined ? 36000 : overrides.durationP90S,
    beatShareP50: null,
    beatShareP90: null,
    motorShareP50: null,
    motorShareP90: null,
    fuelWorstL: null,
    thresholds: [],
    light: { color: "beregner", reason: null, kOfN: { k: nF, n: 30 }, provisionalThresholds: true },
    certificate: null,
    stamp: STAMP,
  };
}

describe("rankDepartures — total ordning (§4.3)", () => {
  it("robust-settet (nF >= nF_max - 2) rangeres på durationP90S ↑, feasibleShare ↓, departEpochS ↑", () => {
    const a = makeDeparture({ departEpochS: 1, nF: 30, durationP90S: 40000, feasibleShare: 1.0 });
    const b = makeDeparture({ departEpochS: 2, nF: 29, durationP90S: 30000, feasibleShare: 0.9 }); // raskest P90 -> vinner
    const c = makeDeparture({ departEpochS: 3, nF: 28, durationP90S: 40000, feasibleShare: 0.8 }); // samme P90 som a, LAVERE andel -> taper tie-break mot a
    const ranked = rankDepartures([a, b, c]);
    expect(ranked.map((r) => r.summary.departEpochS)).toEqual([2, 1, 3]);
    expect(ranked.every((r) => !r.provisional)).toBe(true);
  });

  it("avganger under nF_max - 2 havner i restgruppen, rangert på feasibleShare ↓ først", () => {
    const top = makeDeparture({ departEpochS: 1, nF: 30, durationP90S: 20000, feasibleShare: 1.0 });
    const weakButFast = makeDeparture({ departEpochS: 2, nF: 5, durationP90S: 10000, feasibleShare: 5 / 5 });
    const weakSlow = makeDeparture({ departEpochS: 3, nF: 4, durationP90S: 50000, feasibleShare: 4 / 4 });
    const ranked = rankDepartures([top, weakButFast, weakSlow]);
    // top er alene i robust-settet (nF_max=30, grense=28). Restgruppen: weakButFast/weakSlow, begge feasibleShare=1
    // -> tie-break på durationP90S ↑: weakButFast (10000) før weakSlow (50000).
    expect(ranked.map((r) => r.summary.departEpochS)).toEqual([1, 2, 3]);
  });

  it("ufullstendige avganger rangeres etter kontrollens durationS og merkes foreløpig, plasseres sist", () => {
    const complete1 = makeDeparture({ departEpochS: 1, nF: 30, durationP90S: 50000 });
    const provisionalFast = makeDeparture({ departEpochS: 2, complete: false, controlDurationS: 10000 });
    const provisionalSlow = makeDeparture({ departEpochS: 3, complete: false, controlDurationS: 20000 });
    const ranked = rankDepartures([provisionalSlow, complete1, provisionalFast]);
    expect(ranked.map((r) => r.summary.departEpochS)).toEqual([1, 2, 3]);
    expect(ranked.find((r) => r.summary.departEpochS === 2)?.provisional).toBe(true);
    expect(ranked.find((r) => r.summary.departEpochS === 3)?.provisional).toBe(true);
    expect(ranked.find((r) => r.summary.departEpochS === 1)?.provisional).toBe(false);
  });

  it("tie-break på identisk nøkkel: tidligste departEpochS vinner (bit-like avganger)", () => {
    const a = makeDeparture({ departEpochS: 5000, nF: 20, durationP90S: 30000, feasibleShare: 0.8 });
    const b = makeDeparture({ departEpochS: 1000, nF: 20, durationP90S: 30000, feasibleShare: 0.8 });
    const c = makeDeparture({ departEpochS: 3000, nF: 20, durationP90S: 30000, feasibleShare: 0.8 });
    const ranked = rankDepartures([a, b, c]);
    expect(ranked.map((r) => r.summary.departEpochS)).toEqual([1000, 3000, 5000]);
  });

  it("null durationP90S/feasibleShare sorteres sist i sin gruppe (verst tenkelig)", () => {
    const withValues = makeDeparture({ departEpochS: 1, nF: 30, durationP90S: 40000, feasibleShare: 0.9 });
    const noFeasible = makeDeparture({ departEpochS: 2, nF: 30, durationP90S: null, feasibleShare: null });
    const ranked = rankDepartures([noFeasible, withValues]);
    expect(ranked.map((r) => r.summary.departEpochS)).toEqual([1, 2]);
  });

  it("er en total ordning: rangeringen er identisk uansett inndatarekkefølge", () => {
    const items = [
      makeDeparture({ departEpochS: 1, nF: 30, durationP90S: 40000, feasibleShare: 1.0 }),
      makeDeparture({ departEpochS: 2, nF: 29, durationP90S: 30000, feasibleShare: 0.9 }),
      makeDeparture({ departEpochS: 3, complete: false, controlDurationS: 15000 }),
      makeDeparture({ departEpochS: 4, nF: 3, durationP90S: 60000, feasibleShare: 1.0 }),
    ];
    const forward = rankDepartures(items).map((r) => r.summary.departEpochS);
    const reversed = rankDepartures([...items].reverse()).map((r) => r.summary.departEpochS);
    const shuffled = rankDepartures([items[2]!, items[0]!, items[3]!, items[1]!]).map(
      (r) => r.summary.departEpochS,
    );
    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it("tomt vindu gir tom rangering", () => {
    expect(rankDepartures([])).toEqual([]);
  });
});
