import { describe, expect, it } from "vitest";
import type { MemberClassification } from "./outcome.js";
import { nextAction } from "./rerun.js";

describe("nextAction — rerun-tak (D9.4)", () => {
  it("rerun-without-bound med rerunCount 0 -> uendret (kjør om)", () => {
    const c: MemberClassification = { kind: "rerun-without-bound" };
    expect(nextAction(c, 0)).toEqual({ kind: "rerun-without-bound" });
  });

  it("rerun-without-bound med rerunCount 1 (taket brukt) -> inconclusive/bound", () => {
    const c: MemberClassification = { kind: "rerun-without-bound" };
    expect(nextAction(c, 1)).toEqual({ kind: "inconclusive", reason: "bound" });
  });

  it("andre klassifiseringer går uendret gjennom, uansett rerunCount", () => {
    const cases: readonly MemberClassification[] = [
      { kind: "feasible" },
      { kind: "infeasible" },
      { kind: "error" },
      { kind: "inconclusive", reason: "dekning" },
      { kind: "inconclusive", reason: "budsjett" },
    ];
    for (const c of cases) {
      expect(nextAction(c, 0)).toEqual(c);
      expect(nextAction(c, 1)).toEqual(c);
    }
  });
});
