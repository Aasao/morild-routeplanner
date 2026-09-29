import { describe, expect, it } from "vitest";
import { FLAG_SJOEGANG_DATA_MANGLER, FLAG_STROM_DATA_MANGLER } from "@morild/routing";
import { makeRouteResult, makeStep } from "../test-fixtures/route-result-factory.js";
import { classifyMember, hourlyTrackFromSteps, maxHsOverSteps, summarizeMember } from "./outcome.js";

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

  it("stagnation/callerStopped uten mål ⇒ inconclusive «budsjett», ikke infeasible (D9.2)", () => {
    for (const abortReason of ["stagnation", "callerStopped"] as const) {
      const result = makeRouteResult({ abortReason, safety: { reachesDestination: false } });
      expect(classifyMember(result)).toEqual({ kind: "inconclusive", reason: "budsjett" });
    }
  });

  it("noWeatherAtStart uten mål ⇒ inconclusive «dekning» selv om coverage.weather er full (D9.2)", () => {
    const result = makeRouteResult({
      abortReason: "noWeatherAtStart",
      coverage: { weather: "full" },
      safety: { reachesDestination: false },
    });
    expect(classifyMember(result)).toEqual({ kind: "inconclusive", reason: "dekning" });
  });

  it("verktøyfeil maskeres ikke av partial dekning (§19 2026-09-29: fyllverdi-medlem, startnode avvist av båtgrenser)", () => {
    const result = makeRouteResult({
      abortReason: "noExpandableLabels",
      coverage: { weather: "partial" },
      safety: { reachesDestination: false },
      diagnostics: {
        iterations: 1,
        termination: { kind: "exhausted" },
        pruned: { hardConstraintBoatLimits: 1, hardConstraint: 1, noWeather: 0, bound: 0 },
      },
    });
    expect(classifyMember(result)).toEqual({ kind: "error" });
  });

  it("ekte dekning uendret: partial + noWeather > 0 + noExpandableLabels ⇒ fortsatt «dekning»", () => {
    const result = makeRouteResult({
      abortReason: "noExpandableLabels",
      coverage: { weather: "partial" },
      safety: { reachesDestination: false },
      diagnostics: { pruned: { noWeather: 4, noWeatherInWindow: 0 } },
    });
    expect(classifyMember(result)).toEqual({ kind: "inconclusive", reason: "dekning" });
  });

  it("ventilen uendret: verktøygrunn + partial + bound-beskjæring ⇒ ikke error (dekning først, som før)", () => {
    const result = makeRouteResult({
      abortReason: "noExpandableLabels",
      coverage: { weather: "partial" },
      safety: { reachesDestination: false },
      diagnostics: { pruned: { bound: 2 } },
    });
    expect(classifyMember(result)).toEqual({ kind: "inconclusive", reason: "dekning" });
  });

  it("outsideDomain uten mål ⇒ error (D9.2)", () => {
    const result = makeRouteResult({ abortReason: "outsideDomain", safety: { reachesDestination: false } });
    expect(classifyMember(result).kind).toBe("error");
  });

  it("intet medlem klassifiseres infeasible med pruned.bound > 0 — uansett abortReason (D9.2-vakt)", () => {
    const reasons = [
      null,
      "stagnation",
      "labelCap",
      "iterationCap",
      "noExpandableLabels",
      "noWeatherAtStart",
      "outsideDomain",
      "callerStopped",
    ] as const;
    for (const abortReason of reasons) {
      for (const weather of ["full", "partial"] as const) {
        const result = makeRouteResult({
          abortReason,
          coverage: { weather },
          safety: { reachesDestination: false },
          diagnostics: { pruned: { bound: 1 } },
        });
        expect(classifyMember(result).kind).not.toBe("infeasible");
      }
    }
  });

  it("partial + nådd mål ⇒ inconclusive «dekning-felt» (D11.1 vedtatt 2026-09-05)", () => {
    const result = makeRouteResult({ coverage: { weather: "partial" }, safety: { reachesDestination: true } });
    expect(classifyMember(result)).toEqual({ kind: "inconclusive", reason: "dekning-felt" });
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

describe("classifyMember — to dekningsfelt (ADR-0008, D17.1)", () => {
  it("hull kun utenfor ruten (weather full, searchWeather partial) + nådd mål ⇒ feasible", () => {
    const result = makeRouteResult({
      coverage: { weather: "full", searchWeather: "partial" },
      safety: { reachesDestination: true },
    });
    expect(classifyMember(result)).toEqual({ kind: "feasible" });
  });

  it("ikke nådd med hull i søket (searchWeather partial) forblir inkonklusiv, selv om rutens steg var dekket", () => {
    const result = makeRouteResult({
      coverage: { weather: "full", searchWeather: "partial" },
      safety: { reachesDestination: false },
      diagnostics: { pruned: { noWeather: 3 } },
    });
    expect(classifyMember(result)).toEqual({ kind: "inconclusive", reason: "dekning" });
  });

  it("ikke nådd, hull bare i strøm/bølge i søket (ingen forkastet for vind) ⇒ fortsatt «dekning», aldri infeasible", () => {
    const result = makeRouteResult({
      coverage: { weather: "full", searchWeather: "partial" },
      safety: { reachesDestination: false },
    });
    expect(classifyMember(result)).toEqual({ kind: "inconclusive", reason: "dekning" });
  });

  it("rutesteg uten strøm (weather partial) + nådd mål ⇒ inconclusive «dekning-felt» (D17.2 u)", () => {
    const result = makeRouteResult({
      coverage: { weather: "partial", searchWeather: "partial" },
      safety: { reachesDestination: true },
    });
    expect(classifyMember(result)).toEqual({ kind: "inconclusive", reason: "dekning-felt" });
  });

  it("verktøyfeil-regelen står fortsatt FØR dekningen (searchWeather partial maskerer ikke error)", () => {
    const result = makeRouteResult({
      abortReason: "labelCap",
      coverage: { weather: "full", searchWeather: "partial" },
      safety: { reachesDestination: false },
      diagnostics: { pruned: { noWeather: 0, bound: 0 } },
    });
    expect(classifyMember(result)).toEqual({ kind: "error" });
  });

  it("resultat fra før ADR-0008 (uten searchWeather) leses på den gamle søksbrede `weather`", () => {
    const base = makeRouteResult({
      coverage: { weather: "partial" },
      safety: { reachesDestination: false },
    });
    const { searchWeather: _omit, ...legacyCoverage } = base.coverage;
    void _omit;
    const legacy = { ...base, coverage: legacyCoverage } as unknown as typeof base;
    expect(classifyMember(legacy)).toEqual({ kind: "inconclusive", reason: "dekning" });
  });

  it("ugyldig searchWeather leses konservativt som partial — aldri et infeasible-sertifikat", () => {
    const base = makeRouteResult({ safety: { reachesDestination: false } });
    const broken = {
      ...base,
      coverage: { ...base.coverage, searchWeather: "kanskje" },
    } as unknown as typeof base;
    expect(classifyMember(broken).kind).toBe("inconclusive");
  });
});

describe("summarizeMember — maxHsM med ukjent Hs (vedtak A, punktbolge.md §8)", () => {
  it("alle steg med bølge ⇒ største Hs", () => {
    const steps = [
      makeStep({ tS: 0, hsM: 0 }),
      makeStep({ tS: 1800, hsM: 0.7 }),
      makeStep({ tS: 3600, hsM: 1.3 }),
    ];
    expect(summarizeMember(makeRouteResult({ steps })).maxHsM).toBeCloseTo(1.3);
  });

  it("ett steg uten bølgedata (SJOEGANG_DATA_MANGLER) ⇒ null, ikke 0 — og ikke det kjente maksimumet", () => {
    const steps = [
      makeStep({ tS: 0, hsM: 0 }),
      makeStep({ tS: 1800, hsM: 0.4 }),
      makeStep({ tS: 3600, hsM: 0, flags: FLAG_SJOEGANG_DATA_MANGLER, flagNames: ["SJOEGANG_DATA_MANGLER"] }),
    ];
    expect(summarizeMember(makeRouteResult({ steps })).maxHsM).toBeNull();
    expect(maxHsOverSteps(steps)).toBeNull();
  });

  it("strøm mangler, bølge finnes ⇒ Hs er kjent (bare bølgemangel gjør Hs ukjent)", () => {
    const steps = [
      makeStep({ tS: 0, hsM: 0 }),
      makeStep({ tS: 1800, hsM: 0.6, flags: FLAG_STROM_DATA_MANGLER, flagNames: ["STROM_DATA_MANGLER"] }),
    ];
    expect(maxHsOverSteps(steps)).toBeCloseTo(0.6);
  });
});

describe("summarizeMember — reduksjonen (§3.2)", () => {
  it("bærer tubBoundS som horisont (null når grådig forhåndsrute ikke nådde målet)", () => {
    const withBound = summarizeMember(makeRouteResult({ diagnostics: { tubBoundS: 50_400 } }));
    expect(withBound.tubBoundS).toBe(50_400);
    const without = summarizeMember(makeRouteResult({ diagnostics: { tubBoundS: null } }));
    expect(without.tubBoundS).toBeNull();
  });

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
