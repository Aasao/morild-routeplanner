/**
 * tools/chart-pack — turf-vs-geos-wasm-spike (docs/specs/farbarhetsmaske.md
 * §4 verktøytabell, §8 punkt 8).
 *
 * Kjører de samme boolske operasjonene pipelinen trenger (union per
 * dybdekurve-verdi, differanse mellom bånd, buffer av skjær/grunne-punkter)
 * mot ETTE ekte Kartverket/Kystverket-uttrekk for testområdet (§ README),
 * og måler tid + korrekthet. Konklusjon skrives til README.md, ikke her.
 *
 * Kjøres med: `pnpm --filter @morild/chart-pack build` bygger tsc og kjører
 * denne via `dist/spike/turf-vs-geos.js` — se package.json "spike"-scriptet.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import {
  parseDybdekurver,
  parsePointFeatures,
  parsePolygonFeatures,
} from "../gml.js";
import { buildBufferedHazards, buildDepthBands, buildDryFallZones, subtractHazardsFromBands } from "../pipeline.js";

const TESTDATA = join(import.meta.dirname, "..", "..", "testdata", "raw");

function load(file: string): string {
  return gunzipSync(readFileSync(join(TESTDATA, file))).toString("utf8");
}

function time<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  // eslint-disable-next-line no-console -- spike-rapport, ment for terminalen
  console.log(`${label}: ${ms.toFixed(1)} ms`);
  return result;
}

function main(): void {
  const curves = parseDybdekurver(load("Dybdekurve.gml.gz"));
  const skjaer = parsePointFeatures(load("Skjær.gml.gz"), "app:Skjær");
  const grunne = parsePointFeatures(load("Grunne.gml.gz"), "app:Grunne");
  const torrfall = parsePolygonFeatures(load("Tørrfall.gml.gz"), "app:Tørrfall");

  console.log(`Rådata: ${curves.length} dybdekurver, ${skjaer.length} skjær, ${grunne.length} grunne, ${torrfall.length} tørrfall-polygoner`);
  console.log(`Lukkede dybdekurve-ringer: ${curves.filter((c) => c.ring.closed).length} av ${curves.length}`);

  const bandResult = time("buildDepthBands (union pr. dybdeverdi + differanse mellom nabobånd)", () =>
    buildDepthBands(curves),
  );
  console.log(`  -> ${bandResult.bands.length} bånd, ${bandResult.issues.length} avvik, ${bandResult.skippedInvalidRings} ugyldige ringer (turf.kinks)`);

  const dryFallResult = time("buildDryFallZones (union av alle tørrfallspolygoner)", () => buildDryFallZones(torrfall));
  console.log(`  -> ${dryFallResult.zones.length} tørrfallssoner, ${dryFallResult.issues.length} avvik`);

  const hazardResult = time(`buildBufferedHazards (buffer 20 m x ${skjaer.length + grunne.length} punkter)`, () =>
    buildBufferedHazards(skjaer, grunne, 20),
  );
  console.log(`  -> ${hazardResult.points.length} buffrede farepunkter`);

  time("subtractHazardsFromBands (differanse: bånd ∖ tørrfall, bbox-filtrert)", () =>
    subtractHazardsFromBands(bandResult.bands, dryFallResult.features),
  );

  time("subtractHazardsFromBands (differanse: bånd ∖ skjær/grunne, bbox-filtrert)", () =>
    subtractHazardsFromBands(bandResult.bands, hazardResult.features),
  );

  console.log("\nKorrekthet: se pipeline.test.ts for eksplisitte fasit-sjekker (§6.1) — denne spiken");
  console.log("måler kun ytelse/robusthet mot EKTE geometri, ikke isolert korrekthet.");
}

main();
