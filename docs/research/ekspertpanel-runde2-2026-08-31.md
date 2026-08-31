# Ekspertpanel runde 2 — tre utfordrere + ekspertenes tilsvar

- Dato: 2026-08-31
- Status: pågår — utfordrer-kritikkene ferdige, tilsvar fra de tre første
  ekspertene ventes (fylles inn i §5)
- Metode: tre kreative problemløser-agenter (djevelens advokat, lateral
  tenker, pragmatiker) utfordret runde 1
  (`ekspertpanel-2026-08-31.md`); kritikken sendes så tilbake til
  matematiker-, værruting- og ytelsesagentene (som beholder konteksten fra
  runde 1) for tilsvar. Simulerte fagperspektiver, ikke reelle personer.

## 1. Djevelens advokat — angrep på grunnantakelsene

Rangert etter trussel mot beslutningsgrunnlaget:

1. **E1 måler feil størrelse: en plan er en strategi, ikke et spor.**
   Kravspeken (S2/F5.2) forutsetter adaptiv seiler («revider herfra»).
   Relevant robusthet: «finnes gode fortsettelser fra ethvert punkt på
   planen, i alle medlemmer?» Fast-rute-evaluering blander to feilmoder:
   (a) ruten blir tregere i medlem k (ufarlig) vs. (b) ruten er en *felle*
   i medlem k. Scenario: direkterute Skjæløy→Skagen «gjennomførbar 28/30»
   får grønt lys, men står ved time 20 førti nm fra havn når fronten
   treffer i de 2 dårlige medlemmene; kystrute via Bohuslän, 2 t tregere,
   har bail-out hver time i alle medlemmer. Fast-rute-evaluering rangerer
   fella øverst. F4.6s bail-out-metrikk er statisk/geometrisk og redder
   det ikke. Matematikerens regret-diagnostikk (skalar re-opt per medlem)
   er ikke fotnote — det er selve robusthetsproduktet.
   *Falsifiserbart:* re-optimering fra 3–4 punkter langs golden-rutene per
   medlem; divergerer kandidat-rangeringen på kryss-/frontscenarioer, er
   E1 utilstrekkelig alene.
2. **Fast-rute-evaluering er ikke veldefinert under vindskift.** Frossen
   kryss-sikksakk i medlem med 25° dreid vind → «useilbar/motor»; reell
   seiler bauter. F4.2-gjennomførbarhetsandelen forurenses av
   evaluator-artefakter — samme feiltype produksjonsutvikleren advarte mot
   ved hard pruning. Fiks med bauting-i-korridor = mini-ruter, og
   «millisekunder» ryker. *Falsifiserbart:* fast spor + enkel
   bautekvivalens (motvind-ben → distanse×1/VMG-faktor) vs. full
   re-optimering på golden-kryssetappen med ±30°-perturbasjoner, innenfor
   N5-toleranse.
3. **Tynn-front-hypotesen motsies av panelets egne data.** Var fronten
   tynn, ville cellCap 6→4 vært inert — men den endret ruten på
   kryssetappen: ≥5 etiketter sameksisterer og er avgjørende der. Snittet
   1,2–1,5 skjuler halen; halen bor på kryss. Betinget sektornøkling
   (kollaps ved tack=0) sparer ingenting der tack≠0 — potensielt no-op i
   regimet som sprengte budsjettet. *Falsifiserbart:* antikjede-histogram
   betinget på etappetype (beat vs. slør) på begge golden-typer.
4. **Konsensus delvis fabrikkert av felles framing.** Alle fire leste
   samme dokument med samme problemformulering — ett ensemble-medlem
   samplet fire ganger. «Ingen kommersiell gjør per-medlem-Pareto» er et
   overlevelsesargument: for en differensiator er det forventet, ikke
   evidens mot. Tidsekspandert graf ble aldri benchmarket (ADR-0004
   innrømmer det).

**Tåler angrepene:** E2 (<1 s var aldri spec-forankret), E4–E8
(kartfunnene — ingen svakhet funnet, viktigst av alt). Delkonsesjon:
fast-rute-evaluering er trolig riktig som *komponent*; måldominans-pruning
er reelt tapsfri. Operativ konsekvens: E1/E3 nedgraderes til hypoteser med
definert falsifiseringsmåling (1–2 dager på PC) som gjøres FØR ADR-0005.

## 2. Lateral tenker — fem retninger utenfor panelets liste

1. **Regime-klynging i værpakken:** batch-jobben klynger 30 medlemmer
   deterministisk (k-medoids på vindfelt 6/24/48 t over rute-bbox) →
   regime-etiketter + medoid-ID i pakkemetadata. Klienten kjører fullt
   Pareto-søk kun per medoid (2–4), evaluerer alle 30 langs hele
   rutefamilien. 30 søk → 3–4 søk + 30 evalueringer (~45 s → 8–12 s
   nettbrett) MED topologi-diversitet ren kontroll-evaluering mangler.
   F4.2 må omdefineres til «beste rute i familien per medlem» (Magnus).
   *Eksperiment (½ dag):* klyng spike-ensemblet; avkreftet hvis > ~20 %
   av medlemsrutene avviker topologisk (> 0,5 nm korridor) fra sitt
   regimes rute.
2. **Profilsøk over avgangsvinduet** (RAPTOR-inspirert): søk én avgang,
   evaluer rutefamilien med forskjøvet avgang over hele vinduet; re-søk
   kun ved topologibrudd. Angriper 5–7×-multiplikatoren i S1 som hele
   panelet lot stå. Trenger «re-søk utløst»-teller (N2). *Eksperiment
   (2 t):* golden-kontrollrute under avgang +1…+8 t vs. fulle søk;
   avkreftet hvis avgangsrangeringen endres utenfor N5.
3. **Grov-til-fin korridorforfining (HPA*-stil, anytime):** grovt søk
   (cellDeg 0,04–0,08, 12–15°, skalar) → fullt Pareto-søk i 3–5 nm-tube
   rundt grovruten m/utvidelse ved abort. Tube ≈ 10–20 % av søkerommet →
   3,7 s mot ~1 s; leverer F3.5s progressive kontrakt bokstavelig. Av i
   exactMode; «tube brukt» i diagnostics. *Eksperiment (1 dag):* 7
   golden-fiksturer grovt; avkreftet hvis fin rute forlater 5 nm-tuben
   (særlig kryss).
4. **Prefabrikkert led-graf i skjærgård (F1.0-hjemlet):** chart-pack
   bygger glissen graf (farledsakser, sund, synlighets-kanter,
   forhåndsverifisert mot masken); motoren følger kanter i trange
   farvann, isokron offshore. Angriper sektor-eksplosjonens rot i
   skjærgård; segmentVerdict flyttes til byggetid. Størst arbeid; egen
   bølge. *Eksperiment (1–2 dager):* graf for Skjæløy-bboxen; avkreftet
   hvis grafruten taper > 2 % mot fritt søk på Bohuslän-golden.
5. **Envelope-felt:** syntetiske per-celle ensemble-P10/P90-felt i
   pakken; søk under P90 skranker gjennomførbarhet for ~alle medlemmer
   med 2 søk. Kun gyldig for monotone harde constraints; aldri
   tidsstatistikk; merkes strukturelt. *Eksperiment (½ dag):* verifiser
   at P90-feasible ⇒ feasible i ≥ 29/30 medlemmer.

Anbefalt kombinasjon: 1+2 (angriper hver sin multiplikator, 30× og 6×) +
panelets alloc-frie loop; 3 for opplevd hastighet; 4 langsiktig; 5 krydder.
Alle eksperimentene kjører på eksisterende golden-harness/spike-data:
~3–4 dagers falsifiseringsarbeid totalt.

## 3. Pragmatikeren — kost/nytte og rekkefølge

1. **Ytelsesstigen løser et problem E1 allerede har fjernet.** Med E1 er
   ensemblet nesten gratis; gjenværende budsjett er kontrollsøkene
   (S1 ≈ 8 avganger × 4 s PC ≈ 32 s → 60–120 s nettbrett). Det tallet
   finnes ikke: **nettbrett-målingen (backlog pkt. 8) er viktigere enn
   GC-andel og antikjede-histogram.** Alt perf-arbeid før den er
   spekulasjon.
2. **«To motorer»-risikoen i E1 løses med én formulering: evaluatoren ER
   ekspansjonssteget.** Tynn løkke som kaller samme stepKinematics/kost
   med «neste veipunkt» i stedet for suksessor-generering. ADR-0005-krav:
   (i) delt kjerne-modul, ingen kopiert kinematikk; (ii) egenskapstest
   `evaluator(rute fra søk, samme felt) == søkets kost` innenfor
   toleranse. Nå: én dag; etter fase 3–4-akkresjon: en uke.
3. **Kritisk vei er fase 3 + minimal app — ingen panelanbefaling ligger
   på den.** Motoren på 4 s er allerede god nok til første ekte
   planlegging. Mål: tidlig vår 2027; bufferen brukes på fase 3.
4. **E5 «før skala» = fase 5, ikke nå** — forutsatt to billige grep
   straks: byggetids-QA-validatoren (dybdepunkt per bånd) og
   kjent-svakhet-golden. E4 (VALSOU) er billig og tas før første ekte
   bruk. Full stitching venter til Skandinavia-dekning.
5. **E8 i full drakt er bedriftsprosess for én bruker.** Kart-først-
   prinsippet beholdes; proveniens-apparatet forenkles: Magnus verifiserer
   de 11 punktene mot kartplotteren én kveld, koordinat + kartreferanse i
   tabell.

Alternativ sekvens: uke 1 beslutninger (E1 m/én-sannhet-krav, E2, E4,
vertex-forbud) + nettbrett-måling; uke 1–2 QA-validator, kjent-svakhet-
golden, kart-først-verifisering av de 11, code-review routing/charts;
uke 2–7 **fase 3**; uke 7–10 fase 4a m/E1-arkitektur, perf kun ved behov
(GC-måling → alloc-fri loop → måldominans-pruning). Kan vente:
fareavstandsfelt, ensemble-deling, sektornøkling, ε-dominans, E6,
E7-grep, stitching. Aldri (til bevist nødvendig): WASM, bidireksjonalitet,
cellCap 4, per-medlem-Pareto. Sum: ~2,5 mnd til første ekte seilas-
planlegging med robusthetstall.

Står seg etter kritikken: E1 (med én-sannhet-formulering), E2, E4,
E3s fraråding av cellCap 6→4, kart-først-prinsippet. De to tingene
rekkefølgen faktisk straffer å utsette: evaluator-kjernen (delt modul) og
vertex-forenklings-forbudet i spec.

## 4. Konvergens på tvers av utfordrerne

- Alle tre: **målinger/eksperimenter før ADR-0005** — og de peker på
  ulike, komplementære målinger (regret-sammenligning,
  evaluator-vs-reopt, betinget antikjede-histogram, nettbrett-måling,
  regime-klynge-eksperiment, profilsøk-eksperiment). Samlet ~1 uke på PC
  med eksisterende harness.
- Djevelens advokat og lateral tenker konvergerer uavhengig mot
  **rutefamilier/topologi-diversitet** som det fast-rute-evaluering
  mangler — regime-klynging (lateral §2.1) er en konkret mekanisme som
  svarer på felle-kritikken (djevel §1.1).
- Ingen av de tre rører kartfunnene E4–E8 faglig; pragmatikeren justerer
  kun timing (E5-stitching og E6 kan vente; E4, QA-validator og
  kjent-svakhet-golden kan ikke).

## 5. Tilsvar fra runde 1-ekspertene

### Matematikeren — reviderer E1, forsvarer tynn front betinget

Innrømmer tre feil eksplisitt: «millisekunder» var galt for kryssetapper;
regret/fortsettelses-analyse skulle vært kjerne, ikke fotnote; betinget
sektornøkling ble presentert uten regimeforbehold.

- **E1 revidert til todelt robusthetsdefinisjon:** R1 (planrobusthet) =
  fordeling av evaluert kostnadsvektor over medlemmer; **R2 (fellefrihet)**
  = for hvert medlem/punkt der fortsettelsen feiler hardt: finnes farbar
  vei til bail-out-havn innen skranke? Beregnes ved re-søk **kun fra
  første feilpunkt, kun i feilende medlemmer** (i felle-scenarioet: 2
  småsøk, ikke 30 fulle). Felle ⇔ R2 feiler.
- **Vindskift-artefakten løses med korridor-begrenset evaluering:**
  evaluatoren velger kurs fritt (skalar) innenfor 3–5 nm-tube rundt
  ruten — en mini-ruter, ja, men ~5–10 % av fullt søkerom.
  «Ordensmagnituder billigere enn 30 Pareto-søk» står; «millisekunder»
  trekkes.
- **Tynn front og cellCap-observasjonen er forenlige** (snitt skjuler
  hale; halen bor på kryss — derfor frarådet han 6→4). Men målt
  budsjettbrudd er i slør-regimet, der betinget sektornøkling virker.
  **Antikjede-histogram per regime** (kryss vs. slør) flyttes opp som
  port for spaken.
- **A–D:** A sunn (stratifisert utvalg) MED outlier-vakt — medlemmet
  langt fra sin medoid er nettopp trap-medlemmet; individuelt søk over
  avstandsterskel. B sunn heuristikk med målbar restrisiko. C sunn kun
  som **multi-tube fra hvert grovt Pareto-alternativ** (én tube dreper
  diversiteten). **D avvises som robusthetsmål** — seilkostnad er ikke
  monoton i vind, P90-felt er ikke fysisk koherent; gyldig kun som
  konservativ screening av monotone harde constraints (Hs, TWS).

### Værruting-utvikleren — hovedanbefaling står, tre presiseringer

- **Angrep 2 traff en løsning han ikke foreslo:** hans forslag er eget
  skalart *søk* per medlem — som bauter selv ved 25° dreining.
  Bransjekunnskap: qtVlm/Expedition har «evaluer rute under annet
  felt»-modus, brukt som stresstest av plan, **aldri** som
  gjennomførbarhetsstatistikk. VMG-bautekvivalens (~1,3–1,4 for cruiser)
  er god nok for ankomstspredning i plan-diff (S1b), ikke for F4.2.
- **Felle-scenariet er reelt** (lee-shore/ingen-exit-klassen);
  kommersielle verktøy løser det ikke automatisk — kravspeken er foran
  bransjen med F4.6. Riktig fiks: **konsekvensvektet gjennomførbarhet**
  i fase 4-aggregeringen (trafikklys-rød ved «skjør + ingen bail-out»),
  ikke Pareto i søket. 28/30 med to katastrofale medlemmer uten exit
  rangeres under 25/30 med exit overalt.
- **Regime-klynging:** kjent i meteorologi (ECMWF-klusterprodukter) og
  akademisk offshoreruting; ingen seilruter i produksjon. Skagerrak-
  forbehold: frontpassasje-spredning er *timing* (kontinuerlig), som
  klynging kan kollapse; klyngetilhørighet flakker mellom modellkjøringer
  (S1b-fellen). → navngitt fase 4b-forskningsspor, ikke v2.0-kjerne.
  **Profilsøk avvises** (topologibrudd-deteksjon vanskeligere enn
  re-kjøring med delt A*-felt).
- Enig med pragmatikeren: kritisk vei er fase 3; ytelsesjakt etter
  første nettbrett-måling med ekte data.
- Differensiator-svaret: «differensiatorer skal måles inn, ikke antas
  inn» — valideringsmålingen (begge varianter én gang på PC) avgjør.

### Ytelsesingeniøren — reviderte prioriteringer, konkrete fallgruver

- **Nettbrett først, men med instrumentert bygg** — pruned-tellerne
  finnes alt i resultContext(); GC-/maske-andel er ½ dag i samme bygg.
  Én måling, begge svar.
- **E1-evaluatoren er billigere enn fryktet:** kinematikk/kost/harde
  sjekker er allerede rene frie funksjoner i expand.ts/tack.ts;
  evaluatoren er en ny fil som looper over dem. Fallgruver: egenskapstest
  må kjøre mot **ukonsolidert stegsekvens** (ikke legs), halseside-
  tilstand må tres gjennom, og semantisk valg må gjøres eksplisitt:
  **styr-mot-veipunkt, ikke replay-av-kurs** (strøm driver båten av
  linjen under perturbert vær). Evaluatoren bygges FØR alloc-fri
  hot-loop (ellers dobbeltarbeid i delte funksjoner).
- **A (tube):** billig å bygge (CellGrid tar cellDeg som parameter;
  tube = Uint8-bitmap), men treffer ADR-0004 i hjertet — Pareto-
  mangfoldet ligger ofte utenfor tuben. Reserve med golden-vakt, ikke
  førstevalg. **B (led-graf):** fase 5+, men flisformatet bør reservere
  plass for prefab-lag NÅ (gratis). **C (profilsøk):** nesten gratis
  gitt evaluatoren; endepunkts-re-søk + re-søk ved hard avvisning/
  kosthopp; mellomliggende avganger merkes «evaluert, ikke søkt» (N2).
  Realistisk 2–3×. Anbefales. **D:** betinget av billig
  topologi-spredningsmåling (hvor ofte gir medlems-søk annen topologi
  enn kontrollen?).

## 6. Endelig syntese etter to runder

**Det store bildet:** Runde 2 endret E1 substansielt, bekreftet E2/E4–E8,
og gjorde E3 måling-portet. Alle tre ekspertene aksepterer nå
pragmatikerens hovedpoeng: kritisk vei er fase 3 + minimal app, og
nettbrett-målingen går foran alt ytelsesarbeid.

**Én reell divergens gjenstår — E1s mekanisme per medlem:**
- Værruting-utvikleren: eget skalart **søk** per medlem (fullt søkerom,
  jevn kjent kvalitet, enkel semantikk).
- Matematikeren: korridor-begrenset **evaluering** (skalar mini-ruter i
  tube rundt kontrollruten) + målrettet re-søk fra feilpunkt i feilende
  medlemmer (R2/fellefrihet).
- Ytelsesingeniøren viser at begge bygges av samme delte kjernefunksjoner
  — forskjellen er søkeromsavgrensning, ikke arkitektur.
Avgjøres empirisk: valideringsmålingen (skalar-søk vs.
korridor-evaluering vs. full Pareto per medlem, én gang på PC,
P50/P90 + avgangsrangering + gjennomførbarhet mot N5-toleranse).

**Samstemt etter to runder:**
1. Ikke frossen-rute-evaluering som gjennomførbarhetsgrunnlag (alle).
2. Ikke per-medlem-Pareto; ikke cellCap 6→4; ikke <1 s-mål (alle).
3. **Fellefrihet/konsekvensvektet gjennomførbarhet inn i fase 4-spec:**
   F4.6-bail-out inn i trafikklyset; «skjør + ingen exit» = rød.
   (Djevelens advokat → bekreftet av matematiker og værruting.)
4. Evaluator bygges nå, som tynn løkke over delte kjernefunksjoner, med
   én-sannhet-egenskapstest — før hot-loop-arbeid. ADR-0005-krav.
5. Nettbrett-måling med instrumentert bygg går foran alt perf-arbeid.
6. Envelope-P90 kun som hard-constraint-screening; regime-klynging →
   fase 4b-spor m/outlier-vakt; profilsøk: uenighet (perf anbefaler,
   værruting avviser) — lav kostnad gitt evaluatoren, kan prøves med
   ærlig UI-merking; tube som reserve m/golden-vakt; led-graf fase 5+
   men flisformatet reserverer prefab-lag nå.
7. Kartfunnene: E4 (VALSOU) + QA-validator + kjent-svakhet-golden før
   første ekte bruk; E8-lite (kart-først, én kveld, tabell); E5-stitching
   og E6 (CATZOC-kvantitativ) kan vente til skala.

### Revidert beslutningsliste til Magnus (erstatter E1–E8-tabellen i runde 1)

| # | Beslutning | Status etter runde 2 |
|---|---|---|
| E1′ | Per-medlem-mekanisme: skalart søk vs. korridor-evaluering + R2-re-søk | **Åpen — avgjøres av valideringsmåling på PC**; begge bygges på delt kjerne. Frossen-rute-evaluering avvist |
| E1″ | Fellefrihet (R2) og konsekvensvektet gjennomførbarhet i fase 4 | Samstemt anbefalt — inn i robusthet-spec |
| E2 | <5 s nettbrett + progressiv tegning, forkast <1 s | Uendret, uimotsagt |
| E3′ | Måldominans-pruning (tapsfri) | Står; sektornøkling og øvrige spaker portet bak antikjede-histogram per regime |
| E4 | VALSOU-semantikk for Grunne | Står — før første ekte bruk. Kun Magnus |
| E5′ | Åpne-kurver: QA-validator + kjent-svakhet-golden nå; stitching ved skala | Justert timing (pragmatiker), faglig uimotsagt |
| E6 | CATZOC kvantitativt | Står faglig; kan vente til skala |
| E7 | Flis-grep + vertex-forbud i spec | Står; vertex-forbudet skrives nå (gratis), grep ved behov |
| E8′ | Golden kart-først, forenklet proveniens (tabell, én kveld) | Justert (pragmatiker) |
| NY-1 | Rekkefølge: beslutninger + målinger (~1 uke) → fase 3 (kritisk vei) → fase 4a m/evaluator | Samstemt |
| NY-2 | Evaluator-kjerne + én-sannhet-test bygges nå (før perf-arbeid) | Samstemt — de to tingene som blir dyrere av å vente (+ flisformat-reservasjon) |

Forutgående målinger (~1 uke på PC m/eksisterende harness, ingen
beslutning trengs): nettbrett-måling m/instrumentert bygg,
antikjede-histogram per regime, valideringsmåling av
per-medlem-variantene, topologi-spredningsmåling, regret-sammenligning
fra 3–4 punkter langs golden-rutene.

## 7. Beslutninger 2026-08-31 (Magnus)

Magnus besluttet 2026-08-31, etter gjennomgang av pro/cons:

- **E4: VALSOU-modellen vedtatt.** Punktfarer (grunner) gir no-go kun når
  angitt dybde < kravet ved oppslag, eller dybde mangler; ellers ingen
  blokkering. Fasit-tester i begge retninger kreves.
- **E2: <1 s-målet forkastet.** Ytelsesmålet er spec §7s <5 s på
  nettbrett + progressiv tegning. Tube-metoden er reserve hvis interaktiv
  bruk senere krever mer.
- **E7: forbud mot geometrisk forenkling** av sikkerhetspolygoner i
  routing-pakken skrives inn i farbarhetsmaske-spec nå; krymping kun via
  de trygge grepene.
- **E8: kart-først-lite vedtatt.** Golden-punkter velges i offisielt
  sjøkart med forventet svar notert FØR testkjøring; koordinat +
  kartreferanse i tabell. Full proveniens-apparat droppet.
- **E1′: utsatt til målepakken** — avgjøres empirisk mot full Pareto som
  fasit (som anbefalt).
