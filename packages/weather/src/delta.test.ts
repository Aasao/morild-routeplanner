import { describe, expect, it } from "vitest";
import { decodeTemporalDeltaU8, encodeTemporalDeltaU8 } from "./delta.js";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("temporal delta-koding — reversibel mod 256 (§8)", () => {
  it("rundtur er bit-eksakt for et tilfeldig, flerskives byteserie", () => {
    const rnd = mulberry32(42);
    const nodes = 32 * 32;
    const series: Uint8Array[] = [];
    for (let k = 0; k < 10; k++) {
      const slice = new Uint8Array(nodes);
      for (let i = 0; i < nodes; i++) slice[i] = Math.floor(rnd() * 256);
      series.push(slice);
    }
    const deltas = encodeTemporalDeltaU8(series);
    const back = decodeTemporalDeltaU8(deltas);
    expect(back.length).toBe(series.length);
    for (let k = 0; k < series.length; k++) {
      expect(Array.from(back[k]!)).toEqual(Array.from(series[k]!));
    }
  });

  it("håndterer wraparound ved 0/255 eksakt", () => {
    const series = [
      Uint8Array.from([0, 255, 128]),
      Uint8Array.from([255, 0, 128]),
      Uint8Array.from([1, 254, 0]),
    ];
    const back = decodeTemporalDeltaU8(encodeTemporalDeltaU8(series));
    for (let k = 0; k < series.length; k++) {
      expect(Array.from(back[k]!)).toEqual(Array.from(series[k]!));
    }
  });

  it("tom serie gir tom serie begge veier", () => {
    expect(encodeTemporalDeltaU8([])).toEqual([]);
    expect(decodeTemporalDeltaU8([])).toEqual([]);
  });

  it("én skive er uendret av transformen (ingenting å ta delta mot)", () => {
    const series = [Uint8Array.from([7, 200, 3])];
    const deltas = encodeTemporalDeltaU8(series);
    expect(Array.from(deltas[0]!)).toEqual([7, 200, 3]);
    expect(Array.from(decodeTemporalDeltaU8(deltas)[0]!)).toEqual([7, 200, 3]);
  });

  it("kaster på ulik skivelengde — en produsentfeil, ikke noe som skal stille aksepteres", () => {
    expect(() =>
      encodeTemporalDeltaU8([new Uint8Array(4), new Uint8Array(5)]),
    ).toThrow();
  });
});
