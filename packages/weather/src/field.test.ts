import { describe, expect, it } from "vitest";
import {
  buildLayer,
  layerMaxDecodeError,
  serializeLayer,
  type LayerGeometry,
} from "./package-format.js";
import {
  buildLayerLookup,
  decodeAllNodesAtTimestep,
  decodeCurrentAt,
  decodeLayerAt,
  decodeWavesAt,
  decodeWindAt,
  DecodeAllBudget,
  windLayerMaxDecodeErrorKn,
  windMemberLayersFromBytes,
  withDecodeAllBudget,
  type WaveLayers,
  type WindMemberLayers,
} from "./field.js";
import { windToUV } from "./wind-codec.js";

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

describe("decodeLayerAt — bilineær rom + lineær tid, kjent analytisk svar", () => {
  it("interpolerer en lineær funksjon eksakt (opp til kvantisering)", () => {
    // f(lat,lon,t) = lat + 2*lon + 0.1*t — bilineær/lineær interpolasjon av
    // en AFFIN funksjon er eksakt (ingen krumning å tape presisjon på).
    const g = geom();
    const f = (lat: number, lon: number, epochS: number): number =>
      lat + 2 * lon + 0.1 * ((epochS - T0) / 3600);
    const layer = buildLayer({
      sample: f,
      geometryBase: g,
      bitsPerSample: 10, // fint nok til at kvantiseringsstøyen er neglisjerbar
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const lookup = buildLayerLookup(layer);
    const lat = 58.34;
    const lon = 10.27;
    const epochS = T0 + 1.5 * 3600;
    const truth = f(lat, lon, epochS);
    const decoded = decodeLayerAt(lookup, lat, lon, epochS)!;
    expect(Math.abs(decoded - truth)).toBeLessThan(0.02);
  });

  it("utenfor romlig dekning gir undefined", () => {
    const g = geom();
    const layer = buildLayer({
      sample: () => 5,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const lookup = buildLayerLookup(layer);
    expect(decodeLayerAt(lookup, 40, 10.5, T0)).toBeUndefined();
    expect(decodeLayerAt(lookup, 58.5, 200, T0)).toBeUndefined();
  });

  it("utenfor tidsdekning gir undefined", () => {
    const g = geom();
    const layer = buildLayer({
      sample: () => 5,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const lookup = buildLayerLookup(layer);
    expect(decodeLayerAt(lookup, 58.5, 10.5, T0 - 3600)).toBeUndefined();
    expect(decodeLayerAt(lookup, 58.5, 10.5, T0 + 100 * 3600)).toBeUndefined();
  });

  it("én manglende nabo (sentinel) gjør hele oppslaget undefined — ekstrapolerer aldri", () => {
    const g = geom({ nodesLat: 4, nodesLon: 4, timeSteps: 1 });
    const layer = buildLayer({
      sample: (lat, lon) => (lat > 58.15 && lon > 10.15 ? undefined : 5),
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const lookup = buildLayerLookup(layer);
    // Punktet ligger midt mellom fire noder, hvorav én mangler data.
    const v = decodeLayerAt(lookup, 58.15, 10.15, T0);
    expect(v).toBeUndefined();
  });
});

describe("decodeWindAt — komponentrom, konvertering som siste steg (§3)", () => {
  it("konstant vindfelt dekoder til samme (speedKn, fromDeg) overalt", () => {
    const g = geom();
    const [u, v] = windToUV(15, 225);
    const uLayer = buildLayer({
      sample: () => u,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: () => v,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const member: WindMemberLayers = {
      u: buildLayerLookup(uLayer),
      v: buildLayerLookup(vLayer),
    };
    const w = decodeWindAt(member, 58.5, 10.5, T0 + 1800)!;
    expect(w.speedKn).toBeCloseTo(15, 1);
    expect(w.fromDeg).toBeCloseTo(225, 0);
  });

  it("windMemberLayersFromBytes gjenoppbygger et vind-medlem fra en konkatenert u+v R2-blob (§15 klientkontrakt)", () => {
    const g = geom();
    const [u, v] = windToUV(12, 300);
    const uLayer = buildLayer({
      sample: () => u,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: () => v,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const uBytes = serializeLayer(uLayer, { deltaCoded: true });
    const vBytes = serializeLayer(vLayer, { deltaCoded: true });
    const blob = new Uint8Array(uBytes.length + vBytes.length);
    blob.set(uBytes, 0);
    blob.set(vBytes, uBytes.length);

    const member = windMemberLayersFromBytes(blob);
    const w = decodeWindAt(member, 58.5, 10.5, T0)!;
    expect(w.speedKn).toBeCloseTo(12, 1);
    expect(w.fromDeg).toBeCloseTo(300, 0);
  });
});

describe("decodeCurrentAt — komponenter, aldri konvertert (§3)", () => {
  it("dekoder u/v direkte, ingen retningskonvertering", () => {
    const g = geom();
    const uLayer = buildLayer({
      sample: () => 1.5,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: () => -0.5,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const layers = { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) };
    const c = decodeCurrentAt(layers, 58.5, 10.5, T0)!;
    expect(c.u).toBeCloseTo(1.5, 1);
    expect(c.v).toBeCloseTo(-0.5, 1);
  });
});

describe("decodeWavesAt — §12 degraderingskontrakt", () => {
  function wavesLayers(opts: {
    readonly hs: number | undefined;
    readonly tp?: number;
  }): WaveLayers {
    const g = geom();
    const hsLayer = buildLayer({
      sample: () => opts.hs,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "up",
      channelKind: "linear",
    });
    const layers: { hs: ReturnType<typeof buildLayerLookup>; tp?: ReturnType<typeof buildLayerLookup> } = {
      hs: buildLayerLookup(hsLayer),
    };
    if (opts.tp !== undefined) {
      const tpLayer = buildLayer({
        sample: () => opts.tp,
        geometryBase: g,
        bitsPerSample: 8,
        roundingMode: "down",
        channelKind: "linear",
      });
      layers.tp = buildLayerLookup(tpLayer);
    }
    return layers;
  }

  it("Hs mangler helt ⇒ hele svaret er undefined (FLAG_SJOEGANG_DATA_MANGLER-veien)", () => {
    const layers = wavesLayers({ hs: undefined });
    expect(decodeWavesAt(layers, 58.5, 10.5, T0)).toBeUndefined();
  });

  it("Hs finnes, Tp mangler som lag ⇒ objekt uten tpS, ikke undefined", () => {
    const layers = wavesLayers({ hs: 1.2 });
    const w = decodeWavesAt(layers, 58.5, 10.5, T0)!;
    expect(w.hsM).toBeGreaterThanOrEqual(1.2);
    expect(w.tpS).toBeUndefined();
  });

  it("Hs og Tp finnes begge ⇒ begge felt satt", () => {
    const layers = wavesLayers({ hs: 1.2, tp: 6.5 });
    const w = decodeWavesAt(layers, 58.5, 10.5, T0)!;
    expect(w.hsM).toBeGreaterThanOrEqual(1.2);
    expect(w.tpS).toBeCloseTo(6.5, 0);
  });
});

describe("windLayerMaxDecodeErrorKn — regnet fra metadata (§9.5)", () => {
  it("er null for et konstant (scale=0) felt", () => {
    const g = geom();
    const uLayer = buildLayer({
      sample: () => 3,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: () => -4,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const member: WindMemberLayers = {
      u: buildLayerLookup(uLayer),
      v: buildLayerLookup(vLayer),
    };
    expect(windLayerMaxDecodeErrorKn(member)).toBe(0);
    expect(layerMaxDecodeError(uLayer)).toBe(0);
  });

  it("er positiv og lik hypot(uErr,vErr) for et variabelt felt", () => {
    const g = geom();
    const uLayer = buildLayer({
      sample: (lat) => 10 * Math.sin(lat),
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
    const err = windLayerMaxDecodeErrorKn(member);
    expect(err).toBeCloseTo(
      Math.hypot(layerMaxDecodeError(uLayer), layerMaxDecodeError(vLayer)),
      12,
    );
    expect(err).toBeGreaterThan(0);
  });
});

describe("decodeAllNodesAtTimestep + DecodeAllBudget — unntaksveien (§9.7, §17 pkt. 11)", () => {
  it("dekoder alle noder for ett tidssteg til en Float32Array", () => {
    const g = geom({ nodesLat: 4, nodesLon: 4, timeSteps: 1 });
    const layer = buildLayer({
      sample: (lat, lon) => lat + lon,
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const arr = decodeAllNodesAtTimestep(layer, 0);
    expect(arr.length).toBe(16);
    expect(arr[0]).toBeCloseTo(58 + 10, 1);
  });

  it("kaster når man ber om én kopi for mye samtidig", () => {
    const budget = new DecodeAllBudget(2);
    budget.acquire();
    budget.acquire();
    expect(() => budget.acquire()).toThrow();
    budget.release();
    expect(budget.outstandingCount).toBe(1);
    budget.acquire();
    expect(budget.outstandingCount).toBe(2);
  });

  it("withDecodeAllBudget frigir selv om bruken kaster", () => {
    const g = geom({ nodesLat: 2, nodesLon: 2, timeSteps: 1 });
    const layer = buildLayer({
      sample: () => 1,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const budget = new DecodeAllBudget(1);
    expect(() =>
      withDecodeAllBudget(budget, layer, 0, () => {
        throw new Error("simulert feil under bruk");
      }),
    ).toThrow("simulert feil under bruk");
    expect(budget.outstandingCount).toBe(0);
  });

  it("property: aldri flere enn taket, uansett stress-rekkefølge (§17 pkt. 11)", () => {
    const budget = new DecodeAllBudget(4);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 48271) % 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let peak = 0;
    for (let i = 0; i < 2000; i++) {
      if (budget.outstandingCount < 4 && rnd() < 0.6) {
        budget.acquire();
        peak = Math.max(peak, budget.outstandingCount);
      } else if (budget.outstandingCount > 0) {
        budget.release();
      }
      expect(budget.outstandingCount).toBeLessThanOrEqual(4);
    }
    expect(peak).toBeLessThanOrEqual(4);
  });
});
