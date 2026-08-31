/**
 * tools/chart-pack — bygg-orkestrator (spec §4 steg 4-9, avgrenset omfang).
 *
 * Leser rå-uttrekk fra `testdata/raw/*.gml.gz` (§ README "Rå-data"),
 * kjører polygonalgebra-pipelinen (`pipeline.ts`), fliser resultatet og
 * skriver en komplett `ChartPackage` (pakkeformat fra `@morild/charts`) til
 * `testdata/pack/oslofjord-hvaler.json.gz` — som deretter kopieres inn i
 * `packages/charts/src/fixtures/` som frossen testfixture (§6.2).
 *
 * IKKE produksjonspipelinen for hele Skandinavia (§4 steg 1 henting/steg 2
 * reprojeksjon/steg 9-11 R2-publisering/healthcheck er ikke bygget i denne
 * bølgen) — se README.md "Avvik fra spec" for full liste og begrunnelse.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join } from "node:path";
import { tileBounds } from "@morild/charts";
import type {
  ChartPackage,
  ChartPackageHeader,
  ChartTilePayload,
} from "@morild/charts";
import {
  parseDybdekurver,
  parseKystverketLines,
  parseKystverketMultiSurface,
  parsePointFeatures,
  parsePolygonFeatures,
} from "./gml.js";
import {
  buildBufferedHazards,
  buildDataQualityZones,
  buildDepthBands,
  buildDryFallZones,
  buildFarledZones,
  buildTilePayloads,
  subtractHazardsFromBands,
} from "./pipeline.js";

const TESTDATA_RAW = join(import.meta.dirname, "..", "testdata", "raw");
const OUT_DIR = join(import.meta.dirname, "..", "testdata", "pack");
const GRID = { lonStepDeg: 0.5, latStepDeg: 0.25 } as const;

/**
 * Test-bboksen oppgitt i oppdraget (Skjæløy/Hvaler-området). Brukes til å
 * luke ut fliser som kun er "berørt" av Kystverkets farledsareal-lag — det
 * laget er hentet UKLIPPET (WFS-en returnerer hele featuren så snart NOEN
 * del av den overlapper spørrings-bboksen, se README "Rå-data") og strekker
 * seg langt utenfor testområdet (én polygon dekker store deler av hele
 * Oslofjorden). Uten dette filteret ville pakken fått et dusin nesten tomme
 * fliser hvis eneste innhold er en tynn flik av den store farled-polygonen
 * — riktig oppførsel for en nasjonal pakke, men støy i en «lite område»-
 * testfixture. Selve klippingen til flisgrensen (§4 steg 6) skjer uansett
 * korrekt i `buildTilePayloads` — dette er kun et etterfølgende utvalg av
 * HVILKE fliser som tas med i denne bølgens fixture.
 */
const TARGET_BBOX = {
  west: 10.6,
  south: 59.05,
  east: 11.0,
  north: 59.3,
} as const;

function tileOverlapsTarget(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}): boolean {
  return (
    bounds.west < TARGET_BBOX.east &&
    TARGET_BBOX.west < bounds.east &&
    bounds.south < TARGET_BBOX.north &&
    TARGET_BBOX.south < bounds.north
  );
}

/** Standard skjær-/grunnebuffer (m) — konfigurerbar, se docs/specs §4 steg 4 og §8 pkt. 3. */
const DEFAULT_HAZARD_BUFFER_M = 20;

function load(file: string): string {
  return gunzipSync(readFileSync(join(TESTDATA_RAW, file))).toString("utf8");
}

function main(): void {
  console.log("=== chart-pack build: Oslofjorden/Hvaler-testområde ===");

  const dybdekurver = parseDybdekurver(load("Dybdekurve.gml.gz"));
  const skjaer = parsePointFeatures(load("Skjær.gml.gz"), "app:Skjær");
  const grunne = parsePointFeatures(load("Grunne.gml.gz"), "app:Grunne");
  const torrfall = parsePolygonFeatures(
    load("Tørrfall.gml.gz"),
    "app:Tørrfall",
  );
  const datakvalitet = parsePolygonFeatures(
    load("Datakvalitet.gml.gz"),
    "app:Datakvalitet",
  );
  const hovedledLinjer = parseKystverketLines(
    load("kystverket-hovedled.gml.gz"),
    "ms:layer_552",
  );
  const farledsareal = parseKystverketMultiSurface(
    load("kystverket-farledsareal.gml.gz"),
    "ms:layer_554",
  );

  const bandResult = buildDepthBands(dybdekurver);
  console.log(
    `Dybdebånd: ${bandResult.bands.length} bånd fra ${dybdekurver.length} kurver ` +
      `(${bandResult.skippedOpenRings} åpne ringer hoppet over, ${bandResult.skippedInvalidRings} ugyldige)`,
  );

  const dryFallResult = buildDryFallZones(torrfall);
  const hazardResult = buildBufferedHazards(
    skjaer,
    grunne,
    DEFAULT_HAZARD_BUFFER_M,
  );

  const bandsAfterDryFall = subtractHazardsFromBands(
    bandResult.bands,
    dryFallResult.features,
  );
  const bandsFinal = subtractHazardsFromBands(
    bandsAfterDryFall,
    hazardResult.features,
  );

  const farledZones = buildFarledZones(hovedledLinjer, farledsareal);
  const dataQualityZones = buildDataQualityZones(datakvalitet);

  console.log(
    `Tørrfall: ${dryFallResult.zones.length} soner | Skjær+grunne-buffer: ${hazardResult.points.length} ` +
      `| Farled: ${farledZones.length} soner | Datakvalitet: ${dataQualityZones.length} soner`,
  );

  const allTiles = buildTilePayloads(
    bandsFinal,
    dryFallResult.zones,
    hazardResult.points,
    farledZones,
    dataQualityZones,
    GRID,
  );
  const rawTiles = allTiles.filter((t) =>
    tileOverlapsTarget(tileBounds(t.id, GRID)),
  );
  console.log(
    `Fliser: ${rawTiles.length} innenfor testbboksen (${allTiles.length} totalt berørt av lagene, ` +
      `${allTiles.length - rawTiles.length} luket ut — se TARGET_BBOX-kommentaren)`,
  );

  const tiles: ChartTilePayload[] = rawTiles.map((t) => ({
    id: t.id,
    bands: t.bands,
    dryFall: t.dryFall,
    bufferedHazards: t.bufferedHazards,
    farled: t.farled,
    dataQuality: t.dataQuality,
    // Luftspenn/TSS/vernesone: ingen ekte kilde ingestert i denne bølgen
    // (spec §8 pkt. 1 uverifisert URL / ikke i oppgavens omfang) — tom
    // liste er ærlig degradering, ikke en skjult mangel (se README).
    airDraft: [],
    tss: [],
    protectedZones: [],
  }));

  const now = new Date().toISOString();
  const header: ChartPackageHeader = {
    formatVersion: "1.0.0",
    producedAt: now,
    model: "Kartverket-Dybdedata+Kystverket-Farled",
    // Mest konservative datering = eldste lag-vintage (§3.1). Vi har kun
    // datauttaksdato tilgjengelig fra denne bølgens rå-uttrekk (se README),
    // ikke hvert enkelt objekts førsteDatafangstdato/oppdateringsdato slått
    // sammen — satt til uttrekksdatoen som en konservativ, dokumentert
    // forenkling.
    init: "2026-08-30T00:00:00Z",
    resolution: `${GRID.lonStepDeg}x${GRID.latStepDeg}deg`,
    sourceStatus: {
      status: "degraded",
      reason:
        `${bandResult.skippedOpenRings} av ${dybdekurver.length} dybdekurver i testområdet er åpne ` +
        "(krysser kartbladgrense) og er utelatt fra dybdebåndene — se README 'Avvik fra spec'. " +
        "Luftspenn/TSS/vernesone er ikke ingestert i denne bølgen.",
    },
    boundingBox: [10.6, 59.05, 11.0, 59.3],
    tileGrid: GRID,
    tiles: tiles.map((t) => t.id),
    layers: [
      {
        id: "dybdebaand",
        kilde: "Kartverket Sjøkart – Dybdedata (Dybdekurve)",
        datum: "K0",
        vintage: "2026-08-24",
        baselineTillit: "n/a",
        sourceStatus: {
          status: "degraded",
          reason: `${bandResult.skippedOpenRings} åpne konturlinjer utelatt (se README)`,
        },
      },
      {
        id: "torrfall",
        kilde: "Kartverket Sjøkart – Dybdedata (Tørrfall)",
        datum: "MHW",
        vintage: "2026-08-24",
        baselineTillit: "no-go",
        sourceStatus: { status: "ok" },
      },
      {
        id: "skjaer",
        kilde: "Kartverket Sjøkart – Dybdedata (Skjær)",
        datum: "MHW",
        vintage: "2026-08-24",
        baselineTillit: "no-go",
        sourceStatus: { status: "ok" },
      },
      {
        id: "grunne",
        kilde: "Kartverket Sjøkart – Dybdedata (Grunne)",
        datum: "MHW",
        vintage: "2026-08-24",
        baselineTillit: "no-go",
        sourceStatus: { status: "ok" },
      },
      {
        id: "farled",
        kilde: "Kystverket WFS (Farledsareal, layer_554)",
        datum: "ukjent",
        vintage: "2026-08-24",
        baselineTillit: "n/a",
        sourceStatus: { status: "ok" },
      },
      {
        id: "datakvalitet",
        kilde: "Kartverket Sjøkart – Dybdedata (Datakvalitet/CATZOC)",
        datum: "ukjent",
        vintage: "2026-08-24",
        baselineTillit: "n/a",
        sourceStatus: { status: "ok" },
      },
      {
        id: "luftspenn",
        kilde: "IKKE INGESTERT (spec §8 pkt. 1, URL uverifisert)",
        datum: "ukjent",
        vintage: "n/a",
        baselineTillit: "n/a",
        sourceStatus: {
          status: "degraded",
          reason: "Ingen kilde koblet til i denne bølgen",
        },
      },
      {
        id: "tss",
        kilde: "IKKE INGESTERT (utenfor denne bølgens omfang)",
        datum: "ukjent",
        vintage: "n/a",
        baselineTillit: "n/a",
        sourceStatus: {
          status: "degraded",
          reason: "Ingen kilde koblet til i denne bølgen",
        },
      },
      {
        id: "vernesone",
        kilde: "IKKE INGESTERT (utenfor denne bølgens omfang)",
        datum: "ukjent",
        vintage: "n/a",
        baselineTillit: "n/a",
        sourceStatus: {
          status: "degraded",
          reason: "Ingen kilde koblet til i denne bølgen",
        },
      },
    ],
  };

  const pkg: ChartPackage = { header, tiles };

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = join(OUT_DIR, "oslofjord-hvaler.json.gz");
  writeFileSync(outFile, gzipSync(Buffer.from(JSON.stringify(pkg))));
  const uncompressedBytes = Buffer.byteLength(JSON.stringify(pkg));
  console.log(
    `Skrev ${outFile} (${(uncompressedBytes / 1024).toFixed(0)} KB ukomprimert)`,
  );
}

main();
