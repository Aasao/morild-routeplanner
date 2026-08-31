/**
 * Golden-route-regresjon (docs/specs/rutemotor.md §8.2).
 *
 * Kjøres med `pnpm --filter @morild/routing test:golden`.
 * Regenerering: `UPDATE_GOLDEN=1 pnpm --filter @morild/routing test:golden`.
 *
 * Sammenligningsregelen er bevisst asymmetrisk:
 *  - **eksakt** på de diskrete feltene (`reached`, `abortReason`,
 *    `safety.verdict`, `recheckPassed`, antall feilende segmenter). Endrer
 *    en av dem seg, har adferden endret seg, punktum.
 *  - **toleranse** på tid og totaler (±2 %), fordi `Math.sin`/`cos`/`atan2`
 *    er implementasjonsdefinert på tvers av V8-versjoner (§5.1).
 *  - **korridor** på geometri (≤ 0,5 nm tverravvik, målt begge veier).
 *
 * Hver algoritmeendring krever ny golden-kjøring, og enhver diff skal
 * forklares i spec-ens endringslogg. Uforklarte differ blokkerer commit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import {
  corridorDeviationNm,
  type TrackPoint,
} from "../test-fixtures/track-compare.js";
import { planRoute } from "./search.js";
import type { RouteResult } from "./result.js";

const GOLDEN_DIR = join(import.meta.dirname, "..", "test-fixtures", "golden");
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

/** Toleranse på varighet og totaler (N5). */
const DURATION_TOLERANCE = 0.02;
/** Maks tverravvik mot referansesporet. */
const CORRIDOR_NM = 0.5;

/**
 * Det som faktisk lagres. Bevisst et lite utvalg: en golden-fil som
 * inneholder alt blir en fil ingen leser, og enhver diff blir støy.
 */
interface GoldenSnapshot {
  readonly note: string;
  readonly purpose: string;
  readonly exact: {
    readonly reached: boolean;
    readonly abortReason: string | null;
    readonly safetyVerdict: string;
    readonly recheckPassed: boolean;
    readonly failingSegmentCount: number;
    readonly maskCoverage: string;
    readonly weatherCoverage: string;
    readonly fieldUsed: boolean;
    readonly daylightArrival: boolean;
  };
  readonly totals: {
    readonly durationS: number;
    readonly distanceNm: number;
    readonly beatS: number;
    readonly motorS: number;
    readonly nightS: number;
    readonly beatAtNightS: number;
    readonly fuelL: number;
  };
  readonly counts: {
    readonly legs: number;
    readonly steps: number;
    readonly alternatives: number;
  };
  readonly track: readonly TrackPoint[];
}

function snapshotOf(result: RouteResult, purpose: string): GoldenSnapshot {
  return {
    note:
      "Syntetisk, frosset fikstur (fase 2). Byttes til ekte MEPS-uttrekk i " +
      "fase 3 — se docs/specs/rutemotor.md §9 spm. 11.",
    purpose,
    exact: {
      reached: result.reached,
      abortReason: result.abortReason,
      safetyVerdict: result.safety.verdict,
      recheckPassed: result.safety.recheckPassed,
      failingSegmentCount: result.safety.failingSegments.length,
      maskCoverage: result.coverage.mask,
      weatherCoverage: result.coverage.weather,
      fieldUsed: result.coverage.fieldUsed,
      daylightArrival: result.totals.daylightArrival,
    },
    totals: {
      durationS: result.totals.durationS,
      distanceNm: round(result.totals.distanceNm, 4),
      beatS: result.totals.beatS,
      motorS: result.totals.motorS,
      nightS: result.totals.nightS,
      beatAtNightS: result.totals.beatAtNightS,
      fuelL: round(result.totals.fuelL, 4),
    },
    counts: {
      legs: result.legs.length,
      steps: result.steps.length,
      alternatives: result.alternatives.length,
    },
    track: result.steps.map((s) => ({
      lat: round(s.lat, 6),
      lon: round(s.lon, 6),
    })),
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function goldenPath(name: string): string {
  return join(GOLDEN_DIR, `${name}.json`);
}

function readGolden(name: string): GoldenSnapshot | undefined {
  const path = goldenPath(name);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as GoldenSnapshot;
}

function writeGolden(name: string, snapshot: GoldenSnapshot): void {
  const path = goldenPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

/** Relativ toleranse som også godtar små absolutte differ på små tall. */
function expectWithinTolerance(
  actual: number,
  expected: number,
  fraction: number,
  absoluteFloor: number,
  label: string,
): void {
  const allowed = Math.max(Math.abs(expected) * fraction, absoluteFloor);
  const diff = Math.abs(actual - expected);
  expect(
    diff,
    `${label}: ${actual} avviker ${diff.toFixed(3)} fra golden ${expected} (tillatt ${allowed.toFixed(3)})`,
  ).toBeLessThanOrEqual(allowed);
}

describe("golden-ruter", () => {
  for (const scenario of goldenScenarios()) {
    it(`${scenario.name} er uendret mot frosset referanse`, () => {
      const result = planRoute(scenario.input);
      const actual = snapshotOf(result, scenario.purpose);

      if (UPDATE) {
        writeGolden(scenario.name, actual);
        return;
      }

      const golden = readGolden(scenario.name);
      expect(
        golden,
        `Golden-fil mangler for «${scenario.name}». Kjør med UPDATE_GOLDEN=1 og commit resultatet.`,
      ).toBeDefined();
      if (golden === undefined) return;

      // Eksakt på de diskrete feltene.
      expect(actual.exact).toEqual(golden.exact);

      // Toleranse på tid og totaler.
      expectWithinTolerance(
        actual.totals.durationS,
        golden.totals.durationS,
        DURATION_TOLERANCE,
        1,
        "durationS",
      );
      expectWithinTolerance(
        actual.totals.distanceNm,
        golden.totals.distanceNm,
        DURATION_TOLERANCE,
        0.05,
        "distanceNm",
      );
      for (const key of [
        "beatS",
        "motorS",
        "nightS",
        "beatAtNightS",
      ] as const) {
        expectWithinTolerance(
          actual.totals[key],
          golden.totals[key],
          DURATION_TOLERANCE,
          1800,
          `totals.${key}`,
        );
      }

      // Korridor på geometri.
      if (golden.track.length > 1 && actual.track.length > 1) {
        const deviation = corridorDeviationNm(actual.track, golden.track);
        expect(
          deviation,
          `${scenario.name}: sporet avviker ${deviation.toFixed(3)} nm fra golden-korridoren`,
        ).toBeLessThanOrEqual(CORRIDOR_NM);
      }
    }, 60_000);
  }

  it("alle scenarioer har en committet golden-fil", () => {
    if (UPDATE) return;
    for (const scenario of goldenScenarios()) {
      expect(
        existsSync(goldenPath(scenario.name)),
        `Mangler golden-fil for ${scenario.name}`,
      ).toBe(true);
    }
  });
});

describe("golden-ruter er deterministiske", () => {
  it("gir identisk resultat i to kjøringer for hvert scenario", () => {
    for (const scenario of goldenScenarios()) {
      const first = JSON.stringify(planRoute(scenario.input));
      const second = JSON.stringify(planRoute(scenario.input));
      expect(second, `${scenario.name} er ikke deterministisk`).toBe(first);
    }
  }, 120_000);
});

describe("sikkerhetsinvariant på golden-rutene", () => {
  it("hvert segment i en rute som ikke er «usikker-rute» består en uavhengig sjekk", () => {
    for (const scenario of goldenScenarios()) {
      const result = planRoute(scenario.input);
      if (result.safety.verdict === "usikker-rute") continue;
      const mask = scenario.input.mask;
      expect(mask).toBeDefined();
      if (mask === undefined) continue;
      for (const leg of result.legs) {
        const verdict = mask.segmentVerdict(
          leg.fromLat,
          leg.fromLon,
          leg.toLat,
          leg.toLon,
        );
        expect(
          verdict.passable,
          `${scenario.name}: segment ${leg.fromLat},${leg.fromLon} → ${leg.toLat},${leg.toLon} er ikke farbart`,
        ).toBe(true);
      }
    }
  }, 120_000);
});
