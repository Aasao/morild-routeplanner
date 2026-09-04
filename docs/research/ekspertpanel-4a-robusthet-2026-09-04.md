# Ekspertpanel fase 4a — robusthet (D8.1–D8.9)

- Dato: 2026-09-04
- Status: ferdig — to runder + tilsvar + votering; syntese i §5.
  D8.1–D8.13 vedtatt av Magnus 2026-09-04 som anbefalt
  (`docs/specs/robusthet.md` §7).
- Grunnlag: `docs/research/beslutningsgrunnlag-4a-robusthet-2026-09-04.md`
  (samme tekst til alle roller).
- Metode: fem fageksperter (matematiker/multiobjektiv stioptimering — opus;
  værruting-produksjonsutvikler, ytelsesingeniør storskala ruting,
  marinkartolog/ECDIS, operativ marin meteorolog — sonnet) leste grunnlaget
  uavhengig og voterte per D8.x. Deretter tre utfordrere (djevelens advokat,
  lateral tenker, pragmatiker), så tilsvar. **Simulerte fagperspektiver,
  ikke reelle personer.** Verdien er uavhengig lesning av samme grunnlag;
  panelet godkjenner ikke — Magnus vedtar. Tilsvar-runden ble kjørt ved å
  re-etablere rollene med eget runde 1-svar + utfordringene (SendMessage var
  ikke tilgjengelig i sesjonen).

## 1. Runde 1 — råd

### 1.1 Matematiker (multiobjektiv stioptimering)

**D8.1 — GODKJENN (a), med én tilføyelse.** Rangering er en total ordning
og spec-en må fastsette tie-break eksplisitt. E1 §5.2 viser at eksakt
uavgjort ikke er hypotetisk: S-5 `+3 t` og `+4 t` er bit-identiske doubler
(14,4825 t). Uten regel blir toppavgangen avhengig av iterasjonsrekkefølge.
Foreslå: (P90 ↑, gjennomførbarhetsandel ↓, tidligste avgang). Relatert bug:
`runEnsemble` pusher `outcomes` i **fullføringsrekkefølge**
(`apps/pwa/src/weather/ensemble.ts`, `drain`) — enhver ordensfølsom
statistikk (paret differanse, «hvilket medlem er P90») må sortere på
`memberIndex` først, ellers er F4.2 ikke-deterministisk på tvers av
kjøringer.

**D8.2 — ENDRE, dette er punktet jeg er hardest på.** Delt A\*-felt:
GODKJENN uforbeholdent (feltet er væruavhengig, deling er bit-identisk, og
det er allerede i API-et men ubrukt av klienten). **Delt Tub fra kontrollen
er ikke trygt slik det står.** Mekanikken i `search.ts:720–725` beskjærer
på `cost.tS + remainingNm·3600/(boundSlack·vmaxKn) > Tub·(1+tubMarginFrac)`,
og `vmaxKn` (linje 315) utledes av *medlemmets eget* felt. To feilklasser
følger:

1. **Falsk ugjennomførbarhet.** Har medlemmet `T*_m > Tub_kontroll·1,25`,
   beskjæres hver eneste etikett på medlemmets optimale sti, søket når
   aldri målet, og medlemmet telles `infeasible` med
   `coverage.weather = "full"` — ikke inkonklusivt. Det er nøyaktig tallet
   ADR-0005 sier bare skal komme fra fulle søk, produsert av en
   ytelsesspak. Samme klasse feil som felte variant B.
2. **Retningen er dobbelt gal.** De medlemmene som beskjæres bort er per
   konstruksjon de *treige*. De forsvinner ut av det gjennomførbare
   utvalget P90 regnes over ⇒ **gjennomførbarhetsandelen faller (ser rødt
   ut) samtidig som P90 faller (ser raskt ut)**. To signaler som lyver i
   hver sin retning, av samme årsak. Under N2 uakseptabelt.
3. Tub er endimensjonal (§5.5, «beskjærer på tid»). F4.2 rapporterer
   eksplisitt *spredning i kryss-/motorandel* — altså de dimensjonene Tub-en
   beskjærer skjevt.

E1-forkrav 6 (`e1-forkrav.test.ts:604–625`) beviser at målingene ble kjørt
**uten** delt felt og delt Tub. Alt E1 validerte gjelder derfor ikke en
produksjonskonfigurasjon med delt Tub. Anbefaling, billig: del Tub som
*soft* bound med obligatorisk redningsvei — terminerer et medlem uten
`reachesDestination` mens `pruned.bound > 0`, er ugjennomførbarheten
**ikke bevist**; medlemmet kjøres om uten bound før det får telle. Bare de
faktisk rammede medlemmene betaler. Uten den ventilen: AVVIS delt Tub for
alt som bærer F4.2-tall.

**D8.3 — ENDRE (fire ting).**
*Persentilen.* `percentile()` bruker `Math.floor((p/100)*n)` som 0-indeks.
Det er nærmeste-rang unntatt når p·n er heltall, der den tar én rang for
høyt: n_f = 30 gir x₍₂₈₎ (effektivt P93,3), nærmeste-rang gir x₍₂₇₎; n_f =
29 identiske. Estimatoren skifter definisjon med n_f, og to avganger med
ulikt n_f sammenlignes med ulike statistikker — skadelig for F4.5. Fastsett
nærmeste-rang `k = ⌈p·n_f/100⌉`, 1-indeksert, i spec-en.
*n_f ≤ 30 er tynt, og det må sies i UI.* For n_f ≤ 10 er P90 identisk med
maksimum. Som øvre konfidensgrense for den sanne 0,9-kvantilen har x₍₂₇₎
av 30 bare ~50 % dekning; x₍₂₉₎ gir 82 %, maksimum 96 %. F4.4 selger P90
som **plantid**. Enten (i) plantid = x₍₂₇₎ vist *sammen med* verste
gjennomførbare medlem («regn med 28 t; verste medlem 33 t»), eller (ii)
plantid = x₍₂₉₎. Anbefaler (i). Under n_f < 12 skal ordet «P90» ikke
brukes — vis «verste av N gjennomførbare».
*Nevneren.* Koden bruker `feasible/total` — inkonklusive og feilede
medlemmer sitter i nevneren; en algoritmisk abort leses som «mindre robust
vær». Fiks: `n_f/(n_f+n_inf)`, feil utenfor, `errorCount > 0` synlig flagg.
P50/P90 er betinget på gjennomførbarhet (sensurert fordeling): ved lav
andel er P90 systematisk optimistisk. Regel: plantid vises ikke som tall
når andelen er rød.
*Paret differanse.* Riktig konstruksjon (E1 §5: paret median 0,0000 mot
uparet +3,24 %), men kun gyldig på medlemmer gjennomførbare i **begge**
avganger — post-hoc seleksjon. Krav: paret sammenligning kun når
|n_f(A) − n_f(B)| ≤ 2; ellers leksikografisk på gjennomførbarhet.
Rapporter alltid n_felles.
*Trafikklyset som statistikk.* 0,9/0,7 som grenser er greie, men ikke på
punktestimatet: sd(p̂) ved p=0,9, n=30 er 0,055 — 27/30 mot 26/30 flipper
lyset på ett medlem. Bruk ensidig nedre Wilson-grense (90 %) mot
terskelen; feiler mot gult, fjerner flimring når medlemmer strømmer inn.
Forkast `P90/P50 ≤ 1,25` (dimensjonsløst forhold mellom to støyende
ordensstatistikker). Det beslutningsrelevante er om [P10, P90] **krysser
en grense** (mørkeankomst, frontpassasje) — samme størrelse D8.5 finner.
«Rødt = kontrollen ugjennomførbar» splittes: kontrollen er ett medlem av
31, ikke fasit; «ingen kontrollrute å tegne» er et eget utsagn.

**D8.4 — ENDRE.** Kontroll-perturbasjon er greit for attribusjon og UI,
ikke for gjennomførbarhet: cruising-faktor kommuterer ikke med værfeltet
(en tregere båt møter en annen værsekvens — i frontpassasjene), og v1
sier 0,86–1,21. Kjør minimum lav cruising-faktor på **P90-medlemmet og
marginalmedlemmene** — 2–3 ekstra søk. Kravspekens ±0,05 bør bære datert
revisjon.

**D8.5 — ENDRE, med statistisk forbehold i spec-en.** Søk etter tidligste
t\* med skille i TWD/TWS over ~48 steg × 2 variabler × mange terskler på 30
punkter finner **alltid** en perfekt separator ved tilfeldighet — multippel
testing. Krav: (a) leave-one-out over medlemmene, forkast om regelen ikke
overlever; (b) treffraten står i teksten («skiller 28 av 30 medlemmer»);
(c) fallback også ved svak treffrate.

**D8.6 — ENDRE.** «Lengste strekk uten brukbart alternativ» er et
sikkerhetstall; kontroll-i-kontrollvær er ikke bevisbart konservativt,
bare billig. For valgt avgang: **maks over medlemmer** (ikke P90 — hard
skranke). Bruk A\*-vannavstandsfeltet som **admissibel nedre grense** for
tid til havn (`Dₙ·3600/Vmax`): er selv den optimistiske grensen > 6 t, er
punktet bevist uten bail-out; bare ubestemte punkter trenger R2-søk.
Tabellens kontrolltall beholdes, merket. `backoffSteps` → fysisk tid:
GODKJENN.

**D8.7 — AVVIS sekvensiell tidlig-stopp som konfidensregel; GODKJENN én
deterministisk variant.** Peeking med fikst-n-KI holder ikke nivået
(krever anytime-gyldig konstruksjon), og P90 er en halestatistikk: ved
k=12 er 90-persentilen ikke estimerbar uten fordelingsantakelse;
medlemsindeks er ikke tilfeldig mht. varighet. Forutsetning også for at
strømmet delsum er meningsfull: **medlemsrekkefølgen må være en
deterministisk pseudotilfeldig permutasjon**, ikke 0…30. Forsvarlig:
stopp på **deterministisk sertifikat** — utfallet avgjort uansett resten
(≥ 4 av 30 gjennomførbare > T ⇒ x₍₂₇₎ > T bevist; antall ugjennomførbare
> (1−0,7)·n ⇒ rødt bevist). Asymmetri: «ikke grønt» kan bevises billig,
«grønt» aldri. Ingen semantisk endring. Alt annet tidlig-stopp er
semantikk til Magnus.

**D8.8 — GODKJENN, skjerp.** Import-test nødvendig, ikke tilstrekkelig:
`provenance`-felt på `RouteResult` som bare `planRoute`/`createSearch`
setter; aggregeringen kaster på alt annet. Test at medlem med
`pruned.bound > 0 && !reachesDestination` ikke kan telles `infeasible`.

**D8.9 — ENDRE: fikstur og støygulv defineres sammen, etter D8.3.**
Bygg på S-7-generatoren (to-regime) — unimodale familier kan ikke lage
topologiske splitter, og tung høyrehale er det som skiller P50 fra P90.
Avgang A: 25 medlemmer rekker foran fronten, 5 blir tatt; avgang B: alle
etter fronten, høyere median, stram. argmin P50 = A, argmin P90 = B.
Støygulv målt: jackknife over medlemmene, maks over k av |P90 − P90₍₋ₖ₎|.
Aksepttest forhåndsregistrert: |P90(A) − P90(B)| ≥ 3× jackknife-gulv og
≥ 5 % relativt; rangering invariant under leave-one-out for alle 30;
invariant under 6° vs. 10° og ±1 tidssteg; paret medianforskjell peker
motsatt vei av P90-rangeringen; forventet toppavgang registrert før
kjøring.

**B. Hva mangler.** (a) Tie-break og sortering på `memberIndex`. (b)
Deterministisk permutasjon av medlemsrekkefølge. (c) Feilkategori ut av
nevneren og synlig flagg. (d) Udefinert oppførsel når **kontrollen** er
inkonklusiv eller feiler. (e) N6: 30 × 5–8 fulle `RouteResult` med `steps`
sprenger 500 MB — spec må fastsette hvilke medlemmer beholdes i full form
(kontroll, P50-, P90-, verste medlem, viftens medlemmer); resten reduseres
til kostnadsvektor + klassifisering ved mottak. (f) Versjonsstempel på
hvert robusthetstall (maskeversjon, pakkeversjon, opsjons-hash, n_f,
estimatordefinisjon). (g) Hvilke medlemmer viften tegner.
**Spaker før nettbrett-tallet:** kjør nettbrett-målingen nå (port 1).
Før tallet bare semantikk-fritt: koble delt A\*-felt inn i klienten;
arena-/buffergjenbruk; delte read-only-cacher. Utsett delt Tub, profilsøk,
betinget sektornøkling, alloc-fri hot-loop. `hardwareConcurrency − 1` lyver
på nettbrett med effektivitetskjerner — mål.
**N2:** perturbasjon ja for attribusjon, nei for gjennomførbarhet;
bail-out nei som bart tall.
**C. Målinger:** nettbrett-tallet; skade-måling for delt Tub på S-3/S-7
(null gjennomførbarhetsflipp, |ΔP90| ≤ 0,5 %); `maxₘ T*ₘ / T_kontroll` på
ekte MEPS (> 1,25 én gang ⇒ delt Tub død); jackknife-gulv per fikstur;
gjennomførbarhetens oppløsningsavhengighet 6° vs. 10°; falsk-funn-rate for
D8.5-separatoren på støyfikstur.

### 1.2 Værruting-produksjonsutvikler

**D8.1** GODKJENN (a). **D8.2** GODKJENN m/presisering: tub må aldri kutte
et tregere medlem — mål, ikke anta; stille falsk «ugjennomførbar» er verre
enn ingen tub. **D8.3** ENDRE: gult som foreslått betyr for mye på én gang
(andel ELLER P90-brudd); seileren må vite HVILKEN grunn — krev at
gult-teksten navngir årsaken. **D8.4** ENDRE (se under). **D8.5** ENDRE:
konseptet riktig, formuleringen lover mer enn enkeltvariabel-sektorregelen
holder. **D8.6** GODKJENN (kontroll i tabell, per-medlem for valgt) — MEN
synlig i UI, ikke stille forskjell. **D8.7** GODKJENN rekkefølgen.
**D8.8** GODKJENN — skriv den først. **D8.9** GODKJENN.

**Hva mangler:** motorforbruk-usikkerhet (drivstoffmargin er en
sikkerhetsgrense ved lang motorstrekning — F4.3 nevner ikke drivstoff);
tidsbudsjett i grønt-regelen er udefinert (feltet finnes ikke i
kravspeken — UI må aldri late som det finnes); n_f < 10 er et UI-spørsmål
(«for få data til å konkludere»); konfliktsignaler (værensemble grønt,
cruising-perturbasjon rødt — hvilket vinner?).
**Spaker:** trygt nå: alloc-fri hot-loop og delt cache. Vent: profilsøk og
betinget sektornøkling (kan påvirke determinisme/rangering — valider mot
fiksturene først). Tidlig-stopp: ikke rør før Magnus har svart.
**N2:** kontroll-basert i tabellen er screening, akseptabelt; for valgt
avgang må brukeren se forskjellen — synlig markør på alt kontroll-basert
(«basert på kontrollvær — spredning ikke beregnet ennå»).

**Formuleringer (norsk, til appen):**
- Grønt: «Robust. Regn med inntil 31 t (typisk 27 t).»
- Gult (andel): «Usikker: 2 av 10 værutfall kommer ikke frem som
  planlagt. Følg vindviften underveis.»
- Gult (tid): «Usikker: kommer trolig frem, men kan ta vesentlig lengre
  tid enn normalt (opptil 38 t mot typisk 27 t).»
- Rødt: «Frarådes nå: mer enn 3 av 10 værutfall når ikke frem. Vurder
  senere avgang.»
- Plantid: «Regn med inntil [P90] t (typisk [P50] t).» — aldri «P90»,
  aldri prosent i førstesetningen.
- Beslutningsregel: «Sjekk kl. [HH:MM] ved [sted]: har vinden dreid til
  SV? Hvis ikke — vent til [neste vindu] eller revurder ruten.» Fallback:
  «Ingen enkelt sjekkpunkt skiller utfallene i dag — følg vindviften
  underveis og revider om vinden avviker fra kartet.» Aldri regel uten
  fallback klar i koden.

### 1.3 Ytelsesingeniør

**D8.1 — GODKJENN (a):** `ensemble.ts` er allerede bygget rundt injiserbar
`WorkerLike`/`WorkerFactory` for å teste orkestrering uten tråder — det
krever I/O-fritt aggregeringslag.
**D8.2 — ENDRE.** Feltstørrelse er ikke problemet: Skjæløy→Skagen
(`cellDeg=0,01`) ≈ 20 000–40 000 celler × 8 B ≈ **0,2–0,3 MB** —
transferable kopi per worker er riktig og billig; SharedArrayBuffer feil
verktøy uansett. Men **koden bygger IKKE delt felt i dag**:
`PlanRouteMemberRequest` har ingen `field`/`tubBoundS`, så `search.ts`
bygger feltet på nytt per medlem × pool. Hver rebuild trolig < 1 ms — ikke
flaskehals i seg selv (stemmer med spikens F6), men budsjett-tabellens
forutsetning er brutt. **Tub fra kontroll: ENDRE** — kontrollens beste tid
+ `tubMarginFrac=0,25` er ikke konservativ for et medlem med lavere vind
(40 %-spenn i fart); bound bør avledes fra **verste-fart-scenario over
ensemblet**. Korrekthetsspørsmål — flagg til rutemotor-agenten.
**D8.3–D8.6, D8.9:** ingen sterke innvendinger; D8.4s 4 ekstra søk vs. 120
er riktig avveining.
**D8.7 — ENDRE (rekkefølge OK, bug funnet):**
`apps/pwa/src/weather/ensemble.ts::runOnWorker` kaller
`worker.addEventListener("message"/"error", …)` per jobb uten å fjerne
lytteren — en pool-worker akkumulerer N lyttere, O(n²) lytterinvokasjoner
per worker over 30 medlemmer, lekkede closures. Fiks med `{once: true}` i
første bølge uavhengig av spakprioritering.
**D8.8 — GODKJENN**, skriv tidlig.
**Hva mangler:** **spikens gunstige tall (1,3–8,4 s/avgang) er ugyldige
etter ADR-0005** — målt ved 12° som ADR-en forkastet. Reelt kostnadsgrunnlag
er `maaling-e1` §7.4: **67–99 s per avgang på PC på full oppløsning**,
allerede over 60 s for ÉN avgang før nettbrett-derating. Skal stå i
robusthet.md så ingen siterer spiken.
**Spaker før nettbrett-tallet (strukturelle, PC-målbare):** (a) fiks
lytterlekkasjen; (b) koble delt A\*-felt gjennom worker-meldingen (bygg én
gang, `transfer` per worker); (c) profilsøk over vinduet og alloc-fri
hot-loop; (d) delte read-only-cacher. **Krever nettbrett-tallet:**
poolstørrelse (`hardwareConcurrency` kan være 3–7) og om progressiv
semantikk er nok.
**N2:** ja, betinget av UI-merking «beregnet på kontrollvær».

| # | Spak | Anslått gevinst | PC-målbart nå |
|---|---|---|---|
| 1 | `{once:true}` på worker-lyttere | liten, gratis | ja |
| 2 | Delt A\*-felt gjennom worker-melding | strukturell | ja |
| 3 | Konservativ delt tub (verste-fart) | ukjent, mulig stor | ja, mot golden |
| 4 | Profilert søk over avgangsvinduet | ADR: ~3–4× | ja |
| 5 | Alloc-fri hot-loop / arena-gjenbruk | ADR: 1,5–2× | ja |
| 6 | Delte read-only-cacher | ADR: 1,2–1,5× | ja |
| 7 | **Re-mål E1-scenarioet for ÉN avgang isolert**, full oppløsning, med 1–2 på plass | avdekker faktisk PC-gap | **haster mer enn nettbrett-målingen** |
| 8 | Nettbrett-måling (port 1) | avgjør resten | betinget av 1–7 |

Anbefalt: 1→2→3→7 FØR 8.

### 1.4 Marinkartolog

**D8.1** GODKJENN. **D8.2** ingen votum, men: tub-bound fra kontrollen må
aldri smitte inn i R2s re-søk — bekreft eksplisitt. **D8.3** GODKJENN m/
presisering: ved n_f < 10 skal n_f rapporteres synlig ved siden av P90.
**D8.4** ENDRE (se N2). **D8.5** ENDRE — klokkeslettet må aldri være
operativ trigger alene. **D8.6** ENDRE, hoveddel under. **D8.7:**
R2-maskineriet for F4.6 må være eksplisitt UNNTATT sekvensiell
tidligstopp. **D8.8** GODKJENN; utvid: bevis at F4.6-bruk av `bailout.ts`
alltid kjører `mode: "pareto"` (full maske) — variant B er diskvalifisert
av m24, og bail-out-tall er mer sikkerhetskritiske enn rangeringstall.
**D8.9** GODKJENN i prinsipp.

**D8.6 i detalj.** *Kjernefunn:* `r2Verdict`/`r2FromFailure` er en
**felle-detektor** — trigges kun av `isHardRejection`, altså etter at
ruten allerede har feilet. Den anbefalte ruten («Lengste strekk uten
nødhavn: 6 t») har ingen harde avvisninger. F4.6-tallene regnet fra R2
slik det står gir null treff på en trygg rute: mekanismen må kalles
**samplet langs hele ruten**, uavhengig av feil. *Kostnad:* full
Pareto-resøk × samplet posisjon × havn, potensielt × 30 medlemmer, er en
egen kostnadspost E1′ aldri målte — mål separat før 4a-budsjettet.
*Backoff i fysisk tid — ikke lukket:* `backoffSteps` i array-steg; ved
adaptivt tidssteg betyr `1` ulik fysisk tid ulike steder. Lukkes FØR
havneboken tas i produksjon. *Tom/ufullstendig havnebok (N2):* tom
`cfg.harbours` gir `isTrap: true, attempts: []` — umulig å skille «alle
havner feilet» fra «ingen havner registrert». Krav: `coverage.bailout:
"none" | "partial" | "full"`, UI viser «havnebok mangler dekning her»,
ikke «ingen brukbart alternativ».
**Hva mangler:** dybde-ved-kai/ankring (R2 kan lede til havn som er
grunnere enn dypgang — samme feilklasse som D7.3-vaktbåndet);
mørkeinnseiling (svenske skjærgårdshavner); tidevann som felt.
**N2:** bail-out-tall kontroll-basert **uten merke: nei**. Per-medlem
(minst P90) for valgt/topp-avgang som krav, ikke forslag.

**Havnebok-datamodell (utvidelse av `BailoutHarbour`):**

| Felt | Begrunnelse |
|---|---|
| `minDepthAtQuayM` / `minDepthAtAnchorageM` (kilde + dato) | Havn nås ikke hvis innseiling < dypgang + margin. Mangler ⇒ ekskludert fra R2 med flagg. |
| `nightApproachSafe` (+ notat «kun lokalkjent») | Ankomst i mørket uten flagget forkaster havnen for det forsøket. |
| `tideSensitive` / tidevannsnotat | Reservert; kan starte tomt. |
| `updatedAt` + enhets-ID | F6.1 LWW. |
| `notes` | Magnus' lokalkunnskap. |
| `verifiedByMagnus` | Personlig, ikke autoritativ; uverifisert ser annerledes ut i UI. |

**Presise definisjoner:** (1) «Lengste strekk uten brukbart alternativ:
X t» = maks over samplede punkter p langs den anbefalte ruten av
`bailoutTimeS(p)` = min over havner h (som består dybde-/mørke-/tidevanns-
gate) av full Pareto-resøk fra (p, t(p)) til h på **udelt maske** +
`harbourApproachable(h, vær, ankomst)`; «≥ 6 t» når ingen nås innen
R2_LIMIT; sample-intervallet rundes konservativt opp. (2) «Tid til
nærmeste bail-out gjennom passasjen» = samme `bailoutTimeS(p)` som løpende
bånd langs ruten i F4.4-tidslinjen, ikke kollapset. Begge: kontrollvær i
tabellen **merket «ikke ensemble-sjekket»**, per-medlem for valgt avgang.

### 1.5 Operativ marin meteorolog

**D8.1, D8.2, D8.8:** utenfor mitt felt.
**D8.3 — ENDRE.** P90 av 30 MEPS-medlemmer er *betinget på MEPS'
vindspredning alene*, med Hs/strøm deterministisk. MEPS er dokumentert
underdispergerende, særlig 0–24 t og for kystnære effekter
(terrengkanalisering, solgangsbris) som 2,5 km ikke løser fysisk. Presenter
som «P90 vindusikkerhet (MEPS)», ikke generisk plantid. n_f < 10: «tynt
utvalg», rå spredning i stedet for persentil.
**D8.4 — ENDRE.** ±0,05 er for smal mot egne data (0,86–1,21); utvid til
minst {0,85; 0,90; 0,95} pluss regimebetinget par. Cruising-faktoren er
vindregimeavhengig — kontroll-kjørt perturbasjon fanger ikke «medlem med
mer vind + samme faktor». Merk som kjent forenkling.
**D8.5 — ENDRE.** Metodikken er meteorologisk fornuftig for kaldfront-
passasje (S-3). (1) Konkordanskrav ≥ 70–80 % av medlemmene enige om
retning på skillet ved t\* før regelen tilbys; fallback oftere enn man
tror. (2) «Verifiser mot observasjon om morgenen» forutsetter
observasjonskilde som ikke finnes i 4a (F5 senere): «sjekk selv kl.
HH:MM», ingen antydning om automatisk varsling.
**D8.6 — GODKJENN m/presisering.** Hs (WAM, deterministisk) er ofte den
faktiske porten i `harbourApproachable`; timingen av når Hs-feltet treffer
ruten varierer med medlemmets vindfart — kontrolltallet kan undervurdere
nær et fronttreff. Fotnote/lenke i tabellraden.
**D8.7:** sekvensiell tidlig-stopp er farlig kombinert med lagget ensemble
— rekkefølge korrelert med lag-alder gir skjult skjevhet. Om det innføres:
tilfeldig/uniform rekkefølge over medlems-ID.
**D8.9:** bygg på reell bimodalitet, ikke glidende spredning.
**Hva mangler:** aggregeringen låses på syntetiske fiksturer — §9.8-remåling
på ekte MEPS som eksplisitt D8.3-avhengighet; bølge/strøm-usikkerhet mangler
som eget punkt; ingen tilbakemeldingsløkke for D8.5-regelen.
**N2:** ja, forutsatt at perturbasjons- og kontroll-bail-out-tall aldri
blandes inn i P90/trafikklys-tallet.

**Ensemblet dekker ikke:** bølger (WAM800, deterministisk, selv om Hs er
hard port); strøm (NorKyst, deterministisk); lokal solgangsbris/
kystkanalisering; medlemsalder i lagget ensemble (opptil 6 t). **UI:** (1)
«P90 vindusikkerhet (MEPS)»; (2) fast infotekst «bølge- og strømusikkerhet
er ikke dekket av dette tallet»; (3) perturbasjonsresultater som egne
«følsomhets»-chips; (4) aldersspenn ved siden av P90 når > 0 t; (5)
n_f < 10 ⇒ «tynt utvalg».

## 2. Runde 2 — utfordring

### 2.1 Djevelens advokat

Alle fem fikk **samme beslutningsgrunnlag**, der §2 alt har låst
«progressiv semantikk er UX-kontrakten» og «trafikklys + P90 + én regel»
som ikke til diskusjon. Det panelet kaller enighet er ofte at ingen fikk
lov til å uenes om premisset.

1. **P90-som-plantid er en optimisme-stabel.** MEPS er underdispergerende
   (meteorolog) OG x₍₂₇₎ av 30 har ~50 % dekning (matematiker) — begge
   biaser samme vei, ingen kansellerer den andre. Produktet lover et tall
   der begge feil trekker mot at virkeligheten er verre enn skjermen.
   Falsifisert hvis faktisk utfall ligger innenfor vist P90 i ≥ 90 % av
   avgangene over en sesong. Svar: meteorolog + matematiker, *sammen*.
2. **Progressiv semantikk er vedtatt før den er tjent.** ADR-0005 skrev
   «sannsynlig utfall» FØR nettbrett-tallet, og porten er umålt. D8.7
   designer spaker som om progressiv semantikk er konklusjon, ikke
   hypotese. 67–99 s per avgang på PC gjør «< 60 s for én avgang» usant på
   egen maskinvare i dag. Falsifisert hvis nettbrett-tallet etter spak 1–3
   fortsatt er > 60 s for én avgang — da er «progressiv» et nytt navn på
   et sprengt budsjett. Svar: ytelsesingeniør; Magnus om F3.5 skal
   gjenåpnes formelt.
3. **«F for alle 30» ble vedtatt på et kostnadstall panelet i dag
   erklærer ugyldig** (spike 1,3–8,4 s/avgang, målt ved 12°). Ingen spør
   om ADR-0005s vedtak selv bør gjenåpnes. Falsifisert hvis re-målingen
   (spak 7) viser at F fortsatt vinner mot A/B under ekte kostnadsbilde.
   Svar: matematiker + ytelsesingeniør.
4. **Trafikklys + én setning tar ansvar fra seileren, og B3 er eldre enn
   alt den skal oppsummere** (besluttet 2026-08-30, før ADR-0005, R2 og
   D8.6-funnet). Hver ekspert presser MER inn i formatet uten å spørre om
   det tåler vekten. Bør B3 revideres, ikke bare fylles opp? Svar: alle.
5. **F4.6 i 4a er trolig ikke gjennomførbart i noe reelt budsjett.**
   Kartologens R2-kostnad (Pareto-resøk × posisjon × havn × medlem) oppå
   67–99 s. Ingen har lagt tallene sammen. Svar: kartolog +
   ytelsesingeniør.
6. **Alt er kalibrert på syntetiske fiksturer.** Fem foreslår konkrete
   tall (0,9/0,7, jackknife, 70–80 %) som om S-1…S-8 generaliserer. Samme
   felle som E1. Svar: alle.
7. **Sertifikat-tidligstopp har retningsskjevhet i opplevelsen:** rødt/
   gult vises alltid raskere enn grønt — appen raskest til å skremme,
   tregest til å berolige. Produktvalg forkledd som matematikk. Svar:
   værruting.
8. **Ingen angriper at N = 30 er riktig.** 50 % dekning ved n=30 er nesten
   et argument for at svaret er nei; ingen foreslår full fordeling/verste
   tilfelle som primærtall med P90 sekundært. Svar: matematiker +
   meteorolog.

Konklusjon: konvergensen på D8.1/D8.8 er trolig ekte; konvergensen på
«P90 er riktig tall, bare defineres riktig» og «progressiv semantikk løser
budsjettet» er mistenkelig — premisser ingen fikk mandat til å teste.

### 2.2 Lateral tenker

1. **Bail-out baklengs: ett vannavstandsfelt PER HAVN.** Dijkstra fra
   havnen og utover, væruavhengig, bygges én gang per (maskeversjon,
   oppløsning), delbart for alltid. «Tid til nærmeste bail-out» blir
   O(1)-oppslag: min over feltverdier ved punktet; `harbourApproachable`
   per medlem oppå. Feltet siler, avgjør ikke — ADR-0005 brytes ikke.
   Kostnad: 10–30 baklengs-søk ved oppstart/maskeoppdatering. **4a.**
2. **Beslutningsregel fra rutenes geometriske divergens.** Klyng de 30
   medlemsrutenes posisjon-ved-tid i to grupper; tidligste t\* der de
   skiller seg med margin. Regelen blir «er du nord eller sør for [punkt]
   kl. [tid]» — sjekkbart med GPS, ikke værtolkning. Samme multippel-
   testing-disiplin. 4a som eksperiment, ellers 4b.
3. **Terskelkryssing-telling i stedet for/ved siden av P90.** «Kommer
   frem før mørket i 27 av 30 utfall» — binomisk andel, ikke
   halestatistikk; Wilson blir riktig verktøy for ALLE tall. Krever
   eksplisitt terskel (mørke, budsjett). **4a, sammen med D8.3 før
   persentilen fryses.**
4. **Skalarsøket (A) som rekkefølge-verktøy, ikke sparetiltak.** Kjør A
   først for å bestemme rekkefølgen på de fulle søkene; ingen tall leses
   før tilhørende fulle søk er ferdig. Arkitekturtest utvides. 4a, lav
   risiko, valgfritt.
5. **Etterprøvingsløkke: prognose-kvittering per avgang** (P50/P90,
   farge, regelens t\*/vilkår, n_f) i samme loggspor som v1s bro; etter
   sesongen reliability-diagram. Gjør tallene testbare mot virkelighet —
   ingen av de fem foreslår mekanisme. **4a som logging; analyse ved
   sesongslutt.**
6. **Aldersvekting av lagget ensemble.** Aldri i 4a uprøvd; 4b tidligst,
   etter måling som viser at alder predikerer avvik.
7. **Drivstoffmargin som biprodukt.** `motorS` × 3,0 l/t → «P90
   drivstoff-margin» uten nytt søk; falsk presisjon på forbrukstallet.
   4a hvis produksjonsutviklerens punkt tas videre.

### 2.3 Pragmatiker

**Overdesign:** matematikerens D8.3-pakke (Wilson, jackknife, full
forhåndsregistrert D8.9-protokoll med 6°/10°-invarians) er riktig
matematikk for et publiserbart resultat, men bygger infrastruktur for et
tall Magnus ser én gang per avgang. Meteorologens fem UI-tillegg stables
oppå et format B3 låste — informasjonsmengden konkurrerer med
beslutningen. **Underdesign:** ingen har spurt hvem som vedlikeholder
havneboken (datainnsamling over sesonger, ikke en kodebølge); spec-språket
må være lesbart for Magnus om et år. **Ekte funn:** D8.2 (delt Tub lyver i
to retninger) og D8.6 (felle-detektor gir null på trygg rute) er
sikkerhetskritiske hull — fikses uansett budsjett.

**Bølgeplan 4a:**
1. *Sikkerhetsnett + rigg:* D8.8 arkitekturtest først; `packages/
   robustness`-skjelett; `{once:true}`; delt A\*-felt gjennom worker-
   meldingen; D8.2 soft Tub m/redningsvei. Exit: arch grønt; skademåling
   S-3/S-7 null flipp, |ΔP90| ≤ 0,5 %.
2. *Det ekte tallet:* spak 7 (PC-remåling én avgang, full oppløsning),
   deretter nettbrett-målingen. Exit: progressiv semantikk bekreftet
   nødvendig eller ikke. **Eneste harde blokker** — trafikklys-tekst og
   «< 60 s»-løfte låses ikke før tallet finnes.
3. *F4.2-tallene:* D8.3 forenklet (nærmeste-rang, feil ut av nevner,
   n_f < 10-flagg); tie-break + `memberIndex`; D8.9 med enkel «tydelig og
   stabil»-sjekk. Exit: deterministisk over gjentatte kjøringer;
   rangeringsfikstur beviser P50 ≠ P90-toppavgang.
4. *Bail-out og beslutningsregel:* D8.6 sampling langs hele ruten,
   backoff i fysisk tid, `coverage.bailout`; D8.5 leave-one-out +
   treffrate + fallback; D8.4 3-punkts kontroll-perturbasjon. Exit:
   bail-out-tall gir treff på trygg golden-rute; regel har alltid
   fallback.
5. *Presentasjon:* produksjonsutviklerens tekster rett av;
   konfliktsignal-regel. Exit: røyktest i UI på nettbrett.

**Kuttliste (→ 4b/aldri):** Wilson-grense og full D8.9-protokoll; full
havnebok-datamodell (behold kun `coverage.bailout`); bredere cruising-
matrise; motorforbruk-usikkerhet (eget beslutningspunkt); full R2-
fellefrihet i alle medlemmer; sekvensiell tidlig-stopp; profilsøk og
sektornøkling (vent på bølge 2); regime-klynging.

**Votum:** D8.1 GODKJENN (a). D8.2 GODKJENN matematikerens ENDRE (soft
bound) — ikke forhandlingsbart under N2. D8.3 ENDRE smalere (nærmeste-
rang, feil ut, n_f-flagg; Wilson KUTT). D8.4 GODKJENN 3-punkts kontroll;
bredere AVVIS. D8.5 ENDRE (alt billig, beholdes). D8.6 GODKJENN sampling
langs ruten; havnebok-utvidelse KUTT. D8.7 GODKJENN 1→2→3→7→8;
tidlig-stopp AVVIS for 4a. D8.8 GODKJENN først. D8.9 GODKJENN prinsipp,
ENDRE ned til enkel stabilitetssjekk.

## 3. Tilsvar (runde 1-rollene re-etablert med eget svar + §2)

### 3.1 Matematiker

**DA1:** rett, og forsterket — MEPS-underdispersjon og x₍₂₇₎-underdekning
er uavhengige feil med samme fortegn. Ingen estimator på 30 medlemmer
retter en fysisk underdispersjon. Konsekvens: **P90 skal ikke bære ordet
«plantid».** Vist tall = *verste gjennomførbare medlem* + typisk (P50);
P90 degraderes til rangeringsnøkkel bak trykket. Lateral 5
(prognose-kvittering) flyttes inn i 4a — uten den er P90-diskusjonen
uetterprøvbar.
**DA8:** N er ikke vår variabel (MEPS gir 30); estimandet er. Verste
gjennomførbare medlem = primært vist tall (~96 % dekning), full fordeling
= viften. Rangeringen bruker fortsatt P90, ikke maksimum — maksimum er den
mest jackknife-ustabile statistikken; vist tall skal feile konservativt,
rangeringsnøkkel skal feile stabilt.
**DA3:** nei, F gjenåpnes ikke — utfordreren blander absolutt nivå
(spikens 12°-tall) med relativt mål (A sparer 2–11 % under like vilkår).
2–11 % lukker ikke et 10–40×-gap; Bs diskvalifikasjon er nivåuavhengig.
Det som må gjenåpnes er F3.5s 60 s-løfte (port 2). Færre medlemmer (15)
avvises — forverrer DA8-dimensjonen.
**DA6:** fiksturer er gyldige orakler for *logiske invarianter*
(determinisme, permutasjonsinvarians, P50≠P90-separasjon), ugyldige for
*kalibrering av terskler*. Bindende regel: **ingen konstant som endrer en
sikkerhetsklassifisering fryses på syntetiske data** — stempel
«provisorisk, syntetisk kalibrert», re-utledes under port 3.
**DA7:** asymmetrien er en egenskap ved utsagnene (vitne-utsagn vs.
universelt), ikke et produktvalg. Sertifikatet er monotont under
strømming. UX-fiks gratis: **ingen farge før n er endelig eller
sertifikat foreligger** — «beregner (k av 30)». Sertifikatet kan bare
kortslutte til advarsel.
**Lateral 3:** beste innspill i runde 2 — reell estimatorklasse-
forbedring: telling ved en *utenfra gitt* terskel har eksakt konfidens
og eksploderer ikke i halen. **Der terskel finnes er «kommer frem før X i
k av N» primærtallet**; P90/verste-medlem fallback.
**Lateral 4:** prinsipp tillatt, implementasjon avvist — skalarsøk koster
90–98 % av fullt søk. Gratis orakler finnes (A\*-felt + middelvind,
kontrollen). Kravet om pseudotilfeldig medlemspermutasjon **trekkes**:
når ingen delsum leses (kun sertifikater), er verste-først lovlig og
bedre.
**Lateral 1:** admissibelt med tre vilkår: Vmax dominerer alle medlemmer
og strømbidrag; samme maskeversjon; feltet siler kun i én retning
(`D/Vmax > 6 t` beviser «ingen havn nåbar»; `≤ 6 t` beviser ingenting).
**Avkortet Dijkstra** ved `D > Vmax·6 t` gjør tid og minne bundet
(~0,2–0,3 MB per havn).
**Pragmatikerens kutt:** *Wilson trekkes* — verre: 90 % ensidig Wilson mot
0,9 ved n=30 krever 30/30 for grønt. Erstatning: vis rå k/N («27 av 30»),
aldri prosent; ingen farge før endelig n. Ingen hysterese (bryter
determinisme). *D8.9-minimum:* forhåndsregistrert forventet toppavgang +
leave-one-out-invariant rangering over alle 30 (subsumerer jackknife og
terskelkonstanter). 6°/10°-invarians og paret-median-kriteriet droppes.

### 3.2 Værruting-utvikler

**DA4:** B3 er datert før ADR-0005, R2 og inkonklusiv; jeg vil **revidere
B3, ikke erstatte den** — lås formatet, skriv inn fire obligatoriske
vedheng. Ansvar tas ikke fra seileren av ett tall, men av et tall som
later som det ikke har kilde og usikkerhet.
**DA7:** riktig oppførsel — rask til å advare, treg til å love. Problemet
er at «ikke bevist rødt ennå» kan se ut som grønt: krav om eksplisitt
«beregner fortsatt …»-tilstand.
**DA1:** endrer standpunkt — bytt HVILKET tall som vises: pessimistisk
par (x₍₂₇₎ sammen med verste gjennomførbare) obligatorisk. «Regn med
inntil X t» er ærlig først når X er den forsiktige enden.
**Lateral 3:** bedre for seileren når terskel finnes (mørke finnes
alltid); svakhet: sier ikke HVOR MYE de 3 forsinkes — sekundærlinje «hvis
forsinket: opptil X t».
**Lateral 2:** sterkt for — GPS-sjekkbart. Kombiner: divergens er
*sjekken*, vindsektor er *forklaringen* i parentes.
**Lateral 5:** full støtte; analyser aldri før ≥ ~20 avganger.
**Kutt:** to av meteorologens tillegg beholdes fast (bølge/strøm-ikke-
dekket; n_f<10), resten bak trykket. **Motorforbruk: protest mot totalt
kutt** — `motorS × 3,0 l/t` uten merke er falsk presisjon ved
utelatelse; minimum «ikke usikkerhetsberegnet»-merke, null ekstra søk.

**Revidert førsteside:** (1) trafikklys + én setning, gult navngir årsak;
(2) plantid i terskelform hvis terskel finnes («framme før mørket i
27/30»), ellers pessimistisk par («regn med inntil [verste] t, typisk
[P50] t»); (3) beslutningsregel: posisjonssjekk + vindforklaring, ALLTID
med fallback; (4) fast linje: «Vindanslag (MEPS) · bølge/strøm ikke
dekket»; (5) bail-out: «Nærmeste trygge havn: X t unna» + merke hvis
kontrollbasert; (6) betinget varsellinje: «tynt utvalg» eller
«konfliktsignal — se detaljer»; (7) [trykk] → persentiler, n_f,
medlemstall, korridorplott, motordetalj, aldersspenn, kvitteringslogg.

### 3.3 Ytelsesingeniør

**DA2:** delvis rett — D8.7 *var* skrevet som om progressiv semantikk var
konklusjon. Ærlig anslag for topp-avgang på nettbrett etter spak 1–6:
basis 67–99 s (PC); spak 1 ≈ 0; spak 2 liten (rebuild < 1 ms); spak 3 er
korrekthet, ikke ytelse; spak 5/6 umålt analogi (1,5–2× og 1,2–1,5×).
Optimistisk: 34–50 s på PC; × 2–4 nettbrett = **68–200 s**.
**P(< 60 s for én avgang på nettbrett etter spak 1–6) < 30 %.**
Progressiv semantikk må vedtas som **hypotese testet av spak 7+8**.
**DA3:** ADR-0005 gjenåpnes ikke — 67–99 s står allerede i ADR-ens
Konsekvenser med port 2 for nettopp dette; det var *spiken* som var
ugyldig. Det som må gjenåpnes er F3.5s < 60 s-tekst; port 1 og 2 er ikke
kjørt.
**DA5 — regnestykket:** 84 nm, ~14 t, sampling hver 30. min ⇒ ~29
punkter × 8 havner = 232 R2-søk per medlem verste fall; ett R2-søk ~1–3 s
(PC). **1 medlem: 4–12 min. × 30: 2–5,8 t per avgang** — større enn hele
ensemble-beregningen. **Lateral 1 endrer regnestykket fundamentalt:**
feltet bygges én gang, siler; bare punkter i usikkerhetsbåndet rundt 6 t
trenger fullt R2 — trolig < 5 av 29 på en trygg kystrute, < 40 søk per
medlem. Uten feltet er F4.6 **ikke gjennomførbart i noe budsjett** — DA5
er bevist. Feltet bygges FØR F4.6 tas i bruk i noen form.
**Lateral 4:** ja, lav risiko, men utsett til bølge 2/5 — ingen gevinst
før progressiv semantikk er vedtatt.
**Bølgeplan:** riktig; **spak 7 er hard exit-forutsetning for bølge 2**:
viser PC > 40–50 s for én avgang, er nettbrett-tallet avgjort uten rigg.
**DA6:** kostnadstall i §7.3 er deterministiske telleverk på ekte
motorkode — ikke syntetisk sårbare på samme måte; men F4.6-kostnaden må
måles på minst én ekte 84 nm-rute med ekte havnetetthet.

### 3.4 Marinkartolog

**DA5:** delvis enig; D8.6 pekte allerede på silingen. Minste ærlige tall:
**kontrollvær-basert** `bailoutTimeS(p)` (feltets nedre grense +
`harbourApproachable`), aldri full ensemble i 4a. «≥ 6 t»/«ukjent» alene
er IKKE nok — umulig å skille fra tom havnebok uten `coverage.bailout`.
**Lateral 1:** enig, sterkere enn mitt eget forslag. Akseptabelt som
primærtall — men det løser IKKE mørke (avstand, ikke klokkeslett), dybde
ved kai (samme feilklasse som D7.3, for dybde) eller le (værgate per
medlem uansett). Ren ytelses-/arkitekturgevinst.
**Havnebok-kutt:** delvis uenig. `minDepthAtQuayM`/`…Anchorage` kan IKKE
vente — «reddet til havn» uten dybdesjekk er en sikkerhetspåstand under
N1; manglende dybde ekskluderer havnen med flagg. `nightApproachSafe` kan
starte tom (default: ikke mørketrygt) forutsatt at mørke-*sjekken* er
kodet fra dag én. `updatedAt`+enhets-ID koster ingenting. `tideSensitive`,
`notes`, `verifiedByMagnus` kan vente.
**DA4:** aldri bak et trykk: trafikklys, plantid, bail-out-tall MED
`coverage.bailout`, beslutningsregel. «6 t» og «6 t (ukjent dekning)» må
aldri se identiske ut.
**DA6:** gjelder dobbelt for bail-out — `bailout-interim.md` fraskriver
seg selv realisme.
**Lateral 2:** forsiktig enig — GPS er unimodalt sjekkbar; samme
LOO-disiplin; 4a-eksperiment ved siden av D8.5.

**Minste forsvarlige F4.6 for 4a:** (1) kontrollvær: feltets nedre grense
+ `harbourApproachable(kontroll)`, ingen full ensemble-R2; (2) alltid
merket «kontrollvær — ikke ensemble-sjekket»; (3) `coverage.bailout`
synlig alltid; (4) havn uten dybdekilde ekskluderes, flagget; (5)
mørke-gate kodet fra dag én; (6) baklengs felt per havn bygges nå; (7) R2
samples langs hele ruten.

### 3.5 Meteorolog

**DA1+DA8:** rett — to uavhengige feil samme vei. Vist P90-vind er
trolig lav i tierprosent-området i beste fall, mer nær kyst/terreng.
«Er N nok» er feil spørsmål; riktig spørsmål er estimatoren. Verste
medlem ved siden av x₍₂₇₎: ja. Variansinflasjon/fast margin: **nei** —
inflasjonsfaktoren blir en gjetning, samme feil pakket om. Ærlig løfte
sesong 1: «spredning blant dagens prognosemedlemmer», eksplisitt trolig
optimistisk — IKKE «90 % sannsynlighet».
**Lateral 3:** meteorologisk sunnere for hendelser (mørke, front), men
ikke immun mot underdispersjon. Begge: terskelkryssing for hendelser,
x₍₂₇₎+verste for plantid.
**Lateral 5:** eneste riktige kalibreringsløkke. Minimum per avgang:
init og medlemsaldre, hvert medlems predikerte utfall + ETA, n_f og
dekning, terskelkryssinger, D8.5-regelens t\*/vilkår slik vist, **og**
realisert utfall. Fryses ved planleggingstidspunkt.
**Lateral 6:** «udekket» betydde *vis*, ikke *korriger*; vekting avvises
for 4a.
**Lateral 2:** MEPS er svakest i styrke/spredning, sterkere i frontens
timing. Klyngemetoden **beregner** t\*/skillepunkt mekanisk; D8.5-
konkordans (≥ 70–80 %) på underliggende vind som gate — ellers tilfeldig
rutesplitt. Inn i 4a som D8.5-metode.
**DA6:** kan settes nå: partial-telleregel, nærmeste-rang, nevner-fiks,
tie-break, MEPS-merking, n_f<10, loggeskjema. Må vente på ekte data:
konkordansterskler, skjevhetsstørrelse, 20 %-inkonklusiv-terskelen.
**Kutt:** to viktigste: «Vindanslag (MEPS)»-merking og n_f<10-flagg.

## 4. Votering (endelig, etter tilsvar)

| Punkt | Matematiker | Værruting | Ytelse | Kartolog | Meteorolog | Pragmatiker |
|---|---|---|---|---|---|---|
| D8.1 `packages/robustness` (a) | GODKJENN + tie-break, memberIndex | GODKJENN | GODKJENN | GODKJENN | — | GODKJENN |
| D8.2 delt A\*-felt ja; delt Tub | ENDRE: soft bound m/redningsvei | ENDRE (samme) | ENDRE (samme) | ENDRE (samme; aldri i R2) | — | ENDRE (samme) |
| D8.3 F4.2-tall | ENDRE: nærmeste-rang, feil ut, verste+P50 vist, terskeltelling primær, k/N, ingen farge før endelig; Wilson trukket | ENDRE: pessimistisk par, gult navngir årsak | ENDRE (smal pakke) | GODKJENN presisert | ENDRE: + MEPS-merking, n_f<10 | ENDRE (smal pakke) |
| D8.4 perturbasjon | ENDRE: 3-pkt kontroll + lav cruising på verste medlem | ENDRE: + kontrollvær-merke | GODKJENN 3-pkt | ENDRE ≥ 3-pkt | ENDRE: 3-pkt, regime → 4b | GODKJENN 3-pkt |
| D8.5 beslutningsregel | ENDRE: LOO, treffrate, fallback; L2 eksperiment | ENDRE: L2 primær + vind som forklaring | ENDRE | ENDRE: aldri eneste trigger; L2 parallelt | ENDRE: konkordans, L2 som metode | ENDRE |
| D8.6 bail-out | ENDRE: maks over medlemmer, sampling, L1 forfilter, coverage, dybde beholdes | GODKJENN m/synlig merke | GODKJENN betinget L1 | ENDRE styrket: 7-pkt minimum | GODKJENN m/Hs-fotnote | GODKJENN sampling; havnebok kutt |
| D8.7 ytelse | ENDRE: sertifikat kun advarsel; tidlig-stopp AVVIS | GODKJENN; tidlig-stopp AVVIS | GODKJENN; spak 7 hard exit | GODKJENN; R2 unntatt | — | GODKJENN; tidlig-stopp AVVIS |
| D8.8 arkitekturtest | GODKJENN + provenance | GODKJENN først | GODKJENN | GODKJENN + F4.6 fullt søk | — | GODKJENN først |
| D8.9 rangeringsfikstur | ENDRE ned: forhåndsreg. + LOO | ENDRE ned | ENDRE ned | GODKJENN enkel | — | ENDRE ned |
| L1 baklengs havnefelt | GODKJENN (avkortet, siler én vei) | — | GODKJENN, forutsetning for D8.6 | GODKJENN | — | — |
| L2 posisjonsdivergens | GODKJENN eksperiment | GODKJENN primær | — | GODKJENN eksperiment | GODKJENN som metode | — |
| L3 terskelkryssing | GODKJENN primær der terskel | ENDRE inn som primær | — | — | GODKJENN ved siden av | — |
| L4 skalarsøk rekkefølge | AVVIS (gratis orakel i stedet) | — | utsett | — | — | — |
| L5 prognose-kvittering | GODKJENN 4a | GODKJENN 4a | — | — | GODKJENN 4a | — |
| L6 aldersvekting | — | — | — | — | AVVIS 4a | — |
| Sekv. tidlig-stopp (konfidens) | AVVIS | AVVIS | AVVIS | unntak for R2 | (risiko m/lagget) | AVVIS |

## 5. Syntese (hovedsesjonen)

**Ekte konvergens (uavhengig av framing):** D8.1(a), D8.8 først, soft
Tub med redningsvei (D8.2), sampling langs hele ruten (D8.6), baklengs
havnefelt som forfilter (L1), prognose-kvittering (L5), avvisning av
sekvensiell tidlig-stopp som konfidensregel, og at progressiv semantikk
er en **hypotese** til spak 7 og 8 er kjørt.

**Utfordrerne endret utfallet substansielt:** (1) DA1/DA8 fikk
matematiker, meteorolog og værruting til å forlate «P90 som plantid» —
vist tall blir verste gjennomførbare + typisk, og terskeltelling (L3)
primærsetning der terskel finnes; (2) DA5 + L1 gjorde F4.6 fra «ikke
gjennomførbart» til O(1)-oppslag med få R2-søk; (3) pragmatikeren fikk
Wilson trukket og D8.9 ned til forhåndsregistrering + LOO; (4) DA2/DA3
klargjorde at ADR-0005 står, men F3.5s 60 s-tekst må gjenåpnes som
hypotese; (5) DA4 → B3 revideres (format låst, fire obligatoriske
vedheng), ikke erstattes.

**Bevart uenighet:** havnebok-datamodellen (kartolog: dybde + mørke-gate
MÅ inn i 4a; pragmatiker: kun `coverage.bailout`) — hovedsesjonen
anbefaler kartologen (sikkerhet, ikke komfort; D7.3-analogien holder).
Perturbasjon på verste medlem (matematiker for, pragmatiker/ytelse mot)
— anbefaler matematikerens 1 ekstra søk for valgt avgang. Lateral 2 som
primær (værruting) vs. eksperiment (matematiker/kartolog) — anbefaler
«beregningsmetode med D8.5-gates», dvs. meteorologens formulering.

**Bindende prinsipp fra DA6:** ingen konstant som endrer en
sikkerhetsklassifisering fryses på syntetiske data; alle terskler
stemples «provisorisk, syntetisk kalibrert» og remåles under ADR-0005
port 3.

Beslutningspunktene D8.1–D8.13 med anbefaling legges frem for Magnus i
`docs/specs/robusthet.md` §7 (utkast, status Foreslått). Bølgeplan i
`docs/research/fase4a-plan-2026-09-04.md`.
