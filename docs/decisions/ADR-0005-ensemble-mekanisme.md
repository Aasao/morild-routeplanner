# ADR-0005: Ensemble-mekanisme — fullt Pareto-søk per medlem på kontrolloppløsning

- Status: **vedtatt 2026-09-01 av Magnus** (etter fem-agenters votering,
  alle ENDRE→godkjenn; F3.5-revisjonen gjennomført i kravspeken samme
  dag)
- Dato: 2026-09-01
- Besluttet av: Magnus

## Kontekst

ADR-0004 valgte isokron/A*-hybrid med Pareto-etiketter for
kontrollkjøringen, men lot mekanismen for de 30 ensemble-medlemmene stå
åpen (E1′, `docs/research/ekspertpanel-runde2-2026-08-31.md` §6).
Kandidatene var (A) eget skalart søk per medlem, (B) korridor-evaluering
+ R2-re-søk, mot (F) fullt Pareto-søk per medlem som fasit. Premisset
for debatten var at F var for dyr (F3.5: < 60 s ensemble på nettbrett).

Avgjort empirisk med forhåndsregistrert måling
(`docs/research/maaleplan-e1-2026-08-31.md`; resultater
`maaling-e1-2026-08-31.md`; rådata `maaling-e1-raadata*/`; commit
24322e2 + b610dff). Sentrale målte fakta:

1. **Kostnadspremisset var falskt.** Skalart søk sparer 2–11 %
   etiketter (deterministiske tellere; veggklokke 5–21 %, ikke
   reproduserbar og degradert til deskriptiv). Forklaring: målt tynn
   Pareto-front (~1,2–1,5 etiketter/tilstand) — etikett-taket kutter
   nesten ingenting; kostnaden bor i sektornøkkel-tilstandsrommet og
   kursoppløsningen.
2. **B er diskvalifisert for F4.2-bruk.** Navigasjonsfelle m24 (utvei =
   25,4 nm bauteomvei 9,56 nm utenfor Bs 4 nm-rør) bommes på alle 5
   avganger — feil felle-sett er diskvalifiserende per forhåndsregistrert
   regel. Overbestemt av S-7-kollaps (0/30 mot 13/30) og P90-avvik
   10–19 %. Feilen er geometrisk (ethvert fast rør feiler for en
   tilstrekkelig bred omvei) — ikke oppløsning: F12/A12 finner
   m24-utveien med 30 kurser.
3. **A består felle-kriteriet overalt** (skalart fullmaske-re-søk finner
   m24-utveien). Under produktets egen rangering (P90, F4.4/F4.5)
   består A også begge rangeringskriteriene. Gjenstående brudd er
   S-5s P50-verdi (+3,24 %) — med kjent bimodal-artefakt: paret
   median-differanse er 0,0000, avviket bæres av 2/30 medlemmer som
   krysser et gap fasitens median ligger i. Tallets størrelse er delvis
   metrisk artefakt (samme forstørrelse rammer F12); mekanismen
   (per-medlem-regret i myke dimensjoner) er reell men liten.
4. **Grovere medlemsoppløsning (12°) er IKKE trygg for
   gjennomførbarhetstall:** F12/A12 består felle-settet, men bryter
   ±1-medlem-kriteriet på S-7 med fortegnsflip (+4/+2/−4) og P90-avvik
   opp til +56 %. At gjennomførbarhetsandelen er funksjon av en
   ytelsesparameter bryter N3s ånd. Gevinst uansett liten (7–10 % mot
   10°-fasit).
5. **S-5 diskriminerer ikke rangering under P90** (0,028 %-spredning,
   fasitens toppavganger bit-like) — matrisen mangler i dag en fikstur
   som tester rangering under produktstatistikken. Bygges i 4a.

## Beslutning

Ensemble-medlemmene beregnes med **samme fulle Pareto-søk og samme
oppløsning som kontrollkjøringen** (mekanisme F). Robusthetstall
(gjennomførbarhetsandel, felle-sett/R2, P50/P90-spredning) konstrueres
utelukkende fra slike fulle medlemssøk. Korridor-evaluatoren beholdes
kun som S1b-diff-verktøy («holder gårsdagens plan?»), merket slik i API
og UI; dens konservative falske positiver er AKSEPTABLE i den rollen
(alarm utløser bare nytt fullt søk) og skal ikke «forbedres» bort.
R2-semantikken fra måleplanens §8.1 (re-søk fra siste lovlige tilstand;
backoff definert i fysisk tid min(Δt, 1800 s)) blir produksjonssemantikk
for felle-deteksjon.

**Denne beslutningen krever en datert kravspek-revisjon av F3.5:**
setningen «medlemmer kjøres med redusert kursoppløsning (10–12°)»
strykes (målt utrygg, punkt 4); < 60 s-budsjettet består som bindende
mål, men den sannsynlige oppfyllelsen er **progressiv semantikk** (se
Konsekvenser). ADR-en overstyrer ikke kravspeken i stillhet —
revisjonen gjøres ved godkjenning.

## Alternativer vurdert

- **(A) Skalart søk per medlem:** vraket. Bærende grunn: besparelsen er
  marginal (2–11 % etiketter) — ved så liten rabatt er en andre
  motor-modus med noen som helst målt regret og egen vedlikeholdsflate
  dårlig handel; F vinner på enkelhet og arvede korrekthetsgarantier
  selv om S-5-bruddet diskonteres helt (bimodal-forbeholdet, punkt 3).
  Beholdes bak opsjon som målevariant.
- **(B) Korridor-evaluering + R2-re-søk:** vraket for robusthetsbruk —
  geometrisk grunnfeil, ikke tunbar (punkt 2). Beholdes for S1b-diff.
- **(F12) Fullt Pareto på 12° for medlemmer:** vraket som standard
  (punkt 4). Revurderes kun via vise-versa-porten under.
- **v1-stil per-celle-skalar (sektorkollaps):** vraket a priori, ikke
  målt — ADR-0004 avvik 1+3 innførte sektortilstanden av
  korrekthetsgrunner (bautstraff-regnskap); å gjeninnføre flat
  bautstraff per medlem er nøyaktig biasen E1′ skulle verne F4.2 mot.
  Står her for fullstendighet, ikke som glemt ende.
- **Regime-klynging (2–4 medoid-søk):** ikke målt; fase 4b-spor med
  outlier-vakt, uendret av denne ADR-en.

Merk: **betinget sektornøkling** (E3-sporet) er ikke et alternativ til F
— den akselererer F selv — og står derfor blant ytelsesspakene under.

## Konsekvenser

- **Robusthetstallene arver søkets fulle korrekthetsgarantier** — hele
  klassen evaluator-/oppløsningsartefakter forsvinner fra F4.2. Én
  motor, én sannhet, også i ensemblet. P50-terskler i
  produksjonsrapportering suppleres alltid med paret per-medlem-
  differanse (bimodal-lærdommen).
- **Ytelsesgapet er et ordensmagnitude-problem og ADR-ens største åpne
  regning — sagt i klartekst:** 67–99 s per avgang på PC × 2–4×
  nettbrett × 5–8 avganger ≈ **11–53 minutter rått** mot budsjettets
  60 s. Fase 4a må finne ~10–40×. Spakene under er **uvaliderte,
  uprioriterte kandidater** (prioritering skjer i 4a-specen med
  nettbrett-tallet foran seg); grove anslag: profilsøk over
  avgangsvinduet ~3–4×, alloc-fri hot-loop 1,5–2×, delt cache
  1,2–1,5×, måldominans-pruning og betinget sektornøkling umålt,
  arena-/buffergjenbruk i worker-poolen (N6-relevant) — samlet
  plausibelt ~5–12×. **Det sannsynlige utfallet er derfor en semantisk
  F3.5-revisjon, ikke en teoretisk:** kontrolltabell på sekunder; full
  ensemble-analyse for valgt/topp-avgang < 60 s; øvrige avganger
  strømmet i bakgrunnen over minutter. Dette er en reell mulig utgang
  Magnus godkjenner med åpne øyne.
- **Presiseringer til spakene:** (a) delte read-only-cacher for
  vær-UAVHENGIGE oppslag (klaring, segment, TSS-geometri, natt-tabell)
  er tillatt på tvers av medlemmer i produksjon — bit-identiske svar
  uavhengig av innsettingsrekkefølge; per-medlem-isolasjon kreves kun i
  målerigger (målingens cache-forbud var variantisolasjon, ikke
  semantikk). (b) τ-felt-screening kan kun styre BEREGNINGSREKKEFØLGE
  og hva som ennå ikke er beregnet (progressivitet) — den erstatter
  aldri et F4.2-tall; alt som rapporteres kommer fra fulle søk.
  (c) **Sekvensiell tidlig-stopp** (stopp medlemsberegning ved
  forhåndsregistrert konfidensregel) endrer F4.2-semantikk og er et
  eksplisitt 4a-spørsmål til Magnus — aldri en stille optimalisering.
- **Vi gir avkall på** bransjenormens enkelhet og 12°-snarveien.
  Ombestemmelse er billig: A/A12/F12 ligger bak opsjoner og kan remåles.
- **Falsifiseringsporter (daterte, ikke dekorative):**
  1. **4a-start-port:** nettbrett-målingen (byggstatus pkt. 8, fortsatt
     umålt) kjøres FØR 4a-designet prioriterer spaker.
  2. **Vise-versa-port:** «F3.5 ikke nådd» defineres som > 60 s per
     avgang på nettbrett MÅLT ETTER konstantfaktor- og delingstiltakene
     — da utløses F12-remåling (med utvidet S-7-fiksturssett)
     automatisk, FØR progressiv-semantikk-revisjonen vedtas som endelig.
  3. **Ekte-data-port:** på ekte MEPS-data skal fulle medlemssøk vise
     null algoritmiske aborter og felle-sett der backoff-uenige
     (1↔2) avganger merkes inkonklusive og ekskluderes med
     rapportering; andel inkonklusive > 20 % ⇒ remåling med
     ekte-data-fiksturer. S-6-målingen (degradert data) kjøres i 4a;
     divergens der gjenåpner beslutningen.
  4. **Ny 4a-målingsoppgave:** P90-separert rangeringsfikstur bygges
     (punkt 5 i konteksten — dagens matrise tester ikke rangering under
     produktstatistikken).

## Bekreftelse

- **Arkitekturtest (KRAV, ikke kandidat):** F4.2-statistikk kan kun
  konstrueres fra fulle søkeresultater — `packages/routing`s
  ensemble-orkestrering kaller samme `planRoute`/søkekjerne for
  medlemmer som for kontroll; `scalarSearchMode`/korridor er kun
  tilgjengelig bak eksplisitte måle-/S1b-innganger. Testen skrives i
  tools/arch-tests i 4as første bølge.
- E1′-forkravstestene (`e1-forkrav.test.ts`) og m24-regresjonstesten
  står som permanente vakter.
- Måleplanens §8.1-semantikk gjenfinnes i `bailout.ts` (backoff i
  fysisk tid etter revisjonen over).
- Kravspekens F3.5 bærer datert revisjon som refererer denne ADR-en.
