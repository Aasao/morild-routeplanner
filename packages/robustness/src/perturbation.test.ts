import { describe, expect, it } from "vitest";
import { perturbationPlan, summarizeSensitivity, type PerturbationRun } from "./perturbation.js";
import type { MemberOutcome, MemberSummary } from "./outcome.js";

function makeSummary(durationS: number, overrides: Partial<MemberSummary> = {}): MemberSummary {
  return {
    durationS,
    distanceNm: 60,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    beatAtNightS: 0,
    fuelL: 0,
    arrivalEpochS: 1_700_000_000 + durationS,
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

function feasible(memberIndex: number, durationS: number): MemberOutcome {
  return { memberIndex, kind: "feasible", summary: makeSummary(durationS) };
}

function infeasible(memberIndex: number): MemberOutcome {
  return { memberIndex, kind: "infeasible", summary: makeSummary(0) };
}

describe("perturbationPlan (§4.4, D8.4 c)", () => {
  const control = feasible(0, 36_000);

  it("uten verste gjennomførbare medlem: 4 kontroll-oppføringer (3 cruising + 2 strøm)", () => {
    const plan = perturbationPlan(control, null);
    expect(plan).toEqual([
      { kind: "cruising", factor: 0.85, basis: "kontroll" },
      { kind: "cruising", factor: 0.9, basis: "kontroll" },
      { kind: "cruising", factor: 0.95, basis: "kontroll" },
      { kind: "current", factor: 0.8, basis: "kontroll" },
      { kind: "current", factor: 1.2, basis: "kontroll" },
    ]);
  });

  it("med verste gjennomførbare medlem: legger til cruising 0,85 på verste-medlem", () => {
    const worst = feasible(17, 90_000);
    const plan = perturbationPlan(control, worst);
    expect(plan).toHaveLength(6);
    expect(plan[5]).toEqual({ kind: "cruising", factor: 0.85, basis: "verste-medlem" });
  });
});

describe("summarizeSensitivity (§3.4)", () => {
  function run(kind: "cruising" | "current", factor: number, basis: "kontroll" | "verste-medlem", outcome: MemberOutcome): PerturbationRun {
    return { kind, factor, basis, outcome };
  }

  it("label er alltid den kodede konstanten", () => {
    const report = summarizeSensitivity([], true);
    expect(report.label).toBe("basert på kontrollvær");
  });

  it("conflict = kontroll gjennomførbar og en kontroll-basert perturbasjon ikke", () => {
    const runs: PerturbationRun[] = [
      run("cruising", 0.85, "kontroll", feasible(0, 40_000)),
      run("cruising", 0.9, "kontroll", infeasible(0)),
    ];
    expect(summarizeSensitivity(runs, true).conflict).toBe(true);
  });

  it("ingen conflict når kontrollen selv ikke er gjennomførbar", () => {
    const runs: PerturbationRun[] = [run("cruising", 0.85, "kontroll", infeasible(0))];
    expect(summarizeSensitivity(runs, false).conflict).toBe(false);
  });

  it("verste-medlem-kjøringen teller ikke mot conflict", () => {
    const runs: PerturbationRun[] = [
      run("cruising", 0.85, "kontroll", feasible(0, 40_000)),
      run("cruising", 0.85, "verste-medlem", infeasible(17)),
    ];
    expect(summarizeSensitivity(runs, true).conflict).toBe(false);
  });

  it("mostSensitive = kind med størst relativ spredning i durationS", () => {
    const runs: PerturbationRun[] = [
      run("cruising", 0.85, "kontroll", feasible(0, 44_000)),
      run("cruising", 0.9, "kontroll", feasible(0, 42_000)),
      run("cruising", 0.95, "kontroll", feasible(0, 40_000)), // spredning (44000-40000)/40000 = 10 %
      run("current", 0.8, "kontroll", feasible(0, 41_000)),
      run("current", 1.2, "kontroll", feasible(0, 40_500)), // spredning 500/40500 ≈ 1,2 %
    ];
    expect(summarizeSensitivity(runs, true).mostSensitive).toBe("cruising");
  });

  it("mostSensitive er null uten nok data (færre enn to kjøringer per kind, eller ingen runs)", () => {
    expect(summarizeSensitivity([], true).mostSensitive).toBeNull();
    const oneRun: PerturbationRun[] = [run("cruising", 0.85, "kontroll", feasible(0, 40_000))];
    expect(summarizeSensitivity(oneRun, true).mostSensitive).toBeNull();
  });

  it("feilede kjøringer (uten summary) telles ikke i spredningen", () => {
    const errored: MemberOutcome = { memberIndex: 0, kind: "error", summary: null, error: "boom" };
    const runs: PerturbationRun[] = [
      run("cruising", 0.85, "kontroll", feasible(0, 40_000)),
      run("cruising", 0.9, "kontroll", errored),
    ];
    // Kun ett gyldig cruising-resultat ⇒ ingen spredning å måle for cruising.
    expect(summarizeSensitivity(runs, true).mostSensitive).toBeNull();
  });
});
