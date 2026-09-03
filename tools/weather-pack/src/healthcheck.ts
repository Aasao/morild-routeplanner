/**
 * Healthcheck-ping-kontrakt (`docs/specs/vaerpakker.md` §13, ADR-0003, F2.4).
 *
 * Batch-jobben pinger `HEALTHCHECK_URL` ved HVER kjøring, uavhengig av om
 * kjøringen lyktes. Kritisk: pingen skal skje i en `finally`, ikke bare på
 * lykkelig vei (§13 — "en batch-jobb som crasher FØR den rekker å pinge
 * skjuler nettopp feilen healthchecken skal fange"). `runWithHealthcheck`
 * håndhever nettopp det: enhver feil fra `work()` pinges FØR den kastes
 * videre.
 */

export interface FieldHealthStatus {
  readonly field: string;
  readonly succeeded: boolean;
  /** Kjøring det ble falt tilbake til, hvis noen (§11/§18 pkt. 2). */
  readonly fellBackTo: string | undefined;
  readonly sourceStatus: { readonly status: "ok" } | { readonly status: "degraded"; readonly reason: string };
}

/** §13 — minimum payload. Form kan justeres ved implementasjon; feltene under er semantisk låst. */
export interface HealthcheckPayload {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly fields: readonly FieldHealthStatus[];
  readonly totalPackageBytes: number;
  /** true hvis noe felt ble degradert PÅ EN MÅTE UTENFOR forventet mønster (§13, "et mønster, ikke en enkelthendelse" avgjøres av healthcheck-tjenesten, ikke her). */
  readonly unexpectedDegradation: boolean;
  readonly error: string | undefined;
}

export function buildHealthcheckPayload(args: {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly fields: readonly FieldHealthStatus[];
  readonly totalPackageBytes: number;
  readonly unexpectedDegradation: boolean;
  readonly error?: string;
}): HealthcheckPayload {
  return {
    runId: args.runId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    fields: args.fields,
    totalPackageBytes: args.totalPackageBytes,
    unexpectedDegradation: args.unexpectedDegradation,
    error: args.error,
  };
}

export interface HealthcheckPingFn {
  (url: string, payload: HealthcheckPayload): Promise<void>;
}

/**
 * Kjører `work()` og pinger `pingUrl` MED RESULTATET (suksess eller feil) i
 * en `finally` — pingen skjer uansett utfall. `buildPayload` kalles med
 * hvorvidt jobben lyktes og evt. feilmelding, og returnerer selve
 * payload-en (kalleren kjenner detaljene om felt/bytes, ikke denne
 * generiske wrapperen).
 */
export async function runWithHealthcheck<T>(
  work: () => Promise<T>,
  ping: HealthcheckPingFn,
  healthcheckUrl: string,
  buildPayload: (outcome: { readonly succeeded: boolean; readonly error?: string }) => HealthcheckPayload,
): Promise<T> {
  let succeeded = false;
  let error: string | undefined;
  try {
    const result = await work();
    succeeded = true;
    return result;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const payload = buildPayload(error === undefined ? { succeeded } : { succeeded, error });
    await ping(healthcheckUrl, payload);
  }
}
