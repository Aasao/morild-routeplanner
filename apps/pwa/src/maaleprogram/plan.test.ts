import { describe, expect, it } from "vitest";
import { alternatingOrder, buildRunPlan } from "./plan.js";

describe("rekkefølgegeneratoren (robusthet.md §6.4)", () => {
  it("vekselvis: hver runde rotert én plass — 4, 5, 6, 7, 5, 6, 7, 4, …", () => {
    expect(alternatingOrder([4, 5, 6, 7], 5)).toEqual([
      4, 5, 6, 7,
      5, 6, 7, 4,
      6, 7, 4, 5,
      7, 4, 5, 6,
      4, 5, 6, 7,
    ]);
  });

  it("hver verdi like mange ganger; tom liste gir tom plan", () => {
    const order = alternatingOrder([4, 5, 6, 7], 5);
    for (const p of [4, 5, 6, 7]) expect(order.filter((x) => x === p)).toHaveLength(5);
    expect(alternatingOrder([], 3)).toEqual([]);
  });

  it("deterministisk: to bygg gir identisk plan", () => {
    expect(buildRunPlan()).toEqual(buildRunPlan());
  });

  it("standardplanen: 20 poolsveip + 10 solo + 45 dummy, unike id-er, i spec-ens fase-rekkefølge", () => {
    const plan = buildRunPlan();
    expect(plan).toHaveLength(75);
    expect(new Set(plan.map((p) => p.id)).size).toBe(75);
    const kinds = plan.map((p) => p.kind);
    expect(kinds.slice(0, 20).every((k) => k === "pool")).toBe(true);
    expect(kinds.slice(20, 30).every((k) => k === "solo")).toBe(true);
    expect(kinds.slice(30).every((k) => k === "dummy")).toBe(true);
    expect(plan.slice(0, 8).map((p) => (p.kind === "pool" ? p.pool : -1))).toEqual([4, 5, 6, 7, 5, 6, 7, 4]);
    expect(plan[0]!.id).toBe("pool-4-r0");
    expect(plan[7]!.id).toBe("pool-4-r1");
    const dummies = plan.filter((p) => p.kind === "dummy");
    for (const variant of ["spin", "stream", "alloc"]) {
      for (const k of [1, 2, 3, 4, 5]) {
        expect(dummies.filter((d) => d.kind === "dummy" && d.variant === variant && d.k === k)).toHaveLength(3);
      }
    }
  });
});
