import { describe, expect, it } from "vitest";
import type { MemberOutcome, MemberSummary, OutcomeKind } from "./outcome.js";
import { summarizeDeparture, type RobustnessStamp } from "./summary.js";

/**
 * Seedet PRNG kun for denne testen (mønster: `packages/routing/test-
 * fixtures/seeded-random.ts`s `mulberry32`) — permutasjonstesten trenger
 * reproduserbare, «tilfeldige» rekkefølger, ikke ekte tilfeldighet.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

function makeSummary(overrides: Partial<MemberSummary> = {}): MemberSummary {
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
    departEpochS: 1_700_000_000,
    hourlyTrack: [],
    ...overrides,
  };
}

function makeOutcome(memberIndex: number, kind: OutcomeKind, overrides: Partial<MemberSummary> = {}): MemberOutcome {
  return {
    memberIndex,
    kind,
    summary: makeSummary(overrides),
  };
}

const CONTROL: MemberOutcome = makeOutcome(0, "feasible");

const STAMP: RobustnessStamp = {
  maskVersion: "test-mask-1",
  packageId: "test-package-1",
  packageInitEpochS: 1_700_000_000,
  memberAgesS: [],
  optionsHash: "test-hash",
  estimator: "naermeste-rang-v1",
  thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
};

function baseInput(members: readonly MemberOutcome[]) {
  return {
    departEpochS: 1_700_000_000,
    control: CONTROL,
    members,
    expectedMembers: 30,
    thresholds: [],
    stamp: STAMP,
  };
}

describe("summarizeDeparture — telling (§3.3, bølge 1-skjelett)", () => {
  it("teller nF/nInf/nInc/nErr og regner feasibleShare/inconclusiveShare", () => {
    const members = [
      ...Array.from({ length: 20 }, (_, i) => makeOutcome(i + 1, "feasible")),
      ...Array.from({ length: 5 }, (_, i) => makeOutcome(i + 21, "infeasible")),
      ...Array.from({ length: 4 }, (_, i) => makeOutcome(i + 26, "inconclusive")),
      makeOutcome(30, "error"),
    ];
    const summary = summarizeDeparture(baseInput(members));
    expect(summary.nF).toBe(20);
    expect(summary.nInf).toBe(5);
    expect(summary.nInc).toBe(4);
    expect(summary.nErr).toBe(1);
    expect(summary.feasibleShare).toBeCloseTo(20 / 25);
    expect(summary.inconclusiveShare).toBeCloseTo(4 / 30);
    expect(summary.complete).toBe(true);
  });

  it("feasibleShare er null når nF + nInf === 0", () => {
    const members = [makeOutcome(1, "inconclusive"), makeOutcome(2, "error")];
    const summary = summarizeDeparture(baseInput(members));
    expect(summary.feasibleShare).toBeNull();
  });

  it("horizonTooShort er sann når inconclusiveShare > 0,20", () => {
    const members = [
      ...Array.from({ length: 22 }, (_, i) => makeOutcome(i + 1, "feasible")),
      ...Array.from({ length: 7 }, (_, i) => makeOutcome(i + 23, "inconclusive")),
      makeOutcome(30, "infeasible"),
    ];
    const summary = summarizeDeparture(baseInput(members));
    expect(summary.inconclusiveShare).toBeCloseTo(7 / 30);
    expect(summary.horizonTooShort).toBe(true);
  });

  it("complete er usann når færre enn expectedMembers er klassifisert", () => {
    const members = Array.from({ length: 29 }, (_, i) => makeOutcome(i + 1, "feasible"));
    const summary = summarizeDeparture(baseInput(members));
    expect(summary.complete).toBe(false);
  });

  it("inkonklusive og feil endrer ikke nevneren i feasibleShare", () => {
    const withoutErrors = summarizeDeparture(
      baseInput([makeOutcome(1, "feasible"), makeOutcome(2, "infeasible")]),
    );
    const withErrorsAndInconclusive = summarizeDeparture(
      baseInput([
        makeOutcome(1, "feasible"),
        makeOutcome(2, "infeasible"),
        makeOutcome(3, "error"),
        makeOutcome(4, "inconclusive"),
      ]),
    );
    expect(withErrorsAndInconclusive.feasibleShare).toBe(withoutErrors.feasibleShare);
  });

  it("30 av 30 gjennomførbare, identisk durationS -> grønt lys, estimatorer regnet ut", () => {
    const members = Array.from({ length: 30 }, (_, i) => makeOutcome(i + 1, "feasible", { durationS: 36000, fuelL: 12 }));
    const summary = summarizeDeparture(baseInput(members));
    expect(summary.durationWorstS).toBe(36000);
    expect(summary.durationP50S).toBe(36000);
    expect(summary.durationP90S).toBe(36000);
    expect(summary.fuelWorstL).toBe(12);
    expect(summary.certificate).toBeNull(); // ingen sertifikat NÅR complete — det er den endelige raden.
    expect(summary.light.color).toBe("gronn");
    expect(summary.light.provisionalThresholds).toBe(true);
  });

  it("ufullstendig avgang uten sertifikatgrunnlag viser beregner, aldri grønn", () => {
    const members = Array.from({ length: 5 }, (_, i) => makeOutcome(i + 1, "feasible"));
    const summary = summarizeDeparture(baseInput(members));
    expect(summary.complete).toBe(false);
    expect(summary.light.color).toBe("beregner");
    expect(summary.light.kOfN).toEqual({ k: 5, n: 30 });
  });

  it("feasibleShareBounds: min = nF/expected, max = (nF + expected - klassifiserte)/expected", () => {
    const members = [
      ...Array.from({ length: 2 }, (_, i) => makeOutcome(i + 1, "feasible")),
      ...Array.from({ length: 20 }, (_, i) => makeOutcome(i + 3, "infeasible")),
    ];
    const summary = summarizeDeparture(baseInput(members));
    expect(summary.feasibleShareBounds.min).toBeCloseTo(2 / 30);
    expect(summary.feasibleShareBounds.max).toBeCloseTo((2 + 30 - 22) / 30);
  });
});

describe("summarizeDeparture — terskeltelling (§4.2.2)", () => {
  it("thresholds telles k av n gjennomførbare, uavhengig av ugjennomførbare/inkonklusive", () => {
    const members = [
      makeOutcome(1, "feasible", { daylightArrival: true }),
      makeOutcome(2, "feasible", { daylightArrival: true }),
      makeOutcome(3, "feasible", { daylightArrival: false }),
      makeOutcome(4, "infeasible", { daylightArrival: false }),
      makeOutcome(5, "inconclusive"),
    ];
    const input = {
      ...baseInput(members),
      thresholds: [{ id: "moerke", label: "framme før mørket", passes: (m: { daylightArrival: boolean }) => m.daylightArrival }],
    };
    const summary = summarizeDeparture(input);
    expect(summary.thresholds).toEqual([{ id: "moerke", k: 2, n: 3 }]);
  });
});

describe("summarizeDeparture — determinisme (§5.2)", () => {
  it("er bit-identisk (JSON) uansett ankomstrekkefølge, over 20 seedede permutasjoner", () => {
    const members = [
      ...Array.from({ length: 18 }, (_, i) => makeOutcome(i + 1, "feasible", { durationS: 36000 + i * 60 })),
      ...Array.from({ length: 6 }, (_, i) => makeOutcome(i + 19, "infeasible")),
      ...Array.from({ length: 5 }, (_, i) => makeOutcome(i + 25, "inconclusive")),
      makeOutcome(30, "error"),
    ];
    const reference = JSON.stringify(summarizeDeparture(baseInput(members)));

    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed);
      const permuted = shuffle(members, rng);
      const result = JSON.stringify(summarizeDeparture(baseInput(permuted)));
      expect(result).toBe(reference);
    }
  });
});
