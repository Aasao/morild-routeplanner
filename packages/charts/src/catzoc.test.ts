import { describe, expect, it } from "vitest";
import { effectiveDepthRequirement } from "./catzoc.js";
import type { CatzocClass } from "./pack-format.js";

const ALL_CATZOC: readonly CatzocClass[] = ["A1", "A2", "B", "C", "D", "U"];

describe("effectiveDepthRequirement — f=0-kontrakt (B4, CATZOC-semantikkforberedelse)", () => {
  it.each(ALL_CATZOC)(
    "gir uendret basiskrav for catzocSone=%s (f=0 inntil kalibrering)",
    (sone) => {
      expect(effectiveDepthRequirement(2.6, sone)).toBe(2.6);
    },
  );

  it("gir uendret basiskrav når ingen CATZOC-sone dekker punktet (undefined)", () => {
    expect(effectiveDepthRequirement(2.6, undefined)).toBe(2.6);
  });

  it("er ren addisjon av f — 0 for et vilkårlig basiskrav, ikke bare 2,6 m", () => {
    expect(effectiveDepthRequirement(0, "A1")).toBe(0);
    expect(effectiveDepthRequirement(10, "C")).toBe(10);
    expect(effectiveDepthRequirement(5.5, undefined)).toBe(5.5);
  });
});
