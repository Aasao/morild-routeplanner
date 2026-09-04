/**
 * Flisvalg-sikkerhetsregelen (D7.2) — se `weather-tiles.ts` for hvorfor
 * flissettet må komme fra A\*-feltets rekkevidde og ikke fra endepunktenes
 * bbox.
 */
import { describe, expect, it } from "vitest";
import { OPEN_EDGE_GATE, maskAsEdgeGate } from "./contracts.js";
import { buildDistanceField, DistanceField } from "./distance-field.js";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { SKAGEN, SKJAELOY } from "../test-fixtures/golden-scenarios.js";
import {
  FALLBACK_TILE_PAD_DEG,
  padBounds,
  tubReachNm,
  weatherTilesForBounds,
  weatherTilesForField,
} from "./weather-tiles.js";

/** Minifelt bygget direkte fra data — full kontroll på hvilke celler som er nåbare. */
function fieldFrom(
  lat0: number,
  lon0: number,
  cellDeg: number,
  rows: readonly (readonly number[])[],
): DistanceField {
  const height = rows.length;
  const width = rows[0]!.length;
  const d = new Float64Array(width * height);
  for (let iy = 0; iy < height; iy++) {
    for (let ix = 0; ix < width; ix++) d[iy * width + ix] = rows[iy]![ix]!;
  }
  return new DistanceField({ lat0, lon0, cellDeg, width, height, d });
}

describe("weatherTilesForBounds — fallback-regelen", () => {
  it("bruker §7s flisrutenett-aritmetikk (floor(v/steg), id «lon_lat»)", () => {
    const tiles = weatherTilesForBounds(
      { west: 10.5, south: 57.7, east: 10.9, north: 59.1 },
      2,
    );
    // Skjæløy–Skagen med 2°-fliser: 5_28 (sør for 58°N) og 5_29 (nord) —
    // nøyaktig de to flisene den ekte pakken har.
    expect(tiles.map((t) => t.id)).toEqual(["5_28", "5_29"]);
    expect(tiles[0]).toMatchObject({ west: 10, south: 56, east: 12, north: 58 });
  });

  it("1°-fliser gir flere, mindre fliser for samme boks", () => {
    const tiles = weatherTilesForBounds(
      { west: 10.5, south: 57.7, east: 10.9, north: 59.1 },
      1,
    );
    expect(tiles.map((t) => t.id)).toEqual(["10_57", "10_58", "10_59"]);
  });

  it("padBounds utvider med minst 0,5° — også når kalleren ber om mindre", () => {
    const b = { west: 10, south: 58, east: 11, north: 59 };
    expect(padBounds(b, 0)).toEqual({
      west: 10 - FALLBACK_TILE_PAD_DEG,
      south: 58 - FALLBACK_TILE_PAD_DEG,
      east: 11 + FALLBACK_TILE_PAD_DEG,
      north: 59 + FALLBACK_TILE_PAD_DEG,
    });
    expect(padBounds(b, 1.5).west).toBe(8.5);
  });

  it("avviser en ugyldig flisstørrelse i stedet for å gjette", () => {
    expect(() => weatherTilesForBounds({ west: 0, south: 0, east: 1, north: 1 }, 0)).toThrow();
  });
});

describe("weatherTilesForField — flissett fra feltets rekkevidde", () => {
  it("tar bare med fliser som dekker nåbart vann (Infinity = land/innestengt)", () => {
    // 2x2-celler på 1°-rutenettet: bare den sørvestlige cellen er nåbar.
    const field = fieldFrom(58.2, 10.2, 0.2, [
      [0, Infinity],
      [Infinity, Infinity],
    ]);
    const ids = weatherTilesForField(field, null, 1).map((t) => t.id);
    expect(ids).toEqual(["10_58"]);
  });

  /**
   * Én rad på 0,1°-celler fra 10,0° til 13,0°: nær målet i vest, og
   * uoverkommelig langt unna (400 nm) fra 11,6° og østover. Hullet mellom
   * 11,5 og 11,6 er der nettopp fordi cellene utvides med én cellebredde
   * for `atNear` — uten det ville naboflisen blitt dratt inn uansett.
   */
  function reachRow(): DistanceField {
    const row: number[] = [];
    for (let ix = 0; ix < 30; ix++) {
      const lon = 10.0 + ix * 0.1;
      row.push(lon >= 11.6 ? 400 : ix * 0.2);
    }
    return fieldFrom(58.2, 10.0, 0.1, [row]);
  }

  it("Tub-bounden beskjærer: celler for langt fra målet faller ut", () => {
    // Vmax 8 kn i 1 t ⇒ nødvendig betingelse D ≤ 1,09·8·1·1,25 = 10,9 nm.
    const bound = { tubBoundS: 3600, vmaxKn: 8 };
    expect(tubReachNm(bound)).toBeCloseTo(10.9, 6);
    const ids = weatherTilesForField(reachRow(), bound, 1).map((t) => t.id);
    // Cellene med D = 400 nm er utenfor rekkevidde; flis 12 skal bort.
    // 9_58 er med fordi den vestligste cellen starter PÅ 10,0° og utvides
    // en cellebredde vestover — konservativt, som seg hør og bør.
    expect(ids).toEqual(["9_58", "10_58", "11_58"]);
  });

  it("uten Tub-bound tas hele det nåbare feltet med (konservativ retning)", () => {
    const ids = weatherTilesForField(reachRow(), null, 1).map((t) => t.id);
    expect(ids).toContain("12_58");
  });

  it("dekker `atNear`-nabolaget: en celle utvides med én cellebredde", () => {
    // Den eneste endelige cellen ligger 0,05° fra flisgrensen ved 58°N.
    // Motoren aksepterer en node i 3x3-nabolaget (v1s `atNear`), altså inntil
    // 0,1° unna — som krysser grensen. Begge fliser må derfor med.
    const field = fieldFrom(58.05, 10.5, 0.1, [[0]]);
    const ids = weatherTilesForField(field, null, 1).map((t) => t.id);
    expect(ids).toEqual(["10_57", "10_58"]);
  });

  it("er deterministisk sortert (lengdeindeks, så breddeindeks)", () => {
    const field = fieldFrom(57.5, 9.5, 1, [
      [0, 1, 2],
      [3, 4, 5],
    ]);
    const ids = weatherTilesForField(field, null, 1).map((t) => t.id);
    expect([...ids].sort()).not.toBe(ids); // ingen tilfeldig sortering
    const lon = ids.map((id) => Number(id.split("_")[0]));
    expect(lon).toEqual([...lon].sort((a, b) => a - b));
  });

  it("ekte geometri: Skjæløy–Skagen gir et STØRRE flissett enn endepunkt-bboksen", () => {
    // Kjernen i D7.2: feltets rekkevidde dekker der medlemsrutene faktisk
    // kan gå (9,6–17,6 nm utenfor luftlinjen ifølge panelet), mens en naken
    // endepunkt-bbox ikke gjør det.
    const field = buildDistanceField(SKJAELOY, SKAGEN, OPEN_EDGE_GATE, {
      cellDeg: 0.05,
    })!;
    const fromField = weatherTilesForField(field, null, 1).map((t) => t.id);
    const fromBbox = weatherTilesForBounds(
      {
        west: Math.min(SKJAELOY.lon, SKAGEN.lon),
        south: Math.min(SKJAELOY.lat, SKAGEN.lat),
        east: Math.max(SKJAELOY.lon, SKAGEN.lon),
        north: Math.max(SKJAELOY.lat, SKAGEN.lat),
      },
      1,
    ).map((t) => t.id);
    for (const id of fromBbox) expect(fromField).toContain(id);
    expect(fromField.length).toBeGreaterThan(fromBbox.length);
  });

  it("et felt bygget med maske gir aldri færre fliser enn ruten kan trenge", () => {
    // Med land i veien blir feltet mindre — men fortsatt en overmengde av
    // det søket kan nå, siden søket selv er begrenset av det samme feltet.
    const mask = rectMask();
    const field = buildDistanceField(
      SKJAELOY,
      SKAGEN,
      maskAsEdgeGate(mask),
      { cellDeg: 0.05 },
    )!;
    const ids = weatherTilesForField(field, null, 1).map((t) => t.id);
    expect(ids).toContain("10_59"); // Skjæløy
    expect(ids).toContain("10_57"); // Skagen
  });
});
