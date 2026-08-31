import { describe, expect, it } from "vitest";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { constantWeather } from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import { DEFAULT_ROUTE_OPTIONS } from "./options.js";
import { consolidateSteps, recheckRoute } from "./reconstruct.js";
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
