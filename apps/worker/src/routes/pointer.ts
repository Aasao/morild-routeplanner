/**
 * GET /pointer/:name → proxy for R2-objektet `pointer/<name>.json` i det
 * offentlige speilet (`MIRROR_BUCKET`, ADR-0006 pkt. 1).
 *
 * Generisk for alle pakketyper (vær, kart) — matcher R2-nøkkelmønsteret i
 * docs/specs/vaerpakker.md §5/§14 og farbarhetsmaske-pipelinens
 * `pointer/skandinavia.json`, som begge bruker `pointer/<navn>.json` i
 * samme bucket. Se docs/specs/app-skjelett.md §6.3 for hvorfor dette er en
 * generisk rute (denne stien er nå samme sannhet som `vaerpakker.md` §14
 * etter D4-rettingen 2026-09-03). Workeren gjør ingen tolkning av
 * innholdet — den er ren proxy/cache (ADR-0002).
 */
import type { Env } from "../env.js";

const ALLOWED_NAME_PATTERN = /^[a-z0-9-]+$/;

function jsonError(message: string, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handlePointer(
  name: string,
  env: Pick<Env, "MIRROR_BUCKET">,
): Promise<Response> {
  if (!ALLOWED_NAME_PATTERN.test(name)) {
    return jsonError(`Ugyldig pekernavn: "${name}"`, 400);
  }

  const key = `pointer/${name}.json`;
  const object = await env.MIRROR_BUCKET.get(key);
  if (object === null) {
    // Ærlig degradering (N2): "ikke funnet" er en gyldig, synlig tilstand —
    // ikke en feil som skjules bak en generisk 500.
    return jsonError(`Ingen peker funnet for "${name}"`, 404, { key });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", "application/json");
  headers.set("etag", object.httpEtag);
  // Pekeren endres ved hver batch-kjøring — kort levetid, i motsetning til
  // /blob/ under som er innholdsadressert og immutable.
  headers.set("cache-control", "public, max-age=60");
  return new Response(object.body, { status: 200, headers });
}
