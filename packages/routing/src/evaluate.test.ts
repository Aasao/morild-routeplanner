/**
 * Enhets- og egenskapstester for rute-evaluatoren (spec §5.11, §8.3).
 *
 * Den viktigste testen i filen er den siste: **én-sannhet-testen**. Den kjører
 * søket på hver golden-fikstur, evaluerer den ukonsoliderte stegsekvensen
 * søket selv fant mot nøyaktig samme felt/maske/båt/`timeStepS`, og krever at
 * evaluatoren kommer fram til samme kostnadsvektor. Avviker de to, har vi to
 * sannheter om hva en rute koster, og da er alt annet i motoren usikkert.
 */
import { describe, expect, it } from "vitest";
import { angDiff, haversineNm, stepLatLon } from "@morild/geo";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import {
  constantWeather,
  emptyWeather,
  syntheticField,
} from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import type { NodeEnvironment } from "./expand.js";
import { isWindAgainstCurrent, stepKinematics } from "./expand.js";
import {
  courseToSteer,
  evaluateRoute,
  flatCourseDeg,
  flatDistanceNm,
} from "./evaluate.js";
import { planRoute } from "./search.js";
import type { RouteStep } from "./result.js";

const DEPART_S = 1781668800; // 2026-06-15 04:00 UTC, som golden-fiksturene.

function envOf(
  windKn: number,
  windFromDeg: number,
  current?: { u: number; v: number },
): NodeEnvironment {
  const wind = { speedKn: windKn, fromDeg: windFromDeg };
  return {
    wind,
    waves: undefined,
    current,
    isNight: false,
    epochS: DEPART_S,
    windAgainstCurrent: isWindAgainstCurrent(wind, current),
  };
}

describe("flat geometri inverterer stepLatLon", () => {
  it("gir tilbake nøyaktig kursen og distansen stepLatLon ble kalt med", () => {
    const from = { lat: 58.42, lon: 10.77 };
    for (const heading of [0, 37, 91, 180, 244, 359]) {
      for (const distanceNm of [0.05, 1.7, 12]) {
        const to = stepLatLon(from.lat, from.lon, heading, distanceNm);
        expect(flatCourseDeg(from, to)).toBeCloseTo(heading, 9);
        expect(flatDistanceNm(from, to)).toBeCloseTo(distanceNm, 9);
      }
    }
  });
});

describe("courseToSteer — strømtriangelet", () => {
  it("styrer rett mot veipunktet når det ikke er strøm", () => {
    const env = envOf(12, 240);
    const steer = courseToSteer(
      { lat: 58, lon: 10.6 },
      330,
      env,
      testBoat(),
      1800,
    );
    expect(steer.corrected).toBe(true);
    expect(steer.headingDeg).toBe(330);
  });

  it("legger opp mot strømmen slik at resultanten peker mot veipunktet", () => {
    // Strøm rett mot øst (u = 1,2 kn) mens vi vil nordover.
    const env = envOf(14, 90, { u: 1.2, v: 0 });
    const from = { lat: 58, lon: 10.6 };
    const steer = courseToSteer(from, 0, env, testBoat(), 1800);
    expect(steer.corrected).toBe(true);
    // Kursen skal legges mot vest for å motvirke settet mot øst.
    expect(steer.headingDeg).toBeGreaterThan(180);
    const kin = stepKinematics(
      from,
      steer.headingDeg,
      env,
      testBoat(),
      1800,
    );
    expect(kin).toBeDefined();
    // Resultanten treffer målretningen — det er hele poenget.
    expect(angDiff(kin!.sogDirDeg, 0)).toBeLessThan(1e-6);
  });

  it("gir opp ærlig når strømmen på tvers er sterkere enn båtfarten", () => {
    // 12 knop strøm rett på tvers: ingen kurs holder linjen.
    const env = envOf(4, 0, { u: 12, v: 0 });
    const steer = courseToSteer(
      { lat: 58, lon: 10.6 },
      0,
      env,
      testBoat({ motorThresholdKn: 0 }),
      1800,
    );
    expect(steer.corrected).toBe(false);
    expect(steer.headingDeg).toBe(0);
  });
});

describe("evaluateRoute — grunnadferd", () => {
  const weather = () =>
    constantWeather({
      speedKn: 12,
      fromDeg: 270,
      validFromS: DEPART_S - 3600,
      validToS: DEPART_S + 4 * 24 * 3600,
    });

  it("seiler en enkel etappe og akkumulerer tid, avstand og steg", () => {
    const result = evaluateRoute({
      waypoints: [
        { lat: 58.0, lon: 10.6 },
        { lat: 58.3, lon: 10.6 },
      ],
      departEpochS: DEPART_S,
      weather: weather(),
      mask: undefined,
      boat: testBoat(),
      options: { timeStepS: 1800 },
    });
    expect(result.feasible).toBe(true);
    expect(result.rejection).toBeNull();
    expect(result.waypointsReached).toBe(1);
    expect(result.steps.length).toBeGreaterThan(1);
    expect(result.cost.tS).toBeGreaterThan(0);
    expect(result.distanceNm).toBeGreaterThan(17);
    expect(result.distanceNm).toBeLessThan(19);
    // Siste steg lander nøyaktig på veipunktet.
    const last = result.steps[result.steps.length - 1]!;
    expect(last.lat).toBeCloseTo(58.3, 12);
    expect(last.tS).toBe(result.cost.tS);
  });

  it("gir ingen bautstraff på første steg (startetiketten er NO_COURSE)", () => {
    // Én etappe kort nok til å tas på ett tidssteg: da er tS = timeStepS
    // nøyaktig hvis og bare hvis straffen på første steg er 0.
    const from = { lat: 58.0, lon: 10.6 };
    const env = envOf(12, 270);
    const kin = stepKinematics(from, 200, env, testBoat(), 1800)!;
    const result = evaluateRoute({
      waypoints: [from, kin.next],
      departEpochS: DEPART_S,
      weather: weather(),
      mask: undefined,
      boat: testBoat(),
      options: { timeStepS: 1800 },
    });
    expect(result.feasible).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.cost.tS).toBe(1800);
  });

  it("straffer kursendringen mellom to etapper", () => {
    const a = { lat: 58.0, lon: 10.6 };
    const env = envOf(12, 270);
    const first = stepKinematics(a, 0, env, testBoat(), 1800)!;
    const second = stepKinematics(first.next, 90, env, testBoat(), 1800)!;
    const result = evaluateRoute({
      waypoints: [a, first.next, second.next],
      departEpochS: DEPART_S,
      weather: weather(),
      mask: undefined,
      boat: testBoat(),
      options: { timeStepS: 1800 },
    });
    expect(result.feasible).toBe(true);
    expect(result.steps).toHaveLength(3);
    // 2 × 1800 s + manøverstraff for 90° kursendring (30 s), ingen halsbytte.
    expect(result.cost.tS).toBe(3630);
  });

  it("er deterministisk: to evalueringer gir identisk resultat", () => {
    const input = {
      waypoints: [
        { lat: 58.0, lon: 10.6 },
        { lat: 58.2, lon: 10.8 },
        { lat: 58.45, lon: 10.7 },
      ],
      departEpochS: DEPART_S,
      weather: syntheticField({
        seed: 99,
        baseSpeedKn: 11,
        baseFromDeg: 250,
        speedVariationKn: 3,
        dirVariationDeg: 25,
        baseHsM: 0.8,
        validFromS: DEPART_S - 3600,
        validToS: DEPART_S + 4 * 24 * 3600,
      }),
      mask: rectMask(),
      boat: testBoat(),
      options: { timeStepS: 1800 },
    };
    expect(JSON.stringify(evaluateRoute(input))).toBe(
      JSON.stringify(evaluateRoute(input)),
    );
  });
});

describe("evaluateRoute — harde avvisninger rapporteres med posisjon og tid", () => {
  it("avviser et segment gjennom no-go og sier hvor og når", () => {
    const result = evaluateRoute({
      waypoints: [
        { lat: 58.0, lon: 10.6 },
        { lat: 58.6, lon: 10.6 },
      ],
      departEpochS: DEPART_S,
      weather: constantWeather({
        speedKn: 12,
        fromDeg: 270,
        validFromS: DEPART_S - 3600,
        validToS: DEPART_S + 4 * 24 * 3600,
      }),
      mask: rectMask({
        noGo: [
          {
            latMin: 58.2,
            latMax: 58.3,
            lonMin: 10.4,
            lonMax: 10.8,
            reason: "konstruert grunne",
          },
        ],
      }),
      boat: testBoat(),
      options: { timeStepS: 1800, minOffingNm: 0 },
    });
    expect(result.feasible).toBe(false);
    const rejection = result.rejection!;
    expect(["point", "segment", "clearance"]).toContain(rejection.kind);
    expect(rejection.reason).toContain("grunne");
    expect(rejection.lat).toBeGreaterThan(57.9);
    expect(rejection.lat).toBeLessThan(58.3);
    expect(rejection.tS).toBeGreaterThanOrEqual(0);
    expect(rejection.epochS).toBe(DEPART_S + rejection.tS);
    expect(rejection.waypointIndex).toBe(1);
    // Delresultatet fram til bruddet returneres (N2).
    expect(result.steps.length).toBeGreaterThan(1);
  });

  it("avviser når værfeltet mangler i startpunktet", () => {
    const result = evaluateRoute({
      waypoints: [
        { lat: 58.0, lon: 10.6 },
        { lat: 58.2, lon: 10.6 },
      ],
      departEpochS: DEPART_S,
      weather: emptyWeather(DEPART_S - 3600, DEPART_S + 3600),
      mask: undefined,
      boat: testBoat(),
    });
    expect(result.feasible).toBe(false);
    expect(result.rejection?.kind).toBe("noWeather");
    expect(result.steps).toHaveLength(1);
    expect(result.cost.tS).toBe(0);
  });

  it("avviser når båtens vindgrense er overskredet", () => {
    const result = evaluateRoute({
      waypoints: [
        { lat: 58.0, lon: 10.6 },
        { lat: 58.2, lon: 10.6 },
      ],
      departEpochS: DEPART_S,
      weather: constantWeather({
        speedKn: 60,
        fromDeg: 270,
        validFromS: DEPART_S - 3600,
        validToS: DEPART_S + 3 * 3600,
      }),
      mask: undefined,
      boat: testBoat(),
    });
    expect(result.feasible).toBe(false);
    expect(result.rejection?.kind).toBe("boatLimits");
    expect(result.rejection?.reason).toContain("TWS");
  });

  it("avviser ankomst utenfor dagslysvinduet når kravet er slått på", () => {
    // Vinteravgang midt på natten i Skagerrak.
    const winterDepartS = 1794844800; // 2026-11-15 16:00 UTC
    const common = {
      waypoints: [
        { lat: 58.0, lon: 10.6 },
        { lat: 58.2, lon: 10.6 },
      ],
      departEpochS: winterDepartS,
      weather: constantWeather({
        speedKn: 13,
        fromDeg: 20,
        validFromS: winterDepartS - 3600,
        validToS: winterDepartS + 4 * 24 * 3600,
      }),
      mask: undefined,
      boat: testBoat(),
    };
    const uten = evaluateRoute({ ...common, options: { timeStepS: 1800 } });
    expect(uten.feasible).toBe(true);
    expect(uten.daylightArrival).toBe(false);

    const med = evaluateRoute({
      ...common,
      options: { timeStepS: 1800, requireDaylightArrival: true },
    });
    expect(med.feasible).toBe(false);
    expect(med.rejection?.kind).toBe("daylightArrival");
  });

  it("gir opp ærlig når ruten ikke lar seg seile (ingen framgang)", () => {
    // Rett mot vinden, motor av: båten kan ikke styre mot veipunktet.
    const result = evaluateRoute({
      waypoints: [
        { lat: 58.0, lon: 10.6 },
        { lat: 58.5, lon: 10.6 },
      ],
      departEpochS: DEPART_S,
      weather: constantWeather({
        speedKn: 14,
        fromDeg: 0,
        validFromS: DEPART_S - 3600,
        validToS: DEPART_S + 4 * 24 * 3600,
      }),
      mask: undefined,
      boat: testBoat({ motorThresholdKn: 0 }),
      options: { timeStepS: 1800 },
    });
    expect(result.feasible).toBe(false);
    expect(["noSpeed", "noProgress"]).toContain(result.rejection?.kind);
  });
});

/**
 * Én-sannhet-egenskapstesten (spec §5.11, §8.3).
 *
 * Kjøres mot den **ukonsoliderte** stegsekvensen — `RouteResult.steps`, ikke
 * `legs`. Konsolideringen (§5.9) endrer geometrien med vilje, så å evaluere
 * den ville målt konsolideringen i stedet for kjernen.
 *
 * **Den direkte sluttetappen (§5.8) er utelatt fra veipunktlisten.** Den er
 * ikke et søkesteg, men en etterbehandling med sin egen tidsoppløsning: hele
 * den gjenstående distansen tas i ett jafs, mens evaluatoren ville delt den i
 * `timeStepS`-steg. Kinematikken bak er den samme (`stepKinematics`), men
 * stegtellingen er det ikke, og denne testen sammenligner steg for steg.
 * Sluttetappen har sin egen dekning i «sluttetappen bruker søkets kinematikk»
 * under.
 *
 * Fordi listen da ikke ender i målet, oppgis `harbourEnds` eksplisitt: uten
 * det ville kystbuffer-unntaket blitt målt mot feil havn.
 */
describe("én sannhet: evaluator == søk på golden-fiksturene", () => {
  for (const scenario of goldenScenarios()) {
    it(`${scenario.name}: samme kostnadsvektor som søket rapporterte`, () => {
      const planned = planRoute(scenario.input);
      const hasDirectEnd = planned.legs.some((leg) => leg.direkteSlutt);
      const searchSteps = hasDirectEnd
        ? planned.steps.slice(0, -1)
        : planned.steps;
      expect(searchSteps.length).toBeGreaterThan(1);

      const evaluation = evaluateRoute({
        waypoints: searchSteps.map((s) => ({ lat: s.lat, lon: s.lon })),
        departEpochS: scenario.input.departEpochS,
        weather: scenario.input.weather,
        mask: scenario.input.mask,
        boat: scenario.input.boat,
        harbourEnds: {
          start: scenario.input.start,
          dest: scenario.input.dest,
        },
        ...(scenario.input.options === undefined
          ? {}
          : { options: scenario.input.options }),
      });

      expect(
        evaluation.rejection,
        `${scenario.name}: evaluatoren avviste søkets egen rute — ${JSON.stringify(evaluation.rejection)}`,
      ).toBeNull();
      // Ingen ekstra og ingen tapte steg: løkken er den samme som søkets.
      expect(evaluation.steps).toHaveLength(searchSteps.length);

      for (let i = 1; i < searchSteps.length; i++) {
        expectStepMatch(
          scenario.name,
          i,
          searchSteps[i]!,
          evaluation.steps[i]!,
        );
      }
    }, 60_000);
  }
});

/**
 * **Funn 2026-08-31 (evaluatoren fant det, ikke et menneske) — nå fikset.**
 *
 * Den direkte sluttetappen i `reconstruct.ts` (§5.8) ble tidligere lagt på
 * uten å sjekke at båten kunne seile den. I «ren-kryssetappe» ligger målet
 * rett mot vinden med motoren av, og den siste stumpen inn til målet ble
 * dermed *gratis*: `bspKn ≈ 0` ga `extraS = 0`, altså avstand uten tid i
 * `totals`. Etappen består `segmentVerdict` og TSS-regelen, så ingen
 * eksisterende sjekk fanget den.
 *
 * Testen pinner nå den **korrekte** adferden: sluttetappen bruker søkets egen
 * kinematikk, og en etappe båten ikke kan seile legges ikke til i det hele
 * tatt. Ruten stopper da ved siste ordinære steg, og `finalLeg` sier
 * eksplisitt hvorfor og hvor langt fra målet den stoppet.
 */
describe("funn 2026-08-31: useilbar sluttetappe legges ikke til", () => {
  it("ren-kryssetappe: ingen tidsfri sluttetappe, men et ærlig avvisningsflagg", () => {
    const scenario = goldenScenarios().find(
      (s) => s.name === "ren-kryssetappe",
    )!;
    const planned = planRoute(scenario.input);

    // Ingen direkte sluttetappe — og dermed heller ingen distanse uten tid.
    expect(planned.legs.some((leg) => leg.direkteSlutt)).toBe(false);
    expect(planned.finalLeg.status).toBe("avvist-fart");
    expect(planned.finalLeg.reason).toMatch(/framdrift|fart/);
    expect(planned.finalLeg.shortfallNm).toBeGreaterThan(0.3);

    // Ruten ender ikke i målet, og det skal den heller ikke late som.
    const last = planned.steps[planned.steps.length - 1]!;
    expect(
      haversineNm(last, scenario.input.dest),
    ).toBeCloseTo(planned.finalLeg.shortfallNm, 9);

    // Ingen steg med distanse men uten tid.
    for (let i = 1; i < planned.steps.length; i++) {
      const prev = planned.steps[i - 1]!;
      const cur = planned.steps[i]!;
      if (haversineNm(prev, cur) > 1e-6) {
        expect(
          cur.tS - prev.tS,
          `steg ${i} har distanse uten tid`,
        ).toBeGreaterThan(0);
      }
    }

    // Årsaken er den evaluatoren oppgir: båten gjør ikke fart mot målet.
    const evaluation = evaluateRoute({
      waypoints: [last, scenario.input.dest].map((s) => ({
        lat: s.lat,
        lon: s.lon,
      })),
      departEpochS: scenario.input.departEpochS + last.tS,
      weather: scenario.input.weather,
      mask: scenario.input.mask,
      boat: scenario.input.boat,
      ...(scenario.input.options === undefined
        ? {}
        : { options: scenario.input.options }),
    });
    expect(evaluation.feasible).toBe(false);
    expect(evaluation.rejection?.kind).toBe("noSpeed");
  }, 60_000);

  /**
   * Den positive halvdelen: når sluttetappen *er* seilbar, skal tiden på den
   * stemme med det evaluatoren regner for samme strekk under samme vær.
   * Toleransen er romslig fordi evaluatoren deler strekket i `timeStepS`-steg
   * og dermed sampler vær og bautstraff på en litt annen måte.
   */
  it("seilbar sluttetappe får tid som stemmer med evaluatoren", () => {
    const scenario = goldenScenarios().find(
      (s) => s.name === "skjaeloy-skagen-apent",
    )!;
    const planned = planRoute(scenario.input);
    expect(planned.finalLeg.status).toBe("lagt-til");

    const last = planned.steps[planned.steps.length - 1]!;
    const previous = planned.steps[planned.steps.length - 2]!;
    const legS = last.tS - previous.tS;
    expect(legS).toBeGreaterThan(0);

    const evaluation = evaluateRoute({
      waypoints: [previous, last].map((s) => ({ lat: s.lat, lon: s.lon })),
      departEpochS: scenario.input.departEpochS + previous.tS,
      weather: scenario.input.weather,
      mask: scenario.input.mask,
      boat: scenario.input.boat,
      harbourEnds: { start: scenario.input.start, dest: scenario.input.dest },
      ...(scenario.input.options === undefined
        ? {}
        : { options: scenario.input.options }),
    });
    expect(evaluation.feasible).toBe(true);
    // Innenfor 10 % — samme kinematikk, ulik stegoppløsning.
    expect(Math.abs(evaluation.cost.tS - legS)).toBeLessThanOrEqual(
      0.1 * legS + 60,
    );
  }, 60_000);
});

/** Toleranse: noen få sekunder. Dette er en identitetstest, ikke en V8-test. */
const COST_TOLERANCE_S = 2;

function expectStepMatch(
  scenario: string,
  index: number,
  fromSearch: RouteStep,
  fromEval: RouteStep,
): void {
  for (const key of ["tS", "beatS", "motorS", "nightS"] as const) {
    const diff = Math.abs(fromEval[key] - fromSearch[key]);
    expect(
      diff,
      `${scenario} steg ${index}: ${key} evaluator=${fromEval[key]} søk=${fromSearch[key]}`,
    ).toBeLessThanOrEqual(COST_TOLERANCE_S);
  }
  // Geometrien skal være identisk — evaluatoren styrer mot søkets egne punkter.
  expect(fromEval.lat).toBeCloseTo(fromSearch.lat, 9);
  expect(fromEval.lon).toBeCloseTo(fromSearch.lon, 9);
}
