/**
 * CORS for de offentlige, ikke-sensitive lese-rutene (docs/specs/
 * app-skjelett.md §7, ADR-0006 pkt. 3).
 *
 * `access-control-allow-origin: *` er en INTERIM-tilstand, styrt av
 * `env.INTERIM_CORS_ANY_ORIGIN`, ikke en permanent innstilling: når Worker
 * er montert under Pages-domenet (`/api/*`, se wrangler.toml `[[routes]]`-
 * kommentaren) kjører `apps/pwa` og `apps/worker` på samme opphav, og CORS
 * bortfaller helt — ingen header skal settes da. Review-funn 2026-09-03:
 * en statisk `access-control-allow-origin: *` kombinert med
 * `vary: origin` er selvmotsigende (svaret varierer aldri faktisk med
 * `Origin`-headeren når verdien alltid er `*`) — `vary: origin` er derfor
 * fjernet sammen med at `*` ble gjort betinget, ikke bare latt stå.
 */
import type { Env } from "./env.js";

function anyOriginEnabled(env: Pick<Env, "INTERIM_CORS_ANY_ORIGIN">): boolean {
  return env.INTERIM_CORS_ANY_ORIGIN === "true";
}

export function withCors(response: Response, env: Pick<Env, "INTERIM_CORS_ANY_ORIGIN">): Response {
  if (!anyOriginEnabled(env)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  return new Response(response.body, { status: response.status, headers });
}

export function handlePreflight(env: Pick<Env, "INTERIM_CORS_ANY_ORIGIN">): Response {
  if (!anyOriginEnabled(env)) {
    // Ingen CORS-modus: en OPTIONS-forespørsel mot en same-origin-rute er
    // ikke et ekte CORS-preflight i utgangspunktet, men vi svarer likevel
    // høflig på metoden i stedet for 404/405.
    return new Response(null, { status: 204 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "if-none-match",
      "access-control-max-age": "86400",
    },
  });
}
