/**
 * Rerun-tak (`docs/specs/robusthet.md` §7 D9.4, vedtatt 2026-09-05).
 *
 * Per medlem: maks ÉN omkjøring uten bound (§4.1s ventil). Omkjøringen er
 * idempotent — motoren er deterministisk (samme input ⇒ samme resultat), så
 * en andre omkjøring ville bare gjenta den første. Når taket er nådd uten at
 * medlemmet er klassifisert, er svaret `inconclusive` med grunn `"bound"`
 * (§3.2: reservert nettopp for dette — «ensemble-budsjett … omkjøring ikke
 * rukket»).
 *
 * Ensemble-budsjett (samlet omkjøringstid/-andel på tvers av hele
 * ensemblet) er IKKE denne funksjonens ansvar — det er bølge 3s D9.4 (a)
 * andre halvdel, ikke bygget her.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 */
import type { MemberClassification } from "./outcome.js";

/**
 * Hva som skal skje videre med et medlem gitt dets klassifisering og hvor
 * mange ganger det allerede er kjørt om.
 *
 * - Klassifiseringer ANNET enn `rerun-without-bound` er allerede endelige —
 *   returneres uendret (denne funksjonen er kun en vakt for ventilen).
 * - `rerun-without-bound` med `rerunCount === 0`: kjør om uten bound —
 *   returneres uendret (kalleren tolker dette som «kjør om»).
 * - `rerun-without-bound` med `rerunCount === 1` (taket er allerede brukt):
 *   `{ kind: "inconclusive", reason: "bound" }` — gi opp, ikke lyv en
 *   klassifisering fram.
 */
export function nextAction(classification: MemberClassification, rerunCount: 0 | 1): MemberClassification {
  if (classification.kind !== "rerun-without-bound") {
    return classification;
  }
  if (rerunCount === 0) {
    return classification;
  }
  return { kind: "inconclusive", reason: "bound" };
}
