/**
 * GET /proxy/oceanforecast?points=lat,lon;lat,lon;… → punktbølge fra MET
 * Oceanforecast 2.0 (`docs/specs/punktbolge.md` §3, ADR-0007), som ÉN samlet
 * payload `WavePointSet` (`"morild-punktbolge/1"`).
 *
 * Samme mønster som `metalerts.ts`: identifiserende `User-Agent` (N3),
 * Workerens Cache API, betinget henting (`If-Modified-Since`) og en valgfri
 * rate-limit-binding foran hele ruten (ærlig degradering uten binding).
 *
 * **Tolking, ikke bare videresending.** Til forskjell fra MetAlerts (der
 * kroppen går uendret gjennom) oversetter proxyen hvert punkts MET-svar til
 * `{epochS, hsM, fromDeg}` — klienten skal fryse ÉN liten, hash-bar
 * struktur per kjøring (fryseregelen), ikke 20–50 GeoJSON-dokumenter.
 * Ingen interpolasjon eller utfylling skjer her: manglende verdi ⇒ `null`.
 *
 * **Delforespørsels-budsjettet styrer cache-formen.** Cloudflares gratisplan
 * tillater 50 delforespørsler per kall, og Cache API-kall deler kvoten
 * (developers.cloudflare.com/workers/platform/limits, lest 2026-09-29).
 * `metalerts.ts`' to oppføringer (servering + bokføring) per URL ville gitt
 * opptil 4 kall per punkt. Her er det derfor ÉN bokføringsoppføring for
 * HELE punktlisten (nøkkel = SHA-256 av den kanoniske listen), med hvert
 * punkts siste svar, `Last-Modified` og METs `Expires`:
 * 1 cache-oppslag + ≤ 1 MET-kall per punkt + 1 cache-skriving ≤ 50 ved
 * `WAVE_POINTS_MAX = 48`. Ferske punkter (METs `Expires` ikke passert)
 * hentes ikke på nytt; utløpte revalideres betinget.
 *
 * **Feilet punkt** (nettverk, HTTP-feil, uleselig svar) står med tom
 * `times` og `status: "feilet"`, og teller i `sourceStatus` — aldri utelatt
 * i stillhet (spec §3). Punkt der MET svarer «no data at the given
 * location» (land) står som `"ingen-data"`: MET feilet ikke, men punktet har
 * ingen bølge.
 *
 * **Kjent risiko (rapportert):** et kaldt kall parser opptil 48 (Skjæløy–Skagen: 34) MET-svar à ~45 kB
 * JSON. Gratisplanens CPU-grense (10 ms) kan da bli trang; varme kall (ferske
 * punkter eller 304) parser bare bokføringsoppføringen.
 */
import type { Env } from "../env.js";
import { userAgentFor } from "../user-agent.js";

const OCEANFORECAST_URL = "https://api.met.no/weatherapi/oceanforecast/2.0/complete";

/**
 * Strukturell kopi av `@morild/weather`s `WAVE_POINTS_MAX` og wire-typene i
 * `packages/weather/src/wave-points.ts` — Workeren avhenger bevisst ikke av
 * workspace-pakkene. Hold dem i synk manuelt.
 */
export const WAVE_POINTS_MAX = 48;
export const WAVE_POINT_SET_SCHEMA = "morild-punktbolge/1" as const;

export interface WavePointTime {
  readonly epochS: number;
  readonly hsM: number | null;
  readonly fromDeg: number | null;
}

export type WavePointStatus = "ok" | "ingen-data" | "feilet";

export interface WavePoint {
  readonly lat: number;
  readonly lon: number;
  readonly sourceLat: number | null;
  readonly sourceLon: number | null;
  readonly status: WavePointStatus;
  readonly times: readonly WavePointTime[];
}

export interface WavePointSet {
  readonly schema: typeof WAVE_POINT_SET_SCHEMA;
  readonly fetchedAtEpochS: number;
  readonly points: readonly WavePoint[];
  readonly sourceStatus: "ok" | "degraded" | "failed";
  readonly sourceReason: string | null;
  readonly hash: string;
}

/**
 * Misbruksvern: kun punkter i et romslig område rundt Skandinavia
 * (kartområdet, CLAUDE.md). Oceanforecast dekker Nordsjøen/Skagerrak/
 * Norskehavet; utenfor gir MET uansett «no data».
 */
const BOUNDS = { south: 50, north: 75, west: -15, east: 40 } as const;
/** Konservativ ferskhet når MET ikke sender `Expires` (METs egne svar har ~30 min). */
const FALLBACK_MAX_AGE_S = 1800;
/** Bokføringsoppføringens levetid i Cache API — intern, aldri det klienten ser. */
const RECORD_MAX_AGE_S = 60 * 60 * 24 * 30;
const RECORD_MARKER_PARAM = "__morild_point_set";
const RECORD_VERSION = 1;
/** Fast nøkkel — aggregert vern for hele appen, som `metalerts.ts`. */
const RATE_LIMIT_KEY = "oceanforecast-proxy";
/**
 * Samtidige MET-kall. 2 × ~150 ms ⇒ ~13 kall/s, godt under METs 20 req/s
 * per applikasjon (docs/legal/met-norway-api.md).
 */
const MET_CONCURRENCY = 2;

interface RecordPoint extends WavePoint {
  readonly lastModified: string | null;
  readonly expiresEpochS: number;
  readonly confirmedAtEpochS: number;
}

interface PointSetRecord {
  readonly version: typeof RECORD_VERSION;
  readonly points: readonly RecordPoint[];
}

export interface OceanForecastDeps {
  /** Injiserbar klokke (tester); standard `Date.now()`. */
  readonly nowMs?: () => number;
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

function badRequest(message: string): Response {
  return jsonResponse({ error: message }, 400);
}

function tooManyRequests(): Response {
  return jsonResponse({ error: "For mange forespørsler mot Oceanforecast-proxyen" }, 429, { "retry-after": "30" });
}

/** 4 desimaler (MET-vilkårene, docs/legal/met-norway-api.md). */
export function round4(v: number): number {
  return Number(v.toFixed(4));
}

/**
 * Leser `points=lat,lon;lat,lon;…`. Koordinatene avrundes til 4 desimaler
 * FØR noe annet (cache-nøkkel, MET-URL og svar bruker samme verdi).
 */
export function parsePointsParam(raw: string | null): { readonly lat: number; readonly lon: number }[] | string {
  if (raw === null || raw.trim() === "") return "mangler points=lat,lon;lat,lon";
  const parts = raw.split(";").filter((p) => p.trim() !== "");
  if (parts.length === 0) return "tom punktliste";
  if (parts.length > WAVE_POINTS_MAX) return `for mange punkter (${parts.length} > ${WAVE_POINTS_MAX})`;
  const out: { lat: number; lon: number }[] = [];
  for (const part of parts) {
    const [latText, lonText, extra] = part.split(",");
    if (latText === undefined || lonText === undefined || extra !== undefined) return `ugyldig punkt «${part}»`;
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return `ugyldig punkt «${part}»`;
    if (lat < BOUNDS.south || lat > BOUNDS.north || lon < BOUNDS.west || lon > BOUNDS.east) {
      return `punkt utenfor dekningsområdet «${part}»`;
    }
    out.push({ lat: round4(lat), lon: round4(lon) });
  }
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalPointList(points: readonly { readonly lat: number; readonly lon: number }[]): string {
  return points.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(";");
}

function recordKeyFor(listHash: string): Request {
  const url = new URL(OCEANFORECAST_URL);
  url.searchParams.set(RECORD_MARKER_PARAM, listHash);
  return new Request(url.toString(), { method: "GET" });
}

function metUrl(p: { readonly lat: number; readonly lon: number }): string {
  return `${OCEANFORECAST_URL}?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`;
}

function expiresFrom(headers: Headers, nowS: number): number {
  const raw = headers.get("expires");
  const parsed = raw === null ? Number.NaN : Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : nowS + FALLBACK_MAX_AGE_S;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * METs GeoJSON → tidsserie. Uleselig form kaster (⇒ punktet feiler).
 * `meta.error` eller tom tidsserie ⇒ `"ingen-data"` (målt 2026-09-29 på
 * et landpunkt: 200 med `"no data at the given location"`).
 */
export function parseMetOceanForecast(body: unknown): Pick<WavePoint, "sourceLat" | "sourceLon" | "status" | "times"> {
  if (typeof body !== "object" || body === null) throw new Error("svaret er ikke et objekt");
  const b = body as { geometry?: { coordinates?: unknown }; properties?: { meta?: { error?: unknown }; timeseries?: unknown } };
  const coords = b.geometry?.coordinates;
  const sourceLon = Array.isArray(coords) ? numberOrNull(coords[0]) : null;
  const sourceLat = Array.isArray(coords) ? numberOrNull(coords[1]) : null;
  const series = b.properties?.timeseries;
  if (!Array.isArray(series)) throw new Error("properties.timeseries mangler");
  if (b.properties?.meta?.error !== undefined || series.length === 0) {
    return { sourceLat, sourceLon, status: "ingen-data", times: [] };
  }
  const times: WavePointTime[] = [];
  let prev = -Infinity;
  for (const entry of series as unknown[]) {
    const e = entry as { time?: unknown; data?: { instant?: { details?: Record<string, unknown> } } };
    const t = typeof e.time === "string" ? Date.parse(e.time) : Number.NaN;
    if (!Number.isFinite(t)) throw new Error("tidssteg uten gyldig time");
    const epochS = Math.floor(t / 1000);
    if (epochS <= prev) continue; // aldri to verdier for samme tid; MET er stigende
    prev = epochS;
    const d = e.data?.instant?.details ?? {};
    times.push({
      epochS,
      hsM: numberOrNull(d["sea_surface_wave_height"]),
      fromDeg: numberOrNull(d["sea_surface_wave_from_direction"]),
    });
  }
  return { sourceLat, sourceLon, status: "ok", times };
}

function failedPoint(p: { readonly lat: number; readonly lon: number }): WavePoint {
  return { lat: p.lat, lon: p.lon, sourceLat: null, sourceLon: null, status: "feilet", times: [] };
}

interface PointOutcome {
  readonly point: WavePoint;
  /** Hva bokføringen skal huske (feilet punkt overskriver aldri et tidligere godt svar). */
  readonly record: RecordPoint | null;
  readonly fetched: boolean;
  readonly failureReason: string | null;
}

async function resolvePoint(
  p: { readonly lat: number; readonly lon: number },
  prev: RecordPoint | undefined,
  env: Pick<Env, "MET_USER_AGENT">,
  nowS: number,
): Promise<PointOutcome> {
  const usablePrev = prev !== undefined && prev.status !== "feilet" ? prev : undefined;
  if (usablePrev !== undefined && usablePrev.expiresEpochS > nowS) {
    return { point: stripRecord(usablePrev), record: usablePrev, fetched: false, failureReason: null };
  }
  const headers: Record<string, string> = { "User-Agent": userAgentFor(env) };
  if (usablePrev?.lastModified) headers["If-Modified-Since"] = usablePrev.lastModified;
  try {
    const res = await fetch(metUrl(p), { headers });
    if (res.status === 304 && usablePrev !== undefined) {
      const record: RecordPoint = { ...usablePrev, expiresEpochS: expiresFrom(res.headers, nowS), confirmedAtEpochS: nowS };
      return { point: stripRecord(record), record, fetched: true, failureReason: null };
    }
    if (!res.ok) {
      return { point: failedPoint(p), record: prev ?? null, fetched: true, failureReason: `HTTP ${res.status}` };
    }
    const parsed = parseMetOceanForecast(await res.json());
    const record: RecordPoint = {
      lat: p.lat,
      lon: p.lon,
      ...parsed,
      lastModified: res.headers.get("last-modified"),
      expiresEpochS: expiresFrom(res.headers, nowS),
      confirmedAtEpochS: nowS,
    };
    return { point: stripRecord(record), record, fetched: true, failureReason: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { point: failedPoint(p), record: prev ?? null, fetched: true, failureReason: message };
  }
}

/** Kanonisk nøkkelrekkefølge — `hash` regnes over nøyaktig denne formen. */
function stripRecord(r: WavePoint): WavePoint {
  return {
    lat: r.lat,
    lon: r.lon,
    sourceLat: r.sourceLat,
    sourceLon: r.sourceLon,
    status: r.status,
    times: r.times.map((t) => ({ epochS: t.epochS, hsM: t.hsM, fromDeg: t.fromDeg })),
  };
}

async function readRecord(cache: Cache, key: Request): Promise<PointSetRecord | undefined> {
  const hit = await cache.match(key);
  if (!hit) return undefined;
  try {
    const parsed = (await hit.json()) as PointSetRecord;
    return parsed.version === RECORD_VERSION && Array.isArray(parsed.points) ? parsed : undefined;
  } catch {
    return undefined; // uleselig bokføring ⇒ som om den ikke fantes (alt hentes på nytt)
  }
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      if (i >= items.length) return;
      next += 1;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function handleOceanForecast(
  request: Request,
  env: Pick<Env, "MET_USER_AGENT" | "OCEANFORECAST_RATE_LIMITER">,
  ctx: ExecutionContext,
  deps: OceanForecastDeps = {},
): Promise<Response> {
  const points = parsePointsParam(new URL(request.url).searchParams.get("points"));
  if (typeof points === "string") return badRequest(points);

  if (env.OCEANFORECAST_RATE_LIMITER) {
    const { success } = await env.OCEANFORECAST_RATE_LIMITER.limit({ key: RATE_LIMIT_KEY });
    if (!success) return tooManyRequests();
  }
  // else: ingen binding (lokal `wrangler dev`) — ærlig degradering som metalerts.

  const nowS = Math.floor((deps.nowMs ?? Date.now)() / 1000);
  const cache = caches.default;
  const recordKey = recordKeyFor(await sha256Hex(canonicalPointList(points)));
  const record = await readRecord(cache, recordKey);

  const outcomes = await mapWithConcurrency(points, MET_CONCURRENCY, (p, i) => {
    const prev = record?.points[i];
    // Bokføringen er nøklet på hele listen, men sjekk posisjonen likevel —
    // en feil-indeksert oppføring skal aldri gi et annet punkts bølge.
    const samePlace = prev !== undefined && prev.lat === p.lat && prev.lon === p.lon ? prev : undefined;
    return resolvePoint(p, samePlace, env, nowS);
  });

  const outPoints = outcomes.map((o) => o.point);
  const failed = outcomes.filter((o) => o.point.status === "feilet");
  const sourceStatus: WavePointSet["sourceStatus"] =
    failed.length === 0 ? "ok" : failed.length === outcomes.length ? "failed" : "degraded";
  const sourceReason =
    failed.length === 0
      ? null
      : `${failed.length} av ${outcomes.length} punkter feilet hos MET (${failed[0]!.failureReason ?? "ukjent"})`;
  const confirmed = outcomes
    .filter((o) => o.point.status !== "feilet" && o.record !== null)
    .map((o) => o.record!.confirmedAtEpochS);
  const fetchedAtEpochS = confirmed.length > 0 ? Math.min(...confirmed) : nowS;

  const body: WavePointSet = {
    schema: WAVE_POINT_SET_SCHEMA,
    fetchedAtEpochS,
    points: outPoints,
    sourceStatus,
    sourceReason,
    hash: await sha256Hex(JSON.stringify(outPoints)),
  };

  if (outcomes.some((o) => o.fetched)) {
    const recordPoints = outcomes.map((o, i) => o.record ?? { ...failedPoint(points[i]!), lastModified: null, expiresEpochS: 0, confirmedAtEpochS: 0 });
    const entry = new Response(JSON.stringify({ version: RECORD_VERSION, points: recordPoints } satisfies PointSetRecord), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${RECORD_MAX_AGE_S}` },
    });
    ctx.waitUntil(cache.put(recordKey, entry));
  }

  return jsonResponse(body, 200, {
    // Klienten bufrer selv (siste vellykkede per korridor); nettleserens
    // HTTP-cache skal ikke gi et gammelt sett uten at klienten vet det.
    "cache-control": "no-store",
    "fetched-at": new Date(fetchedAtEpochS * 1000).toISOString(),
    "source-status": sourceStatus,
  });
}
