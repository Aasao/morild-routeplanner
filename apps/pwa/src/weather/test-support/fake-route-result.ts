/**
 * Delte testattrapper: en minimal, gyldig `RouteResult` og en pakke-header.
 * Flyttet ut av `ensemble.test.ts` så måleprogrammets tester kan bruke
 * samme fikstur (ingen ny sannhet om hvordan et resultat ser ut).
 */
import type { PackageHeader } from "@morild/protocol";
import type { RouteResult } from "@morild/routing";

export const HEADER: PackageHeader = {
  formatVersion: "1.0.0",
  producedAt: "2026-09-03T00:00:00Z",
  model: "MEPS",
  init: "2026-09-03T00:00:00Z",
  resolution: "2.5km",
  sourceStatus: { status: "ok" },
};

/** Minimal, gyldig `RouteResult` — kun feltene klassifiseringen/aggregeringen faktisk ser er variert per test. */
export function fakeResult(overrides: {
  readonly weatherCoverage?: "full" | "partial";
  readonly reachesDestination?: boolean;
  readonly durationS?: number;
  /** Antall syntetiske steg (orakelet krever ≥ 2 veipunkter). */
  readonly steps?: number;
}): RouteResult {
  const durationS = overrides.durationS ?? 12 * 3600;
  return {
    provenance: "planRoute",
    reached: overrides.reachesDestination ?? true,
    abortReason: null,
    // Rute-nivå flagg (D7.2) — tomt i den minimale fiksturen.
    flags: 0,
    flagNames: [],
    legs: [],
    steps: Array.from({ length: overrides.steps ?? 0 }, (_, i) => ({
      lat: 59 - i * 0.1,
      lon: 10.5,
      tS: i * 1800,
      epochS: i * 1800,
      headingDeg: 180,
      flags: 0,
    })) as unknown as RouteResult["steps"],
    totals: {
      durationS,
      distanceNm: 87,
      beatS: 0,
      motorS: 0,
      nightS: 0,
      beatAtNightS: 0,
      fuelL: 0,
      arrivalEpochS: 1_700_000_000 + durationS,
      daylightArrival: true,
      violatesDaylightRequirement: false,
      exceedsMaxContinuousLeg: false,
    },
    finalLeg: { status: "ikke-nodvendig", reason: null, shortfallNm: 0 },
    safety: {
      verdict: "trygt",
      reachesDestination: overrides.reachesDestination ?? true,
      recheckPassed: true,
      failingSegments: [],
      flaggedSegments: [],
    },
    coverage: {
      mask: "full",
      weather: overrides.weatherCoverage ?? "full",
      fieldUsed: true,
      weatherHeader: HEADER,
      chartSources: [],
    },
    alternatives: [],
    isochrones: [],
    diagnostics: {
      termination: { kind: "reached", boundSource: null, prunedBound: 0 },
      iterations: 0,
      labelsCreated: 0,
      peakActiveLabels: 0,
      fieldCells: 0,
      tubBoundS: null,
      vmaxKn: 0,
      clearance: {
        gatePass: 0,
        gateMiss: 0,
        midpointChecks: 0,
        maxDepth: 0,
        clearanceCalls: 0,
        rejections: 0,
        exemptChords: 0,
        uncertified: 0,
      },
      clearanceRecheck: {
        gatePass: 0,
        gateMiss: 0,
        midpointChecks: 0,
        maxDepth: 0,
        clearanceCalls: 0,
        rejections: 0,
        exemptChords: 0,
        uncertified: 0,
      },
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
    },
  };
}
