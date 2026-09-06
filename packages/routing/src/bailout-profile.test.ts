/**
 * **Bail-out-profilen** (`docs/specs/robusthet.md` §4.5 og §5.6, D8.6 (b)).
 *
 * Kravene i §5.6, punkt for punkt:
 *
 *  - golden `skjaeloy-skagen-apent` + interim-havnelisten gir minst ett
 *    `naadd`-punkt (dagens R2 gir null på en trygg rute — det er bugen);
 *  - tom havnebok ⇒ `coverage: "none"`, `longestGapS: null`;
 *  - havn uten dybde ⇒ ekskludert med `mangler-dybde`, `coverage: "partial"`;
 *  - mørke-gaten forkaster en havn med `nightApproachSafe: false` ved ankomst
 *    utenfor dagslys;
 *  - `backoffS = min(Δt, 1800)` uavhengig av tidssteg — den bor i
 *    `bailout.test.ts` («er min(Δt, 1800 s) uavhengig av tidssteg») og
 *    gjentas ikke her.
 *
 * Admissibiliteten (200 seedede punkter) står i `harbour-field.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import {
  bookNightSafe,
  bookWithoutDepth,
  INTERIM_HARBOUR_BOOK,
} from "../test-fixtures/harbour-book.js";
import { harbourFieldVmaxKn } from "./harbour-field.js";
import type { BailoutSample } from "./bailout-profile.js";
import {
  BAILOUT_SAMPLE_INTERVAL_S,
  bailoutProfile,
  gapAtLeastLimit,
  longestGapS,
  positionAtTS,
  sampleTimesS,
} from "./bailout-profile.js";
import { buildHarbourField, type HarbourField } from "./harbour-field.js";
import type { RouteResult, RouteStep } from "./result.js";
import { planRoute } from "./search.js";

const SCENARIO = goldenScenarios().find(
  (s) => s.name === "skjaeloy-skagen-apent",
)!;
const INPUT = SCENARIO.input;
const VMAX_KN = harbourFieldVmaxKn(INPUT.boat, INPUT.weather);

/**
 * Grov søkemekanikk i R2-søkene. Profilens *semantikk* er uavhengig av
 * mekanikken (den spør bare «kom du fram innen skranken»), og testene skal
 * kunne kjøres i standardtieren. Kostnaden på full oppløsning måles i
 * `bailout-cost.damage.test.ts`.
 */
const COARSE_SEARCH = { headingStepDeg: 30, cellDeg: 0.05 } as const;

let goldenRoute: RouteResult | undefined;
function route(): RouteResult {
  goldenRoute ??= planRoute(INPUT);
  return goldenRoute;
}

let goldenFields: Map<string, HarbourField> | undefined;
function fields(): Map<string, HarbourField> {
  if (goldenFields === undefined) {
    goldenFields = new Map();
    for (const h of INTERIM_HARBOUR_BOOK) {
      goldenFields.set(
        h.id,
        buildHarbourField(h, INPUT.mask, {
          vmaxKn: VMAX_KN,
          cellDeg: 0.02,
          maskVersion: "golden-rectmask-v1",
        }),
      );
    }
  }
  return goldenFields;
}

function profileFor(
  book: readonly (typeof INTERIM_HARBOUR_BOOK)[number][],
): ReturnType<typeof bailoutProfile> {
  const r = route();
  return bailoutProfile({
    route: { steps: r.steps, legs: r.legs },
    departEpochS: INPUT.departEpochS,
    weather: INPUT.weather,
    mask: INPUT.mask,
    boat: INPUT.boat,
    book,
    fields: fields(),
    options: INPUT.options,
    searchOptions: COARSE_SEARCH,
  });
}

function stepAt(tS: number, lat: number, lon: number): RouteStep {
  return {
    lat,
    lon,
    tS,
    epochS: INPUT.departEpochS + tS,
    headingDeg: 180,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    twsKn: 10,
    twdDeg: 240,
    bspKn: 6,
    hsM: 1,
    flags: 0,
    flagNames: [],
  };
}

function sample(tS: number, status: BailoutSample["status"]): BailoutSample {
  return {
    epochS: INPUT.departEpochS + tS,
    tS,
    position: { lat: 58, lon: 10.8 },
    lowerBoundS: 0,
    status,
    harbourId: status === "naadd" ? "x" : null,
    timeToHarbourS: null,
    gatesFailed: [],
    searched: false,
    searchCount: 0,
  };
}

describe("sampleTimesS og positionAtTS", () => {
  it("sampler hvert 30. minutt, pluss ved hvert segmentskifte", () => {
    const steps = [
      stepAt(0, 59, 10.9),
      stepAt(3600, 58.8, 10.9),
      stepAt(7200, 58.6, 10.9),
    ];
    const legs = [{ startTS: 2700 }] as unknown as RouteResult["legs"];
    const times = sampleTimesS({ steps, legs }, BAILOUT_SAMPLE_INTERVAL_S);
    expect([...times]).toEqual([0, 1800, 2700, 3600, 5400, 7200]);
  });

  it("interpolerer posisjonen mellom rutepunktene", () => {
    const steps = [stepAt(0, 59, 10.0), stepAt(3600, 58, 11.0)];
    expect(positionAtTS(steps, 1800)).toEqual({ lat: 58.5, lon: 10.5 });
    expect(positionAtTS(steps, -100)).toEqual({ lat: 59, lon: 10 });
    expect(positionAtTS(steps, 99_999)).toEqual({ lat: 58, lon: 11 });
    expect(positionAtTS([], 0)).toBeUndefined();
  });
});

describe("longestGapS", () => {
  const interval = BAILOUT_SAMPLE_INTERVAL_S;

  it("måler lengste ubrutte strekk uten «naadd», rundet opp med et halvt intervall", () => {
    const samples = [
      sample(0, "naadd"),
      sample(1800, "ingen-innen-6t"),
      sample(3600, "ikke-anloepbar"),
      sample(5400, "naadd"),
      sample(7200, "ukjent"),
    ];
    // 1800 → 3600 er 1800 s, pluss et halvt sampleintervall.
    expect(longestGapS(samples, interval)).toBe(1800 + interval / 2);
  });

  it("gir et halvt intervall for ett enkelt punkt uten havn — ikke null", () => {
    expect(longestGapS([sample(0, "naadd"), sample(1800, "ukjent")], interval)).toBe(
      interval / 2,
    );
  });

  it("er null-strekk når hvert punkt har en havn, og null når det ikke finnes samples", () => {
    expect(longestGapS([sample(0, "naadd"), sample(1800, "naadd")], interval)).toBeNull();
    expect(longestGapS([], interval)).toBeNull();
  });
});

describe("bailoutProfile på golden skjaeloy-skagen-apent", () => {
  it("gir minst ett «naadd»-punkt med interim-havneboken", () => {
    const profile = profileFor(INTERIM_HARBOUR_BOOK);
    const naadd = profile.samples.filter((s) => s.status === "naadd");
    expect(profile.samples.length).toBeGreaterThan(20);
    expect(naadd.length).toBeGreaterThan(0);
    for (const s of naadd) {
      expect(s.harbourId).not.toBeNull();
      expect(s.timeToHarbourS).not.toBeNull();
      expect(s.timeToHarbourS!).toBeLessThanOrEqual(profile.limitS);
      // Feltets skranke skal ligge under den målte tiden i hvert eneste
      // punkt profilen faktisk nådde fram i (admissibilitet, §5.6).
      expect(s.lowerBoundS).toBeLessThanOrEqual(s.timeToHarbourS!);
    }
  }, 120_000);

  it("merker basis og dekning uten at UI-et må huske det", () => {
    const profile = profileFor(INTERIM_HARBOUR_BOOK);
    expect(profile.basis).toBe("kontrollvaer");
    expect(profile.label).toBe("kontrollvær — ikke ensemble-sjekket");
    expect(profile.coverage).toBe("full");
    expect(profile.missingDepthHarbourIds).toEqual([]);
    expect(profile.longestGapS).not.toBeNull();
    expect(profile.sampleIntervalS).toBe(BAILOUT_SAMPLE_INTERVAL_S);
  }, 120_000);

  it("er deterministisk: samme input gir bit-identisk profil", () => {
    const a = profileFor(INTERIM_HARBOUR_BOOK);
    const b = profileFor(INTERIM_HARBOUR_BOOK);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 120_000);

  it("bruker havnefeltet som forfilter og teller hva det sparte", () => {
    const profile = profileFor(INTERIM_HARBOUR_BOOK);
    expect(profile.fieldScreenedCandidates).toBeGreaterThan(0);
    // Feltet siler flere kandidater enn det kjøres søk — ellers var det
    // ingen grunn til å ha det (D8.10).
    expect(profile.fieldScreenedCandidates).toBeGreaterThan(profile.searchCount);
  }, 120_000);
});

describe("dekning og gates", () => {
  it("tom havnebok ⇒ coverage «none» og longestGapS null", () => {
    const profile = profileFor([]);
    expect(profile.coverage).toBe("none");
    expect(profile.longestGapS).toBeNull();
    // Ingen samples: «havneboken mangler dekning her», aldri «ingen havn».
    expect(profile.samples).toEqual([]);
    expect(profile.searchCount).toBe(0);
    expect(gapAtLeastLimit(profile)).toBe(false);
  }, 120_000);

  it("havn uten dybde ⇒ ekskludert med «mangler-dybde» og coverage «partial»", () => {
    const profile = profileFor([...bookWithoutDepth(INTERIM_HARBOUR_BOOK, "smogen")]);
    expect(profile.coverage).toBe("partial");
    expect(profile.missingDepthHarbourIds).toEqual(["smogen"]);
    for (const s of profile.samples) {
      expect(s.gatesFailed).toContain("mangler-dybde");
      expect(s.harbourId).not.toBe("smogen");
    }
  }, 120_000);

  it("havn som er for grunn ⇒ «dybde», ikke «mangler-dybde»", () => {
    const shallow = INTERIM_HARBOUR_BOOK.map((h) =>
      h.id === "smogen"
        ? {
            ...h,
            minDepthAtQuayM: { valueM: 1.0, source: "test", date: "2026-09-05" },
          }
        : h,
    );
    const profile = profileFor(shallow);
    // Dybdeavvisning er ikke manglende dekning: boken svarte, svaret var nei.
    expect(profile.coverage).toBe("full");
    expect(profile.missingDepthHarbourIds).toEqual([]);
    for (const s of profile.samples) expect(s.gatesFailed).toContain("dybde");
  }, 120_000);

  it("mørke-gaten forkaster havner ved ankomst utenfor dagslys", () => {
    const strict = profileFor(INTERIM_HARBOUR_BOOK);
    const darkRejected = strict.samples.filter((s) =>
      s.gatesFailed.includes("moerke"),
    );
    // Ruten går inn i natten mot Skagen: gaten SKAL slå til her.
    expect(darkRejected.length).toBeGreaterThan(0);
    for (const s of darkRejected) expect(s.status).not.toBe("naadd");

    // Samme rute, samme vær, eneste forskjell: havnene er merket mørketrygge.
    // Da skal nettopp de punktene kunne nå fram.
    const relaxed = profileFor([...bookNightSafe(INTERIM_HARBOUR_BOOK)]);
    const relaxedByTS = new Map(relaxed.samples.map((s) => [s.tS, s]));
    const flipped = darkRejected.filter(
      (s) => relaxedByTS.get(s.tS)?.status === "naadd",
    );
    expect(flipped.length).toBeGreaterThan(0);
    expect(relaxed.longestGapS ?? 0).toBeLessThanOrEqual(strict.longestGapS ?? 0);
  }, 120_000);
});

describe("havnefeltets ene konklusjon", () => {
  /** En kort rute langt vest i Nordsjøen: ingen havn i boken er i nærheten. */
  function farRoute(): RouteStep[] {
    return [
      stepAt(0, 58.0, 4.0),
      stepAt(3600, 58.1, 4.1),
      stepAt(7200, 58.2, 4.2),
    ];
  }

  it("melder «ingen-innen-6t» uten å kjøre et eneste søk", () => {
    const profile = bailoutProfile({
      route: { steps: farRoute() },
      departEpochS: INPUT.departEpochS,
      weather: INPUT.weather,
      mask: INPUT.mask,
      boat: INPUT.boat,
      book: INTERIM_HARBOUR_BOOK,
      fields: fields(),
      options: INPUT.options,
      searchOptions: COARSE_SEARCH,
    });
    expect(profile.searchCount).toBe(0);
    expect(profile.samples.length).toBe(5);
    for (const s of profile.samples) {
      expect(s.status).toBe("ingen-innen-6t");
      expect(s.searched).toBe(false);
      expect(s.lowerBoundS).toBe(Infinity);
    }
    expect(profile.fieldScreenedSamples).toBe(5);
    // 5 samples × 8 havner: hele strekket er ett langt hull.
    expect(profile.longestGapS).toBe(7200 + BAILOUT_SAMPLE_INTERVAL_S / 2);
    expect(gapAtLeastLimit(profile)).toBe(false);
  }, 120_000);
});

describe("budsjettventilen maxSearchesPerSample", () => {
  it("etterlater «ukjent», aldri «ingen-innen-6t»", () => {
    const r = route();
    const profile = bailoutProfile({
      route: { steps: r.steps, legs: r.legs },
      departEpochS: INPUT.departEpochS,
      weather: INPUT.weather,
      mask: INPUT.mask,
      boat: INPUT.boat,
      // Bare Skagen i boken, og null søk tillatt: da vet vi ingenting.
      book: INTERIM_HARBOUR_BOOK.filter((h) => h.id === "skagen"),
      fields: fields(),
      options: INPUT.options,
      searchOptions: COARSE_SEARCH,
      maxSearchesPerSample: 0,
    });
    expect(profile.searchCount).toBe(0);
    const withCandidates = profile.samples.filter((s) =>
      Number.isFinite(s.lowerBoundS),
    );
    expect(withCandidates.length).toBeGreaterThan(0);
    for (const s of withCandidates) {
      if (s.lowerBoundS <= profile.limitS) expect(s.status).toBe("ukjent");
    }
  }, 120_000);
});
