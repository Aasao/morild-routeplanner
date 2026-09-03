/**
 * Kildestatus og degraderingsflagg per felt (`docs/specs/vaerpakker.md`
 * §12, N2). Bygger `SourceStatus`-verdier for situasjonene §12-tabellen
 * lister — konstruktørfunksjoner i stedet for at hvert kallsted skriver
 * `reason`-strengen fritt, slik at ordlyden er konsistent og testbar.
 *
 * Prinsipp håndhevet her: manglende/degradert data flagges PÅ FELTNIVÅ,
 * ALDRI ved stille substitusjon. Ingen av funksjonene under gjetter en
 * verdi — de bygger kun metadata om HVA som faktisk ble levert.
 */
import type { SourceStatus } from "@morild/protocol";

export const STATUS_OK: SourceStatus = { status: "ok" };

/** §12 rad 1 — F2.4s eget eksempel, brukt ordrett som mønster. */
export function runFellBackToOlder(expectedRun: string, usedRun: string): SourceStatus {
  return { status: "degraded", reason: `${expectedRun} manglet — dette er ${usedRun}` };
}

/** §12 rad 2 — ensemble ufullstendig, falt tilbake til eldre komplett kjøring. */
export function ensembleFellBackToOlderRun(memberCount: number, runInit: string): SourceStatus {
  return {
    status: "degraded",
    reason: `Siste kjøring ufullstendig — falt tilbake til ${runInit} (${memberCount} medlemmer)`,
  };
}

/** §11/§18 pkt. 2 — ingen kjøring innenfor fallback-vinduet var komplett. */
export function noUsableEnsemble(reason: string): SourceStatus {
  return { status: "degraded", reason };
}

/** §12 rad 3 — WAM800 grid utilgjengelig, Oceanforecast punkt brukt i stedet (§7 punkt 5). */
export function wam800UnavailablePointFallback(): SourceStatus {
  return { status: "degraded", reason: "WAM800 utilgjengelig — punktbølge brukt" };
}

/**
 * §12 rad 6 — «kun tidevanns-hovedkomponent» er IKKE et strømlag (§9.4).
 * Dette ER et datahull, ikke en villet nedtynning — merkes degradert.
 */
export function tideOnlyIsNotACurrentField(): SourceStatus {
  return {
    status: "degraded",
    reason: "Ingen NorKyst-strømdata levert — kun tidevannets hovedkomponent tilgjengelig (ikke et strømlag)",
  };
}

/**
 * §12 rad 5 — NorKyst-nedtynning aktiv (utaskjærs, §9.4). Dette er en
 * VILLET kvalitetsreduksjon innenfor budsjett, IKKE et datahull — status
 * forblir "ok"; den faktiske leverte oppløsningen vises i stedet i
 * `PackageHeader.resolution` (kallerens ansvar, ikke denne funksjonens).
 */
export function offshoreThinningIsNotDegraded(): SourceStatus {
  return STATUS_OK;
}

/** §12 — et hardt felt (Hs/TWS) manglet helt for byggingen (aldri gjettet, aldri "0"). */
export function fieldMissingEntirely(fieldName: string): SourceStatus {
  return { status: "degraded", reason: `${fieldName} mangler helt for denne pakken/flisen — ingen verdi gjettet` };
}

/** Kombinerer flere feltstatuser til én pakke-nivå-status: "ok" kun hvis ALLE er "ok". */
export function combineSourceStatuses(statuses: readonly SourceStatus[]): SourceStatus {
  const degraded = statuses.filter((s): s is Extract<SourceStatus, { status: "degraded" }> => s.status === "degraded");
  if (degraded.length === 0) return STATUS_OK;
  return { status: "degraded", reason: degraded.map((d) => d.reason).join("; ") };
}
