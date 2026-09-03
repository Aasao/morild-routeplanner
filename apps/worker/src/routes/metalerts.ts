/**
 * GET /proxy/metalerts → proxy mot MET Alerts (F2.6), med riktig
 * User-Agent og korte-levetid-cache i Workerens Cache API
 * (docs/specs/vaerpakker.md §14/§16).
 *
 * MET-vilkårene (N3) krever identifiserende User-Agent og at mobilapper
 * ikke treffer api.met.no direkte — denne ruten ER den mekanismen kravet
 * peker på, ikke en implementasjonsdetalj.
 *
 * **D2 (ADR-0006 pkt. 4, 2026-09-03): ingen `bbox`-passthrough.** Tidligere
 * versjon videreførte en klientstyrt `bbox`-parameter til MET, som i praksis
 * er en klientstyrt cache-buster (hver unik bbox er en egen cache-nøkkel,
 * og en app som "shifter" bbox-en litt for hvert kall — f.eks. basert på
 * kartutsnitt — kan umerkelig omgå TTL-cachingen og treffe MET langt
 * oftere enn tiltenkt). Proxyen henter nå ALLTID hele Skandinavia-settet
 * (samme URL, ingen query-parametre), én gang per TTL uansett hvor mange
 * klienter/kartutsnitt som spør. **Filtrering til synlig kartutsnitt skjer
 * i klienten** (`apps/pwa`) på det fulle, ufiltrerte GeoJSON-svaret.
 *
 * **Responskontrakt (til pwa-agenten):** kroppen er MET sitt
 * `current.json`-format UENDRET (samme skjema som før — proxyen tolker
 * aldri innholdet, kun cacher/videresender det, jf. ADR-0002). To ekstra
 * svar-headere er lagt til, begge lesbare fra `fetch()`-klienten:
 * - `fetched-at`: ISO 8601-tidsstempel for når INNHOLDET sist ble bekreftet
 *   gyldig mot MET (enten en fersk 200 eller en 304-revalidering) — IKKE
 *   "nå" for hver respons. Dette er selve alderen appen skal vise
 *   (CLAUDE.md §"Offline er normaltilstand": "si tydelig hvor gamle de
 *   er"), ikke et estimat klienten må regne ut selv fra `cache-control`.
 * - `source-status`: `"ok"` i denne bølgen. Reservert verdi `"degraded"` for
 *   en fremtidig bølge som legger til fallback ved MET-utilgjengelighet
 *   (§12-mønsteret i vaerpakker.md) — **ikke implementert ennå, dokumentert
 *   som kjent gap, ikke stille utelatt**: i dag propagerer en MET-feil
 *   (nettverksfeil, 5xx) som et kastet unntak/ikke-`ok`-svar helt til
 *   klienten i stedet for å falle tilbake til `record`-oppføringen under.
 *
 * **Misbruksvern (D2/ADR-0006 pkt. 4):** én Cloudflare rate-limit-regel
 * (`env.METALERTS_RATE_LIMITER`, wrangler.toml `[[ratelimits]]`) foran HELE
 * ruten, nøklet på en FAST streng — dette er aggregert vern for hele
 * appen/identiteten (slik MET selv rammer sin 20 req/s-regel: «per
 * applikasjon»), ikke per-klient-throttling. Bindingen er valgfri i
 * `Env`-kontrakten: mangler den (typisk lokal `wrangler dev` uten ekte
 * ratelimit-infrastruktur, se rapport til Magnus), fungerer proxyen
 * fortsatt, bare uten håndhevelsen — ærlig degradering fremfor å late som
 * en grense vi ikke har.
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
/** Fast nøkkel — aggregert rate-limit for hele appen, ikke per klient. */
const RATE_LIMIT_KEY = "metalerts-proxy";
const FETCHED_AT_HEADER = "fetched-at";
const SOURCE_STATUS_HEADER = "source-status";

function recordCacheKey(upstream: URL): Request {
  const recordUrl = new URL(upstream.toString());
  recordUrl.searchParams.set(RECORD_MARKER_PARAM, "1");
  return new Request(recordUrl.toString(), { method: "GET" });
}

function tooManyRequests(): Response {
  // 429, ikke en generell feil — appens fetch-feilhåndtering (app-skjelett.md
  // §5.5/§7) er allerede bygget for å tolke 429 som "prøv cache", akkurat
  // som en ekte MET-blokkering ville gitt.
  return new Response(JSON.stringify({ error: "For mange forespørsler mot MetAlerts-proxyen" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": "10",
    },
  });
}

/** Kopi av headerne — ingen CORS-logikk her; det er `cors.ts`s ene ansvar (ADR-0006 pkt. 3). */
function cloneHeaders(source: Headers): Headers {
  return new Headers(source);
}

function stampFreshness(headers: Headers, fetchedAt: string): Headers {
  headers.set(FETCHED_AT_HEADER, fetchedAt);
  headers.set(SOURCE_STATUS_HEADER, "ok");
  return headers;
}

export async function handleMetAlerts(
  request: Request,
  env: Pick<Env, "MET_USER_AGENT" | "METALERTS_RATE_LIMITER">,
  ctx: ExecutionContext,
): Promise<Response> {
  if (env.METALERTS_RATE_LIMITER) {
    const { success } = await env.METALERTS_RATE_LIMITER.limit({ key: RATE_LIMIT_KEY });
    if (!success) {
      return tooManyRequests();
    }
  }
  // else: ingen ratelimit-binding tilgjengelig i dette miljøet (typisk
  // lokal `wrangler dev`) — proxyen fungerer likevel, se filens
  // toppkommentar om ærlig degradering.

  // D2: ingen query-parametre videreføres — se filens toppkommentar.
  const upstream = new URL(METALERTS_URL);

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
  const revalidatedAt = new Date().toISOString();

  if (upstreamResponse.status === 304 && record) {
    // Behold cachet body — MET bekrefter at varslene er uendret. Ta med
    // ev. nye ferskhetsheadere fra 304-svaret (MET kan forlenge levetiden
    // uten å sende ny kropp); fall tilbake til bokføringsoppføringens egne
    // headere, deretter FALLBACK_MAX_AGE_S. `fetched-at` oppdateres til NÅ
    // — vi har nettopp bekreftet mot MET at innholdet fortsatt er gyldig.
    const headers = stampFreshness(cloneHeaders(record.headers), revalidatedAt);
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

  const headers = stampFreshness(cloneHeaders(upstreamResponse.headers), revalidatedAt);
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
