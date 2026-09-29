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
 *    30 medlemmer i ETT kall hver (§7 punkt 2), merk fyllverdi/ikke-endelig/
 *    fysisk umulig som manglende (NaN ⇒ sentinel) og utelat medlemmer med
 *    > 50 % mangler fra pekeren (kontrollen uten data ⇒ bygget feiler;
 *    §19 2026-09-29), roter griddrelativt→sann
 *    nord (`lambert-rotation.ts`, §19 2026-09-03-funnet), kvantiser+skriv
 *    hvert medlem (`pipeline.ts`), mål rått/gzip/delta+gzip.
 * 5. Verifiser rundtur (dekode fra SERIALISERT payload, ikke fra
 *    in-memory-laget) mot kildeverdier (post-rotasjon) på kjente noder.
 *    **NB:** denne rundturen tester IKKE selve rotasjonsvinkelen (den
 *    dekoder rotert fart/retning mot ALLEREDE rotert kilde — et
 *    sirkelbevis for rotasjonen), kun at kvantisering+lagring+
 *    fart/retningsbudsjettet holder. Rotasjonens PARAMETRE dekkes av
 *    steg 3, IKKE denne rundturen.
 * 6. **Strøm (NorKyst, `docs/specs/strom-produsent.md`, 2026-09-27)** etter
 *    vinden: `.das`-verifisering av koding (hard-feil ved avvik), løpende
 *    tidsakse matchet mot vindens 49 tidssteg, indeksvindu per 1°-flis via
 *    nærmeste-punkt-søk (cachet i eget nøkkelrom), u/v overflate hentet
 *    sekvensielt, NN-regridding mot kildens 2D lat/lon med kystkant-
 *    forlengelse ≤ √2 celler, kystmaske, `buildLayer` + sertifikat + FULL
 *    rundtur (brudd ⇒ bygget feiler). NorKyst utilgjengelig ⇒ strøm som
 *    `missingFields` med årsak (N2), vinden bygges likevel.
 * 7. Skriv pakkefiler + peker til `out/`. Bølge er IKKE hentet (steg 3,
 *    egen spec) — flagges eksplisitt som `missingFields` (§12/N2), ALDRI
 *    stille utelatt.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { checkLegalGate } from "./legal-gate.js";
import { tileBounds, tileIdToString, tilesOverlapping, WEATHER_TILE_DEG, type WeatherTileId } from "./grid.js";
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
  assessWindMembers,
  buildWindMemberPackage,
  convertWindComponentsToKnots,
  fetchWindComponents,
  flatIndex,
  maskMissingWindValues,
  parseWindMissingValuesFromDas,
  resolveEnsembleSourceStatus,
  type ExcludedWindMember,
  type FetchedWindComponents,
  type WindMissingValueSpec,
} from "./pipeline.js";
import { buildPointer, type PointerFieldEntry, type PointerMissingFieldEntry, type PointerTileEntry } from "./package-writer.js";
import {
  COAST_EXTENSION_CELLS,
  currentMsToKnots,
  currentRegularGridForTile,
  decodeNorkystRaw,
  haversineM,
  matchTimeSteps,
  regridNearestSeaNode,
  regularComponentValues,
  seaMaskFromRaw,
  type LatLonSample,
  type NativeGrid,
  type RegridResult,
} from "./current-geometry.js";
import {
  NORKYST_CACHE_NAMESPACE,
  NORKYST_COARSE_STRIDE,
  NORKYST_DATASET_URL,
  fetchCurrentRaw,
  fetchNorkystLatLon,
  fetchNorkystMetadata,
  fetchNorkystReferenceTime,
  fetchNorkystTimeTail,
  locateCurrentTile,
  verifyNorkystComponentAttributes,
  type LocatedCurrentTile,
  type NorkystDims,
  type NorkystRequestContext,
} from "./norkyst-source.js";
import {
  buildCoastalMaskLayer,
  buildCurrentLayers,
  currentLayerGeometry,
  currentPointerEntries,
  decodeCurrentFromPayload,
  verifyCurrentRoundTrip,
  type CurrentRoundTripReport,
} from "./current-package.js";
import { combineSourceStatuses, fieldMissingEntirely } from "./source-status.js";
import {
  parseLccAttributesFromDas,
  verifyLccDasAttributes,
  type DasLccAttributes,
  type LccDasVerificationResult,
} from "./das-verification.js";
import { angularDiffDeg, maxDirectionErrorDeg } from "./direction-budget.js";
import { decodeWindAt, windMemberLayersFromBytes, type ClippedSample, type FieldCertificate } from "@morild/weather";
import type { EnsembleRun } from "./lagged-ensemble.js";
import type { PackageHeader } from "@morild/protocol";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_DIR = join(import.meta.dirname, "..", "out");
const BLOB_DIR = join(OUT_DIR, "weather", "1");
const GRID_CACHE_PATH = join(import.meta.dirname, "..", ".grid-index-cache.json");
/** Eget nøkkelrom for NorKyst (spec §4 steg 2): tidsaksen er løpende, derfor caches kun Y/X-vinduet + lat/lon. */
const NORKYST_CACHE_PATH = join(import.meta.dirname, "..", ".norkyst-grid-cache.json");

const THREDDS_MEPSLATEST = "https://thredds.met.no/thredds/dodsC/mepslatest";
const CATALOG_URL = "https://thredds.met.no/thredds/catalog/mepslatest/catalog.xml";

// D7.4 (fase 3 bølge 3A): PackageHeader bærer nå ALLTID et sertifikat
// (`CertifiedPackageHeader`) — additiv (en eldre klient som ikke kjenner
// `header.certificate` leser resten av headeren uendret), derfor minor,
// ikke major (§5s `checkCompatibility` avviser kun ulik MAJOR).
const FORMAT_VERSION = "1.1.0";
const TOOL_VERSION = "0.3.0-live-2026-09-27";
const CONTACT_EMAIL = "maasao@gmail.com";

const MEMBER_COUNT = 30; // §9.1 pkt. 4 — kontroll (medlem 0) + 29 øvrige, alle i ensemble_member-dimensjonen
const HORIZON_H = 48; // §9.1 pkt. 4: medlemshorisont
const TIME_STEP_H = 1; // §9.2: harde felt (TWS) er 1 t
const TIME_COUNT = HORIZON_H / TIME_STEP_H + 1; // 49

/**
 * Endepunkt-bbox (§7, `WEATHER_TILE_DEG`=1°-rutenett, delt origo):
 * Skjæløy (~59,2°N, 10,9°Ø) og Skagen (~57,7°N, 10,6°Ø).
 *
 * **D7.2 (fase 3 bølge 3A, ekspertpanelets D7-syntese, «djevelens
 * advokat»-funn):** «flisvalg fra endepunkt-bbox er utrygt — medlemsruter
 * 9,6–17,6 nm utenfor luftlinjen». Byggeren har INGEN sikker viten om
 * A*-feltets faktiske rekkevidde (det er klientens/rutemotorens ansvar,
 * ikke byggerens) — regelen her er derfor bevisst RAUS, ikke presis:
 * endepunkt-bbox utvidet med ≥ 0,5° på ALLE kanter (≈ 30 nm ved denne
 * bredden, godt over den observerte medlemsspredningen), ALDRI stram inn
 * mot et antatt korridorbehov. Manglende dekning her ville stille styrt
 * søket via en usynlig flisgrense (§9.10/N2 — «manglende data vises,
 * aldri skjules») — bygg heller for mye enn for lite.
 */
const ROUTE_ENDPOINT_BBOX = { west: 10.6, south: 57.7, east: 10.9, north: 59.2 } as const;
const SAFETY_MARGIN_DEG = 0.5; // D7.2 — minimum, ikke et forsøk på et "nok"-tall utover minimum

const TARGET_BBOX_WITH_MARGIN = {
  west: ROUTE_ENDPOINT_BBOX.west - SAFETY_MARGIN_DEG,
  south: ROUTE_ENDPOINT_BBOX.south - SAFETY_MARGIN_DEG,
  east: ROUTE_ENDPOINT_BBOX.east + SAFETY_MARGIN_DEG,
  north: ROUTE_ENDPOINT_BBOX.north + SAFETY_MARGIN_DEG,
};

/** Alle 1°-fliser (`WEATHER_TILE_DEG`) som overlapper `TARGET_BBOX_WITH_MARGIN` — beregnet, ikke hardkodet, slik at en endring i marginen eller flisstørrelsen aldri kan komme i utakt med denne listen. */
const TARGET_TILES: readonly WeatherTileId[] = tilesOverlapping(TARGET_BBOX_WITH_MARGIN, WEATHER_TILE_DEG);

/**
 * D7.4 klippe-assert: en `onClip`-callback som kaster UMIDDELBART (§9.10 —
 * ærlig degradering betyr her «bygg ingenting», ikke «bygg og logg en
 * advarsel ingen leser»). Se `buildLayer`s `onClip`-dokumentasjon
 * (`@morild/weather`) for hvorfor dette strukturelt aldri skal inntreffe —
 * denne funksjonen finnes for at det IKKE skal kunne inntreffe stille
 * dersom den garantien noensinne brytes (refaktorering, ny kildesti, e.l.).
 */
function hardFailOnClip(tileKey: string, memberIndex: number): (channel: "u" | "v", info: ClippedSample) => void {
  return (channel, info) => {
    throw new Error(
      `Klippe-assert utløst for flis ${tileKey}, medlem ${memberIndex}, kanal ${channel} ` +
        `(subflis sr=${info.sr},sc=${info.sc}, t=${info.k}, ${info.lat.toFixed(3)}°N,${info.lon.toFixed(3)}°Ø): ` +
        `verdi=${info.value} dekodet=${info.decoded} avvik=${info.errorAbs.toFixed(4)} (skala=${info.scale}). ` +
        `Dette skal være STRUKTURELT umulig (lo/hi regnes fra nøyaktig de kodede verdiene, §7) — ` +
        `nekter å skrive en pakke som ikke kan sertifiseres (§9.10).`,
    );
  };
}

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
  /** Sertifikatet skrevet for medlem 0 (D7.4) — representativt (alle medlemmer på samme flis sertifiseres, se `pipeline.ts::buildWindMemberPackage`). */
  readonly certificateSample: FieldCertificate;
  /** Medlemmer utelatt fra pekeren fordi vinddataene mangler (§19 2026-09-29) — med grunn. */
  readonly excludedWindMembers: readonly ExcludedWindMember[];
  /** Vindfeltets status for flisen (kjøringsvalg + utelatte medlemmer). */
  readonly windSourceStatus: PackageHeader["sourceStatus"];
}

async function buildTile(
  id: WeatherTileId,
  run: ResolvedRun,
  runSourceStatus: PackageHeader["sourceStatus"],
  windMissing: WindMissingValueSpec,
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

  // §19 2026-09-29: fyllverdi/ikke-endelig/fysisk umulig ⇒ NaN (sentinel),
  // på RÅ m/s FØR konvertering og rotasjon. Medlem med > 50 % mangler
  // skrives ikke til pekeren; kontrollen uten data ⇒ kast (bygget stopper).
  const missingStats = maskMissingWindValues(components, windMissing);
  const assessment = assessWindMembers(missingStats);
  const partialMissing = missingStats.filter((s) => s.missing > 0 && assessment.included.includes(s.member));
  if (assessment.excluded.length > 0) {
    console.warn(`  [mangler] ${assessment.included.length} av ${MEMBER_COUNT} medlemmer har vinddata i flisen. Utelatt:`);
    for (const e of assessment.excluded) console.warn(`    - ${e.reason}`);
  }
  for (const s of partialMissing) {
    console.warn(`  [mangler] medlem ${s.member}: ${s.missing}/${s.total} verdier mangler — skrevet som sentinel (under grensen)`);
  }
  const windSourceStatus = combineSourceStatuses([runSourceStatus, assessment.sourceStatus]);

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
  let certificateSample: FieldCertificate | undefined;

  for (const memberIndex of assessment.included) {
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
      sourceStatusOverride: windSourceStatus,
      onClip: hardFailOnClip(tileKey, memberIndex),
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
      gzipNoDeltaTotal = gzipSync(plainVariant.payload).length * assessment.included.length; // ekstrapolert, dokumentert i loggen
      console.log(`  (baseline uten delta målt kun for medlem 0, ekstrapolert ×${assessment.included.length} for sum-linja)`);

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
      certificateSample = result.header.certificate;
      console.log(
        `  [D7.4] Sertifikat (medlem 0): maxDecodeErrorKn=${result.header.certificate.maxDecodeErrorKn?.toFixed(4)}, ` +
          `maxDirectionErrorDeg=${result.header.certificate.maxDirectionErrorDeg?.toFixed(1)}°, ` +
          `referenceInit=${result.header.certificate.referenceInit}, verifiedAt=${result.header.certificate.verifiedAt}`,
      );
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
    `  Flis ${tileKey} sum (${assessment.included.length} av ${MEMBER_COUNT} medlemmer, u+v): rått=${(rawBytesTotal / 1e6).toFixed(2)} MB, ` +
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
    certificateSample: certificateSample!, // satt i medlem-0-grenen over, som ALLTID kjører (kontrollen er alltid inkludert — ellers kaster assessWindMembers)
    excludedWindMembers: assessment.excluded,
    windSourceStatus,
  };
}

// --- Strøm (NorKyst, docs/specs/strom-produsent.md) -------------------------------

interface PersistedNorkystTileEntry {
  readonly dims: { readonly yCount: number; readonly xCount: number };
  readonly window: { readonly yStart: number; readonly yEnd: number; readonly xStart: number; readonly xEnd: number };
  readonly lat: number[];
  readonly lon: number[];
}
type PersistedNorkystCache = Record<string, PersistedNorkystTileEntry>;

function loadNorkystCache(): PersistedNorkystCache {
  if (!existsSync(NORKYST_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(NORKYST_CACHE_PATH, "utf8")) as PersistedNorkystCache;
  } catch {
    return {};
  }
}

function saveNorkystCache(cache: PersistedNorkystCache): void {
  writeFileSync(NORKYST_CACHE_PATH, JSON.stringify(cache));
}

/** Hvor mange av den løpende tidsaksens siste verdier som hentes for å matche vindens 49 tidssteg (8 døgn). */
const CURRENT_TIME_TAIL = 24 * 8;

/**
 * Fasit-punkter fra geometrispiken (spec §5): dekodet pakke rapporteres mot
 * NN-oppslaget direkte i kildens lat/lon. Rapport, ikke pass/fail.
 */
const CURRENT_FASIT_POINTS = [
  { name: "Drøbaksund", lat: 59.65, lon: 10.62 },
  { name: "Hvaler", lat: 59.05, lon: 11.05 },
  { name: "Skagerrak-åpent", lat: 58.3, lon: 10.3 },
] as const;

interface CurrentFasitReport {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly epochS: number;
  readonly decodedKn: { readonly u: number; readonly v: number } | null;
  readonly nnSourceKn: { readonly u: number; readonly v: number } | null;
  readonly nnDistanceM: number | null;
}

interface CurrentTileReport {
  readonly tileId: string;
  readonly window: LocatedCurrentTile["window"];
  readonly nativeNodes: number;
  readonly nativeFillFraction: number;
  readonly regularNodes: number;
  readonly matchedTimeSteps: number;
  /** Andel «sjønære» regulære noder (proxy for farbar, se README) uten verdi ved grense 1 og √2 celler. */
  readonly nearSeaUndefinedFractionAtLimit1: number;
  readonly nearSeaUndefinedFractionAtLimitSqrt2: number;
  readonly withValueAtLimit1: number;
  readonly withValueAtLimitSqrt2: number;
  readonly extendedNodes: number;
  /** Andel av nodene MED verdi som er kystmerket (D15.2). */
  readonly coastalFractionOfValued: number;
  readonly maxDecodeErrorKn: number;
  readonly roundTrip: CurrentRoundTripReport;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  readonly fasit: readonly CurrentFasitReport[];
}

type CurrentTileOutcome =
  | { readonly ok: true; readonly entries: readonly PointerFieldEntry[]; readonly report: CurrentTileReport }
  | { readonly ok: false; readonly missing: PointerMissingFieldEntry };

function currentMissing(reason: string): PointerMissingFieldEntry {
  return { field: "current", sourceStatus: { status: "degraded", reason: `NorKyst-strøm mangler for denne flisen: ${reason}` } };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Nærmeste native SJØnode til et punkt, brute force mot kildens lat/lon (fasit-sjekken, samme som spiken). */
function nearestNativeSea(
  grid: NativeGrid,
  sea: Uint8Array,
  lat: number,
  lon: number,
): { readonly idx: number; readonly distM: number } | undefined {
  let best: { idx: number; distM: number } | undefined;
  for (let i = 0; i < grid.yCount * grid.xCount; i++) {
    if (sea[i] !== 1) continue;
    const d = haversineM(lat, lon, grid.lat[i]!, grid.lon[i]!);
    if (best === undefined || d < best.distM) best = { idx: i, distM: d };
  }
  return best;
}

/**
 * Strømlaget for alle mål-fliser (spec §4 normalflyt steg 2–6). Nettverks-
 * feil (NorKyst nede, flis utenfor domenet) ⇒ strøm som `missingFields`
 * med årsak (N2) — vinden bygges likevel. Brudd på invariantene
 * (`.das`-avvik, klipping, rundtur utenfor budsjett) ⇒ bygget feiler.
 */
async function buildCurrentTiles(args: {
  readonly tiles: readonly WeatherTileId[];
  readonly t0S: number;
  readonly dtS: number;
  readonly timeCount: number;
  readonly producedAt: string;
  readonly fetchImpl: FetchLike;
  readonly userAgent: string;
}): Promise<Map<string, CurrentTileOutcome>> {
  const out = new Map<string, CurrentTileOutcome>();
  const allMissing = (reason: string): Map<string, CurrentTileOutcome> => {
    for (const id of args.tiles) out.set(tileIdToString(id), { ok: false, missing: currentMissing(reason) });
    return out;
  };
  const ctx: NorkystRequestContext = {
    datasetUrl: NORKYST_DATASET_URL,
    fetchImpl: args.fetchImpl,
    userAgent: args.userAgent,
    backoff: DEFAULT_BACKOFF,
  };
  console.log(`\n[strøm] NorKyst: ${NORKYST_DATASET_URL}`);

  let dims: NorkystDims;
  let dasText: string;
  let init: string | undefined;
  let firstIndex: number;
  let timesS: Float64Array;
  try {
    ({ dims, dasText } = await fetchNorkystMetadata(ctx));
    init = await fetchNorkystReferenceTime(ctx);
    ({ firstIndex, timesS } = await fetchNorkystTimeTail(ctx, dims.timeCount, CURRENT_TIME_TAIL));
  } catch (err) {
    console.error(`  NorKyst utilgjengelig: ${errorText(err)} — strøm merkes manglende (N2), vinden bygges likevel`);
    return allMissing(`NorKyst utilgjengelig (${errorText(err)})`);
  }
  // Koding verifiseres HARDT (som LCC for vind): feil fill/skala ville gitt
  // stille gale tall, og da skal det ikke bygges et strømlag i det hele tatt.
  const mismatches = verifyNorkystComponentAttributes(dasText);
  if (mismatches.length > 0) {
    throw new Error(`NorKyst-.das stemmer ikke med hardkodet koding (current-geometry.ts): ${mismatches.join("; ")}`);
  }
  console.log(`  .das OK (fill −32767, skala 0,001, m/s, tid i s siden 1970). Domene ${dims.yCount}×${dims.xCount}, ${dims.timeCount} tidssteg`);

  const localMatch = matchTimeSteps(timesS, args.t0S, args.dtS, args.timeCount);
  const matchedGlobal = localMatch.flatMap((l) => (l === undefined ? [] : [firstIndex + l]));
  if (matchedGlobal.length === 0) {
    return allMissing("NorKysts tidsakse overlapper ikke vindens tidssteg");
  }
  const tMin = Math.min(...matchedGlobal);
  const tMax = Math.max(...matchedGlobal);
  const sourceTimeIndex = localMatch.map((l) => (l === undefined ? undefined : firstIndex + l - tMin));
  console.log(
    `  Tidsakse: ${matchedGlobal.length}/${args.timeCount} av vindens tidssteg finnes i NorKyst (indeks ${tMin}–${tMax}); resten blir sentinel`,
  );
  let headerInit = init;
  let sourceStatus: PackageHeader["sourceStatus"] = { status: "ok" };
  if (headerInit === undefined) {
    const firstEpoch = args.t0S + localMatch.findIndex((l) => l !== undefined) * args.dtS;
    headerInit = new Date(firstEpoch * 1000).toISOString().replace(".000Z", "Z");
    sourceStatus = {
      status: "degraded",
      reason: "NorKysts forecast_reference_time kunne ikke leses — init satt til første brukte tidssteg",
    };
  }

  const cache = loadNorkystCache();
  let coarse: LatLonSample | undefined;
  const fetchLatLon = (window: LocatedCurrentTile["window"], stride: { readonly y: number; readonly x: number }) =>
    fetchNorkystLatLon(ctx, window, stride);

  for (const id of args.tiles) {
    const tileKey = tileIdToString(id);
    const bounds = tileBounds(id);
    const cacheKey = `${NORKYST_CACHE_NAMESPACE}|${tileKey}`;
    console.log(`\n[strøm] Flis ${tileKey}`);

    let located: LocatedCurrentTile | undefined;
    let raw: Awaited<ReturnType<typeof fetchCurrentRaw>>;
    try {
      const cached = cache[cacheKey];
      if (cached && cached.dims.yCount === dims.yCount && cached.dims.xCount === dims.xCount) {
        located = { window: cached.window, lat: Float64Array.from(cached.lat), lon: Float64Array.from(cached.lon) };
        console.log(`  Indeksvindu CACHET (${NORKYST_CACHE_PATH})`);
      } else {
        if (coarse === undefined) {
          console.log(
            `  Grov prøve av hele domenet (stride ${NORKYST_COARSE_STRIDE.y}×${NORKYST_COARSE_STRIDE.x}) for nærmeste-punkt-søk...`,
          );
          coarse = await fetchLatLon({ yStart: 0, yEnd: dims.yCount - 1, xStart: 0, xEnd: dims.xCount - 1 }, NORKYST_COARSE_STRIDE);
        }
        located = await locateCurrentTile({ tileBounds: bounds, dims, coarse, fetchLatLon });
        if (located !== undefined) {
          cache[cacheKey] = {
            dims: { yCount: dims.yCount, xCount: dims.xCount },
            window: located.window,
            lat: Array.from(located.lat),
            lon: Array.from(located.lon),
          };
          saveNorkystCache(cache);
        }
      }
      if (located === undefined) {
        out.set(tileKey, { ok: false, missing: currentMissing("flisen ligger utenfor NorKyst-domenet") });
        console.log(`  Ingen NorKyst-noder i flisen — strøm merkes manglende`);
        continue;
      }
      const w = located.window;
      console.log(
        `  Indeksvindu y=[${w.yStart},${w.yEnd}] x=[${w.xStart},${w.xEnd}] — henter u/v overflate, tidsindeks ${tMin}–${tMax}, SEKVENSIELT (§16)...`,
      );
      const t0 = Date.now();
      raw = await fetchCurrentRaw(ctx, w, tMin, tMax);
      console.log(`  Hentet på ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      console.error(`  Henting feilet: ${errorText(err)} — strøm merkes manglende for flisen`);
      out.set(tileKey, { ok: false, missing: currentMissing(errorText(err)) });
      continue;
    }

    // Fra her: ren beregning. Brudd på invariantene er HARDE feil (ingen halv pakke).
    const w = located.window;
    const grid: NativeGrid = { yCount: w.yEnd - w.yStart + 1, xCount: w.xEnd - w.xStart + 1, lat: located.lat, lon: located.lon };
    const sea = seaMaskFromRaw(raw.uRaw, raw.vRaw, raw.timeCount, raw.nodeCount);
    let seaCount = 0;
    for (const s of sea) seaCount += s;
    const spec = currentRegularGridForTile(bounds);
    const regrid: RegridResult = regridNearestSeaNode(grid, sea, spec);
    const regridLimit1 = regridNearestSeaNode(grid, sea, spec, { extensionCells: 1 });
    const u = regularComponentValues(regrid, raw.uRaw, raw.nodeCount, sourceTimeIndex);
    const v = regularComponentValues(regrid, raw.vRaw, raw.nodeCount, sourceTimeIndex);
    const geometry = currentLayerGeometry(spec, args.t0S, args.dtS, args.timeCount);
    const layers = buildCurrentLayers({ geometry, u, v, onClip: hardFailOnClip(`${tileKey}/strøm`, 0) });
    const mask = buildCoastalMaskLayer(regrid, args.t0S, args.dtS);
    const roundTrip = verifyCurrentRoundTrip({ payload: layers.payload, maskPayload: mask.payload, u, v, coastal: regrid.coastal });
    console.log(
      `  Rundtur (alle noder × tidssteg): ${roundTrip.checkedSamples} prøver, maks feil u=${roundTrip.maxErrorUKn.toFixed(4)} kn, ` +
        `v=${roundTrip.maxErrorVKn.toFixed(4)} kn, sentinel-avvik=${roundTrip.sentinelMismatches}, maske-avvik=${roundTrip.maskMismatches}, ` +
        `sertifikat maxDecodeErrorKn=${layers.maxDecodeErrorKn.toFixed(4)}`,
    );
    if (!roundTrip.withinBudget) {
      throw new Error(`Strøm-rundtur for flis ${tileKey} er UTENFOR budsjett — nekter å skrive pakken: ${JSON.stringify(roundTrip)}`);
    }

    const entries = currentPointerEntries({
      formatVersion: FORMAT_VERSION,
      producedAt: args.producedAt,
      init: headerInit,
      sourceStatus,
      currentPayload: layers.payload,
      maskPayload: mask.payload,
      maxDecodeErrorKn: layers.maxDecodeErrorKn,
      clippedSamples: layers.clippedSamples,
      regrid,
    });
    mkdirSync(BLOB_DIR, { recursive: true });
    writeFileSync(join(BLOB_DIR, `${entries.currentHash}.bin`), layers.payload);
    writeFileSync(join(BLOB_DIR, `${entries.coastalHash}.bin`), mask.payload);

    // Fasit-punkter (spec §5): kun de som ligger i denne flisen, første tidssteg med data.
    const firstK = sourceTimeIndex.findIndex((t) => t !== undefined);
    const firstT = sourceTimeIndex[firstK];
    const epochS = args.t0S + firstK * args.dtS;
    const fasit: CurrentFasitReport[] = CURRENT_FASIT_POINTS.filter(
      (p) => p.lat >= bounds.south && p.lat <= bounds.north && p.lon >= bounds.west && p.lon <= bounds.east,
    ).map((p) => {
      const decoded = decodeCurrentFromPayload(layers.payload, p.lat, p.lon, epochS);
      const nn = nearestNativeSea(grid, sea, p.lat, p.lon);
      const nnSourceKn =
        nn === undefined || firstT === undefined
          ? null
          : {
              u: currentMsToKnots(decodeNorkystRaw(raw.uRaw[firstT * raw.nodeCount + nn.idx]!) ?? Number.NaN),
              v: currentMsToKnots(decodeNorkystRaw(raw.vRaw[firstT * raw.nodeCount + nn.idx]!) ?? Number.NaN),
            };
      return { ...p, epochS, decodedKn: decoded ?? null, nnSourceKn, nnDistanceM: nn?.distM ?? null };
    });
    for (const f of fasit) {
      console.log(
        `  Fasit ${f.name}: dekodet ${JSON.stringify(f.decodedKn)} vs NN-kilde ${JSON.stringify(f.nnSourceKn)} ` +
          `(nærmeste sjønode ${f.nnDistanceM === null ? "?" : f.nnDistanceM.toFixed(0)} m unna)`,
      );
    }

    const nearSeaFrac = (r: RegridResult): number => (r.stats.nearSea === 0 ? 0 : r.stats.nearSeaWithoutValue / r.stats.nearSea);
    const report: CurrentTileReport = {
      tileId: tileKey,
      window: w,
      nativeNodes: raw.nodeCount,
      nativeFillFraction: 1 - seaCount / raw.nodeCount,
      regularNodes: regrid.stats.nodes,
      matchedTimeSteps: matchedGlobal.length,
      nearSeaUndefinedFractionAtLimit1: nearSeaFrac(regridLimit1),
      nearSeaUndefinedFractionAtLimitSqrt2: nearSeaFrac(regrid),
      withValueAtLimit1: regridLimit1.stats.withValue,
      withValueAtLimitSqrt2: regrid.stats.withValue,
      extendedNodes: regrid.stats.extended,
      coastalFractionOfValued: regrid.stats.withValue === 0 ? 0 : regrid.stats.coastalWithValue / regrid.stats.withValue,
      maxDecodeErrorKn: layers.maxDecodeErrorKn,
      roundTrip,
      rawBytes: layers.payload.length + mask.payload.length,
      gzipBytes: gzipSync(layers.payload).length + gzipSync(mask.payload).length,
      fasit,
    };
    console.log(
      `  Regridding (grense √2=${COAST_EXTENSION_CELLS.toFixed(3)} celler): ${regrid.stats.withValue}/${regrid.stats.nodes} noder med verdi, ` +
        `${regrid.stats.extended} via forlengelse, kystmerket ${(report.coastalFractionOfValued * 100).toFixed(1)} %; ` +
        `sjønære uten verdi: ${(report.nearSeaUndefinedFractionAtLimit1 * 100).toFixed(1)} % (grense 1) / ` +
        `${(report.nearSeaUndefinedFractionAtLimitSqrt2 * 100).toFixed(1)} % (grense √2); ` +
        `gzip ${(report.gzipBytes / 1e6).toFixed(2)} MB`,
    );
    out.set(tileKey, { ok: true, entries: [entries.current, entries.coastal], report });
  }
  return out;
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
  console.log("=== weather-pack build-live-package — VIND + NorKyst-STRØM, EKTE THREDDS-data ===");
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

  const { verification: lccVerification, dasText } = await verifyLccProjection(run.datasetUrl, fetchImpl, userAgent);
  if (!lccVerification.ok) {
    for (const m of lccVerification.mismatches) console.error(`    - ${m}`);
    console.error(
      `Nektet: LCC-projeksjonsparametrene lest fra .das stemmer ikke med de hardkodede konstantene ` +
        `(lambert-rotation.ts::MEPS_LCC_PARAMS). Bygger IKKE en pakke med potensielt feil vindrotasjon.`,
    );
    process.exitCode = 1;
    return;
  }

  // §19 2026-09-29: fyll-/manglende-verdier for vindkomponentene fra samme .das.
  const windMissing = parseWindMissingValuesFromDas(dasText);
  console.log(`  Vindens fyllverdier fra .das: x_wind_10m=[${windMissing.x.join(", ")}], y_wind_10m=[${windMissing.y.join(", ")}]`);

  const gridCache = loadGridCache();
  const summaries: TileBuildSummary[] = [];
  for (const id of TARGET_TILES) {
    const summary = await buildTile(id, run, sourceStatus, windMissing, fetchImpl, userAgent, gridCache);
    summaries.push(summary);
  }

  const currentOutcomes = await buildCurrentTiles({
    tiles: TARGET_TILES,
    t0S: Date.parse(run.init) / 1000,
    dtS: TIME_STEP_H * 3600,
    timeCount: TIME_COUNT,
    producedAt: new Date().toISOString(),
    fetchImpl,
    userAgent,
  });

  console.log(`\n[6/6] Skriver peker...`);
  const tiles: PointerTileEntry[] = summaries.map((s) => {
    const current = currentOutcomes.get(s.tileId);
    return {
      tileId: s.tileId,
      bbox: s.bbox,
      fields: current?.ok === true ? [...s.fields, ...current.entries] : s.fields,
      missingFields: [
        // Utelatte vindmedlemmer (§19 2026-09-29): per medlem, så klienten kan telle nevneren.
        ...s.excludedWindMembers.map(
          (e): PointerMissingFieldEntry => ({
            field: "wind",
            member: e.member,
            sourceStatus: { status: "degraded", reason: e.reason },
          }),
        ),
        ...(current?.ok === true ? [] : [current?.missing ?? missingField("current", "NorKyst-strøm")]),
        missingField("waves", "Oceanforecast/WAM800-bølge"),
      ],
    };
  });
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
      certificateSample: s.certificateSample,
      windSourceStatus: s.windSourceStatus,
      excludedWindMembers: s.excludedWindMembers,
    })),
    totals: {
      rawBytesTotal: totalRaw,
      gzipNoDeltaTotalExtrapolated: totalGzipNoDelta,
      gzipDeltaTotal: totalGzipDelta,
      memberCount: MEMBER_COUNT,
      horizonH: HORIZON_H,
      timeStepH: TIME_STEP_H,
    },
    current: TARGET_TILES.map((id) => {
      const o = currentOutcomes.get(tileIdToString(id));
      return o?.ok === true ? o.report : { tileId: tileIdToString(id), missing: o?.missing.sourceStatus.reason ?? "ikke forsøkt" };
    }),
    missingFields: [
      ...TARGET_TILES.filter((id) => currentOutcomes.get(tileIdToString(id))?.ok !== true).map(
        (id) => `current (NorKyst) ${tileIdToString(id)}`,
      ),
      "waves (Oceanforecast/WAM800)",
    ],
  };
  writeFileSync(join(OUT_DIR, "build-report.json"), JSON.stringify(report, null, 2));

  console.log(`\n=== FERDIG ===`);
  console.log(`Kjøring: ${run.runName} (init ${run.init})`);
  for (const s of summaries) {
    if (s.excludedWindMembers.length > 0) {
      console.warn(
        `Flis ${s.tileId}: ${MEMBER_COUNT - s.excludedWindMembers.length} av ${MEMBER_COUNT} vindmedlemmer har data — utelatt ${s.excludedWindMembers.map((e) => e.member).join(", ")}`,
      );
    }
  }
  console.log(`Rått (alle fliser, ${MEMBER_COUNT} medlemmer, u+v): ${(totalRaw / 1e6).toFixed(2)} MB`);
  console.log(`Etter delta+gzip: ${(totalGzipDelta / 1e6).toFixed(2)} MB (faktor ${(totalRaw / totalGzipDelta).toFixed(2)}×)`);
  console.log(`Skrev pakke-blober til ${BLOB_DIR}, peker til ${join(OUT_DIR, "pointer-vaer-skandinavia.json")}`);
  console.log(`Fullstendig rapport: ${join(OUT_DIR, "build-report.json")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
