/**
 * Fasit-test for guardrailen (§3.4 «Guardrail for feilklassifiserte bånd»,
 * beslutning 2026-08-31 — se
 * `docs/research/beslutningsgrunnlag-r3-e1-2026-08-31.md` og
 * `docs/specs/farbarhetsmaske.md`) mot et FAKTISK berørt punkt fra den ekte,
 * frosne fixturen (§6.2), ikke en syntetisk konstruksjon.
 *
 * Punktet er `grunne.7257` — en ekte Kartverket-Grunne-sondering på 39 m som
 * QA-validatoren (`validateSoundingsAgainstBands`) fant liggende geometrisk
 * i 40–50 m-bandet (bandet påstår «dypere enn 40 m», sonderingen sier 39 m —
 * et brudd, se `tools/chart-pack/README.md` "QA-validator: dybdepunkt-
 * sondering vs. bånd"). Dette er ETT av 503 slike brudd i denne fixturen;
 * 273 unike bånd-delpolygoner ble flagget som følge (se byggeloggen fra
 * `pnpm --filter @morild/chart-pack build`).
 *
 * FØR guardrailen (kun QA-varsling i byggerapporten, ingen kjøretids-
 * håndheving): et punkt her ville fått `trygt` eller `usikkert` UT FRA
 * BÅNDETS (feilaktige) grense alene — 39 m er godt dypere enn en normal
 * seilbåts klaringskrav, og bandet 40–50 m ga ingen `no-go` fra §3.4 steg 3,
 * så et tillitsløft fra farled/god datakvalitet kunne gitt `trygt` uten at
 * noen sjekket den faktiske sonderte dybden på nøyaktig dette punktet.
 *
 * NÅ (guardrail): (a) selve sonderingspunktet er en VALSOU-punktfare med
 * `dybdeM: 39` — `no-go` hvis kravet er strengere enn 39 m, harmløst ellers
 * (E4/VALSOU, samme regel som alle andre Grunne-punkter); (b) bånd-
 * delpolygonet punktet ligger i kan ALDRI gi `trygt`, uansett tillitsløft —
 * maks `usikkert`, med årsak `usikker-sondering-i-baand`.
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChartPackage } from "./pack-format.js";
import { createChartSource } from "./chart-source.js";

const FIXTURE_PATH = join(
  import.meta.dirname,
  "..",
  "testdata",
  "oslofjord-hvaler.json.gz",
);

function loadFixture(): ChartPackage {
  return JSON.parse(
    gunzipSync(readFileSync(FIXTURE_PATH)).toString("utf8"),
  ) as ChartPackage;
}

const pkg = loadFixture();
const source = createChartSource(pkg);
const DATO = "2026-08-30";

// grunne.7257 — se toppkommentaren. Sondert dybde: 39 m. Ligger geometrisk i
// 40-50 m-bandet (QA-brudd).
const GRUNNE_7257 = { lat: 59.106314, lon: 10.620125 };
const GRUNNE_7257_DYBDE_M = 39;

describe("guardrail: faktisk QA-brudd-punkt fra fixturen (grunne.7257, sondert 39 m i 40-50 m-bandet)", () => {
  it("standard dypgangskrav (2,6 m): ALDRI trygt, uansett tillitsløft fra farled/datakvalitet", () => {
    const result = source.farbar(GRUNNE_7257, 2.6, 0, DATO);
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    // 39 m >> 2,6 m krav, så VALSOU-punktfaren alene blokkerer ikke — men
    // bånd-delpolygonet er flagget, så resultatet kan ikke bli `trygt`.
    expect(result.nivaa).not.toBe("trygt");
    expect(result.aarsaker.some((a) => a.kind === "usikker-sondering-i-baand")).toBe(true);
  });

  it("segmentTest gjennom samme punkt er enig med farbar() (samme guardrail-sjekk)", () => {
    const result = source.segmentTest(GRUNNE_7257, GRUNNE_7257, 2.6, 0, DATO);
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).not.toBe("trygt");
    expect(result.aarsaker.some((a) => a.kind === "usikker-sondering-i-baand")).toBe(true);
  });

  it("VALSOU-punktfare: no-go når kravet er strengere enn den faktisk sonderte dybden (39 m)", () => {
    const result = source.farbar(GRUNNE_7257, GRUNNE_7257_DYBDE_M + 1, 0, DATO);
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).toBe("no-go");
    expect(result.aarsaker.some((a) => a.detail.includes("39 m"))).toBe(true);
  });

  it("VALSOU-punktfare: IKKE no-go alene når kravet er grunnere enn 39 m (E4 uendret av guardrailen)", () => {
    // Selve punktfaren følger fortsatt VALSOU-regelen upåvirket — guardrailen
    // legger til bånd-delpolygon-taket, den endrer ikke E4-punktregelen.
    const result = source.farbar(GRUNNE_7257, 2.6, 0, DATO);
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker.some((a) => a.kind === "skjaer-buffer" && a.detail.includes("39 m"))).toBe(false);
  });
});

describe("guardrail: omfang i denne fixturen (funn for Magnus)", () => {
  it("503 QA-brudd traff 273 unike bånd-delpolygoner og ga 503 nye VALSOU-punktfarer", () => {
    // Tallene er logget av `pnpm --filter @morild/chart-pack build` og
    // gjentas her som en eksplisitt regresjonsvakt: hvis dette tallet endrer
        // seg (kildedata oppdatert, stitching lukker hullet, e.l.) skal noen se
    // det, ikke bare konsollen.
    let zoneCount = 0;
    let hazardWithDepthCount = 0;
    for (const tile of pkg.tiles) {
      zoneCount += tile.soundingGuardrail.length;
      hazardWithDepthCount += tile.bufferedHazards.filter((h) => h.dybdeM !== undefined).length;
    }
    expect(zoneCount).toBe(273);
    // 4419, ikke 3913 (alle Grunne, E4) + 503 (guardrail-punktfarer, EKSTRA
    // innslag med 25 m buffer i stedet for standard 20 m — se
    // `SOUNDING_GUARDRAIL_BUFFER_M`-begrunnelsen i
    // `tools/chart-pack/src/build.ts`) = 4416: 3 punkter nær flisgrensen får
    // en klippet kopi i BEGGE fliser i denne 2-flis-fixturen (bekreftet ved
    // opptelling per flis: 287 + 4132 = 4419), ikke et telefeil.
    expect(hazardWithDepthCount).toBe(4419);
  });
});
