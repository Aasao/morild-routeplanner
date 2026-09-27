/**
 * Golden-route-regresjon (docs/specs/rutemotor.md §8.2).
 *
 * Kjøres med `pnpm --filter @morild/routing test:golden`.
 * Regenerering: `UPDATE_GOLDEN=1 pnpm --filter @morild/routing test:golden`.
 *
 * Sammenligningsregelen er bevisst asymmetrisk:
 *  - **eksakt** på de diskrete feltene (`reached`, `abortReason`,
 *    `safety.verdict`, `recheckPassed`, antall feilende segmenter). Endrer
 *    en av dem seg, har adferden endret seg, punktum.
 *  - **toleranse** på tid og totaler (±2 %), fordi `Math.sin`/`cos`/`atan2`
 *    er implementasjonsdefinert på tvers av V8-versjoner (§5.1).
 *  - **korridor** på geometri (≤ 0,5 nm tverravvik, målt begge veier).
 *
 * Hver algoritmeendring krever ny golden-kjøring, og enhver diff skal
 * forklares i spec-ens endringslogg. Uforklarte differ blokkerer commit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { haversineNm } from "@morild/geo";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import {
  corridorDeviationNm,
  type TrackPoint,
} from "../test-fixtures/track-compare.js";
import { withDefaults } from "./options.js";
import { planRoute } from "./search.js";
import type { RouteResult } from "./result.js";

/**
 * Slakk i R3-invariantens sampling. Motoren garanterer kravet på den lineære
 * lat/lon-korden; testen måler samme korde, men avstandene i masken regnes med
 * `cos(lat)` i punktet og ikke i kordens start. Avviket er millimeter — vi
 * tillater 1e-6 nm (≈ 2 mm) for at testen skal måle semantikk og ikke
 * flyttallsstøy.
 */
const CLEARANCE_SAMPLING_SLACK_NM = 1e-6;

const GOLDEN_DIR = join(import.meta.dirname, "..", "test-fixtures", "golden");
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

/** Toleranse på varighet og totaler (N5). */
const DURATION_TOLERANCE = 0.02;
/** Maks tverravvik mot referansesporet. */
const CORRIDOR_NM = 0.5;

/**
 * Det som faktisk lagres. Bevisst et lite utvalg: en golden-fil som
 * inneholder alt blir en fil ingen leser, og enhver diff blir støy.
 */
interface GoldenSnapshot {
  readonly note: string;
  readonly purpose: string;
  readonly exact: {
    readonly reached: boolean;
    readonly abortReason: string | null;
    readonly safetyVerdict: string;
    /** §5.8/funn 1b — «kom ruten faktisk fram», uavhengig av `reached`. */
    readonly reachesDestination: boolean;
    readonly recheckPassed: boolean;
    readonly failingSegmentCount: number;
    readonly maskCoverage: string;
    readonly weatherCoverage: string;
    readonly fieldUsed: boolean;
    readonly daylightArrival: boolean;
    /** §5.8 — endres denne, har sluttetappens semantikk endret seg. */
    readonly finalLegStatus: string;
    readonly violatesDaylightRequirement: boolean;
  };
  readonly totals: {
    readonly durationS: number;
    readonly distanceNm: number;
    readonly beatS: number;
    readonly motorS: number;
    readonly nightS: number;
    readonly beatAtNightS: number;
    readonly fuelL: number;
  };
  readonly counts: {
    readonly legs: number;
    readonly steps: number;
    readonly alternatives: number;
  };
  readonly track: readonly TrackPoint[];
}

function snapshotOf(result: RouteResult, purpose: string): GoldenSnapshot {
  return {
    note:
      "Syntetisk, frosset fikstur (fase 2). Byttes til ekte MEPS-uttrekk i " +
      "fase 3 — se docs/specs/rutemotor.md §9 spm. 11.",
    purpose,
    exact: {
      reached: result.reached,
      abortReason: result.abortReason,
      safetyVerdict: result.safety.verdict,
      reachesDestination: result.safety.reachesDestination,
      recheckPassed: result.safety.recheckPassed,
      failingSegmentCount: result.safety.failingSegments.length,
      maskCoverage: result.coverage.mask,
      weatherCoverage: result.coverage.weather,
      fieldUsed: result.coverage.fieldUsed,
      daylightArrival: result.totals.daylightArrival,
      finalLegStatus: result.finalLeg.status,
      violatesDaylightRequirement: result.totals.violatesDaylightRequirement,
    },
    totals: {
      durationS: result.totals.durationS,
      distanceNm: round(result.totals.distanceNm, 4),
      beatS: result.totals.beatS,
      motorS: result.totals.motorS,
      nightS: result.totals.nightS,
      beatAtNightS: result.totals.beatAtNightS,
      fuelL: round(result.totals.fuelL, 4),
    },
    counts: {
      legs: result.legs.length,
      steps: result.steps.length,
      alternatives: result.alternatives.length,
    },
    track: result.steps.map((s) => ({
      lat: round(s.lat, 6),
      lon: round(s.lon, 6),
    })),
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function goldenPath(name: string): string {
  return join(GOLDEN_DIR, `${name}.json`);
}

function readGolden(name: string): GoldenSnapshot | undefined {
  const path = goldenPath(name);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as GoldenSnapshot;
}

function writeGolden(name: string, snapshot: GoldenSnapshot): void {
  const path = goldenPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

/** Relativ toleranse som også godtar små absolutte differ på små tall. */
function expectWithinTolerance(
  actual: number,
  expected: number,
  fraction: number,
  absoluteFloor: number,
  label: string,
): void {
  const allowed = Math.max(Math.abs(expected) * fraction, absoluteFloor);
  const diff = Math.abs(actual - expected);
  expect(
    diff,
    `${label}: ${actual} avviker ${diff.toFixed(3)} fra golden ${expected} (tillatt ${allowed.toFixed(3)})`,
  ).toBeLessThanOrEqual(allowed);
}

describe("golden-ruter", () => {
  for (const scenario of goldenScenarios()) {
    it(`${scenario.name} er uendret mot frosset referanse`, () => {
      const result = planRoute(scenario.input);
      const actual = snapshotOf(result, scenario.purpose);

      if (UPDATE) {
        writeGolden(scenario.name, actual);
        return;
      }

      const golden = readGolden(scenario.name);
      expect(
        golden,
        `Golden-fil mangler for «${scenario.name}». Kjør med UPDATE_GOLDEN=1 og commit resultatet.`,
      ).toBeDefined();
      if (golden === undefined) return;

      // Eksakt på de diskrete feltene.
      expect(actual.exact).toEqual(golden.exact);

      // Toleranse på tid og totaler.
      expectWithinTolerance(
        actual.totals.durationS,
        golden.totals.durationS,
        DURATION_TOLERANCE,
        1,
        "durationS",
      );
      expectWithinTolerance(
        actual.totals.distanceNm,
        golden.totals.distanceNm,
        DURATION_TOLERANCE,
        0.05,
        "distanceNm",
      );
      for (const key of [
        "beatS",
        "motorS",
        "nightS",
        "beatAtNightS",
      ] as const) {
        expectWithinTolerance(
          actual.totals[key],
          golden.totals[key],
          DURATION_TOLERANCE,
          1800,
          `totals.${key}`,
        );
      }

      // Korridor på geometri.
      if (golden.track.length > 1 && actual.track.length > 1) {
        const deviation = corridorDeviationNm(actual.track, golden.track);
        expect(
          deviation,
          `${scenario.name}: sporet avviker ${deviation.toFixed(3)} nm fra golden-korridoren`,
        ).toBeLessThanOrEqual(CORRIDOR_NM);
      }
    }, 60_000);
  }

  it("alle scenarioer har en committet golden-fil", () => {
    if (UPDATE) return;
    for (const scenario of goldenScenarios()) {
      expect(
        existsSync(goldenPath(scenario.name)),
        `Mangler golden-fil for ${scenario.name}`,
      ).toBe(true);
    }
  });
});

describe("golden-ruter er deterministiske", () => {
  // Én test per scenario: løkken i én test sprengte 120 s under
  // full-suite-parallellitet 2026-09-27 (CPU-konkurranse, ikke regresjon).
  for (const scenario of goldenScenarios()) {
    it(`gir identisk resultat i to kjøringer — ${scenario.name}`, () => {
      const first = JSON.stringify(planRoute(scenario.input));
      const second = JSON.stringify(planRoute(scenario.input));
      expect(second, `${scenario.name} er ikke deterministisk`).toBe(first);
    }, 120_000);
  }
});

/**
 * Invarianten som ville fanget E-funnet 2026-08-31 (tidsfri sluttetappe) uten
 * at noen måtte lete etter den: **ingen distanse uten tid**. Et steg som
 * flytter båten må koste sekunder — ellers har vi teleportert, og både
 * varighet, ankomsttid og alle avledede tall er feil.
 */
describe("kinematisk invariant på golden-rutene", () => {
  it("hvert steg som flytter båten koster tid", () => {
    for (const scenario of goldenScenarios()) {
      const result = planRoute(scenario.input);
      for (let i = 1; i < result.steps.length; i++) {
        const prev = result.steps[i - 1]!;
        const cur = result.steps[i]!;
        const movedNm = haversineNm(prev, cur);
        if (movedNm <= 1e-6) continue;
        expect(
          cur.tS - prev.tS,
          `${scenario.name} steg ${i}: ${movedNm.toFixed(3)} nm på 0 s`,
        ).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  /**
   * Sluttetappen (§5.8) er enten lagt til — og da ender ruten i målet — eller
   * avvist, og da skal `shortfallNm` fortelle nøyaktig hvor langt unna ruten
   * stoppet. Ingen mellomting, ingen stille kortslutning.
   */
  it("finalLeg beskriver avstanden fra rutens siste punkt til målet", () => {
    for (const scenario of goldenScenarios()) {
      const result = planRoute(scenario.input);
      const last = result.steps[result.steps.length - 1]!;
      const actualNm = haversineNm(last, scenario.input.dest);
      if (result.finalLeg.status === "lagt-til") {
        expect(actualNm, scenario.name).toBeLessThan(1e-6);
        expect(result.finalLeg.shortfallNm).toBe(0);
      } else if (result.finalLeg.status !== "ikke-nodvendig") {
        expect(result.finalLeg.shortfallNm, scenario.name).toBeCloseTo(
          actualNm,
          9,
        );
      }
    }
  }, 120_000);

  /**
   * Funn 1b (code-review runde 2, 2026-08-31): en avvist sluttetappe skal
   * aldri kunne stå som rent «trygt». `safety.reachesDestination` er den
   * toppnivå-boolske nedstrøms kode skal lese — den kan ikke drifte fra
   * `finalLeg.status`.
   */
  it("en avvist sluttetappe kan aldri stå som «trygt»", () => {
    for (const scenario of goldenScenarios()) {
      const result = planRoute(scenario.input);
      const status = result.finalLeg.status;
      expect(result.safety.reachesDestination, scenario.name).toBe(
        status === "lagt-til" || status === "ikke-nodvendig",
      );
      if (status.startsWith("avvist-")) {
        expect(result.safety.verdict, scenario.name).not.toBe("trygt");
      }
    }
  }, 120_000);
});

/**
 * R3-invarianten (§5.3.2): kystbufferen skal holde **langs hele** hver etappe,
 * ikke bare i endepunktene. Testen er bevisst uavhengig av motorens egen
 * korridorkode — den sampler klaringen tett langs etappen og sammenligner med
 * kravet direkte. Det er dette som gjør den til en ekte ettersjekk og ikke
 * bare en gjentagelse av implementasjonen.
 *
 * Fram til 2026-08-31 feilet den på `bohuslan-trange-sund`: ruten passerte et
 * skjær med 0,088 nm klaring der kravet var 0,15 nm, fordi bare
 * kandidatpunktene ble kontrollert.
 */
describe("R3: kystbufferen holder langs hele ruten, ikke bare i punktene", () => {
  const SAMPLES_PER_LEG = 400;

  it("ingen golden-rute går innenfor kravet noe sted mellom to steg", () => {
    for (const scenario of goldenScenarios()) {
      const result = planRoute(scenario.input);
      const mask = scenario.input.mask;
      if (mask === undefined) continue;
      const opts = withDefaults(scenario.input.options ?? {});
      if (opts.minOffingNm <= 0) continue;

      const exempt = (p: { lat: number; lon: number }): boolean =>
        haversineNm(p, scenario.input.start) <= opts.offingExemptNearEndsNm ||
        haversineNm(p, scenario.input.dest) <= opts.offingExemptNearEndsNm;

      for (let i = 1; i < result.steps.length; i++) {
        const a = result.steps[i - 1]!;
        const b = result.steps[i]!;
        const requiredNm =
          opts.minOffingNm + Math.max(a.hsM, b.hsM) * opts.seaStateOffingNmPerM;
        for (let k = 0; k <= SAMPLES_PER_LEG; k++) {
          const t = k / SAMPLES_PER_LEG;
          const p = {
            lat: a.lat + (b.lat - a.lat) * t,
            lon: a.lon + (b.lon - a.lon) * t,
          };
          if (exempt(p)) continue;
          const d = mask.clearanceNm(p.lat, p.lon, requiredNm + 1);
          expect(
            d,
            `${scenario.name} steg ${i} (t=${t.toFixed(2)}, ${p.lat.toFixed(4)},${p.lon.toFixed(4)}): ` +
              `klaring ${d.toFixed(3)} nm under kravet ${requiredNm.toFixed(3)} nm`,
          ).toBeGreaterThanOrEqual(requiredNm - CLEARANCE_SAMPLING_SLACK_NM);
        }
      }
    }
  }, 180_000);

  /**
   * Samme invariant for **alternativrutene**. Undersøkelsen av alternatives
   * 2→1 i bohuslan-trange-sund (docs/research/bohuslan-alternativ-bortfall-
   * 2026-08-31.md) viste at begge pre-R3-alternativene passerte samme skjær
   * som primærruten med 0,088 nm klaring mot kravet 0,15 — de var aldri
   * lovlige ruter. R3-invarianten over sjekker bare `result.steps`; uten
   * denne testen kunne en fremtidig regresjon la et ulovlig alternativ stå
   * i UI-et selv om primærruten var ren.
   *
   * `RouteLeg` bærer ikke bølgehøyde, så kravet her er den statiske
   * `minOffingNm` — en gyldig nedre skranke for det fulle kravet. Lekkasjer
   * av den typen som felte de gamle alternativene ligger langt under den.
   */
  it("kystbufferen holder også langs alle alternativruter", () => {
    for (const scenario of goldenScenarios()) {
      const result = planRoute(scenario.input);
      const mask = scenario.input.mask;
      if (mask === undefined) continue;
      const opts = withDefaults(scenario.input.options ?? {});
      if (opts.minOffingNm <= 0) continue;

      const exempt = (p: { lat: number; lon: number }): boolean =>
        haversineNm(p, scenario.input.start) <= opts.offingExemptNearEndsNm ||
        haversineNm(p, scenario.input.dest) <= opts.offingExemptNearEndsNm;

      for (const [ai, alternative] of result.alternatives.entries()) {
        for (const [li, leg] of alternative.legs.entries()) {
          for (let k = 0; k <= SAMPLES_PER_LEG; k++) {
            const t = k / SAMPLES_PER_LEG;
            const p = {
              lat: leg.fromLat + (leg.toLat - leg.fromLat) * t,
              lon: leg.fromLon + (leg.toLon - leg.fromLon) * t,
            };
            if (exempt(p)) continue;
            const d = mask.clearanceNm(p.lat, p.lon, opts.minOffingNm + 1);
            expect(
              d,
              `${scenario.name} alternativ ${ai} etappe ${li} ` +
                `(t=${t.toFixed(2)}, ${p.lat.toFixed(4)},${p.lon.toFixed(4)}): ` +
                `klaring ${d.toFixed(3)} nm under kravet ${opts.minOffingNm.toFixed(3)} nm`,
            ).toBeGreaterThanOrEqual(
              opts.minOffingNm - CLEARANCE_SAMPLING_SLACK_NM,
            );
          }
        }
      }
    }
  }, 180_000);

  /**
   * Instrumenteringen henger sammen (§7 måling 3b). Selve *tallene* — hvor
   * ofte gaten holder, hvor dypt bisectionen går, hvor mange
   * `clearanceNm`-kall det koster — leses ut av `diagnostics.clearance` på et
   * hvilket som helst resultat, og er gjengitt per fikstur i spec-ens
   * endringslogg (§10, oppføring «2026-08-31 (4)»). De er bevisst **ikke**
   * frosne i golden-filene: de skal endre seg når vi optimerer, uten at det
   * ser ut som en adferdsendring.
   *
   * Det testen derimot pinner, er de to tingene som *er* adferd:
   *  - ettersjekken avviser aldri (feiler den, er det en bug i søket, §5.10);
   *  - bisectionen holder seg innenfor dybdetaket.
   */
  it("R3-instrumenteringen er konsistent og ettersjekken avviser aldri", () => {
    for (const scenario of goldenScenarios()) {
      const { clearance, clearanceRecheck } = planRoute(
        scenario.input,
      ).diagnostics;
      const opts = withDefaults(scenario.input.options ?? {});
      expect(clearanceRecheck.rejections, scenario.name).toBe(0);
      expect(clearance.maxDepth, scenario.name).toBeLessThanOrEqual(
        opts.clearanceCorridorMaxDepth,
      );
      // Hver bisection starter i en gate-miss, og hvert midtpunkt hører til en.
      expect(clearance.midpointChecks).toBeLessThanOrEqual(clearance.gateMiss);
      if (scenario.input.mask !== undefined && opts.minOffingNm > 0) {
        expect(
          clearance.gatePass + clearance.gateMiss,
          `${scenario.name}: korridorsjekken kjørte ikke i det hele tatt`,
        ).toBeGreaterThan(0);
      }
    }
  }, 180_000);
});

describe("sikkerhetsinvariant på golden-rutene", () => {
  it("hvert segment i en rute som ikke er «usikker-rute» består en uavhengig sjekk", () => {
    for (const scenario of goldenScenarios()) {
      const result = planRoute(scenario.input);
      if (result.safety.verdict === "usikker-rute") continue;
      const mask = scenario.input.mask;
      expect(mask).toBeDefined();
      if (mask === undefined) continue;
      for (const leg of result.legs) {
        const verdict = mask.segmentVerdict(
          leg.fromLat,
          leg.fromLon,
          leg.toLat,
          leg.toLon,
        );
        expect(
          verdict.passable,
          `${scenario.name}: segment ${leg.fromLat},${leg.fromLon} → ${leg.toLat},${leg.toLon} er ikke farbart`,
        ).toBe(true);
      }
    }
  }, 120_000);
});
