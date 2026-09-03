/**
 * GET /healthz — Workerens egen liveness-rute.
 *
 * IKKE det samme som docs/specs/vaerpakker.md §13s batch-healthcheck (den
 * er `tools/weather-pack` som pinger en ekstern `HEALTHCHECK_URL` ved hver
 * kjøring). Dette er en enkel selvsjekk for uptime-overvåkning av selve
 * Worker-et.
 */
export function handleHealthz(): Response {
  const payload = {
    status: "ok" as const,
    now: new Date().toISOString(),
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
