/**
 * Retningskonvensjon- og interpolasjonstester — `docs/specs/vaerpakker.md`
 * §3s testliste, punkt 1–5, og §17 pkt. 1–2. Kjente verdier, ikke bare
 * egenskapstester alene (§17 pkt. 1).
 */
import { describe, expect, it } from "vitest";
import {
  buildLayer,
  computeSubtileLayout,
  decodeLayerNode,
  type LayerGeometry,
} from "./package-format.js";
import { buildLayerLookup, decodeCurrentAt, decodeLayerAt, decodeWindAt } from "./field.js";
import { uvToWind, windToUV } from "./wind-codec.js";

const T0 = 0;

function geom(overrides: Partial<LayerGeometry> = {}): LayerGeometry {
  return {
    latMin: 58,
    lonMin: 10,
    latStepDeg: 0.1,
    lonStepDeg: 0.1,
    nodesLat: 4,
    nodesLon: 4,
    tileNodes: 32,
    t0S: T0,
    dtS: 3600,
    timeSteps: 2,
    ...overrides,
  };
}

describe("§3 punkt 1 — nordavind 10 kn", () => {
  it("fromDeg=0 gir (u,v) = (0,-10) og vice versa", () => {
    const [u, v] = windToUV(10, 0);
    expect(u).toBeCloseTo(0, 9);
    expect(v).toBeCloseTo(-10, 9);
    const back = uvToWind(0, -10);
    expect(back.speedKn).toBeCloseTo(10, 9);
    expect(back.fromDeg).toBeCloseTo(0, 9);
  });
});

describe("§3 punkt 2 — østavind 10 kn", () => {
  it("fromDeg=90 gir (u,v) = (-10,0)", () => {
    const [u, v] = windToUV(10, 90);
    expect(u).toBeCloseTo(-10, 9);
    expect(v).toBeCloseTo(0, 9);
  });
});

describe("§3 punkt 3 — strøm er MOT, ikke FRA: ingen atan2(-u,-v) på strømkomponenter", () => {
  it("nordgående strøm 2 kn (v=2,u=0) dekodes som {u:0,v:2}, ALDRI som en FRA-vind", () => {
    const g = geom({ nodesLat: 2, nodesLon: 2, timeSteps: 1 });
    const uLayer = buildLayer({
      sample: () => 0,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: () => 2,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const layers = { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) };
    const current = decodeCurrentAt(layers, 58, 10, T0)!;
    expect(current.u).toBeCloseTo(0, 6);
    expect(current.v).toBeCloseTo(2, 6);

    // Kontrast: hadde disse samme (u,v) blitt tolket som VIND (feil retning
    // for strøm), ville "FRA"-retningen blitt sør (180°) — helt forskjellig
    // fysisk betydning fra "strømmen går mot nord". Testen dokumenterer
    // eksplisitt at `decodeCurrentAt` ikke gjør denne konverteringen.
    const misapplied = uvToWind(current.u, current.v);
    expect(misapplied.fromDeg).toBeCloseTo(180, 6); // det FEILAKTIGE svaret, om noen bommet
    expect(current).toEqual({ u: 0, v: 2 }); // det RIKTIGE svaret — ingen retningskonvertering skjedde
  });
});

describe("§3 punkt 4 — bilineær romlig interpolasjon i komponentrom", () => {
  it("interpolerer u/v hver for seg — fromDeg aldri lineært interpolert direkte", () => {
    // To hjørner: 350° og 10° vind (10 kn begge). Midtpunktet er FYSISK 0°
    // (nord) — en naiv lineær middelverdi av gradtallene ville gitt 180°
    // (feil retning, stikk motsatt).
    const g = geom({ nodesLat: 2, nodesLon: 2, timeSteps: 1 });
    const [u00, v00] = windToUV(10, 350);
    const [u01, v01] = windToUV(10, 10);
    const uLayer = buildLayer({
      sample: (lat) => (lat < g.latMin + 0.05 ? u00 : u01),
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: (lat) => (lat < g.latMin + 0.05 ? v00 : v01),
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const member = { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) };
    const midLat = g.latMin + g.latStepDeg / 2;
    const w = decodeWindAt(member, midLat, g.lonMin, T0)!;
    // Riktig svar (komponentrom): u/v-midtpunktet er nesten nøyaktig nord
    // (rett over 0°/360°-grensen), ikke 180° (den naive feilen).
    expect(w.fromDeg > 350 || w.fromDeg < 15).toBe(true);
    // IKKE 180° (den naive, feilaktige "middelverdi av gradtall"-retningen).
    expect(Math.abs(w.fromDeg - 180)).toBeGreaterThan(100);
  });

  it("felt levert som fart+retning konverteres til komponenter FØR interpolasjon", () => {
    // Simulerer en kilde som gir (speed, dir) i stedet for (u,v): vi
    // konverterer FØR vi mater `buildLayer`, akkurat som §3 punkt 4 krever.
    const g = geom({ nodesLat: 2, nodesLon: 2, timeSteps: 1 });
    const externalSpeedDir = (lat: number): readonly [number, number] =>
      lat < g.latMin + 0.05 ? [10, 350] : [10, 10];
    const uLayer = buildLayer({
      sample: (lat) => windToUV(...externalSpeedDir(lat))[0],
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: (lat) => windToUV(...externalSpeedDir(lat))[1],
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const member = { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) };
    const midLat = g.latMin + g.latStepDeg / 2;
    const w = decodeWindAt(member, midLat, g.lonMin, T0)!;
    expect(w.fromDeg > 350 || w.fromDeg < 15).toBe(true);
  });
});

describe("§3 punkt 5 — tids-interpolasjon i komponentrom, konvertering som siste steg", () => {
  it("vind: u/v interpoleres lineært i tid, WindSample bygges etter", () => {
    const g = geom({ nodesLat: 1, nodesLon: 1, timeSteps: 2 });
    const [u0, v0] = windToUV(10, 0);
    const [u1, v1] = windToUV(10, 90);
    const uLayer = buildLayer({
      sample: (_lat, _lon, epochS) => (epochS === T0 ? u0 : u1),
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: (_lat, _lon, epochS) => (epochS === T0 ? v0 : v1),
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const member = { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) };
    const mid = decodeWindAt(member, g.latMin, g.lonMin, T0 + g.dtS / 2)!;
    // Midt mellom (u0,v0)=(0,-10) og (u1,v1)=(-10,0): u=-5, v=-5 ⇒ 45°.
    expect(mid.fromDeg).toBeCloseTo(45, 0);
    expect(mid.speedKn).toBeCloseTo(Math.hypot(5, 5), 1);
  });

  it("strøm interpoleres direkte i (u,v), ingen konvertering i noen ende", () => {
    const g = geom({ nodesLat: 1, nodesLon: 1, timeSteps: 2 });
    const uLayer = buildLayer({
      sample: (_lat, _lon, epochS) => (epochS === T0 ? 0 : 2),
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const vLayer = buildLayer({
      sample: () => 1,
      geometryBase: g,
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const layers = { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) };
    const mid = decodeCurrentAt(layers, g.latMin, g.lonMin, T0 + g.dtS / 2)!;
    expect(mid.u).toBeCloseTo(1, 1);
    expect(mid.v).toBeCloseTo(1, 1);
  });
});

describe("§17 pkt. 2 — interpolasjon på syntetisk felt med kjent analytisk svar", () => {
  it("bilineær+lineær interpolasjon av en trilineær funksjon er eksakt", () => {
    const g = geom({ nodesLat: 6, nodesLon: 6, timeSteps: 4 });
    const f = (lat: number, lon: number, epochS: number): number =>
      3 * lat - 2 * lon + 0.5 * ((epochS - T0) / g.dtS);
    const layer = buildLayer({
      sample: f,
      geometryBase: { ...g },
      bitsPerSample: 10,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const lookup = buildLayerLookup(layer);
    const lat = g.latMin + 2.3 * g.latStepDeg;
    const lon = g.lonMin + 1.7 * g.lonStepDeg;
    const epochS = T0 + 1.4 * g.dtS;
    const truth = f(lat, lon, epochS);
    const decoded = decodeLayerAt(lookup, lat, lon, epochS)!;
    expect(Math.abs(decoded - truth)).toBeLessThan(0.05);
  });

  it("dekoding av en eksakt node stemmer med scale/2-toleransen (§9.9)", () => {
    const g = geom({ nodesLat: 5, nodesLon: 5, timeSteps: 1 });
    const layer = buildLayer({
      sample: (lat, lon) => lat + lon,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    const layout = computeSubtileLayout(g);
    const decoded = decodeLayerNode(layer, layout, 2, 2, 0)!;
    const truth = (g.latMin + 2 * g.latStepDeg) + (g.lonMin + 2 * g.lonStepDeg);
    expect(Math.abs(decoded - truth)).toBeLessThan(0.1);
  });
});
