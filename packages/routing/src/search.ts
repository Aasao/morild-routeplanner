/**
 * Isokron-søket (docs/specs/rutemotor.md §5.2, §5.6).
 *
 * Steg-vis og **synkront**: motoren yielder aldri selv. v1 gjorde
 * `await new Promise(r => setTimeout(r, 0))` hver 20. iterasjon for å holde
 * UI levende; i v2 er det kallerens ansvar, via `advance()`. Det er et
 * bevisst v1-avvik og forutsetningen for at motoren kan være helt fri for
 * `await`, timere og klokke.
 *
 * Label-setting, ikke label-correcting: `tS` vokser monotont langs enhver
 * sti (`tS_barn = tS_forelder + timeStep + straff ≥ tS_forelder`), fordi
 * ingen kostnadskomponent kan bli negativ. Den invarianten enhetstestes.
 */
import type { LatLon } from "@morild/geo";
import { angDiff, bearing, haversineNm } from "@morild/geo";
import { LabelArena } from "./arena.js";
import type {
  BoatModel,
  NavigabilityMask,
  WeatherField,
} from "./contracts.js";
import { maskAsEdgeGate, OPEN_EDGE_GATE } from "./contracts.js";
import type { CorridorStats } from "./clearance.js";
import {
  checkClearanceCorridor,
  createCorridorStats,
  requiredClearanceNm,
} from "./clearance.js";
import type { CostVector } from "./cost.js";
import {
  FLAG_USIKKER_TILLIT,
  NEUTRAL_SEARCH_WEIGHTS,
  ZERO_COST,
} from "./cost.js";
import { daylightArrival } from "./daylight.js";
import { buildDistanceField, DistanceField } from "./distance-field.js";
import { CellGrid, courseSector, NO_COURSE, stateKeyOf } from "./domain.js";
import type { NodeEnvironment } from "./expand.js";
import {
  accumulateSoft,
  checkHardNode,
  checkSegment,
  checkTssStep,
  environmentAt,
  environmentDataFlags,
  softContribution,
  stepKinematics,
} from "./expand.js";
import { LabelStore, UNCAPPED } from "./label-store.js";
import type { RouteOptions } from "./options.js";
import { withDefaults } from "./options.js";
import { buildResult, type ResultContext } from "./reconstruct.js";
import type {
  AbortReason,
  IsochroneSnapshot,
  RouteProvenance,
  RouteResult,
  TubBoundSource,
} from "./result.js";
import type { Tack } from "./tack.js";
import { tackOf, tackPenaltyS } from "./tack.js";

export interface RouteInput {
  readonly start: LatLon;
  readonly dest: LatLon;
  /** UTC-sekunder. Kommer alltid inn som parameter — aldri fra klokka. */
  readonly departEpochS: number;
  readonly weather: WeatherField;
  /** `undefined` ⇒ degradert modus: aldri «trygt» som dom (§6). */
  readonly mask: NavigabilityMask | undefined;
  readonly boat: BoatModel;
  /**
   * Delt A\*-felt (§5.5). Bygges hvis det ikke oppgis — men da per kjøring.
   * Bygg det med `buildFieldForInput`, aldri med håndplukkede parametre:
   * bit-identiteten med et søk som bygger sitt eget hviler på at det er
   * nøyaktig samme kall. Overføres mellom workere som `field.data`
   * (`DistanceFieldData`), ikke som `SharedArrayBuffer`.
   */
  readonly field?: DistanceField | undefined;
  /**
   * Delt Tub-bound fra kontrollmedlemmet.
   *
   * **Kun myk skranke** (robusthet.md §4.1, D8.2): et medlem som terminerer
   * uten `safety.reachesDestination` mens `diagnostics.pruned.bound > 0` er
   * IKKE bevist ugjennomførbart — bounden kan ha kuttet den ruten som fantes.
   * Kalleren skal da kjøre medlemmet om **uten** bound før det klassifiseres.
   * Gis aldri til R2/bail-out-søk.
   */
  readonly tubBoundS?: number | undefined;
  /**
   * **Slår av Tub-bound-beskjæringen helt** (D9.2 b-full, robusthet.md §7).
   *
   * Dette er omkjøringsveien §4.1s ventil trenger: terminerer et medlem uten
   * `safety.reachesDestination` mens `diagnostics.pruned.bound > 0`, er det
   * ikke bevist ugjennomførbart, og medlemmet skal kjøres om **uten** bound
   * før det klassifiseres. Fram til nå fantes ingen slik bryter for motorens
   * *egen* bound — bare `exactMode`, som i tillegg slår av etikett-takene og
   * stagnasjonsvakten og dermed endrer helt andre ting enn beskjæringen.
   *
   * Med `noTubBound: true`:
   *  - den grådige forhåndsruten kjøres ikke, ingen bound settes,
   *  - `diagnostics.tubBoundS === null` og `diagnostics.pruned.bound === 0`,
   *  - `diagnostics.termination.boundSource === null` — som er det
   *    `exhausted` trenger for å være et *positivt* sertifikat for
   *    ugjennomførbarhet,
   *  - **etikett-tak og stagnasjonsvakt står som før.** Omkjøringen er
   *    «samme søk uten bound», ikke et referansesøk.
   *
   * Kombinert med `tubBoundS` er det en motstridende bestilling (slå av og
   * oppgi den samme bounden) og kaster — vi overstyrer ikke stille.
   */
  readonly noTubBound?: boolean | undefined;
  readonly options?: Partial<RouteOptions> | undefined;
}

export interface SearchProgress {
  readonly done: boolean;
  readonly iterations: number;
  readonly bestDistanceNm: number;
  readonly labels: number;
}

export interface Search {
  advance(maxIterations: number): SearchProgress;
  snapshot(): RouteResult;
  finish(): RouteResult;
  stop(): void;
}

interface PrunedCounters {
  dominated: number;
  bound: number;
  deadEnd: number;
  /** Sum av `hardConstraint*`-tellerne under (§4 pkt. 2, nettbrett-målingen). */
  hardConstraint: number;
  hardConstraintBoatLimits: number;
  hardConstraintPoint: number;
  hardConstraintClearance: number;
  hardConstraintSegment: number;
  hardConstraintTss: number;
  hardConstraintDaylight: number;
  capEvicted: number;
  noWeather: number;
  /** Delmengden av `noWeather` med hull i FLISDEKNINGEN, ikke horisont-slutt (D7.2). */
  noWeatherInWindow: number;
  cone: number;
  outsideDomain: number;
}

/**
 * Klaringscache per celle: **hvor** tallet ble målt, ikke bare verdien — se
 * `clearanceAt` for hvorfor posisjonen er nødvendig for at cachen skal være
 * en gyldig nedre skranke.
 *
 * Søket og den grådige Tub-forhåndsruten (§5.5) har **hver sin** cache. Et
 * cachet tall er en gyldig, men mulig svakere, nedre skranke enn et ferskt
 * oppslag i punktet, så en cache varmet opp av forhåndsruten kunne endret
 * hvilke korder søkets Lipschitz-gate klarer å sertifisere uten bisection.
 * Det ville gjort forhåndsruten til en usynlig input til søket. Prisen er
 * noen titalls ekstra `clearanceNm`-kall; gevinsten er at forhåndsruten
 * beviselig ikke kan flytte en eneste rute.
 */
type ClearanceCache = Map<
  number,
  { readonly lat: number; readonly lon: number; readonly valueNm: number }
>;

/** Øker både totalen og den navngitte delkategorien i ett kall. */
function bumpHardConstraint(
  pruned: PrunedCounters,
  key:
    | "hardConstraintBoatLimits"
    | "hardConstraintPoint"
    | "hardConstraintClearance"
    | "hardConstraintSegment"
    | "hardConstraintTss"
    | "hardConstraintDaylight",
): void {
  pruned.hardConstraint++;
  pruned[key]++;
}

class RouteSearch implements Search {
  private readonly provenance: RouteProvenance;
  private readonly input: RouteInput;
  private readonly opts: RouteOptions;
  private readonly grid: CellGrid;
  private readonly arena: LabelArena;
  private readonly store: LabelStore;
  private readonly headings: readonly number[];
  private readonly reachRadiusNm: number;
  private readonly directDistanceNm: number;
  private readonly bearingStartDest: number;

  private field: DistanceField | undefined;
  private fieldUsed = false;
  private vmaxKn = 0;
  private tubBoundS: number | null = null;
  /**
   * Hvor bounden kom fra — **kilde, ikke bruk** (D9.2 b-full). `"own"` står
   * også når `exactMode` gjør at bounden aldri beskjærer; om den faktisk
   * beskar sier `pruned.bound`. Sertifikatregelen i §5.13 krever `null`, og
   * er dermed konservativ i den retningen som ikke kan lyve.
   */
  private boundSource: TubBoundSource = null;

  private frontier: number[] = [];
  private iterations = 0;
  private bestIndex = 0;
  private bestDistanceNm = Infinity;
  private lastImprovementIter = 0;
  private lastSnapshotHours = 0;
  private readonly reachedIndices: number[] = [];
  private readonly isochrones: IsochroneSnapshot[] = [];
  /** Søkets egen klaringscache. Se `ClearanceCache` og `clearanceAt`. */
  private readonly clearanceCache: ClearanceCache = new Map();
  /** `maxNm` alle klaringsoppslag i søket gjøres med. Se `computeClearanceCap`. */
  private clearanceCapNm = 0;
  private readonly clearanceStats: CorridorStats = createCorridorStats();

  private peakActiveLabels = 0;
  private weatherPartial = false;
  private done = false;
  private reached = false;
  private stopRequested = false;
  private abortReason: AbortReason | null = null;

  private readonly pruned: PrunedCounters = {
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
  };

  constructor(input: RouteInput, provenance: RouteProvenance) {
    if (input.noTubBound === true && input.tubBoundS !== undefined) {
      throw new Error(
        "noTubBound=true sammen med tubBoundS er en motstridende bestilling: " +
          "den ene slår av Tub-beskjæringen, den andre oppgir bounden som " +
          "skal beskjære. Ingen av dem overstyres stille (D9.2)",
      );
    }
    this.provenance = provenance;
    this.input = input;
    this.opts = withDefaults(input.options ?? {});
    this.grid = new CellGrid(this.opts.domain, this.opts.cellDeg);
    this.arena = new LabelArena(this.opts.maxTotalLabels);
    this.store = new LabelStore(
      this.arena,
      this.opts.exactMode
        ? UNCAPPED
        : {
            maxLabelsPerState: this.opts.maxLabelsPerState,
            maxLabelsPerCell: this.opts.maxLabelsPerCell,
          },
      // Faste, nøytrale vekter: brukerens vekter styrer aldri hvilke
      // etiketter som overlever søket, bare rangeringen til slutt.
      NEUTRAL_SEARCH_WEIGHTS,
    );

    const headings: number[] = [];
    for (let h = 0; h < 360; h += this.opts.headingStepDeg) headings.push(h);
    this.headings = headings;

    // v1s formel, beholdt.
    this.reachRadiusNm = Math.max(2.0, (this.opts.timeStepS / 3600) * 4 * 0.5);
    this.directDistanceNm = haversineNm(input.start, input.dest);
    this.bearingStartDest = bearing(input.start, input.dest);
    this.bestDistanceNm = this.directDistanceNm;

    this.initialise();
  }

  // ---------------------------------------------------------------- oppstart

  private initialise(): void {
    const { start, dest, weather, departEpochS } = this.input;

    const startCell = this.grid.keyOf(start.lat, start.lon);
    const destCell = this.grid.keyOf(dest.lat, dest.lon);
    if (startCell === undefined || destCell === undefined) {
      this.fail("outsideDomain");
      return;
    }

    if (weather.wind(start.lat, start.lon, departEpochS) === undefined) {
      this.fail("noWeatherAtStart");
      return;
    }

    this.setUpField();
    this.computeVmax();
    this.computeClearanceCap();
    this.computeTubBound();

    const startState = stateKeyOf(startCell, NO_COURSE);
    const outcome = this.store.insert({
      lat: start.lat,
      lon: start.lon,
      cost: ZERO_COST,
      headingDeg: 0,
      sector: NO_COURSE,
      tack: 0,
      parent: -1,
      flags: 0,
      cellKey: startCell,
      stateKey: startState,
      remainingNm:
        this.field?.atOrNear(start.lat, start.lon) ?? haversineNm(start, dest),
      // Startetiketten er `d(A)` for første steg og må måles som alle andre.
      clearanceNm:
        this.input.mask !== undefined && this.opts.minOffingNm > 0
          ? this.input.mask.clearanceNm(
              start.lat,
              start.lon,
              this.clearanceCapNm,
            )
          : Number.POSITIVE_INFINITY,
      twsKn: 0,
      twdDeg: 0,
      bspKn: 0,
      hsM: 0,
    });
    if (outcome.kind !== "inserted") {
      this.fail("labelCap");
      return;
    }
    this.bestIndex = outcome.index;
    this.frontier = [outcome.index];
  }

  private fail(reason: AbortReason): void {
    this.abortReason = reason;
    this.done = true;
  }

  private setUpField(): void {
    // Nøyaktig samme kall som `buildFieldForInput` — én implementasjon, slik
    // at et felt bygget utenfor motoren er bit-identisk med det motoren
    // ville bygget selv (§5.5, robusthet.md §4.1).
    this.field = buildFieldForInput(this.input);
    // v1-adferd: er selv 3×3 rundt start unåelig, slås feltet AV for hele
    // kjøringen. Det er en ærlig degradering med ytelseskostnad (§6), ikke
    // en feil — men både blindvei-pruning og Tub-bound bortfaller.
    if (
      this.field !== undefined &&
      this.field.atNear(this.input.start.lat, this.input.start.lon) ===
        undefined
    ) {
      this.field = undefined;
    }
    this.fieldUsed = this.field !== undefined;
  }

  /**
   * Stram, men gyldig, øvre fartsgrense: maks polarfart ved den sterkeste
   * vinden i selve værfeltet, pluss maks strøm. Brukes bare til å gjøre
   * restestimatet admissibelt.
   */
  private computeVmax(): void {
    const { weather, boat } = this.input;
    const twsCap = Math.min(weather.maxTwsKn, boat.maxTwsKn);
    let maxPolar = 0;
    for (let twa = 0; twa <= 180; twa += 5) {
      const v = boat.boatSpeedKn(twsCap, twa);
      if (v > maxPolar) maxPolar = v;
    }
    const motor = boat.motorThresholdKn > 0 ? boat.motorSpeedKn : 0;
    this.vmaxKn = Math.max(maxPolar, motor) + weather.maxCurrentKn + 0.3;
  }

  /**
   * `maxNm` for alle klaringsoppslag i denne kjøringen.
   *
   * R3-gaten kan aldri passere hvis klaringstallet er avkortet under
   * `krav + L/2` (`clearance.ts`). Vi velger derfor ett fast tak som er en
   * øvre skranke for `krav + L` i *ethvert* steg:
   *
   *   krav ≤ minOffing + seaState·boat.maxHsM   (høyere Hs forkaster noden)
   *   L    ≤ Vmax · timeStep                    (Vmax er øvre fartsgrense)
   *
   * Fast tak er også det som gjør cellecachen brukbar: ett tall per celle,
   * gyldig uansett bølgehøyde.
   */
  private computeClearanceCap(): void {
    const { boat } = this.input;
    const maxStepNm = (this.vmaxKn * this.opts.timeStepS) / 3600;
    this.clearanceCapNm =
      this.opts.minOffingNm +
      this.opts.seaStateOffingNmPerM * boat.maxHsM +
      maxStepNm;
  }

  /**
   * Klaringen i et punkt, som en **gyldig nedre skranke**.
   *
   * v1s mønster (arvet inn i v2 fram til 2026-08-31) var å cache klaringen per
   * celle og gjenbruke den rått for alle punkter i cellen. Det er usunt: med
   * `cellDeg = 0,02` er to punkter i samme celle opptil ~1,2 nm fra hverandre,
   * og naboens klaringstall kan da *overestimere* klaringen i punktet vi
   * faktisk spør om — nøyaktig den typen stille lekkasje R3 handler om.
   *
   * Fiksen bruker den samme Lipschitz-egenskapen som gaten: klaringen er
   * 1-Lipschitz, så `d(p) ≥ d(q) − |pq|` for et vilkårlig nabooppslag q.
   * Holder den korrigerte skranken alene til å bære gaten
   * (`≥ krav + L/2`), bruker vi den gratis; ellers måler vi eksakt i punktet
   * og oppdaterer cachen. Nær land måler vi altså alltid; på åpent hav — der
   * de aller fleste kandidatene ligger — slipper vi oppslaget.
   */
  private clearanceAt(
    mask: NavigabilityMask,
    cellKey: number,
    point: LatLon,
    sufficientNm: number,
    cache: ClearanceCache,
    stats: CorridorStats,
  ): number {
    const cached = cache.get(cellKey);
    if (cached !== undefined) {
      const bound = cached.valueNm - haversineNm(cached, point);
      if (bound >= sufficientNm) return bound;
    }
    const valueNm = mask.clearanceNm(point.lat, point.lon, this.clearanceCapNm);
    stats.clearanceCalls++;
    cache.set(cellKey, {
      lat: point.lat,
      lon: point.lon,
      valueNm,
    });
    return valueNm;
  }

  /**
   * Øvre tidsgrense fra en grådig forhåndsrute mot feltets gradient
   * (15°-kursoppløsning, som v1), eller mottatt ferdig fra kalleren — delt
   * bound på tvers av ensemble-medlemmer.
   *
   * **Skrankekomplett fra 2026-09-05 (D9.3).** Bounden er bare gyldig hvis
   * den grådige ruten selv er en **lovlig** rute: er den ulovlig, er tiden
   * dens ikke en øvre skranke for det skrankede optimum, og beskjæringen i
   * §5.3 steg 10 kan kutte den beste lovlige ruten. Panelets matematiker
   * fant at forhåndsruten sjekket vær, harde båtgrenser, maske og TSS — men
   * ikke klaringskorridoren (R3) og ikke dagslyskravet. Begge er nå med, med
   * **nøyaktig samme kall** som søket bruker (`checkClearanceCorridor`,
   * `daylightArrival`); ett sted å endre semantikken, ikke to.
   *
   * Retningen er trygg: flere avviste kandidater ⇒ oftere ingen bound
   * (`tubBoundS = null`) ⇒ mindre beskjæring, aldri mer.
   *
   * Mellomliggende **veipunkter** er den tredje skranken panelet nevnte.
   * `RouteInput` har ingen: en tur med veipunkter kjøres som flere søk
   * etter hverandre, og hvert delsøk har start og mål som endepunkter.
   * Punktet er dermed uten innhold i v2.0 og noteres her i stedet for å
   * kodes.
   */
  private computeTubBound(): void {
    // D9.2 b-full: eksplisitt av. Ingen bound, ingen kilde, ingen
    // beskjæring — men etikett-tak og stagnasjonsvakt står.
    if (this.input.noTubBound === true) return;
    if (this.input.tubBoundS !== undefined) {
      this.tubBoundS = this.input.tubBoundS;
      this.boundSource = "shared";
      return;
    }
    const field = this.field;
    if (field === undefined) return;

    const { start, dest, boat, departEpochS, mask } = this.input;
    const opts = this.opts;
    // Egen cache og egne tellere: forhåndsruten skal ikke kunne påvirke
    // søkets korridorsjekk (se `ClearanceCache`) og heller ikke blande seg
    // inn i `diagnostics.clearance`, som måler søket.
    const cache: ClearanceCache = new Map();
    const stats = createCorridorStats();
    const useClearance = mask !== undefined && opts.minOffingNm > 0;

    let pos: LatLon = { lat: start.lat, lon: start.lon };
    let posClearanceNm = useClearance
      ? mask.clearanceNm(start.lat, start.lon, this.clearanceCapNm)
      : Number.POSITIVE_INFINITY;
    let tS = 0;
    let headingDeg: number | null = null;

    for (let step = 0; step < 600; step++) {
      const epochS = departEpochS + tS;
      const env = this.environmentAt(pos, epochS);
      if (env === undefined) return;
      if (!checkHardNode(env, boat).ok) return;
      const dHere = field.atOrNear(pos.lat, pos.lon);
      if (dHere === undefined) return;

      let best:
        | {
            next: LatLon;
            tS: number;
            headingDeg: number;
            gain: number;
            clearanceNm: number;
          }
        | undefined;
      for (let h = 0; h < 360; h += 15) {
        const kin = stepKinematics(pos, h, env, boat, opts.timeStepS);
        if (kin === undefined) continue;
        const next = kin.next;
        const dNext = field.atOrNear(next.lat, next.lon);
        if (dNext === undefined) continue;
        // Samme rekkefølge som §5.3: domene, klaring, segment, TSS, dagslys.
        const cellKey = this.grid.keyOf(next.lat, next.lon);
        if (cellKey === undefined) continue;

        let clearanceNm = Number.POSITIVE_INFINITY;
        if (useClearance) {
          const hsM = env.waves?.hsM;
          const requiredNm = requiredClearanceNm(
            opts.minOffingNm,
            hsM,
            opts.seaStateOffingNmPerM,
          );
          const corridor = checkClearanceCorridor({
            mask,
            from: pos,
            to: next,
            fromClearanceNm: posClearanceNm,
            toClearanceNm: this.clearanceAt(
              mask,
              cellKey,
              next,
              requiredNm + kin.distanceNm / 2,
              cache,
              stats,
            ),
            chordNm: kin.distanceNm,
            hsM,
            ends: { start, dest },
            params: opts,
            queryCapNm: this.clearanceCapNm,
            stats,
          });
          if (!corridor.check.ok) continue;
          clearanceNm = corridor.toClearanceNm;
        }

        if (
          !checkSegment(mask, pos, next).ok ||
          !checkTssStep(mask, pos, next, opts.tssParams).check.ok
        ) {
          continue;
        }
        const penaltyS =
          headingDeg === null
            ? 0
            : tackPenaltyS(
                headingDeg,
                h,
                tackOf(headingDeg, env.wind.fromDeg, opts.beatTwaDeg),
                tackOf(h, env.wind.fromDeg, opts.beatTwaDeg),
                env.wind.speedKn,
                opts.tackParams,
              );
        const nextTS = tS + opts.timeStepS + penaltyS;
        // Dagslyskravet gjelder ankomsten, og måles — som i §5.3 steg 16 —
        // på kandidaten som faktisk er innenfor `reachRadius` av målet.
        if (
          opts.requireDaylightArrival &&
          haversineNm(next, dest) < this.reachRadiusNm &&
          !daylightArrival(dest.lat, dest.lon, departEpochS + nextTS).isDaylight
        ) {
          continue;
        }
        const gain = dHere - dNext;
        if (best === undefined || gain > best.gain) {
          best = { next, tS: nextTS, headingDeg: h, gain, clearanceNm };
        }
      }
      if (best === undefined || best.gain <= 0.01) return;
      pos = best.next;
      posClearanceNm = best.clearanceNm;
      tS = best.tS;
      headingDeg = best.headingDeg;
      if (haversineNm(pos, dest) < this.reachRadiusNm) {
        this.tubBoundS = tS;
        this.boundSource = "own";
        return;
      }
    }
  }

  /**
   * Miljøoppslaget deles med evaluatoren og sluttetappen (`expand.ts`); det
   * eneste søket legger på er bokføringen av delvis værdekning.
   *
   * `weatherPartial` er **søksbred** (`coverage.searchWeather`, ADR-0008):
   * den settes av ethvert oppslag — også den grådige forhåndsruten, dominerte
   * etiketter og noder langt fra den leverte ruten. Den er grunnlaget for
   * ugjennomførbar-sertifikatet, der en beskjæring gjort av en etikett uten
   * fullt felt kan ha brutt beviset. Rutens egen dekning leses av stegenes
   * flagg (`environmentDataFlags`), ikke herfra.
   */
  private environmentAt(
    pos: LatLon,
    epochS: number,
  ): NodeEnvironment | undefined {
    const env = environmentAt(this.input.weather, pos, epochS);
    if (env === undefined) return undefined;
    if (env.waves === undefined || env.current === undefined) {
      this.weatherPartial = true;
    }
    return env;
  }

  // ------------------------------------------------------------- hovedløkken

  advance(maxIterations: number): SearchProgress {
    for (let i = 0; i < maxIterations && !this.done; i++) {
      this.runOneIteration();
    }
    return this.progress();
  }

  private progress(): SearchProgress {
    return {
      done: this.done,
      iterations: this.iterations,
      bestDistanceNm: this.bestDistanceNm,
      labels: this.arena.count,
    };
  }

  private runOneIteration(): void {
    if (this.stopRequested) {
      this.fail("callerStopped");
      return;
    }
    if (this.iterations >= this.opts.maxIterations) {
      this.fail("iterationCap");
      return;
    }
    this.iterations++;

    const created: number[] = [];
    for (const index of this.frontier) {
      this.expandLabel(index, created);
    }

    if (created.length === 0) {
      this.fail("noExpandableLabels");
      return;
    }
    if (this.arena.isFull) {
      this.fail("labelCap");
      return;
    }

    let improved = false;
    for (const index of created) {
      const dist = haversineNm(
        { lat: this.arena.lat[index]!, lon: this.arena.lon[index]! },
        this.input.dest,
      );
      if (dist < this.bestDistanceNm) {
        this.bestDistanceNm = dist;
        this.bestIndex = index;
        improved = true;
      }
      if (dist < this.reachRadiusNm) this.reachedIndices.push(index);
    }
    if (improved) this.lastImprovementIter = this.iterations;

    this.captureIsochrone(created);

    const active = this.store.activeLabels;
    if (active > this.peakActiveLabels) this.peakActiveLabels = active;

    if (this.bestDistanceNm < this.reachRadiusNm) {
      this.reached = true;
      this.done = true;
      return;
    }

    // Stagnasjonsvakten er tapsgivende og står derfor av i referansemodus.
    if (
      !this.opts.exactMode &&
      this.iterations - this.lastImprovementIter >
        this.opts.stagnationIterations
    ) {
      this.fail("stagnation");
      return;
    }

    this.frontier = created.filter((index) => this.store.isActive(index));
    if (this.frontier.length === 0) this.fail("noExpandableLabels");
  }

  private captureIsochrone(created: readonly number[]): void {
    const hours = (this.iterations * this.opts.timeStepS) / 3600;
    if (
      hours - this.lastSnapshotHours <
      this.opts.isochroneSnapshotHours - 1e-9
    ) {
      return;
    }
    this.lastSnapshotHours = hours;
    const points = created.map((index) => ({
      lat: this.arena.lat[index]!,
      lon: this.arena.lon[index]!,
      brg: bearing(this.input.start, {
        lat: this.arena.lat[index]!,
        lon: this.arena.lon[index]!,
      }),
      index,
    }));
    // Total komparator: peiling, så lat/lon, så arena-indeks (alltid unik).
    points.sort((a, b) => {
      if (a.brg !== b.brg) return a.brg - b.brg;
      if (a.lat !== b.lat) return a.lat - b.lat;
      if (a.lon !== b.lon) return a.lon - b.lon;
      return a.index - b.index;
    });
    this.isochrones.push({
      hours,
      points: points.map((p) => ({ lat: p.lat, lon: p.lon })),
    });
  }

  // ------------------------------------------------------- ekspansjonssteget

  private expandLabel(index: number, created: number[]): void {
    const arena = this.arena;
    const pos: LatLon = { lat: arena.lat[index]!, lon: arena.lon[index]! };
    const parentCost = arena.costOf(index);
    const epochS = this.input.departEpochS + parentCost.tS;

    // Utenfor værfeltets gyldige tidsvindu: vi ekstrapolerer aldri.
    if (
      epochS < this.input.weather.validFromS ||
      epochS > this.input.weather.validToS
    ) {
      this.pruned.noWeather++;
      this.weatherPartial = true;
      return;
    }

    const env = this.environmentAt(pos, epochS);
    if (env === undefined) {
      // Tidspunktet er innenfor feltets vindu (sjekket over) — mangler
      // vinden likevel, er det et hull i ROMLIG dekning: en flis som ikke
      // ble lastet, eller et område pakken aldri dekket. Det er den
      // situasjonen ekspertpanelets flisvalg-regel forbyr å skje stille
      // (D7.2), og den telles derfor for seg. Merk at også et tidspunkt
      // FØR `validFromS` teller som «utenfor vinduet» over: det er en
      // tidsdekningsmangel, ikke en manglende flis.
      this.pruned.noWeather++;
      this.pruned.noWeatherInWindow++;
      this.weatherPartial = true;
      return;
    }

    // Harde ytelsesgrenser gjelder noden som helhet, før kursløkken.
    if (!checkHardNode(env, this.input.boat).ok) {
      bumpHardConstraint(this.pruned, "hardConstraintBoatLimits");
      return;
    }

    const parentSector = arena.sector[index]!;
    const parentHeading = arena.headingDeg[index]!;
    const parentTack = arena.tack[index]! as Tack;

    for (const headingDeg of this.headings) {
      this.tryHeading(
        index,
        pos,
        parentCost,
        parentSector,
        parentHeading,
        parentTack,
        headingDeg,
        env,
        created,
      );
    }
  }

  private tryHeading(
    parentIndex: number,
    pos: LatLon,
    parentCost: CostVector,
    parentSector: number,
    parentHeading: number,
    parentTack: Tack,
    headingDeg: number,
    env: NodeEnvironment,
    created: number[],
  ): void {
    const opts = this.opts;

    // 1–4: billig kinematikk.
    const kin = stepKinematics(
      pos,
      headingDeg,
      env,
      this.input.boat,
      opts.timeStepS,
    );
    if (kin === undefined) return;
    const next = kin.next;

    // 5: utenfor domenet.
    const cellKey = this.grid.keyOf(next.lat, next.lon);
    if (cellKey === undefined) {
      this.pruned.outsideDomain++;
      return;
    }

    // 6: bautstraff som funksjon av |Δkurs| og halseside.
    const newTack = tackOf(headingDeg, env.wind.fromDeg, opts.beatTwaDeg);
    const penaltyS =
      parentSector === NO_COURSE
        ? 0
        : tackPenaltyS(
            parentHeading,
            headingDeg,
            parentTack,
            newTack,
            env.wind.speedKn,
            opts.tackParams,
          );

    // 7: myke akkumuleringer (kan aldri avvise).
    const contribution = softContribution(
      kin,
      env,
      opts.timeStepS,
      penaltyS,
      opts.beatTwaDeg,
    );
    const cost = accumulateSoft(parentCost, contribution);

    // 9: A*-feltoppslag. Flyttet foran dominanstesten fordi feltverdien nå
    // også er den geometriske uavgjort-bryteren i innsettingen.
    let remainingNm: number;
    if (this.field !== undefined) {
      const fromField = this.field.atOrNear(next.lat, next.lon);
      if (fromField === undefined) {
        this.pruned.deadEnd++;
        return;
      }
      remainingNm = fromField;
    } else {
      remainingNm = haversineNm(next, this.input.dest);
    }

    // 8: dominanstest — billigste og mest treffsikre filter vi har, derfor
    // foran de dyre geometritestene. Semantikken er sikret av at innsetting
    // er siste steg, ikke av rekkefølgen mellom forkastende filtre.
    const sector = courseSector(headingDeg);
    const stateKey = stateKeyOf(cellKey, sector);
    if (this.isDominatedInState(stateKey, cost, remainingNm)) {
      this.pruned.dominated++;
      return;
    }

    // 10: Tub-bound.
    if (
      !opts.exactMode &&
      this.field !== undefined &&
      this.tubBoundS !== null
    ) {
      const estimateS =
        cost.tS + (remainingNm * 3600) / (opts.boundSlack * this.vmaxKn);
      if (estimateS > this.tubBoundS * (1 + opts.tubMarginFrac)) {
        this.pruned.bound++;
        return;
      }
    }

    // 11: kjeglen — valgfri ventil, av som standard (ADR-0004 avvik 2).
    if (!opts.exactMode && opts.coneDeg !== undefined) {
      const rel = angDiff(
        bearing(this.input.start, next),
        this.bearingStartDest,
      );
      if (rel > opts.coneDeg) {
        this.pruned.cone++;
        return;
      }
    }

    // ADR-0008 (D17.1): steget regnes med forelderens miljø — startnoden,
    // det eneste oppslaget motoren bruker for steget. Manglet strøm eller
    // bølge der, bærer steget det selv; det er dette `coverage.weather` for
    // den leverte ruten leses av. Kun rapportering: flaggene inngår verken i
    // dominans, utkasting eller kost, så søket er uendret.
    let flags = contribution.flags | environmentDataFlags(env);
    const mask = this.input.mask;

    // 12: punkt-test.
    if (mask !== undefined) {
      const verdict = mask.pointVerdict(next.lat, next.lon);
      if (!verdict.passable || verdict.tillit === "no-go") {
        bumpHardConstraint(this.pruned, "hardConstraintPoint");
        return;
      }
      if (verdict.tillit === "usikkert") flags |= FLAG_USIKKER_TILLIT;
    }

    // 13: kystbuffer med sjøgangstillegg — langs **hele korden**, ikke bare i
    // kandidatpunktet (R3, besluttet 2026-08-31). Lag 1 er Lipschitz-gaten og
    // koster bare aritmetikk: `d(A)` ligger i arenaen, `d(B)` er cellecachens
    // oppslag som steget uansett trengte. Bommer gaten, tar `clearance.ts`
    // over med bisection.
    let clearanceNm = Number.POSITIVE_INFINITY;
    if (mask !== undefined && opts.minOffingNm > 0) {
      const hsM = env.waves?.hsM;
      const requiredNm = requiredClearanceNm(
        opts.minOffingNm,
        hsM,
        opts.seaStateOffingNmPerM,
      );
      const toClearanceNm = this.clearanceAt(
        mask,
        cellKey,
        next,
        requiredNm + kin.distanceNm / 2,
        this.clearanceCache,
        this.clearanceStats,
      );
      const corridor = checkClearanceCorridor({
        mask,
        from: pos,
        to: next,
        fromClearanceNm: this.arena.clearanceNm[parentIndex]!,
        toClearanceNm,
        chordNm: kin.distanceNm,
        hsM,
        ends: { start: this.input.start, dest: this.input.dest },
        params: opts,
        queryCapNm: this.clearanceCapNm,
        stats: this.clearanceStats,
      });
      flags |= corridor.flags;
      if (!corridor.check.ok) {
        bumpHardConstraint(this.pruned, "hardConstraintClearance");
        return;
      }
      clearanceNm = corridor.toClearanceNm;
    }

    // 14: segmenttesten — den dyre.
    if (mask !== undefined) {
      const verdict = mask.segmentVerdict(pos.lat, pos.lon, next.lat, next.lon);
      if (!verdict.passable) {
        bumpHardConstraint(this.pruned, "hardConstraintSegment");
        return;
      }
      if (verdict.tillit === "usikkert") flags |= FLAG_USIKKER_TILLIT;
    }

    // 15: TSS-retningsregelen.
    const tss = checkTssStep(mask, pos, next, opts.tssParams);
    if (!tss.check.ok) {
      bumpHardConstraint(this.pruned, "hardConstraintTss");
      return;
    }
    flags |= tss.flags;

    // 16: dagslys-ankomst — kun for kandidater som faktisk er ankomsten.
    if (opts.requireDaylightArrival) {
      const distToDest = haversineNm(next, this.input.dest);
      if (distToDest < this.reachRadiusNm) {
        const arrival = daylightArrival(
          this.input.dest.lat,
          this.input.dest.lon,
          this.input.departEpochS + cost.tS,
        );
        if (!arrival.isDaylight) {
          bumpHardConstraint(this.pruned, "hardConstraintDaylight");
          return;
        }
      }
    }

    // 18: innsetting — alltid siste steg. Ingen myk kostnad har fått lov å
    // redde en kandidat forbi en hard sjekk.
    const outcome = this.store.insert({
      lat: next.lat,
      lon: next.lon,
      cost,
      headingDeg,
      sector,
      tack: newTack,
      parent: parentIndex,
      flags,
      cellKey,
      stateKey,
      remainingNm,
      clearanceNm,
      twsKn: env.wind.speedKn,
      twdDeg: env.wind.fromDeg,
      bspKn: kin.bspKn,
      hsM: env.waves?.hsM ?? 0,
    });
    if (outcome.kind === "inserted") created.push(outcome.index);
  }

  /**
   * Ikke-muterende dominans-peek mot tilstandens aktive etiketter. Må følge
   * nøyaktig samme regel som `LabelStore.insert`, inkludert den geometriske
   * uavgjort-bryteren — ellers ville peeken forkastet kandidater innsettingen
   * ville beholdt.
   */
  private isDominatedInState(
    stateKey: number,
    cost: CostVector,
    remainingNm: number,
  ): boolean {
    const arena = this.arena;
    for (const existing of this.store.activeInState(stateKey)) {
      // Rett fra de typede arrayene — `costOf` ville allokert per kandidat.
      const dt = arena.tS[existing]! - cost.tS;
      if (dt > 0) continue;
      const db = arena.beatS[existing]! - cost.beatS;
      if (db > 0) continue;
      const dm = arena.motorS[existing]! - cost.motorS;
      if (dm > 0) continue;
      const dn = arena.nightS[existing]! - cost.nightS;
      if (dn > 0) continue;
      if (dt < 0 || db < 0 || dm < 0 || dn < 0) return true;
      return arena.remainingNm[existing]! <= remainingNm;
    }
    return false;
  }

  // ---------------------------------------------------------------- resultat

  stop(): void {
    this.stopRequested = true;
  }

  snapshot(): RouteResult {
    return buildResult(this.resultContext());
  }

  finish(): RouteResult {
    while (!this.done) this.runOneIteration();
    return buildResult(this.resultContext());
  }

  private resultContext(): ResultContext {
    return {
      provenance: this.provenance,
      input: this.input,
      opts: this.opts,
      arena: this.arena,
      store: this.store,
      reached: this.reached,
      abortReason: this.abortReason,
      bestIndex: this.bestIndex,
      reachedIndices: this.reachedIndices,
      reachRadiusNm: this.reachRadiusNm,
      directDistanceNm: this.directDistanceNm,
      isochrones: this.isochrones,
      weatherPartial: this.weatherPartial,
      fieldUsed: this.fieldUsed,
      fieldCells: this.field?.cellCount ?? 0,
      tubBoundS: this.tubBoundS,
      boundSource: this.boundSource,
      vmaxKn: this.vmaxKn,
      iterations: this.iterations,
      peakActiveLabels: this.peakActiveLabels,
      clearanceStats: this.clearanceStats,
      pruned: {
        ...this.pruned,
        dominated: this.pruned.dominated + this.store.prunedDominated,
        capEvicted: this.store.prunedCapEvicted,
      },
    };
  }

  /** Byte-bilde av arenaen — brukes av determinisme-egenskapstesten. */
  arenaBytes(): Uint8Array {
    return this.arena.bytes();
  }

  /**
   * Øyeblikksbilde av label-storens antikjeder — kun for instrumentering
   * (nettbrett-målingen, steg3-plan §4 pkt. 4). Ikke del av produksjons-
   * API-et (`Search`); hentes via `createSearchForTesting`, som allerede er
   * markert «kun for tester». Rent lesende: ingen klokke, ingen I/O.
   */
  labelStoreSnapshot(): readonly {
    readonly stateKey: number;
    readonly cellKey: number;
    readonly tack: number;
  }[] {
    const arena = this.arena;
    const out: { stateKey: number; cellKey: number; tack: number }[] = [];
    this.store.forEachActiveState((stateKey, labels) => {
      for (const index of labels) {
        out.push({
          stateKey,
          cellKey: arena.cellKey[index]!,
          tack: arena.tack[index]!,
        });
      }
    });
    return out;
  }

  /**
   * Assertion-harness (§8.3): verifiserer at ingen tilstands etikettliste
   * inneholder et dominert par. Kalles fra tester etter hver iterasjon —
   * aldri på den varme veien, den er O(n²) per tilstand.
   */
  assertInvariants(): void {
    this.store.assertAntichain();
  }
}

/**
 * **Feltet søket ville bygget selv** — den eneste veien til det.
 *
 * `RouteInput.field` er delt A\*-felt (§5.5): væruavhengig geometri som skal
 * bygges ÉN gang per `(start, dest, maskeversjon, feltoppløsning)` og
 * gjenbrukes for alle ensemble-medlemmer og alle avganger (robusthet.md
 * §4.1). Klienten kaller denne i kontroll-workeren, sender `field.data` —
 * en `DistanceFieldData`: rent objekt + `Float64Array` — som **transferable
 * kopi** i worker-meldingen, og medlems-workeren rekonstruerer med
 * `new DistanceField(data)` før den legger feltet i `RouteInput.field`.
 *
 * `DistanceFieldData` er dermed overføringskontrakten mellom workere. Ingen
 * `SharedArrayBuffer`: feltet er skrivebeskyttet etter bygging, kopien er
 * ~0,2–0,3 MB for Skjæløy→Skagen, og delt minne ville krevd COOP/COEP-headere
 * hele appen ellers ikke trenger.
 *
 * Funksjonen finnes for at klienten ikke skal gjette parameterne: den er
 * bokstavelig talt kallet `setUpField` gjør, så et felt bygget her gir
 * bit-identisk `RouteResult` med et søk som bygget sitt eget
 * (`shared-field.test.ts`). Er `input.field` allerede satt, returneres det
 * urørt — funksjonen er idempotent.
 *
 * Returnerer `undefined` når feltet ikke lot seg bygge; søket degraderer da
 * som beskrevet i §5.5 (ingen blindvei-pruning, ingen Tub-bound).
 */
export function buildFieldForInput(
  input: RouteInput,
): DistanceField | undefined {
  if (input.field !== undefined) return input.field;
  const gate =
    input.mask === undefined ? OPEN_EDGE_GATE : maskAsEdgeGate(input.mask);
  return buildDistanceField(input.start, input.dest, gate);
}

export function createSearch(input: RouteInput): Search {
  return new RouteSearch(input, "createSearch");
}

/** Bekvemmelighet: løkke over `advance()` til den er ferdig. */
export function planRoute(input: RouteInput): RouteResult {
  const search = new RouteSearch(input, "planRoute");
  return search.finish();
}

/**
 * Kun for tester: gir tilgang til arena-bytene for determinismesjekk. Samme
 * søk som `createSearch`, og bærer derfor samme `provenance` — det er et
 * fullt søk, bare med et bredere returtype-vindu.
 */
export function createSearchForTesting(input: RouteInput): RouteSearch {
  return new RouteSearch(input, "createSearch");
}

export type { RouteSearch };
