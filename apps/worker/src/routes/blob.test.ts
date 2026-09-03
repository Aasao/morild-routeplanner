import { describe, expect, it } from "vitest";
import { isAllowedBlobKey } from "./blob.js";

describe("isAllowedBlobKey", () => {
  it("tillater nøkler under de kjente prefiksene", () => {
    expect(isAllowedBlobKey("weather/1/ab12cd.bin")).toBe(true);
    expect(isAllowedBlobKey("charts/1/deadbeef.pmtiles")).toBe(true);
  });

  it("avviser nøkler utenfor de kjente prefiksene", () => {
    expect(isAllowedBlobKey("pointer/vaer-skandinavia.json")).toBe(false);
    expect(isAllowedBlobKey("secrets/whatever")).toBe(false);
    expect(isAllowedBlobKey("")).toBe(false);
  });

  it("avviser forsøk på å bevege seg ut av prefikset med ..", () => {
    expect(isAllowedBlobKey("weather/../secrets/whatever")).toBe(false);
    expect(isAllowedBlobKey("weather/1/../../secrets")).toBe(false);
  });
});
