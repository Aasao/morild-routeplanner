/**
 * `docs/specs/punktbolge.md` §5 «Oppslag»: nærmeste punkt, avstandsgrense,
 * lineær tid, sirkelinterpolasjon av retning, `tpS` aldri satt,
 * `null` ⇒ `undefined` — pluss validering av wire-formatet.
 */
import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import {
  lerpDirectionDeg,
  parseWavePointSet,
  WAVE_POINT_MAX_DISTANCE_NM,
  WAVE_POINT_SET_SCHEMA,
  wavePointDistanceStats,
  wavePointLookup,
  withWavePoints,
  type WavePoint,
  type WavePointSet,
} from "./wave-points.js";
import { compositeWeatherField, type WeatherFieldLike } from "./weather-field-adapter.js";

const T0 = 1_790_000_000;
const H = 3600;

function point(lat: number, lon: number, times: WavePoint["times"], extra: Partial<WavePoint> = {}): WavePoint {
  return { lat, lon, sourceLat: null, sourceLon: null, status: times.length > 0 ? "ok" : "feilet", times, ...extra };
}

function set(points: readonly WavePoint[]): WavePointSet {
  return {
    schema: WAVE_POINT_SET_SCHEMA,
    fetchedAtEpochS: T0,
    points,
    sourceStatus: "ok",
    sourceReason: null,
    hash: "abc",
  };
}

const A = point(58.0, 10.0, [
  { epochS: T0, hsM: 1.0, fromDeg: 350 },
  { epochS: T0 + H, hsM: 2.0, fromDeg: 10 },
  { epochS: T0 + 2 * H, hsM: null, fromDeg: 20 },
  { epochS: T0 + 3 * H, hsM: 1.5, fromDeg: null },
]);
/** ~6 nm nord for A. */
const B = point(58.1, 10.0, [{ epochS: T0, hsM: 3.0, fromDeg: 180 }, { epochS: T0 + H, hsM: 3.0, fromDeg: 180 }]);

describe("wavePointLookup — nærmeste punkt og avstandsgrense (D16.2)", () => {
  const lookup = wavePointLookup(set([A, B]));

  it("velger nærmeste punkt (storsirkel)", () => {
    expect(lookup.waves(58.01, 10.0, T0)?.hsM).toBe(1.0);
    expect(lookup.waves(58.09, 10.0, T0)?.hsM).toBe(3.0);
  });

  it("avstand er haversine til nærmeste punkt, uansett grensen", () => {
    expect(lookup.wavePointDistanceNm(58.0, 10.0)).toBeCloseTo(0, 9);
    expect(lookup.wavePointDistanceNm(57.5, 10.0)).toBeCloseTo(30, 0);
  });

  it("lenger unna enn 10 nm ⇒ undefined (aldri nærmeste uansett)", () => {
    expect(WAVE_POINT_MAX_DISTANCE_NM).toBe(10);
    // 57,82° er 10,8 nm sør for A.
    expect(lookup.waves(57.82, 10.0, T0)).toBeUndefined();
    expect(lookup.waves(57.84, 10.0, T0)).toBeDefined();
  });

  it("punkter uten tidsserie deltar ikke i valget", () => {
    const failedNear = point(58.02, 10.0, [], { status: "feilet" });
    const l = wavePointLookup(set([failedNear, A]));
    expect(l.waves(58.02, 10.0, T0)?.hsM).toBe(1.0);
    expect(l.wavePointDistanceNm(58.02, 10.0)).toBeCloseTo(1.2, 1);
  });

  it("ingen punkter med data ⇒ undefined for både bølge og avstand", () => {
    const l = wavePointLookup(set([point(58, 10, [], { status: "ingen-data" })]));
    expect(l.waves(58, 10, T0)).toBeUndefined();
    expect(l.wavePointDistanceNm(58, 10)).toBeUndefined();
  });

  it("måler avstand til MET-posisjonen (sourceLat/Lon), ikke den forespurte", () => {
    const snapped = point(58.0, 10.0, A.times, { sourceLat: 58.2, sourceLon: 10.0 });
    const l = wavePointLookup(set([snapped]));
    expect(l.wavePointDistanceNm(58.2, 10.0)).toBeCloseTo(0, 9);
    expect(l.waves(58.0, 10.0, T0)).toBeUndefined(); // 12 nm fra der data faktisk gjelder
  });
});

describe("wavePointLookup — tid, retning, null og periode", () => {
  const lookup = wavePointLookup(set([A]));

  it("lineær i tid mellom punktets to nærmeste tidssteg", () => {
    expect(lookup.waves(58, 10, T0 + H / 4)?.hsM).toBeCloseTo(1.25, 12);
    expect(lookup.waves(58, 10, T0 + H)?.hsM).toBe(2.0);
  });

  it("retning interpoleres på sirkelen (350° → 10° går via 0°)", () => {
    expect(lookup.waves(58, 10, T0 + H / 2)?.fromDeg).toBeCloseTo(0, 9);
    expect(lookup.waves(58, 10, T0 + H / 4)?.fromDeg).toBeCloseTo(355, 9);
    expect(lerpDirectionDeg(10, 350, 0.5)).toBeCloseTo(0, 9);
    expect(lerpDirectionDeg(90, 270, 0.25)).toBeCloseTo(45, 9); // uavgjort bue: negativ retning, deterministisk
  });

  it("tpS settes aldri — kilden har ikke periode (D14.1)", () => {
    for (const t of [T0, T0 + H / 3, T0 + H]) {
      const w = lookup.waves(58, 10, t);
      expect(w).toBeDefined();
      expect(w).not.toHaveProperty("tpS");
    }
  });

  it("Hs null i et av nabostegene ⇒ undefined, aldri 0 og aldri interpolert over hullet", () => {
    expect(lookup.waves(58, 10, T0 + 1.5 * H)).toBeUndefined();
    expect(lookup.waves(58, 10, T0 + 2 * H)).toBeUndefined();
    expect(lookup.waves(58, 10, T0 + 2.5 * H)).toBeUndefined();
  });

  it("manglende retning gir Hs uten retning", () => {
    const w = lookup.waves(58, 10, T0 + 3 * H);
    expect(w).toEqual({ hsM: 1.5 });
  });

  it("utenfor punktets tidsrom ⇒ undefined (vi ekstrapolerer aldri)", () => {
    expect(lookup.waves(58, 10, T0 - 1)).toBeUndefined();
    expect(lookup.waves(58, 10, T0 + 3 * H + 1)).toBeUndefined();
  });
});

function stubField(): WeatherFieldLike {
  return {
    wind: () => ({ speedKn: 10, fromDeg: 200 }),
    waves: () => ({ hsM: 9, tpS: 9 }),
    current: () => ({ u: 0.1, v: 0 }),
    currentCoastal: () => true,
    maxDecodeErrorKnAt: () => 0.05,
    maxTwsKn: 20,
    maxCurrentKn: 1,
    maxDecodeErrorKn: 0.05,
    validFromS: T0,
    validToS: T0 + 48 * H,
    header: { init: "2026-09-29T00:00:00Z" } as unknown as PackageHeader,
  };
}

describe("withWavePoints", () => {
  it("bølge kun fra punktene; alt annet delegeres uendret", () => {
    const f = withWavePoints(stubField(), set([A]));
    expect(f.waves(58, 10, T0)).toEqual({ hsM: 1.0, fromDeg: 350 });
    expect(f.waves(50, 10, T0)).toBeUndefined(); // gridded 9 m blandes aldri inn
    expect(f.wind(58, 10, T0)).toEqual({ speedKn: 10, fromDeg: 200 });
    expect(f.current(58, 10, T0)).toEqual({ u: 0.1, v: 0 });
    expect(f.currentCoastal?.(58, 10, T0)).toBe(true);
    expect(f.maxDecodeErrorKnAt?.(58, 10, T0)).toBe(0.05);
    expect(f.wavePointDistanceNm?.(58, 10)).toBeCloseTo(0, 9);
    expect(f.maxTwsKn).toBe(20);
  });

  it("compositeWeatherField sender wavePointDistanceNm videre", () => {
    const f = compositeWeatherField([stubField(), withWavePoints(stubField(), set([A]))]);
    expect(f.wavePointDistanceNm?.(58, 10)).toBeCloseTo(0, 9);
  });
});

describe("wavePointDistanceStats — diagnostikken «maks og median»", () => {
  it("maks, median og antall over grensen", () => {
    const stats = wavePointDistanceStats(set([A]), [
      { lat: 58.0, lon: 10.0 },
      { lat: 58.1, lon: 10.0 },
      { lat: 58.3, lon: 10.0 },
    ]);
    expect(stats?.maxNm).toBeCloseTo(18, 0);
    expect(stats?.medianNm).toBeCloseTo(6, 0);
    expect(stats?.beyondLimit).toBe(1);
  });

  it("null uten punkter med data", () => {
    expect(wavePointDistanceStats(set([]), [{ lat: 58, lon: 10 }])).toBeNull();
  });
});

describe("parseWavePointSet", () => {
  it("godtar et gyldig sett (rundtur via JSON)", () => {
    const s = set([A, B, point(59, 11, [], { status: "ingen-data" })]);
    expect(parseWavePointSet(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("avviser feil skjema, manglende hash og ikke-stigende tid — med forklaring", () => {
    expect(() => parseWavePointSet({ ...set([A]), schema: "x" })).toThrow(/skjema/);
    expect(() => parseWavePointSet({ ...set([A]), hash: "" })).toThrow(/hash/);
    const bad = point(58, 10, [{ epochS: T0 + H, hsM: 1, fromDeg: 1 }, { epochS: T0, hsM: 1, fromDeg: 1 }]);
    expect(() => parseWavePointSet(set([bad]))).toThrow(/stigende/);
    expect(() => parseWavePointSet(null)).toThrow(/objekt/);
  });
});
