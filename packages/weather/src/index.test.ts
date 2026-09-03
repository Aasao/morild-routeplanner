import { describe, expect, it } from "vitest";
import { WEATHER_PACKAGE_PLACEHOLDER, computeMaxDecodeErrorKn } from "./index.js";
import {
  buildLayerLookup,
  windLayerMaxDecodeErrorKn,
  type WindMemberLayers,
} from "./field.js";
import { buildLayer, layerMaxDecodeError, type LayerGeometry } from "./package-format.js";

describe("packages/weather (fase 0-skjelett)", () => {
  it("eksporterer placeholderen inntil fase 3 fyller pakken", () => {
    expect(WEATHER_PACKAGE_PLACEHOLDER).toBe("weather");
  });
});

// --- review-funn 3: aliaset og field.ts-varianten må gi identisk resultat --

describe("computeMaxDecodeErrorKn (alias) == windLayerMaxDecodeErrorKn (field.ts), samme hypot-utledning", () => {
  const T0 = 1_781_668_800;

  function geom(overrides: Partial<LayerGeometry> = {}): LayerGeometry {
    return {
      latMin: 58,
      lonMin: 10,
      latStepDeg: 0.1,
      lonStepDeg: 0.1,
      nodesLat: 20,
      nodesLon: 20,
      tileNodes: 32,
      t0S: T0,
      dtS: 3600,
      timeSteps: 5,
      ...overrides,
    };
  }

  it.each([
    { label: "like skalaer", uSample: (lat: number) => 10 * Math.sin(lat) },
    { label: "ulike skalaer", uSample: (lat: number) => 30 * Math.sin(lat) },
  ])("$label: aliaset gir nøyaktig samme feilskranke som field.ts, gitt lagenes faktiske skala", ({ uSample }) => {
    const g = geom();
    const uLayer = buildLayer({
      sample: uSample,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: (lat, lon) => 5 * Math.cos(lon) + lat,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const member: WindMemberLayers = {
      u: buildLayerLookup(uLayer),
      v: buildLayerLookup(vLayer),
    };

    // Aliaset kjenner kun ÉN skalaverdi per kanal (ikke laget), og bruker
    // fast `oneSided = 0.5` (nearest — vind bruker aldri opp/ned, §9.5).
    // `layerMaxDecodeError` returnerer allerede `oneSided * scale` (maks
    // over alle subfliser/tidssteg) — regn tilbake til "skala" slik aliaset
    // ville blitt kalt med, for en ren likhetstest mot field.ts-varianten.
    const uScale = layerMaxDecodeError(uLayer) / 0.5;
    const vScale = layerMaxDecodeError(vLayer) / 0.5;

    expect(computeMaxDecodeErrorKn(uScale, vScale)).toBeCloseTo(
      windLayerMaxDecodeErrorKn(member),
      12,
    );
  });
});
