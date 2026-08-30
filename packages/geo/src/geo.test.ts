import { describe, expect, it } from "vitest";
import {
  angDiff,
  bearing,
  haversineNm,
  norm180,
  norm360,
  stepLatLon,
} from "./geo.js";

// Skjæløy (Morilds hjemmehavn) og Skagen — fasit regnet ut og verifisert
// mot v1s egen formel (samme kode, kjørt frittstående) før testen ble
// skrevet: haversineNm ≈ 88.20304 nm, bearing ≈ 185.73820°.
const SKJALOY = { lat: 59.182, lon: 10.855 };
const SKAGEN = { lat: 57.72, lon: 10.58 };

describe("haversineNm", () => {
  it("Skjæløy → Skagen er omtrent 88 nm", () => {
    const nm = haversineNm(SKJALOY, SKAGEN);
    expect(Math.round(nm)).toBe(88);
    expect(nm).toBeCloseTo(88.203, 2);
  });

  it("avstand fra et punkt til seg selv er 0", () => {
    expect(haversineNm(SKJALOY, SKJALOY)).toBe(0);
  });

  it("er symmetrisk", () => {
    expect(haversineNm(SKJALOY, SKAGEN)).toBeCloseTo(
      haversineNm(SKAGEN, SKJALOY),
      9,
    );
  });
});

describe("bearing", () => {
  it("Skjæløy → Skagen peiler omtrent 186°", () => {
    const brg = bearing(SKJALOY, SKAGEN);
    expect(Math.round(brg)).toBe(186);
    expect(brg).toBeCloseTo(185.738, 2);
  });

  it("rett nord er alltid 0°", () => {
    const north = bearing({ lat: 59, lon: 10 }, { lat: 60, lon: 10 });
    expect(north).toBeCloseTo(0, 1);
  });

  it("rett øst er 90° på ekvator", () => {
    const east = bearing({ lat: 0, lon: 10 }, { lat: 0, lon: 11 });
    expect(east).toBeCloseTo(90, 9);
  });

  it("øst ved 59°N er litt under 90° (storsirkel bøyer mot polen, ikke rett linje)", () => {
    const east = bearing({ lat: 59, lon: 10 }, { lat: 59, lon: 11 });
    expect(east).toBeLessThan(90);
    expect(east).toBeCloseTo(89.571, 2);
  });
});

describe("stepLatLon", () => {
  it("10 nm rett sør flytter breddegrad med 10/60°", () => {
    const start = { lat: 59.182, lon: 10.855 };
    const end = stepLatLon(start.lat, start.lon, 180, 10);
    expect(end.lat).toBeCloseTo(start.lat - 10 / 60, 9);
    expect(end.lon).toBeCloseTo(start.lon, 9);
  });

  it("10 nm rett nord flytter breddegrad med +10/60°", () => {
    const start = { lat: 59.182, lon: 10.855 };
    const end = stepLatLon(start.lat, start.lon, 0, 10);
    expect(end.lat).toBeCloseTo(start.lat + 10 / 60, 9);
  });
});

describe("angDiff", () => {
  it("finner minste vinkel over 0/360-grensen", () => {
    expect(angDiff(10, 350)).toBe(20);
    expect(angDiff(350, 10)).toBe(20);
  });

  it("er 0 for like vinkler og 180 for motsatte", () => {
    expect(angDiff(45, 45)).toBe(0);
    expect(angDiff(0, 180)).toBe(180);
  });
});

describe("norm360", () => {
  it("normaliserer negative og store vinkler til [0, 360)", () => {
    expect(norm360(-10)).toBe(350);
    expect(norm360(370)).toBe(10);
    expect(norm360(0)).toBe(0);
  });
});

describe("norm180", () => {
  it("normaliserer til (-180, 180], 180 forblir 180", () => {
    expect(norm180(190)).toBe(-170);
    expect(norm180(-190)).toBe(170);
    expect(norm180(180)).toBe(180);
    expect(norm180(0)).toBe(0);
  });
});
