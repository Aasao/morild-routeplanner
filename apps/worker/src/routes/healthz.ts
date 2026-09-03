/**
 * GET /healthz — Workerens egen liveness-rute.
 *
 * IKKE det samme som docs/specs/vaerpakker.md §13s batch-healthcheck (den
 * er `tools/weather-pack` som pinger en ekstern `HEALTHCHECK_URL` ved hver
 * kjøring). Dette er en enkel selvsjekk for uptime-overvåkning av selve
 * Worker-et.
 *
 * ADR-0006 Bekreftelse: rapporterer at BEGGE bindinger er koblet til uten å
 * lekke innhold — kun `true`/`false` for om Worker-runtimen faktisk ga oss
 * et binding-objekt for `MIRROR_BUCKET`/`PERSONAL_DB`/rate-limiteren, aldri
 * noe fra selve dataene. Dette sier ikke noe om hvorvidt den bakenforliggende
 * ressursen (R2-bøtte/D1-database) faktisk er opprettet på Cloudflare-
 * kontoen — kun at wrangler-konfigurasjonen koblet en binding inn i denne
 * kjøringen.
 */
import type { Env } from "../env.js";

type HealthzEnv = Pick<Env, "MIRROR_BUCKET" | "PERSONAL_DB" | "METALERTS_RATE_LIMITER">;

export function handleHealthz(env: HealthzEnv): Response {
  const payload = {
    status: "ok" as const,
    now: new Date().toISOString(),
    bindings: {
      mirrorBucket: Boolean(env.MIRROR_BUCKET),
      personalDb: Boolean(env.PERSONAL_DB),
      metalertsRateLimiter: Boolean(env.METALERTS_RATE_LIMITER),
    },
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
