import { describe, expect, it } from "vitest";
import { POLAR_PACKAGE_PLACEHOLDER } from "./index.js";

describe("packages/polar (fase 0-skjelett)", () => {
  it("eksporterer placeholderen inntil fase 2 fyller pakken", () => {
    expect(POLAR_PACKAGE_PLACEHOLDER).toBe("polar");
  });
});
