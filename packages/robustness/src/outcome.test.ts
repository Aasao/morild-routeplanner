import { describe, expect, it } from "vitest";
import { makeRouteResult, makeStep } from "../test-fixtures/route-result-factory.js";
import { classifyMember, hourlyTrackFromSteps, summarizeMember } from "./outcome.js";

describe("provenance-avvisning (§3.1 pkt. 1 / §5.1)", () => {
  it("summarizeMember kaster på RouteResult uten provenance", () => {
    const result = makeRouteResult({ provenance: undefined });
    expect(() => summarizeMember(result)).toThrow(/provenance/);
  });

  it("classifyMember kaster på RouteResult uten provenance", () => {
    const result = makeRouteResult({ provenance: undefined });
    expect(() => classifyMember(result)).toThrow(/provenance/);
  });

  it("kaster også på en ukjent provenance-verdi", () => {
    const result = makeRouteResult({ provenance: "hand-rolled" });
    expect(() => summarizeMember(result)).toThrow(/provenance/);
    expect(() => classifyMember(result)).toThrow(/provenance/);
  });

  it("godtar planRoute og createSearch", () => {
    expect(() => summarizeMember(makeRouteResult({ provenance: "planRoute" }))).not.toThrow();
    expect(() => summarizeMember(makeRouteResult({ provenance: "createSearch" }))).not.toThrow();
  });
});

describe("classifyMember — tabellen i §3.2 (rekkefølgen er bindende)", () => {
  it("pruned.bound > 0 && !reachesDestination ⇒ rerun-without-bound (§4.1-ventilen)", () => {
    const result = makeRouteResult({
      safety: { reachesDestination: false },
      diagnostics: { pruned: { bound: 3 } },
    });
    expect(classifyMember(result).kind).toBe("rerun-without-bound");
  });

  it("partial værdekning uten mål ⇒ inconclusive, selv med pruned.bound > 0 (rekkefølge)", () => {
    const result = makeRouteResult({
      safety: { reachesDestination: false },
      coverage: { weather: "partial" },
      diagnostics: { pruned: { bound: 3 } },
    });
    expect(classifyMember(result).kind).toBe("inconclusive");
  });

  it("noExpandableLabels med pruned.bound > 0 uten mål ⇒ rerun, ikke error (bounden kan ha kuttet fronten)", () => {
    const result = makeRouteResult({
      abortReason: "noExpandableLabels",
      safety: { reachesDestination: false },
      diagnostics: { pruned: { bound: 1 } },
    });
    expect(classifyMember(result).kind).toBe("rerun-without-bound");
  });

  it("partial værdekning uten mål ⇒ inconclusive", () => {
    const result = makeRouteResult({
      safety: { reachesDestination: false },
      coverage: { weather: "partial" },
    });
    expect(classifyMember(result).kind).toBe("inconclusive");
  });

  it("abortReason labelCap/iterationCap/noExpandableLabels uten mål ⇒ error", () => {
    for (const abortReason of ["labelCap", "iterationCap", "noExpandableLabels"] as const) {
      const result = makeRouteResult({
        abortReason,
        safety: { reachesDestination: false },
      });
      expect(classifyMember(result).kind).toBe("error");
    }
  });

  it("de samme abortReason-verdiene teller ikke som error når målet likevel nås", () => {
    const result = makeRouteResult({
      abortReason: "labelCap",
      safety: { reachesDestination: true },
    });
    expect(classifyMember(result).kind).toBe("feasible");
  });

  it("reachesDestination === true ⇒ feasible", () => {
    const result = makeRouteResult({ safety: { reachesDestination: true } });
    expect(classifyMember(result).kind).toBe("feasible");
  });

  it("ellers ⇒ infeasible", () => {
    const result = makeRouteResult({
      safety: { reachesDestination: false },
      coverage: { weather: "full" },
    });
    expect(classifyMember(result).kind).toBe("infeasible");
  });
});

describe("summarizeMember — reduksjonen (§3.2)", () => {
  it("bærer safetyVerdict, coverageWeather og prunedBound fra RouteResult", () => {
    const result = makeRouteResult({
      safety: { verdict: "usikkert" },
      coverage: { weather: "partial" },
      diagnostics: { pruned: { bound: 7 } },
    });
    const summary = summarizeMember(result);
    expect(summary.safetyVerdict).toBe("usikkert");
    expect(summary.coverageWeather).toBe("partial");
    expect(summary.prunedBound).toBe(7);
  });

  it("hourlyTrack har ≤ 48 punkter og første punkt er startposisjonen", () => {
    const steps = [
      makeStep({ tS: 0, lat: 59.1, lon: 10.9 }),
      makeStep({ tS: 3600 * 60, lat: 55.0, lon: 9.0 }),
    ];
    const result = makeRouteResult({ steps });
    const summary = summarizeMember(result);
    expect(summary.hourlyTrack.length).toBeLessThanOrEqual(48);
    expect(summary.hourlyTrack[0]).toEqual({ lat: 59.1, lon: 10.9 });
  });
});

describe("hourlyTrackFromSteps", () => {
  it("interpolerer lineært mellom to steg", () => {
    const steps = [makeStep({ tS: 0, lat: 0, lon: 0 }), makeStep({ tS: 7200, lat: 2, lon: 4 })];
    const track = hourlyTrackFromSteps(steps);
    expect(track).toEqual([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 2 },
      { lat: 2, lon: 4 },
    ]);
  });

  it("returnerer tom liste for ingen steg", () => {
    expect(hourlyTrackFromSteps([])).toEqual([]);
  });
});
