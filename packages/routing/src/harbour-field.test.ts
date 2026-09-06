/**
 * **Havnefeltet — admissibilitet er hele poenget** (`docs/specs/robusthet.md`
 * §5.6, D8.10).
 *
 * Feltet har lov til å si én ting: «denne havnen kan ikke nås innen 6 timer».
 * Sier den det om en havn som *kunne* vært nådd, har bail-out-profilen
 * meldt «ingen trygg havn» der det fantes en — den farligste feilen dette
 * delsystemet kan gjøre, og den ville aldri vist seg som en krasj.
 *
 * Testen under er §5.6s krav, ordrett: for 200 seedede punkter på
 * golden-masken sammenlignes feltets `lowerBoundS` med den **faktiske**
 * R2-tiden der R2 lykkes. Kravet er `lowerBoundS ≤ faktisk` — aldri over.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../test-fixtures/seeded-random.js";
import {
  GOLDEN_DEPART_S,
  goldenScenarios,
} from "../test-fixtures/golden-scenarios.js";
import { INTERIM_HARBOUR_BOOK } from "../test-fixtures/harbour-book.js";
import { r2SearchInput, R2_LIMIT_S,  } from "./bailout.js";
import { harbourFieldVmaxKn } from "./harbour-field.js";
import type { LatLon } from "./contracts.js";
import {
  buildHarbourField,
  froundDown,
  type HarbourField,
  lowerBoundNm,
  lowerBoundS,
  OCTILE_MAX_RATIO,
  rawFieldDistanceNm,
} from "./harbour-field.js";
import { planRoute } from "./search.js";

const SCENARIO = goldenScenarios().find(
  (s) => s.name === "skjaeloy-skagen-apent",
)!;
const INPUT = SCENARIO.input;
const VMAX_KN = harbourFieldVmaxKn(INPUT.boat, INPUT.weather);

/** Grov søkemekanikk for de 200 punktene — se docstringen ved testen. */
const COARSE_SEARCH = { headingStepDeg: 30, cellDeg: 0.05 } as const;

function buildFields(cellDeg: number): Map<string, HarbourField> {
  const fields = new Map<string, HarbourField>();
  for (const h of INTERIM_HARBOUR_BOOK) {
    fields.set(
      h.id,
      buildHarbourField(h, INPUT.mask, {
        vmaxKn: VMAX_KN,
        cellDeg,
        maskVersion: "golden-rectmask-v1",
      }),
    );
  }
  return fields;
}

describe("buildHarbourField", () => {
  const field = buildHarbourField(INTERIM_HARBOUR_BOOK[4]!, INPUT.mask, {
    vmaxKn: VMAX_KN,
    cellDeg: 0.02,
  });

  it("er null i havnen selv og endelig i nærheten", () => {
    const h = INTERIM_HARBOUR_BOOK[4]!;
    expect(rawFieldDistanceNm(field, h.position.lat, h.position.lon)).toBe(0);
    expect(lowerBoundS(field, h.position)).toBe(0);
    expect(field.reachedCells).toBeGreaterThan(100);
  });

  it("er avkortet: ingen celle over rekkevidden vmax · limit", () => {
    const reachNm = (VMAX_KN * R2_LIMIT_S) / 3600;
    for (const v of field.distanceNm) {
      if (Number.isFinite(v)) expect(v).toBeLessThanOrEqual(reachNm);
    }
  });

  it("gir Infinity utenfor boksen — «ikke nåbar», aldri et gjettet tall", () => {
    expect(lowerBoundS(field, { lat: 50, lon: 4 })).toBe(Infinity);
    expect(lowerBoundS(field, { lat: 62, lon: 18 })).toBe(Infinity);
  });

  it("stenges av masken: land gir ingen forplantning", () => {
    // Midt i «Jylland»-rektangelet i golden-masken.
    expect(rawFieldDistanceNm(field, 57.0, 9.0)).toBe(Infinity);
  });

  it("krever en endelig positiv vmax", () => {
    expect(() =>
      buildHarbourField(INTERIM_HARBOUR_BOOK[0]!, INPUT.mask, { vmaxKn: 0 }),
    ).toThrow(/vmaxKn/);
  });

  it("lagrer i Float32 uten å runde OPP (froundDown)", () => {
    for (const v of field.distanceNm) {
      if (Number.isFinite(v)) expect(Math.fround(v)).toBe(v);
    }
    const rnd = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = rnd() * 100;
      expect(froundDown(v)).toBeLessThanOrEqual(v);
      expect(Math.fround(froundDown(v))).toBe(froundDown(v));
    }
    expect(froundDown(Infinity)).toBe(Infinity);
    expect(froundDown(0)).toBe(0);
  });

  it("trekker fra gridgeometri og snapping i den trygge retningen", () => {
    expect(OCTILE_MAX_RATIO).toBeCloseTo(1.08239, 5);
    const h = INTERIM_HARBOUR_BOOK[4]!;
    // Vestover fra Smögen: åpent vann i golden-masken.
    const p = { lat: h.position.lat + 0.1, lon: h.position.lon - 0.3 };
    const raw = rawFieldDistanceNm(field, p.lat, p.lon);
    expect(Number.isFinite(raw)).toBe(true);
    expect(lowerBoundNm(field, p.lat, p.lon)).toBeLessThan(raw);
  });
});

/**
 * §5.6: **200 seedede punkter.**
 *
 * For hvert punkt velges havnen med lavest `lowerBoundS` (det er den
 * profilen ville forsøkt først), og det ekte R2-søket kjøres derfra med
 * nøyaktig den inngangen profilen bruker (`r2SearchInput`, pareto, udelt
 * maske, `noTubBound`). Lykkes søket, må skranken ligge under den målte
 * tiden.
 *
 * **Hvorfor søket kjøres grovt (30°, cellDeg 0,05).** Full golden-oppløsning
 * gir 98 s for de 200 punktene; det er for dyrt i standardtieren. Målingen ble
 * kjørt begge veier 2026-09-05, og tallene er praktisk talt like:
 *
 *   | mekanikk | søk | R2 lyktes | brudd | minste margin |
 *   |---|---|---|---|---|
 *   | golden (6°) | 200 | 168 | 0 | 1,56 |
 *   | grov (30°, cellDeg 0,05) | 200 | 164 | 0 | 1,52 |
 *
 * «Minste margin» er `faktisk tid / skranke` for det strammeste punktet: selv
 * der er den ekte tiden 52 % over skranken. Retningen skal noteres ærlig: et
 * grovere søk finner en *tregere* rute, så den grove kjøringen er en litt
 * SVAKERE test, ikke en strengere. Med en margin på 1,5 er begge uansett
 * grovkornede vakter — de fanger en fortegnsfeil eller en fjernet korreksjon,
 * ikke en promille.
 *
 * Merk hva testen IKKE kan bevise: at et punkt feltet siler bort (`lowerBoundS
 * > limit`) virkelig var uten havn. Den retningen er ikke testbar uten å
 * kjøre alle søkene feltet finnes for å slippe — den er sikret av
 * konstruksjonen (skranken er en avstand delt på en fart ingen kan overgå) og
 * av at korreksjonene i `lowerBoundNm` bare trekker fra.
 */
describe("admissibilitet (§5.6, 200 seedede punkter)", () => {
  it("lowerBoundS ligger aldri over den faktiske R2-tiden", () => {
    const fields = buildFields(0.02);
    const mask = INPUT.mask!;
    const rnd = mulberry32(20260905);
    const points: LatLon[] = [];
    let draws = 0;
    while (points.length < 200 && draws < 20_000) {
      draws++;
      // Åpen Skagerrak mellom Jylland og Bohuslän — der ruten faktisk går.
      const lat = 57.75 + rnd() * 1.3;
      const lon = 10.0 + rnd() * 1.3;
      if (!mask.pointVerdict(lat, lon).passable) continue;
      points.push({ lat, lon });
    }
    expect(points.length).toBe(200);

    const departEpochS = GOLDEN_DEPART_S + 6 * 3600;
    let searched = 0;
    let succeeded = 0;
    let violations = 0;
    let worstRatio = Infinity;
    let worstNote = "";

    for (const p of points) {
      let best: { id: string; lb: number } | null = null;
      for (const h of INTERIM_HARBOUR_BOOK) {
        const lb = lowerBoundS(fields.get(h.id)!, p);
        if (!Number.isFinite(lb) || lb > R2_LIMIT_S) continue;
        if (best === null || lb < best.lb) best = { id: h.id, lb };
      }
      if (best === null) continue;
      const harbour = INTERIM_HARBOUR_BOOK.find((h) => h.id === best!.id)!;
      searched++;
      const result = planRoute(
        r2SearchInput({
          from: p,
          harbour: harbour.position,
          departEpochS,
          weather: INPUT.weather,
          mask: INPUT.mask,
          boat: INPUT.boat,
          options: INPUT.options,
          // Grov mekanikk med vilje — se docstringen over describe-blokken.
          searchOptions: COARSE_SEARCH,
          maxIterations: Math.ceil(R2_LIMIT_S / 3600) + 1,
          scalarSearchMode: false,
        }),
      );
      if (!result.safety.reachesDestination) continue;
      if (result.totals.durationS > R2_LIMIT_S) continue;
      succeeded++;
      const actualS = result.totals.durationS;
      if (best.lb > actualS) {
        violations++;
        worstNote = `${harbour.name}: skranke ${best.lb.toFixed(0)} s > faktisk ${actualS.toFixed(0)} s fra ${p.lat.toFixed(3)}/${p.lon.toFixed(3)}`;
      }
      const ratio = best.lb > 0 ? actualS / best.lb : Infinity;
      if (ratio < worstRatio) worstRatio = ratio;
    }

    console.log(
      `punkter=${points.length} søkt=${searched} lyktes=${succeeded} brudd=${violations} minRatio=${worstRatio.toFixed(2)}`,
    );
    // Testen skal ha noe å måle på: R2 må faktisk lykkes fra et flertall.
    expect(searched).toBeGreaterThanOrEqual(150);
    expect(succeeded).toBeGreaterThanOrEqual(100);
    expect(violations, worstNote).toBe(0);
    // Slakken er stor med vilje (vmax er maks polarfart + maks strøm).
    expect(worstRatio).toBeGreaterThan(1);
  }, 300_000);
});
