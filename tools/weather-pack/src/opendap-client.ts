/**
 * OPeNDAP-subsetting-klient (`docs/specs/vaerpakker.md` §7, grunnlag
 * `docs/research/spike-thredds.md`).
 *
 * Tre ting spesifikt låst av spec/spike og implementert her:
 * 1. Grid-indeksoppslag caches PERMANENT per datasett+projeksjon
 *    (§7 punkt 1) — ikke beregnes på nytt per kjøring (spike-funn 7: et
 *    unødvendig re-oppslag kostet 17,75 MB).
 * 2. Alle 30 MEPS-medlemmer hentes i ETT OPeNDAP-kall per variabel
 *    (§7 punkt 2, spike-funn 6).
 * 3. Subsetting går UTELUKKENDE via OPeNDAP index-range (`.dods`), aldri
 *    NCSS (§7 punkt 4 — NCSS var nede under hele spiken).
 *
 * Ingen ekte HTTP-kall skjer fra denne fila i seg selv — `fetchImpl`
 * injiseres alltid, slik at retry/backoff-logikken er testbar uten nettverk
 * og uten timere (se `opendap-client.test.ts`). `cli.ts` er eneste stedet
 * som binder `fetchImpl` til det globale `fetch` og bare gjør det bak
 * `--live` + legal-gate (§16, `legal-gate.ts`).
 */
import type { IndexWindow } from "./grid.js";

/** Et enkelt-dimensjons OPeNDAP-indeksuttrykk `[start:stride:stop]`. */
export interface DimRange {
  readonly start: number;
  readonly stop: number;
  readonly stride?: number;
}

/** Bygger `.dods`-spørrestrengen for én variabel med gitte dimensjonsvinduer, i rekkefølge. */
export function buildIndexRangeQuery(variable: string, dims: readonly DimRange[]): string {
  const parts = dims.map((d) => `[${d.start}:${d.stride ?? 1}:${d.stop}]`).join("");
  return `${variable}${parts}`;
}

/**
 * Full `.dods`-URL for én variabel. Encoding-mønsteret er identisk med
 * `tools/spikes/thredds`s verifiserte skript (kun komma avkodes tilbake —
 * `[`, `]`, `:` forblir prosent-kodet, som THREDDS-instansen ble bekreftet å
 * godta i spiken).
 */
export function buildDodsUrl(datasetUrl: string, variable: string, dims: readonly DimRange[]): string {
  const query = buildIndexRangeQuery(variable, dims);
  return `${datasetUrl}.dods?${encodeURIComponent(query).replace(/%2C/g, ",")}`;
}

/**
 * §7 punkt 2: alle 30 MEPS-medlemmer i ETT kall — bygger medlem-dimensjonen
 * som ett sammenhengende `[0:1:29]`-vindu i stedet for 30 separate URL-er.
 * `memberDimIndex` er hvilken posisjon i `dims`-lista medlemsaksen har
 * (MEPS: `[time][height][member][y][x]`, altså indeks 2).
 */
export function buildAllMembersDodsUrl(
  datasetUrl: string,
  variable: string,
  dims: readonly DimRange[],
  memberDimIndex: number,
  memberCount: number,
): string {
  const withMembers = dims.map((d, i) =>
    i === memberDimIndex ? { start: 0, stop: memberCount - 1, stride: 1 } : d,
  );
  return buildDodsUrl(datasetUrl, variable, withMembers);
}

/** Konverterer et `IndexWindow` (grid.ts) til y/x-`DimRange`-par. */
export function windowToDimRanges(window: IndexWindow): { readonly y: DimRange; readonly x: DimRange } {
  return {
    y: { start: window.yStart, stop: window.yEnd },
    x: { start: window.xStart, stop: window.xEnd },
  };
}

// --- Grid-indeks-cache (§7 punkt 1) -----------------------------------------

export interface GridIndexCacheEntry {
  readonly datasetKey: string;
  readonly bbox: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
  readonly window: IndexWindow;
  readonly cachedAt: string;
}

export type GridIndexCache = Record<string, GridIndexCacheEntry>;

export function emptyGridIndexCache(): GridIndexCache {
  return {};
}

function cacheKey(datasetKey: string, bbox: GridIndexCacheEntry["bbox"]): string {
  return `${datasetKey}|${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
}

/**
 * Slår opp indeksvinduet for `(datasetKey, bbox)` i cachen; finnes det ikke,
 * kaller `probe(bbox)` (den faktiske, dyre OPeNDAP-sonderingen) ÉN gang og
 * lagrer resultatet. Selve cache-PERSISTERINGEN til disk (§7 punkt 1: skal
 * være permanent på tvers av kjøringer) er kallerens ansvar (`loadCacheFile`/
 * `saveCacheFile` i `pipeline.ts` eller `cli.ts`) — denne funksjonen er en
 * ren in-memory-oppslagsregel, testbar uten filsystem.
 */
export async function resolveIndexWindow(
  cache: GridIndexCache,
  datasetKey: string,
  bbox: GridIndexCacheEntry["bbox"],
  probe: (bbox: GridIndexCacheEntry["bbox"]) => Promise<IndexWindow>,
): Promise<{ readonly window: IndexWindow; readonly cache: GridIndexCache; readonly wasCached: boolean }> {
  const key = cacheKey(datasetKey, bbox);
  const existing = cache[key];
  if (existing) {
    return { window: existing.window, cache, wasCached: true };
  }
  const window = await probe(bbox);
  const entry: GridIndexCacheEntry = { datasetKey, bbox, window, cachedAt: new Date().toISOString() };
  return { window, cache: { ...cache, [key]: entry }, wasCached: false };
}

// --- Retry/backoff (§16 — N3/N4) --------------------------------------------

export interface FetchLike {
  (url: string, init?: { readonly headers?: Record<string, string> }): Promise<{
    readonly status: number;
    readonly ok: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
}

export interface BackoffOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryableStatuses: readonly number[];
  /** Injisert forsinkelsesfunksjon — aldri ekte timere i tester. */
  readonly sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  retryableStatuses: [429, 503],
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface BackoffResult {
  readonly buffer: ArrayBuffer;
  readonly attempts: number;
}

/**
 * §16: eksponentiell backoff med tak ved 429/503 — IKKE umiddelbar
 * retry-løkke (spiken observerte 503 på NCSS gjennomgående; en pipeline som
 * slår hardt tilbake mot en nede tjeneste er dårlig medborgerskap).
 * Ikke-retrybare statuskoder (f.eks. 404) kaster umiddelbart.
 */
export async function fetchWithBackoff(
  url: string,
  userAgent: string,
  fetchImpl: FetchLike,
  options: BackoffOptions = DEFAULT_BACKOFF,
): Promise<BackoffResult> {
  let attempt = 0;
  let lastStatus: number | undefined;
  while (attempt < options.maxAttempts) {
    attempt++;
    const res = await fetchImpl(url, { headers: { "User-Agent": userAgent } });
    if (res.ok) {
      return { buffer: await res.arrayBuffer(), attempts: attempt };
    }
    lastStatus = res.status;
    if (!options.retryableStatuses.includes(res.status)) {
      throw new Error(`OPeNDAP-kall feilet med ikke-retrybar status ${res.status}: ${url}`);
    }
    if (attempt >= options.maxAttempts) break;
    const delay = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
    await options.sleep(delay);
  }
  throw new Error(
    `OPeNDAP-kall feilet etter ${attempt} forsøk (siste status ${lastStatus}): ${url}`,
  );
}

/** Obligatorisk, identifiserende User-Agent (§16) — aldri en generisk/tom streng. */
export function buildUserAgent(version: string, contactEmail: string): string {
  return `morild-routeplanner/${version} ${contactEmail}`;
}
