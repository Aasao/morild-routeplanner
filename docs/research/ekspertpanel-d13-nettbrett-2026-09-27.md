# Ekspertpanel D13 — etter nettbrett-målingen

- Dato: 2026-09-27
- Status: ferdig (runde 1, utfordrere, tilsvar, votering; syntese i §5). Venter Magnus.
- Grunnlag: `docs/research/beslutningsgrunnlag-d13-nettbrett-2026-09-27.md`,
  måling `maaling-nettbrett-2026-09-27.md`.
- Metode: fire fageksperter (ytelsesingeniør, værruting-produksjonsutvikler,
  marin meteorolog — sonnet; matematiker — opus), deretter djevelens
  advokat, lateral tenker og pragmatiker, tilsvar og votering.
  **Simulerte fagperspektiver, ikke reelle personer.** Panelet godkjenner
  ikke — Magnus vedtar.

## 0. Fakta hovedsesjonen sjekket underveis

- **hello-route på PC:** golden-scenariet `skjaeloy-skagen-apent`
  (`apps/pwa/src/workers/routing.worker.ts`) kjører `planRoute` på
  **6,1 s** i Node på PC (reached=true). At det «henger permanent» på
  nettbrettet er derfor enten en stille feil (Worker som aldri svarer)
  eller et søk som går langt tregere enn forventet — og da stjeler den en
  kjerne under ensemblet. Uavklart; begge hypoteser er testbare.
- **`performance.memory` i Worker:** ytelsesingeniøren sier Chromium
  eksponerer den i dedikerte Workere; matematikeren sier den ikke finnes
  der. Uavklart faktum — må sjekkes på enheten før D13.2 bygges på det.

## 1. Runde 1

### 1.1 Ytelsesingeniør

**D13.1 (c), omdefinert:** dekoding 2 % og pool 90 % ⇒ spak 4
(worker-overhead) har ingenting å hente. Før spak 5–6: lukk to
konfundere — (1) hello-route-Workeren som kan stjele en tråd av 8 på en
2+6-brikke; (2) min/maks rundtur 7,6–15,4 s (~2×) er signaturen på
asymmetriske kjerner. «Mest sannsynlige tiltak» er å fjerne
hello-route-lekkasjen og remåle; over 60 s etterpå ⇒ spak 5–6, ikke 4.
**D13.2:** avvis COOP/COEP; la hver Worker rapportere egen
`performance.memory` i resultatmeldingen og summer. **D13.3:** Wake Lock
nå, gjenopptakbarhet fase 5. **D13.4:** prioriter opp — fjern/gate før
neste måling. **D13.5:** hello-route + per-Worker-heap → Wake Lock →
ren remåling → strøm/bølge → spak 5–6 og bølge 6/D10.3 mot renset tall.
**Avviser:** spak 4 nå; COOP/COEP; full gjenopptakbarhet nå. **Trenger
målt:** ensemble uten hello-route; per-Worker heap; `searchMs` per
pool-slot; etiketter/s.

### 1.2 Værruting-produksjonsutvikler

**D13.1 (b):** 60 s er i praksis over det enheten tåler uten inngripen
(skjermen slukker). (c) uten profil er gjetning. **D13.2:** senk
prioritet — estimat fra strukturer nå, COOP/COEP i fase 5. **D13.3:
alvorligste D13-sak** — tap av 100 % arbeid ved skjerm-av er et
pålitelighetsbrudd, ikke ytelse; Wake Lock nå (liten jobb),
gjenopptakbar i fase 5; avviser «begge til fase 5». **D13.4:** en
indikator som aldri blir ferdig undergraver tilliten til alle
indikatorer — fiks før neste måling. **D13.5:** Wake Lock → hello-route
→ strøm/bølge → bølge 6/spak 4–6 → heap i fase 5. «Ytelsesarbeid på et
tomt resultat er polering.» **Trenger målt:** ensemble med strøm/bølge;
Wake Lock-pålitelighet; batteri over en kjøring.

### 1.3 Marin meteorolog

**D13.5:** strøm/bølge FØR bølge 6 og spak 4–6 — bail-out (D12.1)
avhenger av hvem som er gjennomførbare. Minste meningsfulle leveranse:
(1) NorKyst-strøm, referansemedlem, delt av alle 30 (pakke ×1, ikke
×30; søkekost per medlem neppe merkbart endret); (2) Oceanforecast
punktbølge Hs+Tp på faste punkter (vedtatt gyldig førsteleveranse, §18
pkt. 1), merket «ikke gridded» i UI; (3) WAM800 gridded utsettes.
Forventer < 5 % endring i søketid — må måles. **D13.1:** feilstilt nå;
avgjør med tall fra en pakke som sier noe om produktet. **D13.2/D13.4**
ikke blokkerende; **D13.3** bør fikses før flere feltmålinger.
**Avviser:** WAM800 først; bølge 6 før feasibility-fordelingen er kjent;
konkludere D13.1 fra vind-alene. **Trenger målt:** pakkestørrelse og
byggtid med strøm+punktbølge; ensemble på nytt; ny fordeling
gjennomførbar/ugjennomførbar/inkonklusiv.

### 1.4 Matematiker

**Funn i rådata:** etiketter forklarer lite av søketiden (r = 0,28 over
87 målinger; 0,37 på medlemsmiddel). Spredning innen samme medlem over
kjøringer (sd 1,17 s) ≈ mellom medlemmer (sd 1,29 s), mens etikettene er
bit-identiske. Kontrollen alene: 44 µs/etikett; medlemmer seks samtidig:
median 95 µs (62–137), unimodal ⇒ **samtidighetsstraff ~2,2×**, effektiv
parallellitet ~46 %. «Gevinst må komme fra etiketter» (målings-funn 2)
står ikke — det er per-etikett-kost under samtidighet.
**D13.1:** snitt 59,8 s, 95 %-KI [57,0; 62,5]; kan ikke avvise noen
side; kjøringene er ikke uavhengige (termisk oppvarming mulig). Bevis-
byrden ligger på «≤»; median 60,2 består ikke. **(c) omdefinert:** (1)
poolstørrelse 4/5/6/7 (bit-identisk, null algoritmisk risiko); (2) spak
5 alloc-fri hot-loop (kost per kandidat, ~60 kurser per ekspansjon;
GC-trykk skalerer med samtidighet); (3) tak/måling av `clearanceCache`.
Enhver etikettreduksjon er en **modellendring** (søket er en begrenset
heuristikk, ikke eksakt Pareto) og krever E1-/skadeprotokoll.
Remåling n ≥ 5 per konfigurasjon, sammenflettet, termisk hvile.
**D13.2:** analytisk øvre grense fra typede arrays + kjøretidsrapportert
cache/store per Worker; én manuell kontroll via chrome://inspect.
**D13.3:** begge, Wake Lock først; gjenopptakbarhet er eksakt fordi
determinismen er bevist (et ferdig medlem er en ren funksjon av pakke-
hash, opsjoner, medlem, avgang). **D13.4:** middels. **D13.5:** poolsveip
→ bølge 6 → strøm/bølge → remåling → spak 5 → D13.2 → D10.3 kun om
> 60 s etter tiltak. **Avviser:** «under/godkjent»-tolkning;
etikettreduserende tiltak uten E1-protokoll; LPT-sortering; felles
stamme. **Trenger målt:** ekspansjoner/kandidater/pruned per trinn;
makespan og µs/etikett for pool 4–7; kontroll med fem dummy-Workere;
samme måling med strøm/bølge; lading/temperatur per kjøring.

## 2. Runde 2 — utfordrere

### 2.1 Djevelens advokat

1. **hello-route-konfunderen er ubevist.** Ingen har målt om Workeren
   faktisk bruker CPU eller bare venter på et løfte som aldri innfris
   (0 % CPU). I så fall er «fjern hello-route og remål» en bortkastet
   runde forkledd som fremdrift.
2. **«Samtidighetsstraff 2,2×» er et navngitt residual.** Kontroll alene
   mot seks samtidige medlemmer skiller ikke samtidighet fra
   cache-konkurranse, GC eller hvilken kjerne OS-et velger (2+6).
3. **60 s er en policy fra D10.1, ikke en målt tålegrense.** Skjerm-av er
   strømsparing uavhengig av 60 s. Ingen har spurt hvor lenge Magnus
   faktisk vil vente.
4. **Meteorologens «< 5 %» er ubegrunnet** — panelets anslag om hva som er
   billig har bommet systematisk (jf. «gevinst fra etiketter», r = 0,28).
5. **n = 3** med mulig termisk drift brukes likevel til å velge retning.
Krav: n ≥ 5 kaldstart før D13.1 tolkes; `performance.memory` i Worker
testet på enheten; Wake Lock testet over 3+ skjerm-av-sykluser (inkl.
batteri); CPU-bevis for hello-route; ingen rekkefølge før
hello-route-hypotesen er falsifisert.

### 2.2 Lateral tenker

1. **Tid til første beslutningsdyktige runde** i stedet for hele
   ensemblet mot 60 s — bruker den vedtatte progressive kontrakten, men
   krever at «nok» defineres.
2. **Forhåndsberegning mens nettbrettet lader** (planlegging som bevisst
   jobb, ikke interaktiv venting) — omgår Android-strømstyring; dekker
   ikke omruting underveis.
3. **Enhetsrelativ pool/medlemsantall** fra selv-benchmark, merket i UI —
   ærlig degradering på enhetsnivå, men rører ADR-0005.
4. **Surrogat/klynging av medlemmer** — rammer selve flaskehalsen (antall
   fulle søk), men er modellendring som bryter «kun fulle søk»; ADR +
   validering.
5. **hello-route som varig kanarifugl** i stedet for å fjerne den.
Feilstilt: D13.1 (tre avhengige kjøringer, feil måleenhet, ett tall for
alle enheter); D13.2 (er 500 MB riktig grense mot 905 MB tak?).

### 2.3 Pragmatiker

Nettbrett-tid er den knappe ressursen; pakken er gratis. **Økt 1 (Claude,
0,5–1 dag):** hello-route, Wake Lock, heap-rapportering per Worker.
**Økt 2 (Magnus, én økt):** tre rene kjøringer som svarer på D13.1–D13.3
samtidig. **Økt 3 (Claude, flere dager):** NorKyst-strøm + Oceanforecast
punktbølge. **Økt 4 (Magnus, én økt):** remåling + ny
gjennomførbarhetsfordeling. **Økt 5:** D10.3/bølge 6/spak 5–6 mot
tallet fra økt 4; poolsveip og spak 5 profileres først på PC. **Parker:**
COOP/COEP, full gjenopptakbarhet, WAM800, spak 4, LPT/felles stamme.
To nettbrett-økter totalt.

## 3. Tilsvar

- **Ytelsesingeniør:** bøyer seg for advokaten på to punkt. Hello-route
  kan like gjerne henge med 0 % CPU; legg inn en billig CPU-diagnose før
  «fjern og remål». «Kjernesignatur»-tolkningen er ikke skilt fra cache/GC
  — derfor poolsveip. `performance.memory` i Worker er en faktapåstand som
  avgjøres på enheten.
- **Værruting-utvikler:** trekker koblingen skjerm-av ↔ 60 s (Android
  sover uavhengig av 60 s). Wake Lock står, men alene på D13.3-grunnlag.
  Går fra (b) til (c′) — n = 3 bærer ikke «over grensen».
- **Meteorolog:** trekker tallet «< 5 %» (analogi, ikke måling); det
  kvalitative står (strøm delt, punktbølge uten ny søkedimensjon). Mål det.
- **Matematiker:** godtar at 2,2× er et residual. Eksperiment som skiller
  mekanismene, **på nettbrettet** (PC har ikke 2+6-kjerner): (1) ett fast
  medlem solo, n ≥ 10 — bimodal (~44/~110 µs) ⇒ OS flytter mellom
  kjernetyper; (2) solo + k = 1…5 dummy-Workere i tre varianter (ren
  regnesløyfe / strømming gjennom stor `Float64Array` / allokeringstung) —
  sprang ved k ≥ 2 i (i) ⇒ store kjerner oppbrukt; glidende kun i (ii) ⇒
  båndbredde; kun i (iii) ⇒ GC og spak 5; (3) poolsveip 1…7 for makespan.
  Til lateral: surrogat/klynging AVVIS (ADR-0005, egen ADR m/E1);
  enhetsrelativ **pool** GODKJENN (endrer tempo, ikke svar);
  enhetsrelativt **medlemsantall** AVVIS (n = 30 er allerede tynt,
  sd(p̂) 0,055); «tid til første runde» finnes allerede i D10.4-skrankene.

## 4. Votering

| | Ytelsesing. | Værruting | Meteorolog | Matematiker |
|---|---|---|---|---|
| D13.1 (a) godta | — | — | — | AVVIS |
| D13.1 (b) over | — | — | — | AVVIS |
| **D13.1 (c′) avgjør ikke nå, fjern konfundere, remål** | GODKJENN (+ hello-route-CPU som datapunkt) | GODKJENN | GODKJENN | ENDRE: hello-route-CPU først; poolsveip + dummy-last på nettbrettet; n ≥ 5 kaldstart, vekselvis, µs/etikett per medlem |
| **D13.2 (a) per-Worker / analytisk grense** | ENDRE: test API på enheten først | GODKJENN | GODKJENN | GODKJENN (sjekk API først) |
| D13.2 (b) COOP/COEP | AVVIS | (fase 5) | — | AVVIS nå |
| **D13.3 (a) Wake Lock nå, gjenopptakbar fase 5** | GODKJENN (≥ 3 skjerm-av-sykluser + batteri) | GODKJENN | — | GODKJENN (≥ 3 sykluser) |
| D13.3 (b) begge nå | — | — | GODKJENN | AVVIS nå |
| D13.3 (d) forhåndsberegning ved lading | — | — | — | AVVIS som erstatning, idé til fase 5 |
| **D13.4 (a) diagnostiser + synlig timeout** | ENDRE: CPU-diagnose først | GODKJENN | GODKJENN | GODKJENN, behold som kanarifugl |
| **D13.5 (P) pragmatikerens rekkefølge** | GODKJENN (+ CPU-diagnose i økt 1) | GODKJENN (strøm/bølge før spak-beslutning) | GODKJENN | ENDRE: nettbrett-økt 2 inkl. solo-gjentak, dummy-last, poolsveip |
| D13.5 (M) poolsveip → bølge 6 → … | AVVIS | — | AVVIS | trukket |
| D13.5 (S) strøm/bølge først | (parallelt spor) | — | AVVIS alene | AVVIS |

Uenighet som står: meteorologen vil ha gjenopptakbar beregning nå (D13.3
b), de tre andre i fase 5. Advokatens krav om CPU-bevis for hello-route og
n ≥ 5 er tatt inn av alle.

## 5. Hovedsesjonens syntese

1. Panelet er enig om at **tallet 58,5/60,6/60,2 ikke avgjør D10.1/D10.3**
   — ikke fordi det er «på grensen», men fordi det har fire ukontrollerte
   konfundere (hello-route, kjernetildeling, samtidighetsmekanisme, n = 3
   med drift) og måler et produkt uten innhold (vind alene).
2. Den knappe ressursen er Magnus' tid med nettbrettet. Matematikerens
   eksperimentplan (solo n ≥ 10, dummy-last k = 1…5 × 3, poolsveip × n ≥ 5)
   er ~25–30 min ren regnetid — uaktuelt som manuell prosedyre, men greit
   som **automatisk måleprogram**: én knapp, Wake Lock på, nettbrettet på
   lader, én samlet JSON til slutt. Det gjør økt 2 til «start og gå fra»,
   og tester Wake Lock over mange minutter som bivirkning.
3. Hello-route-diagnosen kan bygges inn i samme program (heartbeat fra
   Workeren: kjører den, hvor langt har den kommet, feilet den stille) i
   stedet for `chrome://inspect` via USB.
4. Strøm/bølge er et eget spor som ikke trenger nettbrettet; det kan gå
   parallelt med at Magnus kjører økt 2.
