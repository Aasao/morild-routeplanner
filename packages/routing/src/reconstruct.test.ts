import { describe, expect, it } from "vitest";
import { angDiff, haversineNm } from "@morild/geo";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { constantWeather } from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import { LabelArena } from "./arena.js";
import type { CostVector } from "./cost.js";
import { FLAG_KRYSS, NEUTRAL_SEARCH_WEIGHTS, ZERO_COST } from "./cost.js";
import { daylightArrival } from "./daylight.js";
import { LabelStore, UNCAPPED } from "./label-store.js";
import { DEFAULT_ROUTE_OPTIONS, withDefaults } from "./options.js";
import type { ResultContext } from "./reconstruct.js";
import { buildResult, consolidateSteps, recheckRoute } from "./reconstruct.js";
import type { RouteLeg, RouteStep } from "./result.js";
import { planRoute } from "./search.js";
import { applyTssRule, DEFAULT_TSS_PARAMS } from "./tss.js";

function step(lat: number, lon: number, tS: number): RouteStep {
  return {
    lat,
    lon,
    tS,
    epochS: 1_780_000_000 + tS,
    headingDeg: 0,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    twsKn: 10,
    twdDeg: 270,
    bspKn: 6,
    hsM: 0,
    flags: 0,
    flagNames: [],
  };
}

function leg(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): RouteLeg {
  return {
    fromLat,
    fromLon,
    toLat,
    toLon,
    headingDeg: 0,
    distanceNm: 1,
    startTS: 0,
    endTS: 1800,
    direkteSlutt: false,
  };
}

describe("consolidateSteps", () => {
  it("slår sammen påfølgende ~like kurser (fjerner isokron-sagtann)", () => {
    // Fem punkter på tilnærmet rett sørlig kurs.
    const steps = [
      step(59.0, 10.0, 0),
      step(58.9, 10.0, 1800),
      step(58.8, 10.0, 3600),
      step(58.7, 10.0, 5400),
      step(58.6, 10.0, 7200),
    ];
    const out = consolidateSteps(steps, undefined);
    expect(out.length).toBe(2);
    expect(out[0]?.lat).toBe(59.0);
    expect(out[1]?.lat).toBe(58.6);
  });

  it("beholder et reelt kursskifte", () => {
    const steps = [
      step(59.0, 10.0, 0),
      step(58.9, 10.0, 1800),
      step(58.9, 10.2, 3600),
    ];
    expect(consolidateSteps(steps, undefined).length).toBe(3);
  });

  /**
   * Krav 1 i §5.9: en sagtann som ville blitt slått sammen til et segment
   * gjennom en grunne, skal **ikke** slås sammen.
   */
  it("slår ikke sammen når det lengre segmentet ville gått gjennom en grunne", () => {
    // Tre punkter som nesten ligger på linje, med en grunne midt mellom
    // ytterpunktene — men utenom knekkpunktet.
    const shoal = {
      latMin: 58.849,
      latMax: 58.851,
      lonMin: 9.999,
      lonMax: 10.001,
      reason: "grunne",
    };
    const steps = [
      step(58.9, 10.0, 0),
      step(58.875, 10.004, 1800),
      step(58.8, 10.0, 3600),
    ];
    const mask = rectMask({ noGo: [shoal] });

    // Uten maske blir de tre slått sammen til to punkter …
    expect(consolidateSteps(steps, undefined).length).toBe(2);
    // … men med grunna i veien beholdes knekkpunktet.
    const consolidated = consolidateSteps(steps, mask);
    expect(consolidated.length).toBe(3);
    expect(
      mask.segmentVerdict(58.9, 10.0, 58.8, 10.0).passable,
      "forutsetning: den sammenslåtte linjen krysser faktisk grunna",
    ).toBe(false);
  });

  /**
   * Regresjon for buggen golden-kjøringen av «tss-ved-skagen» avdekket:
   * to korte segmenter som hver for seg krysset leden lovlig, ble slått
   * sammen til ett langt segment langs leden mot trafikkretningen. Søket
   * var riktig — konsolideringen innførte bruddet.
   */
  it("slår ikke sammen når det lengre segmentet bryter TSS-regelen", () => {
    const mask = rectMask({
      tss: [
        {
          latMin: 57.5,
          latMax: 58.0,
          lonMin: 10.4,
          lonMax: 11.2,
          // Trafikken går mot nordøst; motsatt vei er forbudt.
          axisDeg: 45,
        },
      ],
    });
    // Tre punkter som til sammen går mot sørvest — altså mot trafikken.
    const steps = [
      step(57.9, 11.0, 0),
      step(57.82, 10.86, 1800),
      step(57.7, 10.65, 3600),
    ];

    expect(
      mask.tssVerdict(57.9, 11.0, 57.7, 10.65).kind,
      "forutsetning: det sammenslåtte segmentet ligger langs leden",
    ).toBe("along");

    const consolidated = consolidateSteps(steps, mask, DEFAULT_TSS_PARAMS);
    expect(consolidated.length).toBe(3);
  });

  it("returnerer korte spor uendret", () => {
    const steps = [step(59.0, 10.0, 0), step(58.9, 10.0, 1800)];
    expect(consolidateSteps(steps, undefined)).toEqual(steps);
  });
});

/**
 * Regresjon for den andre buggen golden-kjøringen av «tss-ved-skagen»
 * avdekket: den direkte sluttetappen ble lagt til etter kun en
 * farbarhetssjekk, og la seg langs TSS-en mot trafikkretningen. Spec §5.8
 * nevner bare `segmentVerdict`, men etterbehandling skal aldri kunne innføre
 * et brudd søket selv ville avvist.
 */
describe("direkte sluttetappe (§5.8)", () => {
  const TSS_AXIS_NE = {
    latMin: 57.5,
    latMax: 58.0,
    lonMin: 10.4,
    lonMax: 11.2,
    axisDeg: 45,
  };

  it("legges ikke til når den ville brutt TSS-regelen", () => {
    const mask = rectMask({ tss: [TSS_AXIS_NE] });
    // Siste punkt nordøst for målet: en direkte etappe dit går mot trafikken.
    const last = { lat: 57.9, lon: 11.0 };
    const dest = { lat: 57.7, lon: 10.65 };
    expect(
      mask.segmentVerdict(last.lat, last.lon, dest.lat, dest.lon).passable,
    ).toBe(true);
    const outcome = applyTssRule(
      mask.tssVerdict(last.lat, last.lon, dest.lat, dest.lon),
      DEFAULT_TSS_PARAMS,
    );
    expect(outcome.kind).toBe("reject");

    const result = planRoute({
      start: { lat: 58.02, lon: 11.18 },
      dest,
      departEpochS: 1_781_668_800,
      weather: constantWeather({
        speedKn: 12,
        fromDeg: 90,
        validFromS: 1_781_668_800 - 3600,
        validToS: 1_781_668_800 + 4 * 24 * 3600,
      }),
      mask,
      boat: testBoat(),
      options: { headingStepDeg: 10, timeStepS: 1800 },
    });

    // Uansett om ruten når fram eller ikke: ettersjekken skal aldri finne et
    // TSS-brudd innført av etterbehandlingen.
    expect(result.safety.failingSegments).toEqual([]);
    for (const l of result.legs) {
      const verdict = applyTssRule(
        mask.tssVerdict(l.fromLat, l.fromLon, l.toLat, l.toLon),
        DEFAULT_TSS_PARAMS,
      );
      expect(verdict.kind).not.toBe("reject");
    }
  }, 30_000);

  /**
   * Regresjon for R5 (code-review 2026-08-31): sluttetappen hardkodet 60° som
   * kryssgrense i stedet for å bruke `opts.beatTwaDeg`.
   *
   * Geometrien er valgt slik at sluttetappen har TWA ≈ 70,8°: den er kryss
   * med `beatTwaDeg: 80`, men ikke med 45 eller 60. Den gamle koden ville gitt
   * samme svar (ikke kryss) i alle tre — den så aldri opsjonen.
   */
  it("bruker opts.beatTwaDeg, ikke en hardkodet 60°, på sluttetappen", () => {
    const departEpochS = 1_781_668_800;
    const plan = (beatTwaDeg: number) =>
      planRoute({
        start: { lat: 58.0, lon: 10.0 },
        dest: { lat: 58.3, lon: 10.2 },
        departEpochS,
        weather: constantWeather({
          speedKn: 12,
          fromDeg: 340,
          validFromS: departEpochS - 3600,
          validToS: departEpochS + 4 * 24 * 3600,
        }),
        mask: undefined,
        boat: testBoat(),
        options: { headingStepDeg: 10, timeStepS: 1800, beatTwaDeg },
      });

    for (const beatTwaDeg of [45, 60, 80]) {
      const result = plan(beatTwaDeg);
      expect(result.finalLeg.status).toBe("lagt-til");
      const last = result.steps[result.steps.length - 1]!;
      expect(last.headingDeg).not.toBeNull();
      const twaDeg = angDiff(last.twdDeg, last.headingDeg!);
      expect(
        twaDeg,
        "forutsetning: sluttetappens TWA ligger mellom 60° og 80°",
      ).toBeGreaterThan(60);
      expect(twaDeg).toBeLessThan(80);
      expect(
        (last.flags & FLAG_KRYSS) !== 0,
        `beatTwaDeg=${beatTwaDeg}, TWA=${twaDeg.toFixed(1)}°`,
      ).toBe(twaDeg < beatTwaDeg);
    }
  }, 60_000);
});

/**
 * Regresjon for R4 (code-review 2026-08-31): søkets harde dagslyssjekk
 * (§5.3 steg 16) måler på etiketten *før* den direkte sluttetappen er lagt
 * på — en teleportering inn til målet. Med reell sluttetappetid kan ankomsten
 * falle utenfor dagslysvinduet likevel, og ruten ble da levert stille med
 * `daylightArrival: false` og ingen indikasjon på at et **hardt** brukerkrav
 * var brutt.
 *
 * Avgangstiden er funnet ved skann: 2026-11-15-vinduet, der solnedgangen
 * faller inne i de ~23 minuttene sluttetappen tar.
 */
describe("hardt dagslyskrav måles på reell ankomst (R4)", () => {
  const START = { lat: 58.6, lon: 10.6 };
  const DEST = { lat: 58.0, lon: 10.6 };

  function plan(departEpochS: number) {
    return planRoute({
      start: START,
      dest: DEST,
      departEpochS,
      weather: constantWeather({
        speedKn: 13,
        fromDeg: 20,
        validFromS: departEpochS - 3600,
        validToS: departEpochS + 4 * 24 * 3600,
      }),
      mask: undefined,
      boat: testBoat(),
      options: {
        headingStepDeg: 10,
        timeStepS: 1800,
        requireDaylightArrival: true,
      },
    });
  }

  it("flagger bruddet i stedet for å levere ruten stille", () => {
    const departEpochS = 1_794_813_000; // 2026-11-15 08:30 UTC
    const result = plan(departEpochS);

    expect(result.reached).toBe(true);
    expect(result.finalLeg.status).toBe("lagt-til");

    const last = result.steps[result.steps.length - 1]!;
    const previous = result.steps[result.steps.length - 2]!;
    expect(last.tS - previous.tS).toBeGreaterThan(0);

    // Forutsetningen som gjør dette til en R4-regresjon: søkets egen sjekk,
    // som måler i målet på etikettens tid, ville sagt «dagslys».
    expect(
      daylightArrival(DEST.lat, DEST.lon, departEpochS + previous.tS)
        .isDaylight,
      "forutsetning: teleport-sjekken passerer",
    ).toBe(true);

    // Men den reelle ankomsten, etter sluttetappen, gjør det ikke — og det
    // skal stå eksplisitt.
    expect(result.totals.daylightArrival).toBe(false);
    expect(result.totals.violatesDaylightRequirement).toBe(true);
    expect(
      daylightArrival(last.lat, last.lon, result.totals.arrivalEpochS)
        .isDaylight,
    ).toBe(false);
  }, 60_000);

  it("flagger ikke når den reelle ankomsten faktisk er i dagslys", () => {
    const result = plan(1_794_812_400); // ti minutter tidligere
    expect(result.reached).toBe(true);
    expect(result.totals.daylightArrival).toBe(true);
    expect(result.totals.violatesDaylightRequirement).toBe(false);
  }, 60_000);

  it("krever ingenting når brukeren ikke har satt kravet", () => {
    const departEpochS = 1_794_813_000;
    const result = planRoute({
      start: START,
      dest: DEST,
      departEpochS,
      weather: constantWeather({
        speedKn: 13,
        fromDeg: 20,
        validFromS: departEpochS - 3600,
        validToS: departEpochS + 4 * 24 * 3600,
      }),
      mask: undefined,
      boat: testBoat(),
      options: { headingStepDeg: 10, timeStepS: 1800 },
    });
    expect(result.totals.daylightArrival).toBe(false);
    expect(result.totals.violatesDaylightRequirement).toBe(false);
  }, 60_000);
});

/**
 * Funn 1 (code-review runde 2, 2026-08-31). R4-omvalgsløkken krevde **kun**
 * dagslys av kandidaten, ikke at ruten faktisk endte i målet. En kandidat med
 * avvist sluttetappe kunne dermed «vinne» dagslyskravet nettopp fordi den ga
 * opp tidlig nok — og bli presentert med `reached: true`,
 * `daylightArrival: true`, `violatesDaylightRequirement: false` og
 * `safety.verdict: "trygt"` mens den i virkeligheten endte halvannen nautisk
 * mil fra havn, i mørket som aldri ble målt der ruten skulle ha gått.
 *
 * Testene bygger `ResultContext` direkte i stedet for å lete etter et
 * værfelt som får `planRoute` til å produsere nettopp denne kandidatmengden:
 * scenarioet er en egenskap ved *rekonstruksjonen*, og skal pinnes der det
 * hører hjemme — eksakt, uten avhengighet av søkets ekspansjonsrekkefølge.
 */
describe("dagslysomvalg krever at ruten faktisk når målet (funn 1)", () => {
  const START = { lat: 58.6, lon: 10.6 };
  const DEST = { lat: 58.0, lon: 10.6 };
  /** 2026-11-16 07:10 UTC. Dagslysvindu i målet: ca. 08:06–13:57 UTC. */
  const DEPART_EPOCH_S = 1_794_813_000;

  /** Kandidat A: i praksis i mål (0,06 nm), men ankommer etter mørkets frembrudd. */
  const A_POS = { lat: 58.001, lon: 10.6 };
  const A_COST: CostVector = { tS: 7 * 3600, beatS: 0, motorS: 0, nightS: 0 };
  /** Kandidat B: stopper ~2 nm unna; sluttetappen krysser en grunne. */
  const B_POS = { lat: 58.03, lon: 10.75 };
  const B_COST: CostVector = {
    tS: 5 * 3600,
    beatS: 20_000,
    motorS: 0,
    nightS: 0,
  };

  /**
   * No-go som **kun** sperrer B sin sluttetappe inn til målet — hverken A-
   * eller B-etikettenes egne etapper fra start berører den.
   */
  const SHOAL = {
    latMin: 58.005,
    latMax: 58.02,
    lonMin: 10.62,
    lonMax: 10.72,
    reason: "grunne i innseilingen",
  };

  const MASK = rectMask({ noGo: [SHOAL] });

  const A_INDEX = 1;
  const B_INDEX = 2;

  function context(
    reachedIndices: readonly number[],
    requireDaylightArrival: boolean,
  ): ResultContext {
    const arena = new LabelArena(64);
    const push = (
      lat: number,
      lon: number,
      cost: CostVector,
      parent: number,
      headingDeg: number,
    ): number =>
      arena.push({
        lat,
        lon,
        cost,
        headingDeg,
        sector: 0,
        tack: 0,
        parent,
        flags: 0,
        cellKey: 0,
        stateKey: 0,
        remainingNm: 0,
        clearanceNm: Number.POSITIVE_INFINITY,
        twsKn: 10,
        twdDeg: 270,
        bspKn: 6,
        hsM: 0,
      });
    const start = push(START.lat, START.lon, ZERO_COST, -1, 0);
    expect(push(A_POS.lat, A_POS.lon, A_COST, start, 180)).toBe(A_INDEX);
    expect(push(B_POS.lat, B_POS.lon, B_COST, start, 200)).toBe(B_INDEX);

    return {
      input: {
        start: START,
        dest: DEST,
        departEpochS: DEPART_EPOCH_S,
        weather: constantWeather({
          speedKn: 12,
          fromDeg: 270,
          validFromS: DEPART_EPOCH_S - 3600,
          validToS: DEPART_EPOCH_S + 4 * 24 * 3600,
        }),
        mask: MASK,
        boat: testBoat(),
      },
      opts: withDefaults({ requireDaylightArrival }),
      arena,
      store: new LabelStore(arena, UNCAPPED, NEUTRAL_SEARCH_WEIGHTS),
      reached: true,
      abortReason: null,
      bestIndex: reachedIndices[0] ?? A_INDEX,
      reachedIndices,
      reachRadiusNm: 2.5,
      directDistanceNm: haversineNm(START, DEST),
      isochrones: [],
      weatherPartial: false,
      fieldUsed: false,
      fieldCells: 0,
      tubBoundS: null,
      vmaxKn: 8,
      iterations: 10,
      peakActiveLabels: 3,
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
        cone: 0,
        outsideDomain: 0,
      },
    };
  }

  it("forutsetningene: B er fella — den ville bestått den gamle sjekken", () => {
    // B «ankommer» i dagslys …
    expect(
      daylightArrival(B_POS.lat, B_POS.lon, DEPART_EPOCH_S + B_COST.tS)
        .isDaylight,
      "forutsetning: B sitt stopp-punkt ligger i dagslys",
    ).toBe(true);
    // … A gjør det ikke …
    expect(
      daylightArrival(A_POS.lat, A_POS.lon, DEPART_EPOCH_S + A_COST.tS)
        .isDaylight,
      "forutsetning: A ankommer i mørket",
    ).toBe(false);
    // … men B kommer aldri fram: sluttetappen er sperret …
    expect(
      MASK.segmentVerdict(B_POS.lat, B_POS.lon, DEST.lat, DEST.lon).passable,
      "forutsetning: B sin sluttetappe krysser grunna",
    ).toBe(false);
    // … mens begge kandidatenes egne etapper fra start er farbare, slik at
    // sikkerhetsettersjekken ikke er det som skiller dem.
    expect(
      MASK.segmentVerdict(START.lat, START.lon, A_POS.lat, A_POS.lon).passable,
    ).toBe(true);
    expect(
      MASK.segmentVerdict(START.lat, START.lon, B_POS.lat, B_POS.lon).passable,
    ).toBe(true);
    // Og B er dårligere rangert enn A (ellers ville A vunnet uansett).
    const noDaylight = buildResult(context([A_INDEX, B_INDEX], false));
    expect(
      noDaylight.totals.durationS,
      "forutsetning: A vinner rangeringen uten dagslyskrav",
    ).toBe(A_COST.tS);
    expect(noDaylight.finalLeg.status).toBe("ikke-nodvendig");
    // Begge overlever Pareto-fronten — B er ikke dominert bort, den er bare
    // dårligere rangert. Uten det ville testen ikke sagt noe om løkka.
    expect(noDaylight.alternatives.length).toBe(1);
  });

  it("velger aldri en kandidat som ikke når målet, selv om den «ankommer» i dagslys", () => {
    const result = buildResult(context([A_INDEX, B_INDEX], true));

    // A vant: ruten ender i målet.
    expect(result.safety.reachesDestination).toBe(true);
    expect(result.finalLeg.status).toBe("ikke-nodvendig");
    expect(result.totals.durationS).toBe(A_COST.tS);

    // Og bruddet på dagslyskravet er flagget, ikke skjult.
    expect(result.totals.daylightArrival).toBe(false);
    expect(result.totals.violatesDaylightRequirement).toBe(true);
  });

  /**
   * Fallback-adferden når *ingen* kandidat både når målet og gjør det i
   * dagslys: den best rangerte leveres, men aldri stille.
   */
  it("flagger ærlig når eneste kandidat er en som ikke når målet", () => {
    const result = buildResult(context([B_INDEX], true));

    expect(result.reached, "søket fant en etikett innenfor reachRadius").toBe(
      true,
    );
    // … men ruten kom ikke fram, og det skal ingen kunne overse:
    expect(result.safety.reachesDestination).toBe(false);
    expect(result.finalLeg.status).toBe("avvist-farbarhet");
    expect(result.finalLeg.shortfallNm).toBeCloseTo(
      haversineNm(B_POS, DEST),
      9,
    );
    expect(result.safety.verdict).not.toBe("trygt");
    expect(result.safety.verdict).toBe("usikkert");
    expect(result.totals.violatesDaylightRequirement).toBe(true);
  });

  /**
   * Funn 1b uten dagslyskrav i det hele tatt: gulvet på `verdict` henger på
   * den avviste sluttetappen, ikke på dagslys. Alle segmentene i ruten består
   * ettersjekken — det er nettopp derfor «trygt» ville vært villedende.
   */
  it("en avvist sluttetappe gulver safety.verdict til «usikkert» også uten dagslyskrav", () => {
    const result = buildResult(context([B_INDEX], false));

    expect(result.safety.failingSegments).toEqual([]);
    expect(result.safety.recheckPassed).toBe(true);
    expect(result.coverage.mask).toBe("full");
    expect(result.safety.flaggedSegments).toEqual([]);
    // Alt over ville gitt «trygt» før funn 1b. Nå gjør det ikke det:
    expect(result.safety.verdict).toBe("usikkert");
    expect(result.safety.reachesDestination).toBe(false);
    expect(result.totals.violatesDaylightRequirement).toBe(false);
  });

  it("«ikke-forsokt» endrer ikke verdikten — der sier reached: false alt", () => {
    const ctx = { ...context([A_INDEX], false), reached: false };
    const result = buildResult(ctx);

    expect(result.finalLeg.status).toBe("ikke-forsokt");
    expect(result.safety.reachesDestination).toBe(false);
    expect(result.safety.verdict).toBe("trygt");
  });
});

describe("recheckRoute — uavhengig sikkerhetsettersjekk (§5.10)", () => {
  const island = {
    latMin: 58.85,
    latMax: 58.95,
    lonMin: 9.95,
    lonMax: 10.05,
    reason: "øy",
  };

  it("godkjenner en rute der alle segmenter er farbare", () => {
    const mask = rectMask({ noGo: [island] });
    const { failing, flagged } = recheckRoute(
      [leg(59.0, 10.2, 58.8, 10.2)],
      mask,
      DEFAULT_ROUTE_OPTIONS,
    );
    expect(failing).toEqual([]);
    expect(flagged).toEqual([]);
  });

  it("fanger et segment gjennom no-go og navngir det", () => {
    const mask = rectMask({ noGo: [island] });
    const { failing } = recheckRoute(
      [leg(59.0, 10.0, 58.8, 10.0)],
      mask,
      DEFAULT_ROUTE_OPTIONS,
    );
    expect(failing.length).toBe(1);
    expect(failing[0]?.legIndex).toBe(0);
    expect(failing[0]?.reason).toBe("øy");
    expect(failing[0]?.tillit).toBe("no-go");
  });

  it("fanger TSS-brudd uavhengig av farbarheten", () => {
    const mask = rectMask({
      tss: [
        { latMin: 57.5, latMax: 58.0, lonMin: 10.4, lonMax: 11.2, axisDeg: 45 },
      ],
    });
    const { failing } = recheckRoute(
      [leg(57.9, 11.0, 57.7, 10.65)],
      mask,
      DEFAULT_ROUTE_OPTIONS,
    );
    expect(failing.length).toBe(1);
    expect(failing[0]?.reason).toMatch(/trafikkretningen/);
  });

  it("flagger usikker dekning uten å underkjenne ruten", () => {
    const mask = rectMask({
      uncertain: [
        {
          latMin: 58.85,
          latMax: 58.95,
          lonMin: 9.95,
          lonMax: 10.05,
          reason: "ingen sonderinger",
        },
      ],
    });
    const { failing, flagged } = recheckRoute(
      [leg(59.0, 10.0, 58.8, 10.0)],
      mask,
      DEFAULT_ROUTE_OPTIONS,
    );
    expect(failing).toEqual([]);
    expect(flagged.length).toBe(1);
    expect(flagged[0]?.tillit).toBe("usikkert");
  });

  it("gjør ingenting uten maske — det er søkets ansvar å degradere ærlig", () => {
    const { failing, flagged } = recheckRoute(
      [leg(59.0, 10.0, 58.8, 10.0)],
      undefined,
      DEFAULT_ROUTE_OPTIONS,
    );
    expect(failing).toEqual([]);
    expect(flagged).toEqual([]);
  });
});
