import { describe, expect, it } from "vitest";
import { mulberry32 } from "../test-fixtures/seeded-random.js";
import type { CostVector } from "./cost.js";
import {
  compareCostLexicographic,
  costEquals,
  costScore,
  dominates,
  FLAG_KRYSS,
  FLAG_MOTOR,
  flagNames,
  NEUTRAL_SEARCH_WEIGHTS,
  scaledRankingWeights,
} from "./cost.js";

const c = (tS: number, beatS: number, motorS: number, nightS: number): CostVector => ({
  tS,
  beatS,
  motorS,
  nightS,
});

describe("dominates", () => {
  it("dominerer når alt er minst like godt og noe er strengt bedre", () => {
    expect(dominates(c(100, 0, 0, 0), c(200, 0, 0, 0))).toBe(true);
    expect(dominates(c(100, 10, 5, 3), c(100, 10, 5, 4))).toBe(true);
    expect(dominates(c(100, 10, 5, 3), c(101, 11, 6, 4))).toBe(true);
  });

  it("dominerer ikke når vektorene er helt like (irrefleksivitet)", () => {
    const a = c(100, 10, 5, 3);
    expect(dominates(a, a)).toBe(false);
    expect(dominates(a, { ...a })).toBe(false);
    expect(costEquals(a, { ...a })).toBe(true);
  });

  it("dominerer ikke ved avveining — bedre på én, verre på en annen", () => {
    const raskereMenMerKryss = c(100, 500, 0, 0);
    const tregereMenMindreKryss = c(200, 100, 0, 0);
    expect(dominates(raskereMenMerKryss, tregereMenMindreKryss)).toBe(false);
    expect(dominates(tregereMenMindreKryss, raskereMenMerKryss)).toBe(false);
  });

  it("er nok med én dimensjon strengt bedre (én-dimensjons-dominans)", () => {
    for (const key of ["tS", "beatS", "motorS", "nightS"] as const) {
      const base = c(100, 100, 100, 100);
      const better = { ...base, [key]: base[key] - 1 };
      expect(dominates(better, base)).toBe(true);
      expect(dominates(base, better)).toBe(false);
    }
  });

  it("er antisymmetrisk og transitiv over et seedet vektorsett", () => {
    const rnd = mulberry32(20260830);
    const vectors: CostVector[] = [];
    for (let i = 0; i < 120; i++) {
      vectors.push(
        c(
          Math.floor(rnd() * 5) * 100,
          Math.floor(rnd() * 4) * 60,
          Math.floor(rnd() * 4) * 60,
          Math.floor(rnd() * 3) * 60,
        ),
      );
    }
    for (const a of vectors) {
      expect(dominates(a, a)).toBe(false);
      for (const b of vectors) {
        if (dominates(a, b)) expect(dominates(b, a)).toBe(false);
        for (const d of vectors) {
          if (dominates(a, b) && dominates(b, d)) {
            expect(dominates(a, d)).toBe(true);
          }
        }
      }
    }
  });
});

describe("costScore og vekter", () => {
  it("bruker faste, nøytrale vekter i søket — uavhengig av brukervalg", () => {
    // Invarianten som betyr noe: konstanten er frossen og kan ikke settes
    // fra input. Verdien selv er et dokumentert startpunkt.
    expect(NEUTRAL_SEARCH_WEIGHTS).toEqual({
      beat: 0.5,
      motor: 0.5,
      night: 0.5,
    });
    expect(Object.isFrozen(NEUTRAL_SEARCH_WEIGHTS)).toBe(true);
  });

  it("scorer tid pluss vektede myke sekunder", () => {
    expect(costScore(c(3600, 1800, 0, 0), NEUTRAL_SEARCH_WEIGHTS)).toBe(4500);
  });

  it("skalerer kryssvekten med etappelengde når det er slått på", () => {
    const base = { beat: 1, motor: 1, night: 1 };
    const short = scaledRankingWeights(base, 10, true);
    const long = scaledRankingWeights(base, 1000, true);
    expect(short.beat).toBeCloseTo(1, 10);
    expect(long.beat).toBeCloseTo(3, 10);
    // Motor og natt skaleres ikke — kun kryssvekten (F3.4).
    expect(long.motor).toBe(1);
    expect(long.night).toBe(1);
    expect(scaledRankingWeights(base, 1000, false)).toEqual(base);
  });
});

describe("compareCostLexicographic", () => {
  it("er en total komparator som kun gir 0 for like vektorer", () => {
    expect(compareCostLexicographic(c(1, 2, 3, 4), c(1, 2, 3, 4))).toBe(0);
    expect(compareCostLexicographic(c(1, 2, 3, 4), c(1, 2, 3, 5))).toBeLessThan(0);
    expect(compareCostLexicographic(c(2, 0, 0, 0), c(1, 9, 9, 9))).toBeGreaterThan(0);
  });
});

describe("flagNames", () => {
  it("returnerer navn i fast rekkefølge — determinisme i rapporteringen", () => {
    expect(flagNames(FLAG_KRYSS | FLAG_MOTOR)).toEqual(["MOTOR", "KRYSS"]);
    expect(flagNames(0)).toEqual([]);
  });
});
