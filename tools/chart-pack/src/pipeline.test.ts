import { describe, expect, it } from "vitest";
import {
  buildBufferedHazards,
  buildDataQualityZones,
  buildDepthBands,
  buildDryFallZones,
  buildTilePayloads,
  subtractHazardsFromBands,
  validateSoundingsAgainstBands,
} from "./pipeline.js";
import { pointInFeature } from "./geometry.js";
import * as turf from "@turf/turf";
import type { RawRing } from "./gml.js";
import type { DybdekurveFeature, PointFeature, PolygonFeature } from "./gml.js";

/** `[west,south,east,north]` → lukket ring, `[lon,lat]`-par (GeoJSON-konvensjon, se `RawRing`). */
function closedRing(west: number, south: number, east: number, north: number): RawRing {
  const coords: [number, number][] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return { coords, closed: true };
}

describe("§6.1 bånd-konstruksjon: to nøstede firkanter → korrekt ring-differanse", () => {
  it("bygger et indre bånd (0-5m) og et ytre bånd (5-10m) som ikke overlapper", () => {
    const inner: DybdekurveFeature = { id: "c5", dybdeM: 5, ring: closedRing(10.0, 59.0, 10.05, 59.05) };
    const outer: DybdekurveFeature = { id: "c10", dybdeM: 10, ring: closedRing(9.9, 58.9, 10.15, 59.15) };
    const { bands, issues, skippedOpenRings } = buildDepthBands([inner, outer]);

    expect(issues).toEqual([]);
    expect(skippedOpenRings).toBe(0);
    expect(bands).toHaveLength(2);
    expect(bands[0]).toMatchObject({ lowerBoundM: 0, upperBoundM: 5 });
    expect(bands[1]).toMatchObject({ lowerBoundM: 5, upperBoundM: 10 });

    // Sentrum av det indre polygonet skal være i bånd 0-5, ikke i bånd 5-10.
    const centerFeature0 = turf.polygon(bands[0]!.polygons[0]!.rings.map((r) => r.map(([lon, lat]) => [lon, lat])));
    const centerFeature1 = turf.polygon(bands[1]!.polygons[0]!.rings.map((r) => r.map(([lon, lat]) => [lon, lat])));
    expect(pointInFeature(10.02, 59.02, centerFeature0)).toBe(true);
    expect(pointInFeature(10.02, 59.02, centerFeature1)).toBe(false);
    // Et punkt mellom de to konturene (i "skallet") skal være i bånd 5-10.
    expect(pointInFeature(9.95, 58.95, centerFeature1)).toBe(true);
  });

  it("åpne (ikke-lukkede) konturlinjer telles og hoppes over, aldri stille droppet", () => {
    const openRing: DybdekurveFeature = {
      id: "open1",
      dybdeM: 5,
      ring: { coords: [[10, 59], [10.1, 59], [10.1, 59.1]], closed: false },
    };
    const { bands, skippedOpenRings } = buildDepthBands([openRing]);
    expect(bands).toEqual([]);
    expect(skippedOpenRings).toBe(1);
  });
});

describe("§6.1 tørrfall-subtraksjon fjerner riktig areal fra alle bånd", () => {
  it("et tørrfallsområde midt i et bånd skjærer hull i bandets polygon", () => {
    const curve: DybdekurveFeature = { id: "c5", dybdeM: 5, ring: closedRing(10.0, 59.0, 10.2, 59.2) };
    const { bands } = buildDepthBands([curve]);
    expect(bands).toHaveLength(1);

    const dryFallFeature: PolygonFeature = {
      id: "torrfall1",
      rings: [closedRing(10.08, 59.08, 10.12, 59.12)],
    };
    const { features } = buildDryFallZones([dryFallFeature]);
    expect(features).toHaveLength(1);

    const result = subtractHazardsFromBands(bands, features);
    const bandFeature = turf.polygon(result[0]!.polygons[0]!.rings.map((r) => r.map(([lon, lat]) => [lon, lat])));

    // Punkt inni det opprinnelige tørrfallsarealet er nå UTENFOR bandets polygon.
    expect(pointInFeature(10.1, 59.1, bandFeature)).toBe(false);
    // Punkt andre steder i bandet er fortsatt inni.
    expect(pointInFeature(10.02, 59.02, bandFeature)).toBe(true);
  });
});

describe("§6.1 skjær-buffer: punkt innenfor buffer-radius → no-go; rett utenfor → upåvirket", () => {
  it("standard 20 m buffer dekker et punkt ~10 m unna, men ikke ~200 m unna", () => {
    const skjaerPunkt: PointFeature = { id: "skjer1", point: [10.7, 59.1] };
    const { points } = buildBufferedHazards([skjaerPunkt], [], 20);
    expect(points).toHaveLength(1);
    const bufferFeature = turf.polygon(points[0]!.polygon.rings.map((r) => r.map(([lon, lat]) => [lon, lat])));

    // ~10 m nord for skjæret (grov approksimasjon: 1° lat ≈ 111 320 m).
    const nearby: [number, number] = [10.7, 59.1 + 10 / 111_320];
    expect(pointInFeature(nearby[0], nearby[1], bufferFeature)).toBe(true);

    // ~200 m unna skal være klart utenfor.
    const far: [number, number] = [10.7, 59.1 + 200 / 111_320];
    expect(pointInFeature(far[0], far[1], bufferFeature)).toBe(false);
  });
});

describe("VALSOU-modellen: dybdeattributt bæres gjennom for Grunne, ikke Skjær (E4)", () => {
  it("Grunne-punkt med dybdeattributt gir dybdeM i pakket BufferedHazardPoint", () => {
    const grunnePunkt: PointFeature = { id: "grunne1", point: [10.7, 59.1], dybdeM: 4.2 };
    const { points } = buildBufferedHazards([], [grunnePunkt], 20);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ kind: "grunne", dybdeM: 4.2 });
  });

  it("Grunne-punkt uten dybdeattributt gir dybdeM=undefined (ikke f.eks. 0)", () => {
    const grunnePunkt: PointFeature = { id: "grunne2", point: [10.7, 59.1] };
    const { points } = buildBufferedHazards([], [grunnePunkt], 20);
    expect(points).toHaveLength(1);
    expect(points[0]?.dybdeM).toBeUndefined();
  });

  it("Skjær-punkt bærer ikke dybdeM videre selv om PointFeature skulle ha en (skjær har aldri dybde i kildedataene)", () => {
    const skjaerPunkt: PointFeature = { id: "skjer1", point: [10.7, 59.1] };
    const { points } = buildBufferedHazards([skjaerPunkt], [], 20);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ kind: "skjaer" });
    expect(points[0]?.dybdeM).toBeUndefined();
  });
});

describe("QA-validator: dybdepunkt-sondering vs. bånd (felle 2, beslutning 2026-08-31)", () => {
  it("en sondering dypere enn eller lik båndets nedre grense gir ingen brudd", () => {
    const curve: DybdekurveFeature = { id: "c5", dybdeM: 5, ring: closedRing(10.0, 59.0, 10.2, 59.2) };
    const { bands } = buildDepthBands([curve]);
    // Bandet er 0-5 m. En sondering på 3 m innenfor bandet er konsistent
    // (3 m er "grunnere enn 5 m", akkurat det bandet påstår).
    const sounding: PointFeature = { id: "grunne.ok", point: [10.1, 59.1], dybdeM: 3 };
    const result = validateSoundingsAgainstBands(bands, [sounding]);
    expect(result.checkedCount).toBe(1);
    expect(result.violations).toEqual([]);
  });

  it("en sondering grunnere enn båndets NEDRE grense flagges som brudd, aldri stille slukt", () => {
    const inner: DybdekurveFeature = { id: "c5", dybdeM: 5, ring: closedRing(10.0, 59.0, 10.05, 59.05) };
    const outer: DybdekurveFeature = { id: "c10", dybdeM: 10, ring: closedRing(9.9, 58.9, 10.15, 59.15) };
    const { bands } = buildDepthBands([inner, outer]);
    // Bandet 5-10 m påstår "dypere enn 5 m". En sondering på 2 m som havner
    // geometrisk i DETTE bandet (i "skallet" mellom kurvene) er en
    // topologifeil — flagges, blokkerer ikke bygget.
    const badSounding: PointFeature = { id: "grunne.brudd", point: [9.95, 58.95], dybdeM: 2 };
    const result = validateSoundingsAgainstBands(bands, [badSounding]);
    expect(result.checkedCount).toBe(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      featureId: "grunne.brudd",
      soundedDepthM: 2,
      bandLowerBoundM: 5,
      bandUpperBoundM: 10,
    });
  });

  it("soundinger uten dybdeattributt telles ikke og gir aldri brudd", () => {
    const curve: DybdekurveFeature = { id: "c5", dybdeM: 5, ring: closedRing(10.0, 59.0, 10.2, 59.2) };
    const { bands } = buildDepthBands([curve]);
    const unknown: PointFeature = { id: "grunne.ukjent", point: [10.1, 59.1] };
    const result = validateSoundingsAgainstBands(bands, [unknown]);
    expect(result.checkedCount).toBe(0);
    expect(result.violations).toEqual([]);
  });
});

describe("datakvalitet (CATZOC)", () => {
  it("bygger soner kun for features med catzoc-attributt", () => {
    const withQuality: PolygonFeature = {
      id: "dq1",
      rings: [closedRing(10, 59, 10.1, 59.1)],
      catzoc: "A1",
    };
    const withoutQuality: PolygonFeature = { id: "dq2", rings: [closedRing(11, 60, 11.1, 60.1)] };
    const zones = buildDataQualityZones([withQuality, withoutQuality]);
    expect(zones).toHaveLength(1);
    expect(zones[0]?.catzoc).toBe("A1");
  });
});

describe("§3.1 fliseinndeling: bygger og klipper til 0,5°x0,25°-rutenettet", () => {
  it("et polygon som krysser en flisgrense splittes i to fliser", () => {
    const curve: DybdekurveFeature = { id: "c5", dybdeM: 5, ring: closedRing(10.6, 59.1, 10.8, 59.4) };
    const { bands } = buildDepthBands([curve]);
    const grid = { lonStepDeg: 0.5, latStepDeg: 0.25 };
    const tiles = buildTilePayloads(bands, [], [], [], [], grid);

    // Rektangelet 59.1-59.4 krysser flisgrensen ved 59.25 -> to fliser.
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    for (const tile of tiles) {
      expect(tile.bands.length).toBeGreaterThan(0);
    }
  });

  it("R2-regresjon (code-review 2026-08-31): smal polygon over tre fliser uten hjørne i midtflisen tas likevel med", () => {
    // Rektangel fra lon 10,6 til 11,6 (lat 59,05-59,10, innenfor én breddeflis).
    // De eneste to distinkte lengdegradene blant ring-hjørnene er 10,6 og
    // 11,6 — med 0,5°-flisbredde gir det TRE fliser i lengderetning
    // (lonIndex 21: 10,5-11,0 | 22: 11,0-11,5 | 23: 11,5-12,0), og den
    // midterste (22) har INGEN ring-hjørne i seg selv, kun rent
    // gjennomgangsareal. Den gamle hjørne-baserte `touchedTiles`
    // (før R2-fiksen) mistet denne flisen stille — ingen feilmelding, bare
    // et hull i dekningen for ruteren.
    const curve: DybdekurveFeature = { id: "c5", dybdeM: 5, ring: closedRing(10.6, 59.05, 11.6, 59.1) };
    const { bands } = buildDepthBands([curve]);
    const grid = { lonStepDeg: 0.5, latStepDeg: 0.25 };
    const tiles = buildTilePayloads(bands, [], [], [], [], grid);

    const westTile = tiles.find((t) => t.id.lonIndex === 21 && t.id.latIndex === 236);
    const middleTile = tiles.find((t) => t.id.lonIndex === 22 && t.id.latIndex === 236);
    const eastTile = tiles.find((t) => t.id.lonIndex === 23 && t.id.latIndex === 236);

    expect(westTile).toBeDefined();
    expect(eastTile).toBeDefined();
    expect(middleTile).toBeDefined();
    expect(middleTile?.bands.length ?? 0).toBeGreaterThan(0);
  });
});
