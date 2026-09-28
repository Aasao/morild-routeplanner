/**
 * Strøm + kystmaske som pakkelag (`docs/specs/strom-produsent.md` §3
 * «Pakkelag», invariant 6, §4 steg 5, §5): full rundtur fra serialisert
 * nyttelast, sentinel bevart, sertifikat uten retningsskranke, kystmaske
 * og hjørneregelen via klientens egen dekoder (`@morild/weather`).
 */
import { describe, expect, it } from "vitest";
import {
  coastalMaskFromBytes,
  currentLayersFromBytes,
  decodeCoastalMaskAt,
  decodeCurrentAt,
  hasCertificate,
  toWeatherField,
  windMemberLayersFromBytes,
} from "@morild/weather";
import {
  NORKYST_FILL_VALUE,
  currentRegularGridForTile,
  regridNearestSeaNode,
  regularComponentValues,
  seaMaskFromRaw,
} from "./current-geometry.js";
import { polarStereoGrid, seeded } from "./current-fixtures.js";
import {
  buildCoastalMaskLayer,
  buildCurrentLayers,
  currentLayerGeometry,
  currentPointerEntries,
  verifyCurrentRoundTrip,
} from "./current-package.js";
import { buildWindMemberPackage, type FetchedWindComponents } from "./pipeline.js";

const T0 = 1_790_000_000;
const DT = 3600;

function fixture() {
  const grid = polarStereoGrid(58.3, 10.3, 50, 50);
  const n = grid.yCount * grid.xCount;
  const timeCount = 3;
  // Land der gitter-x < 20 (kyst langs en gitterakse, dreid ~60° i lat/lon).
  const rnd = seeded(7);
  const uRaw = new Float64Array(timeCount * n);
  const vRaw = new Float64Array(timeCount * n);
  for (let t = 0; t < timeCount; t++) {
    for (let k = 0; k < n; k++) {
      const land = k % grid.xCount < 20;
      uRaw[t * n + k] = land ? NORKYST_FILL_VALUE : Math.round((rnd() - 0.5) * 2400);
      vRaw[t * n + k] = land ? NORKYST_FILL_VALUE : Math.round((rnd() - 0.5) * 2400);
    }
  }
  const sea = seaMaskFromRaw(uRaw, vRaw, timeCount, n);
  const spec = currentRegularGridForTile({ west: 10.2, east: 10.4, south: 58.25, north: 58.35 });
  const regrid = regridNearestSeaNode(grid, sea, spec);
  // Pakken har 4 tidssteg; NorKyst har bare de 3 første (horisont ⇒ sentinel).
  const sourceTimeIndex = [0, 1, 2, undefined];
  const u = regularComponentValues(regrid, uRaw, n, sourceTimeIndex);
  const v = regularComponentValues(regrid, vRaw, n, sourceTimeIndex);
  const geometry = currentLayerGeometry(spec, T0, DT, sourceTimeIndex.length);
  const layers = buildCurrentLayers({
    geometry,
    u,
    v,
    onClip: () => {
      throw new Error("klipping");
    },
  });
  const mask = buildCoastalMaskLayer(regrid, T0, DT);
  return { grid, regrid, u, v, geometry, layers, mask, spec };
}

describe("strømlag: bygg, serialiser, rundtur", () => {
  const f = fixture();

  it("full rundtur fra serialisert nyttelast er innenfor sertifikatet, sentinel ⇔ sentinel", () => {
    const report = verifyCurrentRoundTrip({ payload: f.layers.payload, maskPayload: f.mask.payload, u: f.u, v: f.v, coastal: f.regrid.coastal });
    expect(report.withinBudget).toBe(true);
    expect(report.sentinelMismatches).toBe(0);
    expect(report.maskMismatches).toBe(0);
    expect(report.checkedSamples).toBeGreaterThan(0);
    expect(f.layers.clippedSamples).toBe(0);
    expect(Math.hypot(report.maxErrorUKn, report.maxErrorVKn)).toBeLessThanOrEqual(f.layers.maxDecodeErrorKn + 1e-9);
  });

  it("rundturen fanger et avvik (verdier som ikke ble pakket)", () => {
    const tampered = { ...f.u, values: f.u.values.map((x) => (Number.isNaN(x) ? x : x + 0.5)) };
    const report = verifyCurrentRoundTrip({ payload: f.layers.payload, maskPayload: f.mask.payload, u: tampered, v: f.v, coastal: f.regrid.coastal });
    expect(report.withinBudget).toBe(false);
    const flipped = f.regrid.coastal.map((b) => 1 - b);
    expect(verifyCurrentRoundTrip({ payload: f.layers.payload, maskPayload: f.mask.payload, u: f.u, v: f.v, coastal: flipped }).maskMismatches).toBeGreaterThan(0);
  });

  it("klientens dekoder: komponenter i knop, land og utover horisonten ⇒ undefined", () => {
    const layers = currentLayersFromBytes(f.layers.payload);
    const g = f.geometry;
    let defined = 0;
    let sentinel = 0;
    for (let i = 0; i < g.nodesLat - 1; i++) {
      for (let j = 0; j < g.nodesLon - 1; j++) {
        // Midt i cellen: alle fire hjørner har positiv vekt.
        const lat = g.latMin + (i + 0.5) * g.latStepDeg;
        const lon = g.lonMin + (j + 0.5) * g.lonStepDeg;
        const d = decodeCurrentAt(layers, lat, lon, T0 + DT);
        const corners = [i * g.nodesLon + j, i * g.nodesLon + j + 1, (i + 1) * g.nodesLon + j, (i + 1) * g.nodesLon + j + 1].map(
          (n) => f.u.values[1 * f.u.nodes + n]!,
        );
        if (corners.some((c) => Number.isNaN(c))) {
          expect(d).toBeUndefined(); // aldri midling over et land-hjørne
          sentinel++;
        } else {
          expect(d).toBeDefined();
          const lo = Math.min(...corners) - f.layers.maxDecodeErrorKn;
          const hi = Math.max(...corners) + f.layers.maxDecodeErrorKn;
          expect(d!.u).toBeGreaterThanOrEqual(lo);
          expect(d!.u).toBeLessThanOrEqual(hi);
          defined++;
        }
        expect(decodeCurrentAt(layers, lat, lon, T0 + 3 * DT)).toBeUndefined(); // utover NorKyst-horisonten
      }
    }
    expect(defined).toBeGreaterThan(0);
    expect(sentinel).toBeGreaterThan(0);
  });
});

describe("kystmasken i klienten (D15.2) — hjørneregelen", () => {
  const f = fixture();
  const mask = coastalMaskFromBytes(f.mask.payload);
  const g = f.geometry;

  it("inne i en celle: sann hvis ETT av de fire hjørnene er merket", () => {
    let mixed = 0;
    for (let i = 0; i < g.nodesLat - 1; i++) {
      for (let j = 0; j < g.nodesLon - 1; j++) {
        const corners = [
          f.regrid.coastal[i * g.nodesLon + j],
          f.regrid.coastal[i * g.nodesLon + j + 1],
          f.regrid.coastal[(i + 1) * g.nodesLon + j],
          f.regrid.coastal[(i + 1) * g.nodesLon + j + 1],
        ];
        const any = corners.some((c) => c === 1);
        if (any && !corners.every((c) => c === 1)) mixed++;
        const lat = g.latMin + (i + 0.3) * g.latStepDeg;
        const lon = g.lonMin + (j + 0.6) * g.lonStepDeg;
        expect(decodeCoastalMaskAt(mask, lat, lon)).toBe(any);
      }
    }
    expect(mixed).toBeGreaterThan(0); // fiksturen har faktisk en kystkant
  });

  it("utenfor maskens dekning ⇒ false", () => {
    expect(decodeCoastalMaskAt(mask, g.latMin - 1, g.lonMin)).toBe(false);
  });

  it("toWeatherField: currentCoastal fra masken; uten maske alltid false", () => {
    const windPkg = buildWindMemberPackage({
      formatVersion: "1.1.0",
      producedAt: "2026-09-27T00:00:00Z",
      init: "2026-09-27T00:00:00Z",
      resolution: "2.5km",
      components: syntheticWind(),
      memberIndex: 0,
      bbox: [10.2, 58.25, 10.4, 58.35],
      tileId: "t",
      t0S: T0,
      dtS: DT,
    });
    const base = { windMembers: [windMemberLayersFromBytes(windPkg.payload)], windHeader: windPkg.header };
    const withMask = toWeatherField({ ...base, current: currentLayersFromBytes(f.layers.payload), currentCoastal: mask }, 0, { departEpochS: T0 });
    const without = toWeatherField({ ...base, current: currentLayersFromBytes(f.layers.payload) }, 0, { departEpochS: T0 });
    let marked = 0;
    for (let i = 0; i < g.nodesLat - 1; i++) {
      for (let j = 0; j < g.nodesLon - 1; j++) {
        const lat = g.latMin + (i + 0.5) * g.latStepDeg;
        const lon = g.lonMin + (j + 0.5) * g.lonStepDeg;
        const expected = [
          i * g.nodesLon + j,
          i * g.nodesLon + j + 1,
          (i + 1) * g.nodesLon + j,
          (i + 1) * g.nodesLon + j + 1,
        ].some((n) => f.regrid.coastal[n] === 1);
        expect(withMask.currentCoastal?.(lat, lon, T0)).toBe(expected);
        expect(without.currentCoastal?.(lat, lon, T0)).toBe(false);
        if (expected) marked++;
      }
    }
    expect(marked).toBeGreaterThan(0);
  });
});

function syntheticWind(): FetchedWindComponents {
  const dims = { timeCount: 2, memberCount: 1, yCount: 4, xCount: 4 };
  const size = dims.timeCount * dims.yCount * dims.xCount;
  return { dims, u: new Float64Array(size).fill(5), v: new Float64Array(size).fill(3) };
}

describe("pekeroppføringer og sertifikat", () => {
  const f = fixture();
  const entries = currentPointerEntries({
    formatVersion: "1.1.0",
    producedAt: "2026-09-27T12:00:00Z",
    init: "2026-09-27T00:00:00Z",
    sourceStatus: { status: "ok" },
    currentPayload: f.layers.payload,
    maskPayload: f.mask.payload,
    maxDecodeErrorKn: f.layers.maxDecodeErrorKn,
    clippedSamples: f.layers.clippedSamples,
    regrid: f.regrid,
  });

  it("field current / current-coastal, member 0, innholdsadressert", () => {
    expect(entries.current.field).toBe("current");
    expect(entries.coastal.field).toBe("current-coastal");
    expect(entries.current.member).toBe(0);
    expect(entries.coastal.member).toBe(0);
    expect(entries.current.key).toBe(`weather/1/${entries.currentHash}.bin`);
    expect(entries.current.header.model).toBe("NorKyst-800");
  });

  it("sertifikat: maxDecodeErrorKn og clippedSamples, INGEN retningsskranke for strøm", () => {
    expect(hasCertificate(entries.current.header)).toBe(true);
    expect(hasCertificate(entries.coastal.header)).toBe(true);
    expect(entries.current.header.certificate.maxDecodeErrorKn).toBe(f.layers.maxDecodeErrorKn);
    expect(entries.current.header.certificate.maxDirectionErrorDeg).toBeUndefined();
    expect(entries.current.header.certificate.clippedSamples).toBe(0);
  });

  it("kystmaskens regel er logget i headeren (√2 og 3 celler)", () => {
    const h = entries.coastal.header as typeof entries.coastal.header & { coastalMask: { extensionCells: number; fillProximityCells: number } };
    expect(h.coastalMask.extensionCells).toBe(Math.SQRT2);
    expect(h.coastalMask.fillProximityCells).toBe(3);
  });
});
