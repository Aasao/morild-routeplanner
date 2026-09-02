/**
 * **S-5 — avgangsvindu med vippende rangering** (måleplanens §2 og §8.2:
 * «S-5 bygges (samme felt, forskjøvet avgang)»).
 *
 * Fiksturen er S-3s frontfelt i **negativ-kontroll-utgaven** — ingen medlemmer
 * kan forkastes hardt — og det er med vilje: S-5 skal måle
 * *rangeringsfølsomhet*, ikke feller. Med gjennomførbarhet fast på 30/30 er
 * ankomstfordelingen det eneste som kan skille avgangene, og et lite systematisk
 * avvik i en variant slår rett inn i toppavgangen.
 *
 * **Feltene er ankret i absolutt tid.** Det er hele forskjellen fra S-3: der
 * flyttes fronten sammen med avgangen (`referenceEpochS = departEpochS`), og
 * fem avganger ville gitt fem identiske målinger. Her bygges ensemblet én gang
 * på `GOLDEN_DEPART_S`, og avgangene flyttes gjennom det stillestående feltet.
 *
 * ## Vinduet (målt 2026-08-31, FØR kjøring — `ensemble-fixtures.test.ts`)
 *
 * Kontrollsøk + evaluering av 30 medlemmer per avgang, ankomsttid i timer:
 *
 * | avgang | P50 | P90 | snitt | kryss-P50 |
 * |---|---|---|---|---|
 * | +0 t | 14,859 | **15,541** | 14,530 | 9,89 |
 * | +1 t | 14,769 | 15,620 | 14,576 | 8,50 |
 * | +2 t | 14,731 | 17,133 | 15,020 | 7,72 |
 * | +3 t | **14,422** | 15,908 | **14,481** | 5,89 |
 * | +4 t | 14,712 | 15,925 | 14,555 | 4,00 |
 *
 * To ting gjør vinduet til et ekte vippepunkt:
 *
 *  1. **Naboene ligger innenfor toleransebåndet.** +1 t og +2 t skiller
 *     **0,26 %** på P50, og +0 t og +1 t **0,61 %** — begge godt innenfor
 *     §4s ±2 %. Et systematisk avvik på under en prosent i en variant er nok
 *     til å bytte om på dem.
 *  2. **Toppavgangen avhenger av hvilket tall man ser på.** P50 og snitt peker
 *     på +3 t; P90 peker på +0 t. Rangeringen er altså ikke robust i selve
 *     dataene, og det er nettopp det §2 ber om at S-5 skal være.
 *
 * Toppavgangen i målingen er definert som **laveste P50-ankomst** (låst her,
 * før kjøring, slik at valget ikke kan gjøres etter at tallene er sett).
 *
 * ## FORBEHOLD ved gjenbruk (lagt til 2026-09-01, kvantiseringsmålingens review)
 *
 * **Tabellen over er målt med kontrollrute-metoden**: ett Pareto-søk på
 * kontrollfeltet per avgang, deretter *evaluering* av de 30 medlemmene langs
 * den ene ruten. Kvantiseringsmålingen
 * (`docs/research/kvantiseringsmaaling-2026-09-01.md` §6.3) kjørte det samme
 * vinduet på nytt med **fullt Pareto-søk per medlem** på det samme,
 * **udegraderte** feltet, og fikk et annet svar:
 *
 * | metode | P50 per avgang (t) | toppavgang |
 * |---|---|---|
 * | kontrollrute + evaluering (denne fiksturens tall) | 14,859 / 14,769 / 14,731 / **14,422** / 14,712 | **+3 t** |
 * | fullt Pareto-søk per medlem | 14,403 / 14,378 / 14,293 / 14,289 / **13,842** | **+4 t** |
 *
 * Begge er reprodusert bit-eksakt av harnessen (rapportens §2.4), og den
 * nederste raden er identisk med S-5-raden for fasitvarianten F i
 * E1′-kjøringen 2026-09-01. Det er altså ikke en feil i noen av dem — de måler
 * to forskjellige ting: den ene rangerer avganger *gitt én delt plan*, den
 * andre rangerer avganger *gitt at hvert medlem seiles optimalt*.
 *
 * **Konsekvens for den som gjenbruker fiksturen:** «toppavgang +3 t» er en
 * egenskap ved metoden, ikke ved feltet, og tallet kan bare sammenlignes mot
 * målinger gjort med *samme* metode. Kontrollrute-varianten er dessuten et
 * svakt instrument for formatvalg: den flipper toppavgangen selv for værpakker
 * som er strengt finere enn referansen (`T-30M`, `T-15M` — rapportens
 * forbehold 2), fordi den delte kontrollruten velges nesten degenerert. Skal
 * fiksturen brukes til å skille to varianter, bruk fullt søk per medlem, eller
 * si eksplisitt i testen at den måler rangeringen langs en delt plan.
 */
import type { EnsembleFixture } from "./ensemble.js";
import { s3FrontEnsemble } from "./ensemble-s3-front.js";
import { GOLDEN_DEPART_S } from "./golden-scenarios.js";

/**
 * Avgangsvinduet, i sekunder etter fiksturens `departEpochS`. Fem naboavganger
 * med én times mellomrom — verifisert vippende (se filens toppkommentar).
 */
export const S5_DEPARTURE_OFFSETS_S: readonly number[] = Object.freeze([
  0, 3600, 7200, 10_800, 14_400,
]);

export function s5DepartureWindowEnsemble(): EnsembleFixture {
  const base = s3FrontEnsemble({
    departEpochS: GOLDEN_DEPART_S,
    withTrapMembers: false,
  });
  return {
    ...base,
    name: "s5-avgangsvindu",
    purpose:
      "S-3s frontfelt, ankret i absolutt tid, med fem naboavganger én time " +
      "fra hverandre. Rangeringen vipper: +1 t og +2 t skiller 0,26 % på P50, " +
      "og toppavgangen er +3 t etter P50/snitt, men +0 t etter P90.",
  };
}
