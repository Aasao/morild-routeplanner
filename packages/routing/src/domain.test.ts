import { describe, expect, it } from "vitest";
import {
  CellGrid,
  cellKeyOfState,
  COURSE_SECTORS,
  courseSector,
  NO_COURSE,
  SCANDINAVIA,
  sectorOfState,
  stateKeyOf,
  v1CellKeyForRegressionTest,
} from "./domain.js";

describe("cellKey", () => {
  /**
   * Uttømmende sjekk uten `expect` i den varme løkka — 1,4 millioner
   * assertions ville tatt et halvminutt og lært oss det samme.
   */
  function exhaustiveCollisionCheck(grid: CellGrid): {
    checked: number;
    collisions: number;
    undefinedKeys: number;
    roundTripErrors: number;
  } {
    const seen = new Uint8Array(grid.cellCount);
    let checked = 0;
    let collisions = 0;
    let undefinedKeys = 0;
    let roundTripErrors = 0;
    for (let iLat = 0; iLat < grid.latRows; iLat++) {
      for (let iLon = 0; iLon < grid.lonStride; iLon++) {
        const expected = iLat * grid.lonStride + iLon;
        const center = grid.centerOf(expected);
        const key = grid.keyOf(center.lat, center.lon);
        checked++;
        if (key === undefined) {
          undefinedKeys++;
          continue;
        }
        if (key !== expected) roundTripErrors++;
        if (seen[key] === 1) collisions++;
        seen[key] = 1;
      }
    }
    return { checked, collisions, undefinedKeys, roundTripErrors };
  }

  it("er kollisjonsfri over hele Skandinavia-gitteret ved cellDeg = 0,02", () => {
    const grid = new CellGrid(SCANDINAVIA, 0.02);
    const result = exhaustiveCollisionCheck(grid);
    expect(result.checked).toBe(grid.cellCount);
    expect(result.checked).toBeGreaterThan(1_400_000);
    expect(result.collisions).toBe(0);
    expect(result.undefinedKeys).toBe(0);
    expect(result.roundTripErrors).toBe(0);
  });

  it("er kollisjonsfri også for domener med negative lengdegrader", () => {
    // Nordsjø-boks som krysser nullmeridianen: her ville v1s formel fått
    // negative lengdegradledd, som er tilfellet spec-en peker på.
    const grid = new CellGrid(
      { latMin: 55, latMax: 62, lonMin: -12, lonMax: 8 },
      0.02,
    );
    const result = exhaustiveCollisionCheck(grid);
    expect(result.checked).toBe(grid.cellCount);
    expect(result.collisions).toBe(0);
    expect(result.undefinedKeys).toBe(0);
    expect(result.roundTripErrors).toBe(0);
  });

  it("skiller vestlig og østlig lengdegrad med samme tallverdi", () => {
    const grid = new CellGrid(
      { latMin: 55, latMax: 62, lonMin: -12, lonMax: 12 },
      0.02,
    );
    const west = grid.keyOf(58.5, -6.42);
    const east = grid.keyOf(58.5, 6.42);
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    expect(west).not.toBe(east);
  });

  it("regresjon: v1s nøkkelformel kolliderer, v2 nekter å lage nøkkelen", () => {
    // v1: round(lat/cell)*100000 + round(lon/cell). Kollisjonsfri bare så
    // lenge |lonIdx| < 50 000 — en uskreven forutsetning. Den holder ved v1s
    // faste cellDeg = 0,02, men brytes ved finere oppløsning, og da med
    // negativ lengdegrad i den ene enden slik at leddene «låner» av hverandre.
    const cellDeg = 0.001;
    const a = { lat: 59.001, lon: -60 };
    const b = { lat: 59.0, lon: 40 };
    expect(v1CellKeyForRegressionTest(a.lat, a.lon, cellDeg)).toBe(
      v1CellKeyForRegressionTest(b.lat, b.lon, cellDeg),
    );

    // v2 produserer aldri en nøkkel den ikke kan bevise er unik: et domene
    // stort nok til å inneholde begge punktene ved denne oppløsningen blir
    // avvist allerede i konstruktøren.
    expect(
      () =>
        new CellGrid({ latMin: 58, latMax: 60, lonMin: -70, lonMax: 50 }, cellDeg),
    ).toThrow(/Int32/);

    // Og innenfor et domene som faktisk lar seg nøkle, er punktene ulike.
    const grid = new CellGrid(
      { latMin: 58.9, latMax: 59.1, lonMin: -60.5, lonMax: -59.5 },
      cellDeg,
    );
    expect(grid.keyOf(a.lat, a.lon)).toBeDefined();
    expect(grid.keyOf(b.lat, b.lon)).toBeUndefined();
    expect(grid.keyOf(59.001, -60)).not.toBe(grid.keyOf(59.0, -60));
    expect(grid.keyOf(59.001, -60)).not.toBe(grid.keyOf(59.001, -60.001));
  });

  it("avviser punkter utenfor domenet i stedet for å lage en nøkkel", () => {
    const grid = new CellGrid(SCANDINAVIA, 0.02);
    expect(grid.keyOf(52.9, 10)).toBeUndefined();
    expect(grid.keyOf(72.1, 10)).toBeUndefined();
    expect(grid.keyOf(60, 1.9)).toBeUndefined();
    expect(grid.keyOf(60, 32.1)).toBeUndefined();
    expect(grid.keyOf(60, -10)).toBeUndefined();
  });

  it("avviser konfigurasjoner der nøkkelrommet ikke får plass i Int32", () => {
    expect(() => new CellGrid(SCANDINAVIA, 0.0001)).toThrow(/Int32/);
  });

  it("centerOf er invers av keyOf", () => {
    const grid = new CellGrid(SCANDINAVIA, 0.02);
    const key = grid.keyOf(59.1032, 10.9327);
    expect(key).toBeDefined();
    if (key === undefined) return;
    const center = grid.centerOf(key);
    expect(grid.keyOf(center.lat, center.lon)).toBe(key);
    expect(Math.abs(center.lat - 59.1032)).toBeLessThan(0.02);
    expect(Math.abs(center.lon - 10.9327)).toBeLessThan(0.02);
  });
});

describe("courseSector", () => {
  it("legger sektorgrensene på 22,5° + n·45°", () => {
    expect(courseSector(0)).toBe(0);
    expect(courseSector(22.4)).toBe(0);
    expect(courseSector(337.5)).toBe(0);
    expect(courseSector(359.9)).toBe(0);
    expect(courseSector(22.5)).toBe(1);
    expect(courseSector(45)).toBe(1);
    expect(courseSector(90)).toBe(2);
    expect(courseSector(180)).toBe(4);
    expect(courseSector(270)).toBe(6);
  });

  it("wrapper riktig ved 0/360 og for negative kurser", () => {
    expect(courseSector(360)).toBe(courseSector(0));
    expect(courseSector(-10)).toBe(courseSector(350));
    expect(courseSector(720 + 91)).toBe(courseSector(91));
  });

  it("gir alltid en sektor i [0, 8) og aldri NO_COURSE", () => {
    for (let h = 0; h < 360; h += 0.5) {
      const s = courseSector(h);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(COURSE_SECTORS);
      expect(s).not.toBe(NO_COURSE);
    }
  });
});

describe("stateKey", () => {
  it("gir NO_COURSE en egen tilstand som ikke kolliderer med sektor 0", () => {
    const cell = 12345;
    expect(stateKeyOf(cell, NO_COURSE)).not.toBe(stateKeyOf(cell, 0));
    expect(stateKeyOf(cell, NO_COURSE)).not.toBe(stateKeyOf(cell + 1, 0));
  });

  it("er injektiv over (celle, sektor)", () => {
    const seen = new Set<number>();
    for (let cell = 0; cell < 500; cell++) {
      for (let sector = 0; sector <= NO_COURSE; sector++) {
        const key = stateKeyOf(cell, sector);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(cellKeyOfState(key)).toBe(cell);
        expect(sectorOfState(key)).toBe(sector);
      }
    }
  });
});
