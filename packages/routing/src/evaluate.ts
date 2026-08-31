/**
 * Rute-evaluator (docs/specs/rutemotor.md §5.11).
 *
 * Evaluerer en **gitt** rute — en sekvens veipunkter — under et **vilkårlig**
 * værfelt, med nøyaktig samme kinematikk-, kost- og hard-constraint-semantikk
 * som søket. Det er dette som gjør det mulig å spørre «hvordan går
 * kontrollruten i medlem 17?» uten å søke på nytt, og å måle hva et billigere
 * søk taper mot full Pareto (E1′-valideringen).
 *
 * **Én-sannhet-prinsippet er hele poenget med denne filen.** Den er en tynn
 * løkke over de samme frie funksjonene søket bruker — `stepKinematics`,
 * `softContribution`, `accumulateSoft`, `checkHardNode`, `checkClearance`,
 * `checkSegment`, `checkTssStep`, `tackOf`/`tackPenaltyS`, `daylightArrival`.
 * Her finnes ingen kopiert kinematikk og ingen kopiert kostlogikk. Avviker
 * evaluatoren fra søket, er det en bug i én av dem, og
 * `evaluate.test.ts`-egenskapstesten over alle golden-fiksturene skal fange
 * den.
 *
 * **Semantikk: styr-mot-veipunkt, ikke replay-av-kurs.** Ruten er en geometri,
 * ikke en kursliste. Under perturbert vind og strøm driver båten av linjen, og
 * en seiler korrigerer for det. Evaluatoren setter derfor per tidssteg den
 * kursen gjennom vannet som gjør at resultanten *etter strøm* peker mot neste
 * veipunkt.
 *
 * Ren og deterministisk som resten av motoren: ingen I/O, ingen klokke, ingen
 * `Math.random`, ingen `await`.
 */
import type { LatLon } from "@morild/geo";
import { haversineNm, norm180, norm360 } from "@morild/geo";
import type {
  BoatModel,
  NavigabilityMask,
  WeatherField,
} from "./contracts.js";
import type { CostVector } from "./cost.js";
import {
  FLAG_KRYSS,
  FLAG_NATT,
  FLAG_USIKKER_TILLIT,
  flagNames,
  ZERO_COST,
} from "./cost.js";
import { daylightArrival } from "./daylight.js";
import type { NodeEnvironment } from "./expand.js";
import {
  accumulateSoft,
  checkClearance,
  checkHardNode,
  checkSegment,
  checkTssStep,
  environmentAt,
  softContribution,
  stepKinematics,
} from "./expand.js";
import type { RouteOptions } from "./options.js";
import { withDefaults } from "./options.js";
import type { RouteStep } from "./result.js";
import type { Tack } from "./tack.js";
import { tackOf, tackPenaltyS } from "./tack.js";

/** Hvorfor evalueringen stoppet. Aldri bare «false». */
export type EvalRejectionKind =
  | "noWeather"
  | "boatLimits"
  | "noSpeed"
  | "point"
  | "clearance"
  | "segment"
  | "tss"
  | "daylightArrival"
  | "noProgress"
  | "stepBudget";

/**
 * En hard avvisning, med posisjon og tid. «Medlem 17 feiler» er ubrukelig;
 * «medlem 17 mister klaringen 0,31 nm sør for Vinga etter 9 t 30 min» er det
 * som kan handles på.
 */
export interface EvalRejection {
  readonly kind: EvalRejectionKind;
  readonly reason: string;
  readonly lat: number;
  readonly lon: number;
  /** Sekunder siden avgang da avvisningen oppstod. */
  readonly tS: number;
  readonly epochS: number;
  /** Veipunktet det ble styrt mot (indeks i `waypoints`). */
  readonly waypointIndex: number;
  /** Indeks i `steps` for det steget som ble forsøkt (= steps.length). */
  readonly stepIndex: number;
}

export interface EvaluateOptions {
  /** Veipunktet regnes som nådd innenfor denne avstanden. Standard 0,01 nm. */
  readonly waypointToleranceNm: number;
  /** Iterasjoner i strømtriangelet (fastpunkt). Standard 6. */
  readonly courseToSteerIterations: number;
  /** Maks tidssteg mot ett og samme veipunkt. Standard 500. */
  readonly maxStepsPerWaypoint: number;
  /** Maks tidssteg for hele evalueringen. Standard 5000. */
  readonly maxTotalSteps: number;
  /**
   * Antall påfølgende tidssteg uten at avstanden til veipunktet minker, før
   * evalueringen gir opp med `noProgress`. Standard 20.
   */
  readonly noProgressSteps: number;
}

export const DEFAULT_EVALUATE_OPTIONS: EvaluateOptions = Object.freeze({
  waypointToleranceNm: 0.01,
  courseToSteerIterations: 6,
  maxStepsPerWaypoint: 500,
  maxTotalSteps: 5000,
  noProgressSteps: 20,
});

export interface EvaluateRouteInput {
  /** Ruten som skal seiles. `waypoints[0]` er avgangspunktet. */
  readonly waypoints: readonly LatLon[];
  readonly departEpochS: number;
  readonly weather: WeatherField;
  /** `undefined` ⇒ ingen farbarhetssjekk (§6) — evalueringen er da degradert. */
  readonly mask: NavigabilityMask | undefined;
  readonly boat: BoatModel;
  /**
   * Havneendene kystbuffer-unntaket måles mot (§5.3 steg 13). Standard er
   * første og siste veipunkt. Settes eksplisitt når man evaluerer en **del**
   * av en rute: unntaket gjelder anløp av havn, ikke enden av det utsnittet
   * man tilfeldigvis ba om.
   */
  readonly harbourEnds?:
    | { readonly start: LatLon; readonly dest: LatLon }
    | undefined;
  /** Samme opsjoner som søket. `timeStepS` må matche for én-sannhet-testen. */
  readonly options?: Partial<RouteOptions> | undefined;
  readonly evaluateOptions?: Partial<EvaluateOptions> | undefined;
}

export interface RouteEvaluation {
  /** Nådde ruten siste veipunkt uten hard avvisning? */
  readonly feasible: boolean;
  readonly rejection: EvalRejection | null;
  /** Kostnadsvektoren fram til der evalueringen stoppet. */
  readonly cost: CostVector;
  /** Ett innslag per tidssteg, ukonsolidert. `steps[0]` er avgangspunktet. */
  readonly steps: readonly RouteStep[];
  /** Antall veipunkter som faktisk ble nådd (utenom avgangspunktet). */
  readonly waypointsReached: number;
  readonly distanceNm: number;
  /** «Kryss-timer i mørket» (F3.4), akkumulert fra steg-flaggene. */
  readonly beatAtNightS: number;
  readonly fuelL: number;
  readonly arrivalEpochS: number;
  readonly daylightArrival: boolean;
  /** Unionen av alle stegflagg — rask indikator på hva som skjedde. */
  readonly flags: number;
  readonly flagNames: readonly string[];
  /**
   * Antall steg der strømtriangelet ikke kunne løses (strømmen på tvers er
   * sterkere enn båtfarten). Da styres det rett mot veipunktet og avdriften
   * aksepteres — best effort, men det skal telles, ikke skjules (N2).
   */
  readonly uncorrectedDriftSteps: number;
}

/**
 * Retning fra a til b i **samme flate approksimasjon som `stepLatLon`**.
 *
 * Dette er den nøyaktige inversen av kinematikken søket flytter båten med.
 * Storsirkelpeiling (`bearing`) ville vært like «riktig» fysisk, men innført
 * et systematisk avvik på inntil ~0,1° per steg som søket ikke har — og da
 * hadde evaluatoren målt geometrikonvensjonen i stedet for kostnaden.
 */
function flatCourseDeg(from: LatLon, to: LatLon): number {
  const north = (to.lat - from.lat) * 60;
  const east =
    (to.lon - from.lon) * 60 * Math.cos((from.lat * Math.PI) / 180);
  return norm360((Math.atan2(east, north) * 180) / Math.PI);
}

/** Avstand i samme flate metrikk som `flatCourseDeg`. */
function flatDistanceNm(from: LatLon, to: LatLon): number {
  const north = (to.lat - from.lat) * 60;
  const east =
    (to.lon - from.lon) * 60 * Math.cos((from.lat * Math.PI) / 180);
  return Math.hypot(north, east);
}

export interface CourseToSteer {
  readonly headingDeg: number;
  /** Fant vi en kurs som faktisk holder linjen mot veipunktet? */
  readonly corrected: boolean;
}

/**
 * Kursen gjennom vannet som gjør at resultanten etter strøm peker mot
 * `targetCourseDeg` — det klassiske strømtriangelet.
 *
 * Med tverrkomponenten `cross` av strømmen langs målretningen er kravet
 * `bsp · sin(h − θ) + cross = 0`, altså `h = θ + asin(−cross/bsp)`. Fordi
 * polarfarten selv avhenger av kursen, løses det med fastpunktiterasjon —
 * avdriftsvinkelen er typisk under 3°, så den konvergerer på et par runder.
 *
 * `bsp` hentes fra `stepKinematics`, ikke fra en egen fartsberegning: farten
 * har én sannhet i denne motoren.
 *
 * Er strømmen på tvers sterkere enn båtfarten, finnes ingen slik kurs. Da
 * styres det rett mot veipunktet og avdriften aksepteres — best effort, og
 * steget telles i `uncorrectedDriftSteps`.
 */
export function courseToSteer(
  from: LatLon,
  targetCourseDeg: number,
  env: NodeEnvironment,
  boat: BoatModel,
  timeStepS: number,
  iterations: number = DEFAULT_EVALUATE_OPTIONS.courseToSteerIterations,
): CourseToSteer {
  const cu = env.current?.u ?? 0;
  const cv = env.current?.v ?? 0;
  if (cu === 0 && cv === 0) {
    return { headingDeg: targetCourseDeg, corrected: true };
  }
  const theta = (targetCourseDeg * Math.PI) / 180;
  const cross = cu * Math.cos(theta) - cv * Math.sin(theta);

  let headingDeg = targetCourseDeg;
  for (let i = 0; i < iterations; i++) {
    const kin = stepKinematics(from, headingDeg, env, boat, timeStepS);
    if (kin === undefined) {
      return { headingDeg: targetCourseDeg, corrected: false };
    }
    const sin = -cross / kin.bspKn;
    if (!(Math.abs(sin) <= 1)) {
      return { headingDeg: targetCourseDeg, corrected: false };
    }
    const next = norm360(
      targetCourseDeg + (Math.asin(sin) * 180) / Math.PI,
    );
    const delta = Math.abs(norm180(next - headingDeg));
    headingDeg = next;
    if (delta < 1e-9) break;
  }
  return { headingDeg, corrected: true };
}

interface EvalState {
  pos: LatLon;
  cost: CostVector;
  prevHeadingDeg: number | null;
  prevTack: Tack;
}

/**
 * Seiler den gitte ruten gjennom det gitte værfeltet.
 *
 * Evalueringen stopper ved **første** harde avvisning; delresultatet fram dit
 * returneres, slik at man ser hvor langt ruten holdt og hvorfor den ikke holdt
 * lenger (N2 — ærlig degradering).
 */
export function evaluateRoute(input: EvaluateRouteInput): RouteEvaluation {
  const opts: RouteOptions = withDefaults(input.options ?? {});
  const ev: EvaluateOptions = {
    ...DEFAULT_EVALUATE_OPTIONS,
    ...(input.evaluateOptions ?? {}),
  };
  const { waypoints, weather, boat, mask, departEpochS } = input;

  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  if (first === undefined || last === undefined) {
    return emptyEvaluation(input, {
      kind: "noProgress",
      reason: "ruten har ingen veipunkter",
      lat: 0,
      lon: 0,
      tS: 0,
      epochS: departEpochS,
      waypointIndex: 0,
      stepIndex: 0,
    });
  }

  const harbourStart = input.harbourEnds?.start ?? first;
  const harbourDest = input.harbourEnds?.dest ?? last;

  const state: EvalState = {
    pos: { lat: first.lat, lon: first.lon },
    cost: ZERO_COST,
    prevHeadingDeg: null,
    prevTack: 0,
  };

  const steps: RouteStep[] = [startStep(first, departEpochS)];
  let distanceNm = 0;
  let beatAtNightS = 0;
  let unionFlags = 0;
  let uncorrectedDriftSteps = 0;
  let waypointsReached = 0;
  let totalSteps = 0;

  const stop = (r: EvalRejection): RouteEvaluation =>
    finish({
      input,
      opts,
      steps,
      cost: state.cost,
      rejection: r,
      distanceNm,
      beatAtNightS,
      unionFlags,
      uncorrectedDriftSteps,
      waypointsReached,
    });

  for (let w = 1; w < waypoints.length; w++) {
    const target = waypoints[w]!;
    const isFinalWaypoint = w === waypoints.length - 1;
    let stepsToWaypoint = 0;
    let bestRemainingNm = Infinity;
    let sinceImprovement = 0;

    for (;;) {
      const remainingNm = flatDistanceNm(state.pos, target);
      if (remainingNm <= ev.waypointToleranceNm) break;

      const tS = state.cost.tS;
      const epochS = departEpochS + tS;
      const here: Omit<EvalRejection, "kind" | "reason"> = {
        lat: state.pos.lat,
        lon: state.pos.lon,
        tS,
        epochS,
        waypointIndex: w,
        stepIndex: steps.length,
      };

      if (++stepsToWaypoint > ev.maxStepsPerWaypoint) {
        return stop({
          ...here,
          kind: "stepBudget",
          reason: `over ${ev.maxStepsPerWaypoint} tidssteg mot veipunkt ${w}`,
        });
      }
      if (++totalSteps > ev.maxTotalSteps) {
        return stop({
          ...here,
          kind: "stepBudget",
          reason: `over ${ev.maxTotalSteps} tidssteg totalt`,
        });
      }
      if (remainingNm < bestRemainingNm - 1e-9) {
        bestRemainingNm = remainingNm;
        sinceImprovement = 0;
      } else if (++sinceImprovement > ev.noProgressSteps) {
        return stop({
          ...here,
          kind: "noProgress",
          reason: `ingen framgang mot veipunkt ${w} på ${ev.noProgressSteps} tidssteg (${remainingNm.toFixed(2)} nm igjen)`,
        });
      }

      // Vi ekstrapolerer aldri utenfor værfeltets gyldige tidsvindu.
      if (epochS < weather.validFromS || epochS > weather.validToS) {
        return stop({
          ...here,
          kind: "noWeather",
          reason: "utenfor værfeltets gyldige tidsvindu",
        });
      }
      const env = environmentAt(weather, state.pos, epochS);
      if (env === undefined) {
        return stop({
          ...here,
          kind: "noWeather",
          reason: "ingen vinddata i posisjonen",
        });
      }

      // Hard: båtens ytelsesgrenser gjelder noden som helhet.
      const nodeCheck = checkHardNode(env, boat);
      if (!nodeCheck.ok) {
        return stop({ ...here, kind: "boatLimits", reason: nodeCheck.reason });
      }

      // Styr mot veipunktet: kurs gjennom vannet som holder linjen.
      const targetCourseDeg = flatCourseDeg(state.pos, target);
      const steer = courseToSteer(
        state.pos,
        targetCourseDeg,
        env,
        boat,
        opts.timeStepS,
        ev.courseToSteerIterations,
      );
      if (!steer.corrected) uncorrectedDriftSteps++;

      const kin = stepKinematics(
        state.pos,
        steer.headingDeg,
        env,
        boat,
        opts.timeStepS,
      );
      if (kin === undefined) {
        return stop({
          ...here,
          kind: "noSpeed",
          reason: `båten gjør ikke fart på kurs ${steer.headingDeg.toFixed(1)}°`,
        });
      }

      // Delsteg inn til veipunktet: uten dette ville evaluatoren akkumulert
      // et helt tidssteg for de siste hundre metrene.
      const reachesTarget =
        kin.distanceNm + ev.waypointToleranceNm >= remainingNm;
      const fraction = reachesTarget
        ? Math.min(1, remainingNm / kin.distanceNm)
        : 1;
      const next: LatLon = reachesTarget
        ? { lat: target.lat, lon: target.lon }
        : kin.next;

      // Halseside og bautstraff tres gjennom nøyaktig som i søket.
      // Startpunktet har ingen kurs inn (NO_COURSE) ⇒ straff 0 første steg.
      const newTack = tackOf(steer.headingDeg, env.wind.fromDeg, opts.beatTwaDeg);
      const penaltyS =
        state.prevHeadingDeg === null
          ? 0
          : tackPenaltyS(
              state.prevHeadingDeg,
              steer.headingDeg,
              state.prevTack,
              newTack,
              env.wind.speedKn,
              opts.tackParams,
            );

      const contribution = softContribution(
        kin,
        env,
        opts.timeStepS * fraction,
        penaltyS,
        opts.beatTwaDeg,
      );
      let flags = contribution.flags;

      // --- Harde sjekker, re-kjørt uten cache fra noe søk (§5.10-prinsippet).
      if (mask !== undefined) {
        const pointVerdict = mask.pointVerdict(next.lat, next.lon);
        if (!pointVerdict.passable || pointVerdict.tillit === "no-go") {
          return stop({
            ...here,
            kind: "point",
            reason: pointVerdict.reason ?? "punktet er ikke farbart",
          });
        }
        if (pointVerdict.tillit === "usikkert") flags |= FLAG_USIKKER_TILLIT;
      }

      if (mask !== undefined && opts.minOffingNm > 0) {
        const clearance = checkClearance(
          mask,
          next,
          env.waves?.hsM,
          () => ({
            toStartNm: haversineNm(next, harbourStart),
            toDestNm: haversineNm(next, harbourDest),
          }),
          opts,
        );
        flags |= clearance.flags;
        if (!clearance.check.ok) {
          return stop({
            ...here,
            kind: "clearance",
            reason: clearance.check.reason,
          });
        }
      }

      const segment = checkSegment(mask, state.pos, next);
      if (!segment.ok) {
        return stop({ ...here, kind: "segment", reason: segment.reason });
      }
      if (mask !== undefined) {
        const verdict = mask.segmentVerdict(
          state.pos.lat,
          state.pos.lon,
          next.lat,
          next.lon,
        );
        if (verdict.tillit === "usikkert") flags |= FLAG_USIKKER_TILLIT;
      }

      const tss = checkTssStep(mask, state.pos, next, opts.tssParams);
      if (!tss.check.ok) {
        return stop({ ...here, kind: "tss", reason: tss.check.reason });
      }
      flags |= tss.flags;

      // --- Steget godtas.
      const cost = accumulateSoft(state.cost, contribution);
      const dtS = cost.tS - state.cost.tS;
      if ((flags & FLAG_KRYSS) !== 0 && (flags & FLAG_NATT) !== 0) {
        beatAtNightS += dtS;
      }
      distanceNm += haversineNm(state.pos, next);
      unionFlags |= flags;

      steps.push({
        lat: next.lat,
        lon: next.lon,
        tS: cost.tS,
        epochS: departEpochS + cost.tS,
        headingDeg: steer.headingDeg,
        beatS: cost.beatS,
        motorS: cost.motorS,
        nightS: cost.nightS,
        twsKn: env.wind.speedKn,
        twdDeg: env.wind.fromDeg,
        bspKn: kin.bspKn,
        hsM: env.waves?.hsM ?? 0,
        flags,
        flagNames: flagNames(flags),
      });

      state.pos = next;
      state.cost = cost;
      state.prevHeadingDeg = steer.headingDeg;
      state.prevTack = newTack;

      if (reachesTarget) break;
    }

    waypointsReached = w;

    // Dagslys-ankomst gjelder kun sluttankomsten (besluttet 2026-08-30).
    if (isFinalWaypoint && opts.requireDaylightArrival) {
      const arrival = daylightArrival(
        target.lat,
        target.lon,
        departEpochS + state.cost.tS,
      );
      if (!arrival.isDaylight) {
        return stop({
          kind: "daylightArrival",
          reason: `ankomst utenfor dagslysvinduet (${arrival.kind})`,
          lat: target.lat,
          lon: target.lon,
          tS: state.cost.tS,
          epochS: departEpochS + state.cost.tS,
          waypointIndex: w,
          stepIndex: steps.length - 1,
        });
      }
    }
  }

  return finish({
    input,
    opts,
    steps,
    cost: state.cost,
    rejection: null,
    distanceNm,
    beatAtNightS,
    unionFlags,
    uncorrectedDriftSteps,
    waypointsReached,
  });
}

/**
 * Avgangspunktet som steg 0. Diagnostikkfeltene står på null, nøyaktig som
 * startetiketten i arenaen — steg 0 er en posisjon, ikke et seilt steg.
 */
function startStep(pos: LatLon, departEpochS: number): RouteStep {
  return {
    lat: pos.lat,
    lon: pos.lon,
    tS: 0,
    epochS: departEpochS,
    headingDeg: null,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    twsKn: 0,
    twdDeg: 0,
    bspKn: 0,
    hsM: 0,
    flags: 0,
    flagNames: [],
  };
}

interface FinishArgs {
  readonly input: EvaluateRouteInput;
  readonly opts: RouteOptions;
  readonly steps: readonly RouteStep[];
  readonly cost: CostVector;
  readonly rejection: EvalRejection | null;
  readonly distanceNm: number;
  readonly beatAtNightS: number;
  readonly unionFlags: number;
  readonly uncorrectedDriftSteps: number;
  readonly waypointsReached: number;
}

function finish(a: FinishArgs): RouteEvaluation {
  const arrivalEpochS = a.input.departEpochS + a.cost.tS;
  const end = a.steps[a.steps.length - 1];
  const arrival =
    end === undefined
      ? { isDaylight: false }
      : daylightArrival(end.lat, end.lon, arrivalEpochS);
  return {
    feasible: a.rejection === null,
    rejection: a.rejection,
    cost: a.cost,
    steps: a.steps,
    waypointsReached: a.waypointsReached,
    distanceNm: a.distanceNm,
    beatAtNightS: a.beatAtNightS,
    fuelL: (a.cost.motorS / 3600) * a.input.boat.motorFuelLPerH,
    arrivalEpochS,
    daylightArrival: arrival.isDaylight,
    flags: a.unionFlags,
    flagNames: flagNames(a.unionFlags),
    uncorrectedDriftSteps: a.uncorrectedDriftSteps,
  };
}

function emptyEvaluation(
  input: EvaluateRouteInput,
  rejection: EvalRejection,
): RouteEvaluation {
  return {
    feasible: false,
    rejection,
    cost: ZERO_COST,
    steps: [],
    waypointsReached: 0,
    distanceNm: 0,
    beatAtNightS: 0,
    fuelL: 0,
    arrivalEpochS: input.departEpochS,
    daylightArrival: false,
    flags: 0,
    flagNames: [],
    uncorrectedDriftSteps: 0,
  };
}

export { flatCourseDeg, flatDistanceNm };
