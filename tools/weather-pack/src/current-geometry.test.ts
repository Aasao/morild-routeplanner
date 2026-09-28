/**
 * Testkrav `docs/specs/strom-produsent.md` §5 for produsentens geometri:
 * fill før avskalering, enhet, NN mot 2D lat/lon på et 60°-dreid
 * polarstereografisk gitter (feiler om indeksvindu-forenklingen
 * gjeninnføres), ingen midling over fill, forlengelsesgrensen og kystmasken.
 */
import { describe, expect, it } from "vitest";
import {
  COAST_EXTENSION_CELLS,
  COAST_FILL_PROXIMITY_CELLS,
  currentMsToKnots,
  currentRegularGridForTile,
  decodeNorkystRaw,
  haversineM,
  localCellSizeM,
  matchTimeSteps,
  NORKYST_FILL_VALUE,
  regridNearestSeaNode,
  regularComponentValues,
  seaMaskFromRaw,
  type NativeGrid,
  type RegridResult,
} from "./current-geometry.js";
import { polarStereoGrid, seeded } from "./current-fixtures.js";
import { windLayerGeometry } from "./pipeline.js";

const MS_TO_KN = 3600 / 1852;

function nodeLatLon(spec: RegridResult["spec"], n: number): { lat: number; lon: number } {
  const i = Math.floor(n / spec.nodesLon);
  const j = n - i * spec.nodesLon;
  return { lat: spec.latMin + i * spec.latStepDeg, lon: spec.lonMin + j * spec.lonStepDeg };
}

/** Brute force over ALLE native noder — fasiten bøtteindeksen må matche. */
function bruteForce(grid: NativeGrid, sea: ArrayLike<number>, lat: number, lon: number) {
  let anyIdx = -1;
  let anyD = Infinity;
  let seaIdx = -1;
  let seaD = Infinity;
  let fillD = Infinity;
  for (let k = 0; k < grid.yCount * grid.xCount; k++) {
    const d = haversineM(lat, lon, grid.lat[k]!, grid.lon[k]!);
    if (d < anyD) {
      anyD = d;
      anyIdx = k;
    }
    if (sea[k] === 1) {
      if (d < seaD) {
        seaD = d;
        seaIdx = k;
      }
    } else if (d < fillD) fillD = d;
  }
  return { anyIdx, anyD, seaIdx, seaD, fillD };
}

describe("invariant 1 — fill sjekkes på rå Int16 FØR avskalering", () => {
  it("rå −32767 gir undefined, aldri −32,767 m/s og aldri 0", () => {
    expect(NORKYST_FILL_VALUE).toBe(-32767);
    expect(decodeNorkystRaw(-32767)).toBeUndefined();
    expect(decodeNorkystRaw(1000)).toBeCloseTo(1.0, 12);
    expect(decodeNorkystRaw(-32766)).toBeCloseTo(-32.766, 9);
    expect(decodeNorkystRaw(0)).toBe(0);
    expect(decodeNorkystRaw(Number.NaN)).toBeUndefined();
  });

  it("fill midt i en ellers gyldig blokk: den ene prøven blir sentinel, naboene urørt", () => {
    // 3 native noder, 2 tidssteg. Node 1 er fill på t=1 — men regriddingen er
    // tvunget til å peke på den (sjømasken er her bevisst omgått), så det er
    // fill-sjekken i regularComponentValues alene som må stoppe den.
    const regrid = {
      spec: { latMin: 0, lonMin: 0, latStepDeg: 1, lonStepDeg: 1, nodesLat: 1, nodesLon: 3 },
      extensionCells: COAST_EXTENSION_CELLS,
      fillProximityCells: COAST_FILL_PROXIMITY_CELLS,
      sourceIndex: Int32Array.from([0, 1, 2]),
      extended: new Uint8Array(3),
      coastal: new Uint8Array(3),
      stats: { nodes: 3, withValue: 3, extended: 0, coastalWithValue: 0, nearSea: 3, nearSeaWithoutValue: 0 },
    } satisfies RegridResult;
    const raw = [500, 400, 300, /* t=1 */ 500, NORKYST_FILL_VALUE, 300];
    const out = regularComponentValues(regrid, raw, 3, [0, 1]);
    expect(out.values[0]).toBeCloseTo(0.5 * MS_TO_KN, 12);
    expect(out.values[1]).toBeCloseTo(0.4 * MS_TO_KN, 12);
    expect(Number.isNaN(out.values[4]!)).toBe(true); // fill ⇒ sentinel
    expect(out.values[3]).toBeCloseTo(0.5 * MS_TO_KN, 12);
    expect(out.values[5]).toBeCloseTo(0.3 * MS_TO_KN, 12);
    for (const v of out.values) {
      expect(v).not.toBeCloseTo(-32.767 * MS_TO_KN, 3);
    }
  });

  it("sjømasken: en node som er fill på ETT tidssteg (u eller v) er land for alle", () => {
    const u = [10, 20, 30, /* t=1 */ 10, 20, 30];
    const v = [10, 20, 30, /* t=1 */ 10, 20, NORKYST_FILL_VALUE];
    expect(Array.from(seaMaskFromRaw(u, v, 2, 3))).toEqual([1, 1, 0]);
  });

  it("tidssteg NorKyst ikke har ⇒ sentinel (utover horisonten)", () => {
    const regrid = {
      spec: { latMin: 0, lonMin: 0, latStepDeg: 1, lonStepDeg: 1, nodesLat: 1, nodesLon: 1 },
      extensionCells: COAST_EXTENSION_CELLS,
      fillProximityCells: COAST_FILL_PROXIMITY_CELLS,
      sourceIndex: Int32Array.from([0]),
      extended: new Uint8Array(1),
      coastal: new Uint8Array(1),
      stats: { nodes: 1, withValue: 1, extended: 0, coastalWithValue: 0, nearSea: 1, nearSeaWithoutValue: 0 },
    } satisfies RegridResult;
    const out = regularComponentValues(regrid, [100], 1, [0, undefined, undefined]);
    expect(out.values[0]).toBeCloseTo(0.1 * MS_TO_KN, 12);
    expect(Number.isNaN(out.values[1]!)).toBe(true);
    expect(Number.isNaN(out.values[2]!)).toBe(true);
  });
});

describe("enhet og retning", () => {
  it("1 m/s ⇒ 1,9438 kn; u og v beholder fortegn (ingen rotasjon, ingen atan2)", () => {
    expect(currentMsToKnots(1)).toBeCloseTo(1.9438, 4);
    expect(currentMsToKnots(-0.5)).toBeCloseTo(-0.9719, 4);
    const regrid = {
      spec: { latMin: 0, lonMin: 0, latStepDeg: 1, lonStepDeg: 1, nodesLat: 1, nodesLon: 1 },
      extensionCells: COAST_EXTENSION_CELLS,
      fillProximityCells: COAST_FILL_PROXIMITY_CELLS,
      sourceIndex: Int32Array.from([0]),
      extended: new Uint8Array(1),
      coastal: new Uint8Array(1),
      stats: { nodes: 1, withValue: 1, extended: 0, coastalWithValue: 0, nearSea: 1, nearSeaWithoutValue: 0 },
    } satisfies RegridResult;
    const u = regularComponentValues(regrid, [1000], 1, [0]);
    const v = regularComponentValues(regrid, [-500], 1, [0]);
    expect(u.values[0]).toBeCloseTo(1.9438, 4);
    expect(v.values[0]).toBeCloseTo(-0.9719, 4);
  });
});

describe("invariant 3 — NN mot kildens 2D lat/lon på et 60°-dreid polarstereografisk gitter", () => {
  // Skagerrak-åpent (spiken): gitteraksene står ~60° dreid mot øst/nord.
  const grid = polarStereoGrid(58.3, 10.3, 70, 70);
  const sea = new Uint8Array(grid.yCount * grid.xCount).fill(1);
  const spec = currentRegularGridForTile({ west: 10.1, east: 10.5, south: 58.2, north: 58.4 });
  const regrid = regridNearestSeaNode(grid, sea, spec);

  it("forutsetning: gitteret ER dreid ~60° (ellers har testen ingen tenner)", () => {
    const mid = 35 * grid.xCount + 35;
    const east = mid + 1;
    const dLat = grid.lat[east]! - grid.lat[mid]!;
    const dLon = (grid.lon[east]! - grid.lon[mid]!) * Math.cos((58.3 * Math.PI) / 180);
    const bearingDeg = (Math.atan2(dLon, dLat) * 180) / Math.PI; // 90 = rett øst
    expect(Math.abs(bearingDeg - 90)).toBeGreaterThan(50);
    expect(Math.abs(bearingDeg - 90)).toBeLessThan(70);
  });

  it("hver regulær node får NØYAKTIG den native noden som er nærmest i haversine", () => {
    for (let n = 0; n < spec.nodesLat * spec.nodesLon; n++) {
      const p = nodeLatLon(spec, n);
      const ref = bruteForce(grid, sea, p.lat, p.lon);
      expect(regrid.sourceIndex[n]).toBe(ref.seaIdx);
      // NN-feilen er under en halv celle-diagonal (~566 m) — spikens 280–450 m.
      expect(ref.seaD).toBeLessThan(0.75 * 800);
    }
  });

  it("vindens indeksvindu-forenkling bommer på samme gitter (grunnen til egen kodevei)", () => {
    // `windLayerGeometry` behandler (y,x)-vinduet som jevnt fordelt over bboxen.
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (let k = 0; k < grid.lat.length; k++) {
      minLat = Math.min(minLat, grid.lat[k]!);
      maxLat = Math.max(maxLat, grid.lat[k]!);
      minLon = Math.min(minLon, grid.lon[k]!);
      maxLon = Math.max(maxLon, grid.lon[k]!);
    }
    const naive = windLayerGeometry({
      bbox: [minLon, minLat, maxLon, maxLat],
      dims: { timeCount: 1, memberCount: 1, yCount: grid.yCount, xCount: grid.xCount },
      t0S: 0,
      dtS: 3600,
    });
    const errors: number[] = [];
    let sameNode = 0;
    const nodes = spec.nodesLat * spec.nodesLon;
    for (let n = 0; n < nodes; n++) {
      const p = nodeLatLon(spec, n);
      const y = Math.round((p.lat - naive.latMin) / naive.latStepDeg);
      const x = Math.round((p.lon - naive.lonMin) / naive.lonStepDeg);
      const idx = y * grid.xCount + x;
      if (idx === regrid.sourceIndex[n]) sameNode++;
      errors.push(haversineM(p.lat, p.lon, grid.lat[idx]!, grid.lon[idx]!));
    }
    errors.sort((a, b) => a - b);
    expect(sameNode / nodes).toBeLessThan(0.05);
    expect(errors[Math.floor(errors.length / 2)]!).toBeGreaterThan(5_000);
  });
});

describe("invariant 2, 5, 6 — egenskapstest over tilfeldig fill", () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}: verdier kun fra sjønoder, uten midling, innenfor √2 celler; kystmasken som definert`, () => {
      const rnd = seeded(seed);
      const grid = polarStereoGrid(59.05, 11.05, 45, 45);
      const n = grid.yCount * grid.xCount;
      // Klumpete land: land der en glatt, tilfeldig funksjon er positiv.
      const a = rnd() * 6;
      const b = rnd() * 6;
      const sea = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const y = Math.floor(k / grid.xCount);
        const x = k - y * grid.xCount;
        const s = Math.sin(x / 4 + a) + Math.cos(y / 5 + b) + (rnd() - 0.5) * 0.8;
        sea[k] = s > 0.3 ? 0 : 1;
      }
      const raw = Array.from({ length: n }, (_, k) => (sea[k] === 1 ? Math.round((rnd() - 0.5) * 3000) : NORKYST_FILL_VALUE));
      const spec = currentRegularGridForTile({ west: 10.95, east: 11.15, south: 59.0, north: 59.1 });
      const regrid = regridNearestSeaNode(grid, sea, spec);
      const values = regularComponentValues(regrid, raw, n, [0]);

      let withValue = 0;
      let extended = 0;
      let undefinedCount = 0;
      for (let r = 0; r < spec.nodesLat * spec.nodesLon; r++) {
        const p = nodeLatLon(spec, r);
        const ref = bruteForce(grid, sea, p.lat, p.lon);
        const cellM = localCellSizeM(grid, ref.anyIdx);
        const src = regrid.sourceIndex[r]!;
        const hasValue = ref.seaIdx >= 0 && ref.seaD <= COAST_EXTENSION_CELLS * cellM;
        if (hasValue) {
          withValue++;
          // Invariant 3/5: nærmeste sjønode, innenfor grensen.
          expect(src).toBe(ref.seaIdx);
          expect(sea[src]).toBe(1);
          // Invariant 2: verdien er ÉN kildenodes verdi — ingen midling.
          expect(values.values[r]).toBe(currentMsToKnots(decodeNorkystRaw(raw[src]!)!));
        } else {
          undefinedCount++;
          // Forlengelsesgrensen: ingen sjønode innenfor √2 celler ⇒ sentinel.
          expect(src).toBe(-1);
          expect(Number.isNaN(values.values[r]!)).toBe(true);
        }
        const isExtended = hasValue && ref.fillD < ref.seaD;
        if (isExtended) extended++;
        expect(regrid.extended[r]).toBe(isExtended ? 1 : 0);
        // Kystmasken (D15.2): forlenget ELLER ≤ 3 celler fra fill.
        const coastal = isExtended || ref.fillD <= COAST_FILL_PROXIMITY_CELLS * cellM;
        expect(regrid.coastal[r]).toBe(coastal ? 1 : 0);
      }
      // Fiksturen skal faktisk utøve alle grenene.
      expect(withValue).toBeGreaterThan(0);
      expect(extended).toBeGreaterThan(0);
      expect(undefinedCount).toBeGreaterThan(0);
      expect(regrid.stats.withValue).toBe(withValue);
      expect(regrid.stats.extended).toBe(extended);
    });
  }
});

describe("forlengelsesgrensen og kystmasken ved en rett kystlinje", () => {
  const grid = polarStereoGrid(58.3, 10.3, 60, 60);
  const n = grid.yCount * grid.xCount;
  // Land der gitter-x < 30: kystlinjen følger gitteraksen (dreid 60° i lat/lon).
  const sea = Uint8Array.from({ length: n }, (_, k) => (k % grid.xCount >= 30 ? 1 : 0));
  const spec = currentRegularGridForTile({ west: 10.2, east: 10.4, south: 58.25, north: 58.35 });

  it("COAST_EXTENSION_CELLS er √2 — vedtatt (D15.1), utvides aldri uten ny beslutning", () => {
    expect(COAST_EXTENSION_CELLS).toBe(Math.SQRT2);
    expect(COAST_FILL_PROXIMITY_CELLS).toBe(3);
  });

  it("grense √2 gir flere noder med verdi enn grense 1, men ingen lenger enn √2 celler inn på land", () => {
    const wide = regridNearestSeaNode(grid, sea, spec);
    const narrow = regridNearestSeaNode(grid, sea, spec, { extensionCells: 1 });
    expect(wide.stats.withValue).toBeGreaterThan(narrow.stats.withValue);
    for (let r = 0; r < spec.nodesLat * spec.nodesLon; r++) {
      const src = wide.sourceIndex[r]!;
      if (src < 0) continue;
      const p = nodeLatLon(spec, r);
      const d = haversineM(p.lat, p.lon, grid.lat[src]!, grid.lon[src]!);
      expect(d).toBeLessThanOrEqual(COAST_EXTENSION_CELLS * 800 * 1.02);
    }
  });

  it("dypt i sjøen: verdi, ikke forlenget, ikke kyst; forlengede noder er alltid kyst", () => {
    const regrid = regridNearestSeaNode(grid, sea, spec);
    let deepSea = 0;
    for (let r = 0; r < spec.nodesLat * spec.nodesLon; r++) {
      if (regrid.extended[r] === 1) expect(regrid.coastal[r]).toBe(1);
      const p = nodeLatLon(spec, r);
      const ref = bruteForce(grid, sea, p.lat, p.lon);
      if (ref.fillD > 4 * 800 && ref.seaD < 800) {
        deepSea++;
        expect(regrid.sourceIndex[r]).toBeGreaterThanOrEqual(0);
        expect(regrid.coastal[r]).toBe(0);
        expect(regrid.extended[r]).toBe(0);
      }
    }
    expect(deepSea).toBeGreaterThan(0);
    expect(regrid.stats.extended).toBeGreaterThan(0);
  });
});

describe("regulært gitter og tidsakse", () => {
  it("1°-flisens kanter faller på noder (nabofliser deler kantnoder)", () => {
    const spec = currentRegularGridForTile({ west: 10, east: 11, south: 58, north: 59 });
    expect(spec.nodesLat).toBe(140);
    expect(spec.nodesLon).toBe(71);
    expect(spec.latMin + (spec.nodesLat - 1) * spec.latStepDeg).toBeCloseTo(59, 12);
    expect(spec.lonMin + (spec.nodesLon - 1) * spec.lonStepDeg).toBeCloseTo(11, 12);
    // ~800 m nodeavstand i nord-sør.
    expect(spec.latStepDeg * 111_195).toBeGreaterThan(780);
    expect(spec.latStepDeg * 111_195).toBeLessThan(820);
  });

  it("matchTimeSteps: eksakt treff, hull og horisont gir undefined — aldri nærmeste time", () => {
    const t0 = 1_790_000_000;
    const times = [t0 - 3600, t0, t0 + 3600, t0 + 3 * 3600];
    expect(matchTimeSteps(times, t0, 3600, 5)).toEqual([1, 2, undefined, 3, undefined]);
    expect(matchTimeSteps(times, t0 + 1800, 3600, 2)).toEqual([undefined, undefined]);
  });
});
