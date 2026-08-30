# Rutemetodikk for seilbåt-værruting — teori og beste praksis

- Dato: 2026-08-30
- Utført av: research-agent (metodikk-gjennomgang, fase 0)
- Status: ferdig — grunnlag for ADR om rutemotor-arkitektur (F3.1)

## Spørsmålet

F3.1 krever at rutemotoren designes fra beste praksis og teori, med v1 som
referanse og fasit-baseline — ikke som mal som porteres ukritisk («ikke legg
for mye vekt på v1s løsninger», Magnus 2026-08-30). Spørsmålet er: hvilken
metodefamilie (isokron, graf-/tidsekspandert søk, dynamisk programmering,
stokastiske metoder) passer best til VÅRE krav — ensemble-gjenkjøring
150–210 ganger, harde geometriske constraints fra farbarhetsmaske/TSS, myke
kostnader (natt, kryssandel, dagslys), progressiv/avbrytbar beregning, og
determinisme — og hvilke konkrete forbedringer fra litteraturen bør tas inn
uansett hvilken familie som velges?

## Kort svar

Isokron-metoden (Hagiwara-tradisjonen) er fortsatt riktig valg som kjerne:
den er naturlig progressiv/avbrytbar, billig per medlem, og v1s spike
(`spike-ensemble-perf.md`) har allerede bevist at den er raskere enn
budsjettet krever for 30 medlemmer × 1 avgang. Men den klassiske
isokron-algoritmen har tre dokumenterte svakheter som v1 arver ukritisk:
**kjegle-begrensning gir retningsbias** (litteraturbekreftet), **rene
cellepruning-heuristikker mister Pareto-optimale ruter** når kostnad har mer
enn én dimensjon (tid + kryssandel + natt), og **diskret bautstraff er en
forenkling** av det teoretisk riktige — å behandle tack/gybe som en diskret
kontrollhandling i et hybrid dynamisk system (Ferretti & Festa 2019; Miles &
Vladimirsky 2021). Anbefalingen er «isokron-kjerne, korrigert»: behold
isokron-fremdrift og v1s A*-avstandsfelt (bekreftet riktig av teorien som
admissible heuristikk), bytt ut ren avstandspruning med **Pareto-dominans på
(tid, kryssandel/motorandel/natt-straff)-etiketter** per celle (label-setting,
ikke label-correcting — grafen er DAG-lignende per tidssteg), skill
**harde constraints** (farbarhet, TSS-retning, seilingshøyde, vernesoner) fra
**myke kostnader** i to separate steg i ekspansjonen, og modeller
bautstraff som en eksplisitt tilstandskomponent (forrige kurs/tack) i stedet
for en flat tidsstraff. Ingen publisert litteratur ble funnet som direkte
adresserer «gjenbruk beregning på tvers av værensemble-medlemmer» for
seilruting spesifikt — v1s delte A*-felt (væruavhengig) er strukturelt
fornuftig og ubestridt av alt vi fant, men er egen innsikt, ikke noe
akademisk konsensus bekrefter eller avkrefter.

## 1. Metodefamilier for seilbåt-værruting

### 1a. Isokron-metoden (Hagiwara/James-tradisjonen)

Klassisk formulering: en isokron er mengden av posisjoner en fartøy kan nå
innen samme seilingstid fra start, konstruert iterativt — for hvert tidssteg
utvides forrige isokron langs et sett kurser (relativt til vind), og en ny
isokron dannes fra ytterpunktene. H. Hagiwara formaliserte metoden for
seilassistert motorfartøy-ruting ved TU Delft i 1989, og de fleste
kommersielle rutingverktøy bygger fortsatt på denne
(**verifisert via sekundærkilde**: ResearchGate-sammendrag av «Adopted
isochrone method improving ship safety in weather routing with evolutionary
approach»; selve Hagiwara 1989-avhandlingen ikke lest i original).

**Hvordan gjør de konkrete verktøyene det:**

- **qtVlm** (fransk racing-/cruising-programvare): isokron-basert, med to
  eksplisitte pruning-mekanismer — «wake angle» (fjerner ruter som havner i
  «vindskyggen»/dominans-sonen til en annen rute) og en
  «exploration coefficient» som setter et hardt tak på antall ruter som
  beholdes per iterasjon. Dokumentasjonen er eksplisitt om avveiningen: lav
  wake angle + høy exploration coefficient = flere ruter utforsket, men
  lengre beregningstid. Støtter «isochrones inversés» (bakover fra mål) og
  multi-scenario-kjøring (flere avganger side om side) — men ingen omtale av
  ensemble-vær-perturbasjon. **Kilde**: wiki.v-l-m.org/Le_routage_avec_qtVlm
  (fransk community-wiki, ikke offisiell dok — behandles som rapportert av
  andre, ikke verifisert mot kildekode).
- **OpenCPN weather_routing_pi** (Sean D'Epagnier): isokron med konfigurerbar
  tidssteg (firedobling av kostnad ved halvering av tidssteg — kvadratisk,
  ikke lineær, kostnadsskalering — konsistent med v1s erfaring om at
  kursoppløsning dominerer kjøretid), valg mellom Newton- og
  4.-ordens Runge-Kutta-integrasjon av posisjon gjennom vær-feltet,
  eksplisitt **«Max Search Angle»** og **«Max Diverted Course»** som
  kjegle-lignende begrensninger, og en **«Optimize Tacking»**-modus som antar
  at skipperen bauter optimalt og lar isokronen «se gjennom» kurser 0–360°
  med en egen tidsstraff (sekunder) for bauting i stedet for å eksplisitt
  representere hver bauting som en node. Landunngåelse via GSHHS-kystlinje,
  eksplisitt merket som beregningsmessig dyrt i dokumentasjonen. **Kilde**:
  `data/WeatherRoutingInformation.html` i
  github.com/seandepagnier/weather_routing_pi (lest via raw-fetch,
  **verifisert**), supplert med rasbats.github.io-brukermanualen (mer
  overfladisk, ikke algoritmisk).
- **Expedition** (racing, referert i `vaerdata-ensemble.md`): kjører faktisk
  ensemble — én rute per lastet GRIB-modell/perturbasjon, vist samtidig.
  Ingen offentlig algoritme-dokumentasjon funnet utover det som allerede står
  i eksisterende prosjektdokumentasjon; **ikke verifisert** utover det som
  var kjent fra før.
- **libweatherrouting / pyroute (Ferreguti/Gessa/Apolloni)**: Python-bibliotek
  med en `LinearBestIsoRouter`-klasse nevnt i dokumentasjonsindeksen.
  Modulsiden med faktisk algoritmedetaljer ga 404 ved fetch — **kildekode
  ikke verifisert**, kun eksistensen og navnet på isokron-strategien bekreftet.

Isokron-familiens generelle styrker mot våre krav: **naturlig progressiv**
(hver isokron er et gyldig delresultat — passer F3.5s
strøm-per-avgang-kontrakt direkte), **billig per medlem** (v1s spike viser
1,3–2,1 s for 30 medlemmer × 1 avgang), **determinisme** er lett å oppnå
(ingen tilfeldighet i selve fremdriften, i motsetning til evolusjonære/
metaheuristiske varianter som PSO/GA som dukker opp mye i den akademiske
litteraturen for større skip). Svakheter: **kjeglebegrensning gir bias**
(se §2), **sagtann/lokale minima** i skjærgård uten aktiv konsolidering
(se §2), og **ren avstandspruning skjuler avveininger** mellom kriterier
(se §2, §3).

### 1b. Graf-søk på tidsekspandert grid (Dijkstra/A* med tidsavhengige kanter)

Vanlig i akademisk skipsruting for større fartøy: diskretiser hele
løsningsrommet til et grid, la kantkostnader avhenge av avgangstid ved noden
(tidsekspandert graf), og finn korteste vei med Dijkstra/A*/Theta*. Disse er
**eksakte metoder** — de garanterer optimal løsning innenfor
diskretiseringen, i motsetning til isokron som er en heuristisk
fremoverpropagering. Nyere arbeid (Zhen et al. m.fl., ScienceDirect-oversikt
2025) bygger TSS/Rule 10-compliance direkte inn i A*-grafen ved å
konstruere en trafikkmodell som node-/kant-begrensning (se §3). Theta*-
varianter («time-dynamic Theta*») brukes for å unngå gitter-artefakter
(stiene følger ikke lenger bare 8 gitterretninger).

Mot våre krav: **A* med admissible heuristikk er nøyaktig det v1s
avstandsfelt allerede er** — dette er ikke en konkurrerende familie til
isokron, det er komplementært (se §1e/anbefaling). Som *erstatning* for hele
isokron-fremdriften er ren grid-graf mindre naturlig progressiv (man må
kjøre hele Dijkstra/A* før man har et brukbart delresultat, med mindre man
bruker inkrementelle/anytime-varianter), og gitteroppløsning kobles direkte
til nøyaktighet på en måte v1 allerede unngår ved å holde A*-feltet grovere
(500 m–1 km) enn selve farbarhetsmasken. For våre 150–210 kjøringer er
kostnaden ved å bygge en full tidsekspandert graf per medlem trolig høyere
enn isokronens inkrementelle fremdrift — men dette er **ikke
benchmarket** for vårt problem, kun resonnert fra generell kompleksitet
(graf-størrelse × tidssteg vs. isokron-fronten som er begrenset av
pruning).

### 1c. Dynamisk programmering / optimal kontroll

To varianter er relevante:

- **3D dynamisk programmering** (Zaccone et al., og «forward 3DDP») for
  hastighet/kraft/kurs-optimering på større skip — dekomponerer problemet i
  stadier (tid × posisjon × fartsvalg) og løser bakover- eller
  fremover-rekursivt. Gir eksakt optimum for den valgte diskretiseringen,
  som isokron-metoden ikke strengt gjør (isokron er en grådig
  frontpropagering, ikke en fullstendig DP-rekursjon over alle tilstander).
- **Hybrid optimal kontroll for seilbåt spesifikt** (Ferretti & Festa 2019,
  *Optimal Route Planning for Sailing Boats: A Hybrid Formulation*, JOTA
  181(3), doi 10.1007/s10957-019-01506-x; videreført av Miles & Vladimirsky
  2021 med semi-Lagrangiansk akselerasjon). Dette er **det teoretisk
  grundigste svaret vi fant** på bautstraff-spørsmålet i §2: boken modellerer
  seilbåt-ruting som et *hybridsystem* der kurs er en kontinuerlig
  kontrollvariabel og tack/gybe er en **diskret kontrollhandling** med egen
  kostnad/forsinkelse, løst med dynamisk programmering (semi-Lagrangiansk
  skjema). Miles & Vladimirsky reduserer tilstandsromdimensjonen og bruker
  adaptiv tidssteg-diskretisering for å gjøre dette beregningsmessig
  overkommelig, og integrerer over potensielle vindtilstander etter et
  tack-bytte for mer nøyaktig overgangsmodellering.

Mot våre krav: matematisk den mest presise familien for
tack/gybe-modellering, men beregningsmessig tyngre enn isokron for et fullt
2D-domene (semi-Lagrangiansk DP over et helt gitter, per medlem, × 150–210
kjøringer) — ingen av kildene vi fant rapporterer ytelsestall som lar oss
sammenligne direkte med v1s 1,3–2,1 s. Riktig bruk for v2 er trolig **å låne
konseptet** (tack som eksplisitt tilstandskomponent, se §2) inn i
isokron-rammeverket, ikke å erstatte isokron med full hybrid-DP.

### 1d. Stokastiske metoder (MDP, scenariobasert)

- **MDP for kappseiling-strategi** (kortere kurs, vind modellert som Markov-
  prosess; beslutning om tack/kurs ved hvert observasjonspunkt for å
  minimere forventet ankomsttid) — relevant konsept, men designet for
  sanntids/underveis-beslutning (F5), ikke for forhåndsplanlegging av en
  flerdøgnsrute.
- **Scenariobasert / robust Pareto-ruting mot ensemble-værprognoser**:
  Hinnenthal & Clauss 2010 (allerede i `vaerdata-ensemble.md` §7, doi
  10.1080/17445300903210988) — robust Pareto-optimal ruting mot
  ensemble-prognoser er den akademiske forgjengeren til nøyaktig det F4.1
  ber om (rute per ensemble-medlem, aggreger). JMSE 2021
  (10.3390/jmse9121434, **fetch-verifisert sammendrag**): bruker klassiske
  strukturell-pålitelighetsmetoder for å uttrykke mål/constraints
  probabilistisk fra ensemble-spredning, og estimere svikt-sannsynlighet og
  varians i drivstoff/ankomsttid — dette er en **aggregeringsmetode**
  (etter at per-medlem-ruter er kjørt), ikke en alternativ søkealgoritme, og
  passer rett inn i F4.2/F4.4s robusthetsmål.
- **MDP med vær som fullt observerbar Markov-kjede for storm-evolusjon**:
  finnes i litteraturen for større skip/langtidsplanlegging, men vi fant
  ingen operasjonell seilbåt-implementasjon av dette — vurderes som for
  tungt beregningsmessig og for lite modenhet til v2.0.

Mot våre krav: stokastiske metoder som *søkealgoritme* (MDP-transisjoner over
et værtilstandsrom) er overkill og udokumentert for vårt bruksområde.
Scenariobasert/robust ruting som *aggregeringslag over deterministiske
per-medlem-isokron-kjøringer* er derimot presis det litteraturen og
kravspeken allerede konvergerer på (F4.1, F4.2, vaerdata-ensemble.md §7).

### 1e. Oppsummering: styrke/svakhet-matrise mot våre krav

| Familie | Progressiv/avbrytbar | Harde geo-constraints | Myke flerkriterie-kostnader | Determinisme | Kost × 150–210 |
|---|---|---|---|---|---|
| Isokron (m/A*-felt) | Sterk — hver front er et delresultat | God hvis constraint-sjekk er eksplisitt steg i ekspansjonen | Svak i klassisk form (ren avstand); god hvis Pareto-etiketter (§2/§3) | Sterk, ingen tilfeldighet | Lav (v1-spike: 1,3–2,1 s/medlem) |
| Graf/tidsekspandert Dijkstra/A* | Middels — trenger anytime-variant for delresultater | Sterk — kan bygges rett inn i graf-topologien | God — naturlig for label-setting/Pareto | Sterk | Ukjent for vårt problem, trolig høyere pga. full graf-bygging |
| DP/optimal kontroll (hybrid) | Svak for full 2D — DP-rekursjon er ikke naturlig inkrementell | Sterk | God | Sterk | Høy (ikke benchmarket, men semi-Lagrangiansk DP over helt gitter × 150–210 kjøringer er en reell bekymring) |
| Stokastisk (MDP) | Avhenger | Kan modelleres, men uvanlig | God (naturlig for usikkerhet) | Svak hvis stokastisk søk; sterk hvis kun aggregering | Høy som søkealgoritme; lav som aggregeringslag (dette er det vi bruker den til) |

## 2. Kjente feilmoduser og beste praksis-løsninger

- **Isokron-sagtann og konsolidering.** Klassisk isokron produserer
  «sagtann»-mønstre der nabokurser divergerer unødig — v1s
  «konsolidering av ~like kurser» adresserer nettopp dette empirisk.
  Litteraturen (Chalmers-rapporten, tandfonline 2024,
  doi 10.1080/17445302.2024.2329011 — **fetch-verifisert sammendrag av
  PDF**) bekrefter sagtann/lokal-minima som et kjent problem og foreslår
  fem strategier: strategisk pruning før fremoverpropagering, **konkav hull**
  i stedet for konveks hull for å representere det nåbare området mer
  presist, augmenterte kostnadsfunksjoner (flerkriterie), adaptiv
  waypoint-tetthet, og en «Isochrone-A*»-hybrid som bytter søkestrategi
  midtveis i seilasen. **v1s konsolidering bekreftes altså av teorien**, men
  er en enklere heuristikk enn konkav-hull-metoden — verdt å vurdere konkav
  hull som forbedring hvis v2s isokron-fronter viser samme sagtann i
  skjærgård.
- **Lokale minima i skjærgård.** Ingen av kildene vi fant adresserer
  Skandinavias spesifikke skjærgårdsproblem (tett øygruppe, mange smale sund)
  direkte — det generelle mønsteret fra path-planning-litteraturen for
  autonome overflatefartøy er: fast gitteroppløsning skaper enten
  utilstrekkelig dekning i hinderrike områder eller redundant beregning i
  åpent farvann, og **quadtree**-representasjon (adaptiv oppløsning,
  finere nær kyst/hindre) er foreslått som løsning for nettopp små fartøy i
  kystnære farvann (ScienceDirect 2025, «route planning method for small
  ships in coastal areas based on quadtree»). Dette er en interessant
  kandidat for farbarhetsmasken/A*-feltet i Bohuslän-skjærgården spesifikt,
  men **ikke evaluert mot vår faktiske geometri** — flagges som
  oppfølgingsspørsmål, ikke en anbefaling å implementere nå.
- **Kjegle-begrensningers bias.** v1s 165°/115°-kjegle rundt peiling
  start→mål er eksplisitt identifisert som en kjent svakhet i litteraturen —
  Chalmers-rapporten kaller det «cone constraint bias»: retningsprejudise
  som begrenser utforskning av genuint optimale stier utenfor kjeglen.
  weather_routing_pi's «Max Search Angle»/«Max Diverted Course» er samme
  mekanisme under et annet navn, med samme kjente begrensning. **Konsekvens
  for v2**: kjeglen bør enten fjernes til fordel for A*-feltets
  avstandsunderestimat som eneste retningsfilter (feltet er allerede
  landbevisst og gir en riktigere «er denne retningen lovende»-vurdering enn
  en fast vinkel), eller gjøres adaptiv (utvides når A*-feltet viser at
  direkte peiling er blokkert av land — noe v1 delvis allerede gjør med
  165°/115°-forskjellen, men uten å teste om selv 165° er nok i trange sund).
- **Celle-pruning vs. Pareto-fronter.** Dette er kjernepunktet der v1s
  metodikk bør endres, ikke bare bekreftes. v1 beholder **kun beste
  ankomsttid per celle** — en skalar reduksjon. Standard-praksis for
  flerkriterie tidsavhengig ruting (transportlitteraturen — Delling/Wagner-
  tradisjonen for tidsekspanderte grafer, samt multikriterie-varianter av
  Dijkstra referert i søkeresultatene: Martins' labeling-algoritme) er
  **label-setting med Pareto-dominans**: hver celle kan holde flere
  ikke-dominerte etiketter `(ankomsttid, kryssandel, motorandel,
  natt-straff)`, og en ny etikett kastes bare hvis en eksisterende etikett
  dominerer den på *alle* dimensjoner. Dette er beregningsmessig dyrere enn
  skalar pruning (flere etiketter per celle, flere
  dominans-sjekk), men løser et reelt problem: v1s rene tidspruning kan
  kaste en rute som er 10 minutter tregere men krysser 40 % mindre eller
  unngår all nattseiling — nøyaktig den typen avveining F3.4/F4.4
  (klartekst-anbefaling, «robust ytelse ikke beste-tilfelle») krever at
  motoren kan uttrykke. **Anbefaling**: label-setting (ikke
  label-correcting — labels utvikles monotont fremover i tid per isokron,
  så korrigering bakover er ikke nødvendig, i motsetning til generelle
  tidsavhengige grafer med negative/ikke-monotone kanter). Antall
  bevarte etiketter per celle bør caps (f.eks. 3–5) for å unngå eksponentiell
  vekst — kjent NP-hard-risiko i litteraturen («generation of the full
  Pareto-front suffers from rapidly increasing computation time»), håndtert
  med en praktisk øvre grense heller enn eksakt Pareto-fullstendighet.
- **Landunngåelse i trange sund.** Ingen kilde adresserer dette for
  seilbåt-isokron spesifikt utover det generelle mønsteret: finere
  oppløsning nær land, grovere i åpent farvann (nettopp v1s allerede
  eksisterende separasjon av A*-feltoppløsning fra maskeoppløsning — dette
  **bekreftes** som riktig retning, ikke bare en v1-optimalisering). v1s
  segmentvise sikkerhetsettersjekk uavhengig av selve ruteren
  («etterbehandling») er en form for defense-in-depth som ikke er
  kritisert av noe vi fant — snarere er det konsistent med at harde
  constraints alltid bør verifiseres minst to steder når geometrien er
  komplisert (byggetidsmaske + runtime-ettersjekk).
- **Bautstraff: diskret straff vs. tilstandsutvidelse — hva er teoretisk
  riktig?** Svaret fra litteraturen er nyansert: den *teoretisk mest
  presise* behandlingen er Ferretti & Festa/Miles & Vladimirsky sin hybride
  formulering, der forrige tack/kurs inngår som del av tilstanden og
  tack-bytte er en diskret kontrollhandling med egen kostnad og
  overgangsdynamikk (integrert over vindtilstander etter byttet). Dette er
  **tilstandsutvidelse**, ikke en flat straff — og det er riktig fordi en
  flat straff (v1s +90 s ved kursendring > 15°, weather_routing_pi sin
  «Tacking Time») ikke fanger at kostnaden ved å bauте avhenger av
  *hvilken* tack båten kommer fra og hvor mye vinden har dreid siden. Men
  full hybrid-DP er beregningsmessig tyngre enn isokron for vårt
  bruksområde (§1c). **Praktisk anbefaling for v2**: en mellomting —
  utvid isokron-cellens tilstand med **forrige kurs (eller tack-side:
  babord/styrbord bidevind)**, og la bautstraffen være en funksjon av
  `|Δkurs|` og tack-side i stedet for en fast konstant. Dette er ikke full
  hybrid-DP, men er teoretisk riktigere enn v1s flate straff og koster lite
  ekstra (tilstanden er allerede diskretisert per isokron-node; å bære med
  én ekstra skalar per node er billig sammenlignet med Pareto-etikettene i
  forrige punkt — de to forbedringene forsterker hverandre naturlig siden
  begge utvider node-tilstanden).

## 3. Constraints-arkitektur

Beste praksis fra TSS/Rule 10-litteraturen (Zhen et al.; MDPI 2026,
«A TSS-Compliant Ship Automatic Route-Planning Algorithm»,
doi via mdpi.com/1999-4893/19/3/220) og fra COLREGs-compliant
route-planning-rammeverket (ScienceDirect 2025) peker konsekvent på samme
mønster:

- **Harde constraints hører hjemme i ekspansjonssteget, ikke i
  kostnadsfunksjonen.** Et kandidatsegment som krysser en no-go-sone
  (grunne, tørrfall, luftspenn lavere enn mast, TSS krysset langs i stedet
  for på tvers) skal **aldri genereres som gyldig node** — det skal
  forkastes før det når kostnadsevalueringen. Dette er nøyaktig v1s
  eksisterende mønster (kystlinje sjekkes i `land.crosses` under
  fremdriften, ikke som en stor straff i kostnadsfunksjonen), og
  litteraturen bekrefter dette som riktig arkitektur snarere enn å
  representere farbarhet som en (svært) høy myk kostnad — en høy myk
  kostnad kan i prinsippet fortsatt «vinne» mot et alternativ som er enda
  dyrere på andre dimensjoner, noe et sikkerhetskrav aldri skal tillate.
- **TSS-geometriregelen (kryss på tvers, ikke langs)** modelleres best som en
  **retningsavhengig hard/myk hybrid**: kryssing vinkelrett (eller nær
  vinkelrett) på TSS-aksen er tillatt (myk kostnad, om noen), mens
  seiling langs en trafikklinje i feil retning er enten hardt forbudt eller
  gitt en kostnad høy nok til aldri å konkurrere — MDPI-artikkelen løser
  dette med en «quadrilateral decomposition»-modul som bryter TSS-sonen opp
  i geometriske celler med definert gjennomgangsretning, og sjekker
  kandidatruter mot krysningsrekkefølge. For v2s formåls (statisk
  kartobjekt med geometriregel, F1.5) er full quadrilateral-dekomponering
  trolig overkill, men **prinsippet — eksplisitt retningssjekk per
  TSS-kryssing, ikke bare en generisk «unngå sone»-kostnad** — bør tas med.
- **Vernesoner med datointervall (F1.6)** er strukturelt identisk med
  TSS-mønsteret: en hard constraint som er *tidsbetinget* (aktiv i gitt
  sesong). Riktig sted å håndheve dette er i selve masken/farbarhetsoppslaget
  ved byggetidspunktet for den aktuelle turens datoer (masken er allerede
  statisk per rutepakke ifølge F1.0/F1.1) — ikke som en kjøretids-sjekk i
  ruteren. Dette stemmer med prefabrikkert-prinsippet i kravspeken og krever
  ingen avvik fra planlagt arkitektur.
- **Myke kostnader** (kryssandel, natt-timer, motorandel, bølge-derating)
  hører hjemme i selve etikett-vektoren (§2s Pareto-punkt) og evalueres
  *etter* at et segment har bestått de harde sjekkene. Dagslys-kravet
  (F3.4: «hardt/mykt») er eksplisitt tosidig i kravspeken selv — det bør
  implementeres som **hardt** når brukeren har krysset av for det (f.eks.
  «ingen ankomst i mørket»), og **mykt** (kostnadsledd) som standard. Dette
  er ikke noe litteraturen tar stilling til spesifikt for fritidsseiling,
  men er en direkte konsekvens av det generelle harde/myke-mønsteret over.

## 4. Ensemble-effektivisering

Dette er punktet der litteratursøket ga **minst substans**. Vi fant ingen
publisert forskning eller dokumentert praksis som spesifikt beskriver
gjenbruk av beregning på tvers av værensemble-medlemmer for seilbåt- eller
skipsruting (delt heuristikkfelt, warm-start mellom medlemmer, felles
pruning-grenser). Det nærmeste vi fant:

- Generisk optimeringslitteratur om «warm-start heuristics» (brukt til å gi
  solvere en god startløsning for raskere konvergens) — relevant prinsipp,
  men ikke bekreftet anvendt på ensemble-værruting.
- Ensemble-værruting-litteraturen (Hinnenthal & Clauss 2010, JMSE 2021,
  JMSE 2025/2026) fokuserer på **aggregering av resultater** fra
  per-medlem-kjøringer (robusthetsmål, sannsynlighetsfordeling), ikke på
  **beregningsmessig gjenbruk under selve kjøringen**. Ingen av disse
  artiklene diskuterer delt heuristikkfelt eller warm-start mellom
  ensemble-medlemmer.

**Konsekvens**: v1s/kravspekens delte A*-avstandsfelt (M6/F3.5 — feltet er
væruavhengig, kun avhengig av start/mål/land, og kan derfor bygges én gang
og gjenbrukes på tvers av alle 150–210 kjøringer) er **egen innsikt fra
v1-arkitekturen, ikke noe akademisk konsensus bekrefter eller avkrefter**.
Den er likevel strukturelt sunn av generelle grunner (feltet er
korrekt uavhengig av perturbasjon per konstruksjon — det er en funksjon av
geometri, ikke vær), og spike-ensemble-perf.md's F6 bekrefter at gevinsten
er reell i prinsippet selv om den ikke var målbar ved denne spikens
gitterstørrelse. **Andre gjenbruksmuligheter verdt å utforske, men
uverifiserte i litteraturen:**

- Felles Tub-bound (øvre tidsgrense fra en grådig forhåndsrute) på tvers av
  medlemmer som del av samme avgang, siden medlemmene deler start/mål/tidspunkt
  og trolig ikke avviker enormt i total seilingstid — v1 gjør dette allerede
  per medlem, men et delt bound på tvers av medlemmer (satt fra
  kontrollmedlemmet, med litt slakk) kunne kutte noe søkerom ytterligere.
  **Ikke evaluert** — flagges som eksperiment, ikke anbefaling.
- Warm-start av isokron-fronten fra kontrollmedlemmets rute (perturberte
  medlemmer starter søket nær kontrollens allerede-funne front i stedet for
  fra bunnen av) — konseptuelt tiltalende gitt at MEPS-perturbasjoner er
  relativt små i forhold til grunnfeltet, men **ingen kilde bekrefter dette
  er trygt** (en dårlig warm-start kan innsnevre søket feil vei og skjule et
  reelt bedre alternativ som bare det aktuelle medlemmet ville funnet).
  Anbefales **ikke** implementert uten egen empirisk verifisering, nettopp
  fordi determinisme/korrekthet er ufravikelig (F3.1: «ren, deterministisk
  kjerne») og warm-start introduserer en avhengighet mellom medlemmer som
  må bevises trygg, ikke antas.

## 5. Anbefaling

**Isokron-kjerne med litteraturkorreksjoner, ikke et familieskifte.**
Begrunnelse: isokron er allerede bevist raskt nok (spike), naturlig
progressivt (matcher F3.5s UX-kontrakt uten ekstra arkitektur), og
deterministisk. Ingen av de andre familiene løser et problem isokron faktisk
har for vårt bruksområde bedre nok til å rettferdiggjøre en dyrere,
mindre progressiv arkitektur — graf/tidsekspandert Dijkstra gir samme
Pareto-egenskaper som isokron+label-setting uten isokronens
progressivitetsfordel, og full hybrid-DP for tack-modellering er tyngre enn
problemet krever når kjernen bare trenger å bli *litt* mer presis på dette
punktet, ikke matematisk optimal.

**Konkrete avvik fra v1 (der teorien peker en annen vei):**

1. **Erstatt ren avstandspruning med Pareto-label-setting** på
   `(tid, kryssandel, motorandel, natt-straff)`, cap 3–5 etiketter/celle.
   Dette er den viktigste enkeltendringen — v1s skalare pruning kan skjule
   nøyaktig de avveiningene F4.4/F4.5 (robust rangering, ikke
   beste-tilfelle) skal bygge på.
2. **Fjern eller gjør adaptiv v1s faste 165°/115°-kjeglebegrensning.**
   Litteraturen navngir dette som en kjent bias. A*-avstandsfeltet er
   allerede et bedre, landbevisst retningsfilter — la det gjøre jobben
   kjeglen gjorde, eller behold kjeglen kun som en vid, konfigurerbar
   sikkerhetsventil (ikke en algoritmisk kjernebegrensning).
3. **Utvid node-tilstanden med forrige kurs/tack-side**, og gjør
   bautstraffen en funksjon av `|Δkurs|` og tack-retning i stedet for en
   flat konstant. Lånt fra Ferretti & Festa/Miles & Vladimirsky sin hybride
   formulering, forenklet til noe isokron-rammeverket bærer billig.
4. **Skill harde constraints fra myke kostnader eksplisitt i to
   kodesteg** i ekspansjonen (constraint-sjekk → avvis node; kostnad →
   påvirker rangering blant gyldige noder), med TSS-kryssingsregelen
   (vinkelrett tillatt, langs forbudt/svært dyrt) som egen, eksplisitt
   sjekk — ikke en generisk sone-kostnad.
5. **Vurder konkav hull i stedet for v1s enklere kurskonsolidering** hvis
   isokron-fronter i skjærgården (Bohuslän-testtilfellet) viser vedvarende
   sagtann etter porting — ikke en dag-1-endring, men en navngitt,
   kildebelagt forbedring å ha klar hvis konsolideringen ikke er nok.
6. **Vurder quadtree/adaptiv oppløsning for A*-feltet i tett skjærgård**
   som forskningsspor (fase 4b-aktig), ikke en v2.0-forpliktelse —
   ingen kilde evaluerer dette for akkurat vår geometri.

**Det v1 bekreftes på av teorien — behold uendret:**

- **Isokron + separat, grovere A*-avstandsfelt for retningsestimering** —
  dette er nøyaktig mønsteret v1 allerede har (avstandsfelt uavhengig av,
  og grovere enn, selve farbarhetsmasken), og er konsistent med hvordan
  moderne A*/Theta*-varianter bruker admissible avstandsheuristikk i
  hindringsrike domener.
- **Segmentvis sikkerhetsettersjekk uavhengig av selve søket** — ingen
  kilde argumenterer mot defense-in-depth for harde sikkerhetskrav; tvert
  imot er «harde constraints håndheves i selve genereringen, ikke bare i
  en etterhåndskontroll» et gjennomgangstema, og v1 gjør begge deler.
  Behold begge lag.
- **Delt, væruavhengig A*-felt på tvers av ensemble-medlemmer** — ingen
  kilde motsier dette (selv om ingen bekrefter det akademisk heller, se §4);
  strukturelt riktig av generelle korrekthetsgrunner og allerede validert
  som riktig retning av spike-ensemble-perf.md.
- **Konsolidering av like kurser** — adresserer et litteraturbekreftet
  problem (sagtann), om enn med en enklere metode enn den mest avanserte
  publiserte varianten (konkav hull, se avvik-punkt 5).
- **Avgangsvindu-parallellitet med delt vindfelt per avgang** — ikke
  spesifikt adressert i litteraturen, men uproblematisk og allerede
  ytelsesverifisert.

## Det vi ikke fikk verifisert

- **Hagiwara 1989 i original** — kun sekundærkilde (ResearchGate-sammendrag
  av en artikkel som siterer den) lest, ikke avhandlingen selv.
- **qtVlms faktiske kildekode** — kun community-wiki (fransk,
  ikke-offisiell) lest; ingen tilgang til selve implementasjonen for å
  bekrefte at wiki-beskrivelsen stemmer med koden.
- **libweatherrouting/pyroute sin algoritmedetalj** — modulsiden med
  faktisk routerkode ga 404; kun eksistensen av `LinearBestIsoRouter`-navnet
  bekreftet, ikke innholdet.
- **Expedition sin algoritme** — ingen offentlig teknisk dokumentasjon
  funnet i det hele tatt; alt vi vet er det som allerede sto i
  `vaerdata-ensemble.md` fra før denne undersøkelsen.
- **Ytelsestall for graf-/tidsekspandert Dijkstra eller hybrid-DP på vårt
  konkrete problem** (grid-størrelse, 150–210 kjøringer) — ingen kilde
  benchmarker dette mot isokron for et sammenlignbart seilbåt-scenario;
  konklusjonen i §1e/§5 om at disse er tyngre enn isokron for oss er
  resonnert fra generell kompleksitet, ikke målt.
- **Om warm-start mellom ensemble-medlemmer er trygt** (§4) — eksplisitt
  flagget som ikke-anbefalt uten egen verifisering, nettopp fordi ingen
  kilde tar stilling til det.
- **Quadtree-tilnærmingens egnethet for norsk/svensk skjærgård spesifikt**
  — kilden (ScienceDirect 2025) er generisk for «coastal areas», ikke
  testet mot en geometri som Bohuslän.
- MDPI-artikkelen om TSS-compliant ruting (doi via mdpi.com/1999-4893/19/3/220)
  ble kun lest via søkeresultat-sammendrag, ikke hentet i fulltekst — detaljene
  om «quadrilateral decomposition» er **rapportert av andre** (søkemotorens
  sammendrag), ikke selv verifisert mot artikkelen.

## Konsekvens for prosjektet

- Denne rapporten er grunnlaget for ADR-en F3.1 krever før implementasjon av
  `packages/routing`. ADR-en bør eksplisitt ta stilling til de 6
  avvikspunktene og de 4 bekreftelsespunktene i §5 som separate
  beslutninger, ikke én samlet «bygg som v1, men bedre».
  Recommend: `rutemotor`-agenten skriver ADR-utkast med referanse til denne
  rapporten, deretter Magnus-godkjenning før `packages/routing` startes.
- Punktene 1 (Pareto-label-setting) og 3 (tack-tilstand) bør spesifiseres
  sammen i `docs/specs/` siden de begge utvider node-/etikett-representasjonen
  og påvirker samme kode.
- §4s manglende litteratur betyr at delt-felt-gevinsten for ensemble
  fortsatt hviler på spike-ensemble-perf.md sin strukturelle begrunnelse,
  ikke på ekstern bekreftelse — dette svekker ikke beslutningen (den er
  motivert av korrekthet + spikens tall), men bør ikke fremstilles som
  «bransjestandard» i pitch-materiale.
- Åpne spørsmål verdt egne, senere undersøkelser: quadtree-felt for
  skjærgård (kan bli en `kartdata`/`rutemotor`-samarbeidsoppgave i fase 4b),
  og faktisk benchmark av 150–210-kjøringers-scenarioet (allerede flagget i
  spike-ensemble-perf.md, uavhengig av denne rapporten).

## Kilder

- H. Hagiwara (1989), modifisert isokron-metode — kun sekundærkilde lest:
  ResearchGate-sammendrag av «Adopted Isochrone Method Improving Ship
  Safety in Weather Routing with Evolutionary Approach»,
  https://www.researchgate.net/publication/238194267 (søkt 2026-08-30).
- Strategies to improve the isochrone algorithm for ship voyage
  optimisation, *Ships and Offshore Structures* 19(12), 2024,
  doi 10.1080/17445302.2024.2329011 — fulltekst-PDF lest via Chalmers
  institusjonsarkiv, https://research.chalmers.se/publication/540537/file/540537_Fulltext.pdf
  (lest 2026-08-30).
- qtVlm routing — community-wiki, ikke offisiell dokumentasjon:
  https://wiki.v-l-m.org/index.php/Le_routage_avec_qtVlm (lest 2026-08-30).
- weather_routing_pi (Sean D'Epagnier), OpenCPN-plugin:
  https://github.com/seandepagnier/weather_routing_pi og
  `data/WeatherRoutingInformation.html` (raw-fetch lest 2026-08-30);
  brukermanual https://rasbats.github.io/opencpn-plugins-manual/weather_routing/0.1/weather_routing.html
  (lest 2026-08-30, mindre teknisk detaljert).
- libweatherrouting (dakk/Gessa/Apolloni/Ferreguti):
  https://github.com/dakk/libweatherrouting,
  https://dakk.github.io/libweatherrouting/index.html (kun oversiktsside
  lest, modulside 404, lest/forsøkt 2026-08-30).
- Ferretti, R. & Festa, A. (2019), «Optimal Route Planning for Sailing
  Boats: A Hybrid Formulation», *Journal of Optimization Theory and
  Applications* 181(3), doi 10.1007/s10957-019-01506-x — kun
  sammendrag/sekundærbeskrivelse lest, ikke fulltekst
  (søkt 2026-08-30; se også forløper arXiv:1707.08103).
- Miles, J. & Vladimirsky, A. (2021), semi-Lagrangiansk akselerasjon av
  hybrid seilbåt-ruting — omtalt i søkeresultat, ikke lest i original
  (søkt 2026-08-30; relatert arXiv:2109.08260 «Stochastic Optimal Control
  of a Sailboat»).
- State-of-the-art optimization algorithms in weather routing — ship
  decision support systems: challenge, taxonomy, and review,
  *Ocean Engineering*, ScienceDirect, 2025,
  https://www.sciencedirect.com/science/article/pii/S0029801825009114 —
  **fetch ble blokkert (403)**, kun søkemotor-sammendrag brukt, ikke
  verifisert i fulltekst.
- A Comprehensive Approach to Account for Weather Uncertainties in Ship
  Route Optimization, *JMSE* 9(12):1434, 2021, doi 10.3390/jmse9121434 —
  sammendrag verifisert via søk (samme artikkel som allerede sitert i
  `vaerdata-ensemble.md` §7).
- Hinnenthal, J. & Clauss, G. (2010), «Robust Pareto-optimum routing of
  ships utilising deterministic and ensemble weather forecasts»,
  doi 10.1080/17445300903210988 — videreført fra `vaerdata-ensemble.md`
  §7, ikke lest på nytt i denne undersøkelsen.
- A TSS-Compliant Ship Automatic Route-Planning Algorithm, MDPI,
  https://www.mdpi.com/1999-4893/19/3/220 — kun søkemotor-sammendrag lest,
  ikke fulltekst (søkt 2026-08-30).
- A COLREGs-compliant route planning framework incorporating fairway and
  traffic separation scheme constraints, *Ocean Engineering*,
  ScienceDirect, https://www.sciencedirect.com/science/article/pii/S0141118725004225
  — kun søkemotor-sammendrag lest (søkt 2026-08-30).
- A route planning method for small ships in coastal areas based on a
  quadtree, ScienceDirect,
  https://www.sciencedirect.com/science/article/pii/S2092678225000056 —
  kun søkemotor-sammendrag lest (søkt 2026-08-30).
- Generell multikriterie tidsavhengig ruting (label-setting/label-
  correcting, Pareto-dominans, Martins' labeling-algoritme, NP-hardhet ved
  full Pareto-front) — syntetisert fra flere søkeresultater
  (Disser/Müller/Hannemann/Schnee, TU Darmstadt-notat
  https://www2.mathematik.tu-darmstadt.de/~disser/pdfs/DisserMullerHannemannSchnee08.pdf,
  m.fl.), ikke én enkelt kilde lest i fulltekst — behandles som
  **rapportert konsensus fra flere sekundærkilder**, ikke egen verifisering
  av én autoritativ artikkel.
- Interne prosjektdokumenter brukt som utgangspunkt (ikke re-verifisert
  eksternt i denne omgang): `docs/00-kravspek.md` (F3, F4),
  `docs/research/vaerdata-ensemble.md` §7,
  `docs/research/v1-funksjonsanalyse.md`,
  `docs/research/spike-ensemble-perf.md` — alle lest 2026-08-30.
