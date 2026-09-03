/**
 * GET /blob/:key → proxy for et innholdsadressert R2-objekt.
 *
 * `:key` er hele R2-nøkkelen slik pekeren oppgir den (f.eks.
 * "weather/1/ab12cd….bin"), ikke bare hashen — det er pekerens jobb å vite
 * hvilken pakketype/major en gitt hash hører til
 * (docs/specs/vaerpakker.md §5), ikke Workerens. Workeren håndhever bare at
 * nøkkelen ligger under et av de kjente, trygge prefiksene, slik at denne
 * ruten ikke blir en åpen R2-utforsker.
 *
 * ADR-0006 pkt. 2: `env.MIRROR_BUCKET` er STRUKTURELT den eneste bindingen
 * denne filen kan importere data fra — `env.PERSONAL_DB` finnes ikke i
 * denne modulens type-signatur i det hele tatt (se `handleBlob`s
 * `Pick<Env, "MIRROR_BUCKET">`), så en fremtidig utvider kan ikke ved et
 * uhell lese personlige data herfra ved bare å utvide `ALLOWED_BLOB_PREFIXES`.
 */
import type { Env } from "../env.js";

export const ALLOWED_BLOB_PREFIXES = ["weather/", "charts/"] as const;

export function isAllowedBlobKey(key: string): boolean {
  if (key.length === 0 || key.includes("..")) {
    return false;
  }
  return ALLOWED_BLOB_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Samme tomme-kropp-form som et ekte R2-miss — se kommentaren i `handleBlob`. */
function notFound(): Response {
  return new Response(null, { status: 404 });
}

export async function handleBlob(
  key: string,
  env: Pick<Env, "MIRROR_BUCKET">,
  request: Request,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  if (!isAllowedBlobKey(key)) {
    // ADR-0006 Bekreftelse: en nøkkel utenfor de tillatte prefiksene (f.eks.
    // en fremtidig "routes/"-personlig-nøkkel) skal gi 404 — IKKE 400 med en
    // forklarende feilmelding. En 400 som sier "utenfor tillatt prefiks"
    // avslører at det finnes et annet, filtrert lag bak samme rute; en 404
    // som er identisk med et ekte R2-miss avslører strukturelt ingenting om
    // hvorvidt "routes/…" betyr noe i det hele tatt.
    return notFound();
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });

  // Review-funn: edge-cache (`caches.default`) foran R2-oppslaget.
  // Innholdet er innholdsadressert og immutable (vaerpakker.md §5) — en
  // ekstra cache-lag her er trygt (samme nøkkel kan aldri peke på annet
  // innhold) og sparer en R2-tur for gjentatte oppslag av samme populære
  // blob. Betingede forespørsler (klienten har alt en kopi og sender
  // `if-none-match`) går uansett til R2 under, som er fasit for 304 vs 200
  // — edge-cachen er et rent ytelseslag, ikke en egen kilde til sannhet.
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifNoneMatch) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const object = await env.MIRROR_BUCKET.get(
    key,
    ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch } } : undefined,
  );
  if (object === null) {
    return notFound();
  }
  if (!("body" in object) || object.body === null) {
    // onlyIf-betingelsen traff: objektet finnes, men klienten har det alt.
    return new Response(null, { status: 304, headers: { etag: object.httpEtag } });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Innholdsadressert og uforanderlig (vaerpakker.md §5) — trygt å cache
  // permanent, både i klienten og i edge-cachen over.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  const response = new Response(object.body, { status: 200, headers });

  if (!ifNoneMatch) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}
