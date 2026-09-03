import { describe, expect, it } from "vitest";
import {
  classifyCoastalZone,
  computeSubtiles,
  tileBounds,
  tileIdForLonLat,
  tilesOverlapping,
} from "./grid.js";

describe("tileIdForLonLat / tileBounds — delt origo med kartflisene", () => {
  it("gir heltallsgrense-fliser forankret i (0,0)", () => {
    expect(tileIdForLonLat(10.5, 59.1)).toEqual({ lonIndex: 5, latIndex: 29 });
    expect(tileBounds({ lonIndex: 5, latIndex: 29 })).toEqual({
      west: 10,
      south: 58,
      east: 12,
      north: 60,
    });
  });

  it("negative koordinater floorer riktig (ikke mot null)", () => {
    expect(tileIdForLonLat(-0.5, 59)).toEqual({ lonIndex: -1, latIndex: 29 });
  });

  it("et punkt på selve flisgrensen tilhører flisen øst/nord for grensen", () => {
    // lon=10 er selve grenselinjen mellom flis 4 og flis 5.
    expect(tileIdForLonLat(10, 58)).toEqual({ lonIndex: 5, latIndex: 29 });
  });
});

describe("tilesOverlapping", () => {
  it("Skjæløy–Skagen-bboxen (spike-thredds.md) krysser flere 2°-fliser", () => {
    const tiles = tilesOverlapping({ west: 9.0, south: 57.3, east: 11.5, north: 59.6 });
    // 9-11.5E -> lonIndex 4 (8-10) og 5 (10-12); 57.3-59.6N -> latIndex 28 (56-58) og 29 (58-60).
    expect(tiles).toHaveLength(4);
    expect(tiles).toEqual(
      expect.arrayContaining([
        { lonIndex: 4, latIndex: 28 },
        { lonIndex: 5, latIndex: 28 },
        { lonIndex: 4, latIndex: 29 },
        { lonIndex: 5, latIndex: 29 },
      ]),
    );
  });
});

describe("computeSubtiles", () => {
  it("deler et 106x106-vindu (spike-funn 6) i <=32x32-subfliser med restrader/-kolonner", () => {
    const subtiles = computeSubtiles({ yStart: 0, yEnd: 105, xStart: 0, xEnd: 105 });
    // 106 / 32 = 3,3125 -> 4 rader/kolonner (32,32,32,10)
    const rows = new Set(subtiles.map((s) => s.subtileRow));
    const cols = new Set(subtiles.map((s) => s.subtileCol));
    expect(rows.size).toBe(4);
    expect(cols.size).toBe(4);
    expect(subtiles).toHaveLength(16);

    const last = subtiles.find((s) => s.subtileRow === 3 && s.subtileCol === 3);
    expect(last).toEqual({ yStart: 96, yEnd: 105, xStart: 96, xEnd: 105, subtileRow: 3, subtileCol: 3 });
    // Restraden er mindre (10 noder), ikke 32 — ikke en feil å håndtere bort (§7).
    expect(last!.yEnd - last!.yStart + 1).toBe(10);
  });

  it("et vindu som deler jevnt gir kun fulle 32x32-subfliser", () => {
    const subtiles = computeSubtiles({ yStart: 0, yEnd: 63, xStart: 0, xEnd: 31 });
    expect(subtiles).toHaveLength(2);
    for (const s of subtiles) {
      expect(s.xEnd - s.xStart + 1).toBe(32);
    }
  });

  it("kaster på ugyldig maxNodes", () => {
    expect(() => computeSubtiles({ yStart: 0, yEnd: 1, xStart: 0, xEnd: 1 }, 0)).toThrow();
  });
});

describe("classifyCoastalZone (§9.4 — kystsone-klassifiseringen, §17 pkt. 8)", () => {
  it("klassifiserer <=20 nm som kystsone", () => {
    expect(classifyCoastalZone(0)).toBe("coastal");
    expect(classifyCoastalZone(19.999)).toBe("coastal");
    expect(classifyCoastalZone(20)).toBe("coastal");
  });

  it("klassifiserer >20 nm som utaskjærs", () => {
    expect(classifyCoastalZone(20.001)).toBe("offshore");
    expect(classifyCoastalZone(500)).toBe("offshore");
  });

  it("manglende kystlinjedekning defaulter til kystsone, ALDRI utaskjærs (§9.4 punkt 4)", () => {
    expect(classifyCoastalZone(undefined)).toBe("coastal");
  });

  it("respekterer en injisert terskel (byggetids-verifisering per flis, §9.4)", () => {
    expect(classifyCoastalZone(15, 10)).toBe("offshore");
  });
});
