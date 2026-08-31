# Måleplan E1′ — forhåndsregistrert validering av ensemble-mekanismen

- Dato: 2026-08-31. Status: **FORHÅNDSREGISTRERT — kriteriene under er
  låst FØR kjøring og skal ikke justeres etter at tall er sett.**
- Grunnlag: `beslutningsgrunnlag-r3-e1-2026-08-31.md` (værruting- og
  matematiker-agentenes design), `ekspertpanel-runde2-2026-08-31.md` §6.
- Formål: avgjøre E1′ empirisk — mekanisme for per-medlem-beregning i
  ensemblet: (A) eget skalart søk per medlem, (B) korridor-evaluering +
  R2-re-søk fra feilpunkter, målt mot (F) full Pareto per medlem som
  fasit. Korridor-evaluering måles i tillegg mot S1b-diff-bruken (der
  konkurrerer den ikke om F4.2).

## 1. Forutsetninger som må bygges først

1. **Frontpassasje-fiksturen:** syntetisk ensemble der en front er
   tidsforskjøvet ±3–9 t over medlemmene (deterministisk, seedet per
   medlem). Uten denne er felle-deteksjon utestet — viktigste fiksturen.
2. Grensetilfelle-fikstur nær maxTws/maxHs (gjennomførbarheten må faktisk
   variere over medlemmene).
3. Avgangsvindu-fikstur der rangeringen vipper mellom naboavganger.
4. Skalar søkemodus (nøytrale vekter, maxLabelsPerState=1) og
   korridor-evaluator m/R2-re-søk som kjørbare varianter.
5. R2-referanse: felle-settet defineres som medlemmene der evaluering/søk
   feiler hardt og re-søk fra første feilpunkt ikke finner farbar vei til
   bail-out innen skranke.

## 2. Scenarier (minst to ulike synoptiske situasjoner totalt)

| # | Scenario | Hvorfor |
|---|---|---|
| S-1 | Slør-referanse (Skjæløy→Skagen-typen) | baseline, kjent regime |
| S-2 | Ren kryssetappe m/20–30° dreining over medlemmer | målt ikke-monotont regime |
| S-3 | **Frontpassasje m/timing-spredning ±3–9 t** | felle-deteksjon (kritikkens hovedcase) |
| S-4 | Bohuslän-skjærgård | sektor-/etikettregimet |
| S-5 | Avgangsvindu m/vippende rangering | rangeringsfølsomhet |
| S-6 | Degradert data (bølger mangler) + grensetilfelle maxTws/maxHs | flagg- og gjennomførbarhetsveier |

Omfang: 6 scenarier × 5 avganger × 30 medlemmer × 3 varianter (A/B/F) på
identisk input. Syntetisk ensemble: kontrollfelt + seedede deterministiske
perturbasjoner (tidsskyv, rotasjon, skalering).

## 3. Målte størrelser (per fikstur × avgang; ALDRI aggregert over fiksturer)

1. P50/P90-ankomsttid — og P50/P90 på beat/motor/natt (skalar-bias
   treffer myke dimensjoner først).
2. Gjennomførbarhetsandel; algoritmiske aborter (labelCap/stagnasjon)
   telles som «ugjennomførbar» og rapporteres separat — kravet er null.
3. **Felle-settets identitet** (hvilke medlemmer feiler R2 — ikke antall).
4. Topp-avgang + Kendall-τ på avgangsrangeringen.
5. Rutetopologi (korridoravvik > 0,5 nm = annen topologi).
6. Per-medlem-differanser (variant − fasit): median + IQR — medlemmene er
   PAREDE; fordelingsoverlapp brukes aldri. Uniform bias er premisset for
   troverdig spredning.
7. Kjøretid per variant (PC; nettbrett-multiplikator fra nettbrett-målingen).

## 4. Beslutningsregel (låst, asymmetrisk)

Billigste variant vinner hvis den på **alle** fiksturer oppfyller:
- identisk felle-sett som fasit (**feil felle-sett er diskvalifiserende
  uansett størrelse** — sikkerhetssemantikk),
- samme topp-avgang og Kendall-τ ≥ 0,8,
- P50/P90-ankomst innen ±2 % (N5) ELLER < 20 % av medlemsspredningen
  (den strengeste som binder),
- gjennomførbarhetsandel innen ±1 medlem, null algoritmiske aborter.

Klassifisering av avvik:
- Avvik kun i myke fordelinger (beat/motor/natt) med uendret rangering og
  felle-sett: akseptabelt — dokumenteres, diskvalifiserer ikke.
- Rangeringsflipp innenfor toleransebåndet er uavgjort, ikke signal.
- Alt annet ⇒ **hybrid (korridor + R2-re-søk) foran skalar; full Pareto
  per medlem er siste utvei.**
- Med mange metrikker × fiksturer vil noe avvike tilfeldig: kun kriteriene
  over er avgjørende; resten er deskriptivt.

## 5. Rapportering

Resultat skrives til `docs/research/maaling-e1-<dato>.md` med rådata-
referanser, per-fikstur-tabeller og eksplisitt konklusjon mot regelen i
§4. Konklusjonen går inn i ADR-0005. Eventuelle endringer i denne planen
FØR kjøring dateres her; endringer ETTER påbegynt kjøring er ikke
tillatt (da kjøres målingen på nytt under revidert plan).
