import { describe, expect, it } from "vitest";
import {
  buildLayer,
  computeSubtileByteRanges,
  computeSubtileLayout,
  decodeLayerNode,
  deltaDecodeLayerPayload,
  deltaEncodeLayerPayload,
  deserializeLayer,
  detectQuantizationClip,
  layerByteLayout,
  layerMaxDecodeError,
  readLayerFrame,
  readLayerFrames,
  readLayerSubtile,
  sampleIndex,
  serializeLayer,
  subtileIndexOfNode,
  WEATHER_LAYER_MAGIC,
  type ClippedSample,
  type Layer,
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

describe("layerByteLayout — delt bytelengde-formel (review-funn fase 3 bølge 2: tidligere duplisert i serializeLayer og readLayerFrame)", () => {
  const forms: ReadonlyArray<{
    readonly name: string;
    readonly g: LayerGeometry;
    readonly bitsPerSample: 8 | 10;
    readonly channelKind: "linear" | "angle";
    readonly deltaCoded?: boolean;
  }> = [
    { name: "8-bit, én subflis, lineær", g: testGeometry({ nodesLat: 6, nodesLon: 6, timeSteps: 2, tileNodes: 32 }), bitsPerSample: 8, channelKind: "linear" },
    { name: "8-bit, flere subfliser, lineær", g: testGeometry(), bitsPerSample: 8, channelKind: "linear" },
    { name: "8-bit, delta-kodet", g: testGeometry({ nodesLat: 40, nodesLon: 17, timeSteps: 6, tileNodes: 32 }), bitsPerSample: 8, channelKind: "linear", deltaCoded: true },
    { name: "10-bit (u16-lagring), lineær", g: testGeometry({ nodesLat: 10, nodesLon: 10, timeSteps: 2 }), bitsPerSample: 10, channelKind: "linear" },
    { name: "8-bit, vinkelkanal", g: testGeometry({ nodesLat: 8, nodesLon: 8, timeSteps: 1 }), bitsPerSample: 8, channelKind: "angle" },
  ];

  for (const form of forms) {
    it(`${form.name}: serializeLayer sin faktiske lengde, layerByteLayout og readLayerFrame sin lengde er alle konsistente`, () => {
      const layer: Layer = buildLayer({
        sample: smoothSource,
        geometryBase: form.g,
        bitsPerSample: form.bitsPerSample,
        roundingMode: "nearest",
        channelKind: form.channelKind,
      });
      const bytes = serializeLayer(layer, { deltaCoded: form.deltaCoded ?? false });
      const layout = computeSubtileLayout(form.g);
      const predicted = layerByteLayout(layout, form.g.timeSteps, form.bitsPerSample);

      // Formelen forutsier EKSAKT den bytelengden serializeLayer faktisk skrev.
      expect(bytes.length).toBe(predicted.totalBytes);

      // readLayerFrame (peekLayerHeader-veien) er enig, selv med søppel etterpå.
      const padded = new Uint8Array(bytes.length + 7);
      padded.set(bytes, 0);
      padded.fill(0xaa, bytes.length);
      const frame = readLayerFrame(padded, 0);
      expect(frame.byteLength).toBe(predicted.totalBytes);

      // Og roundturen er fortsatt bit-eksakt for et par prøvepunkter.
      expect(decodeLayerNode(frame.layer, layout, 0, 0, 0)).toBe(
        decodeLayerNode(layer, layout, 0, 0, 0),
      );
    });
  }
});

describe("readLayerFrame/readLayerFrames — flerlags-rammededeling (klientgap, fase 3 bølge 2C)", () => {
  it("readLayerFrame gjenkjenner nøyaktig byte-lengden til ETT lag, uansett trailing søppel etterpå", () => {
    const g = testGeometry({ nodesLat: 6, nodesLon: 6, timeSteps: 2 });
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const bytes = serializeLayer(layer);
    const padded = new Uint8Array(bytes.length + 5);
    padded.set(bytes, 0);
    padded.fill(0xff, bytes.length);

    const frame = readLayerFrame(padded, 0);
    expect(frame.byteLength).toBe(bytes.length);
    const layout = computeSubtileLayout(g);
    expect(decodeLayerNode(frame.layer, layout, 2, 3, 1)).toBe(
      decodeLayerNode(layer, layout, 2, 3, 1),
    );
  });

  it("readLayerFrames deler en konkatenert u+v-payload (vind-medlemmets faktiske R2-byte-layout) tilbake til to lag", () => {
    const g = testGeometry({ nodesLat: 5, nodesLon: 7, timeSteps: 3 });
    const uLayer = buildLayer({
      sample: (lat, lon, t) => smoothSource(lat, lon, t),
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: (lat, lon, t) => -smoothSource(lat, lon, t),
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const uBytes = serializeLayer(uLayer, { deltaCoded: true });
    const vBytes = serializeLayer(vLayer, { deltaCoded: true });
    const concatenated = new Uint8Array(uBytes.length + vBytes.length);
    concatenated.set(uBytes, 0);
    concatenated.set(vBytes, uBytes.length);

    const [backU, backV] = readLayerFrames(concatenated, 2);
    expect(backU).toBeDefined();
    expect(backV).toBeDefined();
    const layout = computeSubtileLayout(g);
    for (let i = 0; i < g.nodesLat; i++) {
      for (let j = 0; j < g.nodesLon; j++) {
        for (let k = 0; k < g.timeSteps; k++) {
          expect(decodeLayerNode(backU!, layout, i, j, k)).toBe(
            decodeLayerNode(uLayer, layout, i, j, k),
          );
          expect(decodeLayerNode(backV!, layout, i, j, k)).toBe(
            decodeLayerNode(vLayer, layout, i, j, k),
          );
        }
      }
    }
  });

  it("kastet på ukjent magic ved offset > 0 (korrupt/feil-adressert fortsettelse)", () => {
    const bogus = new Uint8Array(80);
    expect(() => readLayerFrame(bogus, 4)).toThrow();
  });
});

describe("D7.4 — klippe-assert (BuildLayerOptions.onClip)", () => {
  it("kalles ALDRI for et normalt, deterministisk kildefelt (regresjon)", () => {
    const g = testGeometry({ nodesLat: 40, nodesLon: 40, timeSteps: 2 });
    const clips: ClippedSample[] = [];
    buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
      onClip: (c) => clips.push(c),
    });
    expect(clips).toEqual([]);
  });

  it("detectQuantizationClip: fanger et avvik større enn ett kvantiseringstrinn (direkte test av deteksjonsformelen — buildLayers to-pass-struktur gjør den strukturelt umulig å trigge via den offentlige API-en, se onClip-dokumentasjonen)", () => {
    // Innenfor budsjett — ingen klipping.
    expect(detectQuantizationClip("linear", 10, 10.05, 0.1)).toBeUndefined();
    // Utenfor [lo,hi] (dekodet klippet til kanten, langt fra kilden) — klipping.
    const clip = detectQuantizationClip("linear", 500, 254 * 0.1, 0.1);
    expect(clip).toBeDefined();
    expect(clip!.errorAbs).toBeGreaterThan(0.1);
    // Vinkelkanal — aldri klipping (alltid representerbar modulo 360).
    expect(detectQuantizationClip("angle", 725, 5, 1)).toBeUndefined();
    // Sentinel (verdi/dekodet mangler) — ikke en klipping.
    expect(detectQuantizationClip("linear", undefined, undefined, 0.1)).toBeUndefined();
    expect(detectQuantizationClip("linear", 10, undefined, 0.1)).toBeUndefined();
  });

  it("kalles aldri for vinkelkanaler (alltid representerbare modulo 360)", () => {
    const g = testGeometry({ nodesLat: 8, nodesLon: 8, timeSteps: 1, tileNodes: 32 });
    const clips: ClippedSample[] = [];
    buildLayer({
      sample: () => 725, // langt utenfor [0,360), men gyldig modulo
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "angle",
      onClip: (c) => clips.push(c),
    });
    expect(clips).toEqual([]);
  });
});

describe("D7.5 — subflis-adresserbar lesing (computeSubtileByteRanges / readLayerSubtile)", () => {
  it("byte-vinduene til ulike subfliser er ikke-overlappende og dekker nøyaktig index-/nyttelast-seksjonene", () => {
    const g = testGeometry(); // 3×2 subfliser
    const ranges = computeSubtileByteRanges(g, 8);
    const layout = computeSubtileLayout(g);
    const { indexBytes, totalBytes } = layerByteLayout(layout, g.timeSteps, 8);
    const HEADER_BYTES = totalBytes - indexBytes - layout.totalSamples; // 8-bit ⇒ 1 byte/prøve

    const indexWindows: Array<[number, number]> = [];
    const payloadWindows: Array<[number, number]> = [];
    for (let sr = 0; sr < ranges.length; sr++) {
      for (let sc = 0; sc < ranges[sr]!.length; sc++) {
        const r = ranges[sr]![sc]!;
        indexWindows.push([r.indexByteOffset, r.indexByteOffset + r.indexByteLength]);
        payloadWindows.push([r.payloadByteOffset, r.payloadByteOffset + r.payloadByteLength]);
        expect(r.indexByteOffset).toBeGreaterThanOrEqual(HEADER_BYTES);
        expect(r.payloadByteOffset).toBeGreaterThanOrEqual(HEADER_BYTES + indexBytes);
      }
    }
    // Sortert etter offset, ingen overlapp, sammenhengende (subflis-major layout).
    for (const windows of [indexWindows, payloadWindows]) {
      windows.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]![0]).toBe(windows[i - 1]![1]); // sammenhengende, ingen hull/overlapp
      }
    }
    expect(payloadWindows[payloadWindows.length - 1]![1]).toBe(totalBytes);
  });

  it("bit-eksakt rundtur: readLayerSubtile matcher deserializeLayer på nøyaktig samme noder", () => {
    const g = testGeometry(); // 70×40, 3×2 subfliser, siste rad 6 noder
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const bytes = serializeLayer(layer, { deltaCoded: false });
    const fullLayout = computeSubtileLayout(g);

    for (let sr = 0; sr < fullLayout.subtileRows; sr++) {
      for (let sc = 0; sc < fullLayout.subtileCols; sc++) {
        const sub = readLayerSubtile(bytes, 0, sr, sc);
        const subLayout = computeSubtileLayout(sub.geometry);
        const bounds = fullLayout.bounds[sr]![sc]!;
        for (let a = 0; a < bounds.rowCount; a++) {
          for (let c = 0; c < bounds.colCount; c++) {
            for (let k = 0; k < g.timeSteps; k++) {
              const fromFull = decodeLayerNode(layer, fullLayout, bounds.rowStart + a, bounds.colStart + c, k);
              const fromSub = decodeLayerNode(sub, subLayout, a, c, k);
              expect(fromSub).toBe(fromFull);
            }
          }
        }
      }
    }
  });

  it("nekter å adressere en subflis i et delta-kodet lag (§8 krever hele tidsserien per node)", () => {
    const g = testGeometry({ nodesLat: 8, nodesLon: 8, timeSteps: 3, tileNodes: 32 });
    const layer = buildLayer({
      sample: smoothSource,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const bytes = serializeLayer(layer, { deltaCoded: true });
    expect(() => readLayerSubtile(bytes, 0, 0, 0)).toThrow();
  });
});
