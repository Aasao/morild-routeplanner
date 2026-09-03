import { describe, expect, it } from "vitest";
import { boundingBoxOf, tilesFor, tilesOverlapping } from "./tile-select.js";
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

describe("tilesOverlapping / tilesFor", () => {
  it("finner en flis som overlapper ruteboksen", () => {
    const p = pointer([{ tileId: "a", bbox: [8, 56, 12, 60], fields: [] }]);
    const overlapping = tilesOverlapping(p, boundingBoxOf([SKJAELOY, SKAGEN]));
    expect(overlapping).toHaveLength(1);
    expect(tilesFor(p, [SKJAELOY, SKAGEN]).map((t) => t.tileId)).toEqual(["a"]);
  });

  it("returnerer tom liste når ingen flis dekker ruten (N2: synlig, ikke skjult)", () => {
    const p = pointer([{ tileId: "langt-unna", bbox: [-10, 0, -8, 2], fields: [] }]);
    expect(tilesFor(p, [SKJAELOY, SKAGEN])).toEqual([]);
  });

  it("finner ALLE overlappende fliser (rettet review-funn, funn 2: tidligere ble kun første brukt)", () => {
    const p = pointer([
      { tileId: "forste", bbox: [8, 56, 12, 60], fields: [] },
      { tileId: "andre", bbox: [9, 57, 11, 59], fields: [] },
    ]);
    expect(tilesFor(p, [SKJAELOY, SKAGEN]).map((t) => t.tileId)).toEqual(["forste", "andre"]);
  });

  it("finner begge fliser i den ekte 2°-flisdelingen ved 58°N (Skjæløy–Skagen: 5_28 sør, 5_29 nord)", () => {
    const p = pointer([
      { tileId: "5_28", bbox: [10, 56, 12, 58], fields: [] }, // dekker Skagen-enden (~57,7°N)
      { tileId: "5_29", bbox: [10, 58, 12, 60], fields: [] }, // dekker Skjæløy-enden (~59,1°N)
    ]);
    const tiles = tilesFor(p, [SKJAELOY, SKAGEN]);
    expect(tiles.map((t) => t.tileId).sort()).toEqual(["5_28", "5_29"]);
  });
});
