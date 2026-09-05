/**
 * Nærmeste-rang-estimatorer (`docs/specs/robusthet.md` §4.2.1, §4.2.4).
 *
 * Over de `nF` gjennomførbare medlemmene: nærmeste-rang, ingen
 * interpolasjon. `k = ⌈p · nF / 100⌉`, 1-indeksert; verdien er `x₍ₖ₎` i den
 * ASCENDENDE sorterte verdilisten. `durationWorstS = x₍ₙF₎` (P100).
 * `null` når `nF = 0`.
 *
 * **Valg (spec underspesifisert):** §4.2.1 sier «Over de `nF` gjennomførbare
 * medlemmene sortert på `durationS`, deretter `memberIndex`» for
 * *seilingstid*, og «Samme for `beatShare`/`motorShare`» uten å si om
 * sorteringsnøkkelen skal forbli `durationS` (dvs. beatShare/motorShare tatt
 * ut ved samme rang-posisjon som duration-sorteringen gir) eller om hver
 * størrelse skal sorteres på sin egen verdi. Denne implementasjonen sorterer
 * HVER størrelse på sin egen verdi (ties brutt på `memberIndex`) — den
 * matematisk vanlige lesningen av «persentil av X»: persentilen skal si noe
 * om *fordelingen* av X, ikke om X ved et rangtall hentet fra en annen
 * variabel. «Samme for beatShare/motorShare» tolkes da som «samme
 * nærmeste-rang-metode», ikke «samme sorteringsnøkkel». Dokumentert her og i
 * leveranserapporten (D10.4-bølgen) som et åpent spørsmål til Magnus/panelet
 * hvis den andre lesningen var tiltenkt.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 */
import type { MemberOutcome, MemberSummary } from "./outcome.js";

/**
 * Nærmeste-rang over en allerede STIGENDE sortert verdiliste.
 * `k = ⌈p · n / 100⌉`, klemt til `[1, n]`, 1-indeksert. `null` når `n = 0`.
 */
export function nearestRankValue(sortedAscending: readonly number[], percentile: number): number | null {
  const n = sortedAscending.length;
  if (n === 0) return null;
  const k = Math.ceil((percentile * n) / 100);
  const clamped = Math.min(Math.max(k, 1), n);
  return sortedAscending[clamped - 1] ?? null;
}

/** Et gjennomførbart medlem har alltid et resultat — mangler sammendraget, er det en programmeringsfeil, ikke data. */
function summaryOf(m: MemberOutcome): MemberSummary {
  if (m.summary === null) {
    throw new Error(`MemberOutcome ${m.memberIndex} er ${m.kind} uten summary — kun error-medlemmer kan mangle sammendrag`);
  }
  return m.summary;
}

/** `beatS/durationS`; `0` når `durationS === 0` (unngår divisjon på null). */
function beatShare(m: MemberOutcome): number {
  const s = summaryOf(m);
  return s.durationS > 0 ? s.beatS / s.durationS : 0;
}

/** `motorS/durationS`; `0` når `durationS === 0`. */
function motorShare(m: MemberOutcome): number {
  const s = summaryOf(m);
  return s.durationS > 0 ? s.motorS / s.durationS : 0;
}

/**
 * Stigende sortert verdiliste for `key`, med `memberIndex` som tie-break
 * (§4.2.1s sorteringsregel, anvendt per størrelse — se toppkommentaren).
 */
function ascendingValues(feasible: readonly MemberOutcome[], key: (m: MemberOutcome) => number): number[] {
  return [...feasible]
    .sort((a, b) => key(a) - key(b) || a.memberIndex - b.memberIndex)
    .map(key);
}

export interface FeasibleEstimates {
  /** `x₍ₙF₎` — det VISTE «regn med inntil»-tallet (§4.2.2). */
  readonly durationWorstS: number | null;
  readonly durationP50S: number | null;
  /** Rangeringsnøkkel, vises kun bak trykk som «P90» (§4.2.2). */
  readonly durationP90S: number | null;
  readonly beatShareP50: number | null;
  readonly beatShareP90: number | null;
  readonly motorShareP50: number | null;
  readonly motorShareP90: number | null;
  /** Maks `fuelL` blant gjennomførbare — merkes «ikke usikkerhetsberegnet». */
  readonly fuelWorstL: number | null;
}

const NULL_ESTIMATES: FeasibleEstimates = Object.freeze({
  durationWorstS: null,
  durationP50S: null,
  durationP90S: null,
  beatShareP50: null,
  beatShareP90: null,
  motorShareP50: null,
  motorShareP90: null,
  fuelWorstL: null,
});

/**
 * Beregner alle §4.2.1/§4.2.4-estimatorene over de gjennomførbare medlemmene
 * i ett kall. `feasible` skal være medlemmene med `kind === "feasible"` —
 * denne funksjonen filtrerer ikke selv, den regner på det den får.
 */
export function computeFeasibleEstimates(feasible: readonly MemberOutcome[]): FeasibleEstimates {
  if (feasible.length === 0) return NULL_ESTIMATES;

  const durations = ascendingValues(feasible, (m) => summaryOf(m).durationS);
  const beatShares = ascendingValues(feasible, beatShare);
  const motorShares = ascendingValues(feasible, motorShare);
  const fuelWorstL = Math.max(...feasible.map((m) => summaryOf(m).fuelL));

  return {
    durationWorstS: nearestRankValue(durations, 100),
    durationP50S: nearestRankValue(durations, 50),
    durationP90S: nearestRankValue(durations, 90),
    beatShareP50: nearestRankValue(beatShares, 50),
    beatShareP90: nearestRankValue(beatShares, 90),
    motorShareP50: nearestRankValue(motorShares, 50),
    motorShareP90: nearestRankValue(motorShares, 90),
    fuelWorstL,
  };
}
