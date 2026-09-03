import { describe, expect, it } from "vitest";
import {
  BUDGET_LIMIT_BYTES,
  currentBytes,
  estimatePackageBudget,
  metadataBytes,
  waveBytes,
  windControlBytes,
  windMembersBytes,
  type BudgetBbox,
} from "./budget.js";
import { buildLayer, computeSubtileLayout } from "./package-format.js";

/** Skjæløy–Skagen-bboxen, §7/§8s eget referansepunkt (2,3°×2,5°, med margin). */
const SKJAELOY_SKAGEN_BBOX: BudgetBbox = {
  latMin: 57.4,
  latMax: 59.7,
  lonMin: 8.0,
  lonMax: 12.6,
};

describe("budsjett-formler — kryssjekk mot en ekte bygget flis", () => {
  it("windControlBytes' per-byte-antakelse (1 byte/prøve, 8-bit) stemmer med package-format.ts", () => {
    const g = {
      latMin: 58,
      lonMin: 10,
      latStepDeg: 0.02,
      lonStepDeg: 0.02,
      nodesLat: 40,
      nodesLon: 40,
      tileNodes: 32,
      t0S: 0,
      dtS: 3600,
      timeSteps: 3,
    };
    const layer = buildLayer({
      sample: (lat) => lat,
      geometryBase: g,
      bitsPerSample: 8,
      roundingMode: "nearest",
      channelKind: "linear",
    });
    // Payload er nettopp nodesLat×nodesLon×timeSteps ETT byte per prøve —
    // den konstanten `windControlBytes`/`windMembersBytes` bygger på.
    expect(layer.payload.byteLength).toBe(g.nodesLat * g.nodesLon * g.timeSteps);
    void computeSubtileLayout(g);
  });
});

describe("estimatePackageBudget — Skjæløy→Skagen, 2,5 km, 48 t, 30 medlemmer (§8)", () => {
  it("gir en overslagsstørrelse i samme størrelsesorden som §8s oppdaterte regnskap (~25–37 MB rått→estimert)", () => {
    const wind = {
      bbox: SKJAELOY_SKAGEN_BBOX,
      resolutionKm: 2.5,
      memberCount: 30,
      memberHorizonH: 48,
      controlHorizonH: 66,
      timeStepH: 1,
      bitsPerSample: 8 as const,
    };
    const current = {
      bbox: SKJAELOY_SKAGEN_BBOX,
      coastalFraction: 0.35,
      coastalResolutionKm: 0.8,
      offshoreResolutionKm: 1.6,
      horizonH: 48,
      timeStepH: 1,
      bitsPerSample: 8 as const,
    };
    const wave = {
      bbox: SKJAELOY_SKAGEN_BBOX,
      resolutionKm: 2.5,
      horizonH: 48,
      timeStepH: 1,
      bitsPerSample: 8 as const,
      channels: 3 as const,
    };
    const wc = windControlBytes(wind);
    const wm = windMembersBytes(wind);
    const cu = currentBytes(current);
    const wa = waveBytes(wave);

    // §8: vind-medlemmer alene skal være ~32 MB RÅTT (før delta+gzip).
    // Golden-verdi (review-funn 4, stramming 2026-09-03): denne formelen
    // (`windMembersBytes`, samme fixture som her) gir 31,49 MB, som
    // stemmer med den FAKTISK bygde/målte pakken i
    // `tools/weather-pack/src/measure-full-size.ts` (kjørt 2026-09-01,
    // se `docs/specs/vaerpakker.md` §8/§17 pkt. 7: "31,49 MB rått"). ±2 %
    // rundt 31,5 MB gir et vindu på ca. [30,87, 32,13] MB.
    const windMembersMB = wm / (1024 * 1024);
    expect(windMembersMB).toBeGreaterThan(31.5 * 0.98);
    expect(windMembersMB).toBeLessThan(31.5 * 1.02);

    const budget = estimatePackageBudget({
      wind,
      current,
      wave,
      metadata: { subtileCount: 12, fieldCount: 7, timeSteps: 49 },
    });

    const totalMB = budget.rawTotalBytes / (1024 * 1024);
    const estimatedMB = budget.estimatedTotalBytes / (1024 * 1024);
    // eslint-disable-next-line no-console
    console.log(
      "[budsjett-indikasjon, Skjæløy→Skagen, 2,5 km/48 t/30 medlemmer]",
      JSON.stringify(
        {
          windControlMB: round(wc / (1024 * 1024)),
          windMembersMB: round(wm / (1024 * 1024)),
          currentMB: round(cu / (1024 * 1024)),
          waveMB: round(wa / (1024 * 1024)),
          metadataMB: round(budget.metadataBytes / (1024 * 1024)),
          raattTotalMB: round(totalMB),
          estimertEtterDeltaGzipMB: round(estimatedMB),
        },
        null,
        2,
      ),
    );

    // Golden-verdi (review-funn 4, stramming 2026-09-03): rå totalsum for
    // denne fixturen er 39,8 MB, allerede over den opprinnelige 30 MB-
    // grensen FØR delta+gzip — se `docs/specs/vaerpakker.md` §8/§17 pkt. 7
    // ("rå totalsum ≈ 39,8 MB", 2026-09-01-regnskapet). ±3 % rundt 39,8 MB
    // gir et vindu på ca. [38,61, 40,99] MB. (`estimatedMB` — etter et
    // 2×-delta/gzip-anslag — beholder sin videre, ikke-stramme grense: den
    // avhenger av `estimatePackageBudget`s antatte kompresjonsfaktor, ikke
    // av en egen målt golden-verdi.)
    expect(totalMB).toBeGreaterThan(39.8 * 0.97);
    expect(totalMB).toBeLessThan(39.8 * 1.03);
    // Regnskapet er "ikke lenger klart under budsjettet" (§8) — vi
    // forventer det RÅ tallet til å ligge i nærheten av eller over
    // 30 MB-grensen, ikke komfortabelt under.
    expect(estimatedMB).toBeGreaterThan(5);
    void metadataBytes;
    void BUDGET_LIMIT_BYTES;
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
