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
import type { NavigabilityMask } from "./contracts.js";
import type { CostVector, CostWeights } from "./cost.js";
import {
  costScore,
  dominates,
  FLAG_KRYSS,
  FLAG_MOTOR,
  FLAG_NATT,
  flagNames,
  scaledRankingWeights,
} from "./cost.js";
import { daylightArrival } from "./daylight.js";
import type { LabelStore } from "./label-store.js";
import type { RouteOptions } from "./options.js";
import type {
  AbortReason,
  IsochroneSnapshot,
  RouteAlternative,
  RouteLeg,
  RouteResult,
  RouteStep,
  SegmentRef,
} from "./result.js";
import type { RouteInput } from "./search.js";
import type { TssRuleParams } from "./tss.js";
import { applyTssRule, DEFAULT_TSS_PARAMS } from "./tss.js";

/** Under denne avstanden regnes ruten som framme (v1-arv). */
const DIRECT_FINAL_LEG_THRESHOLD_NM = 0.3;

/** Kursforskjell under denne slås sammen i konsolideringen (v1: 8°). */
const CONSOLIDATE_COURSE_TOLERANCE_DEG = 8;

export interface ResultContext {
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
  readonly vmaxKn: number;
  readonly iterations: number;
  readonly peakActiveLabels: number;
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

function stepFrom(
  arena: LabelArena,
  index: number,
  departEpochS: number,
  isStart: boolean,
): RouteStep {
  const flags = arena.flags[index]!;
  return {
    lat: arena.lat[index]!,
    lon: arena.lon[index]!,
    tS: arena.tS[index]!,
    epochS: departEpochS + arena.tS[index]!,
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
    if (mask !== undefined && !mergeIsSafe(mask, prev, next, tssParams)) {
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

/** Består det sammenslåtte segmentet både farbarhet og TSS-regelen? */
function mergeIsSafe(
  mask: NavigabilityMask,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  tssParams: TssRuleParams,
): boolean {
  if (!mask.segmentVerdict(from.lat, from.lon, to.lat, to.lon).passable) {
    return false;
  }
  const tss = applyTssRule(
    mask.tssVerdict(from.lat, from.lon, to.lat, to.lon),
    tssParams,
  );
  return tss.kind !== "reject";
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
    if (verdict.tillit === "usikkert") {
      flagged.push(ref("usikkert", verdict.reason ?? "usikker dekning"));
    } else if (tss.kind === "along-with-direction") {
      flagged.push(ref("trygt", "følger TSS med trafikkretningen"));
    }
  }
  return { failing, flagged };
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
  const primary = ranked[0] ?? ctx.bestIndex;

  const rawSteps = labelChain(arena, primary).map((index, i) =>
    stepFrom(arena, index, input.departEpochS, i === 0),
  );
  const withEnd = appendDirectFinalStep(rawSteps, ctx);
  const steps = withEnd.steps;

  const consolidated = consolidateSteps(steps, input.mask, opts.tssParams);
  const directEndIndex = withEnd.hasDirectEnd ? consolidated.length - 1 : -1;
  const legs = legsFrom(consolidated, directEndIndex);

  const totalsBase = totalsFromSteps(steps, ctx);
  const arrivalEpochS = input.departEpochS + totalsBase.durationS;
  const arrival = daylightArrival(
    input.dest.lat,
    input.dest.lon,
    arrivalEpochS,
  );

  const { failing, flagged } = recheckRoute(legs, input.mask, opts);
  const maskCoverage = input.mask?.coverage ?? "none";
  const recheckPassed = input.mask !== undefined && failing.length === 0;
  const verdict: RouteResult["safety"]["verdict"] =
    input.mask === undefined || failing.length > 0
      ? "usikker-rute"
      : flagged.length > 0 || maskCoverage !== "full"
        ? "usikkert"
        : "trygt";

  const alternatives = buildAlternatives(ctx, front, primary, rankingWeights);

  return {
    reached: ctx.reached,
    abortReason: ctx.abortReason,
    legs,
    steps,
    totals: {
      ...totalsBase,
      arrivalEpochS,
      daylightArrival: arrival.isDaylight,
      exceedsMaxContinuousLeg:
        opts.maxContinuousLegS !== undefined &&
        totalsBase.durationS > opts.maxContinuousLegS,
    },
    safety: {
      verdict,
      recheckPassed,
      failingSegments: failing,
      flaggedSegments: flagged,
    },
    coverage: {
      mask: maskCoverage,
      weather: ctx.weatherPartial ? "partial" : "full",
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
      pruned: ctx.pruned,
    },
  };
}

/**
 * Direkte sluttetappe (v1-arv): når målet er nådd men siste punkt er mer enn
 * 0,3 nm unna, legges en etappe rett til målet — **kun** hvis segmentet er
 * farbart. Den merkes eksplisitt slik at UI kan si det.
 */
function appendDirectFinalStep(
  steps: readonly RouteStep[],
  ctx: ResultContext,
): { steps: RouteStep[]; hasDirectEnd: boolean } {
  const out = [...steps];
  if (!ctx.reached) return { steps: out, hasDirectEnd: false };
  const last = out[out.length - 1];
  if (last === undefined) return { steps: out, hasDirectEnd: false };

  const remainingNm = haversineNm(last, ctx.input.dest);
  if (remainingNm <= DIRECT_FINAL_LEG_THRESHOLD_NM) {
    return { steps: out, hasDirectEnd: false };
  }
  // Den direkte sluttetappen må bestå de samme harde sjekkene som ethvert
  // annet segment. Spec §5.8 nevner bare `segmentVerdict`, men TSS-regelen
  // gjelder like fullt: golden-kjøringen av «tss-ved-skagen» ga
  // `usikker-rute` fordi sluttetappen inn til Skagen la seg langs leden mot
  // trafikkretningen. Etterbehandling skal aldri kunne innføre et brudd
  // søket selv ville avvist.
  const mask = ctx.input.mask;
  if (
    mask !== undefined &&
    !mergeIsSafe(mask, last, destAsStep(ctx), ctx.opts.tssParams)
  ) {
    return { steps: out, hasDirectEnd: false };
  }

  const headingDeg = bearing(last, ctx.input.dest);
  const wind = ctx.input.weather.wind(last.lat, last.lon, last.epochS);
  const waves = ctx.input.weather.waves(last.lat, last.lon, last.epochS);
  const boat = ctx.input.boat;
  let bspKn = 0;
  let flags = last.flags & (FLAG_MOTOR | FLAG_NATT | FLAG_KRYSS);
  if (wind !== undefined) {
    const twa = angDiff(wind.fromDeg, headingDeg);
    const waveF =
      waves === undefined
        ? 1
        : boat.waveFactor(
            waves.hsM,
            waves.tpS,
            waves.fromDeg === undefined
              ? twa
              : angDiff(waves.fromDeg, headingDeg),
          );
    bspKn = boat.boatSpeedKn(wind.speedKn, twa) * waveF;
    if (boat.motorThresholdKn > 0 && bspKn < boat.motorThresholdKn) {
      bspKn = boat.motorSpeedKn * waveF;
      flags |= FLAG_MOTOR;
    }
    flags = twa < 60 ? flags | FLAG_KRYSS : flags & ~FLAG_KRYSS;
  }
  const extraS = bspKn > 0.1 ? Math.round((remainingNm / bspKn) * 3600) : 0;
  const tS = last.tS + extraS;
  const extraBeatS = (flags & FLAG_KRYSS) !== 0 ? extraS : 0;
  const extraMotorS = (flags & FLAG_MOTOR) !== 0 ? extraS : 0;
  const extraNightS = (flags & FLAG_NATT) !== 0 ? extraS : 0;
  out.push({
    lat: ctx.input.dest.lat,
    lon: ctx.input.dest.lon,
    tS,
    epochS: ctx.input.departEpochS + tS,
    headingDeg,
    beatS: last.beatS + extraBeatS,
    motorS: last.motorS + extraMotorS,
    nightS: last.nightS + extraNightS,
    twsKn: wind?.speedKn ?? 0,
    twdDeg: wind?.fromDeg ?? 0,
    bspKn,
    hsM: waves?.hsM ?? 0,
    flags,
    flagNames: flagNames(flags),
  });
  return { steps: out, hasDirectEnd: true };
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
      stepFrom(ctx.arena, i, ctx.input.departEpochS, at === 0),
    );
    const legs = legsFrom(
      consolidateSteps(steps, ctx.input.mask, ctx.opts.tssParams),
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
