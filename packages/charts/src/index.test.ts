import { describe, expect, it } from "vitest";
import { CHARTS_PACKAGE_PLACEHOLDER } from "./index.js";

describe("packages/charts (fase 0-skjelett)", () => {
  it("eksporterer placeholderen inntil fase 1 fyller pakken", () => {
    expect(CHARTS_PACKAGE_PLACEHOLDER).toBe("charts");
  });
});
