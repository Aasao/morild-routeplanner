/**
 * `apps/worker` — miljøkontrakt. Se docs/specs/app-skjelett.md §6.
 */
export interface Env {
  /** Delt R2-bucket for vær- og kartpakker (pointer/*, weather/*, charts/*). */
  readonly DATA_BUCKET: R2Bucket;
  /**
   * Valgfri overstyring av User-Agent-strengen (§6.5). Ikke-hemmelig — satt
   * som `[vars]` i wrangler.toml, ikke som secret. Mangler den, brukes den
   * committede fallback-konstanten i `user-agent.ts`.
   */
  readonly MET_USER_AGENT?: string;
}
