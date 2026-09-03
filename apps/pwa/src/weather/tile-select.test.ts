import { describe, expect, it } from "vitest";
import { boundingBoxOf, primaryTileFor, tilesOverlapping } from "./tile-select.js";
import type { WeatherPointer } from "./pointer-types.js";
import { SKAGEN, SKJAELOY } from "@morild/routing/test-fixtures/golden-scenarios";

function pointer(tiles: WeatherPointer["tiles"]): WeatherPointer {
  return { formatVersion: "1.0.0", tiles };
}

describe("boundingBoxOf", () => {
  it("regner ut vest/sør/øst/nord fra en punktliste", () => {
    expect(boundingBoxOf([SKJAELOY, SKAGEN])).toEqual([10.5836, 57.7211, 10.9327, 59.1032]);
  });

  it("kaster på tom liste", () => {
    expect(() => boundingBoxOf([])).toThrow();
  });
});

describe("tilesOverlapping / primaryTileFor", () => {
  it("finner en flis som overlapper ruteboksen", () => {
    const p = pointer([{ tileId: "a", bbox: [8, 56, 12, 60], fields: [] }]);
    const overlapping = tilesOverlapping(p, boundingBoxOf([SKJAELOY, SKAGEN]));
    expect(overlapping).toHaveLength(1);
    expect(primaryTileFor(p, [SKJAELOY, SKAGEN])?.tileId).toBe("a");
  });

  it("returnerer undefined når ingen flis dekker ruten (N2: synlig, ikke skjult)", () => {
    const p = pointer([{ tileId: "langt-unna", bbox: [-10, 0, -8, 2], fields: [] }]);
    expect(primaryTileFor(p, [SKJAELOY, SKAGEN])).toBeUndefined();
  });

  it("velger FØRSTE overlappende flis når flere fliser overlapper (dokumentert forenkling)", () => {
    const p = pointer([
      { tileId: "forste", bbox: [8, 56, 12, 60], fields: [] },
      { tileId: "andre", bbox: [9, 57, 11, 59], fields: [] },
    ]);
    expect(primaryTileFor(p, [SKJAELOY, SKAGEN])?.tileId).toBe("forste");
  });
});
