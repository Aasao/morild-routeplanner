/**
 * Kystmasken for strøm (`docs/specs/strom-produsent.md` §3 invariant 6,
 * §4b, D15.2): hjørneregelen i `decodeCoastalMaskAt`, `currentCoastal` på
 * `toWeatherField` (false uten maske) og OR i `compositeWeatherField`.
 * Geometrien er valgt med eksakte binære steg (0,5°), så «på en node» er
 * eksakt og ikke flyttallsstøy.
 */
import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import { buildLayer, serializeLayer, type LayerGeometry } from "./package-format.js";
import { buildLayerLookup, coastalMaskFromBytes, decodeCoastalMaskAt } from "./field.js";
import { compositeWeatherField, toWeatherField, type WeatherPackage } from "./weather-field-adapter.js";

const HEADER: PackageHeader = Object.freeze({
  formatVersion: "1.1.0",
  producedAt: "2026-09-27T00:00:00Z",
  model: "TEST",
  init: "2026-09-27T00:00:00Z",
  resolution: "test",
  sourceStatus: { status: "ok" as const },
});

function geom(latMin: number, lonMin: number, timeSteps: number): LayerGeometry {
  return { latMin, lonMin, latStepDeg: 0.5, lonStepDeg: 0.5, nodesLat: 3, nodesLon: 3, tileNodes: 32, t0S: 0, dtS: 3600, timeSteps };
}

/** 3×3-maske der bare midtnoden (1,1) er merket. */
function centreMask(latMin = 58, lonMin = 10) {
  const g = geom(latMin, lonMin, 1);
  const layer = buildLayer({
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
    sample: (lat, lon) => (lat === latMin + 0.5 && lon === lonMin + 0.5 ? 1 : 0),
  });
  return coastalMaskFromBytes(serializeLayer(layer, { deltaCoded: true }));
}

function pkg(latMin: number, lonMin: number, withMask: boolean): WeatherPackage {
  const g = geom(latMin, lonMin, 2);
  const layer = (value: number) =>
    buildLayerLookup(buildLayer({ geometryBase: g, bitsPerSample: 8, roundingMode: "nearest", channelKind: "linear", sample: () => value }));
  const current = { u: layer(0.5), v: layer(-0.2) };
  return {
    windMembers: [{ u: layer(5), v: layer(3) }],
    windHeader: HEADER,
    current,
    ...(withMask ? { currentCoastal: centreMask(latMin, lonMin) } : {}),
  };
}

describe("decodeCoastalMaskAt — hjørneregelen", () => {
  const mask = centreMask();

  it("på en node: nodens egen bit (null vekt på naboene)", () => {
    expect(decodeCoastalMaskAt(mask, 58.5, 10.5)).toBe(true);
    expect(decodeCoastalMaskAt(mask, 58, 10)).toBe(false);
    expect(decodeCoastalMaskAt(mask, 59, 11)).toBe(false);
  });

  it("i en celle med den merkede noden som hjørne: sann, uansett hvor liten vekten er", () => {
    expect(decodeCoastalMaskAt(mask, 58.25, 10.25)).toBe(true);
    expect(decodeCoastalMaskAt(mask, 58.01, 10.01)).toBe(true);
    expect(decodeCoastalMaskAt(mask, 58.99, 10.75)).toBe(true);
  });

  it("på en cellekant uten den merkede noden: usann", () => {
    // lat 58, lon 10–10,5: hjørnene (0,0),(0,1) — (1,1) har null vekt.
    expect(decodeCoastalMaskAt(mask, 58, 10.25)).toBe(false);
  });

  it("utenfor dekningen ⇒ false", () => {
    expect(decodeCoastalMaskAt(mask, 57.9, 10.5)).toBe(false);
    expect(decodeCoastalMaskAt(mask, 58.5, 11.1)).toBe(false);
  });
});

describe("currentCoastal på WeatherField", () => {
  it("toWeatherField: fra masken når den finnes, ellers alltid false", () => {
    const withMask = toWeatherField(pkg(58, 10, true), 0, { departEpochS: 0 });
    const without = toWeatherField(pkg(58, 10, false), 0, { departEpochS: 0 });
    expect(withMask.currentCoastal?.(58.25, 10.25, 0)).toBe(true);
    expect(withMask.currentCoastal?.(58, 10, 0)).toBe(false);
    expect(without.currentCoastal?.(58.25, 10.25, 0)).toBe(false);
    // Masken er statisk — tiden påvirker ikke svaret.
    expect(withMask.currentCoastal?.(58.25, 10.25, 3600)).toBe(true);
  });

  it("compositeWeatherField: OR over flisene — flisen som dekker punktet svarer", () => {
    const a = toWeatherField(pkg(58, 10, true), 0, { departEpochS: 0 });
    const b = toWeatherField(pkg(59, 10, false), 0, { departEpochS: 0 });
    const composite = compositeWeatherField([b, a]);
    expect(composite.currentCoastal?.(58.25, 10.25, 0)).toBe(true);
    expect(composite.currentCoastal?.(59.25, 10.25, 0)).toBe(false);
    expect(composite.current(58.25, 10.25, 0)).toBeDefined();
  });
});
