/**
 * `apps/worker` — Cloudflare Worker: ren proxy/cache og pakke-pekere
 * (ADR-0002: "klienten beregner, skyen forbereder"). Ingen NetCDF-
 * dekoding, ingen kvantisering, ingen ruteberegning skjer her.
 *
 * Rutene har bevisst INGEN Cloudflare Access foran seg — se
 * docs/specs/app-skjelett.md §7 og ADR-0006 for begrunnelsen (F6.4-fellen:
 * en utløpt interaktiv økt skal aldri kunne "drepe" offline-appen).
 * ADR-0006 pkt. 2: `env.PERSONAL_DB` importeres/kalles ALDRI herfra eller
 * fra noen av handlerne under — det er selve håndhevelsen av at
 * strukturen, ikke bare en prefiksliste, holder personlige data unna de
 * offentlige rutene.
 */
import type { Env } from "./env.js";
import { resolveRoute } from "./router.js";
import { withCors, handlePreflight } from "./cors.js";
import { handleHealthz } from "./routes/healthz.js";
import { handlePointer } from "./routes/pointer.js";
import { handleBlob } from "./routes/blob.js";
import { handleMetAlerts } from "./routes/metalerts.js";
import { handleOceanForecast } from "./routes/oceanforecast.js";

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handlePreflight(env);
    }
    if (request.method !== "GET") {
      return withCors(methodNotAllowed(), env);
    }

    const url = new URL(request.url);
    const route = resolveRoute(url.pathname);

    switch (route.kind) {
      case "healthz":
        return withCors(handleHealthz(env), env);
      case "pointer":
        return withCors(await handlePointer(route.name, env), env);
      case "blob":
        return withCors(await handleBlob(route.key, env, request, ctx), env);
      case "metalerts":
        return withCors(await handleMetAlerts(request, env, ctx), env);
      case "oceanforecast":
        return withCors(await handleOceanForecast(request, env, ctx), env);
      case "not-found":
        return withCors(notFound(), env);
    }
  },
} satisfies ExportedHandler<Env>;
