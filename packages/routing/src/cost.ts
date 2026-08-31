/**
 * Kostnadsvektoren og Pareto-dominansen (docs/specs/rutemotor.md §4.6).
 *
 * Alle fire komponentene er **hele sekunder**. Heltall er et bevisst
 * determinismevalg: alle sammenligninger blir eksakte, uten epsilon og uten
 * avhengighet av flyttallsavrunding. Akkumulering skjer med `Math.round` på
 * hvert enkelt bidrag, aldri på summen — ellers ville rekkefølgen av like
 * bidrag kunne endre totalen.
 *
 * ε-dominans er **ikke aktivert** (besluttet 2026-08-30). Grensesnittet har
 * ingen epsilon-parameter i det hele tatt; å ha en avslått bryter er en
 * risiko i seg selv når den ikke er målt.
 */

/** `c(L) = (tS, beatS, motorS, nightS)`, alle hele sekunder. */
export interface CostVector {
  /** Sekunder siden avgang. */
  readonly tS: number;
  /** Sekunder med TWA < beatTwaDeg (kryss/bidevind). */
  readonly beatS: number;
  /** Sekunder med motoren inne. */
  readonly motorS: number;
  /** Sekunder i mørke. */
  readonly nightS: number;
}

export const ZERO_COST: CostVector = Object.freeze({
  tS: 0,
  beatS: 0,
  motorS: 0,
  nightS: 0,
});

/**
 * Streng Pareto-dominans: `a ≺ b` hviss a er minst like god på alle fire
 * komponentene og strengt bedre på minst én.
 *
 * Kalleren har ansvar for at a og b er i **samme tilstand** — dominans på
 * tvers av tilstander er meningsløs og skjer aldri (se `LabelStore`, som er
 * det eneste kallstedet i søket).
 *
 * Egenskaper (enhetstestet): irrefleksiv, antisymmetrisk, transitiv.
 */
export function dominates(a: CostVector, b: CostVector): boolean {
  if (a.tS > b.tS) return false;
  if (a.beatS > b.beatS) return false;
  if (a.motorS > b.motorS) return false;
  if (a.nightS > b.nightS) return false;
  return (
    a.tS < b.tS ||
    a.beatS < b.beatS ||
    a.motorS < b.motorS ||
    a.nightS < b.nightS
  );
}

/** Er de to kostnadsvektorene like på alle fire komponenter? */
export function costEquals(a: CostVector, b: CostVector): boolean {
  return (
    a.tS === b.tS &&
    a.beatS === b.beatS &&
    a.motorS === b.motorS &&
    a.nightS === b.nightS
  );
}

/** Vektsett for skalarisering av kostnadsvektoren. */
export interface CostWeights {
  readonly beat: number;
  readonly motor: number;
  readonly night: number;
}

/**
 * **Faste, nøytrale vekter i selve søket** (besluttet 2026-08-30).
 *
 * Brukerens vekter påvirker **kun rangeringen** av ferdige ruter, aldri
 * hvilke etiketter som overlever utkastingen. Det er svaret på spec §9
 * spm. 1: to brukere med ulike preferanser skal få samme kandidatmengde og
 * bare ulik rangering av den. Alternativet — å la brukervekten styre søket —
 * gjør «hva motoren i det hele tatt fant» avhengig av en skyveknapp, og det
 * er verken forklarlig eller reproduserbart på tvers av brukere.
 *
 * Tallene er et dokumentert **startpunkt**, ikke kalibrert: et sekund med
 * kryss, motor eller natt teller halvannet sekund i utkastingsscoren. Det
 * som er invarianten — og det som testes — er at de aldri avhenger av input.
 */
export const NEUTRAL_SEARCH_WEIGHTS: CostWeights = Object.freeze({
  beat: 0.5,
  motor: 0.5,
  night: 0.5,
});

/**
 * Skalar score for utkasting (§5.7) og rangering (§5.8).
 * Høyest score kastes ut; lavest score vinner rangeringen.
 */
export function costScore(c: CostVector, w: CostWeights): number {
  return c.tS + w.beat * c.beatS + w.motor * c.motorS + w.night * c.nightS;
}

/**
 * Brukervektene skalert med etappelengde (F3.4 «vekt skalert med
 * etappelengde»). Brukes **kun** i rangering, aldri i søket.
 */
export function scaledRankingWeights(
  w: CostWeights,
  distanceNm: number,
  lengthScaling: boolean,
): CostWeights {
  if (!lengthScaling) return w;
  const factor = 1 + Math.log10(Math.max(1, distanceNm / 10));
  return { beat: w.beat * factor, motor: w.motor, night: w.night };
}

/**
 * Total komparator for kostnadsvektorer: leksikografisk på
 * (tS, beatS, motorS, nightS). Returnerer 0 kun for helt like vektorer —
 * kallstedene bryter uavgjort videre på arena-indeks, som alltid er unik.
 */
export function compareCostLexicographic(a: CostVector, b: CostVector): number {
  if (a.tS !== b.tS) return a.tS - b.tS;
  if (a.beatS !== b.beatS) return a.beatS - b.beatS;
  if (a.motorS !== b.motorS) return a.motorS - b.motorS;
  return a.nightS - b.nightS;
}

/** Etikettflagg (§4.5). Rapportering, aldri kostnad. */
export const FLAG_USIKKER_TILLIT = 1 << 0;
export const FLAG_MOTOR = 1 << 1;
export const FLAG_NATT = 1 << 2;
export const FLAG_KRYSS = 1 << 3;
export const FLAG_VIND_MOT_STROM = 1 << 4;
export const FLAG_TSS_LANGS = 1 << 5;
export const FLAG_SJOEGANGS_MARGIN_OVERSKREDET = 1 << 6;
export const FLAG_NEGATIV_VANNSTAND_RISIKO = 1 << 7;
/**
 * Nytt i v2: sjøgangstillegget i klaringstallet kunne ikke beregnes fordi
 * bølgedata mangler i punktet. Klaringskravet falt da tilbake til den
 * statiske `minOffingNm`. Vi later ikke som marginen er dekket (N2).
 */
export const FLAG_SJOEGANG_DATA_MANGLER = 1 << 8;

export const FLAG_NAMES: readonly (readonly [number, string])[] = Object.freeze(
  [
    [FLAG_USIKKER_TILLIT, "USIKKER_TILLIT"],
    [FLAG_MOTOR, "MOTOR"],
    [FLAG_NATT, "NATT"],
    [FLAG_KRYSS, "KRYSS"],
    [FLAG_VIND_MOT_STROM, "VIND_MOT_STROM"],
    [FLAG_TSS_LANGS, "TSS_LANGS"],
    [FLAG_SJOEGANGS_MARGIN_OVERSKREDET, "SJOEGANGS_MARGIN_OVERSKREDET"],
    [FLAG_NEGATIV_VANNSTAND_RISIKO, "NEGATIV_VANNSTAND_RISIKO"],
    [FLAG_SJOEGANG_DATA_MANGLER, "SJOEGANG_DATA_MANGLER"],
  ] as const,
);

/** Flaggnavn i fast rekkefølge — determinisme også i rapporteringen. */
export function flagNames(flags: number): readonly string[] {
  const out: string[] = [];
  for (const [bit, name] of FLAG_NAMES) {
    if ((flags & bit) !== 0) out.push(name);
  }
  return out;
}
