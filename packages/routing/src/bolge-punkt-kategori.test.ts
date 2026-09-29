/**
 * `docs/specs/punktbolge.md` §4: per-steg-flagg for avstand til nærmeste
 * bølge-varselpunkt (`BOLGE_PUNKT_KATEGORI_*`, < 5 / 5–20 / > 20 nm) fra
 * `WeatherField.wavePointDistanceNm`, rute-flagget er OR over stegene —
 * samme mønster som `STROM_KYSTSONE`. Kun rapportering: søk, kost og
 * derating er uendret (golden-regresjon under).
 */
import { describe, expect, it } from "vitest";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import type { WeatherField } from "./contracts.js";
import {
  FLAG_BOLGE_PUNKT_5_20NM,
  FLAG_BOLGE_PUNKT_KATEGORI,
  FLAG_BOLGE_PUNKT_OVER_20NM,
  FLAG_BOLGE_PUNKT_UNDER_5NM,
  flagNames,
  wavePointCategoryFlag,
} from "./cost.js";
import { planRoute } from "./search.js";

function withDistance(w: WeatherField, distanceNm: (lat: number, lon: number) => number | undefined): WeatherField {
  return {
    wind: (lat, lon, t) => w.wind(lat, lon, t),
    waves: (lat, lon, t) => w.waves(lat, lon, t),
    current: (lat, lon, t) => w.current(lat, lon, t),
    ...(w.currentCoastal !== undefined ? { currentCoastal: w.currentCoastal.bind(w) } : {}),
    wavePointDistanceNm: distanceNm,
    maxTwsKn: w.maxTwsKn,
    maxCurrentKn: w.maxCurrentKn,
    maxDecodeErrorKn: w.maxDecodeErrorKn,
    ...(w.maxDecodeErrorKnAt !== undefined ? { maxDecodeErrorKnAt: w.maxDecodeErrorKnAt.bind(w) } : {}),
    validFromS: w.validFromS,
    validToS: w.validToS,
    header: w.header,
  };
}

describe("wavePointCategoryFlag: kategorigrensene < 5 / 5–20 / > 20 nm", () => {
  it("klassifiserer, med 5 og 20 i midtkategorien", () => {
    expect(wavePointCategoryFlag(0)).toBe(FLAG_BOLGE_PUNKT_UNDER_5NM);
    expect(wavePointCategoryFlag(4.99)).toBe(FLAG_BOLGE_PUNKT_UNDER_5NM);
    expect(wavePointCategoryFlag(5)).toBe(FLAG_BOLGE_PUNKT_5_20NM);
    expect(wavePointCategoryFlag(20)).toBe(FLAG_BOLGE_PUNKT_5_20NM);
    expect(wavePointCategoryFlag(20.01)).toBe(FLAG_BOLGE_PUNKT_OVER_20NM);
  });

  it("ingen avstand ⇒ ingen kategori (aldri en antatt nærhet)", () => {
    expect(wavePointCategoryFlag(undefined)).toBe(0);
    expect(wavePointCategoryFlag(Number.NaN)).toBe(0);
  });

  it("flaggnavnene er stabile", () => {
    expect(flagNames(FLAG_BOLGE_PUNKT_KATEGORI)).toEqual([
      "BOLGE_PUNKT_KATEGORI_UNDER_5NM",
      "BOLGE_PUNKT_KATEGORI_5_20NM",
      "BOLGE_PUNKT_KATEGORI_OVER_20NM",
    ]);
  });
});

describe("per steg og rute-OR, uten endring i søket", () => {
  const scenario = goldenScenarios().find((s) => s.name === "skjaeloy-skagen-apent")!;

  it("steg nord for 58,5° er < 5 nm, sør for er 5–20 nm; ruten bærer begge", () => {
    const plain = planRoute(scenario.input);
    const w = withDistance(scenario.input.weather, (lat) => (lat > 58.5 ? 2 : 12));
    const r = planRoute({ ...scenario.input, weather: w });
    for (const s of r.steps) {
      const expected = s.lat > 58.5 ? FLAG_BOLGE_PUNKT_UNDER_5NM : FLAG_BOLGE_PUNKT_5_20NM;
      expect(s.flags & FLAG_BOLGE_PUNKT_KATEGORI).toBe(expected);
    }
    expect(r.flags & FLAG_BOLGE_PUNKT_KATEGORI).toBe(FLAG_BOLGE_PUNKT_UNDER_5NM | FLAG_BOLGE_PUNKT_5_20NM);
    expect(r.flagNames).toContain("BOLGE_PUNKT_KATEGORI_UNDER_5NM");
    expect(r.flagNames).toContain("BOLGE_PUNKT_KATEGORI_5_20NM");
    // Kun rapportering: steg, tid, totaler, etapper og dom er identiske.
    expect(r.steps.length).toBe(plain.steps.length);
    for (let i = 0; i < plain.steps.length; i++) {
      expect({ ...r.steps[i]!, flags: 0, flagNames: [] }).toEqual({ ...plain.steps[i]!, flags: 0, flagNames: [] });
      expect(r.steps[i]!.flags & ~FLAG_BOLGE_PUNKT_KATEGORI).toBe(plain.steps[i]!.flags);
    }
    expect(r.totals).toEqual(plain.totals);
    expect(r.legs).toEqual(plain.legs);
    expect(r.safety).toEqual(plain.safety);
    expect(r.coverage.weather).toBe(plain.coverage.weather);
    expect(r.diagnostics.iterations).toBe(plain.diagnostics.iterations);
  }, 120_000);

  it("felt uten wavePointDistanceNm (eller alltid undefined) gir aldri kategori", () => {
    for (const w of [scenario.input.weather, withDistance(scenario.input.weather, () => undefined)]) {
      const r = planRoute({ ...scenario.input, weather: w });
      expect(r.flags & FLAG_BOLGE_PUNKT_KATEGORI).toBe(0);
      for (const s of r.steps) expect(s.flags & FLAG_BOLGE_PUNKT_KATEGORI).toBe(0);
    }
  }, 120_000);
});
