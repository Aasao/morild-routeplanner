import { describe, expect, it } from "vitest";
import { buildDistanceField, OPEN_EDGE_GATE, weatherTilesForField } from "@morild/routing";
import {
  boundingBoxOf,
  selectTilesForRoute,
  tileSizeDegOf,
  tilesFor,
  tilesOverlapping,
} from "./tile-select.js";
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

/**
 * **Flisvalg-sikkerhetsregelen** (D7.2, vedtatt 2026-09-04). Hovedregelen er
 * A\*-feltets rekkevidde; fallback er endepunkt-bboksen + ≥ 0,5°. Manglende
 * fliser skal komme UT av funksjonen, ikke forsvinne i den.
 */
describe("selectTilesForRoute — D7.2", () => {
  /** §7-rutenett, 1°-fliser rundt Skjæløy–Skagen. */
  function gridPointer(ids: readonly string[]): WeatherPointer {
    return pointer(
      ids.map((id) => {
        const [lonIndex, latIndex] = id.split("_").map(Number) as [number, number];
        return {
          tileId: id,
          bbox: [lonIndex, latIndex, lonIndex + 1, latIndex + 1] as const,
          fields: [],
        };
      }),
    );
  }

  it("leser flisstørrelsen ut av pekeren (1° her, 2° i dagens ekte pakke)", () => {
    expect(tileSizeDegOf(gridPointer(["10_58"]))).toBe(1);
    expect(
      tileSizeDegOf(pointer([{ tileId: "5_28", bbox: [10, 56, 12, 58], fields: [] }])),
    ).toBe(2);
    // Fliser som ikke er kvadratiske / ikke deler rutenett ⇒ ukjent.
    expect(
      tileSizeDegOf(pointer([{ tileId: "rar", bbox: [10, 56, 12, 59], fields: [] }])),
    ).toBeUndefined();
    expect(tileSizeDegOf(pointer([]))).toBeUndefined();
  });

  it("bruker A*-feltet når det finnes, og henter FLERE fliser enn ruteboksen alene", () => {
    const field = buildDistanceField(SKJAELOY, SKAGEN, OPEN_EDGE_GATE, { cellDeg: 0.05 })!;
    const all = weatherTilesForField(field, null, 1).map((t) => t.id);
    const selection = selectTilesForRoute(gridPointer(all), [SKJAELOY, SKAGEN], field);

    expect(selection.rule).toBe("a-star-felt");
    expect(selection.missingTileIds).toEqual([]);
    expect(selection.tiles.map((t) => t.tileId)).toEqual(all);
    // Ruteboksen alene ville gitt tre fliser (10_57/10_58/10_59) — feltet gir
    // flere, og det er nettopp sikkerhetsmarginen D7.2 ber om.
    expect(selection.tiles.length).toBeGreaterThan(3);
  });

  it("rapporterer manglende fliser i stedet for å avvise ruten stille", () => {
    const field = buildDistanceField(SKJAELOY, SKAGEN, OPEN_EDGE_GATE, { cellDeg: 0.05 })!;
    const all = weatherTilesForField(field, null, 1).map((t) => t.id);
    const withoutOne = all.filter((id) => id !== "10_58");
    const selection = selectTilesForRoute(gridPointer(withoutOne), [SKJAELOY, SKAGEN], field);

    expect(selection.missingTileIds).toEqual(["10_58"]);
    expect(selection.tiles.map((t) => t.tileId)).not.toContain("10_58");
  });

  it("faller tilbake på endepunkt-bbox + 0,5° når A*-feltet mangler", () => {
    const selection = selectTilesForRoute(
      gridPointer(["9_57", "10_57", "10_58", "10_59", "11_57", "11_58", "11_59", "9_58", "9_59"]),
      [SKJAELOY, SKAGEN],
      undefined,
    );
    expect(selection.rule).toBe("endepunkt-bbox");
    // Boksen 10,58–10,93 × 57,72–59,10 utvidet med 0,5° ⇒ lon 10,08–11,43,
    // lat 57,22–59,60: flisene 10_57..11_59.
    expect(selection.requiredTileIds).toEqual([
      "10_57",
      "10_58",
      "10_59",
      "11_57",
      "11_58",
      "11_59",
    ]);
    expect(selection.missingTileIds).toEqual([]);
  });

  it("pekere uten gjenkjennelig rutenett faller tilbake på ren bbox-overlapp — og sier det", () => {
    // Ikke-kvadratisk flis ⇒ ingen §7-rutenettaritmetikk å håndheve.
    const p = pointer([
      { tileId: "rar", bbox: [8, 56, 12, 59], fields: [] },
    ]);
    const selection = selectTilesForRoute(p, [SKJAELOY, SKAGEN], undefined);
    expect(selection.rule).toBe("bbox-overlapp");
    expect(selection.tiles.map((t) => t.tileId)).toEqual(["rar"]);
    expect(selection.tileSizeDeg).toBeUndefined();
  });
});
