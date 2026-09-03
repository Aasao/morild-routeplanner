import { describe, expect, it } from "vitest";
import {
  buildLayer,
  computeSubtileLayout,
  decodeLayerNode,
  deltaDecodeLayerPayload,
  deltaEncodeLayerPayload,
  deserializeLayer,
  layerMaxDecodeError,
  sampleIndex,
  serializeLayer,
  subtileIndexOfNode,
  WEATHER_LAYER_MAGIC,
  type LayerGeometry,
} from "./package-format.js";

function testGeometry(overrides: Partial<LayerGeometry> = {}): LayerGeometry {
  return {
    latMin: 58,
    lonMin: 10,
    latStepDeg: 0.05,
    lonStepDeg: 0.08,
    nodesLat: 70, // > 2×32 ⇒ tvinger flere subfliser, inkl. mindre siste rad
    nodesLon: 40,
    tileNodes: 32,
    t0S: 1_781_668_800,
    dtS: 3600,
    timeSteps: 4,
    ...overrides,
  };
}

/** Glatt syntetisk kilde: sinusledd, alltid definert innenfor domenet. */
function smoothSource(lat: number, lon: number, epochS: number): number {
  const t = (epochS - 1_781_668_800) / 3600;
  return 10 + 3 * Math.sin(lat * 1.3 + t / 5) + 2 * Math.cos(lon * 0.9);
}

describe("subflis-layout — dekker hele laget, siste rad/kolonne kan være mindre", () => {
  it("summerer opp til nøyaktig nodesLat×nodesLon×timeSteps prøver", () => {
    const g = testGeometry();
    const layout = computeSubtileLayout(g);
    expect(layout.subtileRows).toBe(3); // ceil(70/32)
    expect(layout.subtileCols).toBe(2); // ceil(40/32)
    expect(layout.totalSamples).toBe(g.nodesLat * g.nodesLon * g.timeSteps);
    // Siste rad er mindre: 70 - 2*32 = 6 noder, ikke 32.
    expect(layout.bounds[2]![0]!.rowCount).toBe(6);
  });

  it("sampleIndex er en bijeksjon over (i,j,k) — ingen kollisjoner, ingen hull", () => {
    const g = testGeometry({ nodesLat: 40, nodesLon: 40, timeSteps: 2, tileNodes: 32 });
    const layout = computeSubtileLayout(g);
    const seen = new Set<number>();
    for (let i = 0; i < g.nodesLat; i++) {
      for (let j = 0; j < g.nodesLon; j++) {
        for (let k = 0; k < g.timeSteps; k++) {
          const idx = sampleIndex(g, layout, i, j, k);
          expect(seen.has(idx)).toBe(false);
          seen.add(idx);
        }
      }
    }
    expect(seen.size).toBe(layout.totalSamples);
  });

  it("subtileIndexOfNode plasserer randnoder i siste subflis, ikke utenfor", () => {
    const g = testGeometry();
    expect(subtileIndexOfNode(g, 69, 39)).toEqual({ sr: 2, sc: 1 });
    expect(subtileIndexOfNode(g, 0, 0)).toEqual({ sr: 0, sc: 0 });
  });
});

describe("buildLayer + dekoding — nearest", () => {
  it("dekodet node ligger innenfor et halvt kvantiseringstrinn av kilden", () => {
    const g = testGeometry();
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const layout = computeSubtileLayout(g);
    for (let i = 0; i < g.nodesLat; i += 7) {
      for (let j = 0; j < g.nodesLon; j += 5) {
        for (let k = 0; k < g.timeSteps; k++) {
          const lat = g.latMin + i * g.latStepDeg;
          const lon = g.lonMin + j * g.lonStepDeg;
          const epochS = g.t0S + k * g.dtS;
          const truth = smoothSource(lat, lon, epochS);
          const decoded = decodeLayerNode(layer, layout, i, j, k)!;
          const params = layer.subtileParams[subtileIndexOfNode(g, i, j).sr]![
            subtileIndexOfNode(g, i, j).sc
          ]![k]!;
          expect(Math.abs(decoded - truth)).toBeLessThanOrEqual(params.scale / 2 + 1e-9);
        }
      }
    }
  });

  it("konstant kildefelt gir scale=0 og eksakt, feilfri dekoding", () => {
    const g = testGeometry({ nodesLat: 8, nodesLon: 8, timeSteps: 1 });
    const layer = buildLayer({
      sample: () => 4.2,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const layout = computeSubtileLayout(g);
    expect(layerMaxDecodeError(layer)).toBe(0);
    for (let i = 0; i < g.nodesLat; i++) {
      for (let j = 0; j < g.nodesLon; j++) {
        expect(decodeLayerNode(layer, layout, i, j, 0)).toBe(4.2);
      }
    }
  });

  it("manglende kildeverdi (undefined) dekoder til undefined (sentinel, §9.6)", () => {
    const g = testGeometry({ nodesLat: 8, nodesLon: 8, timeSteps: 1 });
    const layer = buildLayer({
      sample: (lat, lon) => (lon > 10.2 ? undefined : 5),
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const layout = computeSubtileLayout(g);
    expect(decodeLayerNode(layer, layout, 0, 0, 0)).toBe(5);
    expect(decodeLayerNode(layer, layout, 0, 7, 0)).toBeUndefined();
  });
});

describe("serialisering — bit-eksakt rundtur (§17)", () => {
  it("deserializeLayer(serializeLayer(x)) reproduserer alle dekodede verdier eksakt", () => {
    const g = testGeometry();
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const bytes = serializeLayer(layer);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe(
      WEATHER_LAYER_MAGIC,
    );
    const back = deserializeLayer(bytes);
    const layout = computeSubtileLayout(g);
    for (let i = 0; i < g.nodesLat; i += 11) {
      for (let j = 0; j < g.nodesLon; j += 9) {
        for (let k = 0; k < g.timeSteps; k++) {
          expect(decodeLayerNode(back, layout, i, j, k)).toBe(
            decodeLayerNode(layer, layout, i, j, k),
          );
        }
      }
    }
    expect(layerMaxDecodeError(back)).toBe(layerMaxDecodeError(layer));
  });

  it("10-bit lag rundtur er også bit-eksakt (u16-lagring, dokumentert forenkling)", () => {
    const g = testGeometry({ nodesLat: 10, nodesLon: 10, timeSteps: 2 });
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const back = deserializeLayer(serializeLayer(layer));
    const layout = computeSubtileLayout(g);
    for (let i = 0; i < g.nodesLat; i++) {
      for (let j = 0; j < g.nodesLon; j++) {
        for (let k = 0; k < g.timeSteps; k++) {
          expect(decodeLayerNode(back, layout, i, j, k)).toBe(
            decodeLayerNode(layer, layout, i, j, k),
          );
        }
      }
    }
  });

  it("vinkellag (bølgeretning) rundtur, inkl. sentinel for manglende retning", () => {
    const g = testGeometry({ nodesLat: 8, nodesLon: 8, timeSteps: 1 });
    const layer = buildLayer({
      sample: (lat, lon) => (lon > 10.2 ? undefined : (lat * 40) % 360),
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "angle",
    });
    const back = deserializeLayer(serializeLayer(layer));
    const layout = computeSubtileLayout(g);
    expect(decodeLayerNode(back, layout, 0, 7, 0)).toBeUndefined();
    expect(decodeLayerNode(back, layout, 0, 0, 0)).toBe(
      decodeLayerNode(layer, layout, 0, 0, 0),
    );
  });

  it("kastet på ukjent magic — beskytter mot å lese en fremmed/korrupt buffer", () => {
    const bogus = new Uint8Array(64);
    expect(() => deserializeLayer(bogus)).toThrow();
  });
});

describe("layerMaxDecodeError — regnes fra metadata alene (§9.5 punkt 1)", () => {
  it("er størst der subflisens spenn er størst", () => {
    // FUNN (drive-by, oppdaget under full `pnpm test`-kjøring i
    // værpakke-bølge 1D, 2026-09-03): `nodesLat: 40` med `tileNodes: 32`
    // gir TO subflis-RADER (`ceil(40/32)=2`), altså FIRE subfliser totalt
    // ((0,0),(0,1),(1,0),(1,1)) — ikke to, slik kommentaren under antok.
    // Både (0,1) OG (1,1) fikk da HVER SIN uavhengige `Math.random()`-
    // spredning, og testen leste kun (0,1) som "wide" — flaket i ca. 1 av 3
    // kjøringer når (1,1) tilfeldigvis fikk et STØRRE spenn enn (0,1), og
    // `layerMaxDecodeError` (som skanner ALLE subfliser) da traff (1,1)s
    // skala i stedet for (0,1)s. Rettet ved å holde géometrien til ÉN
    // subflis-rad (`nodesLat: 32`), slik at (0,1) er den eneste subflisen
    // med spredning — ingen tvetydighet, ingen flakethet igjen.
    const g = testGeometry({ nodesLat: 32, nodesLon: 40, timeSteps: 1, tileNodes: 32 });
    // To subfliser: (0,0) har smalt spenn, (0,1) har bredt spenn.
    const layer = buildLayer({
      sample: (_lat, lon) => (lon < g.lonMin + 32 * g.lonStepDeg ? 10 : 10 + 20 * Math.random()),
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const layout = computeSubtileLayout(g);
    const narrow = layer.subtileParams[0]![0]![0]!.scale;
    const wide = layer.subtileParams[0]![1]![0]!.scale;
    expect(wide).toBeGreaterThan(narrow);
    expect(layerMaxDecodeError(layer)).toBeCloseTo(0.5 * wide, 9);
    void layout;
  });
});

describe("delta-koding koblet inn i subflis-lagringen (§8, §19 — tidligere levert testet, ukoblet)", () => {
  it("deltaDecodeLayerPayload(deltaEncodeLayerPayload(x)) er bit-eksakt for hele payloadet, node for node over tid", () => {
    const g = testGeometry({ nodesLat: 40, nodesLon: 17, timeSteps: 6, tileNodes: 32 });
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const deltaCoded = deltaEncodeLayerPayload(layer);
    // Deltakodingen skal faktisk endre byte for et glatt, tidskorrelert felt
    // (ellers tester vi ingenting) — men la geometri/subflis-parametre stå.
    expect(Array.from(deltaCoded.payload as Uint8Array)).not.toEqual(
      Array.from(layer.payload as Uint8Array),
    );
    expect(deltaCoded.geometry).toEqual(layer.geometry);
    expect(deltaCoded.subtileParams).toEqual(layer.subtileParams);

    const back = deltaDecodeLayerPayload(deltaCoded);
    expect(Array.from(back.payload as Uint8Array)).toEqual(Array.from(layer.payload as Uint8Array));
  });

  it("kaster for 10-bit lag — ingen delta-transform for u16-payloadet ennå (dokumentert avgrensning)", () => {
    const g = testGeometry({ nodesLat: 8, nodesLon: 8, timeSteps: 2 });
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    expect(() => deltaEncodeLayerPayload(layer)).toThrow(/8-bit/);
    expect(() => serializeLayer(layer, { deltaCoded: true })).toThrow(/8-bit/);
  });

  it("serializeLayer({deltaCoded:true}) → deserializeLayer gir eksakt samme dekodede verdier som uten delta (§17)", () => {
    const g = testGeometry({ nodesLat: 40, nodesLon: 40, timeSteps: 5, tileNodes: 32 });
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const plainBytes = serializeLayer(layer);
    const deltaBytes = serializeLayer(layer, { deltaCoded: true });
    const layout = computeSubtileLayout(g);
    const backPlain = deserializeLayer(plainBytes);
    const backDelta = deserializeLayer(deltaBytes);
    for (let i = 0; i < g.nodesLat; i += 9) {
      for (let j = 0; j < g.nodesLon; j += 7) {
        for (let k = 0; k < g.timeSteps; k++) {
          expect(decodeLayerNode(backDelta, layout, i, j, k)).toBe(
            decodeLayerNode(backPlain, layout, i, j, k),
          );
        }
      }
    }
    // Selve payloaden på disk er ikke identisk (delta-kodet vs. ikke), men
    // den dekodede `Layer`s payload ER identisk med kilden — deltaCoded er
    // usynlig for enhver forbruker av `Layer` (§8: transportlags-transform).
    expect(Array.from(backDelta.payload as Uint8Array)).toEqual(
      Array.from(layer.payload as Uint8Array),
    );
  });
});
