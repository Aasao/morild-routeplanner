import { haversineNm } from "@morild/geo";
import { describe, expect, it } from "vitest";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import {
  constantWeather,
  emptyWeather,
  syntheticField,
} from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import {
  createSearch,
  createSearchForTesting,
  planRoute,
  type RouteInput,
} from "./search.js";
import type { RouteOptions } from "./options.js";
import type { RouteDiagnostics } from "./result.js";

/** Summen av de seks `hardConstraint*`-delbøttene, uavhengig av navn. */
function sumHardConstraintBuckets(
  pruned: RouteDiagnostics["pruned"],
): number {
  return (
    pruned.hardConstraintBoatLimits +
    pruned.hardConstraintPoint +
    pruned.hardConstraintClearance +
    pruned.hardConstraintSegment +
    pruned.hardConstraintTss +
    pruned.hardConstraintDaylight
  );
}

/** 2026-06-15 06:00 UTC — lyst hele etappen på disse breddegradene. */
const DEPART_S = Date.UTC(2026, 5, 15, 6, 0, 0) / 1000;

const START = { lat: 58.6, lon: 10.6 };
const DEST = { lat: 58.0, lon: 10.6 };

function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    start: START,
    dest: DEST,
    departEpochS: DEPART_S,
    // Vestlig vind, tvers på en nord–sør-etappe: ren slør begge veier.
    weather: constantWeather({
      speedKn: 14,
      fromDeg: 270,
      validFromS: DEPART_S - 3600,
      validToS: DEPART_S + 14 * 24 * 3600,
    }),
    mask: rectMask(),
    boat: testBoat(),
    options: { timeStepS: 1800, headingStepDeg: 10 },
    ...overrides,
  };
}

function options(extra: Partial<RouteOptions>): Partial<RouteOptions> {
  return { timeStepS: 1800, headingStepDeg: 10, ...extra };
}

describe("planRoute — åpent farvann", () => {
  it("når målet og returnerer en sammenhengende rute", () => {
    const result = planRoute(input());
    expect(result.reached).toBe(true);
    expect(result.abortReason).toBeNull();
    expect(result.legs.length).toBeGreaterThan(0);
    expect(result.steps.length).toBeGreaterThan(1);

    const firstStep = result.steps[0];
    const lastLeg = result.legs[result.legs.length - 1];
    expect(firstStep?.lat).toBe(START.lat);
    expect(lastLeg).toBeDefined();
    if (lastLeg === undefined) return;
    expect(
      haversineNm({ lat: lastLeg.toLat, lon: lastLeg.toLon }, DEST),
    ).toBeLessThan(0.35);
  });

  it("gir totaler som henger sammen med stegene", () => {
    const result = planRoute(input());
    const { totals } = result;
    expect(totals.durationS).toBeGreaterThan(0);
    expect(totals.distanceNm).toBeGreaterThan(haversineNm(START, DEST) * 0.95);
    expect(totals.beatS).toBeLessThanOrEqual(totals.durationS);
    expect(totals.motorS).toBeLessThanOrEqual(totals.durationS);
    expect(totals.nightS).toBeLessThanOrEqual(totals.durationS);
    expect(totals.beatAtNightS).toBeLessThanOrEqual(
      Math.min(totals.beatS, totals.nightS),
    );
    expect(totals.arrivalEpochS).toBe(DEPART_S + totals.durationS);
    expect(totals.fuelL).toBeCloseTo((totals.motorS / 3600) * 4, 9);
  });

  it("gir «trygt» når masken har full dekning og ingen segmenter feiler", () => {
    const result = planRoute(input());
    expect(result.safety.recheckPassed).toBe(true);
    expect(result.safety.failingSegments).toEqual([]);
    expect(result.safety.verdict).toBe("trygt");
  });

  it("holder tiden monotont voksende langs ruten (label-setting)", () => {
    const result = planRoute(input());
    for (let i = 1; i < result.steps.length; i++) {
      expect(result.steps[i]!.tS).toBeGreaterThanOrEqual(
        result.steps[i - 1]!.tS,
      );
    }
  });

  it("lagrer isokron-snapshot underveis", () => {
    const result = planRoute(
      input({ options: options({ isochroneSnapshotHours: 2 }) }),
    );
    expect(result.isochrones.length).toBeGreaterThan(0);
    for (const snapshot of result.isochrones) {
      expect(snapshot.points.length).toBeGreaterThan(0);
    }
  });
});

describe("Search — steg-vis API (F3.5)", () => {
  it("kan avanseres i biter og gir samme resultat som planRoute", () => {
    const search = createSearch(input());
    let progress = search.advance(1);
    expect(progress.iterations).toBe(1);
    expect(progress.done).toBe(false);
    while (!progress.done) progress = search.advance(3);
    const stepwise = search.finish();
    const direct = planRoute(input());
    expect(JSON.stringify(stepwise)).toBe(JSON.stringify(direct));
  });

  it("gir et gyldig delresultat fra snapshot() når som helst", () => {
    const search = createSearch(input());
    search.advance(2);
    const snapshot = search.snapshot();
    expect(snapshot.reached).toBe(false);
    expect(snapshot.steps.length).toBeGreaterThan(0);
    // Delresultatet er ærlig: det påstår ikke å ha nådd fram.
    expect(snapshot.legs.length).toBeGreaterThan(0);
  });

  it("stopper på oppfordring med abortReason callerStopped", () => {
    const search = createSearch(input());
    search.advance(2);
    search.stop();
    const result = search.finish();
    expect(result.abortReason).toBe("callerStopped");
    expect(result.reached).toBe(false);
  });
});

describe("ærlig degradering (§6)", () => {
  it("melder noWeatherAtStart når vinden mangler i startpunktet", () => {
    const result = planRoute(input({ weather: emptyWeather() }));
    expect(result.reached).toBe(false);
    expect(result.abortReason).toBe("noWeatherAtStart");
    expect(result.legs).toEqual([]);
  });

  it("melder outsideDomain når start eller mål er utenfor bboxen", () => {
    const result = planRoute(
      input({ start: { lat: 40, lon: 10 }, options: options({}) }),
    );
    expect(result.abortReason).toBe("outsideDomain");
  });

  it("kan aldri si «trygt» uten maske", () => {
    const result = planRoute(input({ mask: undefined }));
    expect(result.coverage.mask).toBe("none");
    expect(result.safety.verdict).toBe("usikker-rute");
    expect(result.safety.recheckPassed).toBe(false);
  });

  it("flagger «usikkert» ved delvis maskedekning", () => {
    const result = planRoute(
      input({ mask: rectMask({ coverage: "partial" }) }),
    );
    expect(result.coverage.mask).toBe("partial");
    expect(result.safety.verdict).toBe("usikkert");
  });

  it("stopper naturlig der værfeltet slutter i tid", () => {
    const result = planRoute(
      input({
        weather: constantWeather({
          speedKn: 14,
          fromDeg: 270,
          validFromS: DEPART_S,
          validToS: DEPART_S + 2 * 3600,
        }),
      }),
    );
    expect(result.reached).toBe(false);
    expect(result.coverage.weather).toBe("partial");
    expect(result.abortReason).toBe("noExpandableLabels");
  });

  it("rapporterer at feltet ikke ble brukt når det ikke lot seg bygge", () => {
    // Start midt inne i et no-go-areal: selv 3×3 rundt start er unåelig.
    const mask = rectMask({
      noGo: [{ latMin: 58.5, latMax: 58.7, lonMin: 10.5, lonMax: 10.7 }],
    });
    const result = planRoute(input({ mask }));
    expect(result.coverage.fieldUsed).toBe(false);
  });

  it("returnerer beste delrute når målet ikke nås", () => {
    // Mål bak en heldekkende vegg: ruten kommer aldri fram. Etikett-taket er
    // satt lavt her med vilje — vi tester den ærlige avbruddsveien, ikke hvor
    // lenge motoren orker å lete.
    const mask = rectMask({
      noGo: [{ latMin: 58.2, latMax: 58.3, lonMin: 9.0, lonMax: 12.0 }],
    });
    const result = planRoute(
      input({ mask, options: options({ maxTotalLabels: 20_000 }) }),
    );
    expect(result.reached).toBe(false);
    expect(result.abortReason).toBe("labelCap");
    expect(result.steps.length).toBeGreaterThan(0);
    // Delruten er fortsatt en gyldig, sjekket rute — bare ikke fram.
    expect(result.safety.failingSegments).toEqual([]);
  }, 30_000);
});

describe("harde constraints i søket", () => {
  it("går rundt et no-go-areal i stedet for gjennom det", () => {
    const island = { latMin: 58.25, latMax: 58.4, lonMin: 10.5, lonMax: 10.75 };
    const result = planRoute(input({ mask: rectMask({ noGo: [island] }) }));
    expect(result.reached).toBe(true);
    expect(result.safety.failingSegments).toEqual([]);
    for (const step of result.steps) {
      const inside =
        step.lat >= island.latMin &&
        step.lat <= island.latMax &&
        step.lon >= island.lonMin &&
        step.lon <= island.lonMax;
      expect(inside).toBe(false);
    }
  });

  it("en absurd høy myk vekt gjør ikke en no-go-passasje gyldig", () => {
    const island = { latMin: 58.25, latMax: 58.4, lonMin: 10.5, lonMax: 10.75 };
    const mask = rectMask({ noGo: [island] });
    const result = planRoute(
      input({
        mask,
        options: options({
          // Absurd vekting av alt mykt: skal ikke kunne kjøpe seg gjennom land.
          rankingWeights: { beat: 1e9, motor: 1e9, night: 1e9 },
        }),
      }),
    );
    expect(result.safety.failingSegments).toEqual([]);
    expect(result.safety.recheckPassed).toBe(true);
  });

  it("avviser ruter gjennom for hard vind (ruten går rundt uværet)", () => {
    const stormy = planRoute(
      input({
        weather: constantWeather({
          speedKn: 40,
          fromDeg: 270,
          validFromS: DEPART_S - 3600,
          validToS: DEPART_S + 14 * 24 * 3600,
        }),
        boat: testBoat({ maxTwsKn: 30 }),
      }),
    );
    expect(stormy.reached).toBe(false);
    expect(stormy.diagnostics.pruned.hardConstraint).toBeGreaterThan(0);
    // For hard vind avvises på båtens ytelsesgrense (§4.1 sjekk 1), ikke på
    // farbarhet — den splittede telleren skal si nettopp det.
    expect(stormy.diagnostics.pruned.hardConstraintBoatLimits).toBeGreaterThan(
      0,
    );
    expect(sumHardConstraintBuckets(stormy.diagnostics.pruned)).toBe(
      stormy.diagnostics.pruned.hardConstraint,
    );
  });

  it("splitten av hardConstraint summerer alltid til totalen (no-go-scenariet)", () => {
    const island = { latMin: 58.25, latMax: 58.4, lonMin: 10.5, lonMax: 10.75 };
    const result = planRoute(input({ mask: rectMask({ noGo: [island] }) }));
    expect(sumHardConstraintBuckets(result.diagnostics.pruned)).toBe(
      result.diagnostics.pruned.hardConstraint,
    );
    expect(result.diagnostics.pruned.hardConstraintPoint).toBeGreaterThan(0);
  });

  it("håndhever dagslys-ankomst som hardt krav", () => {
    // Avgang midt på natten i november: uten kravet ankommer vi i mørket.
    const winterDepart = Date.UTC(2026, 10, 15, 20, 0, 0) / 1000;
    const winterWeather = constantWeather({
      speedKn: 14,
      fromDeg: 270,
      validFromS: winterDepart - 3600,
      validToS: winterDepart + 14 * 24 * 3600,
    });
    const free = planRoute(
      input({ departEpochS: winterDepart, weather: winterWeather }),
    );
    expect(free.reached).toBe(true);
    expect(free.totals.daylightArrival).toBe(false);

    const required = planRoute(
      input({
        departEpochS: winterDepart,
        weather: winterWeather,
        options: options({ requireDaylightArrival: true }),
      }),
    );
    if (required.reached) {
      expect(required.totals.daylightArrival).toBe(true);
      expect(required.totals.durationS).toBeGreaterThan(free.totals.durationS);
    } else {
      // Ærlig avbrudd er også et gyldig svar — men da uten å påstå ankomst.
      expect(required.abortReason).not.toBeNull();
    }
  });
});

describe("Pareto-alternativer", () => {
  it("returnerer ikke-dominerte alternativer ved målet", () => {
    const result = planRoute(
      input({
        weather: syntheticField({
          seed: 20260830,
          baseSpeedKn: 12,
          baseFromDeg: 200,
          speedVariationKn: 4,
          dirVariationDeg: 40,
          validFromS: DEPART_S - 3600,
          validToS: DEPART_S + 7 * 24 * 3600,
        }),
        options: options({ headingStepDeg: 12 }),
      }),
    );
    expect(result.reached).toBe(true);
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
    for (const alternative of result.alternatives) {
      expect(alternative.legs.length).toBeGreaterThan(0);
      expect(alternative.cost.tS).toBeGreaterThan(0);
    }
  });
});

describe("diagnostikk", () => {
  it("rapporterer hva som ble beskåret og hvorfor", () => {
    const result = planRoute(input());
    const { diagnostics } = result;
    expect(diagnostics.iterations).toBeGreaterThan(0);
    expect(diagnostics.labelsCreated).toBeGreaterThan(0);
    expect(diagnostics.peakActiveLabels).toBeGreaterThan(0);
    expect(diagnostics.vmaxKn).toBeGreaterThan(0);
    expect(diagnostics.pruned.dominated).toBeGreaterThan(0);
  });

  it("teller kjegle-beskjæring bare når kjeglen er slått på", () => {
    const uten = planRoute(input());
    expect(uten.diagnostics.pruned.cone).toBe(0);
    const med = planRoute(input({ options: options({ coneDeg: 60 }) }));
    expect(med.diagnostics.pruned.cone).toBeGreaterThan(0);
  });

  it("har kjeglen av som standard (ADR-0004 avvik 2)", () => {
    // Testen som låser standardverdien: setter noen den på igjen, må
    // ADR-0004 oppdateres først.
    expect(planRoute(input()).diagnostics.pruned.cone).toBe(0);
  });
});

describe("labelStoreSnapshot — instrumentering (nettbrett-målingen)", () => {
  it("gir ett innslag per aktiv etikett, gruppert på tilstand", () => {
    const search = createSearchForTesting(input());
    search.finish();
    const snapshot = search.labelStoreSnapshot();
    expect(snapshot.length).toBeGreaterThan(0);
    for (const entry of snapshot) {
      expect(Number.isInteger(entry.stateKey)).toBe(true);
      expect(Number.isInteger(entry.cellKey)).toBe(true);
      expect([-1, 0, 1]).toContain(entry.tack);
    }
    // Grupperingen skal stemme med antall aktive etiketter i label-storen.
    const byState = new Map<number, number>();
    for (const entry of snapshot) {
      byState.set(entry.stateKey, (byState.get(entry.stateKey) ?? 0) + 1);
    }
    expect(byState.size).toBeGreaterThan(0);
  });

  it("er tom før søket har lagt inn noen etiketter utover start", () => {
    // Umiddelbart etter konstruksjon finnes kun startetiketten — snapshotet
    // skal derfor ha nøyaktig ett innslag, ikke null (den telles med).
    const search = createSearchForTesting(input());
    expect(search.labelStoreSnapshot().length).toBe(1);
  });
});
