import { describe, expect, it } from "vitest";
import { WEATHER_PACKAGE_PLACEHOLDER } from "./index.js";

describe("packages/weather (fase 0-skjelett)", () => {
  it("eksporterer placeholderen inntil fase 3 fyller pakken", () => {
    expect(WEATHER_PACKAGE_PLACEHOLDER).toBe("weather");
  });
});
