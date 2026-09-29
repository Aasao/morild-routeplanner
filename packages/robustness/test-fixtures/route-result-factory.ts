/**
 * Testfabrikk for `RouteResult` — KUN til bruk i `*.test.ts` i denne
 * pakken. Bygger et fullt, gyldig `RouteResult` (pluss `provenance`) som
 * kan overstyres punktvis, slik at hver test kan uttrykke akkurat den
 * variasjonen den handler om uten å gjenta alle 30+ feltene.
 *
 * Ikke eksportert fra `src/index.ts` — dette er testverktøy, ikke en del
 * av `@morild/robustness`s offentlige API.
 */
import type {
  AbortReason,
  ClearanceDiagnostics,
  RouteCoverage,
  RouteDiagnostics,
  RouteFinalLeg,
  RouteProvenance,
  RouteResult,
  RouteSafety,
  RouteStep,
  RouteTermination,
  RouteTotals,
} from "@morild/routing";


const BASE_EPOCH_S = 1_700_000_000;

export function makeStep(overrides: Partial<RouteStep> & { readonly tS: number }): RouteStep {
  return {
    lat: 59.1,
    lon: 10.9,
    epochS: BASE_EPOCH_S + overrides.tS,
    headingDeg: overrides.tS === 0 ? null : 180,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    twsKn: 10,
    twdDeg: 200,
    bspKn: 6,
    hsM: 0.5,
    flags: 0,
    flagNames: [],
    ...overrides,
  };
}

function makeClearanceDiagnostics(): ClearanceDiagnostics {
  return {
    gatePass: 0,
    gateMiss: 0,
    midpointChecks: 0,
    maxDepth: 0,
    clearanceCalls: 0,
    rejections: 0,
    exemptChords: 0,
    uncertified: 0,
  };
}

type PrunedDiagnostics = RouteDiagnostics["pruned"];

export interface DiagnosticsOverrides extends Partial<Omit<RouteDiagnostics, "pruned" | "termination">> {
  readonly pruned?: Partial<PrunedDiagnostics>;
  /**
   * D9.2 b-full (`RouteTermination`): denne fabrikken tar ikke stilling til
   * sertifikatregelen selv (§3.2 «Konsekvens for nevneren») — den er
   * `classifyMember`s ansvar. Default speiler `reached: true`-standarden;
   * tester som overstyrer `abortReason`/`safety.reachesDestination` bør
   * normalt overstyre `termination` til match, men `outcome.ts` leser i dag
   * ikke feltet, så et default-mismatch endrer ingen eksisterende testutfall.
   */
  readonly termination?: Partial<RouteTermination>;
}

function makeDiagnostics(overrides?: DiagnosticsOverrides): RouteDiagnostics {
  const { pruned: prunedOverrides, termination: terminationOverrides, ...rest } = overrides ?? {};
  const termination: RouteTermination = {
    kind: "reached",
    boundSource: null,
    prunedBound: 0,
    ...terminationOverrides,
  };
  const pruned: PrunedDiagnostics = {
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
    ...prunedOverrides,
  };
  return {
    iterations: 100,
    labelsCreated: 100,
    peakActiveLabels: 10,
    fieldCells: 0,
    tubBoundS: null,
    vmaxKn: 12,
    clearance: makeClearanceDiagnostics(),
    clearanceRecheck: makeClearanceDiagnostics(),
    ...rest,
    pruned,
    termination,
  };
}

function makeTotals(overrides?: Partial<RouteTotals>): RouteTotals {
  return {
    durationS: 3600 * 10,
    distanceNm: 60,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    beatAtNightS: 0,
    fuelL: 0,
    arrivalEpochS: BASE_EPOCH_S + 3600 * 10,
    daylightArrival: true,
    violatesDaylightRequirement: false,
    exceedsMaxContinuousLeg: false,
    ...overrides,
  };
}

function makeSafety(overrides?: Partial<RouteSafety>): RouteSafety {
  return {
    verdict: "trygt",
    reachesDestination: true,
    recheckPassed: true,
    failingSegments: [],
    flaggedSegments: [],
    ...overrides,
  };
}

/**
 * `searchWeather` følger `weather` når den ikke er oppgitt: for et ekte
 * søk er den søksbrede biten alltid minst like streng som rutens (ADR-0008),
 * så eldre tester som bare setter `weather` beholder sin betydning. Tester
 * for skillet (hull kun utenfor ruten) setter begge eksplisitt.
 */
function makeCoverage(overrides?: Partial<RouteCoverage>): RouteCoverage {
  const weather = overrides?.weather ?? "full";
  return {
    mask: "full",
    weather,
    searchWeather: weather,
    fieldUsed: false,
    weatherHeader: {
      formatVersion: "1.1.0",
      producedAt: "2026-09-01T00:00:00Z",
      model: "MEPS",
      init: "2026-09-01T00:00:00Z",
      resolution: "2.5km",
      sourceStatus: { status: "ok" },
    },
    chartSources: [],
    ...overrides,
  };
}

function makeFinalLeg(overrides?: Partial<RouteFinalLeg>): RouteFinalLeg {
  return {
    status: "lagt-til",
    reason: null,
    shortfallNm: 0,
    ...overrides,
  };
}

export interface RouteResultOverrides {
  readonly reached?: boolean;
  readonly abortReason?: AbortReason | null;
  readonly flags?: number;
  readonly flagNames?: readonly string[];
  readonly steps?: readonly RouteStep[];
  readonly totals?: Partial<RouteTotals>;
  readonly finalLeg?: Partial<RouteFinalLeg>;
  readonly safety?: Partial<RouteSafety>;
  readonly coverage?: Partial<RouteCoverage>;
  readonly diagnostics?: DiagnosticsOverrides;
  /** Tester for manglende/ugyldig provenance setter feltet med vilje — derfor bredere enn `RouteProvenance`. */
  readonly provenance?: RouteProvenance | string | undefined;
}

const DEFAULT_STEPS: readonly RouteStep[] = [
  makeStep({ tS: 0, lat: 59.1, lon: 10.9 }),
  makeStep({ tS: 3600 * 5, lat: 58.4, lon: 10.7 }),
  makeStep({ tS: 3600 * 10, lat: 57.72, lon: 10.58 }),
];

/**
 * Bygger et fullt, gyldig `RouteResult` med `provenance: "planRoute"` som
 * default — de aller fleste tester trenger kun å overstyre ett eller to
 * felt (typisk `provenance`, `safety.reachesDestination`,
 * `diagnostics.pruned.bound`, `coverage.weather` eller `abortReason`).
 */
export function makeRouteResult(overrides: RouteResultOverrides = {}): RouteResult {
  const steps = overrides.steps ?? DEFAULT_STEPS;
  const result: Omit<RouteResult, "provenance"> = {
    reached: overrides.reached ?? true,
    abortReason: overrides.abortReason ?? null,
    flags: overrides.flags ?? 0,
    flagNames: overrides.flagNames ?? [],
    legs: [],
    steps,
    totals: makeTotals(overrides.totals),
    finalLeg: makeFinalLeg(overrides.finalLeg),
    safety: makeSafety(overrides.safety),
    coverage: makeCoverage(overrides.coverage),
    alternatives: [],
    isochrones: [],
    diagnostics: makeDiagnostics(overrides.diagnostics),
  };
  // `?? "planRoute"` ville skjult forskjellen mellom "ikke oppgitt" og
  // "eksplisitt undefined" — testen for manglende provenance setter
  // `provenance: undefined` med vilje, og skal da IKKE falle tilbake til
  // defaulten.
  const provenance = "provenance" in overrides ? overrides.provenance : "planRoute";
  // Bevisst omgåelse av typen: fabrikken må kunne lage UGYLDIGE objekter
  // (manglende/ukjent provenance) for at avvisningstestene skal bevise noe.
  return { ...result, provenance } as unknown as RouteResult;
}
