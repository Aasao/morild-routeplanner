/**
 * GET /blob/:key → proxy for et innholdsadressert R2-objekt.
 *
 * `:key` er hele R2-nøkkelen slik pekeren oppgir den (f.eks.
 * "weather/1/ab12cd….bin"), ikke bare hashen — det er pekerens jobb å vite
 * hvilken pakketype/major en gitt hash hører til
 * (docs/specs/vaerpakker.md §5), ikke Workerens. Workeren håndhever bare at
 * nøkkelen ligger under et av de kjente, trygge prefiksene, slik at denne
 * ruten ikke blir en åpen R2-utforsker.
 */
import type { Env } from "../env.js";

export const ALLOWED_BLOB_PREFIXES = ["weather/", "charts/"] as const;

export function isAllowedBlobKey(key: string): boolean {
  if (key.length === 0 || key.includes("..")) {
    return false;
  }
  return ALLOWED_BLOB_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export async function handleBlob(
  key: string,
  env: Env,
  request: Request,
): Promise<Response> {
  if (!isAllowedBlobKey(key)) {
    return new Response(
      JSON.stringify({ error: `Nøkkel utenfor tillatt prefiks: "${key}"` }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  const object = await env.DATA_BUCKET.get(
    key,
    ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch } } : undefined,
  );
  if (object === null) {
    return new Response(null, { status: 404 });
  }
  if (!("body" in object) || object.body === null) {
    // onlyIf-betingelsen traff: objektet finnes, men klienten har det alt.
    return new Response(null, { status: 304, headers: { etag: object.httpEtag } });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Innholdsadressert og uforanderlig (vaerpakker.md §5) — trygt å cache
  // permanent.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { status: 200, headers });
}
