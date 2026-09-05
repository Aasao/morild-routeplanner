/**
 * Rangering av avganger (`docs/specs/robusthet.md` §4.3, F4.5).
 *
 * Spec-teksten («§4.3 Rangering av avganger»):
 *
 * > `nF_max` = største `nF` i vinduet. Avganger med `nF ≥ nF_max − 2` er
 * > **robust-settet** og rangeres på (`durationP90S` ↑, `feasibleShare` ↓,
 * > `departEpochS` ↑). Øvrige avganger følger, rangert på (`feasibleShare`
 * > ↓, `durationP90S` ↑, `departEpochS` ↑). Avganger uten `complete`
 * > rangeres etter kontrollens `durationS` og merkes «foreløpig». […]
 * > Rangeringen er en total ordning; to avganger med identisk nøkkel
 * > skilles av tidligste avgang.
 *
 * **Valg — spec underspesifisert, dokumentert her og i leveranserapporten:**
 *
 * 1. `nF_max` beregnes over de FULLFØRTE («complete») avgangene i vinduet
 *    alene. `nF` på en ufullstendig avgang er en delmengde av det endelige
 *    tallet og ville gjort `nF_max` — og dermed robust-settets grense —
 *    avhengig av hvor langt hver avgang har kommet i den progressive
 *    beregningen, ikke av den faktiske robustheten (§4.1s progressive
 *    rekkefølge påvirker per spec ALDRI tall).
 * 2. De ufullstendige («foreløpig») avgangene plasseres BAKERST i den totale
 *    ordningen, sortert på kontrollens `durationS` (tie-break `departEpochS`
 *    ↑) — «rangeres etter kontrollens `durationS`» leses som en egen,
 *    sekundær ordning blant de foreløpige, ikke som at de kan blande seg inn
 *    blant de fullførte etter en helt annen nøkkel.
 * 3. `durationP90S`/`feasibleShare` kan være `null` (ingen gjennomførbare).
 *    Dette er verst tenkelige utfall og sorteres SIST i sin gruppe: `null`
 *    `durationP90S` behandlet som `+Infinity`, `null` `feasibleShare`
 *    behandlet som `-Infinity` (dvs. slår ut som verst også der
 *    `feasibleShare` er sekundærnøkkel).
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 */
import type { DepartureSummary } from "./summary.js";

export interface RankedDeparture {
  readonly summary: DepartureSummary;
  /** 1-indeksert plass i den totale ordningen. */
  readonly rank: number;
  /** `!summary.complete` — «foreløpig (kontroll)» i presentasjonen. */
  readonly provisional: boolean;
}

/** `null` behandlet som verst mulig (+Infinity — «ukjent, kanskje uendelig»). */
function durationOrWorst(v: number | null): number {
  return v ?? Number.POSITIVE_INFINITY;
}

/** `null` behandlet som verst mulig (-Infinity — «ingen gjennomførbare»). */
function shareOrWorst(v: number | null): number {
  return v ?? Number.NEGATIVE_INFINITY;
}

function compareRobustSet(a: DepartureSummary, b: DepartureSummary): number {
  const durationDiff = durationOrWorst(a.durationP90S) - durationOrWorst(b.durationP90S);
  if (durationDiff !== 0) return durationDiff;
  const shareDiff = shareOrWorst(b.feasibleShare) - shareOrWorst(a.feasibleShare); // ↓ synkende
  if (shareDiff !== 0) return shareDiff;
  return a.departEpochS - b.departEpochS;
}

function compareRest(a: DepartureSummary, b: DepartureSummary): number {
  const shareDiff = shareOrWorst(b.feasibleShare) - shareOrWorst(a.feasibleShare); // ↓ synkende
  if (shareDiff !== 0) return shareDiff;
  const durationDiff = durationOrWorst(a.durationP90S) - durationOrWorst(b.durationP90S);
  if (durationDiff !== 0) return durationDiff;
  return a.departEpochS - b.departEpochS;
}

function compareProvisional(a: DepartureSummary, b: DepartureSummary): number {
  const durationDiff =
    durationOrWorst(a.control.summary?.durationS ?? null) -
    durationOrWorst(b.control.summary?.durationS ?? null);
  if (durationDiff !== 0) return durationDiff;
  return a.departEpochS - b.departEpochS;
}

/**
 * Rangerer avgangene i et avgangsvindu til en total ordning (§4.3).
 * Rekkefølgen på inndataene påvirker aldri utfallet.
 */
export function rankDepartures(summaries: readonly DepartureSummary[]): readonly RankedDeparture[] {
  const complete = summaries.filter((s) => s.complete);
  const incomplete = summaries.filter((s) => !s.complete);

  const nFMax = complete.reduce((max, s) => Math.max(max, s.nF), 0);
  const robustSet = complete.filter((s) => s.nF >= nFMax - 2).sort(compareRobustSet);
  const rest = complete.filter((s) => s.nF < nFMax - 2).sort(compareRest);
  const provisional = [...incomplete].sort(compareProvisional);

  const ordered = [...robustSet, ...rest, ...provisional];
  return ordered.map((summary, i) => ({ summary, rank: i + 1, provisional: !summary.complete }));
}
