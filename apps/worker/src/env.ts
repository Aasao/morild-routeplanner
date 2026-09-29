/**
 * `apps/worker` — miljøkontrakt. Se docs/specs/app-skjelett.md §6 og
 * ADR-0006 (to-lags tilgangsmodell).
 */
export interface Env {
  /**
   * Offentlig speil (ADR-0006 pkt. 1): åpne-data-avledede pakker
   * (`pointer/*`, `weather/*`, `charts/*`). Ingen Access, kun prefiks-
   * filtrert av `/blob/`s `ALLOWED_BLOB_PREFIXES`. Alt appen kaller uten
   * autentisering leser KUN herfra.
   */
  readonly MIRROR_BUCKET: R2Bucket;
  /**
   * Personlige data (ADR-0006 pkt. 2): ruter, analyser, innstillinger,
   * havnebok og alt fremtidig F6.1-synk. Tom i denne fasen (fase 5 fyller
   * inn skjema). Bevisst en ANNEN bindingstype enn `MIRROR_BUCKET` (D1, ikke
   * enda en R2-bøtte) — se docs/specs/app-skjelett.md §6.6 for
   * begrunnelsen: ingen offentlig rute (`/pointer/`, `/blob/`,
   * `/proxy/metalerts`) importerer eller kaller D1-API-et i det hele tatt,
   * så "legg til en prefiks til" (vane-risikoen ADR-0006 advarer mot) er
   * strukturelt ikke en tilgjengelig snarvei lenger.
   */
  readonly PERSONAL_DB: D1Database;
  /**
   * Valgfri overstyring av User-Agent-strengen (§6.5). Ikke-hemmelig — satt
   * som `[vars]` i wrangler.toml, ikke som secret. Mangler den, brukes den
   * committede fallback-konstanten i `user-agent.ts`.
   */
  readonly MET_USER_AGENT?: string;
  /**
   * ADR-0006 pkt. 3 — interim CORS `*`-bryter. Settes til `"true"` i
   * `[vars]` KUN inntil Worker er montert under Pages-domenet (`/api/*`,
   * samme opphav → ingen CORS-header nødvendig i det hele tatt). Fraværende
   * eller enhver annen verdi enn `"true"` betyr "ikke sett CORS-headeren".
   */
  readonly INTERIM_CORS_ANY_ORIGIN?: string;
  /**
   * ADR-0006 pkt. 4 — misbruksvern på `/proxy/metalerts`. Valgfri: lokal
   * `wrangler dev` og ev. fremtidige miljøer uten ratelimit-infrastruktur
   * mangler bindingen, og proxyen skal da fortsette å fungere UTEN
   * håndhevelse (ærlig degradering — vi later ikke som vi håndhever en
   * grense vi ikke har) i stedet for å feile.
   */
  readonly METALERTS_RATE_LIMITER?: RateLimit;
  /**
   * Misbruksvern på `/proxy/oceanforecast` (`docs/specs/punktbolge.md` §3),
   * samme mønster som `METALERTS_RATE_LIMITER`: valgfri, fast nøkkel,
   * aggregert for hele appen. Ett kall kan gi opptil `WAVE_POINTS_MAX`
   * MET-kall, så grensen er per kall til proxyen, ikke per MET-kall.
   */
  readonly OCEANFORECAST_RATE_LIMITER?: RateLimit;
}
