/**
 * Tester for E1′-målevariantene (`variants.ts`, `corridor.ts`, `bailout.ts`).
 *
 * Den viktigste testen i filen er den kjedeligste: **med opsjonene av skal
 * motoren gjøre nøyaktig det samme som før.** Målevarianter som lekker inn i
 * produksjonsadferden ville gjort hele E1′-målingen sirkulær — og verre,
 * golden-fasiten ville flyttet seg under føttene på oss.
 */
import { describe, expect, it } from "vitest";
import { INTERIM_BAILOUT_HARBOURS } from "../test-fixtures/bailout-harbours.js";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import { s3FrontEnsemble } from "../test-fixtures/ensemble-s3-front.js";
import { controlInput } from "../test-fixtures/ensemble.js";
import { constantWeather } from "../test-fixtures/synthetic-weather.js";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import {
  harbourApproachable,
  isHardRejection,
  r2Verdict,
  R2_LIMIT_S,
  type BailoutHarbour,
} from "./bailout.js";
import { corridorMask, distanceToRouteNm } from "./corridor.js";
import { evaluateRoute } from "./evaluate.js";
import { DEFAULT_ROUTE_OPTIONS, withDefaults } from "./options.js";
import { planRoute } from "./search.js";
import { corridorMemberOutcome, planRouteScalar } from "./variants.js";
import type { LatLon } from "./contracts.js";

// ------------------------------------------------------- variant A: skalar

describe("variant A — skalar søkemodus", () => {
  it("er av som standard", () => {
    expect(DEFAULT_ROUTE_OPTIONS.scalarSearchMode).toBe(false);
    expect(withDefaults({}).maxLabelsPerState).toBe(4);
  });

  it("kollapser etikettmengden til én per tilstand når den slås på", () => {
    expect(withDefaults({ scalarSearchMode: true }).maxLabelsPerState).toBe(1);
    // Celletaket og alt annet står urørt — kun én forskjell skal måles.
    const scalar = withDefaults({ scalarSearchMode: true });
    const pareto = withDefaults({});
    expect(scalar.maxLabelsPerCell).toBe(pareto.maxLabelsPerCell);
    expect(scalar.headingStepDeg).toBe(pareto.headingStepDeg);
    expect(scalar.cellDeg).toBe(pareto.cellDeg);
    expect(scalar.rankingWeights).toEqual(pareto.rankingWeights);
  });

  it("avviser kombinasjonen med referansemodus i stedet for å ignorere den", () => {
    expect(() =>
      withDefaults({ scalarSearchMode: true, exactMode: true }),
    ).toThrow(/exactMode/);
  });

  /**
   * Regresjonen: opsjonen skal være **inert** når den er av. Vi kjører de
   * samme golden-scenarioene med og uten et eksplisitt `false` og krever
   * bit-identisk resultat.
   */
  it("endrer ingenting når den er eksplisitt av (golden-scenarioene)", () => {
    for (const scenario of goldenScenarios()) {
      const uendret = JSON.stringify(planRoute(scenario.input));
      const eksplisittAv = JSON.stringify(
        planRoute({
          ...scenario.input,
          options: { ...(scenario.input.options ?? {}), scalarSearchMode: false },
        }),
      );
      expect(eksplisittAv, `${scenario.name} endret seg`).toBe(uendret);
    }
  }, 300_000);

  it("gir en gyldig rute, med færre aktive etiketter enn Pareto", () => {
    const scenario = goldenScenarios().find(
      (s) => s.name === "skjaeloy-skagen-apent",
    )!;
    const pareto = planRoute(scenario.input);
    const scalar = planRouteScalar(scenario.input);
    expect(scalar.reached).toBe(true);
    expect(scalar.safety.reachesDestination).toBe(true);
    expect(scalar.diagnostics.peakActiveLabels).toBeLessThanOrEqual(
      pareto.diagnostics.peakActiveLabels,
    );
    // Skalarsøket er en tilnærming — det skal ikke være *bedre* enn fasiten.
    expect(scalar.totals.durationS).toBeGreaterThanOrEqual(
      pareto.totals.durationS - 1,
    );
  }, 120_000);

  it("er deterministisk", () => {
    const scenario = goldenScenarios().find((s) => s.name === "ren-kryssetappe")!;
    expect(JSON.stringify(planRouteScalar(scenario.input))).toBe(
      JSON.stringify(planRouteScalar(scenario.input)),
    );
  }, 120_000);
});

// ------------------------------------------------------ variant B: korridor

describe("korridor-masken", () => {
  const route: readonly LatLon[] = [
    { lat: 58.0, lon: 10.6 },
    { lat: 58.5, lon: 10.6 },
  ];

  it("måler avstand til ruten, ikke til endepunktene", () => {
    expect(distanceToRouteNm(route, { lat: 58.25, lon: 10.6 })).toBeCloseTo(0, 6);
    // 0,1° lengde ved 58,25° N ≈ 3,15 nm.
    expect(
      distanceToRouteNm(route, { lat: 58.25, lon: 10.7 }),
    ).toBeCloseTo(3.15, 1);
  });

  it("stenger alt utenfor røret, hardt", () => {
    const mask = corridorMask({ route, tubeNm: 3 });
    expect(mask.pointVerdict(58.25, 10.6).passable).toBe(true);
    const outside = mask.pointVerdict(58.25, 10.8);
    expect(outside.passable).toBe(false);
    expect(outside.tillit).toBe("no-go");
  });

  it("avviser en korde som forlater røret underveis", () => {
    const mask = corridorMask({ route, tubeNm: 3 });
    // Begge endene ligger på ruten, men buen ut og inn igjen ville brutt røret
    // hvis den ble seilt — segmenttesten er rett linje, så vi tester en linje
    // som stikker ut sidelengs.
    expect(mask.segmentVerdict(58.1, 10.6, 58.2, 10.8).passable).toBe(false);
    expect(mask.segmentVerdict(58.1, 10.6, 58.2, 10.62).passable).toBe(true);
  });

  it("overestimerer aldri klaringen — R3-gaten hviler på det", () => {
    const base = rectMask({
      noGo: [{ latMin: 58.2, latMax: 58.3, lonMin: 10.65, lonMax: 10.7 }],
    });
    const mask = corridorMask({ route, tubeNm: 3, mask: base });
    for (let lat = 58.0; lat <= 58.5; lat += 0.05) {
      for (let lon = 10.55; lon <= 10.7; lon += 0.02) {
        const p = { lat, lon };
        const value = mask.clearanceNm(lat, lon, 5);
        expect(value).toBeLessThanOrEqual(base.clearanceNm(lat, lon, 5) + 1e-9);
        expect(value).toBeLessThanOrEqual(3 - distanceToRouteNm(route, p) + 1e-9);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("delegerer TSS og dekning til den underliggende masken", () => {
    const base = rectMask({
      tss: [
        {
          latMin: 58.1,
          latMax: 58.3,
          lonMin: 10.5,
          lonMax: 10.7,
          axisDeg: 0,
          reason: "test-TSS",
        },
      ],
      coverage: "partial",
    });
    const mask = corridorMask({ route, tubeNm: 3, mask: base });
    expect(mask.tssVerdict(58.15, 10.6, 58.25, 10.6)).toEqual(
      base.tssVerdict(58.15, 10.6, 58.25, 10.6),
    );
    expect(mask.coverage).toBe("partial");
    expect(mask.sources).toBe(base.sources);
  });
});

describe("variant B — korridorevaluering", () => {
  const fixture = s3FrontEnsemble();
  const control = planRoute(controlInput(fixture));
  const route = control.steps.map((s) => ({ lat: s.lat, lon: s.lon }));

  it("gir samme dom som en fri evaluering når båten holder seg i røret", () => {
    const member = fixture.members.find((m) => m.id === "m00")!;
    const free = evaluateRoute({
      waypoints: route,
      departEpochS: fixture.departEpochS,
      weather: member.weather,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
    });
    const corridor = corridorMemberOutcome({
      route,
      departEpochS: fixture.departEpochS,
      weather: member.weather,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
      harbours: INTERIM_BAILOUT_HARBOURS,
    });
    expect(corridor.evaluation.feasible).toBe(free.feasible);
    expect(corridor.evaluation.cost).toEqual(free.cost);
    // Ingen hard feil ⇒ ingen re-søk. Kostnaden er én evaluering.
    expect(corridor.r2).toBeNull();
    expect(corridor.searchCount).toBe(0);
    expect(corridor.evaluationCount).toBe(1);
  }, 120_000);

  it("utløser R2-re-søk først når evalueringen feiler hardt", () => {
    const member = fixture.members.find((m) => m.id === "m09")!;
    const outcome = corridorMemberOutcome({
      route,
      departEpochS: fixture.departEpochS,
      weather: member.weather,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
      harbours: INTERIM_BAILOUT_HARBOURS,
    });
    expect(outcome.evaluation.feasible).toBe(false);
    expect(outcome.evaluation.rejection?.kind).toBe("boatLimits");
    expect(outcome.r2).not.toBeNull();
    expect(outcome.searchCount).toBeGreaterThan(0);
  }, 120_000);
});

// ------------------------------------------------------------ R2 (fasiten)

describe("R2 — felle-definisjonen", () => {
  it("skiller harde avvisninger fra treghet og degradering", () => {
    const base = {
      reason: "",
      lat: 58,
      lon: 10.6,
      tS: 0,
      epochS: 0,
      waypointIndex: 1,
      stepIndex: 1,
    } as const;
    for (const kind of ["boatLimits", "point", "clearance", "segment", "tss"] as const) {
      expect(isHardRejection({ ...base, kind })).toBe(true);
    }
    for (const kind of [
      "noWeather",
      "noSpeed",
      "noProgress",
      "stepBudget",
      "daylightArrival",
    ] as const) {
      expect(isHardRejection({ ...base, kind })).toBe(false);
    }
    expect(isHardRejection(null)).toBe(false);
  });

  const harbour: BailoutHarbour = {
    name: "Testhavn",
    position: { lat: 58.5, lon: 10.6 },
    exposedFromDeg: 180,
    exposedHalfWidthDeg: 45,
    maxOnshoreTwsKn: 25,
    maxHsM: 2.5,
  };

  it("diskvalifiserer havnen ved pålandskuling i medlemmets vær", () => {
    const onshoreGale = constantWeather({ speedKn: 30, fromDeg: 175 });
    expect(harbourApproachable(harbour, onshoreGale, 0).approachable).toBe(false);
    // Samme styrke fra motsatt kant er fralandsvind — havnen er brukbar.
    const offshoreGale = constantWeather({ speedKn: 30, fromDeg: 355 });
    expect(harbourApproachable(harbour, offshoreGale, 0).approachable).toBe(true);
  });

  it("diskvalifiserer havnen ved for høy sjø, uansett retning", () => {
    const bigSea = constantWeather({ speedKn: 10, fromDeg: 0, hsM: 3.0 });
    const verdict = harbourApproachable(harbour, bigSea, 0);
    expect(verdict.approachable).toBe(false);
    expect(verdict.reason).toContain("Hs");
  });

  it("regner manglende værdata som ikke anløpbar (ærlig degradering)", () => {
    const gap = constantWeather({
      speedKn: 12,
      fromDeg: 270,
      validFromS: 0,
      validToS: 100,
    });
    expect(harbourApproachable(harbour, gap, 5_000).approachable).toBe(false);
  });

  it("gir ingen felle og ingen re-søk når ruten holder i medlemmet", () => {
    const fixture = s3FrontEnsemble();
    const control = planRoute(controlInput(fixture));
    const route = control.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
    const member = fixture.members.find((m) => m.id === "m20")!;
    const verdict = r2Verdict({
      route,
      departEpochS: fixture.departEpochS,
      weather: member.weather,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
      r2: { harbours: INTERIM_BAILOUT_HARBOURS },
    });
    expect(verdict.failure).toBeNull();
    expect(verdict.isTrap).toBe(false);
    expect(verdict.searchCount).toBe(0);
  }, 120_000);

  it("bruker 6 timer som standardskranke", () => {
    expect(R2_LIMIT_S).toBe(6 * 3600);
  });

  /**
   * Fasiten skal være uavhengig av variant Bs mekanikk (steg3-planen §3):
   * `mode` er en parameter, og de to modusene deler all annen semantikk —
   * skranke, anløpbarhet og hva som teller som hard feil.
   */
  it("kjører re-søket i den mekanikken kalleren ber om", () => {
    const fixture = s3FrontEnsemble();
    const control = planRoute(controlInput(fixture));
    const route = control.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
    const member = fixture.members.find((m) => m.id === "m14")!;
    const common = {
      route,
      departEpochS: fixture.departEpochS,
      weather: member.weather,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
    };
    const pareto = r2Verdict({
      ...common,
      r2: { harbours: INTERIM_BAILOUT_HARBOURS, mode: "pareto" },
    });
    const corridor = r2Verdict({
      ...common,
      r2: {
        harbours: INTERIM_BAILOUT_HARBOURS,
        mode: "korridor-skalar",
        tubeNm: 4,
      },
    });
    // Samme feilpunkt — den delen er evaluatorens, ikke re-søkets.
    expect(corridor.failure?.tS).toBe(pareto.failure?.tS);
    expect(corridor.from).toEqual(pareto.from);
    // Begge skal komme fram til en dom; om de er enige er det målingen som
    // skal avgjøre, ikke denne testen.
    expect(typeof corridor.isTrap).toBe("boolean");
    expect(pareto.attempts.length).toBeGreaterThan(0);
  }, 180_000);
});

// --------------------------------------------------------------- sanitetsvern

describe("målevariantene lekker ikke inn i produksjonsadferden", () => {
  it("planRoute uten opsjoner er upåvirket av at variantene finnes", () => {
    const input = {
      start: { lat: 58.0, lon: 10.6 },
      dest: { lat: 58.4, lon: 10.6 },
      departEpochS: 1781668800,
      weather: constantWeather({
        speedKn: 14,
        fromDeg: 270,
        validFromS: 1781668800 - 3600,
        validToS: 1781668800 + 86400,
      }),
      mask: rectMask(),
      boat: testBoat(),
      options: { headingStepDeg: 15, timeStepS: 3600 },
    };
    const a = planRoute(input);
    expect(a.reached).toBe(true);
    expect(withDefaults(input.options).scalarSearchMode).toBe(false);
    expect(withDefaults(input.options).maxLabelsPerState).toBe(
      DEFAULT_ROUTE_OPTIONS.maxLabelsPerState,
    );
  });
});
