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

/**
 * **Hvor resultatet kommer fra** (`docs/specs/robusthet.md` §3.1 pkt. 1,
 * D8.8; ADR-0005s bekreftelseskrav gjort strukturelt).
 *
 * ADR-0005 sier at robusthetstall — gjennomførbarhetsandel, persentiler,
 * felle-sett — **kun** kan konstrueres fra fulle søk. Fram til nå var det en
 * regel håndhevet av importgrensen alene: `packages/robustness` får ikke
 * importere `variants.js`/`corridor.js`. Importgrensen fanger ikke et
 * `RouteResult` som *ble sendt* til robusthetslaget fra et lag som selv
 * hadde lov til å bygge det. Feltet gjør regelen strukturell: robusthet
 * avviser (kaster på) ethvert resultat som ikke bærer `"planRoute"` eller
 * `"createSearch"`.
 *
 *  - `"planRoute"` — satt av `planRoute` (§5.6). Ett fullt søk kjørt til ende.
 *  - `"createSearch"` — satt av `createSearch` (og `snapshot()`/`finish()` på
 *    den samme instansen). Det progressive API-et er samme søk, bare kjørt i
 *    porsjoner; et `snapshot()` er derfor ikke *ferdig*, men det er et fullt
 *    søks eget mellomresultat, og `abortReason`/`reached` sier hva det er.
 *  - `"buildResult"` — `reconstruct.ts`s `buildResult` kalt direkte med en
 *    håndbygget `ResultContext`. Det er *ikke* et fullt søk: tester og
 *    fiksturer setter arenaen selv. Verdien finnes for at slike resultater
 *    skal kunne skilles, ikke for at de skal telle.
 *
 * Merk at målevariantene i `variants.ts` (`planRouteScalar`,
 * `planRouteParetoReference`) går gjennom `planRoute` og bærer derfor
 * `"planRoute"`: de *er* fulle søk, bare med andre opsjoner. Det er
 * arkitekturtestens importgrense — ikke dette feltet — som holder
 * målevariantene borte fra robusthetstallene, nøyaktig som D8.8 beskriver
 * (feltet er et *tillegg* til importgrensen, ikke en erstatning).
 */
export type RouteProvenance = "planRoute" | "createSearch" | "buildResult";

export type AbortReason =
  | "stagnation"
  | "labelCap"
  | "iterationCap"
  | "noExpandableLabels"
  | "noWeatherAtStart"
  | "outsideDomain"
  | "callerStopped";

/**
 * **Hvorfor søket stoppet, som strukturert svar** (D9.2 b-full,
 * `docs/specs/robusthet.md` §7; formen er matematikerens, §4.1 i
 * `docs/research/ekspertpanel-d9-delt-tub-2026-09-05.md`).
 *
 * `abortReason` alene svarer ikke på spørsmålet robusthetslaget faktisk
 * stiller — «er dette et *bevis* på at strekket ikke lot seg seile i dette
 * været, eller ga søket bare opp?». `termination` deler svaret i fem
 * gjensidig utelukkende utfall:
 *
 *  - `"reached"` — målet ble nådd. (Om ruten *ender* i målet er et annet,
 *    strengere spørsmål: `safety.reachesDestination`, §5.8.)
 *  - `"exhausted"` — ingen utvidbare etiketter igjen
 *    (`noExpandableLabels`). Søket brukte opp rommet sitt uten å bli stoppet
 *    av noe tak. Dette er det **eneste** utfallet som kan bli et positivt
 *    sertifikat for ugjennomførbarhet, og bare under vilkårene under.
 *  - `"capped"` — `labelCap` eller `iterationCap`. Et budsjett tok slutt.
 *  - `"guard"` — `stagnation`. Vakten slo inn; søket kan ha hatt mer å gi.
 *  - `"aborted"` — `callerStopped`, `noWeatherAtStart`, `outsideDomain`,
 *    eller et resultat tatt ut av et søk som ennå ikke er ferdig
 *    (`snapshot()`). Ingenting er bevist.
 *
 * **Sertifikatregelen** (robusthet.md §3.2, «Konsekvens for nevneren»):
 * et medlem er bevist ugjennomførbart bare når
 *
 *     kind === "exhausted" && boundSource === null && prunedBound === 0
 *     && coverage.weather === "full" && !safety.reachesDestination
 *
 * Alt annet er «ikke avgjort». Merk at regelen krever `boundSource === null`
 * — altså at ingen Tub-bound i det hele tatt var i spill (`noTubBound`, §4.7,
 * eller ingen bound funnet). Det er strengere enn nødvendig når bounden
 * fantes uten å beskjære, og det er med vilje: en bound som ikke beskar
 * *denne* gangen kan ha formet søket på måter tellerne ikke ser.
 */
export type TerminationKind =
  | "reached"
  | "exhausted"
  | "capped"
  | "guard"
  | "aborted";

/**
 * Hvor Tub-bounden kom fra. `"shared"` = `RouteInput.tubBoundS` (kontrollens
 * bound), `"own"` = motorens grådige forhåndsrute (§5.5), `null` = ingen
 * bound: enten `RouteInput.noTubBound`, eller at forhåndsruten ikke nådde
 * målet (og da finnes det ingen bound å beskjære med).
 *
 * Feltet er **kilde, ikke bruk**: i `exactMode` er kilden `"own"` selv om
 * bounden aldri beskjærer. Om den faktisk beskar står i `prunedBound`.
 */
export type TubBoundSource = "shared" | "own" | null;

export interface RouteTermination {
  readonly kind: TerminationKind;
  readonly boundSource: TubBoundSource;
  /** Speiler `diagnostics.pruned.bound` — sertifikatet skal kunne leses alene. */
  readonly prunedBound: number;
}

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
  /**
   * Tub-bounden i sekunder, `null` når ingen bound var i spill.
   *
   * Rapporteres som **horisont, ikke sertifikat** (robusthet.md §3.2, D9.3):
   * den grådige forhåndsruten er en lovlig rute etter motorens skranker, men
   * den er ikke optimal, og `null` betyr bare at den ikke kom fram — ikke at
   * strekket er ugjennomførbart. `null` skiller heller ikke «slått av med
   * `noTubBound`» fra «fant ingen»: begge betyr at ingen bound beskar, og
   * det er det spørsmålet feltet finnes for å svare på. Hvem som slo den av
   * vet kalleren selv.
   */
  readonly tubBoundS: number | null;
  readonly vmaxKn: number;
  /** Hvorfor søket stoppet, strukturert (D9.2 b-full). Se `RouteTermination`. */
  readonly termination: RouteTermination;
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
    /** Sum av de seks `hardConstraint*`-tellerne under. Beholdt for kompatibilitet. */
    readonly hardConstraint: number;
    /**
     * Splitt av `hardConstraint` etter hvilken hard sjekk som avviste
     * kandidaten (nettbrett-målingen, steg3-plan §4 pkt. 2). Rekkefølgen
     * følger sjekkrekkefølgen i `expandLabel`/`tryHeading`.
     */
    readonly hardConstraintBoatLimits: number;
    readonly hardConstraintPoint: number;
    readonly hardConstraintClearance: number;
    readonly hardConstraintSegment: number;
    readonly hardConstraintTss: number;
    readonly hardConstraintDaylight: number;
    readonly capEvicted: number;
    readonly noWeather: number;
    /**
     * Delmengden av `noWeather` der tidspunktet lå **innenfor** værfeltets
     * gyldige tidsvindu, men feltet likevel ikke hadde vind i posisjonen
     * (D7.2). Det er signaturen til et hull i **flisdekningen** — til
     * forskjell fra at prognosehorisonten tok slutt, som er den forventede,
     * ufarlige delen av `noWeather`. Er den > 0, bærer ruten flagget
     * `VAERDEKNING_BEGRENSET` og `safety.verdict` kan ikke være `"trygt"`.
     */
    readonly noWeatherInWindow: number;
    readonly cone: number;
    readonly outsideDomain: number;
  };
}

export interface IsochroneSnapshot {
  readonly hours: number;
  readonly points: readonly { readonly lat: number; readonly lon: number }[];
}

export interface RouteResult {
  /**
   * Hvem som bygget resultatet. Settes KUN av `planRoute`/`createSearch`;
   * alt annet er `"buildResult"`. Se `RouteProvenance`.
   */
  readonly provenance: RouteProvenance;
  readonly reached: boolean;
  readonly abortReason: AbortReason | null;
  /**
   * **Rute-nivå flagg** (D7.2) — samme bit-vokabular som `RouteStep.flags`
   * (`FLAG_NAMES` i `cost.ts`), men om ruten som helhet. Et rute-flagg
   * beskriver noe som skjedde med *søket*, ikke med et punkt på linjen, og
   * kan derfor ikke bo på et steg: `VAERDEKNING_BEGRENSET` handler nettopp om
   * etiketter som ble forkastet og altså aldri ble til et steg.
   *
   * Unntak (D15.2, `docs/specs/strom-produsent.md` §4b): `STROM_KYSTSONE`
   * står BÅDE per steg og her, som OR over stegene — så UI-et kan si det om
   * ruten uten å lete gjennom stegene. Samme for `BOLGE_PUNKT_KATEGORI_*`
   * (`docs/specs/punktbolge.md` §4).
   */
  readonly flags: number;
  /** Flaggnavn i `FLAG_NAMES`-rekkefølge — determinisme også i rapporteringen. */
  readonly flagNames: readonly string[];
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
