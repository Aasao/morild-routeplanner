# Rådata — E1′, datert tilleggskjøring 2026-09-01

Måleplanens **§8.4 punkt 2**: samme matrise, samme fiksturer, avganger,
medlemmer og kriterier som 2026-08-31, med to nye varianter og fasiten F
kjørt om igjen som referanse.

| variant | søk per medlem | R2-re-søk | kursoppløsning |
|---|---|---|---|
| **F** | fullt Pareto — **fasit** | pareto | fiksturens egen (6° i S-1/S-2, 10° ellers) |
| **A** | skalart (`maxLabelsPerState = 1`) | skalar | fiksturens egen |
| **F12** | fullt Pareto | pareto | **12°** |
| **A12** | skalart | skalar | **12°** |

Variant **B** er ikke med: den ble diskvalifisert 2026-08-31 på
felle-settets identitet (S-3, alle fem avganger), og §4 kaller det
diskvalifiserende uansett størrelse.

- `s-1.json` … `s-8.json` — én fil per fikstur med hele medlemstabellen.
  Samme struktur som 2026-08-31-mappen; se dens `LES-MEG.md` for
  nøkkelforklaringene.
- `sammendrag.json` — uten medlemstabellene, med **både** `rangering`
  (P50, den forhåndsregistrerte) og `rangeringP90` (deskriptiv).
- `kostnad.json` — **deterministisk** kostnadsmåling av medlemssøket
  (`tools/e1-maaling/kostnad.mjs`): `etiketter` (`labelsCreated`),
  `iterasjoner`, `klaringskall`. Disse er bit-deterministiske og er
  hovedkolonnen i rapportens §7; `ms` er min over gjentak og indikativ.

## Kjøringen ble delt i to

Prosessen ble avbrutt under S-8 og S-8 ble kjørt om igjen alene. Fordi
`maaling.mjs` bare skriver sammendrag over de fiksturene *den* kjøringen
omfattet, er `sammendrag.json` sammenstilt av
`tools/e1-maaling/sammendrag.mjs`, som kopierer felter og ikke regner om
noe. Konsekvens: **`ms` er ikke sammenlignbar på tvers av fiksturer** i
denne mappen (S-8 ble målt i en egen prosess). Bruk `kostnad.json`.

## Reproduksjonskontroll

F og A i denne mappen er **bit-identiske** med F og A i
`../maaling-e1-raadata/` over 500 sammenlignede felter (alt unntatt `ms`):
gjennomførbarhet, P50/P90, beat/motor/natt, spredning, søk-/evalueringstall,
felle-sett, backoff-0/2-kolonnen, utvei-margin og kontrollruten. Det er
kontrollen på at de fire nye variantene og flyttingen av de deskriptive
ekstrakjøringene ut av tidsmålingen ikke rørte noen måleverdi.

Kjør på nytt:

```
pnpm exec tsc -b
node tools/e1-maaling/maaling.mjs --varianter F,A,F12,A12 \
  --ut docs/research/maaling-e1-raadata-2026-09-01
node tools/e1-maaling/sammendrag.mjs --dir docs/research/maaling-e1-raadata-2026-09-01
node tools/e1-maaling/kostnad.mjs --gjentak 2
node tools/e1-maaling/rapporter.mjs --dir docs/research/maaling-e1-raadata-2026-09-01
```
