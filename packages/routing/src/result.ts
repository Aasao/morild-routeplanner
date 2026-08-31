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

/**
 * Utfallet av den direkte sluttetappen (§5.8).
 *
 * Sluttetappen er en **etterbehandling**, ikke et søkesteg, og den kan avvises
 * av samme grunner som ethvert annet steg. Blir den avvist, stopper ruten et
 * stykke fra målet — og det skal stå eksplisitt, ikke utledes av at sporet ser
 * kort ut (N2 «ærlig degradering»).
 */
export type FinalLegStatus =
  /** Søket nådde aldri målet; `abortReason` forklarer hvorfor. */
  | "ikke-forsokt"
  /** Siste steg er allerede i mål (≤ 0,3 nm) — ingen etappe trengs. */
  | "ikke-nodvendig"
  | "lagt-til"
  /** `segmentVerdict` eller TSS-regelen avviste etappen. */
  | "avvist-farbarhet"
  /** Ingen vinddata i siste punkt, eller utenfor værfeltets tidsvindu. */
  | "avvist-vaer"
  /** TWS/Hs over båtens grenser i siste punkt. */
  | "avvist-baatgrenser"
  /** Båten gjør ikke framdrift mot målet på den kursen (typisk rent kryss). */
  | "avvist-fart";

export interface RouteFinalLeg {
  readonly status: FinalLegStatus;
  /** Menneskelesbar årsak ved avvisning, ellers `null`. */
  readonly reason: string | null;
  /**
   * Avstand fra rutens **siste** punkt til målet. 0 når etappen ble lagt til.
   * Er den > 0 med en `avvist-*`-status, ender ruten kort av målet.
   */
  readonly shortfallNm: number;
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
  /**
   * `requireDaylightArrival` er satt, men den **reelle** ankomsttiden — altså
   * inkludert den direkte sluttetappen (§5.8) — faller utenfor dagslysvinduet.
   *
   * Søkets dagslyssjekk (§5.3 steg 16) måler på etiketten *før* sluttetappen
   * er lagt på, og kan derfor slippe gjennom en rute som i virkeligheten
   * ankommer etter mørkets frembrudd. Rekonstruksjonen velger primærrute blant
   * de ikke-dominerte kandidatene som **både** når målet og fortsatt holder
   * kravet med reell ankomsttid; holder **ingen** av dem, returneres den best
   * rangerte likevel, men med dette flagget satt. Ruten skal da aldri
   * presenteres som at den oppfyller kravet.
   *
   * Flagget settes også når ruten ikke ender i målet
   * (`safety.reachesDestination === false`): kravet er «ankomst *i målet* i
   * dagslys», og en rute som stopper 1,5 nm unna har ikke oppfylt det,
   * uansett hvor lyst det er der den stoppet (funn 1, code-review runde 2
   * 2026-08-31).
   */
  readonly violatesDaylightRequirement: boolean;
  /** Etterfilter (spec §9 spm. 9): overskrider ruten mannskapstaket? */
  readonly exceedsMaxContinuousLeg: boolean;
}

export interface RouteSafety {
  /**
   * Kan linjen på kartet følges?
   *
   * **Kan aldri stå som `"trygt"` når `finalLeg.status` er en `avvist-*`-
   * status** (funn 1b, code-review runde 2 2026-08-31): da hevder `reached`
   * at målet er nådd samtidig som ruten stopper `shortfallNm` unna, og en
   * naiv konsument som bare ser på `verdict` ville presentert en avkortet
   * rute som en komplett, trygg rute. Verdikten gulves derfor til minst
   * `"usikkert"`. (For `"ikke-forsokt"` gjøres det ikke — der sier
   * `reached: false` allerede hele sannheten på toppnivå.)
   */
  readonly verdict: "trygt" | "usikkert" | "usikker-rute";
  /**
   * Ender ruten faktisk i målet? Sant kun når `finalLeg.status` er
   * `"lagt-til"` eller `"ikke-nodvendig"`.
   *
   * Dette er den boolske som nedstrøms kode skal spørre om «kom vi fram» —
   * ikke `reached`, som er søkets eget svar på det svakere spørsmålet «fant
   * søket en etikett innenfor `reachRadius`». De to kan være uenige, og når
   * de er det, er det denne som forteller sannheten (§5.8).
   */
  readonly reachesDestination: boolean;
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

/**
 * Kostnaden ved R3s korridorsjekk (§5.3.2). Instrumentert fordi
 * nettbrett-målingen (§7) skal kunne lese den i stedet for å gjette: holder
 * Lipschitz-gaten stort sett alene, eller bærer bisectionen kostnaden — og
 * hvor mange `clearanceNm`-kall koster det i praksis?
 */
export interface ClearanceDiagnostics {
  readonly gatePass: number;
  readonly gateMiss: number;
  readonly midpointChecks: number;
  readonly maxDepth: number;
  readonly clearanceCalls: number;
  readonly rejections: number;
  readonly exemptChords: number;
  readonly uncertified: number;
}

export interface RouteDiagnostics {
  readonly iterations: number;
  readonly labelsCreated: number;
  readonly peakActiveLabels: number;
  readonly fieldCells: number;
  readonly tubBoundS: number | null;
  readonly vmaxKn: number;
  /** Korridorsjekken i **søket** (§5.3 steg 13). */
  readonly clearance: ClearanceDiagnostics;
  /**
   * Korridorsjekken i den **autoritative stien**: konsolidering (§5.9),
   * sluttetappe (§5.8) og den uavhengige ettersjekken (§5.10). Holdt adskilt
   * fra søkets tall fordi de to har helt ulik skala — hundrevis av segmenter
   * mot hundretusenvis av kandidater.
   */
  readonly clearanceRecheck: ClearanceDiagnostics;
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
  /** Utfallet av den direkte sluttetappen (§5.8). */
  readonly finalLeg: RouteFinalLeg;
  readonly safety: RouteSafety;
  readonly coverage: RouteCoverage;
  readonly alternatives: readonly RouteAlternative[];
  readonly isochrones: readonly IsochroneSnapshot[];
  readonly diagnostics: RouteDiagnostics;
}
