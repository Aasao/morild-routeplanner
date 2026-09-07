/**
 * Beslutningsregel (`docs/specs/robusthet.md` §3.4, §4.6, D8.5).
 *
 * Geometrisk divergens av medlemsrutene fra kontrollens spor — «er du
 * nord for X kl. HH:MM?» — er sjekken; vind er kun forklaringen når en
 * finnes. Regelen er en GEOMETRISK påstand (GPS-sjekkbar uten
 * værtolkning), sikret mot spuriøse funn av tre gater: margin, konkordans
 * og leave-one-out. Fallback er alltid kodet i typen (`DecisionAdvice`).
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 *
 * ## Valg tatt der spec-en er underspesifisert (dokumentert her, ikke bare
 * i leveranserapporten)
 *
 * 1. **Projeksjon på tverretningen.** §4.6 pkt. 1 ber om «signert avstand
 *    i nm via lokal ekvirektangulær projeksjon rundt kontrollposisjonen».
 *    Denne implementasjonen bruker i stedet `crossTrackNm(a, b, p)` fra
 *    `@morild/geo` — storsirkel-tverravvik fra kontrollsporet `a→b`,
 *    signert (positivt = styrbord for kursen a→b). Valgt fordi funksjonen
 *    allerede finnes, er testet, og gir praktisk talt samme tall som en
 *    lokal ekvirektangulær projeksjon over avstandene (typisk noen nm per
 *    time) dette gjelder — å bygge en ny, parallell projeksjonsmetode for
 *    akkurat denne bruken ville vært en ekstra kilde til avvik uten
 *    gevinst.
 * 2. **Margin = «avstand mellom klassenes konkordante flertall».** Tolket
 *    strengt: for klassen med høyest median tas 25. persentil
 *    (nærmeste-rang) som nedre grense for dens konkordante ≥ 75 %-sone;
 *    for klassen med lavest median tas 75. persentil som øvre grense for
 *    dens konkordante ≥ 75 %-sone. `margin = høyGrense − lavGrense` — et
 *    krav om faktisk geometrisk avstand mellom de to sonene, strengere
 *    enn å bruke medianavstand alene (som ville tillatt store haler av
 *    hver klasse å overlappe over sonen).
 * 3. **Rapportert `concordance`/`hitRate`.** Gate-formålet sjekker
 *    konkordans PER KLASSE (begge ≥ terskel, pkt. 2). Det RAPPORTERTE
 *    tallet i `DecisionRule.concordance`/`hitRate` er den kombinerte
 *    andelen — alle betraktede medlemmer under ett — som endte på riktig
 *    side av midtpunktet mellom de to sonegrensene («andel medlemmer
 *    enige om retning på skillet», ordrett §3.4).
 * 4. **`checkEpochS`.** `hourlyTrack` bærer kun `LatLon`, ingen epoketid,
 *    og signaturen i oppdraget tar ikke imot `departEpochS` som eget
 *    felt. Avledet som `kontrollens summary.arrivalEpochS −
 *    summary.durationS` (= avgangstidspunkt) `+ t*·3600`. Klokkeslettet
 *    er UTC-epoketid i 4a — lokal visning/ISO-formatering er en
 *    presentasjonsdetalj for `apps/pwa`.
 * 5. **`explanation`.** Alltid `""` i 4a: vindsektor/TWS-terskel finnes
 *    ikke i `MemberSummary` (kun geometri) — §4.6 pkt. 4 sier eksplisitt
 *    at forklaringen skal være tom når ingen slik terskel kan hentes.
 * 6. **`action`.** Malen i oppdraget tilbyr «vent til neste vindu» ELLER
 *    «revurder ruten» som alternativer for UI, men `MemberSummary` gir
 *    ikke grunnlag for å skille dem (ingen avgangsvindu- eller
 *    alternativrute-kontekst er tilgjengelig i denne pakken). Valgt
 *    konservativt: én alltid-sann, kodet tekst som nevner begge.
 * 7. **Hvilke medlemmer teller.** Kun `feasible` og `infeasible` — §4.6
 *    pkt. 1 sier eksplisitt at inkonklusive utelates. Kontrollen selv
 *    brukes KUN som geometrisk referanse (kurs og skillepunkt), aldri som
 *    en av de klassifiserte observasjonene i marginen/konkordansen —
 *    §4.6 sier «per medlem», og kontrollen er ikke et av de 30 medlemmene
 *    (§3.3-skillet mellom `control` og `members`).
 */
import { angDiff, bearing, crossTrackNm } from "@morild/geo";
import type { LatLon } from "@morild/geo";
import { nearestRankValue } from "./estimators.js";
import type { MemberOutcome, MemberSummary } from "./outcome.js";

export interface DecisionRule {
  /** t* — tidspunkt medlemmene skilles, UTC-epoketid (§4.6 pkt. 2, valg 4 over). */
  readonly checkEpochS: number;
  /** Skillepunktet: kontrollrutens posisjon ved `checkEpochS`. */
  readonly position: LatLon;
  /** Siden de gjennomførbare medlemmene ligger på, relativt skillepunktet. */
  readonly test: "nord" | "sor" | "ost" | "vest";
  /** Vindsektor/-terskel som forklaring — alltid `""` i 4a (valg 5 over). */
  readonly explanation: string;
  /** «Skiller k av n utfall» — kombinert andel, se valg 3 over. */
  readonly hitRate: { readonly k: number; readonly n: number };
  /** Samme mål som `hitRate`, som andel (0–1). */
  readonly concordance: number;
  /** Alltid samme kodede tekst i 4a — se valg 6 over. */
  readonly action: string;
}

export type DecisionAdvice =
  | { readonly kind: "regel"; readonly rule: DecisionRule }
  /** Alltid kodet — typen krever den, ingen regel kan mangle en fallback. */
  | { readonly kind: "fallback"; readonly text: string };

export interface DeriveDecisionRuleOptions {
  /** Nautiske mil, provisorisk (DA6). Default 2. */
  readonly marginNm?: number;
  /** Andel [0,1], provisorisk (DA6). Default 0,75. */
  readonly concordance?: number;
}

export interface DeriveDecisionRuleInput {
  readonly control: MemberOutcome;
  /** De 30 ensemble-medlemmene (uten kontrollen) — samme populasjon som `DepartureSummary.members`. */
  readonly members: readonly MemberOutcome[];
  readonly complete: boolean;
  readonly nF: number;
  readonly nInf: number;
  readonly options?: DeriveDecisionRuleOptions;
}

const DEFAULT_MARGIN_NM = 2;
const DEFAULT_CONCORDANCE = 0.75;
/** Forutsetning §4.6: `complete && nF ≥ 12 && nInf ≥ 3`, ellers fallback direkte. */
const MIN_NF = 12;
const MIN_NINF = 3;

const FALLBACK_TEXT =
  "Ingen enkelt sjekkpunkt skiller utfallene i dag — følg vindviften underveis og revider om vinden avviker fra kartet.";
/** Den alltid kodede fallbacken (§4.6 pkt. 6) — eksportert så appen aldri dikter en egen. */
export const FALLBACK: DecisionAdvice = { kind: "fallback", text: FALLBACK_TEXT };

/** Kodet handlingstekst — se valg 6 i toppkommentaren. */
const ACTION_TEXT = "Vent til neste vindu, eller revurder ruten hvis vinduet ikke kommer.";

/** Ascending sortert kopi. */
function sortedAscending(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

interface HourSplit {
  readonly h: number;
  readonly position: LatLon;
  readonly course: number;
  readonly highIsFeasible: boolean;
  readonly hitK: number;
  readonly hitN: number;
  readonly concordance: number;
}

/**
 * Prøver å finne en gyldig splitt ved time `h` mellom `feasible` og
 * `infeasible` sine posisjoner (allerede filtrert til de som faktisk har
 * en `hourlyTrack`-oppføring ved `h`), projisert på tverretningen til
 * kontrollsporet `a→b`. `null` hvis ingen av klassene har data ved `h`,
 * medianene er like (ingen retning å skille på), margin < `marginNm`
 * eller konkordans i én av klassene < `concordanceThreshold`.
 */
function trySplitAtHour(
  h: number,
  a: LatLon,
  b: LatLon,
  feasible: readonly MemberSummary[],
  infeasible: readonly MemberSummary[],
  marginNm: number,
  concordanceThreshold: number,
): HourSplit | null {
  const feasiblePositions = feasible.map((m) => m.hourlyTrack[h]).filter((p): p is LatLon => p !== undefined);
  const infeasiblePositions = infeasible.map((m) => m.hourlyTrack[h]).filter((p): p is LatLon => p !== undefined);
  if (feasiblePositions.length === 0 || infeasiblePositions.length === 0) return null;

  const feasibleDist = sortedAscending(feasiblePositions.map((p) => crossTrackNm(a, b, p)));
  const infeasibleDist = sortedAscending(infeasiblePositions.map((p) => crossTrackNm(a, b, p)));

  const feasibleMedian = nearestRankValue(feasibleDist, 50) ?? 0;
  const infeasibleMedian = nearestRankValue(infeasibleDist, 50) ?? 0;
  if (feasibleMedian === infeasibleMedian) return null;

  const highIsFeasible = feasibleMedian > infeasibleMedian;
  const highValues = highIsFeasible ? feasibleDist : infeasibleDist;
  const lowValues = highIsFeasible ? infeasibleDist : feasibleDist;

  // Se valg 2 i toppkommentaren: 25. persentil av høyklassen (nedre grense
  // for dens øvre 75 %) og 75. persentil av lavklassen (øvre grense for
  // dens nedre 75 %).
  const highBoundary = nearestRankValue(highValues, 25) ?? 0;
  const lowBoundary = nearestRankValue(lowValues, 75) ?? 0;
  const margin = highBoundary - lowBoundary;
  if (margin < marginNm) return null;

  const concordanceHigh = highValues.filter((v) => v >= highBoundary).length / highValues.length;
  const concordanceLow = lowValues.filter((v) => v <= lowBoundary).length / lowValues.length;
  if (concordanceHigh < concordanceThreshold || concordanceLow < concordanceThreshold) return null;

  const splitPoint = (highBoundary + lowBoundary) / 2;
  const hitHigh = highValues.filter((v) => v >= splitPoint).length;
  const hitLow = lowValues.filter((v) => v <= splitPoint).length;
  const hitK = hitHigh + hitLow;
  const hitN = highValues.length + lowValues.length;

  return {
    h,
    position: a,
    course: bearing(a, b),
    highIsFeasible,
    hitK,
    hitN,
    concordance: hitN === 0 ? 0 : hitK / hitN,
  };
}

/** Nærmeste kompassretning (N/Ø/S/V) til en peiling i grader. Uavgjort går til nord (deterministisk, første i listen). */
function cardinalFor(bearingDeg: number): "nord" | "sor" | "ost" | "vest" {
  const candidates: readonly { readonly label: "nord" | "sor" | "ost" | "vest"; readonly deg: number }[] = [
    { label: "nord", deg: 0 },
    { label: "ost", deg: 90 },
    { label: "sor", deg: 180 },
    { label: "vest", deg: 270 },
  ];
  let bestLabel: "nord" | "sor" | "ost" | "vest" = "nord";
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = angDiff(bearingDeg, c.deg);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLabel = c.label;
    }
  }
  return bestLabel;
}

/** Finner første `h` (time fra avgang) der utfallene skilles gyldig, langs hele kontrollsporet. `null` hvis ingen. */
function findFirstSplit(
  controlTrack: readonly LatLon[],
  feasible: readonly MemberSummary[],
  infeasible: readonly MemberSummary[],
  marginNm: number,
  concordanceThreshold: number,
): HourSplit | null {
  for (let h = 0; h < controlTrack.length - 1; h++) {
    const a = controlTrack[h];
    const b = controlTrack[h + 1];
    if (a === undefined || b === undefined) break;
    const split = trySplitAtHour(h, a, b, feasible, infeasible, marginNm, concordanceThreshold);
    if (split !== null) return split;
  }
  return null;
}

/** Deler `members` i `feasible`/`infeasible` `MemberSummary`-lister (inkonklusive/feil/uten summary utelates — valg 7). */
function membersByKind(members: readonly MemberOutcome[]): {
  readonly feasible: readonly MemberSummary[];
  readonly infeasible: readonly MemberSummary[];
} {
  const feasible: MemberSummary[] = [];
  const infeasible: MemberSummary[] = [];
  for (const m of members) {
    if (m.summary === null) continue;
    if (m.kind === "feasible") feasible.push(m.summary);
    else if (m.kind === "infeasible") infeasible.push(m.summary);
  }
  return { feasible, infeasible };
}

/**
 * Kjerneberegningen: finner splitten og kjører leave-one-out (§4.6 pkt. 3).
 * `null` ⇒ fallback (ingen splitt funnet, eller LOO holder ikke).
 */
function computeRule(
  controlTrack: readonly LatLon[],
  controlSummary: MemberSummary,
  members: readonly MemberOutcome[],
  marginNm: number,
  concordanceThreshold: number,
): DecisionRule | null {
  const { feasible, infeasible } = membersByKind(members);
  const split = findFirstSplit(controlTrack, feasible, infeasible, marginNm, concordanceThreshold);
  if (split === null) return null;

  // LOO: for hvert medlem med et resultat (feasible/infeasible), fjern det
  // og kjør HELE søket etter en splitt på nytt. Krever samme t* (±1 t) og
  // samme side i alle 30 utelatelser.
  const consideredMembers = members.filter((m) => m.kind === "feasible" || m.kind === "infeasible");
  for (const excluded of consideredMembers) {
    const remaining = members.filter((m) => m !== excluded);
    const { feasible: fLoo, infeasible: iLoo } = membersByKind(remaining);
    const looSplit = findFirstSplit(controlTrack, fLoo, iLoo, marginNm, concordanceThreshold);
    if (looSplit === null) return null;
    if (Math.abs(looSplit.h - split.h) > 1) return null;
    if (looSplit.highIsFeasible !== split.highIsFeasible) return null;
  }

  const departEpochS = controlSummary.departEpochS; // D12.5: bokført, ikke utledet.
  const checkEpochS = departEpochS + split.h * 3600;
  // Positiv crossTrackNm = styrbord for kursen a→b = retning kurs+90°.
  const testBearing = split.highIsFeasible ? (split.course + 90) % 360 : (split.course + 270) % 360;

  return {
    checkEpochS,
    position: split.position,
    test: cardinalFor(testBearing),
    explanation: "",
    hitRate: { k: split.hitK, n: split.hitN },
    concordance: split.concordance,
    action: ACTION_TEXT,
  };
}

/**
 * Beregner beslutningsregelen for valgt avgang (§3.4, §4.6). Forutsetning
 * `complete && nF ≥ 12 && nInf ≥ 3` — ellers fallback direkte, uten å lete
 * etter en splitt. `options.marginNm`/`options.concordance` overstyrer de
 * provisoriske standardverdiene (2 nm, 0,75) for §5.5s støyfikstur.
 */
export function deriveDecisionRule(input: DeriveDecisionRuleInput): DecisionAdvice {
  const marginNm = input.options?.marginNm ?? DEFAULT_MARGIN_NM;
  const concordanceThreshold = input.options?.concordance ?? DEFAULT_CONCORDANCE;

  if (!input.complete || input.nF < MIN_NF || input.nInf < MIN_NINF) {
    return FALLBACK;
  }

  const controlSummary = input.control.summary;
  if (controlSummary === null || controlSummary.hourlyTrack.length < 2) {
    return FALLBACK;
  }

  const rule = computeRule(controlSummary.hourlyTrack, controlSummary, input.members, marginNm, concordanceThreshold);
  return rule === null ? FALLBACK : { kind: "regel", rule };
}
