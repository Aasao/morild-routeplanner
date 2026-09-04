import { describe, expect, it } from "vitest";
import { angularDiffDeg, fieldMaxDirectionErrorDeg, maxDirectionErrorDeg } from "./direction-budget.js";

describe("angularDiffDeg", () => {
  it("er 0 for identiske retninger", () => {
    expect(angularDiffDeg(123.4, 123.4)).toBe(0);
  });

  it("regner enkle differanser uten wraparound korrekt", () => {
    expect(angularDiffDeg(10, 30)).toBeCloseTo(20, 9);
    expect(angularDiffDeg(30, 10)).toBeCloseTo(20, 9);
  });

  it("håndterer 0°/360°-wraparound korrekt (359° og 1° er 2° fra hverandre, ikke 358°)", () => {
    expect(angularDiffDeg(359, 1)).toBeCloseTo(2, 9);
    expect(angularDiffDeg(1, 359)).toBeCloseTo(2, 9);
  });

  it("maks mulig differanse er 180°", () => {
    expect(angularDiffDeg(0, 180)).toBeCloseTo(180, 9);
    expect(angularDiffDeg(90, 270)).toBeCloseTo(180, 9);
  });
});

describe("maxDirectionErrorDeg", () => {
  it("er 0 når det ikke finnes noen dekodefeil å oversette til retningsusikkerhet", () => {
    expect(maxDirectionErrorDeg(10, 0)).toBe(0);
    expect(maxDirectionErrorDeg(0, 0)).toBe(0); // selv ved fart 0 — ingen feil å rotere med
  });

  it("gir asin(e/speed) i grader for speed > maxDecodeErrorKn", () => {
    // e=1, speed=2 ⇒ asin(0.5) = 30°.
    expect(maxDirectionErrorDeg(2, 1)).toBeCloseTo(30, 6);
    // e=1, speed=1.0001 (rett over terskelen) ⇒ nær 90°, men definert.
    expect(maxDirectionErrorDeg(1.0001, 1)).toBeGreaterThan(80);
    expect(maxDirectionErrorDeg(1.0001, 1)).toBeLessThan(90);
  });

  it("er strengt voksende når farten nærmer seg dekodefeilen ovenfra", () => {
    const wide = maxDirectionErrorDeg(10, 1)!;
    const narrow = maxDirectionErrorDeg(2, 1)!;
    expect(narrow).toBeGreaterThan(wide); // lavere fart ⇒ mer usikker retning, for samme feil
  });

  it("er undefined (dårlig definert) når fart <= maxDecodeErrorKn — IKKE et brudd", () => {
    expect(maxDirectionErrorDeg(1, 1)).toBeUndefined(); // eksakt terskel
    expect(maxDirectionErrorDeg(0.5, 1)).toBeUndefined(); // godt under terskel
    expect(maxDirectionErrorDeg(0, 1)).toBeUndefined();
  });

  it("håndterer speed akkurat over terskelen uten NaN (asin-domenet respekteres)", () => {
    const result = maxDirectionErrorDeg(1 + 1e-9, 1);
    expect(result).toBeDefined();
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe("fieldMaxDirectionErrorDeg — sertifikatets feltskanning (D7.4)", () => {
  it("tar maks over punktene der retning er definert, ekskluderer udefinerte (lav fart) punkter", () => {
    // e=1: speed=2 ⇒ 30°, speed=10 ⇒ ~5,74°, speed<=1 ⇒ udefinert (ekskluderes).
    const result = fieldMaxDirectionErrorDeg([2, 10, 0.5, 1, 0], 1);
    expect(result).toBeCloseTo(30, 6);
  });

  it("returnerer 0 (ikke undefined/NaN) når INGEN punkt har en definert retningsskranke", () => {
    expect(fieldMaxDirectionErrorDeg([0, 0.2, 0.9], 1)).toBe(0);
    expect(fieldMaxDirectionErrorDeg([], 1)).toBe(0);
  });

  it("maxDecodeErrorKn<=0 ⇒ 0 for ethvert felt (ingen feil å oversette til retningsusikkerhet)", () => {
    expect(fieldMaxDirectionErrorDeg([2, 10, 50], 0)).toBe(0);
  });
});
