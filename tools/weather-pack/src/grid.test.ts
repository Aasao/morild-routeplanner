import { describe, expect, it } from "vitest";
import {
  classifyCoastalZone,
  computeSubtiles,
  tileBounds,
  tileIdForLonLat,
  tilesOverlapping,
} from "./grid.js";

describe("tileIdForLonLat / tileBounds — delt origo med kartflisene (D7.1: standard er nå 1°, fase 3 bølge 3A)", () => {
  it("gir heltallsgrense-fliser forankret i (0,0)", () => {
    expect(tileIdForLonLat(10.5, 59.1)).toEqual({ lonIndex: 10, latIndex: 59 });
    expect(tileBounds({ lonIndex: 10, latIndex: 59 })).toEqual({
      west: 10,
      south: 59,
      east: 11,
      north: 60,
    });
  });

  it("negative koordinater floorer riktig (ikke mot null)", () => {
    expect(tileIdForLonLat(-0.5, 59)).toEqual({ lonIndex: -1, latIndex: 59 });
  });

  it("et punkt på selve flisgrensen tilhører flisen øst/nord for grensen", () => {
    // lon=10 er selve grenselinjen mellom flis 9 og flis 10.
    expect(tileIdForLonLat(10, 58)).toEqual({ lonIndex: 10, latIndex: 58 });
  });
});

describe("tilesOverlapping", () => {
  it("Skjæløy–Skagen-bboxen (spike-thredds.md) krysser flere 1°-fliser", () => {
    const tiles = tilesOverlapping({ west: 9.0, south: 57.3, east: 11.5, north: 59.6 });
    // 9-11.5E -> lonIndex 9,10,11; 57.3-59.6N -> latIndex 57,58,59 -> 3x3 = 9 fliser.
    expect(tiles).toHaveLength(9);
    expect(tiles).toEqual(
      expect.arrayContaining([
        { lonIndex: 9, latIndex: 57 },
        { lonIndex: 11, latIndex: 59 },
      ]),
    );
  });
});

describe("tileSizeDeg-parameter (D6-C 2026-09-03 / D7.1 2026-09-04 — flisstørrelse er en eksplisitt parameter, standard er nå 1°)", () => {
  it("tileIdForLonLat/tileBounds tar en valgfri tileSizeDeg uten å endre 1°-standarden", () => {
    expect(tileIdForLonLat(10.5, 59.1)).toEqual(tileIdForLonLat(10.5, 59.1, 1));
    expect(tileIdForLonLat(10.5, 59.1, 2)).toEqual({ lonIndex: 5, latIndex: 29 });
    expect(tileBounds({ lonIndex: 5, latIndex: 29 }, 2)).toEqual({
      west: 10,
      south: 58,
      east: 12,
      north: 60,
    });
  });

  it("tilesOverlapping med tileSizeDeg=1 gir flere, mindre fliser enn 2°", () => {
    const bbox = { west: 9.0, south: 57.3, east: 11.5, north: 59.6 };
    const tiles1 = tilesOverlapping(bbox, 1);
    const tiles2 = tilesOverlapping(bbox, 2);
    expect(tiles1.length).toBeGreaterThan(tiles2.length);
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
