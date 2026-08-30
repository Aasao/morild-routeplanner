# ADR-0004: Rutemetodikk — isokron-kjerne med fire korreksjoner fra v1

- Status: **godkjent 2026-08-30 av Magnus**
- Dato: 2026-08-30
- Besluttet av: Magnus, 2026-08-30 (via strukturert spørsmål; alle punkter etter agentens anbefaling)

## Kontekst

Kravspeken F3.1 (`docs/00-kravspek.md`) krever at rutemotoren designes fra
**beste praksis og teori**, med v1 (`C:\RoutePlanner`) som referanse og
fasit-baseline — ikke som porteringsmål. Magnus' føring 2026-08-30: «ikke legg
for mye vekt på v1s løsninger». Prosjektplanen (`docs/01-prosjektplan.md`,
fase 2) gjør denne ADR-en til en forutsetning for `docs/specs/rutemotor.md`,
som igjen er forutsetning for kode i `packages/routing`.

Metodikk-gjennomgangen er gjort og dokumentert i
`docs/research/rutemetodikk.md` (2026-08-30). Den vurderer fire
metodefamilier — isokron (Hagiwara-tradisjonen), graf-søk på tidsekspandert
grid, dynamisk programmering/hybrid optimal kontroll, og stokastiske metoder
— mot våre faktiske krav: 150–210 kjøringer per kveldsplanlegging (F3.5),
harde geometriske constraints fra farbarhetsmaske/TSS/seilingshøyde (F1.1,
F1.4, F1.5), myke flerkriterie-kostnader (F3.4: kryssandel, motorandel,
natt-timer, dagslys), progressiv/avbrytbar beregning (F3.5) og ufravikelig
determinisme (F3.1, CLAUDE.md kodekonvensjoner).

Kreftene som virker mot hverandre:

- **Ytelse vs. fullstendighet.** `docs/research/spike-ensemble-perf.md` viser
  at v1s isokron-motor kjører 30 medlemmer × 1 avgang på 1,3–2,1 s på PC
  (F1), altså god margin mot F3.5s budsjetter — men samme rapport påpeker at
  S1s fulle skala (5–7 avganger × 30 medlemmer) ekstrapolert til nettbrett
  gir 16–52 s, «fortsatt under 60 s, men uten den brede margen». Hver
  metodikk-korreksjon som øker arbeidet per kjøring, spiser av en margin som
  er mindre enn enkelttallene antyder.
- **Robusthetsambisjonen krever avveininger motoren i dag ikke kan uttrykke.**
  F4.4/F4.5 skal rangere på robust ytelse og vise «skjøre ruter med hvorfor».
  v1 beholder kun beste ankomsttid per celle (skalar reduksjon) og kan derfor
  kaste en rute som er 10 minutter tregere men krysser 40 % mindre — nøyaktig
  den avveiningen robusthetslaget skal bygge på.
- **Sikkerhet foran optimalitet** (CLAUDE.md prinsipp 1). Harde constraints
  må aldri kunne «tapes» mot en kostnad, uansett hvor stor kostnaden er.
- **Determinisme er ufravikelig.** Det utelukker hele den evolusjonære/
  metaheuristiske grenen (GA/PSO) som dominerer deler av den akademiske
  skipsrutingslitteraturen, og det gjør warm-start mellom ensemble-medlemmer
  til noe som må bevises trygt, ikke antas (rutemetodikk.md §4).

## Beslutning

Vi bygger `packages/routing` som en **isokron-kjerne** (Hagiwara-tradisjonen)
med v1s delte, væruavhengige A\*-vannavstandsfelt som retnings- og
beskjæringsheuristikk, og gjør **fire eksplisitte avvik fra v1**:
(1) **Pareto-label-setting** på kostnadsvektoren `(tid, kryss, motor, natt)`
erstatter v1s skalare «beste ankomsttid per celle»;
(2) **kjeglebegrensningen fjernes** som algoritmisk kjernebegrensning og
beholdes kun som valgfri, vid sikkerhetsventil (av som standard);
(3) **node-tilstanden utvides med forrige kurs**, diskretisert i 8 sektorer à
45°, slik at bautstraffen blir en funksjon av `|Δkurs|` og halseside i stedet
for en flat konstant; og
(4) **harde constraints skilles fra myke kostnader** som to semantisk adskilte
steg i ekspansjonen, med TSS-kryssingsregelen (kryss på tvers tillatt, langs i
feil retning forbudt) som en egen, eksplisitt retningssjekk — ikke en generisk
sonekostnad.

Alt annet v1 gjør på dette området beholdes, fordi metodikk-gjennomgangen
bekrefter det teoretisk (se «Det vi beholder fra v1» under).

## Alternativer vurdert

- **Ren port av v1s isokron (skalar celle-pruning, fast kjegle, flat
  bautstraff).** Vraket. Det er raskest å bygge og allerede ytelsesbevist,
  men bryter med F3.1s eksplisitte føring («ikke portert ukritisk»), og
  metodikk-gjennomgangen navngir tre av v1s mekanismer som kjente svakheter i
  litteraturen: kjeglebias (rutemetodikk.md §2, «cone constraint bias»),
  skalar pruning som skjuler flerkriterie-avveininger (§2), og flat bautstraff
  som ikke fanger hvilken hals båten kommer fra (§2). Å bygge robusthetslaget
  (F4) oppå en motor som ikke kan uttrykke avveininger ville tvunget en
  ombygging av kjernen i fase 4 i stedet for i fase 2.
- **Graf-søk på tidsekspandert grid (Dijkstra/A\*/Theta\*).** Vraket som
  erstatning for isokron-fremdriften. Familien er eksakt innenfor sin
  diskretisering og har naturlig plass til både Pareto-etiketter og harde
  constraints i graf-topologien — men den mister isokronens viktigste
  praktiske egenskap for oss: hver isokron-front *er* et gyldig delresultat,
  noe som gir F3.5s progressive UX-kontrakt uten ekstra arkitektur. En
  anytime-/inkrementell variant måtte bygges for å få det samme. Kostnaden
  ved å bygge full tidsekspandert graf per medlem × 150–210 kjøringer er
  dessuten **ikke benchmarket** for vårt problem (rutemetodikk.md §1e er
  eksplisitt på at konklusjonen er resonnert fra kompleksitet, ikke målt) —
  vi velger den familien vi har målinger på.
- **Full hybrid optimal kontroll / semi-Lagrangiansk DP** (Ferretti & Festa
  2019; Miles & Vladimirsky 2021). Vraket for v2.0. Dette er det teoretisk
  grundigste svaret på bautmodellering — tack/gybe som diskret
  kontrollhandling med egen overgangsdynamikk, integrert over vindtilstander
  etter halsbyttet. Men det er DP over et helt 2D-gitter per medlem, uten
  publiserte ytelsestall som lar oss sammenligne mot v1s 1,3–2,1 s, og uten
  isokronens progressivitet. Vi **låner konseptet** (avvik 3: forrige kurs som
  tilstandskomponent) i stedet for å adoptere rammeverket.
- **Stokastisk søk (MDP over værtilstandsrom).** Vraket. Designet for
  underveis-beslutning (vår F5), ikke for flerdøgns forhåndsplanlegging, og
  ingen operasjonell seilbåt-implementasjon funnet. Usikkerheten hører hjemme
  i **aggregeringslaget** over deterministiske per-medlem-kjøringer
  (F4.1/F4.2, Hinnenthal & Clauss 2010) — der bruker vi den, og bare der.
- **Evolusjonære metaheuristikker (GA/PSO).** Vraket uten videre vurdering:
  uforenlig med determinismekravet i F3.1, og krever mange kjøringer per rute
  i et budsjett der vi allerede kjører 150–210 ruter.
- **Warm-start av isokron-fronten fra kontrollmedlemmet.** Vraket for nå
  (rutemetodikk.md §4): ingen kilde bekrefter at det er trygt, og en dårlig
  warm-start kan innsnevre søket feil vei og skjule et bedre alternativ som
  bare det aktuelle medlemmet ville funnet. Kan tas opp igjen som eget
  eksperiment med egen empirisk verifisering.
- **Konkav hull i stedet for kurskonsolidering, og quadtree-basert A\*-felt.**
  Ikke vraket — **utsatt**. Begge er navngitte, kildebelagte forbedringer
  (rutemetodikk.md §2), men ingen av dem er evaluert mot vår faktiske
  geometri. Konkav hull tas frem hvis isokron-fronter i Bohuslän viser
  vedvarende sagtann etter porten; quadtree er et fase-4b-forskningsspor.

## Konsekvenser

### Det vi beholder fra v1 (bekreftet av teorien, ikke bare av vane)

- **Isokron-fremdrift + separat, grovere A\*-vannavstandsfelt** (500 m–1 km,
  dekoblet fra maskens oppløsning). Konsistent med hvordan moderne A\*/Theta\*-
  varianter bruker admissible avstandsheuristikk i hindringsrike domener.
- **Feltet i Float64.** v1 fant en avrundingsbug med Float32 som ga foreldede
  celler. Dette er en fikset bug og får derfor en regresjonstest som feiler
  hvis feltet noen gang beregnes i Float32 (se `docs/specs/rutemotor.md` §8.1).
- **Delt, væruavhengig felt på tvers av ensemble-medlemmer og avganger.**
  Feltet er en funksjon av geometri, ikke vær — korrekt gjenbrukbart per
  konstruksjon. Ingen litteratur bekrefter *eller* motsier dette
  (rutemetodikk.md §4); begrunnelsen er strukturell + spike-rapportens F6.
  **Dette skal ikke fremstilles som bransjestandard.**
- **Øvre tidsgrense (Tub) fra en grådig forhåndsrute**, med bound-pruning mot
  A\*-feltets restavstand.
- **Segmentvis sikkerhetsettersjekk av den ferdige ruten, uavhengig av
  søket.** Forsvar i dybden: harde constraints håndheves både i genereringen
  og i ettersjekken. Ingen kilde argumenterer mot dette; v1 gjør begge deler
  og vi beholder begge lag.
- **Stagnasjonsvakt og nodetak** (ærlig avbrudd i stedet for uendelig søk) —
  en direkte konsekvens av N2 «ærlig degradering».
- **Konsolidering av ~like kurser** (fjerner isokron-sagtann) — adresserer et
  litteraturbekreftet problem, om enn med enklere metode enn konkav hull.
- **Avgangsvindu-parallellitet med delt værfelt per avgang.**

### Positive konsekvenser av beslutningen

- Motoren kan **returnere flere ikke-dominerte alternativer** ved målet
  («8 t raskere, men 40 % mer kryss og 5 t natt»). Det er råstoffet F3.4,
  F4.4 og F4.5 trenger, og det finnes ikke i v1.
- Fjernet kjegle betyr at genuint optimale ruter utenfor peiling ±165° ikke
  lenger er strukturelt usynlige — særlig relevant i skjærgård og i sund der
  direkte peiling er blokkert av land.
- Hard/myk-skillet gjør sikkerhetssemantikken **strukturell**, ikke en sak om
  vekting: ingen kostnad, uansett størrelse, kan gjøre en no-go-passasje
  gyldig. Det er CLAUDE.md prinsipp 1 uttrykt i kode.
- Bautstraff som funksjon av `|Δkurs|` og halseside gir riktigere kryssruter
  uten å innføre en ny metodefamilie.

### Negative konsekvenser — kostnaden, ærlig

- **Pareto-etiketter øker nodemengde og minne.** Der v1 holder én node per
  celle, kan v2 holde flere ikke-dominerte etiketter per tilstand. Uten tak er
  dette en kjent eksponentiell risiko (full Pareto-front er NP-hard i
  generelle tilfeller). **Mottiltak, alle obligatoriske i spec-en:**
  (a) streng dominans-pruning ved innsetting, med kostnadskomponenter lagret
  som **heltalls sekunder** slik at sammenligningene er eksakte og
  deterministiske (ingen epsilon-fuzz);
  (b) **tak per tilstand** (standard 4 etiketter) og **tak per celle på tvers
  av sektorer** (standard 12), med deterministisk utkastingsregel;
  (c) **globalt etikett-tak** (standard 250 000, absolutt tak 400 000) som
  erstatter v1s `nodeCap=140000`;
  (d) etikett-arena som struct-of-arrays i typede arrays, ~48 B/etikett →
  ~12 MB ved standardtak, ~19 MB ved absolutt tak, per medlem. Med 6 samtidige
  workers er det ~115 MB i verste fall — innenfor N6s 500 MB, men ikke
  neglisjerbart lenger slik det var i v1.
- **Tilstandsutvidelsen mangedobler tilstandsrommet.** Nøkkelen går fra
  `celle` til `(celle, kurssektor)`. **Mottiltak:** kursen diskretiseres til
  **8 sektorer à 45°** (ikke full 6°/12°-oppløsning — det ville gitt 30–60×),
  og **halseside (babord/styrbord) er ikke en egen nøkkeldimensjon**: den er
  en deterministisk funksjon av etikettens kurs og vindfeltet i etikettens
  posisjon/tid, lagres på etiketten og brukes i straffefunksjonen, men
  dupliserer ikke tilstander. Netto teoretisk vekst er altså ≤ 8× celler ×
  4 etiketter, i praksis langt mindre fordi de fleste sektorer er tomme i de
  fleste celler. **Sektorantallet er en målt parameter, ikke en fasit** —
  spec-en krever at 8 vs. 12 vs. 16 måles på Bohuslän-tilfellet før tallet
  låses.
- **Fjernet kjegle koster søkerom.** v1s kjegle var billig pruning som fjernet
  hele retninger for ett bearing-kall. Uten den forventes flere
  node-utvidelser per iterasjon; kompensasjonen er A\*-feltets
  blindvei-eliminering og Tub-bound. **Dette er en ytelsesrisiko som må måles,
  ikke antas** — spec-en krever måling med og uten kjegle på samme golden-rute
  før standardverdien låses.
- **Tub-bound er endimensjonal og kan kutte Pareto-optimale etiketter.**
  Grensen gjelder tid; en etikett som er tregere men mykt bedre kan bli
  beskåret. **Mottiltak:** bound-en får en eksplisitt slakk-margin (standard
  +25 % av Tub, mot v1s `Tub + step + tackPen`), og kan slås helt av i
  referansemodus.
- **Motoren er en heuristikk, ikke en eksakt Pareto-løser.** Etikett-takene
  gjør at fullstendighet ofres bevisst. Dette må stå i spec-en og i UI-språket
  vårt: motoren finner gode, robuste ruter — den beviser ikke optimalitet.
  Spec-en definerer en **referansemodus** (alle tapsgivende beskjæringer av)
  som brukes i egenskapstester på små problemer, slik at monotonitets- og
  admissibilitetsegenskaper kan verifiseres der de faktisk holder.
- **Mer kode å teste.** Dominansregel, sektorkvantisering, utkastingsregel og
  TSS-retningssjekk er fire nye komponenter som alle må ha egne enhetstester,
  og hver algoritmeendring krever ny golden-route-kjøring.

### Det vi gir avkall på

- **Full hybrid-DP/optimal kontroll** for tack-modellering: vi får ikke
  integrasjonen over vindtilstander etter halsbytte som Miles & Vladimirsky
  gjør. Vår bautstraff er en funksjon, ikke en overgangsdynamikk.
- **Eksakt optimalitet innenfor diskretiseringen** som en tidsekspandert
  Dijkstra ville gitt.
- **Full Pareto-fullstendighet** (ofret til etikett-takene, se over).
- **MDP/stokastisk usikkerhet inne i søket**: usikkerheten lever utelukkende i
  ensemble-aggregeringen (fase 4), aldri i selve rutesøket. Én konsekvens: en
  enkeltrute vet ikke at den er skjør — det er robusthetslagets jobb å si det.
- **Kjeglens billige pruning**, med den ytelsesrisikoen det innebærer.

### Hva må bygges om hvis vi ombestemmer oss?

Det bærende er **etikett-strukturen og tilstandsnøkkelen** — bytter vi
metodefamilie, må ekspansjonsløkken, dominanslogikken og
resultatrekonstruksjonen skrives om. Det som **overlever** et familieskifte er
alt vi har isolert bak grensesnitt: farbarhets-/maskeaksessoren
(`docs/specs/farbarhetsmaske.md`), værfelt-aksessoren, båtmodellen
(`packages/polar`), A\*-avstandsfeltet, sikkerhetsettersjekken og hele
golden-route-harnessen. Det er en bevisst kostnadsforsikring: en eventuell
overgang til tidsekspandert graf i fase 4b ville berøre én fil-familie i
`packages/routing`, ikke kontraktene rundt.

## Bekreftelse

Slik ser vi i koden at beslutningen faktisk følges:

1. `packages/routing` eksporterer en etikett-type med kostnadsvektor på fire
   heltallsfelt (`tS`, `beatS`, `motorS`, `nightS`) og en `dominates(a, b)` som
   er ren og totalt definert. Enhetstest verifiserer at dominansrelasjonen er
   irrefleksiv, antisymmetrisk og transitiv, og at hver tilstands etikettmengde
   til enhver tid er en antikjede (assertion-harness i testbygg).
2. Tilstandsnøkkelen inneholder kurssektor. Enhetstest verifiserer
   kollisjonsfrihet over Skandinavia-bboxen og korrekt wrap ved 0/360°.
3. Ekspansjonssteget har **to navngitte faser** i koden — `checkHard(...)` som
   kun returnerer avvisning/godkjenning, og `accumulateSoft(...)` som kun
   returnerer kostnadsbidrag. Ingen hard sjekk returnerer et tall, og ingen
   myk kostnad kan avvise en kandidat. Kodegjennomgang + test som mater inn en
   absurd høy myk kostnad og verifiserer at den aldri gjør en no-go-passasje
   gyldig.
4. TSS-retningssjekken er en egen, navngitt funksjon med egne tester
   (tvers → tillatt, langs i riktig retning → myk kostnad, langs i feil
   retning → hard avvisning), ikke en generisk sonekostnad.
5. Kjeglen er `undefined` som standard i motorens konfigurasjon; testen som
   låser standardverdien feiler hvis noen setter den på igjen uten å oppdatere
   denne ADR-en.
6. `tools/arch-tests` (`pnpm test:arch`) utvides med en statisk sjekk på at
   `packages/routing` og `packages/geo` ikke inneholder `Date.now`, `new Date`,
   `Math.random`, `performance.now`, `setTimeout`, `setInterval`, `fetch`,
   `crypto` eller `node:`-import. Determinismen håndheves strukturelt, ikke ved
   disiplin.
7. `pnpm test:golden` kjører golden-ruter med frosne værfelt og frossen
   kartpakke. Hver algoritmeendring krever ny kjøring med forklart diff i
   spec-ens endringslogg.

Full utdyping i `docs/specs/rutemotor.md` (gjeldende — ADR-0004 godkjent
2026-08-30).

## Kilder

- `docs/research/rutemetodikk.md` (2026-08-30) — metodikk-gjennomgangen denne
  ADR-en bygger på, inkludert kildekritikk av hva som faktisk ble verifisert.
- `docs/research/spike-ensemble-perf.md` (2026-08-30) — ytelsestallene som
  gjør isokron til det målte, ikke bare antatte, valget.
- `docs/research/v1-funksjonsanalyse.md` (2026-08-30) — referansen.
- `docs/00-kravspek.md` v1.0, F3.1–F3.5, F4.1–F4.5, F1.1–F1.6, N5, N6.
- `C:\RoutePlanner\morild_weather_router.html` (SKRIVEBESKYTTET fasit),
  `computeRoute` linje 675–805 — v1s faktiske mekanikk, lest 2026-08-30.
