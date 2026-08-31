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
  buildSoundingGuardrails,
  buildTilePayloads,
  subtractHazardsFromBands,
  validateSoundingsAgainstBands,
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

/**
 * Guardrail-punktfarens bufferradius (m) — bevisst FORSKJELLIG fra
 * `DEFAULT_HAZARD_BUFFER_M` (§3.4 «Guardrail for feilklassifiserte bånd»,
 * beslutning 2026-08-31). `DEFAULT_HAZARD_BUFFER_M` (20 m) begrunnes med
 * posisjonsusikkerhet for ETT punkt (§8 pkt. 3). Guardrail-radiusen
 * begrunnes annerledes: sonderingsnettet i denne fixturen er gradert til
 * 50 m (README "QA-validator") — en flagget sondering representerer derfor
 * ikke bare sitt eget punkt, men et areal på omtrent den skalaen der
 * bånd-inndelingen er bevist upålitelig. 25 m (halve sonderingsnettets
 * gradering) er valgt som et forsiktig, dokumentert anslag — ikke en målt
 * verdi — for hvor langt fra selve sonderingspunktet den samme
 * usikkerheten trolig strekker seg før bånd-delpolygon-flagget (som dekker
 * hele det upålitelige delpolygonet, uavhengig av avstand) uansett tar over.
 */
const SOUNDING_GUARDRAIL_BUFFER_M = 25;

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

  // QA-validator (beslutning 2026-08-31, felle 2): sjekk Grunne-punktene
  // (ground-truth-proxy for ekte dybdepunkt-soundinger, se pipeline.ts-
  // kommentaren) mot de RÅ dybdebåndene FØR skjær/grunne trekkes fra dem —
  // poenget er å avsløre kurve-/bånd-konstruksjonsfeil, ikke å teste
  // sluttresultatet etter at hazard-geometrien allerede har skåret hull i
  // bandet rundt akkurat disse punktene.
  const soundingQa = validateSoundingsAgainstBands(bandResult.bands, grunne);
  console.log(
    `QA dybdepunkt-vs-bånd: ${soundingQa.violations.length} brudd av ${soundingQa.checkedCount} sjekkede Grunne-soundinger` +
      (soundingQa.violations.length > 0
        ? ` (se header.sourceStatus/layers[dybdebaand].sourceStatus for detaljer)`
        : ""),
  );
  if (soundingQa.violations.length > 0) {
    for (const v of soundingQa.violations.slice(0, 10)) {
      console.warn(
        `  BRUDD: ${v.featureId} sondert til ${v.soundedDepthM} m, men ligger i bånd ${v.bandLowerBoundM}-${v.bandUpperBoundM} m ` +
          `ved (${v.point[1]}, ${v.point[0]})`,
      );
    }
  }

  // Guardrail (§3.4, beslutning 2026-08-31): promoter QA-bruddene til (a)
  // VALSOU-punktfarer og (b) bånd-delpolygon-flagg som aldri kan gi `trygt`.
  // Kjørt mot de RÅ bandene (samme som validatoren selv brukte) — se
  // `buildSoundingGuardrails`-kommentaren for hvorfor.
  const guardrail = buildSoundingGuardrails(
    bandResult.bands,
    soundingQa.violations,
    SOUNDING_GUARDRAIL_BUFFER_M,
  );
  console.log(
    `Guardrail: ${guardrail.hazards.length} VALSOU-punktfarer + ${guardrail.zones.length} ` +
      `unike bånd-delpolygoner flagget («aldri trygt») fra ${soundingQa.violations.length} QA-brudd`,
  );

  const allHazardPoints = [...hazardResult.points, ...guardrail.hazards];

  const allTiles = buildTilePayloads(
    bandsFinal,
    dryFallResult.zones,
    allHazardPoints,
    farledZones,
    dataQualityZones,
    guardrail.zones,
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
    soundingGuardrail: t.soundingGuardrail,
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
        "Luftspenn/TSS/vernesone er ikke ingestert i denne bølgen. " +
        `QA-guardrail (beslutning 2026-08-31, promotert fra QA-varsling): ${soundingQa.violations.length} av ` +
        `${soundingQa.checkedCount} sjekkede dybdepunkt-soundinger er grunnere enn båndet de ` +
        `geometrisk havner i — ${guardrail.hazards.length} VALSOU-punktfarer og ${guardrail.zones.length} ` +
        "bånd-delpolygoner («aldri trygt») lagt til som følge (se README 'QA-validator').",
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
        sourceStatus:
          soundingQa.violations.length > 0
            ? {
                status: "degraded",
                reason:
                  `${bandResult.skippedOpenRings} åpne konturlinjer utelatt (se README). ` +
                  `QA-guardrail (beslutning 2026-08-31): ${soundingQa.violations.length} av ` +
                  `${soundingQa.checkedCount} sjekkede dybdepunkt-soundinger er grunnere enn båndet ` +
                  "de geometrisk havner i — mulig kurve-/topologifeil. Promotert til byggetids-guardrail: " +
                  `${guardrail.zones.length} bånd-delpolygoner kan aldri gi 'trygt' ved oppslag (se ` +
                  "'sonderingsguardrail'-laget og konsollogg for detaljer).",
              }
            : {
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
        // VALSOU-modellen (E4, beslutning 2026-08-31): Grunne setter ikke
        // lenger en blank no-go-baseline — no-go avgjøres per punkt ved
        // oppslag ut fra dybdeattributt (§3.4). "n/a" her er korrekt av
        // samme grunn som TSS/luftspenn: laget bidrar ikke et fast
        // tillitsnivå i seg selv.
        baselineTillit: "n/a",
        vintage: "2026-08-24",
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
      {
        // Byggetids-guardrail (§3.4, beslutning 2026-08-31) — avledet fra
        // dybdebåndene (samme kilde/datum), ikke en egen kilde. Se
        // `buildSoundingGuardrails` og README "QA-validator".
        id: "sonderingsguardrail",
        kilde: "Avledet fra Kartverket Sjøkart – Dybdedata (QA-validator vs. Grunne-proxy)",
        datum: "K0",
        vintage: "2026-08-24",
        baselineTillit: "n/a",
        sourceStatus:
          guardrail.zones.length > 0
            ? {
                status: "degraded",
                reason:
                  `${guardrail.zones.length} bånd-delpolygoner flagget fra ${soundingQa.violations.length} ` +
                  `QA-brudd — disse kan aldri gi 'trygt' ved oppslag. ${guardrail.hazards.length} ` +
                  `tilhørende VALSOU-punktfarer (${SOUNDING_GUARDRAIL_BUFFER_M} m buffer) lagt til i 'grunne'-laget.`,
              }
            : { status: "ok" },
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
