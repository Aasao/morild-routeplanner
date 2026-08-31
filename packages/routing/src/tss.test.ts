import { describe, expect, it } from "vitest";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import type { TssVerdict } from "./contracts.js";
import { checkTssStep } from "./expand.js";
import { FLAG_TSS_LANGS } from "./cost.js";
import { applyTssRule, DEFAULT_TSS_PARAMS, minCrossingAngleDeg } from "./tss.js";

describe("applyTssRule — alle fem tilfellene", () => {
  it("gjør ingenting utenfor TSS", () => {
    expect(applyTssRule({ kind: "none" })).toEqual({ kind: "ok" });
  });

  it("tillater kryssing innenfor ±30° fra tvers", () => {
    expect(applyTssRule({ kind: "crossing", angleDeg: 90 }).kind).toBe("ok");
    expect(applyTssRule({ kind: "crossing", angleDeg: 60 }).kind).toBe("ok");
    expect(applyTssRule({ kind: "crossing", angleDeg: 75 }).kind).toBe("ok");
  });

  it("avviser skrå kryssing hardt", () => {
    const outcome = applyTssRule({ kind: "crossing", angleDeg: 59.9 });
    expect(outcome.kind).toBe("reject");
    if (outcome.kind === "reject") {
      expect(outcome.reason).toMatch(/TSS/);
    }
    expect(applyTssRule({ kind: "crossing", angleDeg: 20 }).kind).toBe("reject");
  });

  it("tillater og flagger seiling langs leden med trafikkretningen", () => {
    expect(applyTssRule({ kind: "along", withDirection: true }).kind).toBe(
      "along-with-direction",
    );
  });

  it("avviser seiling langs leden mot trafikkretningen hardt", () => {
    const outcome = applyTssRule({ kind: "along", withDirection: false });
    expect(outcome.kind).toBe("reject");
    if (outcome.kind === "reject") {
      expect(outcome.reason).toMatch(/trafikkretningen/);
    }
  });

  it("uttrykker grensen som ±30° fra tvers", () => {
    expect(minCrossingAngleDeg(DEFAULT_TSS_PARAMS)).toBe(60);
    expect(minCrossingAngleDeg({ crossToleranceFromBeamDeg: 45 })).toBe(45);
  });

  it("er en ren funksjon av vurderingen — ingen kostnad kan overstyre den", () => {
    // Regelen tar ikke imot kostnader i det hele tatt. Det er poenget:
    // «langs, feil retning» kan ikke vektes forbi uansett hvor stor en myk
    // kostnad settes, fordi ingen kostnad er i signaturen.
    const verdicts: TssVerdict[] = [
      { kind: "along", withDirection: false },
      { kind: "crossing", angleDeg: 10 },
    ];
    for (const verdict of verdicts) {
      expect(applyTssRule(verdict).kind).toBe("reject");
    }
  });
});

describe("checkTssStep mot masken", () => {
  const mask = rectMask({
    tss: [
      {
        latMin: 57.5,
        latMax: 57.9,
        lonMin: 10.4,
        lonMax: 11.0,
        // Leden går mot nordøst.
        axisDeg: 45,
      },
    ],
  });

  it("slipper gjennom et segment som krysser leden nær rett vinkel", () => {
    const result = checkTssStep(
      mask,
      { lat: 57.6, lon: 10.5 },
      { lat: 57.75, lon: 10.75 },
      DEFAULT_TSS_PARAMS,
    );
    // Kurs ca. 45° = langs leden, med retningen.
    expect(result.check.ok).toBe(true);
    expect(result.flags).toBe(FLAG_TSS_LANGS);
  });

  it("avviser et segment som går langs leden mot trafikkretningen", () => {
    const result = checkTssStep(
      mask,
      { lat: 57.75, lon: 10.75 },
      { lat: 57.6, lon: 10.5 },
      DEFAULT_TSS_PARAMS,
    );
    expect(result.check.ok).toBe(false);
  });

  it("tillater kryssing på tvers av leden", () => {
    const result = checkTssStep(
      mask,
      { lat: 57.6, lon: 10.8 },
      { lat: 57.8, lon: 10.55 },
      DEFAULT_TSS_PARAMS,
    );
    expect(result.check.ok).toBe(true);
    expect(result.flags).toBe(0);
  });

  it("gjør ingenting når det ikke finnes noen maske", () => {
    const result = checkTssStep(
      undefined,
      { lat: 57.6, lon: 10.5 },
      { lat: 57.75, lon: 10.75 },
      DEFAULT_TSS_PARAMS,
    );
    expect(result.check.ok).toBe(true);
    expect(result.flags).toBe(0);
  });
});
