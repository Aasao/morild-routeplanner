/**
 * Fase 3 bølge 2A: FØRSTE EKTE værpakke — vind-only (kontroll + 30
 * medlemmer, 2,5 km, 48 t medlemshorisont, 1 t, 8-bit u/v, delta+gzip).
 * `docs/specs/vaerpakker.md`, `docs/legal/met-norway-thredds.md` (§16-gate).
 *
 * Kjøres KUN manuelt (`pnpm --filter @morild/weather-pack build-live`), ALDRI
 * fra `pnpm test`/CI i denne bølgen — gjør ekte, sekvensielle OPeNDAP-kall
 * mot thredds.met.no (§16: aldri parallelle sesjoner). Skriver til
 * `tools/weather-pack/out/` (git-ignorert, se `.gitignore` og README).
 *
 * Steg:
 * 1. Legal-gate (`legal-gate.ts`, §16) — nekter uten verifisert
 *    `docs/legal/met-norway-*.md`.
 * 2. Løser siste KOMPLETTE MEPS-ensemble-kjøring fra den ekte
 *    `mepslatest`-katalogen via §11s `selectEnsembleRun` (IKKE en antatt
 *    kjøring — DDS-en for hver kandidat sjekkes faktisk).
 * 3. Verifiserer den valgte kjøringens FAKTISKE LCC-projeksjonsparametre
 *    mot `lambert-rotation.ts::MEPS_LCC_PARAMS` ved å hente og tolke
 *    `.das` (`das-verification.ts`) — review-funn fase 3 bølge 2:
 *    parametrene var tidligere kun verifisert ÉN GANG manuelt, ALDRI ved
 *    et faktisk bygg. **Hard-feil ved avvik** (ærlig degradering: en
 *    pakke med feil rotasjon skal ikke bygges i det hele tatt).
 * 4. For hver mål-flis (§7, 2°×2°, delt origo): probe grid-indeksvindu
 *    (cached til disk, §7 punkt 1), hent x_wind_10m/y_wind_10m for ALLE
 *    30 medlemmer i ETT kall hver (§7 punkt 2), roter griddrelativt→sann
 *    nord (`lambert-rotation.ts`, §19 2026-09-03-funnet), kvantiser+skriv
 *    hvert medlem (`pipeline.ts`), mål rått/gzip/delta+gzip.
 * 5. Verifiser rundtur (dekode fra SERIALISERT payload, ikke fra
 *    in-memory-laget) mot kildeverdier (post-rotasjon) på kjente noder.
 *    **NB:** denne rundturen tester IKKE selve rotasjonsvinkelen (den
 *    dekoder rotert fart/retning mot ALLEREDE rotert kilde — et
 *    sirkelbevis for rotasjonen), kun at kvantisering+lagring+
 *    fart/retningsbudsjettet holder. Rotasjonens PARAMETRE dekkes av
 *    steg 3, IKKE denne rundturen.
 * 6. Skriv pakkefiler + peker til `out/`. Strøm/bølge er IKKE hentet denne
 *    bølgen (D4-beslutning) — flagges eksplisitt som `missingFields`
 *    (§12/N2), ALDRI stille utelatt.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { checkLegalGate } from "./legal-gate.js";
import { tileBounds, tileIdToString, type WeatherTileId } from "./grid.js";
import {
  DEFAULT_BACKOFF,
  buildUserAgent,
  fetchWithBackoff,
  type FetchLike,
} from "./opendap-client.js";
import {
  initTimeFromRunName,
  lonAtNodeFromGrid,
  parseEnsembleMemberCountFromDds,
  parseMepsLatestCatalogRunNames,
  probeBboxIndexWindow,
  type GridProbeResult,
} from "./live-source.js";
import {
  applyLccRotationToWindComponents,
  buildWindMemberPackage,
  convertWindComponentsToKnots,
  fetchWindComponents,
  flatIndex,
  resolveEnsembleSourceStatus,
  type FetchedWindComponents,
} from "./pipeline.js";
import { buildPointer, type PointerFieldEntry, type PointerMissingFieldEntry, type PointerTileEntry } from "./package-writer.js";
import { fieldMissingEntirely } from "./source-status.js";
import {
  parseLccAttributesFromDas,
  verifyLccDasAttributes,
  type DasLccAttributes,
  type LccDasVerificationResult,
} from "./das-verification.js";
import { angularDiffDeg, maxDirectionErrorDeg } from "./direction-budget.js";
import { decodeWindAt, windMemberLayersFromBytes } from "@morild/weather";
import type { EnsembleRun } from "./lagged-ensemble.js";
import type { PackageHeader } from "@morild/protocol";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_DIR = join(import.meta.dirname, "..", "out");
const BLOB_DIR = join(OUT_DIR, "weather", "1");
const GRID_CACHE_PATH = join(import.meta.dirname, "..", ".grid-index-cache.json");

const THREDDS_MEPSLATEST = "https://thredds.met.no/thredds/dodsC/mepslatest";
const CATALOG_URL = "https://thredds.met.no/thredds/catalog/mepslatest/catalog.xml";

const FORMAT_VERSION = "1.0.0";
const TOOL_VERSION = "0.1.0-live-2026-09-03";
const CONTACT_EMAIL = "maasao@gmail.com";

const MEMBER_COUNT = 30; // §9.1 pkt. 4 — kontroll (medlem 0) + 29 øvrige, alle i ensemble_member-dimensjonen
const HORIZON_H = 48; // §9.1 pkt. 4: medlemshorisont
const TIME_STEP_H = 1; // §9.2: harde felt (TWS) er 1 t
const TIME_COUNT = HORIZON_H / TIME_STEP_H + 1; // 49

/**
 * Mål-fliser (§7, 2°×2°-rutenett, delt origo): de to flisene som til
 * sammen dekker BÅDE Skjæløy (~59,2°N, 10,9°Ø) og Skagen (~57,7°N, 10,6°Ø)
 * — ingen enkelt 2°-flis dekker begge (grensen ved 58°N går midt i ruten,
 * et forventet, korrekt utfall av det faste flisrutenettet, ikke en bug).
 */
const TARGET_TILES: readonly WeatherTileId[] = [
  { lonIndex: 5, latIndex: 28 }, // 10-12°Ø, 56-58°N — dekker Skagen-enden
  { lonIndex: 5, latIndex: 29 }, // 10-12°Ø, 58-60°N — dekker Skjæløy-enden
];

function realFetch(): FetchLike {
  return async (url, init) => {
    const res = await fetch(url, init);
    return {
      status: res.status,
      ok: res.ok,
      arrayBuffer: () => res.arrayBuffer(),
    };
  };
}

function parseDimLength(ddsText: string, dimName: string): number {
  const m = new RegExp(`\\b${dimName}\\s*=\\s*(\\d+)`).exec(ddsText);
  if (!m || m[1] === undefined) throw new Error(`Fant ikke dimensjonen "${dimName}" i DDS-teksten`);
  return Number(m[1]);
}

async function fetchText(url: string, userAgent: string, fetchImpl: FetchLike): Promise<string> {
  const { buffer } = await fetchWithBackoff(url, userAgent, fetchImpl, DEFAULT_BACKOFF);
  return new TextDecoder("utf-8").decode(buffer);
}

// --- §11: løs siste komplette kjøring fra EKTE katalog -----------------

interface ResolvedRun {
  readonly runName: string;
  readonly datasetUrl: string;
  readonly init: string;
  readonly memberCount: number;
  readonly domain: { readonly yCount: number; readonly xCount: number };
  readonly ddsText: string;
}

type ResolveRunResult =
  | { readonly run: ResolvedRun; readonly sourceStatus: PackageHeader["sourceStatus"] }
  | { readonly run: undefined; readonly sourceStatus: Extract<PackageHeader["sourceStatus"], { status: "degraded" }> };

async function resolveLatestCompleteRun(fetchImpl: FetchLike, userAgent: string): Promise<ResolveRunResult> {
  console.log(`[1/6] Henter katalog: ${CATALOG_URL}`);
  const catalogXml = await fetchText(CATALOG_URL, userAgent, fetchImpl);
  const runNames = parseMepsLatestCatalogRunNames(catalogXml);
  console.log(`  Fant ${runNames.length} ekte kjøringer, nyest først: ${runNames.slice(0, 3).join(", ")}`);
  if (runNames.length === 0) {
    throw new Error("Fant ingen meps_lagged_6_h_latest_2_5km_*.nc-kjøringer i katalogen");
  }

  // §18 pkt. 2: sjekk maks 3 kandidater (siste + 2 tilbake), SEKVENSIELT (§16).
  const candidates = runNames.slice(0, 3);
  const runs: EnsembleRun[] = [];
  const ddsByName = new Map<string, string>();
  for (const name of candidates) {
    const datasetUrl = `${THREDDS_MEPSLATEST}/${name}`;
    const ddsText = await fetchText(`${datasetUrl}.dds`, userAgent, fetchImpl);
    ddsByName.set(name, ddsText);
    const memberCount = parseEnsembleMemberCountFromDds(ddsText);
    console.log(`  ${name}: ensemble_member=${memberCount}`);
    runs.push({ init: initTimeFromRunName(name), memberCount, hasControlMember: memberCount > 0 });
  }

  const resolution = resolveEnsembleSourceStatus(runs);
  if (resolution.selection.outcome === "no-usable-ensemble") {
    console.error(`  Ingen komplett ensemble funnet: ${resolution.selection.sourceStatus.reason}`);
    return { run: undefined, sourceStatus: resolution.selection.sourceStatus };
  }
  const chosenIndex = resolution.selection.runsBack;
  const chosenName = candidates[chosenIndex];
  if (chosenName === undefined) throw new Error("intern feil: runsBack pekte utenfor kandidatlisten");
  const ddsText = ddsByName.get(chosenName);
  if (ddsText === undefined) throw new Error("intern feil: DDS for valgt kjøring ikke funnet i cache");
  const domain = { yCount: parseDimLength(ddsText, "y"), xCount: parseDimLength(ddsText, "x") };
  console.log(`  Valgt kjøring: ${chosenName} (runsBack=${chosenIndex}), domene ${domain.yCount}×${domain.xCount}`);
  return {
    run: {
      runName: chosenName,
      datasetUrl: `${THREDDS_MEPSLATEST}/${chosenName}`,
      init: initTimeFromRunName(chosenName),
      memberCount: resolution.selection.run.memberCount,
      domain,
      ddsText,
    },
    sourceStatus: resolution.sourceStatus,
  };
}

// --- LCC-projeksjonsverifisering (review-funn fase 3 bølge 2) -----------

/**
 * Henter `.das` for den valgte kjøringen og verifiserer at MEPS' faktiske
 * LCC-projeksjonsparametre fortsatt stemmer med de hardkodede konstantene
 * `lambert-rotation.ts` bruker for griddrelativt→sann-nord-rotasjonen
 * (`das-verification.ts`). Kaster ALDRI selv (som `resolveLatestCompleteRun`,
 * returnerer en diskriminert union) — kalleren (`main`) avgjør at et avvik
 * skal stoppe bygget.
 */
async function verifyLccProjection(
  datasetUrl: string,
  fetchImpl: FetchLike,
  userAgent: string,
): Promise<{ readonly verification: LccDasVerificationResult; readonly dasText: string }> {
  console.log(`[2/6] Verifiserer LCC-projeksjonsparametre mot .das (hard-feil ved avvik)...`);
  const dasText = await fetchText(`${datasetUrl}.das`, userAgent, fetchImpl);
  const parsed: DasLccAttributes = parseLccAttributesFromDas(dasText);
  const verification = verifyLccDasAttributes(parsed);
  console.log(
    `  Lest fra .das: standard_parallel=${parsed.standardParallelDeg.join(",")}, ` +
      `longitude_of_central_meridian=${parsed.longitudeOfCentralMeridianDeg}, ` +
      `latitude_of_projection_origin=${parsed.latitudeOfProjectionOriginDeg}, ` +
      `earth_radius=${parsed.earthRadiusM ?? "(ikke oppgitt)"}`,
  );
  if (verification.ok) {
    console.log(`  OK — samsvarer med lambert-rotation.ts::MEPS_LCC_PARAMS/das-verification.ts::MEPS_LCC_DAS_EXPECTATIONS.`);
  } else {
    console.error(`  AVVIK oppdaget — se rapport under. Bygget stoppes (feil rotasjon ville gitt en stille, voksende retningsskjevhet).`);
  }
  return { verification, dasText };
}

// --- Grid-indeks-cache (§7 punkt 1 — permanent på disk) -----------------

interface PersistedTileCacheEntry {
  readonly window: { readonly yStart: number; readonly yEnd: number; readonly xStart: number; readonly xEnd: number };
  readonly lonGrid: number[];
}
type PersistedGridCache = Record<string, PersistedTileCacheEntry>;

function loadGridCache(): PersistedGridCache {
  if (!existsSync(GRID_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(GRID_CACHE_PATH, "utf8")) as PersistedGridCache;
  } catch {
    return {};
  }
}

function saveGridCache(cache: PersistedGridCache): void {
  writeFileSync(GRID_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function resolveTileGrid(
  tileKey: string,
  bbox: { readonly west: number; readonly south: number; readonly east: number; readonly north: number },
  domain: { readonly yCount: number; readonly xCount: number },
  datasetUrl: string,
  fetchImpl: FetchLike,
  userAgent: string,
  cache: PersistedGridCache,
): Promise<GridProbeResult> {
  const cached = cache[tileKey];
  if (cached) {
    console.log(`  Grid-indeksvindu for ${tileKey}: CACHET (${GRID_CACHE_PATH})`);
    return { window: cached.window, lonGrid: Float64Array.from(cached.lonGrid) };
  }
  console.log(`  Grid-indeksvindu for ${tileKey}: probing (ikke cachet ennå)...`);
  const probe = await probeBboxIndexWindow({ datasetUrl, bbox, domain, fetchImpl, userAgent, backoff: DEFAULT_BACKOFF });
  cache[tileKey] = { window: probe.window, lonGrid: Array.from(probe.lonGrid) };
  saveGridCache(cache);
  return probe;
}

// --- Verifisering: rundtur mot kildeverdier (post-rotasjon) -------------

interface VerificationSample {
  readonly y: number;
  readonly x: number;
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
  readonly sourceSpeedKn: number;
  readonly sourceFromDeg: number;
  readonly decodedSpeedKn: number;
  readonly decodedFromDeg: number;
  readonly speedErrorKn: number;
  readonly dirErrorDeg: number;
  /** `undefined` ⇒ retning dårlig definert ved denne farten (se `maxDirectionErrorDeg`) — IKKE et brudd. */
  readonly dirBudgetDeg: number | undefined;
  readonly dirWithinBudget: boolean;
}

function verifyRoundTrip(
  payload: Uint8Array,
  components: FetchedWindComponents,
  lonAtNode: (y: number, x: number) => number,
  latMin: number,
  latStepDeg: number,
  lonMin: number,
  lonStepDeg: number,
  t0S: number,
  dtS: number,
  maxDecodeErrorKn: number,
): {
  readonly samples: VerificationSample[];
  readonly maxObservedErrorKn: number;
  readonly maxObservedDirErrorDeg: number;
  readonly withinBudget: boolean;
} {
  const member = windMemberLayersFromBytes(payload);
  const { yCount, xCount, timeCount } = components.dims;
  const probePoints: Array<[y: number, x: number, t: number]> = [
    [0, 0, 0],
    [Math.floor(yCount / 2), Math.floor(xCount / 2), Math.floor(timeCount / 2)],
    [yCount - 1, xCount - 1, timeCount - 1],
    [Math.floor(yCount / 3), Math.floor((2 * xCount) / 3), 5],
  ];
  const samples: VerificationSample[] = [];
  let maxObservedErrorKn = 0;
  let maxObservedDirErrorDeg = 0;
  for (const [y, x, t] of probePoints) {
    const lat = latMin + y * latStepDeg;
    const lon = lonAtNode(y, x); // ekte kildelengdegrad — konsistent med rotasjonen som faktisk ble brukt
    const epochS = t0S + t * dtS;
    const idx = flatIndex(components.dims, t, 0, y, x);
    // `components.u/v` er her ALLEREDE konvertert til knop
    // (`convertWindComponentsToKnots`) og rotert til sann nord
    // (`applyLccRotationToWindComponents`) — samme verdier som faktisk ble
    // matet inn i `buildLayer`, altså den korrekte fasiten å dekode mot.
    const uSrc = components.u[idx] ?? NaN;
    const vSrc = components.v[idx] ?? NaN;
    const sourceSpeedKn = Math.hypot(uSrc, vSrc);
    const sourceFromDeg = ((Math.atan2(-uSrc, -vSrc) * 180) / Math.PI + 360) % 360;
    const decoded = decodeWindAt(member, lat, lonMin + x * lonStepDeg, epochS);
    if (!decoded) continue;
    const errorKn = Math.abs(decoded.speedKn - sourceSpeedKn);
    maxObservedErrorKn = Math.max(maxObservedErrorKn, errorKn);
    const dirErrorDeg = angularDiffDeg(decoded.fromDeg, sourceFromDeg);
    // Budsjettet regnes fra KILDENS fart (den kjente, sanne vektorlengden
    // FØR kvantisering) — ikke den dekodede farten, som selv bærer
    // (den samme) kvantiseringsstøyen og derfor er et dårligere anker for
    // "hvor stor kan retningsfeilen maks bli".
    const dirBudgetDeg = maxDirectionErrorDeg(sourceSpeedKn, maxDecodeErrorKn);
    const dirWithinBudget = dirBudgetDeg === undefined || dirErrorDeg <= dirBudgetDeg + 1e-9;
    maxObservedDirErrorDeg = dirBudgetDeg === undefined ? maxObservedDirErrorDeg : Math.max(maxObservedDirErrorDeg, dirErrorDeg);
    samples.push({
      y,
      x,
      t,
      lat,
      lon,
      sourceSpeedKn,
      sourceFromDeg,
      decodedSpeedKn: decoded.speedKn,
      decodedFromDeg: decoded.fromDeg,
      speedErrorKn: errorKn,
      dirErrorDeg,
      dirBudgetDeg,
      dirWithinBudget,
    });
  }
  const speedWithinBudget = maxObservedErrorKn <= maxDecodeErrorKn + 1e-9;
  const dirWithinBudgetOverall = samples.every((s) => s.dirWithinBudget);
  return {
    samples,
    maxObservedErrorKn,
    maxObservedDirErrorDeg,
    withinBudget: speedWithinBudget && dirWithinBudgetOverall,
  };
}

// --- Hoved-orkestrering --------------------------------------------------

interface TileBuildSummary {
  readonly tileId: string;
  readonly bbox: readonly [number, number, number, number];
  readonly nodesLat: number;
  readonly nodesLon: number;
  readonly rawBytesTotal: number;
  readonly gzipNoDeltaTotal: number;
  readonly gzipDeltaTotal: number;
  readonly maxDecodeErrorKnObserved: number;
  readonly verification: VerificationSample[];
  readonly fields: PointerFieldEntry[];
}

async function buildTile(
  id: WeatherTileId,
  run: ResolvedRun,
  fetchImpl: FetchLike,
  userAgent: string,
  gridCache: PersistedGridCache,
): Promise<TileBuildSummary> {
  const tileKey = tileIdToString(id);
  const bounds = tileBounds(id);
  const bbox: readonly [number, number, number, number] = [bounds.west, bounds.south, bounds.east, bounds.north];
  console.log(`\n[4/6] Flis ${tileKey} (${bounds.west}-${bounds.east}°Ø, ${bounds.south}-${bounds.north}°N)`);

  const probe = await resolveTileGrid(tileKey, bounds, run.domain, run.datasetUrl, fetchImpl, userAgent, gridCache);
  const { window } = probe;
  const yCount = window.yEnd - window.yStart + 1;
  const xCount = window.xEnd - window.xStart + 1;
  console.log(`  Indeksvindu: y=[${window.yStart},${window.yEnd}] x=[${window.xStart},${window.xEnd}] (${yCount}×${xCount} noder)`);

  console.log(`  Henter x_wind_10m/y_wind_10m, ${MEMBER_COUNT} medlemmer, ${TIME_COUNT} tidssteg (0-${HORIZON_H} t), SEKVENSIELT (§16)...`);
  const t0 = Date.now();
  const components = await fetchWindComponents({
    datasetUrl: run.datasetUrl,
    window,
    timeCount: TIME_COUNT,
    memberCount: MEMBER_COUNT,
    userAgent,
    fetchImpl,
    backoff: DEFAULT_BACKOFF,
  });
  console.log(`  Hentet på ${((Date.now() - t0) / 1000).toFixed(1)} s: ${components.u.length} verdier per komponent`);

  console.log(`  Konverterer m/s→knop (§19 2026-09-03-funn: THREDDS gir m/s, §3 krever knop)...`);
  convertWindComponentsToKnots(components);

  const lonAtNode = lonAtNodeFromGrid(window, probe.lonGrid);
  console.log(`  Roterer griddrelativt→sann nord (lambert-rotation.ts, §19)...`);
  applyLccRotationToWindComponents(components, lonAtNode);

  const t0S = Date.parse(run.init) / 1000;
  const dtS = TIME_STEP_H * 3600;

  let rawBytesTotal = 0;
  let gzipNoDeltaTotal = 0;
  let gzipDeltaTotal = 0;
  let maxDecodeErrorKnObserved = 0;
  const fields: PointerFieldEntry[] = [];
  let firstMemberVerification: VerificationSample[] = [];

  for (let memberIndex = 0; memberIndex < MEMBER_COUNT; memberIndex++) {
    const result = buildWindMemberPackage({
      formatVersion: FORMAT_VERSION,
      producedAt: new Date().toISOString(),
      init: run.init,
      resolution: "2.5km",
      components,
      memberIndex,
      bbox,
      tileId: tileKey,
      t0S,
      dtS,
    });
    const plainU = result.payload; // deltaCoded=true already (default) — see rawPayloadBytes note below
    rawBytesTotal += result.rawPayloadBytes;
    const gzipDelta = gzipSync(result.payload).length;
    gzipDeltaTotal += gzipDelta;

    // Baseline (uten delta) kun for medlem 0 — nok til å rapportere faktoren, ikke 30x kostnaden.
    if (memberIndex === 0) {
      const plainVariant = buildWindMemberPackage({
        formatVersion: FORMAT_VERSION,
        producedAt: new Date().toISOString(),
        init: run.init,
        resolution: "2.5km",
        components,
        memberIndex,
        bbox,
        tileId: tileKey,
        t0S,
        dtS,
        deltaCoded: false,
      });
      gzipNoDeltaTotal = gzipSync(plainVariant.payload).length * MEMBER_COUNT; // ekstrapolert, dokumentert i loggen
      console.log(`  (baseline uten delta målt kun for medlem 0, ekstrapolert ×${MEMBER_COUNT} for sum-linja)`);

      const verification = verifyRoundTrip(
        result.payload,
        components,
        lonAtNode,
        bounds.south,
        (bounds.north - bounds.south) / (yCount - 1),
        bounds.west,
        (bounds.east - bounds.west) / (xCount - 1),
        t0S,
        dtS,
        result.maxDecodeErrorKn,
      );
      firstMemberVerification = verification.samples;
      console.log(
        `  [5/6] Rundtur-verifisering (dekker IKKE selve rotasjonsvinkelen — se steg 3) (medlem 0): maxDecodeErrorKn=${result.maxDecodeErrorKn.toFixed(4)}, ` +
          `observert maks fart=${verification.maxObservedErrorKn.toFixed(4)} kn, observert maks retning=${verification.maxObservedDirErrorDeg.toFixed(1)}° (kun der budsjettet er definert), ` +
          `innenfor budsjett=${verification.withinBudget}`,
      );
      for (const s of verification.samples) {
        console.log(
          `    (${s.lat.toFixed(3)}°N,${s.lon.toFixed(3)}°Ø,t=${s.t}h): kilde ${s.sourceSpeedKn.toFixed(2)} kn/${s.sourceFromDeg.toFixed(1)}°` +
            ` → dekodet ${s.decodedSpeedKn.toFixed(2)} kn/${s.decodedFromDeg.toFixed(1)}° (fartfeil ${s.speedErrorKn.toFixed(4)} kn, ` +
            `retningsfeil ${s.dirErrorDeg.toFixed(1)}° mot budsjett ${s.dirBudgetDeg === undefined ? "udefinert (lav fart)" : `${s.dirBudgetDeg.toFixed(1)}°`})`,
        );
      }
      // Review-funn fase 3 bølge 2: `withinBudget` ble tidligere regnet
      // (fart OG nå retning), men ALDRI brukt til å stoppe noe — et brudd
      // ble kun synlig som en logglinje en operatør måtte lese manuelt.
      // Ærlig degradering krever at bygget faktisk feiler her.
      if (!verification.withinBudget) {
        const brudd = verification.samples
          .filter((s) => s.speedErrorKn > result.maxDecodeErrorKn + 1e-9 || !s.dirWithinBudget)
          .map(
            (s) =>
              `(${s.lat.toFixed(3)}°N,${s.lon.toFixed(3)}°Ø,t=${s.t}h): fartfeil=${s.speedErrorKn.toFixed(4)}kn (budsjett ${result.maxDecodeErrorKn.toFixed(4)}kn), ` +
              `retningsfeil=${s.dirErrorDeg.toFixed(1)}° (budsjett ${s.dirBudgetDeg === undefined ? "udefinert" : `${s.dirBudgetDeg.toFixed(1)}°`})`,
          );
        throw new Error(
          `Rundtur-verifisering for flis ${tileKey} (medlem 0) er UTENFOR budsjett — nekter å skrive pakken: ${brudd.join("; ")}`,
        );
      }
    }
    maxDecodeErrorKnObserved = Math.max(maxDecodeErrorKnObserved, result.maxDecodeErrorKn);

    mkdirSync(BLOB_DIR, { recursive: true });
    writeFileSync(join(BLOB_DIR, `${result.hash}.bin`), plainU);
    fields.push(result.pointerEntry);
  }

  console.log(
    `  Flis ${tileKey} sum (${MEMBER_COUNT} medlemmer, u+v): rått=${(rawBytesTotal / 1e6).toFixed(2)} MB, ` +
      `gzip(delta)=${(gzipDeltaTotal / 1e6).toFixed(2)} MB (faktor ${(rawBytesTotal / gzipDeltaTotal).toFixed(2)}×)`,
  );

  return {
    tileId: tileKey,
    bbox,
    nodesLat: yCount,
    nodesLon: xCount,
    rawBytesTotal,
    gzipNoDeltaTotal,
    gzipDeltaTotal,
    maxDecodeErrorKnObserved,
    verification: firstMemberVerification,
    fields,
  };
}

/** `fieldMissingEntirely` returnerer alltid `{status:"degraded",...}` — dette gjør det eksplisitt for `PointerMissingFieldEntry`s strammere type. */
function missingField(field: string, sourceLabel: string): PointerMissingFieldEntry {
  const status = fieldMissingEntirely(sourceLabel);
  if (status.status !== "degraded") {
    throw new Error("intern feil: fieldMissingEntirely returnerte uventet 'ok'");
  }
  return { field, sourceStatus: status };
}

async function main(): Promise<void> {
  console.log("=== weather-pack build-live-package (bølge 2A, 2026-09-03) — VIND-ONLY, EKTE THREDDS-data ===");
  const gate = checkLegalGate(join(REPO_ROOT, "docs", "legal"));
  if (!gate.ok) {
    console.error(`Nektet: ${gate.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Legal-gate: ${gate.reason}`);

  const fetchImpl = realFetch();
  const userAgent = buildUserAgent(TOOL_VERSION, CONTACT_EMAIL);
  console.log(`User-Agent: ${userAgent}`);

  const { run, sourceStatus } = await resolveLatestCompleteRun(fetchImpl, userAgent);
  if (!run) {
    console.error(`Ingen brukbar pakke kan bygges: ${sourceStatus.reason}`);
    process.exitCode = 1;
    return;
  }

  const { verification: lccVerification } = await verifyLccProjection(run.datasetUrl, fetchImpl, userAgent);
  if (!lccVerification.ok) {
    for (const m of lccVerification.mismatches) console.error(`    - ${m}`);
    console.error(
      `Nektet: LCC-projeksjonsparametrene lest fra .das stemmer ikke med de hardkodede konstantene ` +
        `(lambert-rotation.ts::MEPS_LCC_PARAMS). Bygger IKKE en pakke med potensielt feil vindrotasjon.`,
    );
    process.exitCode = 1;
    return;
  }

  const gridCache = loadGridCache();
  const summaries: TileBuildSummary[] = [];
  for (const id of TARGET_TILES) {
    const summary = await buildTile(id, run, fetchImpl, userAgent, gridCache);
    summaries.push(summary);
  }

  console.log(`\n[6/6] Skriver peker...`);
  const tiles: PointerTileEntry[] = summaries.map((s) => ({
    tileId: s.tileId,
    bbox: s.bbox,
    fields: s.fields,
    missingFields: [missingField("current", "NorKyst-strøm"), missingField("waves", "Oceanforecast/WAM800-bølge")],
  }));
  const pointer = buildPointer(FORMAT_VERSION, tiles);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "pointer-vaer-skandinavia.json"), JSON.stringify(pointer, null, 2));

  const totalRaw = summaries.reduce((a, s) => a + s.rawBytesTotal, 0);
  const totalGzipDelta = summaries.reduce((a, s) => a + s.gzipDeltaTotal, 0);
  const totalGzipNoDelta = summaries.reduce((a, s) => a + s.gzipNoDeltaTotal, 0);

  const report = {
    builtAt: new Date().toISOString(),
    run: { runName: run.runName, init: run.init, memberCount: run.memberCount, sourceStatus },
    // Review-funn fase 3 bølge 2: de FAKTISK leste LCC-projeksjonsverdiene
    // (ikke bare et "ok"-flagg) — slik at ethvert avvik som SKULLE dukket
    // opp (bygget stoppet jo hardt hvis det gjorde det, se over) uansett er
    // sporbart i etterkant for et vellykket bygg også.
    lccProjection: { ok: lccVerification.ok, ...lccVerification.parsed },
    tiles: summaries.map((s) => ({
      tileId: s.tileId,
      bbox: s.bbox,
      nodesLat: s.nodesLat,
      nodesLon: s.nodesLon,
      rawBytesTotal: s.rawBytesTotal,
      gzipNoDeltaTotalExtrapolated: s.gzipNoDeltaTotal,
      gzipDeltaTotal: s.gzipDeltaTotal,
      maxDecodeErrorKnObserved: s.maxDecodeErrorKnObserved,
      verification: s.verification,
    })),
    totals: {
      rawBytesTotal: totalRaw,
      gzipNoDeltaTotalExtrapolated: totalGzipNoDelta,
      gzipDeltaTotal: totalGzipDelta,
      memberCount: MEMBER_COUNT,
      horizonH: HORIZON_H,
      timeStepH: TIME_STEP_H,
    },
    missingFields: ["current (NorKyst)", "waves (Oceanforecast/WAM800)"],
  };
  writeFileSync(join(OUT_DIR, "build-report.json"), JSON.stringify(report, null, 2));

  console.log(`\n=== FERDIG ===`);
  console.log(`Kjøring: ${run.runName} (init ${run.init})`);
  console.log(`Rått (alle fliser, ${MEMBER_COUNT} medlemmer, u+v): ${(totalRaw / 1e6).toFixed(2)} MB`);
  console.log(`Etter delta+gzip: ${(totalGzipDelta / 1e6).toFixed(2)} MB (faktor ${(totalRaw / totalGzipDelta).toFixed(2)}×)`);
  console.log(`Skrev pakke-blober til ${BLOB_DIR}, peker til ${join(OUT_DIR, "pointer-vaer-skandinavia.json")}`);
  console.log(`Fullstendig rapport: ${join(OUT_DIR, "build-report.json")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
