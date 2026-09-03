/**
 * `toWeatherField`s `isControl`-overstyring (fase 3 bølge 2C,
 * `docs/specs/vaerpakker.md` §9.1 pkt. 4 / ADR-0005). Se
 * `weather-field-adapter.ts::ToWeatherFieldOptions.isControl`s
 * toppkommentar for hvorfor dette trengs: en progressiv worker-pool
 * dekoder ETT medlem per kall og bygger da en ett-elements
 * `windMembers`-array PER kall — uten overstyringen ville ethvert medlem
 * blitt tolket som kontrollen fordi det alltid står på indeks 0 i sin egen
 * array.
 */
import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import { buildLayer, type LayerGeometry } from "./package-format.js";
import { buildLayerLookup } from "./field.js";
import {
  MEMBER_HORIZON_S,
  toWeatherField,
  type WeatherPackage,
} from "./weather-field-adapter.js";

const HEADER: PackageHeader = Object.freeze({
  formatVersion: "1.0.0",
  producedAt: "2026-09-03T00:00:00Z",
  model: "TEST",
  init: "2026-09-03T00:00:00Z",
  resolution: "test",
  sourceStatus: { status: "ok" as const },
});

function geometry(overrides: Partial<LayerGeometry> = {}): LayerGeometry {
  return {
    latMin: 58,
    lonMin: 10,
    latStepDeg: 0.1,
    lonStepDeg: 0.1,
    nodesLat: 4,
    nodesLon: 4,
    tileNodes: 32,
    t0S: 0,
    dtS: 3600,
    timeSteps: 73, // t = 0..72 t
    ...overrides,
  };
}

function buildUV(g: LayerGeometry) {
  const u = buildLayer({
    sample: () => 5,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const v = buildLayer({
    sample: () => 0,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  return { u: buildLayerLookup(u), v: buildLayerLookup(v) };
}

describe("toWeatherField — isControl-overstyring", () => {
  it("uten overstyring: memberIndex 0 får full horisont (uendret standardoppførsel)", () => {
    const g = geometry();
    const pkg: WeatherPackage = { windMembers: [buildUV(g)], windHeader: HEADER };
    const field = toWeatherField(pkg, 0, { departEpochS: 0 });
    expect(field.validToS).toBe(72 * 3600);
  });

  it("isControl:false trunkerer til 48 t-medlemsgrensen SELV på indeks 0 (ett-elements worker-pakke)", () => {
    const g = geometry();
    const pkg: WeatherPackage = { windMembers: [buildUV(g)], windHeader: HEADER };
    const field = toWeatherField(pkg, 0, { departEpochS: 0, isControl: false });
    expect(field.validToS).toBe(MEMBER_HORIZON_S);
    expect(field.validToS).toBeLessThan(72 * 3600);
  });

  it("isControl:true gir full horisont selv om memberIndex ikke er 0 (symmetri-sjekk)", () => {
    const g = geometry();
    const pkg: WeatherPackage = {
      windMembers: [buildUV(g), buildUV(g)],
      windHeader: HEADER,
    };
    const field = toWeatherField(pkg, 1, { departEpochS: 0, isControl: true });
    expect(field.validToS).toBe(72 * 3600);
  });
});
