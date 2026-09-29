/**
 * Rekonstruksjon, konsolidering og den uavhengige sikkerhetsettersjekken
 * (docs/specs/rutemotor.md §5.8–§5.10).
 *
 * Ettersjekken er **forsvar i dybden**: hvert segment i den ferdige ruten
 * kjøres på nytt gjennom masken, av kode som ikke deler tilstand med søket og
 * ikke stoler på noen cache derfra. At den noen gang feiler er per definisjon
 * en bug i søket — og da skal det skrives en golden-test som reproduserer
 * tilfellet før feilen fikses.
 */

import { angDiff, bearing, haversineNm } from "@morild/geo";
import type { LabelArena } from "./arena.js";
import type {
  CorridorEnds,
  CorridorParams,
  CorridorStats,
} from "./clearance.js";
import {
  checkClearanceCorridor,
  createCorridorStats,
  DEFAULT_CORRIDOR_PARAMS,
  freezeCorridorStats,
} from "./clearance.js";
import type { NavigabilityMask, WeatherField } from "./contracts.js";
import type { CostVector, CostWeights } from "./cost.js";
import {
  costScore,
  dominates,
  FLAG_KRYSS,
  FLAG_MOTOR,
  FLAG_NATT,
  FLAG_SJOEGANG_DATA_MANGLER,
  FLAG_STROM_DATA_MANGLER,
  FLAG_STROM_KYSTSONE,
  FLAG_BOLGE_PUNKT_KATEGORI,
  wavePointCategoryFlag,
  FLAG_USIKKER_TILLIT,
  FLAG_VAERDEKNING_BEGRENSET,
  flagNames,
  scaledRankingWeights,
} from "./cost.js";
import { daylightArrival } from "./daylight.js";
import { courseToSteer, DEFAULT_EVALUATE_OPTIONS } from "./evaluate.js";
import {
  checkHardNode,
  checkSegment,
  checkTssStep,
  environmentAt,
  MIN_SPEED_KN,
  softContribution,
  stepKinematics,
} from "./expand.js";
import type { LabelStore } from "./label-store.js";
import type { RouteOptions } from "./options.js";
import type {
  AbortReason,
  FinalLegStatus,
  IsochroneSnapshot,
  RouteAlternative,
  RouteFinalLeg,
  RouteLeg,
  RouteProvenance,
  RouteResult,
  RouteStep,
  RouteTermination,
  SegmentRef,
  TerminationKind,
  TubBoundSource,
} from "./result.js";
import type { RouteInput } from "./search.js";
import { tackOf, tackPenaltyS } from "./tack.js";
import type { TssRuleParams } from "./tss.js";
import { applyTssRule, DEFAULT_TSS_PARAMS } from "./tss.js";

/** Under denne avstanden regnes ruten som framme (v1-arv). */
const DIRECT_FINAL_LEG_THRESHOLD_NM = 0.3;

/** Kursforskjell under denne slås sammen i konsolideringen (v1: 8°). */
const CONSOLIDATE_COURSE_TOLERANCE_DEG = 8;

export interface ResultContext {
  /**
   * Settes av `search.ts` til `"planRoute"`/`"createSearch"` — de to
   * inngangene `docs/specs/robusthet.md` §3.1 pkt. 1 anerkjenner. Utelatt
   * (tester og fiksturer som bygger konteksten for hånd) faller den til
   * `"buildResult"`: et resultat bygget fra en arena ingen full søkekjøring
   * har fylt, og som robusthetslaget derfor skal avvise.
   */
  readonly provenance?: RouteProvenance | undefined;
  readonly input: RouteInput;
  readonly opts: RouteOptions;
  readonly arena: LabelArena;
  readonly store: LabelStore;
  readonly reached: boolean;
  readonly abortReason: AbortReason | null;
  readonly bestIndex: number;
  readonly reachedIndices: readonly number[];
  readonly reachRadiusNm: number;
  readonly directDistanceNm: number;
  readonly isochrones: readonly IsochroneSnapshot[];
  readonly weatherPartial: boolean;
  readonly fieldUsed: boolean;
  readonly fieldCells: number;
  readonly tubBoundS: number | null;
  /**
   * Kilden til Tub-bounden (D9.2 b-full). Valgfri fordi tester og fiksturer
   * bygger konteksten for hånd; utelatt betyr `null` — «ingen bound i spill»,
   * den eneste verdien et resultat uten søk bak seg kan stå inne for.
   */
  readonly boundSource?: TubBoundSource | undefined;
  readonly vmaxKn: number;
  readonly iterations: number;
  readonly peakActiveLabels: number;
  /** Søkets korridor-tellere (§5.3.2). Valgfri: tester bygger kontekst direkte. */
  readonly clearanceStats?: CorridorStats | undefined;
  readonly pruned: {
    readonly dominated: number;
    readonly bound: number;
    readonly deadEnd: number;
    readonly hardConstraint: number;
    readonly hardConstraintBoatLimits: number;
    readonly hardConstraintPoint: number;
    readonly hardConstraintClearance: number;
    readonly hardConstraintSegment: number;
    readonly hardConstraintTss: number;
    readonly hardConstraintDaylight: number;
    readonly capEvicted: number;
    readonly noWeather: number;
    /** Hull i flisdekningen innenfor pakkens tidsvindu (D7.2) — se `result.ts`. */
    readonly noWeatherInWindow: number;
    readonly cone: number;
    readonly outsideDomain: number;
  };
}

/**
 * `abortReason` (+ `reached`) → `termination.kind`. Uttømmende over
 * `AbortReason`, og bevist uttømmende med én test per verdi i
 * `termination.test.ts`.
 *
 * `null` uten `reached` er det ene tilfellet som ikke er en stoppårsak i det
 * hele tatt: et `snapshot()` av et søk som fortsatt kunne gått videre, eller
 * en håndbygget `ResultContext`. Det er «avbrutt» i den eneste betydningen
 * som betyr noe her — ingenting er uttømt, ingenting er bevist — og faller
 * derfor på `"aborted"`.
 */
function terminationKindOf(
  reached: boolean,
  abortReason: AbortReason | null,
): TerminationKind {
  if (reached) return "reached";
  switch (abortReason) {
    case "noExpandableLabels":
      return "exhausted";
    case "labelCap":
    case "iterationCap":
      return "capped";
    case "stagnation":
      return "guard";
    case "callerStopped":
    case "noWeatherAtStart":
    case "outsideDomain":
      return "aborted";
    case null:
      return "aborted";
  }
}

function terminationOf(
  reached: boolean,
  abortReason: AbortReason | null,
  boundSource: TubBoundSource,
  prunedBound: number,
): RouteTermination {
  return {
    kind: terminationKindOf(reached, abortReason),
    boundSource,
    prunedBound,
  };
}

/** Etikettkjeden fra start til `index`, i rekkefølge. */
export function labelChain(arena: LabelArena, index: number): number[] {
  const chain: number[] = [];
  let cursor = index;
  // Vern mot en ødelagt forelderkjede: aldri flere ledd enn etiketter.
  for (let guard = 0; cursor >= 0 && guard <= arena.count; guard++) {
    chain.push(cursor);
    cursor = arena.parent[cursor]!;
  }
  chain.reverse();
  return chain;
}

/**
 * `STROM_KYSTSONE` (D15.2, `docs/specs/strom-produsent.md` §4b): kun
 * rapportering, lagt på i rekonstruksjonen — søket, kosten og deratingen
 * ser aldri kystmasken. Felt uten `currentCoastal` gir aldri flagget.
 */
function coastalCurrentFlag(
  weather: WeatherField,
  lat: number,
  lon: number,
  epochS: number,
): number {
  return weather.currentCoastal?.(lat, lon, epochS) === true
    ? FLAG_STROM_KYSTSONE
    : 0;
}

/**
 * `BOLGE_PUNKT_KATEGORI_*` (`docs/specs/punktbolge.md` §4): avstanden til
 * nærmeste bølge-varselpunkt, i kategori. Samme mønster som
 * `coastalCurrentFlag` — kun rapportering, lagt på i rekonstruksjonen.
 */
function wavePointFlag(weather: WeatherField, lat: number, lon: number): number {
  return wavePointCategoryFlag(weather.wavePointDistanceNm?.(lat, lon));
}

/** Rapporteringsflaggene rekonstruksjonen legger på et steg (strøm-kystsone + bølgepunkt). */
function reportingFlags(weather: WeatherField, lat: number, lon: number, epochS: number): number {
  return coastalCurrentFlag(weather, lat, lon, epochS) | wavePointFlag(weather, lat, lon);
}

function stepFrom(
  arena: LabelArena,
  index: number,
  departEpochS: number,
  isStart: boolean,
  weather: WeatherField,
): RouteStep {
  const lat = arena.lat[index]!;
  const lon = arena.lon[index]!;
  const epochS = departEpochS + arena.tS[index]!;
  const flags =
    arena.flags[index]! | reportingFlags(weather, lat, lon, epochS);
  return {
    lat,
    lon,
    tS: arena.tS[index]!,
    epochS,
    headingDeg: isStart ? null : arena.headingDeg[index]!,
    beatS: arena.beatS[index]!,
    motorS: arena.motorS[index]!,
    nightS: arena.nightS[index]!,
    twsKn: arena.twsKn[index]!,
    twdDeg: arena.twdDeg[index]!,
    bspKn: arena.bspKn[index]!,
    hsM: arena.hsM[index]!,
    flags,
    flagNames: flagNames(flags),
  };
}

/**
 * Konsolidering (§5.9): slår sammen påfølgende ~like kurser for å fjerne
 * isokron-sagtann.
 *
 * Tre krav utover v1:
 *  1. En sammenslåing gjennomføres **kun** hvis det lengre segmentet består
 *     `segmentVerdict`. Konsolidering skal aldri kunne skape en rute som
 *     krysser en grunne to korte segmenter gikk utenom.
 *  2. Den må også bestå **TSS-regelen**. Dette kravet står ikke i spec §5.9,
 *     men følger av samme prinsipp, og det er ikke teoretisk: den første
 *     golden-kjøringen av «tss-ved-skagen» ga `usikker-rute` fordi to korte
 *     segmenter som hver for seg krysset leden lovlig, ble slått sammen til
 *     ett langt segment som lå *langs* leden mot trafikkretningen. Søket var
 *     riktig; konsolideringen innførte bruddet, og ettersjekken fanget det.
 *     Regresjonstesten står i `reconstruct.test.ts`.
 *  3. Konsolidering endrer aldri totalene — de regnes fra `steps`.
 */
export function consolidateSteps(
  steps: readonly RouteStep[],
  mask: NavigabilityMask | undefined,
  tssParams: TssRuleParams = DEFAULT_TSS_PARAMS,
  corridor: CorridorCheckContext = DEFAULT_CORRIDOR_CONTEXT,
  toleranceDeg: number = CONSOLIDATE_COURSE_TOLERANCE_DEG,
): RouteStep[] {
  if (steps.length < 3) return [...steps];
  const first = steps[0]!;
  const out: RouteStep[] = [first];
  for (let i = 1; i < steps.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = steps[i]!;
    const next = steps[i + 1]!;
    const courseIn = bearing(prev, cur);
    const courseOut = bearing(cur, next);
    if (angDiff(courseIn, courseOut) >= toleranceDeg) {
      out.push(cur);
      continue;
    }
    if (mask !== undefined && !mergeIsSafe(mask, prev, next, tssParams, corridor)) {
      out.push(cur);
      continue;
    }
  }
  out.push(steps[steps.length - 1]!);
  return out;
}

/** Målet som et minimalt `RouteStep`, kun for geometrisjekkene. */
function destAsStep(ctx: ResultContext): { lat: number; lon: number } {
  return { lat: ctx.input.dest.lat, lon: ctx.input.dest.lon };
}

/**
 * Konteksten korridorsjekken trenger i den autoritative stien (§5.9, §5.10).
 * `ends` er havneendene unntaket måles mot; `undefined` gir ingen unntak.
 */
export interface CorridorCheckContext {
  readonly params: CorridorParams;
  readonly ends: CorridorEnds | undefined;
  readonly stats?: CorridorStats | undefined;
}

/**
 * Standardkontekst når kalleren ikke oppgir noe: korridorkravet gjelder
 * likevel. «Full korridorsjekk alltid i den autoritative stien» skal ikke
 * kunne slås av ved å glemme et argument.
 */
const DEFAULT_CORRIDOR_CONTEXT: CorridorCheckContext = Object.freeze({
  params: DEFAULT_CORRIDOR_PARAMS,
  ends: undefined,
});

/**
 * Klaringskravet for et ferdig rutesegment. Stegene bærer `hsM` fra selve
 * seilasen, og det er den sjøgangen kravet skal skjerpes med; for et
 * sammenslått segment brukes den største av endene (konservativt).
 *
 * `hsM = 0` betyr enten «flatt hav» eller «ingen bølgedata» — steget bærer
 * ikke forskjellen videre. Kravet blir det samme i begge tilfeller
 * (`minOffingNm`), og `SJOEGANG_DATA_MANGLER` er allerede satt på etiketten av
 * søket, så ingenting skjules.
 */
function segmentHsM(
  from: { readonly hsM?: number },
  to: { readonly hsM?: number },
): number {
  return Math.max(from.hsM ?? 0, to.hsM ?? 0);
}

/**
 * Består det sammenslåtte segmentet farbarhet, TSS-regelen **og**
 * kystbufferen langs hele korden?
 *
 * Korridorkravet er nytt 2026-08-31 (R3). Uten det kunne konsolideringen slå
 * sammen to korte segmenter som hver holdt bufferen til ett langt som skjærer
 * innenfor den — nøyaktig samme feilklasse som TSS-regresjonen over, bare på
 * klaring i stedet for trafikkretning.
 */
function mergeIsSafe(
  mask: NavigabilityMask,
  from: RouteStep,
  to: RouteStep,
  tssParams: TssRuleParams,
  corridor: CorridorCheckContext,
): boolean {
  if (!mask.segmentVerdict(from.lat, from.lon, to.lat, to.lon).passable) {
    return false;
  }
  const tss = applyTssRule(
    mask.tssVerdict(from.lat, from.lon, to.lat, to.lon),
    tssParams,
  );
  if (tss.kind === "reject") return false;
  return checkClearanceCorridor({
    mask,
    from,
    to,
    hsM: segmentHsM(from, to),
    ends: corridor.ends,
    params: corridor.params,
    stats: corridor.stats,
  }).check.ok;
}

function legsFrom(
  points: readonly RouteStep[],
  directEndIndex: number,
): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    legs.push({
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
      headingDeg: bearing(from, to),
      distanceNm: haversineNm(from, to),
      startTS: from.tS,
      endTS: to.tS,
      direkteSlutt: i === directEndIndex,
    });
  }
  return legs;
}

/**
 * Den uavhengige sikkerhetsettersjekken. Kjører **hvert** segment i den
 * ferdige ruten gjennom masken på nytt, uten cache fra søket.
 */
export function recheckRoute(
  legs: readonly RouteLeg[],
  mask: NavigabilityMask | undefined,
  opts: RouteOptions,
  /**
   * Havneendene kystbuffer-unntaket måles mot. `undefined` ⇒ ingen unntak,
   * altså den strengeste tolkningen.
   */
  ends: CorridorEnds | undefined = undefined,
  /** Sjøgang per etappe, indeksert som `legs`. Mangler ⇒ statisk krav. */
  legHsM: readonly number[] = [],
  stats: CorridorStats | undefined = undefined,
): { failing: SegmentRef[]; flagged: SegmentRef[] } {
  const failing: SegmentRef[] = [];
  const flagged: SegmentRef[] = [];
  if (mask === undefined) return { failing, flagged };

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const verdict = mask.segmentVerdict(
      leg.fromLat,
      leg.fromLon,
      leg.toLat,
      leg.toLon,
    );
    const ref = (tillit: SegmentRef["tillit"], reason: string): SegmentRef => ({
      legIndex: i,
      fromLat: leg.fromLat,
      fromLon: leg.fromLon,
      toLat: leg.toLat,
      toLon: leg.toLon,
      tillit,
      reason,
    });
    if (!verdict.passable) {
      failing.push(ref("no-go", verdict.reason ?? "ikke farbart"));
      continue;
    }
    const tss = applyTssRule(
      mask.tssVerdict(leg.fromLat, leg.fromLon, leg.toLat, leg.toLon),
      opts.tssParams,
    );
    if (tss.kind === "reject") {
      failing.push(ref("no-go", tss.reason));
      continue;
    }
    // R3: kystbufferen kontrolleres langs hele etappen, av kode som ikke
    // stoler på noe søket gjorde. Et brudd her er per definisjon en bug i
    // søket eller i konsolideringen — og da skal ruten merkes, ikke leveres
    // som om den holdt kravet.
    const corridor = checkClearanceCorridor({
      mask,
      from: { lat: leg.fromLat, lon: leg.fromLon },
      to: { lat: leg.toLat, lon: leg.toLon },
      hsM: legHsM[i],
      ends,
      params: opts,
      stats,
    });
    if (!corridor.check.ok) {
      failing.push(ref("no-go", corridor.check.reason));
      continue;
    }
    if (verdict.tillit === "usikkert") {
      flagged.push(ref("usikkert", verdict.reason ?? "usikker dekning"));
    } else if (tss.kind === "along-with-direction") {
      flagged.push(ref("trygt", "følger TSS med trafikkretningen"));
    }
  }
  return { failing, flagged };
}

/**
 * Ender ruten faktisk i målet? Det er **ikke** det samme som `reached`, som
 * bare sier at søket fant en etikett innenfor `reachRadius` — sluttetappen
 * (§5.8) kan ha blitt avvist etterpå, og da stopper ruten `shortfallNm` unna.
 */
export function reachesDestination(status: FinalLegStatus): boolean {
  return status === "lagt-til" || status === "ikke-nodvendig";
}

/**
 * Ble sluttetappen aktivt avvist av en av sjekkene i §5.8? Skiller seg fra
 * `!reachesDestination(...)` ved at `"ikke-forsokt"` ikke teller: der nådde
 * søket aldri målet i det hele tatt, og `reached: false` sier det allerede
 * høyt på toppnivå. Det farlige tilfellet er nettopp motsigelsen
 * `reached: true` + avvist sluttetappe.
 */
export function finalLegWasRejected(status: FinalLegStatus): boolean {
  return (
    status === "avvist-farbarhet" ||
    status === "avvist-vaer" ||
    status === "avvist-baatgrenser" ||
    status === "avvist-fart"
  );
}

/** Ikke-dominerte etiketter i en mengde, i input-rekkefølge. */
function nonDominated(arena: LabelArena, indices: readonly number[]): number[] {
  const out: number[] = [];
  for (const candidate of indices) {
    const cost = arena.costOf(candidate);
    let dominated = false;
    for (const other of indices) {
      if (other === candidate) continue;
      if (dominates(arena.costOf(other), cost)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) out.push(candidate);
  }
  return out;
}

export function buildResult(ctx: ResultContext): RouteResult {
  const { arena, input, opts } = ctx;
  /**
   * Korridorsjekken i den autoritative stien får sine egne tellere, adskilt
   * fra søkets: skalaene er så ulike (hundrevis av segmenter mot
   * hundretusenvis av kandidater) at en sum ville skjult begge.
   */
  const recheckStats = createCorridorStats();
  const corridorContext: CorridorCheckContext = {
    params: opts,
    ends: { start: input.start, dest: input.dest },
    stats: recheckStats,
  };
  const rankingWeights: CostWeights = scaledRankingWeights(
    opts.rankingWeights,
    ctx.directDistanceNm,
    opts.beatWeightLengthScaling,
  );

  const candidates =
    ctx.reached && ctx.reachedIndices.length > 0
      ? [...ctx.reachedIndices]
      : [ctx.bestIndex];

  // Primærruten er den ikke-dominerte etiketten med lavest rangeringsscore.
  const front = nonDominated(arena, candidates);
  const ranked = [...front].sort((a, b) => {
    const sa = costScore(arena.costOf(a), rankingWeights);
    const sb = costScore(arena.costOf(b), rankingWeights);
    if (sa !== sb) return sa - sb;
    // Total komparator — arena-indeksen er alltid unik.
    return a - b;
  });
  const fallback = ranked[0] ?? ctx.bestIndex;

  /** Kjeden fram til en kandidat, med sluttetappen påført. */
  const assemble = (index: number): DirectFinalStep =>
    appendDirectFinalStep(
      labelChain(arena, index).map((i, at) =>
        stepFrom(arena, i, input.departEpochS, at === 0, input.weather),
      ),
      ctx,
      recheckStats,
    );

  /**
   * R4 (funn 2026-08-31): søkets dagslyssjekk (§5.3 steg 16) måler på
   * etiketten *før* den direkte sluttetappen er lagt på — en teleportering
   * inn til målet. Med reell sluttetappetid kan ankomsten falle utenfor
   * dagslysvinduet likevel. Vi velger derfor primærrute blant de
   * ikke-dominerte kandidatene som fortsatt holder kravet med reell
   * ankomsttid. Holder ingen, returneres den best rangerte likevel, men med
   * `totals.violatesDaylightRequirement` satt — ruten leveres aldri stille.
   *
   * **Funn 1a (code-review runde 2, 2026-08-31):** kandidaten må i tillegg
   * faktisk *nå målet*. Uten det kravet kunne en kandidat med avvist
   * sluttetappe «vinne» dagslyskravet nettopp fordi den stopper tidlig — den
   * stanser et stykke unna, og «ankomsten» er da bare tidspunktet den ga
   * opp. En rute som ikke kommer fram har ikke oppfylt et krav om ankomst i
   * dagslys, og skal aldri kunne slå en rute som faktisk kommer fram.
   */
  let primary = fallback;
  let withEnd: DirectFinalStep | undefined;
  if (opts.requireDaylightArrival && ctx.reached) {
    let first: DirectFinalStep | undefined;
    for (const candidate of ranked) {
      const attempt = assemble(candidate);
      first ??= attempt;
      if (!reachesDestination(attempt.finalLeg.status)) continue;
      const end = attempt.steps[attempt.steps.length - 1];
      if (
        end !== undefined &&
        daylightArrival(end.lat, end.lon, end.epochS).isDaylight
      ) {
        primary = candidate;
        withEnd = attempt;
        break;
      }
    }
    // Ingen kandidat nådde målet i dagslys: behold den best rangerte, og la
    // `violatesDaylightRequirement` + `safety` fortelle det.
    withEnd ??= first;
  }
  withEnd ??= assemble(primary);
  const steps = withEnd.steps;

  const consolidated = consolidateSteps(
    steps,
    input.mask,
    opts.tssParams,
    corridorContext,
  );
  const directEndIndex = withEnd.hasDirectEnd ? consolidated.length - 1 : -1;
  const legs = legsFrom(consolidated, directEndIndex);
  // Sjøgangen etappen faktisk ble seilt i, konservativt fra endene.
  const legHsM: number[] = [];
  for (let i = 1; i < consolidated.length; i++) {
    legHsM.push(segmentHsM(consolidated[i - 1]!, consolidated[i]!));
  }

  const totalsBase = totalsFromSteps(steps, ctx);
  const arrivalEpochS = input.departEpochS + totalsBase.durationS;
  // Dagslys måles der ruten faktisk ender — ikke i målet når sluttetappen ble
  // avvist og ruten stopper et stykke unna.
  const endPoint = steps[steps.length - 1] ?? input.dest;
  const arrival = daylightArrival(
    endPoint.lat,
    endPoint.lon,
    arrivalEpochS,
  );

  const { failing, flagged } = recheckRoute(
    legs,
    input.mask,
    opts,
    { start: input.start, dest: input.dest },
    legHsM,
    recheckStats,
  );
  const maskCoverage = input.mask?.coverage ?? "none";
  const recheckPassed = input.mask !== undefined && failing.length === 0;
  const endsAtDest = reachesDestination(withEnd.finalLeg.status);
  const segmentVerdict: RouteResult["safety"]["verdict"] =
    input.mask === undefined || failing.length > 0
      ? "usikker-rute"
      : flagged.length > 0 || maskCoverage !== "full"
        ? "usikkert"
        : "trygt";
  /**
   * Funn 1b (code-review runde 2, 2026-08-31): en avvist sluttetappe skal
   * ikke kunne skjule seg bak et rent «trygt». Segmentene i ruten kan godt
   * alle være farbare — men når `reached: true` samtidig som ruten stopper
   * `shortfallNm` fra havn, er «trygt» en sannhet som villeder. Gulvet er
   * derfor `usikkert`, og `safety.reachesDestination` sier det maskinlesbart.
   * Vi hever ikke til `usikker-rute`: ingen del av ruten som faktisk tegnes
   * er farlig, og å blande sammen «farlig linje» med «kom ikke fram» ville
   * gjort begge signalene mindre nyttige.
   */
  const finalLegVerdict: RouteResult["safety"]["verdict"] =
    finalLegWasRejected(withEnd.finalLeg.status) && segmentVerdict === "trygt"
      ? "usikkert"
      : segmentVerdict;

  /**
   * **Rute-nivå flagg** (D7.2, vedtatt 2026-09-04). Forkastet søket
   * etiketter fordi vinden manglet i posisjonen INNENFOR pakkens gyldige
   * tidsvindu, er ruten formet av hvilke værfliser klienten tilfeldigvis
   * hadde — ikke av været. Det er nøyaktig den «stille styringen av søket ved
   * flisdekning» ekspertpanelets djevelens advokat pekte på, og den skal
   * være synlig i resultatet.
   *
   * Merk at horisont-slutt (`epochS > validToS`) bevisst IKKE utløser
   * flagget: at prognosen tar slutt er forventet og allerede dekket av
   * `coverage.weather === "partial"` og ADR-0005s inkonklusiv-regel.
   */
  const weatherCoverageLimited = ctx.pruned.noWeatherInWindow > 0;
  /**
   * `STROM_KYSTSONE` (D15.2) og `BOLGE_PUNKT_KATEGORI_*` (punktbolge.md §4)
   * på rute-nivå er OR over stegene: ett kystnært strømpunkt, eller ett steg
   * i en gitt avstandskategori, er nok til at UI-et skal si det.
   */
  let reportedOr = 0;
  for (const s of steps) {
    reportedOr |= s.flags & (FLAG_STROM_KYSTSONE | FLAG_BOLGE_PUNKT_KATEGORI);
  }
  const routeFlags =
    (weatherCoverageLimited ? FLAG_VAERDEKNING_BEGRENSET : 0) | reportedOr;
  /**
   * Gulvet: en rute som er beskåret av manglende værdekning kan aldri stå
   * som `"trygt"` (CLAUDE.md §1 «sikkerhet foran optimalitet», N2). Vi hever
   * ikke til `"usikker-rute"` — linjen som faktisk tegnes er sjekket mot
   * masken som ellers; det er *fullstendigheten* av søket som er usikker.
   *
   * Bevisst avgrensning (review 2026-09-27, D15.1 d-min): manglende strøm/
   * bølge — også på sluttetappen — senker IKKE `verdict`; det gir
   * `coverage.weather === "partial"` og per-steg-flagg (`STROM_DATA_MANGLER`
   * / `SJOEGANG_DATA_MANGLER`). `verdict` og `coverage.weather` kan derfor
   * vise ulikt; UI skal lese begge (og flaggene), aldri `verdict` alene.
   * Om manglende strøm skal senke `verdict`, er en egen beslutning.
   */
  const verdict: RouteResult["safety"]["verdict"] =
    weatherCoverageLimited && finalLegVerdict === "trygt"
      ? "usikkert"
      : finalLegVerdict;

  const alternatives = buildAlternatives(
    ctx,
    front,
    primary,
    rankingWeights,
    corridorContext,
  );

  return {
    // Kun `search.ts` setter denne til en av de to anerkjente inngangene.
    provenance: ctx.provenance ?? "buildResult",
    reached: ctx.reached,
    abortReason: ctx.abortReason,
    flags: routeFlags,
    flagNames: flagNames(routeFlags),
    legs,
    steps,
    totals: {
      ...totalsBase,
      arrivalEpochS,
      daylightArrival: arrival.isDaylight,
      // Kravet er «ankomst *i målet* i dagslys». En rute som stopper før
      // målet har ikke oppfylt det, uansett hvor lyst det er der den stoppet.
      violatesDaylightRequirement:
        opts.requireDaylightArrival && (!arrival.isDaylight || !endsAtDest),
      exceedsMaxContinuousLeg:
        opts.maxContinuousLegS !== undefined &&
        totalsBase.durationS > opts.maxContinuousLegS,
    },
    finalLeg: withEnd.finalLeg,
    safety: {
      verdict,
      reachesDestination: endsAtDest,
      recheckPassed,
      failingSegments: failing,
      flaggedSegments: flagged,
    },
    coverage: {
      mask: maskCoverage,
      // d-min (D15.1, `docs/specs/strom-produsent.md` §4b): sluttetappens
      // miljøoppslag teller med. Kan bare gjøre klassifiseringen strengere.
      weather:
        ctx.weatherPartial || withEnd.weatherPartial ? "partial" : "full",
      fieldUsed: ctx.fieldUsed,
      weatherHeader: input.weather.header,
      chartSources: input.mask?.sources ?? [],
    },
    alternatives,
    isochrones: ctx.isochrones,
    diagnostics: {
      iterations: ctx.iterations,
      labelsCreated: arena.count,
      peakActiveLabels: ctx.peakActiveLabels,
      fieldCells: ctx.fieldCells,
      tubBoundS: ctx.tubBoundS,
      vmaxKn: ctx.vmaxKn,
      termination: terminationOf(
        ctx.reached,
        ctx.abortReason,
        ctx.boundSource ?? null,
        ctx.pruned.bound,
      ),
      clearance: freezeCorridorStats(
        ctx.clearanceStats ?? createCorridorStats(),
      ),
      clearanceRecheck: freezeCorridorStats(recheckStats),
      pruned: ctx.pruned,
    },
  };
}

interface DirectFinalStep {
  readonly steps: RouteStep[];
  readonly hasDirectEnd: boolean;
  readonly finalLeg: RouteFinalLeg;
  /**
   * Manglet strøm eller bølge i sluttetappens miljøoppslag (D15.1 d-min)?
   * Sluttetappen er etterbehandling, så søkets `weatherPartial` ser den
   * ikke — uten dette ble en sluttetappe uten strøm stille regnet som full
   * dekning (N2-brudd, `docs/research/ekspertpanel-d15-kystkant-2026-09-27.md`
   * §5 pkt. 2).
   */
  readonly weatherPartial: boolean;
}

function rejectedFinalLeg(
  out: RouteStep[],
  status: FinalLegStatus,
  reason: string,
  shortfallNm: number,
  weatherPartial = false,
): DirectFinalStep {
  return {
    steps: out,
    hasDirectEnd: false,
    finalLeg: { status, reason, shortfallNm },
    weatherPartial,
  };
}

/**
 * Direkte sluttetappe (v1-arv): når målet er nådd men siste punkt er mer enn
 * 0,3 nm unna, legges en etappe rett til målet — **kun** hvis den består de
 * samme harde sjekkene som ethvert søkesteg. Den merkes eksplisitt
 * `direkteSlutt: true` i `legs`, slik at UI kan si det.
 *
 * **Kinematikken er søkets egen** (`environmentAt` + `stepKinematics` +
 * `softContribution`), ikke en kopi. Bug funnet 2026-08-31 av evaluatoren og
 * fikset her: den gamle koden regnet fart uten strøm og uten fartssjekk, slik
 * at `bspKn ≈ 0` (mål rett mot vinden, motor av) ga `extraS = 0` — full
 * distanse uten tid i `totals`. En etappe båten ikke kan seile skal ikke være
 * gratis; den skal ikke finnes.
 *
 * Avvises etappen, legges den **ikke** på. Ruten ender da ved siste ordinære
 * steg, og `finalLeg` sier eksplisitt hvorfor og hvor langt unna målet den
 * stoppet — samme ærlighetsfilosofi som `uoppnaelig-mal`-semantikken. Vi
 * later aldri som om båten kom fram.
 */
function appendDirectFinalStep(
  steps: readonly RouteStep[],
  ctx: ResultContext,
  corridorStats: CorridorStats | undefined = undefined,
): DirectFinalStep {
  const out = [...steps];
  const last = out[out.length - 1];
  if (!ctx.reached || last === undefined) {
    const shortfallNm =
      last === undefined ? 0 : haversineNm(last, ctx.input.dest);
    return {
      steps: out,
      hasDirectEnd: false,
      finalLeg: { status: "ikke-forsokt", reason: null, shortfallNm },
      weatherPartial: false,
    };
  }

  const remainingNm = haversineNm(last, ctx.input.dest);
  if (remainingNm <= DIRECT_FINAL_LEG_THRESHOLD_NM) {
    return {
      steps: out,
      hasDirectEnd: false,
      finalLeg: { status: "ikke-nodvendig", reason: null, shortfallNm: 0 },
      weatherPartial: false,
    };
  }

  // Farbarhet og TSS. Spec §5.8 nevner bare `segmentVerdict`, men TSS-regelen
  // gjelder like fullt: golden-kjøringen av «tss-ved-skagen» ga
  // `usikker-rute` fordi sluttetappen inn til Skagen la seg langs leden mot
  // trafikkretningen. Etterbehandling skal aldri kunne innføre et brudd søket
  // selv ville avvist.
  const mask = ctx.input.mask;
  const dest = destAsStep(ctx);
  const segment = checkSegment(mask, last, dest);
  if (!segment.ok) {
    return rejectedFinalLeg(out, "avvist-farbarhet", segment.reason, remainingNm);
  }
  const tss = checkTssStep(mask, last, dest, ctx.opts.tssParams);
  if (!tss.check.ok) {
    return rejectedFinalLeg(
      out,
      "avvist-farbarhet",
      tss.check.reason,
      remainingNm,
    );
  }

  const { weather, boat } = ctx.input;
  if (last.epochS < weather.validFromS || last.epochS > weather.validToS) {
    return rejectedFinalLeg(
      out,
      "avvist-vaer",
      "sluttetappen starter utenfor værfeltets gyldige tidsvindu",
      remainingNm,
    );
  }
  const env = environmentAt(weather, last, last.epochS);
  if (env === undefined) {
    return rejectedFinalLeg(
      out,
      "avvist-vaer",
      "ingen vinddata i rutens siste punkt",
      remainingNm,
    );
  }
  // d-min (D15.1): mangler strøm eller bølge her, er sluttetappen regnet
  // uten dem — det skal synes både i dekningen og på steget. Gjelder også
  // om etappen avvises under: avvisningen kan skyldes nettopp det manglende
  // feltet, og klassifiseringen skal bare kunne bli strengere.
  const currentMissing = env.current === undefined;
  const wavesMissing = env.waves === undefined;
  const envPartial = currentMissing || wavesMissing;
  const nodeCheck = checkHardNode(env, boat);
  if (!nodeCheck.ok) {
    return rejectedFinalLeg(
      out,
      "avvist-baatgrenser",
      nodeCheck.reason,
      remainingNm,
      envPartial,
    );
  }

  // R3: kystbufferen gjelder også sluttetappen — den er en reell seilas, ikke
  // en tegnet linje. Sjøgangen tas fra værfeltet der etappen faktisk starter.
  // I praksis ligger etappen som regel helt inne i havneunntaket, og da er
  // dette et gratis nei-svar; ligger den ikke det, skal den kontrolleres.
  const corridor = checkClearanceCorridor({
    mask,
    from: last,
    to: dest,
    chordNm: remainingNm,
    hsM: env.waves?.hsM,
    ends: { start: ctx.input.start, dest: ctx.input.dest },
    params: ctx.opts,
    stats: corridorStats,
  });
  if (!corridor.check.ok) {
    return rejectedFinalLeg(
      out,
      "avvist-farbarhet",
      corridor.check.reason,
      remainingNm,
      envPartial,
    );
  }

  // Kursen gjennom vannet som holder linjen mot målet etter strøm — samme
  // styr-mot-veipunkt-semantikk som evaluatoren (§5.11).
  const courseDeg = bearing(last, ctx.input.dest);
  const steer = courseToSteer(
    last,
    courseDeg,
    env,
    boat,
    ctx.opts.timeStepS,
    DEFAULT_EVALUATE_OPTIONS.courseToSteerIterations,
  );
  const kin = stepKinematics(
    last,
    steer.headingDeg,
    env,
    boat,
    ctx.opts.timeStepS,
  );
  if (kin === undefined) {
    return rejectedFinalLeg(
      out,
      "avvist-fart",
      `båten gjør ikke fart på kurs ${steer.headingDeg.toFixed(1)}° mot målet`,
      remainingNm,
      envPartial,
    );
  }
  // Framdrift *mot målet*: fart over grunn projisert på peilingen. Lot vi
  // strømmen sette båten sidelengs uten å korrigere for det (`corrected =
  // false`), er projeksjonen mindre enn `sogKn` — og den skal det regnes med.
  const madeGoodKn =
    kin.sogKn * Math.cos((angDiff(kin.sogDirDeg, courseDeg) * Math.PI) / 180);
  if (madeGoodKn <= MIN_SPEED_KN) {
    return rejectedFinalLeg(
      out,
      "avvist-fart",
      `ingen framdrift mot målet (${madeGoodKn.toFixed(2)} kn over grunn på peilingen)`,
      remainingNm,
      envPartial,
    );
  }

  // Bautstraff som ethvert annet steg. Halsen inn til `last` regnes fra
  // kursen inn dit og vinden i `last` — en tilnærming (søket brukte vinden i
  // forelderen), men å utelate straffen ville underrapportert tid, som er
  // nettopp bugen denne funksjonen fikser.
  const sailS = (remainingNm / madeGoodKn) * 3600;
  const penaltyS =
    last.headingDeg === null
      ? 0
      : tackPenaltyS(
          last.headingDeg,
          steer.headingDeg,
          tackOf(last.headingDeg, env.wind.fromDeg, ctx.opts.beatTwaDeg),
          tackOf(steer.headingDeg, env.wind.fromDeg, ctx.opts.beatTwaDeg),
          env.wind.speedKn,
          ctx.opts.tackParams,
        );

  // Flagg og kostbidrag fra samme funksjon som søket bruker — det er her
  // R5 (hardkodet 60°) forsvinner: `beatTwaDeg` er en parameter.
  const contribution = softContribution(
    kin,
    env,
    sailS,
    penaltyS,
    ctx.opts.beatTwaDeg,
  );
  const tS = last.tS + Math.round(contribution.dtS);
  const flags =
    contribution.flags |
    tss.flags |
    (last.flags & FLAG_USIKKER_TILLIT) |
    (currentMissing ? FLAG_STROM_DATA_MANGLER : 0) |
    (wavesMissing ? FLAG_SJOEGANG_DATA_MANGLER : 0) |
    reportingFlags(
      weather,
      ctx.input.dest.lat,
      ctx.input.dest.lon,
      ctx.input.departEpochS + tS,
    );
  out.push({
    lat: ctx.input.dest.lat,
    lon: ctx.input.dest.lon,
    tS,
    epochS: ctx.input.departEpochS + tS,
    headingDeg: steer.headingDeg,
    beatS: last.beatS + Math.round(contribution.beatS),
    motorS: last.motorS + Math.round(contribution.motorS),
    nightS: last.nightS + Math.round(contribution.nightS),
    twsKn: env.wind.speedKn,
    twdDeg: env.wind.fromDeg,
    bspKn: kin.bspKn,
    hsM: env.waves?.hsM ?? 0,
    flags,
    flagNames: flagNames(flags),
  });
  return {
    steps: out,
    hasDirectEnd: true,
    finalLeg: { status: "lagt-til", reason: null, shortfallNm: 0 },
    weatherPartial: envPartial,
  };
}

interface TotalsBase {
  readonly durationS: number;
  readonly distanceNm: number;
  readonly beatS: number;
  readonly motorS: number;
  readonly nightS: number;
  readonly beatAtNightS: number;
  readonly fuelL: number;
}

/**
 * Alle totaler regnes fra `steps` — aldri fra de konsoliderte etappene.
 * `beatAtNightS` finnes bare her: kryss og natt kan overlappe vilkårlig, så
 * den kan ikke utledes av `beatS` og `nightS` (spec §9 spm. 2).
 */
function totalsFromSteps(
  steps: readonly RouteStep[],
  ctx: ResultContext,
): TotalsBase {
  let distanceNm = 0;
  let beatS = 0;
  let motorS = 0;
  let nightS = 0;
  let beatAtNightS = 0;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]!;
    const cur = steps[i]!;
    const dt = cur.tS - prev.tS;
    distanceNm += haversineNm(prev, cur);
    const beat = (cur.flags & FLAG_KRYSS) !== 0;
    const night = (cur.flags & FLAG_NATT) !== 0;
    if (beat) beatS += dt;
    if ((cur.flags & FLAG_MOTOR) !== 0) motorS += dt;
    if (night) nightS += dt;
    if (beat && night) beatAtNightS += dt;
  }
  const durationS = steps.length > 0 ? steps[steps.length - 1]!.tS : 0;
  return {
    durationS,
    distanceNm,
    beatS,
    motorS,
    nightS,
    beatAtNightS,
    fuelL: (motorS / 3600) * ctx.input.boat.motorFuelLPerH,
  };
}

function buildAlternatives(
  ctx: ResultContext,
  front: readonly number[],
  primary: number,
  weights: CostWeights,
  corridor: CorridorCheckContext,
): RouteAlternative[] {
  const others = front.filter((index) => index !== primary);
  const ranked = [...others].sort((a, b) => {
    const sa = costScore(ctx.arena.costOf(a), weights);
    const sb = costScore(ctx.arena.costOf(b), weights);
    if (sa !== sb) return sa - sb;
    return a - b;
  });
  const limit = Math.max(0, ctx.opts.maxLabelsPerState - 1);
  const out: RouteAlternative[] = [];
  for (const index of ranked.slice(0, limit)) {
    const steps = labelChain(ctx.arena, index).map((i, at) =>
      stepFrom(ctx.arena, i, ctx.input.departEpochS, at === 0, ctx.input.weather),
    );
    const legs = legsFrom(
      consolidateSteps(steps, ctx.input.mask, ctx.opts.tssParams, corridor),
      -1,
    );
    const cost: CostVector = ctx.arena.costOf(index);
    let distanceNm = 0;
    for (let i = 1; i < steps.length; i++) {
      distanceNm += haversineNm(steps[i - 1]!, steps[i]!);
    }
    out.push({
      cost,
      arrivalEpochS: ctx.input.departEpochS + cost.tS,
      distanceNm,
      rankScore: costScore(cost, weights),
      legs,
    });
  }
  return out;
}

export { DIRECT_FINAL_LEG_THRESHOLD_NM, CONSOLIDATE_COURSE_TOLERANCE_DEG };
