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

## 6. Daterte revisjoner 2026-08-31 (før kjøring — etter
## djevelens-advokat-review av planen, besluttet av Magnus)

1. **§1.5 R2 operasjonalisert:** *Felle* i medlem m ⇔ det finnes et
   punkt p på ruten der fortsettelsen feiler hardt i m (hard avvisning:
   farbarhet/no-go, maxTws/maxHs, TSS — IKKE ren treghet), og **fullt
   Pareto-re-søk** fra (p, t(p)) under medlem m's vær ikke finner farbar
   vei til noen bail-out-havn innen **6 timer** seilingstid. Bail-out-
   settet er en interim havneliste (skrives før kjøring, erstattes av
   F4.6-boken i fase 4); anløpbarhet vurderes under MEDLEMMETS vær
   (pålandsvind/Hs ved havn kan diskvalifisere havnen i det medlemmet).
   Fasiten er dermed uavhengig av variant Bs mekanikk (B bruker
   korridor-/skalar-re-søk; fasit bruker fullt Pareto-re-søk).
   Felt-/screening-metoder definerer ALDRI felle-settet; deres falske
   flagg telles i egen presisjonskolonne.
2. **To nye fiksturer:** **S-7 to-regime-blanding** — diskret bimodal:
   ~15 medlemmer der fronten passerer ruten, ~15 der den stopper/snur →
   topologisk splitt (perturbasjonsfamilien tidsskyv/rotasjon/skalering
   er unimodal og kan ikke skille variantene); **S-8 vind-mot-strøm**
   (Skagerrak, bratthets-derating F3.2) — egen felle-mekanisme.
3. **S-3 varierer to parametre uavhengig** (front-timing × postfrontal
   styrke/Hs, fast tabell uten RNG) slik at felle-settet ikke er en
   sammenhengende terskel-blokk; fiksturen skal ha **positiv kontroll**
   (≥ 1 medlem med felle per konstruksjon: postfrontal Hs > maxHs) og
   **negativ kontroll** (variant uten felle). Frontsyntese per
   steg3-plan-dokumentet (analytisk tanh-front, vindstille-stripe,
   frikoblet gammel sjø, kalibrert mot v1-logg-skann).
4. **Presedens:** topp-avgang-flipp diskvalifiserer kun UTENFOR
   toleransebåndet (S-5 er designet til å vippe; flipp innenfor båndet
   er uavgjort, som §4 allerede sier).
5. **Eskaleringsstigen har grenbetingelse:** ved brudd kreves
   årsaksattribusjon før valg av neste trinn — feiler variant B på
   medlemmer der re-søk ikke ble utløst (evaluator-artefakt) eller på
   felle-identitet der feilen ligger i R2-mekanikken (rammer A og B
   likt), hoppes hybrid over og full Pareto per medlem vurderes direkte.
6. **Kostnadskolonne:** evaluator-/søkekostnad per variant rapporteres
   eksplisitt per fikstur (kostnadssiden måles, ikke antas).

## 8. Daterte revisjoner 2026-08-31 (kveld) — vedtatt av Magnus etter
## fagagent-review av M1–M3, FØR kjøring

1. **M1 vedtatt = B, formulert diskretiseringsuavhengig:** R2-re-søket
   starter fra **siste lovlige tilstand langs planen** («da du sist var
   lovlig, kunne du kommet i havn?»). `backoffSteps` **låses til 1**;
   0/1/2 kjøres kun som deskriptiv sensitivitetskolonne — er felle-settet
   ustabilt mellom 1 og 2, er fiksturens felle-kriterium INKONKLUSIVT
   (nær-degenerert), aldri bestått/strøket. Sanity før matrise: S-3 med
   halvert tidssteg skal gi samme felle-sett; endres det, defineres
   backoff i fysisk tid (min(Δt, 1800 s)). Kjent skjevhet noteres i
   rapporten: backoff-1 gir seileren opptil ett tidsstegs «forutseenhet»
   — optimistisk retning. Deskriptiv tilleggskolonne: utvei-margin
   (min. avstand til hard grense langs fluktruten). Værruting-agentens
   alternative semantikk (frafall værtak i startnoden, ærlig flagg) er
   notert som riktig UNDERVEIS-semantikk → fase 6, ikke målefasit.
   Datering (djevelens krav): B ble valgt på grunnlag av fasit-sidens
   degenerasjon alene; ingen A/B/F-sammenligningstall var sett.
2. **M2 vedtatt = revidert C:**
   - **Nytt obligatorisk S-3-medlem med NAVIGASJONSFELLE** (før kjøring):
     utveien blokkeres navigasjonsmessig — nærmeste bail-out-havn
     diskvalifisert av pålandsvind i medlemmet, vei videre krysser
     no-go/TSS-restriksjon, reell utvei er en ikke-opplagt bauteomvei
     som fullt Pareto-re-søk finner. Begrunnelse: dagens felle-sett
     oppstår kun via delt checkHard-kode — uten dette medlemmet har det
     diskvalifiserende kriteriet null diskrimineringskraft mellom
     variantene.
   - **S-5 bygges** (samme felt, forskjøvet avgang). **5 avganger på S-3
     og S-5; 3 avganger på S-1/S-2/S-4/S-7/S-8.** På n=3-fiksturene
     erstattes Kendall-τ med «identisk topp-avgang + ingen flipp utenfor
     toleransebåndet» (τ på n=3 tar verdier i trinn på 2/3 og er
     meningsløst som ≥0,8-kriterium).
   - **S-6 dateres ut til fase 4a med to plaster:** (a) paritetsrøyktest
     FØR kjøring — én eksisterende fikstur uten Hs-data gjennom søk,
     evaluator og re-søk: identiske flaggsett og identisk
     gjennomførbarhet for A/B/F (paritet, ikke måling); rød test ⇒ S-6
     må likevel inn før beslutning; (b) eksplisitt forbehold i ADR-0005:
     beslutningen er reviderbar hvis S-6-målingen i 4a viser divergens.
     Scope-innsnevring noteres: E1′-konklusjonen gjelder
     full-data-regimet.
   - **Abort-paritetstest før kjøring:** algoritmisk abort
     (labelCap/stagnasjon) og vær-ugjennomførbarhet skal telles likt i
     alle tre varianter (konstruert fikstur av hver type).
   - **Variant-isolasjon:** delte felt/Tub/cacher beregnes per variant,
     gjenbrukes aldri på tvers (ellers måles delingsartefakter).
   - «Billigste variant vinner»-dommen felles ikke før minst ett
     nettbrett-kostnadstall foreligger (2–4×-multiplikatoren er umålt).
   - Begrensning som SKAL stå i konklusjonen: fiksturene er syntetiske
     og deler i praksis få synoptiske situasjoner; generalisering til
     ekte MEPS valideres i fase 4a (falsifiseringsterskler i ADR-0005).
3. **M3 vedtatt:** commit av hele bygget FØR kjøring; målingen kjører
   fra låst ref som refereres i rapporten.

## 7. Operasjonaliseringsnotater 2026-08-31 (skrevet FØR kjøring, ved
## bygging av fiksturene og variantene — ingen kriterier endret)

1. **Hva er bygget, og hvor.** Forutsetningene i §1 punkt 1–5:
   - S-3 frontpassasje: `packages/routing/test-fixtures/ensemble-s3-front.ts`
     (front-generatoren i `front-weather.ts`), 30 medlemmer, positiv og
     negativ kontrollvariant.
   - S-7 to-regime: `test-fixtures/ensemble-s7-two-regime.ts`, 15 + 15.
   - S-8 vind mot strøm: `test-fixtures/ensemble-s8-wind-current.ts`
     (feltet i `wind-current-weather.ts`, bratthetsderating i `test-boat.ts`).
   - Variant A: `RouteOptions.scalarSearchMode` (av som standard) +
     `planRouteScalar` i `src/variants.ts`.
   - Variant B: `src/corridor.ts` (rør) + `corridorMemberOutcome`.
   - R2-fasit: `src/bailout.ts`. Interim havneliste:
     `docs/research/bailout-interim.md` og `test-fixtures/bailout-harbours.ts`.
   Grensetilfelle- og avgangsvindu-fiksturene (§1 punkt 2–3) er **ikke**
   bygget i denne runden.
2. **§6.1 presisert — hvor re-søket starter.** Evaluatoren rapporterer en
   `boatLimits`-avvisning i posisjonen båten står i når feilen oppdages, og
   der er været allerede over båtens grense. Et re-søk derfra kan per
   konstruksjon ikke ta ett eneste steg (`checkHardNode` feller startnoden),
   og R2 ville degenerert til en omskrivning av «hard avvisning» — samme svar
   for alle varianter, og §4s viktigste kriterium ville vært tomt. R2 starter
   derfor re-søket **ett tidssteg tilbake**, i det siste punktet på ruten der
   båten fortsatt var lovlig (`R2Config.backoffSteps`, standard 1). Det er
   §6.1s «punkt p der *fortsettelsen* feiler hardt», og det er det eneste
   spørsmålet som kan skille en variant fra fasiten. Den bokstavelige
   lesningen (`backoffSteps: 0`) er beholdt som opsjon; på S-3 gir begge samme
   felle-sett. **Magnus bør bekrefte lesningen før kjøring** — den rører ved
   fasitdefinisjonen, ikke ved kriteriene.
3. **`iterationCap` inne i R2 er skranken, ikke en algoritmisk abort.**
   Re-søkets iterasjonstak settes til 6 t uttrykt i tidssteg. Slike aborter
   rapporteres som «for sent» og skal ikke telle i §4s krav om null
   algoritmiske aborter; det kravet gjelder medlemssøkene.
4. **Motorseiling i S-7.** Testbåtens motor (7 kn) er raskere enn bidevind i
   alt under ~18 kn vind, og da blir kursvalget ren geometri: begge regimene
   tok korteste vei rundt hindringen (målt korridoravvik 4,4 nm, samme side).
   S-7 kjører derfor med motoren av, som golden-scenariet «ren-kryssetappe».
   Motor-dimensjonen i §3 punkt 1 måles på S-3 og S-8, der motoren er på.
