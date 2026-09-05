# Ekspertpanel D10 — F3.5 og veien til nettbrett-tallet etter spak 7

- Dato: 2026-09-05
- Status: ferdig — to runder + tilsvar + votering; syntese i §5. Venter
  Magnus' vedtak (`docs/specs/robusthet.md` §7, D10.1–D10.6).
- Grunnlag: `docs/research/beslutningsgrunnlag-d10-f35-etter-spak7-2026-09-05.md`
  (samme tekst til alle roller); rådata `maaling-spak7-2026-09-05.md`.
- Metode: tre fageksperter (ytelsesingeniør storskala ruting og
  værruting-produksjonsutvikler — sonnet; matematiker/multiobjektiv
  stioptimering — opus) leste grunnlaget uavhengig og voterte per D10.x.
  Deretter tre utfordrere (djevelens advokat, lateral tenker,
  pragmatiker), så tilsvar. **Simulerte fagperspektiver, ikke reelle
  personer.** Panelet godkjenner ikke — Magnus vedtar.

## 1. Runde 1 — råd

### 1.1 Ytelsesingeniør (storskala ruting)

**Pool-anslaget måler feil ting.** `tools/spak7-maaling/maaling.mjs` tar
tiden på `planRoute` i samme prosess med data i minnet — uten
worker-oppstart, strukturert kloning over `postMessage` og dekoding av
vindfliser. **Spaken ingen har listet:** `weather-routing.worker.ts`
kaller `windMemberLayersFromBytes` + `compositeWeatherField` inne i
`onmessage`, altså per medlem; hovedtråden må dessuten ha en egen
`ArrayBuffer` per medlem før transfer. På nettbrett (minnebåndbredde
1/3–1/5 av PC, big.LITTLE med små kjerner som er dårlige på minnetunge
dekodejobber) kan dette være samme størrelsesorden som søket. Tror 2–4×
*undervurderer* nettbrettet av denne grunnen — men vil ikke tallfeste
uten måling.

**Spak 4–6:** profilsøk først (uten det gjetter dere); alloc-fri
hot-loop deretter (kun `search.ts`/`expand.ts`, lav determinismerisiko
forutsatt uendret iterasjonsrekkefølge); read-only-cacher sist (reell
determinismerisiko hvis delt cache muteres; golden-tester må kjøre med
cache PÅ). Sektornøkling: ikke rør før profilsøk sier den trengs —
endrer nabooppslag, høyest risiko for ikke-bit-identitet. Ingen av 4–6
rører dekodeproblemet.

**(c) 15 av 30:** ærlig kun som midlertidig fallback bak flagg med
eksplisitt «ikke fullt ensemble ennå»; flytter oppfattet ventetid,
reduserer ikke total tid. Ikke som permanent kontrakt.

**Kontrakt:** «Kontrollruten vises på sekunder; robusthetstallet
strømmes inn og viser hvor mange av N medlemmer som er ferdig og hvor
lang tid resten forventes å ta — aldri et løfte om en fast tidsgrense.»

Votering: D10.1 (a) GODKJENN; (b) GODKJENN *etter* at dekode/komposittkostnaden
er tatt inn som egen delspak; (c) ENDRE (midlertidig, bak flagg, merket);
(d) AVVIS. D10.2 (b) GODKJENN — logg `hardwareConcurrency`, per-medlem
søketid OG dekode/komposittid separat; (a) ENDRE; (c) AVVIS. D10.3 (a)
GODKJENN; (b) AVVIS; (c) GODKJENN (F12 dødt for tall). Ville avvist: at
bølge 2b regnes nettbrett-klar uten profilert dekodekostnad. Trenger
målt: dekode+composite per melding (PC/nettbrett), hovedtråd-kloning per
medlem, profilsøk før spak 5/6-rekkefølge.

### 1.2 Værruting-utvikler (produksjon)

Produksjonsprodukter lover aldri veggtid; de lover semantikk: kontroll
momentant, varianter strømmer med progresjonsindikator, aldri et tall
som stille er basert på færre kjøringer enn UI-et later som. D10.1 (a)
er bransjenormen.

**(c) er ikke ærlig:** endrer nevneren stille i et system der
0,9/0,7/0,2-terskler og sertifikater er kalibrert mot n=30; «tynt
utvalg» (nF < 12) utløses nesten alltid; en gradert F12 i medlemsantall
i stedet for oppløsning. Seileren leser «k av 15» som «snart k av 30».
Krever egen kalibreringsrunde — avvis.

**Kontrakt:** «Kontrollruten foreligger på sekunder for alle avganger i
vinduet; det fulle 30-medlems robusthetstallet for valgt avgang bygges
progressivt med antall ferdige medlemmer alltid synlig, og appen lover
ingen ferdig-tid på forhånd.» F3.5 endres fra tidsløfte til
presentasjonsløfte; målt tid vises etterpå.

**Nettbrett-avlesning:** kontrolltid og ensemble-veggklokke alene
forteller ikke *hvorfor*; trenger kjernetall, brukt pool-størrelse,
per-medlem median/maks — ellers kan ikke «for få kjerner», «small
cores» og «per-etikett-kostnad på ARM» skilles. Minne kjekt, ikke
kritisk.

Votering: D10.1 (b) GODKJENN (progressiv semantikk + spak 4–6 nå, med
golden-reverifisering per spak); (c) AVVIS; (d) AVVIS. D10.2 (b)
GODKJENN. D10.3 (a) GODKJENN.

### 1.3 Matematiker (multiobjektiv stioptimering)

**(c): sertifikat vs estimat har motsatte krav til delmengden.**
Sertifikatet (§4.2.3) er delmengde-uavhengig — `nInf > 9` beviser
s < 0,7 uansett resten; verste-først maksimerer *når* det slår til.
Estimatet er delmengde-avhengig, og verste-først er verste tenkelige
utvalg (betinget på responsen, pessimistisk skjevhet av ukjent
størrelse). Annenhver ville vært forventningsrett, men presisjonen er
uansett for dårlig: sd(p̂) ved p=0,9 er 0,077 med n=15 (0,055 med 30) —
ett medlem flytter andelen 6,7 prosentpoeng, over 0,9/0,7-grensene.
Nærmeste-rang P90 med n=15 = nest verste, ~45 % dekning. Spec-ens
`nF < 12` slår inn (S-7 gir nF ≈ 7) ⇒ **(c) produserer et tall spec-en
allerede forbyr å vise.** Redundant som sertifikat (verste-først-
strømming gir det løpende), felle som estimat, og i praksis en
sekvensiell tidlig-stopp (D8.7, forbudt uten Magnus).

**Bevisbyrde per spak:** profilsøk — golden bit-identitet + test på at
avgangsmengden er uendret hvis den styrer hva som beregnes; alloc-fri
hot-loop — golden **+ permutasjonstest** (samme worker, randomisert
medlemsrekkefølge, bit-identisk `MemberSummary`; golden alene fanger
ikke arena-lekkasje mellom medlemmer); read-only-cacher —
permutasjonstest + cache av/på-differensial + arkitekturtest mot
væravhengige oppslag; **sektornøkling er en modellendring**
(`stateKeyOf(cellKey, sector)` — kollapser sektoren, slås Pareto-fronter
sammen, `isDominatedInState` sletter etiketter som ellers overlevde) ⇒
full forhåndsregistrert E1-protokoll (felle-sett, ±1-medlem, P90-avvik,
fortegnsflipp), ellers AVVIS. Hører ikke hjemme i «spak 4–6».

**12°:** som tall nei (ADR-0005 pkt. 4 absolutt); som rekkefølge-orakel
teknisk legitimt men absurd (~90 % av et fullt søk for å erstatte et
gratis orakel). **Slett ikke porten** — en falsifiseringsport slettes
ikke fordi vi tror vi vet svaret; skriv om utfallsmengden: F12 ut,
«gjenåpne F3.5-semantikk / medlemshorisont / avgangsvindu» inn. n < 30
er ikke et ærlig alternativ til 12° (n=30 er allerede tynt).

**Kontrakt:** «Morild viser kontrollruten for alle avganger på sekunder
og bygger robusthetstallene utelukkende fra fulle søk mens du ser på —
hvert tall er enten endelig (30 av 30) eller merket «foreløpig, k av 30
ferdig», advarsler kan bli endelige før alle er ferdige, grønt aldri.»

Votering: D10.1 (a) GODKJENN; (b) GODKJENN med bevisbyrden over,
sektornøkling ikke del av 4–6; (c) AVVIS; (d) AVVIS. D10.2 (b) GODKJENN
(krev `memberIndex`, etiketter, iterasjoner per medlem — ellers er
«faktor 2–4×» ikke identifiserbar); (a) ENDRE; (c) AVVIS. D10.3 (a)
GODKJENN med ENDRE på utfallsmengden; (b)/(c) AVVIS. Trenger målt:
per-medlem-tid + `memberIndex` × 3 nettbrett-kjøringer
(Spearman-korrelasjon orakel vs faktisk rangering — orakelets
treffsikkerhet er påstått, aldri målt); permutasjonstest for spak 5/6 på
S-1/S-3/S-7; E1-protokoll før sektornøkling.

### 1.4 Hovedsesjonens tilleggsmåling (ytelsesingeniørens bestilling)

Per-medlem dekode/komposittkostnad slik `weather-routing.worker.ts` gjør
det, på den **ekte** pakken (6 fliser × 31 medlemmer, init 03.09 21Z),
Node 24, PC (`tools/spak7-maaling`, midlertidig skript, 9 medlemmer):

| | per medlem |
|---|---|
| flisbuffere (6 fliser, u+v, delta+gzip-dekodet format) | 705 kB |
| `structuredClone` av bufferne (hovedtrådens kloning uten transfer) | 0,4–0,8 ms |
| `windMemberLayersFromBytes` + `toWeatherField` (6 fliser) | 29–43 ms (median 32 ms) |
| `compositeWeatherField` | 0,03–0,2 ms |
| søk (spak 7, full oppløsning) | 2 400–3 300 ms |

Dekoding er ~1 % av søket per medlem på PC; kloning er neglisjerbar
(705 kB, ikke 20 MB — pakken er 20 MB *totalt* for 186 blober). Selv med
5× nettbrett-faktor på minnetunge operasjoner blir det ~5 %. Ikke en
spak, men per-medlem dekodetid logges likevel separat i D10.2 (b) så
nettbrettet får bekrefte tallet.

## 2. Runde 2 — utfordringer

### 2.1 Djevelens advokat

Konsensusrammen: alle tre pakker «ærlighet» som spørsmålet om hva UI-et
skal *love*; ingen spør hva det skal *levere som er brukbart* — en
forskyvning fra brukerverdi til presentasjonsetikk. (1) «Progressiv
semantikk som kontrakt» beskriver UI-atferd, ikke seilerens
handlingsrom: avgang om 2 timer, nettbrett i sollys, batteri; 36–144 s
for topp-avgang pluss 20–30 s kontroll-sekvens for avgangsvinduet.
Strømming løser *opplevelsen* av ventetid, ikke *beslutningsverdien*.
Kontrakten må ha et brukbarhetsgulv («tar full robusthet over X min —
hva ser seileren i mellomtiden som lar henne beslutte?»). (2) (b)
bryter ADR-0005 port 1 («nettbrett-måling FØR spakprioritering»), og
begrunnes med en multiplikator (2–4×) samme metode nettopp bommet på i
motsatt retning (§1.4: dekoding var 1 %, ikke «samme størrelsesorden»).
Selvmotsigende bevisbruk — porten finnes for å hindre nettopp dette.
(3) n=30 brukes som argument mot å redusere n, aldri som argument for
at hele ensemblet må vente på hverandre: alternativet er et løpende,
presisjonsmerket tall («n=k ferdig, sd=X») i stedet for et statisk
0,9/0,7-votum ved n=30; og et forhåndsregistrert «verste 10 av 30» som
selvstendig indikator. (4) PC-tallet er upålitelig i begge retninger —
«slutt å gjette». Konklusjon: D10.1 (a) alene, spak 4–6 etter tallet;
bølge 2 = «Magnus kjører nettbrettet i morgen»; brukbarhetsgulv inn i
kontrakten; åpne n=30-alt-eller-ingenting formelt.

### 2.2 Lateral tenker

(1) A\*-feltet er ren geometri per (strekk × maskeversjon) — kan bygges
i cron og skipes som del av pakken uten å bryte ADR-0002 (som masken);
sparer bare 20–30 ms. Kontrollrute server-side er allerede vraket i
ADR-0002. (2) Bakgrunnsforhåndsberegning av ensemblet på nettbrettet
mens det lader: MET-forbudet gjelder nettverkspoll, ikke lokal CPU —
ingen juridisk konflikt; risiko er invalidering (inputs-hash mot maske-/
pakkeversjon/båt/vindu) og at Periodic Background Sync er
Chrome/TWA-spesifikk og upålitelig — beste-innsats, eget spor. (3)
ADR-0005s τ-screening-klausul tillater allerede «kun rekkefølge» —
S1b-evaluatoren (gratis) kan rangere medlemmer for poolen (størst
forventet avvik først) som bedre verste-først-orakel; som *vist* skranke
kun tydelig merket «foreløpig anslag», aldri i prosentene. (4) «Felles
stamme» til første divergens (scenario-tre, non-anticipativity) er den
eneste nye algoritmiske ideen — modellendring på linje med sektornøkling,
krever full protokoll. Votering: D10.1 (a) + forslag 2 som eget spor;
(c)/(d) AVVIS. D10.2 (b) + logg Periodic Background Sync-støtte. D10.3
(a) med matematikerens omskriving av utfallsmengden.

### 2.3 Pragmatiker

Spak 4 er diagnostikk (½ dag); 5: 1–2 dager m/permutasjonstest; 6: 1–2
dager m/differensialtest — 3–5 dager for antatt 1,2–1,8×, ikke 3–5×
(hot-loop på 15–20 µs/etikett er allerede tett; størrelsesorden krever
algoritmeendring). Ikke verdt det før bølge 3–5 gir Magnus seilbar
funksjonalitet. Nettbrett-måling først, uten diskusjon (~1 t utvikling
+ én økt; port 1 er eksplisitt; §1.4 fjernet dekodebekymringen). «Kontroll
5 s + ensemble 1–2 min mens han gjør seg klar» er ikke et problem gitt
progressiv semantikk — problemet oppstår bare hvis UI-et later som det
er raskere. Over-engineering: Spearman på orakelet (ingen beslutning
avhenger av det nå), E1-protokoll for sektornøkling (ingen skal bygge
den). Votering: D10.1 (a) GODKJENN, (b) ENDRE til «etter bølge 5,
betinget av nettbrett-tallet»; (c)/(d) AVVIS. D10.2 (b). D10.3 (a).

## 3. Tilsvar (rollene re-etablert med eget runde 1-svar + utfordringene)

### 3.1 Ytelsesingeniør

Erkjenner uten forbehold at dekodebekymringen er avkreftet (§1.4) og
trekker 2–4×-multiplikatoren som begrunnelse for rekkefølge — det var
sirkulær bevisbruk og brudd på port 1 i ånd. Det som står igjen er
svakere: `LabelArena`/`MinHeap` er struct-of-arrays i typede buffere
(beregningsbundet, cache-vennlig), men `LabelStore.byState`/`byCell` er
`Map<number, number[]>` — pekerjaging og hash-oppslag i hot-loopen, som
rammer small-cores på latens/IPC, ikke båndbredde. Umålt; sier bare at
profilsøk på nettbrettet bør se på Map-oppslag og GC i tillegg til alloc.
Faktor: spak 5 1,1–1,3×, spak 6 1,05–1,2×; samlet 1,2–1,8× — **ikke
verdt 3–5 dager nå.** Endelig: spak 4–6 etter nettbrett-tallet; profilsøk
kan kjøres på nettbrettet som del av målingsøkten. Bakgrunnsberegning:
standard kun «pakke landet OG enheten lader», inputs-hash-invalidering.
Votering: D10.1 (a) GODKJENN, (b) ENDRE til etter bølge 5 betinget av
tallet; (c)/(d) AVVIS. D10.2 (b) + Map/GC i profileringen. D10.3 (a) med
omskrevet utfallsmengde. S1b-orakel GODKJENN (kun rekkefølge).
Bakgrunnsberegning GODKJENN som eget spor. Server-side A\*-felt AVVIS.

### 3.2 Værruting-utvikler

**Brukbarhetsgulvet konkret:** t=5 s: kontrollrute + ETA + værvindu,
«0/30, beregner» — grovsortering. t=30 s: k≈8–12 via S1b-rangert
rekkefølge, sertifikatet (§4.2.3) kan slå inn *før* 30 er ferdige —
allerede sikkert rødt ⇒ dropp alternativet nå, ikke vent 90 s til.
t=2 min: endelig eller ett trinn unna — commit eller avvent. Gulvet:
aldri blank skjerm, alltid et tall med et ord som sier hvor mye vekt det
tåler, tidlig-exit når sertifikatet har avgjort saken. Reviderer runde 1:
bart «k av 30» er utilstrekkelig; produksjonsprodukter viser konfidens
som vokser. Bakgrunnsberegning: ja der plattformen tillater (lading om
natten), vist som «Beregnet i natt kl 04:12 — pakke 6 t gammel, gyldig
for [vindu]», «foreldet, beregner på nytt» ved invalidering; aldri en
skjult forutsetning. Innrømmer feilen: godkjente (b) uten forbehold.
Votering: D10.1 (a) nå, (b) etter bølge 3–5 betinget av tallet; (c)/(d)
AVVIS. D10.2 (b). D10.3 (a). S1b-placeholder GODKJENN kun merket
«foreløpig anslag, ikke robusthetstall». Bakgrunnsberegning GODKJENN
eget spor. Løpende presisjonsmerket tall GODKJENN.

### 3.3 Matematiker

**Løpende tall: ja til løpende, nei til «±sd».** Under verste-først er
de k første ikke tilfeldige; feilen domineres av skjevhet, og et sd på
et skjevt utvalg er verre enn ingenting. Selv forventningsrett skiller
sd(p̂)=0,067 ved k=20 aldri 0,9 fra 0,7. Det som er ærlig og gratis er
**eksakte skranker**, rekkefølge-uavhengige: etter k ferdige med j
gjennomførbare og m ugjennomførbare er `s_min = j/30`, `s_max = (j + 30
− k)/30` — monotont krympende, aldri feil. Regel (utvidelse av §4.2.3):
ren verste-først; vis alltid «k av 30 ferdig — j har gått, m kom ikke
fram, resten ukjent»; trafikklys kun ved skrankekryss (`s_max < 0,7` ⇒
rød; terskeltelling ⇒ gul); grønn aldri før 30; tellinger, ikke prosent.
Stratifisert verste-først finnes (2:1, vektet estimator) men anbefales
ikke — kjøper et ubrukelig punktestimat mot 50 % senere røde
sertifikater. «Verste 10 av 30»: AVVIS (annet estimand, ukalibrert
orakel, overflødig). UI-eksempel: k=10 «3 har gått, 7 kom ikke fram,
ikke avgjort»; k=20 med m=12 > 9 ⇒ rødt sertifikat; k=30 endelig.

**Felles stamme: AVVIS.** Stammen er felles bare mens hele det nåbare
etikettsettet er identisk — 1–2 tidssteg med 6°/1800 s; etikettmengden
vokser ~kvadratisk, så de første 2 av 12–14 steg er < 1–2 % av
etikettene. Gevinsten ligger der søket er billig; korrekthetsrisikoen
(Pareto-dominans er værbetinget — stille tap av en trygg rute) er
førsteordens.

**S1b som orakel: klart bedre** enn feltlengde × middelvind (som
ignorerer vinkel — kryss/lens er hele fysikken): rangerer direkte på
predikert `durationS` med ekte polar i medlemmets vær og gir tidlig
ugjennomførbarhetssignal. Millisekunder. Lovlig under τ-klausulen som
kun rekkefølge; permutasjonstesten må dekke orakelbytte. Spearman:
ENDRE — ingen egen måling, logg orakelrang + realisert `durationS` i
D10.2 (b)-JSON-en, korrelasjonen faller ut gratis. E1-port før
sektornøkling består (koster null så lenge ingen bygger den).

Trekker sitt betingede (b): port 1 er eksplisitt, §1.4 fjernet
hastverket. Votering: D10.1 (a) GODKJENN (med skrankeregelen inn i
§4.2.3); (b) ENDRE etter tallet, rekkefølge styrt av profilsøk; (c)/(d)
AVVIS. D10.2 (b) + orakelrang/`durationS`/`memberIndex`/etiketter per
medlem. D10.3 (a) med omskrevet utfallsmengde. Løpende tall: ENDRE →
eksakte skranker + tellinger. S1b-orakel GODKJENN. Felles stamme AVVIS.
Bakgrunnsberegning GODKJENN eget spor etter tallet, inputs-hash.

## 4. Votering — oppsummert

| | Mat. | Ytelse | Værruting | Djevel | Lateral | Pragm. |
|---|---|---|---|---|---|---|
| D10.1 (a) progressiv kontrakt, «< 60 s» strykes | GODKJENN | GODKJENN | GODKJENN | GODKJENN | GODKJENN | GODKJENN |
| D10.1 (b) spak 4–6 før nettbrett-tallet | ENDRE: etter | ENDRE: etter bølge 5 | ENDRE: etter bølge 3–5 | AVVIS | – | ENDRE: etter bølge 5 |
| D10.1 (c) 15 av 30 | AVVIS | ENDRE→AVVIS | AVVIS | (løpende tall i stedet) | AVVIS | AVVIS |
| D10.1 (d) F12 | AVVIS | AVVIS | AVVIS | – | AVVIS | AVVIS |
| D10.2 (b) JSON-logg m/kjerner, per-medlem, orakelrang | GODKJENN | GODKJENN | GODKJENN | (nettbrett i morgen) | GODKJENN | GODKJENN |
| D10.3 (a) porten beholdes, utfallsmengde omskrives | GODKJENN | GODKJENN | GODKJENN | – | GODKJENN | GODKJENN |
| Eksakte skranker + tellinger i UI (§4.2.3-utvidelse) | forslag | – | GODKJENN | (opphav) | – | – |
| S1b-evaluator som pool-orakel (kun rekkefølge) | GODKJENN | GODKJENN | GODKJENN | – | forslag | – |
| Bakgrunnsberegning ved lading (eget spor) | GODKJENN | GODKJENN (lade-standard) | GODKJENN | – | forslag | – |
| Felles stamme | AVVIS | – | – | – | forslag | – |
| Server-side A\*-felt | – | AVVIS | – | – | forslag | – |
| Verste 10 av 30 som indikator | AVVIS | – | supplement | forslag | – | – |

## 5. Hovedsesjonens syntese

1. **D10.1 (a) er enstemmig, (b) ble snudd av utfordrerne.** Alle tre
   ekspertene godkjente (b) i runde 1 og trakk det i tilsvaret: port 1
   er eksplisitt, dekodebekymringen falt (§1.4), og spak 5–6 er 3–5
   dager for 1,2–1,8×. Spak 4–6 etter nettbrett-tallet og etter bølge
   3–5; profilsøk kan kjøres på nettbrettet i målingsøkten.
2. **Brukbarhetsgulvet og «løpende tall» endte i noe bedre enn begge
   forslag:** eksakte skranker (`s_min`, `s_max`) og tellinger, aldri
   sd, aldri prosent før 30 — sertifikatet kan avgjøre rødt tidlig, og
   seileren får et handlingsdyktig utsagn ved t=30 s. Dette er en
   presisering av §4.2.3, ikke ny semantikk (bølge 3).
3. **S1b-evaluatoren som pool-orakel** er lovlig (τ-klausulen), bedre
   enn feltlengde × middelvind, gratis, og gir tidlige sertifikater.
   Krav: kun rekkefølge, aldri vist som tall; permutasjonstest.
4. **Bakgrunnsberegning ved lading** er et eget spor etter tallet; MET-
   vilkårene berøres ikke (lokal CPU, ikke poll). Felles stamme og
   server-side felt avvist.
5. **Bølge 2 er dermed:** D10.2 (b)-loggen (~1 t) → Magnus kjører
   nettbrettet (3 kjøringer) → tallet avgjør om spak 4–6 i det hele tatt
   trengs før bølge 3–5 starter — de kan starte uansett.
