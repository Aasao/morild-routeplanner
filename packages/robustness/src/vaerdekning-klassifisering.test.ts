/**
 * **ADR-0008 og vedtak A ende til ende**: ekte `planRoute` → `classifyMember`
 * / `summarizeMember`. Enhetstestene i `outcome.test.ts` låser regelen på
 * håndbygde resultater; denne filen beviser at motoren faktisk leverer
 * feltene regelen leser (ADR-0008 §Bekreftelse):
 *
 *  - hull kun utenfor ruten ⇒ `weather = "full"`, `searchWeather =
 *    "partial"`, gjennomførbart;
 *  - ikke nådd med hull i søket ⇒ inkonklusivt (søksnivået styrer);
 *  - rutesteg uten strøm ⇒ `STROM_DATA_MANGLER` og inkonklusivt (D17.2 u);
 *  - rutesteg uten bølge ⇒ `maxHsM = null` (vedtak A).
 */
import { describe, expect, it } from "vitest";
import type { RouteInput, RouteResult, WeatherField } from "@morild/routing";
import { FLAG_STROM_DATA_MANGLER, planRoute } from "@morild/routing";
import { goldenScenarios } from "@morild/routing/test-fixtures/golden-scenarios";
import { classifyMember, summarizeMember } from "./outcome.js";

/** 2026-06-15 06:00 UTC — lyst hele etappen. */
const DEPART_S = Date.UTC(2026, 5, 15, 6, 0, 0) / 1000;
const START = { lat: 58.6, lon: 10.6 };
const DEST = { lat: 58.0, lon: 10.6 };

interface Box {
  readonly latMin: number;
  readonly latMax: number;
}

const inBox = (lat: number, box: Box | undefined): boolean =>
  box !== undefined && lat >= box.latMin && lat <= box.latMax;

/** Homogent felt; strøm/bølge fjernes i et breddebelte. Vinden står overalt. */
function weather(opts: {
  readonly noCurrent?: Box;
  readonly noWaves?: Box;
  readonly validToS?: number;
}): WeatherField {
  const validFromS = DEPART_S - 3600;
  const validToS = opts.validToS ?? DEPART_S + 4 * 24 * 3600;
  const inTime = (t: number): boolean => t >= validFromS && t <= validToS;
  return {
    wind: (_lat, _lon, t) => (inTime(t) ? { speedKn: 12, fromDeg: 270 } : undefined),
    waves: (lat, _lon, t) => (inTime(t) && !inBox(lat, opts.noWaves) ? { hsM: 0.5 } : undefined),
    current: (lat, _lon, t) => (inTime(t) && !inBox(lat, opts.noCurrent) ? { u: 0.2, v: 0 } : undefined),
    maxTwsKn: 12,
    maxCurrentKn: 0.2,
    maxDecodeErrorKn: 0,
    validFromS,
    validToS,
    header: goldenScenarios()[0]!.input.weather.header,
  };
}

function run(field: WeatherField): RouteResult {
  const golden = goldenScenarios()[0]!.input;
  const input: RouteInput = {
    start: START,
    dest: DEST,
    departEpochS: DEPART_S,
    weather: field,
    mask: golden.mask,
    boat: golden.boat,
    options: { headingStepDeg: 10, timeStepS: 1800 },
  };
  return planRoute(input);
}

/** Nord for start — søket ser dit, ruten går sørover. */
const NORTH: Box = { latMin: 58.62, latMax: 60 };
/** Tvers over ruten midtveis. */
const BAND: Box = { latMin: 58.25, latMax: 58.4 };

describe("ADR-0008 ende til ende: motorens dekningsfelt → klassifisering", () => {
  it("hull kun utenfor ruten ⇒ weather full, searchWeather partial, gjennomførbart", () => {
    const r = run(weather({ noCurrent: NORTH, noWaves: NORTH }));
    expect(r.safety.reachesDestination).toBe(true);
    expect(r.coverage.searchWeather).toBe("partial");
    expect(r.coverage.weather).toBe("full");
    expect(classifyMember(r)).toEqual({ kind: "feasible" });
    expect(summarizeMember(r).maxHsM).toBeCloseTo(0.5);
  });

  it("ikke nådd med hull i søket ⇒ inkonklusiv «dekning» (søksnivået styrer), selv om rutens steg var dekket", () => {
    const r = run(weather({ noCurrent: NORTH, validToS: DEPART_S + 2 * 3600 }));
    expect(r.safety.reachesDestination).toBe(false);
    expect(r.coverage.searchWeather).toBe("partial");
    expect(r.coverage.weather).toBe("full");
    expect(classifyMember(r)).toEqual({ kind: "inconclusive", reason: "dekning" });
  });

  it("rutesteg uten strøm ⇒ STROM_DATA_MANGLER på stegene og inkonklusiv «dekning-felt» (D17.2 u)", () => {
    const r = run(weather({ noCurrent: BAND }));
    expect(r.safety.reachesDestination).toBe(true);
    expect(r.coverage.weather).toBe("partial");
    const flagged = r.steps.filter((s) => (s.flags & FLAG_STROM_DATA_MANGLER) !== 0);
    expect(flagged.length).toBeGreaterThan(1);
    expect(classifyMember(r)).toEqual({ kind: "inconclusive", reason: "dekning-felt" });
    // Bølge fantes: Hs er kjent.
    expect(summarizeMember(r).maxHsM).toBeCloseTo(0.5);
  });

  it("rutesteg uten bølge ⇒ maxHsM = null (vedtak A), ikke 0", () => {
    const r = run(weather({ noWaves: BAND }));
    expect(r.coverage.weather).toBe("partial");
    expect(summarizeMember(r).maxHsM).toBeNull();
  });
});
