/**
 * Samler ALLE ærlige flagg for én rute til én visningsliste (oppdragets
 * punkt 2: "ALLE flagg, aldri skjult") — fra tre forskjellige kilder som
 * IKKE må blandes sammen semantisk:
 *
 * 1. Rutemotorens PUNKTVISE flagg (`RouteStep.flagNames`, satt av
 *    `packages/routing`, f.eks. `SJOEGANG_DATA_MANGLER` når bølgedata
 *    manglet i ETT punkt langs ruten selv om pakken generelt har
 *    bølgedata).
 * 2. Pakke-nivå "feltet finnes ikke i det hele tatt i denne pakken"
 *    (`field-status.ts` — f.eks. dagens vind-only dry-run-pakke: INGEN
 *    strøm- eller bølgefelt lastet ned overhodet).
 * 3. Rute-nivå dekningsflagg (`RouteResult.coverage` — vær tok slutt
 *    (partial, ADR-0005s inkonklusiv-regel) eller kartdekning er
 *    ufullstendig).
 */
import type { RouteResult } from "@morild/routing";
import type { FieldPresenceStatus, KnownField } from "./field-status.js";
import { FIELD_LABEL_NO } from "./field-status.js";

export interface DisplayFlag {
  readonly code: string;
  readonly label: string;
  readonly severity: "info" | "warning";
}

/** Union av alle `RouteStep.flagNames` som opptrer NOE STED langs ruten. */
export function collectRouteStepFlagNames(result: RouteResult): readonly string[] {
  const seen = new Set<string>();
  for (const step of result.steps) {
    for (const name of step.flagNames) seen.add(name);
  }
  return Array.from(seen).sort();
}

/**
 * Felt som mangler HELT i pakken. Vind unntas bevisst: mangler vinden helt
 * hadde `planRoute` aldri kommet i gang (`abortReason: "noWeatherAtStart"`
 * el.l.) — det ville vist seg som en feilet kjøring, ikke som "et flagg på
 * en ellers vellykket rute".
 */
export function missingFieldFlags(fieldStatuses: readonly FieldPresenceStatus[]): readonly DisplayFlag[] {
  const nonWind = (f: FieldPresenceStatus): f is FieldPresenceStatus & { readonly field: Exclude<KnownField, "wind"> } =>
    f.field !== "wind";
  return fieldStatuses
    .filter(nonWind)
    .filter((f) => !f.present)
    .map((f) => ({
      code: `${f.field.toUpperCase()}_DATA_MANGLER`,
      label: `${FIELD_LABEL_NO[f.field]}-data mangler i pakken (ingen felt lastet ned for dette området/tidsvinduet)`,
      severity: "warning" as const,
    }));
}

export function coverageFlags(result: RouteResult): readonly DisplayFlag[] {
  const flags: DisplayFlag[] = [];
  if (result.coverage.weather === "partial") {
    flags.push({
      code: "VAER_DEKNING_PARTIAL",
      label: "Værfeltet tok slutt før ruten var ferdig beregnet — inkonklusiv, ikke ugjennomførbar (ADR-0005)",
      severity: "warning",
    });
  }
  if (result.coverage.mask !== "full") {
    flags.push({
      code: `KART_DEKNING_${result.coverage.mask.toUpperCase()}`,
      label: `Farbarhetsmaskedekning: ${result.coverage.mask}`,
      severity: "warning",
    });
  }
  return flags;
}

const STEP_FLAG_LABEL_NO: Record<string, string> = {
  USIKKER_TILLIT: "Usikker tillit i minst ett punkt langs ruten",
  MOTOR: "Motor brukt et sted langs ruten",
  NATT: "Deler av ruten går i mørket",
  KRYSS: "Kryss (baut) et sted langs ruten",
  VIND_MOT_STROM: "Vind mot strøm (kort, bratt sjø) et sted langs ruten",
  TSS_LANGS: "Ruten følger en TSS-led et sted",
  SJOEGANGS_MARGIN_OVERSKREDET: "Sjøgangsmargin overskredet et sted langs ruten",
  NEGATIV_VANNSTAND_RISIKO: "Risiko for negativ vannstand et sted langs ruten",
  SJOEGANG_DATA_MANGLER: "Bølgedata manglet i minst ett punkt — klaringskravet falt tilbake til standardmarginen der",
};

export function displayFlagsForStepFlag(name: string): DisplayFlag {
  return {
    code: name,
    label: STEP_FLAG_LABEL_NO[name] ?? name,
    severity: "info",
  };
}

/** Slår sammen alle tre kildene (§ toppkommentar) til én, sortert liste. */
export function allDisplayFlags(
  result: RouteResult,
  fieldStatuses: readonly FieldPresenceStatus[],
): readonly DisplayFlag[] {
  return [
    ...collectRouteStepFlagNames(result).map(displayFlagsForStepFlag),
    ...missingFieldFlags(fieldStatuses),
    ...coverageFlags(result),
  ];
}
