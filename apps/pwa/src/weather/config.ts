/**
 * Konfigurasjon for værpakke-flyten (fase 3 bølge 2C).
 *
 * `docs/specs/app-skjelett.md` §8: i dev peker Vite `/pointer`, `/blob`,
 * `/proxy`, `/healthz` til `apps/worker`s `wrangler dev` via
 * `server.proxy` — så en TOM `API_BASE` (samme-opphav, relative URL-er) er
 * riktig i dev OG i produksjon når PWA-en og Workeren til slutt deler
 * domene. Konfigurerbar likevel (ikke hardkodet inn i hvert kallsted) for
 * den dagen `apps/pwa` (Cloudflare Pages) og `apps/worker` (Cloudflare
 * Workers) får ulike opphav — se §8 "I produksjon ... setter Workeren
 * access-control-allow-origin: *".
 */
export interface AppConfig {
  /** Tom streng = samme opphav (relative URL-er). Sett til f.eks. "https://morild-worker.<konto>.workers.dev" ved ulikt opphav. */
  readonly apiBase: string;
  /** Pekernavnet for værpakken (`pointer/<navn>.json` i R2, §5/§14). */
  readonly weatherPointerName: string;
}

export const DEFAULT_APP_CONFIG: AppConfig = Object.freeze({
  apiBase: "",
  weatherPointerName: "vaer-skandinavia",
});

export function apiUrl(config: AppConfig, path: string): string {
  return `${config.apiBase}${path}`;
}
