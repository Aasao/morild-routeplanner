/**
 * Entrypunkt for `tools/weather-pack` (README.md har full kjøreinstruks).
 *
 * Standard: DRY-RUN. Bygger en liten demonstrasjonspakke (noen fliser,
 * redusert medlemsantall) fra syntetiske data (`dry-run-fixtures.ts`) og
 * skriver resultatet lokalt til `.dry-run-output/` — INGEN nettverkskall.
 *
 * `--live`: krever at `docs/legal/met-norway-*.md` finnes og er markert
 * "Status: verifisert" (§16, `legal-gate.ts`). Nekter og avslutter med
 * kode 1 hvis ikke. (Selve den ekte HTTP-hentingen mot THREDDS er ikke
 * koblet inn i CLI-en ennå i denne bølgen — se README "Hva venter". Målet
 * med `--live`-bryteren nå er porten, ikke den fulle produksjonskjøringen.)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createDryRunFetch } from "./dry-run-fixtures.js";
import type { IndexWindow } from "./grid.js";
import { buildWindMemberPackage, fetchWindComponents } from "./pipeline.js";
import { buildPointer, type PointerFieldEntry } from "./package-writer.js";
import { buildUserAgent } from "./opendap-client.js";
import { checkLegalGate } from "./legal-gate.js";
import { buildHealthcheckPayload, runWithHealthcheck, type HealthcheckPingFn } from "./healthcheck.js";

// tools/weather-pack/dist/cli.js -> tools/weather-pack -> tools -> repo-rot
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_DIR = join(import.meta.dirname, "..", ".dry-run-output");

function loadDevVars(): Record<string, string> {
  const path = join(REPO_ROOT, ".dev.vars");
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

async function runDryRun(): Promise<void> {
  console.log("=== weather-pack dry-run (syntetisk felt, ingen nettverkskall) ===");
  const window: IndexWindow = { yStart: 0, yEnd: 31, xStart: 0, xEnd: 31 };
  const DEMO_MEMBER_COUNT = 3; // redusert fra 30 kun for demoens kjøretid, ikke en produksjonsverdi.
  const fetchImpl = createDryRunFetch();
  const userAgent = buildUserAgent("0.0.0-dryrun", "maasao@gmail.com");

  const components = await fetchWindComponents({
    datasetUrl: "https://thredds.met.no/thredds/dodsC/mepslatest/meps-dryrun",
    window,
    timeCount: 3,
    memberCount: DEMO_MEMBER_COUNT,
    userAgent,
    fetchImpl,
  });

  const fields: PointerFieldEntry[] = [];
  for (let member = 0; member < DEMO_MEMBER_COUNT; member++) {
    const result = buildWindMemberPackage({
      formatVersion: "1.0.0",
      producedAt: new Date().toISOString(),
      init: "2026-09-03T00:00:00Z",
      resolution: "2.5km",
      components,
      memberIndex: member,
      tileId: "5_29",
      bbox: [10, 58, 12, 60],
      dtS: 3600,
    });
    fields.push(result.pointerEntry);
    console.log(
      `  medlem ${member}: ${result.payload.length} byte, maxDecodeErrorKn=${result.maxDecodeErrorKn.toFixed(3)}, nøkkel=${result.key}`,
    );
  }

  const pointer = buildPointer("1.0.0", [{ tileId: "5_29", bbox: [10, 58, 12, 60], fields }]);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "pointer-vaer-skandinavia.json"), JSON.stringify(pointer, null, 2));
  console.log(`Skrev peker til ${join(OUT_DIR, "pointer-vaer-skandinavia.json")}`);
}

const noopPing: HealthcheckPingFn = async (url, payload) => {
  console.log(`[healthcheck] (dry-run, ingen ekte ping) ${url}: ${payload.error ? "FEILET" : "OK"}`);
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes("--live");

  if (live) {
    const gate = checkLegalGate(join(REPO_ROOT, "docs", "legal"));
    if (!gate.ok) {
      console.error(`--live nektet: ${gate.reason}`);
      process.exitCode = 1;
      return;
    }
    console.error(
      "--live: legal-gate åpen, men den ekte THREDDS-hentingen er ikke koblet inn i CLI-en ennå " +
        "(se tools/weather-pack/README.md 'Hva venter') — avbryter i stedet for å late som en full kjøring skjedde.",
    );
    process.exitCode = 1;
    return;
  }

  const vars = loadDevVars();
  const healthcheckUrl = process.env["HEALTHCHECK_URL"] ?? vars["HEALTHCHECK_URL"];
  const startedAt = new Date().toISOString();

  await runWithHealthcheck(
    runDryRun,
    healthcheckUrl ? noopPing : async () => {
      /* ingen HEALTHCHECK_URL konfigurert lokalt — hopp over pinging, ikke en feil i dry-run. */
    },
    healthcheckUrl ?? "",
    (outcome) =>
      buildHealthcheckPayload({
        runId: `dry-run-${startedAt}`,
        startedAt,
        finishedAt: new Date().toISOString(),
        fields: [],
        totalPackageBytes: 0,
        unexpectedDegradation: false,
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      }),
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
