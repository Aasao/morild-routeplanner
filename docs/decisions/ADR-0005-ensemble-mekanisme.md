# ADR-0005: Ensemble-mekanisme — fullt Pareto-søk per medlem på kontrolloppløsning

- Status: **foreslått** — venter på Magnus (berører robusthetssemantikk,
  F4.2-tallenes gyldighet)
- Dato: 2026-09-01
- Besluttet av: agent-forslag som venter

## Kontekst

ADR-0004 valgte isokron/A*-hybrid med Pareto-etiketter for
kontrollkjøringen, men lot mekanismen for de 30 ensemble-medlemmene stå
åpen (E1′ i `docs/research/ekspertpanel-runde2-2026-08-31.md` §6).
Kandidatene var (A) eget skalart søk per medlem (bransjenorm,
værruting-agentens linje), (B) korridor-begrenset evaluering + R2-re-søk
fra feilpunkter (matematiker-agentens linje), mot (F) fullt Pareto-søk
per medlem som fasit. Premisset for hele debatten var at F var for dyr
(F3.5-budsjettet: < 60 s ensemble på nettbrett).

Spørsmålet ble avgjort empirisk med forhåndsregistrert måling
(`docs/research/maaleplan-e1-2026-08-31.md`, kriterier låst før kjøring;
resultater i `docs/research/maaling-e1-2026-08-31.md`, rådata i
`maaling-e1-raadata*/`, commit 24322e2 + b610dff). Sentrale målte fakta:

1. **Kostnadspremisset var falskt.** Skalart søk (A) sparer bare
   5–21 % mot fullt Pareto per medlem (deterministiske tellere;
   korrigert måling 0,77–0,92). Forklaringen er den målte tynne
   Pareto-fronten (~1,2–1,5 etiketter/tilstand): etikett-taket kutter
   nesten ingenting. Kostnaden bor i sektornøkkel-tilstandsrommet og
   kursoppløsningen, ikke i Pareto-dominansen.
2. **B er diskvalifisert for F4.2-bruk.** Navigasjonsfelle-medlemmet m24
   (utvei = 25,4 nm bauteomvei 9,56 nm utenfor Bs 4 nm-rør) bommes av B
   på alle 5 avganger — feil felle-sett er diskvalifiserende per
   forhåndsregistrert regel. Overbestemt av S-7-kollaps (0/30 mot 13/30)
   og P90-avvik 10–19 % overalt. Feilen er geometrisk (fast rør), ikke
   parametrisk: ethvert fast rør feiler for en tilstrekkelig bred omvei.
3. **A består felle-kriteriet overalt** (også m24 — skalart
   fullmaske-re-søk finner utveien), og under produktets egen rangering
   (P90, F4.4/F4.5) forsvinner begge rangeringsbruddene. Det gjenstående
   P50-verdibruddet på S-5 (+3,24 %, bimodal fordeling) er reelt og var
   forhåndsregistrert — og illustrerer nettopp skalar-svakheten
   ADR-0004 forutsa (per-medlem-regret i myke dimensjoner).
4. **Grovere medlemsoppløsning (12°) er IKKE trygg for
   gjennomførbarhetstall:** F12/A12 består felle-settet, men bryter
   ±1-medlem-kriteriet på S-7 med fortegnsflip (+4/+2/−4) og P90-avvik
   opp til +56 %. F3.5s antagelse «redusert kursoppløsning per medlem»
   er dermed målt usikker for F4.2 — og gevinsten er uansett liten
   (7–10 % mot 10°-fasit).

## Beslutning

Ensemble-medlemmene beregnes med **samme fulle Pareto-søk og samme
oppløsning som kontrollkjøringen** (mekanisme F). Robusthetstall
(gjennomførbarhetsandel, felle-sett/R2, P50/P90-spredning) hentes kun
fra slike fulle medlemssøk. Korridor-evaluatoren beholdes utelukkende
som S1b-diff-verktøy («holder gårsdagens plan?») og merkes slik i API og
UI; den mater aldri F4.2-statistikk. R2-fasitsemantikken fra måleplanens
§8.1 (re-søk fra siste lovlige tilstand, backoff låst til 1) blir
produksjonssemantikk for felle-deteksjon.

## Alternativer vurdert

- **(A) Skalart søk per medlem:** vraket fordi besparelsen er målt
  marginal (5–21 %) mens per-medlem-regret i myke dimensjoner er reell
  (S-5 P50 +3,24 %); å kjøpe en målbar skjevhet for < 21 % rabatt er
  dårlig handel. Beholdes som implementert, dokumentert målevariant.
- **(B) Korridor-evaluering + R2-re-søk:** vraket for robusthetsbruk —
  diskvalifisert på felle-sett (m24), gjennomførbarhetskollaps (S-7) og
  P90-bias; geometrisk grunnfeil, ikke tunbar. Beholdes for S1b-diff.
- **(F12) Fullt Pareto på grovere medlemsoppløsning:** vraket som
  standard — bryter gjennomførbarhetskriteriet med fortegnsflip;
  gevinsten liten. Kan revurderes i 4a KUN hvis en fikstur-bredere
  måling viser at S-7-bruddet var artefakt.
- **Regime-klynging (2–4 medoid-søk + evaluering):** ikke målt i denne
  runden; står som fase 4b-forskningsspor med outlier-vakt
  (`ekspertpanel-runde2` §5), uendret av denne ADR-en.

## Konsekvenser

- **Robusthetstallene arver søkets fulle korrekthetsgarantier** — hele
  klassen «evaluator-artefakt»-risiko (frossen-spor-bias, rør-blindhet)
  forsvinner fra F4.2. Én motor, én sannhet, også i ensemblet.
- **Ytelsesbudsjettet må løses et annet sted enn i medlemsmekanismen.**
  Målt: ~67–99 s per avgang for 30 fulle medlemssøk på S-1 (PC).
  F3.5-budsjettet (< 60 s nettbrett) nås dermed ikke ved å velge
  billigere per-medlem-mekanisme — spakene som gjenstår er færre/smartere
  kjøringer (progressiv beregning per F3.5, profilsøk over
  avgangsvinduet, τ-felt-screening, delt A*-felt/klaring på tvers av
  medlemmer der semantikken tillater det) og konstantfaktor-arbeid
  (alloc-fri hot-loop, måldominans-pruning). Dette blir fase
  4a-designets hovedoppgave, informert av nettbrett-målingen.
- **Vi gir avkall på** bransjenormens enkelhet (skalar per medlem) og på
  12°-snarveien for medlemmer. Ombestemmer vi oss, er kostnaden liten:
  variantene A/A12/F12 forblir implementert bak opsjoner og kan
  remåles med utvidet fiksturssett.
- Falsifiseringsterskler for 4a-validering (pragmatiker-agentens krav):
  (i) på ekte MEPS-data skal fulle medlemssøk reprodusere syntetisk-
  målingens egenskaper — null algoritmiske aborter og stabile felle-sett
  under backoff 1↔2; brudd ⇒ remåling med ekte-data-fiksturer;
  (ii) S-6-måling (degradert data) i 4a — divergens der gjenåpner
  beslutningen (måleplanens §8.2-plaster);
  (iii) vise-versa-vakt: hvis 4a-ytelsesarbeidet ikke når F3.5-budsjettet
  med spakene over, revurderes F12 med utvidet S-7-måling FØR
  ambisjonen senkes.

## Bekreftelse

- `packages/routing`: ensemble-orkestreringen (fase 4a) kaller samme
  `planRoute`/søkekjerne for medlemmer som for kontroll — ingen egen
  medlemsmotor; `scalarSearchMode`/korridor brukes kun bak eksplisitte
  måle-/S1b-opsjoner. Arkitekturtest-kandidat: F4.2-statistikk kan kun
  konstrueres fra fulle søkeresultater.
- E1′-forkravstestene (`e1-forkrav.test.ts`) og regresjonstesten på m24
  står som permanente vakter.
- Måleplanens §8.1-semantikk gjenfinnes i `bailout.ts` (backoff 1).
