import type { Env } from "./env.js";

/**
 * Committet fallback (CLAUDE.md-prinsipp: alle klient-/Worker-
 * miljøvariabler har en committet fallback i kode — lærdom fra
 * BeatTheBingo der Pages-env-vars ble mistet ved redeploy).
 * `env.MET_USER_AGENT` kan overstyre versjonstallet ved deploy uten
 * kodeendring, men proxyen fungerer identisk uten at variabelen
 * noensinne settes.
 *
 * Format låst av MET-vilkårene (docs/legal/met-norway-api.md,
 * docs/specs/vaerpakker.md §16): "<app>/<versjon> <kontakt-e-post>".
 * Aldri en generisk/tom UA — det gir permanent blokkering hos MET.
 */
const DEFAULT_USER_AGENT = "morild-routeplanner/0.1.0 maasao@gmail.com";

export function userAgentFor(env: Pick<Env, "MET_USER_AGENT">): string {
  const override = env.MET_USER_AGENT?.trim();
  return override && override.length > 0 ? override : DEFAULT_USER_AGENT;
}
