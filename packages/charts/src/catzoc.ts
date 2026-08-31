/**
 * CATZOC-semantikkforberedelse (B4, beslutning 2026-08-31, steg 3-plan
 * `docs/research/steg3-plan-2026-08-31.md`). Se
 * `docs/specs/farbarhetsmaske.md` §3.4.1 og
 * `docs/research/ekspertpanel-2026-08-31.md` §4 (marinkartologen) for
 * bakgrunn og kartologens foreslåtte kalibreringstabell.
 *
 * Effektivt dybdekrav ved oppslag er `basiskrav + f(CATZOC)`. `f` er
 * FORELØPIG 0 for ALLE kategorier — ingen kalibrering mot ekte
 * sonderingsdata er gjort ennå. Poenget med denne filen er å fryse
 * KONTRAKTEN nå: alle oppslagsveier i `chart-source.ts`
 * (`evaluatePoint`, `evaluateChordAgainstTile`,
 * `nermesteFareAvstandNm`s klaring-avledning) kaller
 * `effectiveDepthRequirement` i stedet for å bruke `kravTilDybdeM` rått. Den
 * dagen `f` kalibreres, er det en PARAMETERENDRING i `catzocSurcharge`
 * under, ikke en semantikkendring som må spores gjennom kallestedene på
 * nytt (E7-logikken fra §4.1: billig å bygge inn riktig nå, dyrt å
 * ettermontere).
 *
 * VIKTIG AVGRENSNING: den binære CATZOC-gaten (C/D/U kan aldri gi `trygt`,
 * uansett dybde — `hasGoodDataQuality` i `chart-source.ts`) er UENDRET og
 * ligger fortsatt der. Denne modulen justerer kun det KVANTITATIVE
 * dybdekravet for soner som ELLERS kunne fått tillitsløft (A1/A2/B); den
 * overstyrer aldri den kvalitative gaten. CATZOC B/C sin rolle i
 * skjærbuffer-vurderingen (kartologens merknad om at CATZOC B har
 * ±50 m posisjonsusikkerhet, mer enn dagens faste 20 m-buffer) er en EGEN,
 * separat forberedelse — ikke dekket av denne funksjonen — og tas i en
 * senere bølge (§3.4.1).
 */
import type { CatzocClass } from "./pack-format.js";

/** `undefined` = ingen klassifisert CATZOC-sone dekker punktet/korden. */
export type CatzocSone = CatzocClass | undefined;

/**
 * f(CATZOC) — kartologens foreslåtte fremtidige kalibreringstabell
 * (ekspertpanel 2026-08-31 §4, IHO S-57-aktig dybdenøyaktighetsform
 * a + b·d, der d er dybden):
 *
 *   A1:    0,5 m + 1 % av dybden
 *   A2/B:  1,0 m + 2 % av dybden
 *   C/D/U: aldri `trygt` — UENDRET binær gate, IKKE et f-tillegg her
 *
 * Alle tall er 0 inntil kalibrering er gjort mot ekte sonderings-/
 * kalibreringsdata (se `docs/specs/farbarhetsmaske.md` §3.4.1, «Åpne
 * spørsmål»). Denne funksjonen er den ENESTE plassen f-verdiene skal
 * fylles inn — ikke i `chart-source.ts`.
 */
function catzocSurcharge(catzocSone: CatzocSone): number {
  // Parameteren er bevisst ubrukt i dag (f=0 for alle kategorier) — den
  // beholdes i signaturen for å fryse kontrakten, se filens toppkommentar.
  void catzocSone;
  return 0;
}

/**
 * Effektivt dybdekrav ved oppslag: `basiskrav + f(CATZOC)`. Kalles fra alle
 * oppslagsveier i `chart-source.ts` som sammenligner et klaringskrav mot
 * kartlagt dybde (dybdebånd-sikkerhetskontur og VALSOU-klaringssjekker).
 */
export function effectiveDepthRequirement(
  basiskrav: number,
  catzocSone: CatzocSone,
): number {
  return basiskrav + catzocSurcharge(catzocSone);
}
