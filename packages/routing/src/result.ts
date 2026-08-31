/**
 * Ut-kontrakten (docs/specs/rutemotor.md §4.8).
 *
 * `RouteResult` er **ren data** — ingen funksjoner, ingen sirkulære
 * referanser — slik at den kan structured-clones ut av en worker uten
 * spesialbehandling. Det er også det som gjør JSON-sammenligning til en
 * gyldig determinismetest.
 */
import type { PackageHeader } from "@morild/protocol";
import type { ChartSourceRef, Tillit } from "./contracts.js";
import type { CostVector } from "./cost.js";

export type AbortReason =
  | "stagnation"
  | "labelCap"
  | "iterationCap"
  | "noExpandableLabels"
  | "noWeatherAtStart"
  | "outsideDomain"
  | "callerStopped";

/** Ett rått tidssteg langs ruten. Grunnlaget for alle totaler. */
export interface RouteStep {
  readonly lat: number;
  readonly lon: number;
  /** Sekunder siden avgang. */
  readonly tS: number;
  readonly epochS: number;
  /** Kurs gjennom vannet inn til dette punktet; `null` i startpunktet. */
  readonly headingDeg: number | null;
  /** Akkumulert kryss-tid fram til dette punktet. Vokser monotont. */
  readonly beatS: number;
  /** Akkumulert motortid fram til dette punktet. Vokser monotont. */
  readonly motorS: number;
  /** Akkumulert natt-tid fram til dette punktet. Vokser monotont. */
  readonly nightS: number;
  readonly twsKn: number;
  readonly twdDeg: number;
  readonly bspKn: number;
  readonly hsM: number;
  readonly flags: number;
  readonly flagNames: readonly string[];
}

/** Konsolidert etappe (§5.9). Endrer aldri totalene. */
export interface RouteLeg {
  readonly fromLat: number;
  readonly fromLon: number;
  readonly toLat: number;
  readonly toLon: number;
  readonly headingDeg: number;
  readonly distanceNm: number;
  readonly startTS: number;
  readonly endTS: number;
  /** Sant for den direkte sluttetappen inn til målet (§5.8). */
  readonly direkteSlutt: boolean;
}

export interface SegmentRef {
  readonly legIndex: number;
  readonly fromLat: number;
  readonly fromLon: number;
  readonly toLat: number;
  readonly toLon: number;
  readonly tillit: Tillit;
  readonly reason: string;
}

export interface RouteTotals {
  readonly durationS: number;
  readonly distanceNm: number;
  readonly beatS: number;
  readonly motorS: number;
  readonly nightS: number;
  /**
   * «Kryss-timer i mørket» (F3.4). Beregnes fra `steps`, og er bevisst
   * **ikke** en femte dimensjon i Pareto-vektoren (besluttet 2026-08-30):
   * en femte dimensjon øker antall ikke-dominerte etiketter merkbart uten å
   * gi søket informasjon det ikke allerede har.
   */
  readonly beatAtNightS: number;
  readonly fuelL: number;
  readonly arrivalEpochS: number;
  readonly daylightArrival: boolean;
  /** Etterfilter (spec §9 spm. 9): overskrider ruten mannskapstaket? */
  readonly exceedsMaxContinuousLeg: boolean;
}

export interface RouteSafety {
  readonly verdict: "trygt" | "usikkert" | "usikker-rute";
  /** Resultatet av den uavhengige ettersjekken (§5.10). */
  readonly recheckPassed: boolean;
  readonly failingSegments: readonly SegmentRef[];
  readonly flaggedSegments: readonly SegmentRef[];
}

export interface RouteCoverage {
  readonly mask: "full" | "partial" | "none";
  readonly weather: "full" | "partial";
  readonly fieldUsed: boolean;
  readonly weatherHeader: PackageHeader;
  readonly chartSources: readonly ChartSourceRef[];
}

export interface RouteAlternative {
  readonly cost: CostVector;
  readonly arrivalEpochS: number;
  readonly distanceNm: number;
  readonly rankScore: number;
  readonly legs: readonly RouteLeg[];
}

export interface RouteDiagnostics {
  readonly iterations: number;
  readonly labelsCreated: number;
  readonly peakActiveLabels: number;
  readonly fieldCells: number;
  readonly tubBoundS: number | null;
  readonly vmaxKn: number;
  readonly pruned: {
    readonly dominated: number;
    readonly bound: number;
    readonly deadEnd: number;
    readonly hardConstraint: number;
    readonly capEvicted: number;
    readonly noWeather: number;
    readonly cone: number;
    readonly outsideDomain: number;
  };
}

export interface IsochroneSnapshot {
  readonly hours: number;
  readonly points: readonly { readonly lat: number; readonly lon: number }[];
}

export interface RouteResult {
  readonly reached: boolean;
  readonly abortReason: AbortReason | null;
  readonly legs: readonly RouteLeg[];
  readonly steps: readonly RouteStep[];
  readonly totals: RouteTotals;
  readonly safety: RouteSafety;
  readonly coverage: RouteCoverage;
  readonly alternatives: readonly RouteAlternative[];
  readonly isochrones: readonly IsochroneSnapshot[];
  readonly diagnostics: RouteDiagnostics;
}
