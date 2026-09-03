/**
 * GET /proxy/metalerts → proxy mot MET Alerts (F2.6), med riktig
 * User-Agent og korte-levetid-cache i Workerens Cache API
 * (docs/specs/vaerpakker.md §14/§16).
 *
 * MET-vilkårene (N3) krever identifiserende User-Agent og at mobilapper
 * ikke treffer api.met.no direkte — denne ruten ER den mekanismen kravet
 * peker på, ikke en implementasjonsdetalj.
 *
 * Betinget henting (review-funn 2026-09-03, docs/legal/met-norway-api.md
 * pkt. 3 / §16: «bruk If-Modified-Since/ETag der tilgjengelig»): når den
 * korte serveringscachen (`cacheKey`) er utløpt, skal vi IKKE gjøre en
 * ubetinget fetch — vi skal sende forrige ETag/Last-Modified og la MET
 * svare 304 hvis varslene ikke er endret. Cache API-oppføringen for
 * `cacheKey` respekterer selv `Cache-Control`/`Expires` (den blir borte
 * fra `cache.match` når TTL løper ut, se «How the Cache works»-dokumentet
 * fra Cloudflare) — den kan derfor ikke bære ETag-en forbi utløpstid.
 * Løsningen er en egen, langlevd bokføringsoppføring (`recordKey`) som
 * bærer siste kjente kropp + ETag/Last-Modified uavhengig av MET sin
 * faktiske ferskhetstid. `recordKey`s egen `Cache-Control` er internt
 * bokføringsformål, ALDRI det vi hevder til klienten — klientsvaret
 * arver alltid ferskhet fra MET sitt faktiske svar (200 eller 304).
 */
import type { Env } from "../env.js";
import { userAgentFor } from "../user-agent.js";

const METALERTS_URL = "https://api.met.no/weatherapi/metalerts/2.0/current.json";
/** Konservativ nedre grense hvis MET ikke selv sender cache-control. */
const FALLBACK_MAX_AGE_S = 300;
/**
 * Levetid for bokføringsoppføringen som bærer ETag/Last-Modified forbi
 * serveringscachens TTL. Lang, men ikke uendelig — MetAlerts er ikke
 * innholdsadressert (i motsetning til R2-blobene i blob.ts), så vi vil
 * ikke bære en flere måneder gammel ETag på ubestemt tid.
 */
const RECORD_MAX_AGE_S = 60 * 60 * 24 * 30;
/** Skiller bokføringsoppføringen fra den faktiske serveringscachen på samme URL. */
const RECORD_MARKER_PARAM = "__morild_revalidation_record";

function recordCacheKey(upstream: URL): Request {
  const recordUrl = new URL(upstream.toString());
  recordUrl.searchParams.set(RECORD_MARKER_PARAM, "1");
  return new Request(recordUrl.toString(), { method: "GET" });
}

function baseHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.set("access-control-allow-origin", "*");
  return headers;
}

export async function handleMetAlerts(
  requestUrl: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const upstream = new URL(METALERTS_URL);
  // Kun bbox videreføres — ingen generell query-passthrough mot et skjema
  // Workeren ikke eier.
  const bbox = requestUrl.searchParams.get("bbox");
  if (bbox) {
    upstream.searchParams.set("bbox", bbox);
  }

  const cache = caches.default;
  const cacheKey = new Request(upstream.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const recordKey = recordCacheKey(upstream);
  const record = await cache.match(recordKey);

  const requestHeaders: Record<string, string> = { "User-Agent": userAgentFor(env) };
  if (record) {
    const etag = record.headers.get("etag");
    const lastModified = record.headers.get("last-modified");
    if (etag) {
      requestHeaders["If-None-Match"] = etag;
    }
    if (lastModified) {
      requestHeaders["If-Modified-Since"] = lastModified;
    }
  }

  const upstreamResponse = await fetch(upstream.toString(), { headers: requestHeaders });

  if (upstreamResponse.status === 304 && record) {
    // Behold cachet body — MET bekrefter at varslene er uendret. Ta med
    // ev. nye ferskhetsheadere fra 304-svaret (MET kan forlenge levetiden
    // uten å sende ny kropp); fall tilbake til bokføringsoppføringens egne
    // headere, deretter FALLBACK_MAX_AGE_S.
    const headers = baseHeaders(record.headers);
    const freshCacheControl = upstreamResponse.headers.get("cache-control");
    const freshExpires = upstreamResponse.headers.get("expires");
    if (freshCacheControl) {
      headers.set("cache-control", freshCacheControl);
    } else if (!headers.has("cache-control")) {
      headers.set("cache-control", `public, max-age=${FALLBACK_MAX_AGE_S}`);
    }
    if (freshExpires) {
      headers.set("expires", freshExpires);
    }

    const forClient = record.clone();
    const forCacheKey = record.clone();
    const clientResponse = new Response(forClient.body, { status: 200, headers });
    const cacheEntry = new Response(forCacheKey.body, { status: 200, headers: new Headers(headers) });

    const recordHeaders = new Headers(headers);
    recordHeaders.set("cache-control", `public, max-age=${RECORD_MAX_AGE_S}`);
    const recordEntry = new Response(record.body, { status: 200, headers: recordHeaders });

    ctx.waitUntil(
      Promise.all([cache.put(cacheKey, cacheEntry), cache.put(recordKey, recordEntry)]),
    );
    return clientResponse;
  }

  const headers = baseHeaders(upstreamResponse.headers);
  // §16: "respekter Expires" — vi setter kun en nedre cache-grense hvis MET
  // ikke selv sender en; vi finner aldri på en lengre enn opphavet ba om.
  if (!headers.has("cache-control")) {
    headers.set("cache-control", `public, max-age=${FALLBACK_MAX_AGE_S}`);
  }

  const response = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
  if (upstreamResponse.ok) {
    const forCacheKey = response.clone();
    const forRecordKey = response.clone();
    const recordHeaders = new Headers(headers);
    recordHeaders.set("cache-control", `public, max-age=${RECORD_MAX_AGE_S}`);
    const recordEntry = new Response(forRecordKey.body, { status: 200, headers: recordHeaders });
    ctx.waitUntil(
      Promise.all([cache.put(cacheKey, forCacheKey), cache.put(recordKey, recordEntry)]),
    );
  }
  return response;
}
