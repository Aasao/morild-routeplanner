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
 * 4. Rute-nivå MOTOR-flagg (`RouteResult.flagNames`, D7.2) — flagg om selve
 *    SØKET, ikke om et punkt på linjen. `VAERDEKNING_BEGRENSET` er det
 *    første: søket forkastet etiketter fordi en værflis manglet innenfor
 *    pakkens tidsvindu. Kilde 1 og 4 deler bit-vokabular (`FLAG_NAMES`) og
 *    dermed også merkelapp-/alvorlighetstabellen under.
 */
import type { RouteResult } from "@morild/routing";
import type { FieldPresenceStatus, KnownField } from "./field-status.js";
import { FIELD_LABEL_NO } from "./field-status.js";

export interface DisplayFlag {
  readonly code: string;
  readonly label: string;
  readonly severity: "info" | "warning";
}

/** Rute-nivå flagg fra motoren (`RouteResult.flagNames`, D7.2). */
export function collectRouteFlagNames(result: RouteResult): readonly string[] {
  return result.flagNames;
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
  VAERDEKNING_BEGRENSET:
    "Ruten er BEGRENSET AV VÆRDEKNING: søket måtte forkaste alternativer fordi en værflis manglet innenfor pakkens tidsvindu — ruten kan være formet av hvilke fliser som var lastet, ikke av været (D7.2)",
  STROM_DATA_MANGLER: "Strømdata manglet ved sluttetappen inn til målet — den etappen er regnet uten strøm",
  // Ordlyd låst i docs/specs/strom-produsent.md §4b (D15.2). Aldri en nøyaktighet i meter.
  STROM_KYSTSONE:
    "Strøm nær land: verdien er lånt fra nærmeste sjøcelle i 800 m-modellen — retningen kan være upålitelig eller komme fra feil side i trange sund.",
};

/**
 * Bevisst, ett-og-ett klassifisert alvorlighetsgrad per `RouteStep.flagNames`
 * (review-funn etter fase 3 bølge 2: `displayFlagsForStepFlag` satte tidligere
 * `"info"` for ALLE flagg, inkludert sikkerhetsflaggene — et brudd på CLAUDE.md
 * §1 "usikker rute merkes eksplisitt". Kriteriet (dokumentert, ikke gjettet):
 * berører flagget farbarhet, klaring eller at data mangler — warning (⚠).
 * Er det et rent seilings-/kontekstflagg uten innvirkning på om ruten kan
 * garanteres trygg — info.
 *
 * | Flagg                          | Alvorlighet | Begrunnelse |
 * |---------------------------------|-------------|-------------|
 * | `USIKKER_TILLIT`                 | warning | Satt når mask-sjekkens `tillit === "usikkert"` (`evaluate.ts`/`search.ts`) — akkurat den farbarhets-usikkerheten som gulver `safety.verdict` til minst `"usikkert"` (`rutemotor.md` §10). Direkte farbarhet. |
 * | `MOTOR`                          | info    | Seilingsvalg (motor inne), ingen farbarhets-/klaringskonsekvens. |
 * | `NATT`                           | info    | Tidspunkt på døgnet, ingen farbarhets-/klaringskonsekvens i seg selv. |
 * | `KRYSS`                          | info    | Seilingsteknikk (baut), ingen farbarhets-/klaringskonsekvens. |
 * | `VIND_MOT_STROM`                 | info    | Dynamisk sjøgangskomfort (kort, bratt sjø) — ikke en farbarhets-/klaringsfeil eller datamangel, kun et forhold motoren regner ut når den HAR data. |
 * | `TSS_LANGS`                      | info    | Ren trafikkinformasjon (§ rutemotor.md: `tssAlongCostS` er 0 i v2.0, ingen kostnad, ingen farbarhetseffekt). |
 * | `SJOEGANGS_MARGIN_OVERSKREDET`   | warning | Sjøgangstillegget overskrider maskens statiske klaringsmargin i punktet (`rutemotor.md` §12) — direkte klaring. |
 * | `NEGATIV_VANNSTAND_RISIKO`       | warning | Risiko for negativ vannstand — direkte farbarhet (tørrfall-/grunnstøtingsrisiko). |
 * | `SJOEGANG_DATA_MANGLER`          | warning | Bølgedata manglet i punktet, klaringskravet falt tilbake til statisk margin — eksplisitt datamangel som IKKE later som marginen er dekket (N2). |
 * | `STROM_DATA_MANGLER`             | warning | Strøm manglet i sluttetappens miljøoppslag (D15.1 d-min) — datamangel, `coverage.weather` er da også `"partial"`. |
 * | `STROM_KYSTSONE`                 | warning | Strømverdien er kystnær/lånt fra nærmeste sjøcelle (D15.2) — retningen kan være gal i trange sund. Datakvalitet med direkte betydning for om strømbidraget kan stoles på. |
 * | `VAERDEKNING_BEGRENSET`          | warning | **Rute-nivå** (D7.2, `reconstruct.ts`): søket forkastet etiketter fordi værfeltet manglet data i posisjonen INNENFOR pakkens tidsvindu — altså et hull i flisdekningen. Ruten kan være styrt av dekningen i stedet for av været, og `safety.verdict` gulves derfor til minst `"usikkert"`. Datamangel med direkte konsekvens for om ruten kan garanteres — warning. |
 *
 * Ukjente/fremtidige flaggnavn (ikke i tabellen) klassifiseres `"warning"`
 * som konservativt standardvalg — ærlig degradering (N2) betyr at et flagg
 * vi ikke kjenner klassifiseringen av, aldri stille skal se ufarlig ut.
 */
const STEP_FLAG_SEVERITY: Record<string, "info" | "warning"> = {
  USIKKER_TILLIT: "warning",
  MOTOR: "info",
  NATT: "info",
  KRYSS: "info",
  VIND_MOT_STROM: "info",
  TSS_LANGS: "info",
  SJOEGANGS_MARGIN_OVERSKREDET: "warning",
  NEGATIV_VANNSTAND_RISIKO: "warning",
  SJOEGANG_DATA_MANGLER: "warning",
  VAERDEKNING_BEGRENSET: "warning",
  STROM_DATA_MANGLER: "warning",
  STROM_KYSTSONE: "warning",
};

export function displayFlagsForStepFlag(name: string): DisplayFlag {
  return {
    code: name,
    label: STEP_FLAG_LABEL_NO[name] ?? name,
    severity: STEP_FLAG_SEVERITY[name] ?? "warning",
  };
}

/**
 * Slår sammen alle kildene (§ toppkommentar) til én liste. Et flagg som
 * finnes både på rute-nivå og på steg (`STROM_KYSTSONE`, D15.2) vises én
 * gang — første forekomst (rute-nivå) vinner.
 */
export function allDisplayFlags(
  result: RouteResult,
  fieldStatuses: readonly FieldPresenceStatus[],
): readonly DisplayFlag[] {
  const all = [
    ...collectRouteFlagNames(result).map(displayFlagsForStepFlag),
    ...collectRouteStepFlagNames(result).map(displayFlagsForStepFlag),
    ...missingFieldFlags(fieldStatuses),
    ...coverageFlags(result),
  ];
  const seen = new Set<string>();
  return all.filter((f) => {
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });
}
