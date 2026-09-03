/**
 * Henter HELE Skandinavia MetAlerts-settet fra `/proxy/metalerts` (D2,
 * ADR-0006 pkt. 4 — ingen `bbox`-parameter, filtrering skjer i klienten,
 * se `metalerts.ts`).
 *
 * Leser Workerens to ekstra svar-headere (`fetched-at`, `source-status`) —
 * "si tydelig hvor gamle [dataene] er" (N2) gjelder MetAlerts akkurat som
 * værpakkene, selv om MetAlerts ikke har en `PackageHeader`.
 */
import type { AppConfig } from "./config.js";
import { apiUrl } from "./config.js";
import type { MetAlertsFeatureCollection } from "./metalerts.js";

export interface MetAlertsLoadResult {
  readonly alerts: MetAlertsFeatureCollection;
  /** ISO 8601 fra `fetched-at`-headeren, eller `undefined` hvis Workeren ikke sendte den. */
  readonly fetchedAt: string | undefined;
  readonly sourceStatus: string | undefined;
}

export async function fetchMetAlerts(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<MetAlertsLoadResult> {
  const url = apiUrl(config, "/proxy/metalerts");
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`MetAlerts-henting feilet: HTTP ${res.status}`);
  }
  const alerts = (await res.json()) as MetAlertsFeatureCollection;
  return {
    alerts,
    fetchedAt: res.headers.get("fetched-at") ?? undefined,
    sourceStatus: res.headers.get("source-status") ?? undefined,
  };
}
