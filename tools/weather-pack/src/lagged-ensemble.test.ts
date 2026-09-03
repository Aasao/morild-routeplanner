import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAGGED_ENSEMBLE_OPTIONS,
  selectEnsembleRun,
  type EnsembleRun,
} from "./lagged-ensemble.js";

function run(init: string, memberCount: number, hasControlMember = true): EnsembleRun {
  return { init, memberCount, hasControlMember };
}

describe("selectEnsembleRun (§11, §18 pkt. 2)", () => {
  it("velger siste kjøring når den er komplett — sourceStatus ok", () => {
    const runs = [run("2026-09-02T12Z", 30), run("2026-09-02T06Z", 30)];
    const result = selectEnsembleRun(runs);
    expect(result.outcome).toBe("complete");
    if (result.outcome === "complete") {
      expect(result.runsBack).toBe(0);
      expect(result.run.init).toBe("2026-09-02T12Z");
      expect(result.sourceStatus).toEqual({ status: "ok" });
    }
  });

  it("faller tilbake til forrige kjøring hvis siste er ufullstendig, med degraded status", () => {
    const runs = [run("2026-09-02T12Z", 22), run("2026-09-02T06Z", 30)];
    const result = selectEnsembleRun(runs);
    expect(result.outcome).toBe("complete");
    if (result.outcome === "complete") {
      expect(result.runsBack).toBe(1);
      expect(result.run.init).toBe("2026-09-02T06Z");
      expect(result.sourceStatus.status).toBe("degraded");
    }
  });

  it("går maks 2 kjøringer tilbake (~12t) — ikke lenger", () => {
    const runs = [run("A", 10), run("B", 15), run("C", 30)]; // C er 2 tilbake, men skal IKKE nås
    const result = selectEnsembleRun(runs, { requiredMembers: 30, maxRunsBack: 2 });
    // maxRunsBack=2 betyr kandidater er indeks 0,1,2 (siste + 2 tilbake) — C (indeks 2) SKAL nås.
    expect(result.outcome).toBe("complete");
  });

  it("stopper strengt ved maxRunsBack + 1 kandidater — kjøring UTENFOR vinduet brukes aldri", () => {
    const runs = [run("A", 10), run("B", 15), run("C", 20), run("D", 30)]; // D er 3 tilbake
    const result = selectEnsembleRun(runs, { requiredMembers: 30, maxRunsBack: 2 });
    expect(result.outcome).toBe("no-usable-ensemble");
  });

  it("rapporterer 'ingen brukbart ensemble' når ingen kandidat er komplett, men kontrollmedlemmet kan fortsatt leveres", () => {
    const runs = [run("A", 22, true), run("B", 18, true)];
    const result = selectEnsembleRun(runs, { requiredMembers: 30, maxRunsBack: 1 });
    expect(result.outcome).toBe("no-usable-ensemble");
    if (result.outcome === "no-usable-ensemble") {
      expect(result.controlOnlyRun?.init).toBe("A");
      expect(result.sourceStatus.status).toBe("degraded");
      expect(result.sourceStatus.reason).toMatch(/ingen komplett ensemble/i);
    }
  });

  it("håndterer at kontrollmedlemmet OGSÅ mangler i siste kjøring", () => {
    const runs = [run("A", 0, false)];
    const result = selectEnsembleRun(runs);
    expect(result.outcome).toBe("no-usable-ensemble");
    if (result.outcome === "no-usable-ensemble") {
      expect(result.controlOnlyRun).toBeUndefined();
    }
  });

  it("håndterer tom kjøringsliste uten å kaste", () => {
    const result = selectEnsembleRun([]);
    expect(result.outcome).toBe("no-usable-ensemble");
    if (result.outcome === "no-usable-ensemble") {
      expect(result.controlOnlyRun).toBeUndefined();
      expect(result.sourceStatus.reason).toMatch(/ingen kjøringer tilgjengelig/i);
    }
  });

  it("standardverdier matcher spec-en (30 medlemmer, maks 2 kjøringer tilbake)", () => {
    expect(DEFAULT_LAGGED_ENSEMBLE_OPTIONS).toEqual({ requiredMembers: 30, maxRunsBack: 2 });
  });
});
