/**
 * `docs/specs/strom-produsent.md` §4b (D15.1 d-min, D15.2):
 *
 * 1. Sluttetappen: mangler strøm eller bølge i sluttetappens miljøoppslag,
 *    blir `coverage.weather` `"partial"` og sluttsteget får per-steg-flagg
 *    (`STROM_DATA_MANGLER` / `SJOEGANG_DATA_MANGLER`). Kan bare gjøre
 *    klassifiseringen strengere.
 * 2. `STROM_KYSTSONE` per steg fra `WeatherField.currentCoastal`, rute-flagget
 *    er OR over stegene. Ingen endring i søk, kost eller derating: på
 *    golden-rutene er steg og tid identiske med og uten kystmaske.
 */
import { describe, expect, it } from "vitest";
import { haversineNm } from "@morild/geo";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { constantWeather, type ConstantWeatherOptions } from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import { LabelArena } from "./arena.js";
import type { WeatherField } from "./contracts.js";
import {
  FLAG_SJOEGANG_DATA_MANGLER,
  FLAG_STROM_DATA_MANGLER,
  FLAG_STROM_KYSTSONE,
  NEUTRAL_SEARCH_WEIGHTS,
  ZERO_COST,
} from "./cost.js";
import { LabelStore, UNCAPPED } from "./label-store.js";
import { withDefaults } from "./options.js";
import { buildResult, type ResultContext } from "./reconstruct.js";
import { planRoute } from "./search.js";

const START = { lat: 58.6, lon: 10.6 };
const DEST = { lat: 58.0, lon: 10.6 };
/** Siste søkepunkt ~1,2 nm fra målet ⇒ direkte sluttetappe (> 0,3 nm). */
const NEAR = { lat: 58.02, lon: 10.6 };
/** 2026-06-15 06:00 UTC — dagslys, ingen dagslyskonflikt i testene. */
const DEPART_EPOCH_S = 1_781_503_200;

function withCoastal(w: WeatherField, coastal: (lat: number, lon: number, epochS: number) => boolean): WeatherField {
  return {
    wind: (lat, lon, t) => w.wind(lat, lon, t),
    waves: (lat, lon, t) => w.waves(lat, lon, t),
    current: (lat, lon, t) => w.current(lat, lon, t),
    currentCoastal: coastal,
    maxTwsKn: w.maxTwsKn,
    maxCurrentKn: w.maxCurrentKn,
    maxDecodeErrorKn: w.maxDecodeErrorKn,
    ...(w.maxDecodeErrorKnAt !== undefined ? { maxDecodeErrorKnAt: w.maxDecodeErrorKnAt.bind(w) } : {}),
    validFromS: w.validFromS,
    validToS: w.validToS,
    header: w.header,
  };
}

function weather(o: { readonly noCurrent?: boolean; readonly noWaves?: boolean; readonly speedKn?: number } = {}): WeatherField {
  const opts: ConstantWeatherOptions = {
    speedKn: o.speedKn ?? 12,
    fromDeg: 270,
    ...(o.noWaves === true ? {} : { hsM: 0.8, tpS: 5 }),
    ...(o.noCurrent === true ? {} : { currentU: 0.2, currentV: 0 }),
    validFromS: DEPART_EPOCH_S - 3600,
    validToS: DEPART_EPOCH_S + 2 * 24 * 3600,
  };
  return constantWeather(opts);
}

/** Håndbygd kontekst (samme mønster som `reconstruct.test.ts`): start → NEAR, «nådd». */
function context(w: WeatherField): ResultContext {
  const arena = new LabelArena(16);
  const push = (lat: number, lon: number, tS: number, parent: number, headingDeg: number): number =>
    arena.push({
      lat,
      lon,
      cost: tS === 0 ? ZERO_COST : { tS, beatS: 0, motorS: 0, nightS: 0 },
      headingDeg,
      sector: 0,
      tack: 0,
      parent,
      flags: 0,
      cellKey: 0,
      stateKey: 0,
      remainingNm: 0,
      clearanceNm: Number.POSITIVE_INFINITY,
      twsKn: 12,
      twdDeg: 270,
      bspKn: 6,
      hsM: 0.8,
    });
  const start = push(START.lat, START.lon, 0, -1, 0);
  const near = push(NEAR.lat, NEAR.lon, 5 * 3600, start, 180);
  return {
    input: { start: START, dest: DEST, departEpochS: DEPART_EPOCH_S, weather: w, mask: rectMask(), boat: testBoat() },
    opts: withDefaults({}),
    arena,
    store: new LabelStore(arena, UNCAPPED, NEUTRAL_SEARCH_WEIGHTS),
    reached: true,
    abortReason: null,
    bestIndex: near,
    reachedIndices: [near],
    reachRadiusNm: 2.5,
    directDistanceNm: haversineNm(START, DEST),
    isochrones: [],
    weatherPartial: false,
    fieldUsed: false,
    fieldCells: 0,
    tubBoundS: null,
    vmaxKn: 8,
    iterations: 1,
    peakActiveLabels: 2,
    pruned: {
      dominated: 0,
      bound: 0,
      deadEnd: 0,
      hardConstraint: 0,
      hardConstraintBoatLimits: 0,
      hardConstraintPoint: 0,
      hardConstraintClearance: 0,
      hardConstraintSegment: 0,
      hardConstraintTss: 0,
      hardConstraintDaylight: 0,
      capEvicted: 0,
      noWeather: 0,
      noWeatherInWindow: 0,
      cone: 0,
      outsideDomain: 0,
    },
  };
}

describe("sluttetappen (D15.1 d-min): manglende strøm/bølge ⇒ partial + per-steg-flagg", () => {
  it("full dekning: sluttetappen lagt til, full, ingen datamangel-flagg", () => {
    const r = buildResult(context(weather()));
    expect(r.finalLeg.status).toBe("lagt-til");
    expect(r.coverage.weather).toBe("full");
    const last = r.steps[r.steps.length - 1]!;
    expect(last.flags & (FLAG_STROM_DATA_MANGLER | FLAG_SJOEGANG_DATA_MANGLER)).toBe(0);
  });

  it("strøm mangler i sluttetappen: partial og STROM_DATA_MANGLER på sluttsteget — selv om søket var full", () => {
    const r = buildResult(context(weather({ noCurrent: true })));
    expect(r.finalLeg.status).toBe("lagt-til");
    expect(r.coverage.weather).toBe("partial");
    const last = r.steps[r.steps.length - 1]!;
    expect(last.flagNames).toContain("STROM_DATA_MANGLER");
    // Bare sluttsteget — søkets etiketter merkes ikke (full (d) er egen runde).
    for (const s of r.steps.slice(0, -1)) expect(s.flags & FLAG_STROM_DATA_MANGLER).toBe(0);
  });

  it("bølge mangler i sluttetappen: partial og SJOEGANG_DATA_MANGLER på sluttsteget", () => {
    const r = buildResult(context(weather({ noWaves: true })));
    expect(r.coverage.weather).toBe("partial");
    expect(r.steps[r.steps.length - 1]!.flagNames).toContain("SJOEGANG_DATA_MANGLER");
  });

  it("søkets partial overstyres aldri til full", () => {
    const ctx = { ...context(weather()), weatherPartial: true };
    expect(buildResult(ctx).coverage.weather).toBe("partial");
  });

  it("avvist sluttetappe etter miljøoppslaget teller også (strengere, aldri mildere)", () => {
    // Vind over båtens harde grense ⇒ avvist-baatgrenser, etter oppslaget.
    const r = buildResult(context(weather({ speedKn: 80, noCurrent: true })));
    expect(r.finalLeg.status).toBe("avvist-baatgrenser");
    expect(r.coverage.weather).toBe("partial");
  });
});

describe("STROM_KYSTSONE (D15.2): per steg fra currentCoastal, rute-flagg = OR", () => {
  it("merker bare stegene der masken er sann — og ruten", () => {
    const w = withCoastal(weather(), (lat) => lat < 58.1);
    const r = buildResult(context(w));
    const flagged = r.steps.map((s) => (s.flags & FLAG_STROM_KYSTSONE) !== 0);
    expect(flagged).toEqual([false, true, true]); // start, NEAR, målet
    expect(r.flagNames).toContain("STROM_KYSTSONE");
    expect(r.steps[1]!.flagNames).toContain("STROM_KYSTSONE");
  });

  it("uten currentCoastal (eller aldri sann) settes flagget aldri", () => {
    for (const w of [weather(), withCoastal(weather(), () => false)]) {
      const r = buildResult(context(w));
      expect(r.flags & FLAG_STROM_KYSTSONE).toBe(0);
      for (const s of r.steps) expect(s.flags & FLAG_STROM_KYSTSONE).toBe(0);
    }
  });

  it("endrer ikke sikkerhetsdommen (kun rapportering)", () => {
    const plain = buildResult(context(weather()));
    const coastal = buildResult(context(withCoastal(weather(), () => true)));
    expect(coastal.safety).toEqual(plain.safety);
    expect(coastal.totals).toEqual(plain.totals);
  });
});

describe("regresjon på golden-rutene: kystmasken endrer verken steg eller tid", () => {
  const names = ["skjaeloy-skagen-apent", "bohuslan-trange-sund", "hull-i-vaerfeltet"];
  for (const scenario of goldenScenarios().filter((s) => names.includes(s.name))) {
    it(`${scenario.name}: samme steg, tid, totaler og dom — bare STROM_KYSTSONE-biten legges til`, () => {
      const plain = planRoute(scenario.input);
      const coastal = planRoute({ ...scenario.input, weather: withCoastal(scenario.input.weather, () => true) });
      expect(coastal.steps.length).toBe(plain.steps.length);
      for (let i = 0; i < plain.steps.length; i++) {
        const a = plain.steps[i]!;
        const b = coastal.steps[i]!;
        expect({ ...b, flags: 0, flagNames: [] }).toEqual({ ...a, flags: 0, flagNames: [] });
        expect(b.flags).toBe(a.flags | FLAG_STROM_KYSTSONE);
      }
      expect(coastal.totals).toEqual(plain.totals);
      expect(coastal.legs).toEqual(plain.legs);
      expect(coastal.safety).toEqual(plain.safety);
      expect(coastal.coverage.weather).toBe(plain.coverage.weather);
      expect(coastal.finalLeg).toEqual(plain.finalLeg);
      expect(coastal.diagnostics.iterations).toBe(plain.diagnostics.iterations);
      expect(coastal.flags).toBe(plain.flags | FLAG_STROM_KYSTSONE);
    }, 120_000);
  }
});
