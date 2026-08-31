import { haversineNm } from "@morild/geo";
import { describe, expect, it } from "vitest";
import { rectMask, segmentIntersectsRect } from "../test-fixtures/synthetic-mask.js";
import { maskAsEdgeGate, OPEN_EDGE_GATE, type FieldEdgeGate } from "./contracts.js";
import { buildDistanceField, DistanceField } from "./distance-field.js";
import { MinHeap } from "./heap.js";

const START = { lat: 59.0, lon: 10.0 };
const DEST = { lat: 58.6, lon: 10.0 };

describe("buildDistanceField — håndregnede små grid", () => {
  it("gir 0 i målcellen og vokser monotont utover i åpent farvann", () => {
    const field = buildDistanceField(START, DEST, OPEN_EDGE_GATE, {
      cellDeg: 0.05,
    });
    expect(field).toBeDefined();
    if (field === undefined) return;

    expect(field.at(DEST.lat, DEST.lon)).toBeLessThan(0.05 * 60);
    // Avstanden fra feltet skal være tett på storsirkelen i åpent farvann.
    const direct = haversineNm(START, DEST);
    const viaField = field.at(START.lat, START.lon);
    expect(viaField).toBeDefined();
    if (viaField === undefined) return;
    expect(viaField).toBeGreaterThanOrEqual(direct - 3);
    expect(viaField).toBeLessThan(direct * 1.15);
  });

  it("avtar monotont langs en rett linje mot målet", () => {
    const field = buildDistanceField(START, DEST, OPEN_EDGE_GATE, {
      cellDeg: 0.05,
    });
    if (field === undefined) throw new Error("felt mangler");
    let previous = Infinity;
    for (let lat = START.lat; lat >= DEST.lat; lat -= 0.05) {
      const v = field.at(lat, 10.0);
      expect(v).toBeDefined();
      if (v === undefined) return;
      expect(v).toBeLessThanOrEqual(previous + 1e-9);
      previous = v;
    }
  });

  it("gir undefined for en lukket lomme (blindvei-eliminering)", () => {
    // En bukt som er helt inngjerdet av land: feltet skal ikke nå inn.
    const wall = { latMin: 58.7, latMax: 58.9, lonMin: 10.2, lonMax: 10.5 };
    const pocket = { lat: 58.8, lon: 10.35 };
    const mask = rectMask({ noGo: [wall] });
    const field = buildDistanceField(START, DEST, maskAsEdgeGate(mask), {
      cellDeg: 0.02,
    });
    if (field === undefined) throw new Error("felt mangler");
    expect(segmentIntersectsRect(pocket.lat, pocket.lon, pocket.lat, pocket.lon, wall)).toBe(
      true,
    );
    expect(field.at(pocket.lat, pocket.lon)).toBeUndefined();
  });

  it("går rundt en halvøy i stedet for gjennom den", () => {
    // Vegg tvers over den direkte linjen, med åpning i vest.
    const wall = { latMin: 58.75, latMax: 58.8, lonMin: 9.95, lonMax: 10.6 };
    const mask = rectMask({ noGo: [wall] });
    const field = buildDistanceField(START, DEST, maskAsEdgeGate(mask), {
      cellDeg: 0.02,
    });
    if (field === undefined) throw new Error("felt mangler");
    const viaField = field.at(START.lat, START.lon);
    expect(viaField).toBeDefined();
    if (viaField === undefined) return;
    // Omveien rundt vestenden må koste mer enn den rette linjen.
    expect(viaField).toBeGreaterThan(haversineNm(START, DEST) + 1);
  });

  it("atNear redder en celle som havnet på land", () => {
    const wall = { latMin: 58.79, latMax: 58.81, lonMin: 9.99, lonMax: 10.01 };
    const mask = rectMask({ noGo: [wall] });
    const field = buildDistanceField(START, DEST, maskAsEdgeGate(mask), {
      cellDeg: 0.02,
    });
    if (field === undefined) throw new Error("felt mangler");
    const centre = { lat: 58.8, lon: 10.0 };
    expect(field.at(centre.lat, centre.lon)).toBeUndefined();
    expect(field.atNear(centre.lat, centre.lon)).toBeDefined();
    expect(field.atOrNear(centre.lat, centre.lon)).toBeDefined();
  });

  it("er utenfor feltet utenfor boksen", () => {
    const field = buildDistanceField(START, DEST, OPEN_EDGE_GATE, {
      cellDeg: 0.05,
    });
    if (field === undefined) throw new Error("felt mangler");
    expect(field.at(70, 10)).toBeUndefined();
    expect(field.at(58.8, 30)).toBeUndefined();
  });

  it("grovner oppløsningen i stedet for å sprenge celletaket", () => {
    const field = buildDistanceField(
      { lat: 59, lon: 10 },
      { lat: 57, lon: 12 },
      OPEN_EDGE_GATE,
      { cellDeg: 0.002, maxCells: 20_000 },
    );
    if (field === undefined) throw new Error("felt mangler");
    expect(field.cellCount).toBeLessThanOrEqual(22_000);
    expect(field.data.cellDeg).toBeGreaterThan(0.002);
  });

  it("er ren data og kan gjenskapes etter en structured clone", () => {
    const field = buildDistanceField(START, DEST, OPEN_EDGE_GATE, {
      cellDeg: 0.05,
    });
    if (field === undefined) throw new Error("felt mangler");
    const clone = DistanceField.fromData(structuredClone(field.toData()));
    expect(clone.at(START.lat, START.lon)).toBe(field.at(START.lat, START.lon));
    expect(clone.cellCount).toBe(field.cellCount);
  });

  it("er deterministisk: to bygg gir bit-identiske felt", () => {
    const gate = maskAsEdgeGate(
      rectMask({ noGo: [{ latMin: 58.7, latMax: 58.8, lonMin: 9.9, lonMax: 10.3 }] }),
    );
    const a = buildDistanceField(START, DEST, gate, { cellDeg: 0.02 });
    const b = buildDistanceField(START, DEST, gate, { cellDeg: 0.02 });
    if (a === undefined || b === undefined) throw new Error("felt mangler");
    expect(new Uint8Array(a.data.d.buffer)).toEqual(new Uint8Array(b.data.d.buffer));
  });
});

/**
 * Regresjonstest for v1-buggen: feltet i Float32 ga «foreldede» celler.
 *
 * Mekanismen: heap-prioriteten regnes i dobbel presisjon, mens den lagrede
 * avstanden avrundes til Float32. Da er `priority === D[idx]` ikke lenger
 * sant for oppføringen som faktisk satte verdien, og «foreldet»-sjekken
 * (`priority > D[idx]`) begynner å avvise ekte oppføringer.
 *
 * Testen replikerer algoritmen i Float32 og viser avviket konkret, og låser
 * samtidig at produksjonsfeltet er Float64.
 */
describe("Float64-kravet (v1-bug → test)", () => {
  it("produksjonsfeltet lagres i Float64Array", () => {
    const field = buildDistanceField(START, DEST, OPEN_EDGE_GATE, {
      cellDeg: 0.05,
    });
    if (field === undefined) throw new Error("felt mangler");
    expect(field.data.d).toBeInstanceOf(Float64Array);
    expect(field.data.d.BYTES_PER_ELEMENT).toBe(8);
  });

  it("Float32-lagring bryter prioritet/verdi-invarianten som Float64 holder", () => {
    const f64 = replicaField(false);
    const f32 = replicaField(true);

    // Float64: hver aksepterte pop har prioritet nøyaktig lik lagret verdi.
    expect(f64.priorityMismatches).toBe(0);
    // Float32: avrunding gjør at det ikke lenger stemmer.
    expect(f32.priorityMismatches).toBeGreaterThan(0);

    // …og resultatet blir et annet felt.
    let differing = 0;
    for (let i = 0; i < f64.d.length; i++) {
      if (f64.d[i] !== f32.d[i]) differing++;
    }
    expect(differing).toBeGreaterThan(0);
  });
});

interface ReplicaResult {
  readonly d: Float64Array | Float32Array;
  readonly priorityMismatches: number;
}

/** Samme algoritme som `buildDistanceField`, med valgbar presisjon. */
function replicaField(useFloat32: boolean): ReplicaResult {
  const lat0 = 58.4;
  const lon0 = 9.6;
  const cellDeg = 0.02;
  const width = 60;
  const height = 60;
  const gate: FieldEdgeGate = OPEN_EDGE_GATE;
  const d = useFloat32
    ? new Float32Array(width * height).fill(Infinity)
    : new Float64Array(width * height).fill(Infinity);
  const centre = (ix: number, iy: number) => ({
    lat: lat0 + (iy + 0.5) * cellDeg,
    lon: lon0 + (ix + 0.5) * cellDeg,
  });
  const destIdx = 5 * width + 5;
  d[destIdx] = 0;
  const heap = new MinHeap(1024);
  heap.push(0, destIdx);
  let priorityMismatches = 0;
  while (heap.length > 0) {
    const { priority, value: idx } = heap.pop();
    if (priority > d[idx]!) continue;
    if (priority !== d[idx]!) priorityMismatches++;
    const iy = (idx / width) | 0;
    const ix = idx - iy * width;
    const here = centre(ix, iy);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        const there = centre(nx, ny);
        const nd = priority + haversineNm(here, there);
        if (nd >= d[nIdx]!) continue;
        if (!gate.edgeOpen(here.lat, here.lon, there.lat, there.lon)) continue;
        d[nIdx] = nd;
        heap.push(nd, nIdx);
      }
    }
  }
  return { d, priorityMismatches };
}

describe("MinHeap", () => {
  it("popper i stigende prioritet med total ordning på uavgjort", () => {
    const heap = new MinHeap(4);
    const items: [number, number][] = [
      [3, 30],
      [1, 11],
      [1, 10],
      [2, 20],
      [1, 12],
    ];
    for (const [p, v] of items) heap.push(p, v);
    const out: [number, number][] = [];
    while (heap.length > 0) {
      const { priority, value } = heap.pop();
      out.push([priority, value]);
    }
    expect(out).toEqual([
      [1, 10],
      [1, 11],
      [1, 12],
      [2, 20],
      [3, 30],
    ]);
  });

  it("kaster på pop fra tom heap i stedet for å returnere søppel", () => {
    expect(() => new MinHeap(1).pop()).toThrow(/tom heap/);
  });
});
