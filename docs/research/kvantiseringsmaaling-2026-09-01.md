# Kvantiseringsmåling — hvor grovt kan værfeltene pakkes før *rutingen* endrer seg?

- **Dato:** 2026-09-01. **Kjørt av:** rutemotor-agenten, autonomt.
- **Bestilling:** `docs/research/steg3-plan-2026-08-31.md`, §«Kvantisering FØR
  formatlåsing» — sekvenskravet mot fase 3. Kvantiserings- og
  oppløsningsfeltene i `docs/specs/vaerpakker.md` holdes åpne til denne
  målingen har kjørt.
- **Kode:** `packages/routing/test-fixtures/pack-degradation.ts` (pakkemodell,
  enhetstestet i `packages/routing/src/pack-degradation.test.ts`),
  `tools/kvantisering/` (matrise, kjøring, tabellgenerering).
- **Rådata:** `docs/research/kvantisering-raadata/` (JSON), tillegg i
  `docs/research/kvantisering-raadata/tillegg-hs-avrunding/` og
  `docs/research/kvantisering-raadata/tillegg-k-anbefalt/`
  (+ `.../attribusjon-5km/`, se §9.1).
  Genererte tabeller: `tools/kvantisering/tabeller-2026-09-01.txt`,
  `tools/kvantisering/tabeller-tillegg-hs-2026-09-01.txt`,
  `tools/kvantisering/tabeller-tillegg-k-anbefalt-2026-09-01.txt`.
- **Status:** måling, ikke beslutning. Anbefalingene i §9–§10 er input til
  `specs/vaerpakker.md`; Magnus avgjør.

---

## 1. Hovedfunn

1. **Kvantisering av vind er nesten gratis; oppløsning og lagringsform er
   ikke.** u/v-komponenter med skala/offset per flis gir **null** målbar
   ruteeffekt ned til 8 bit (maks Δt 0,00 %, korridor 0,001 nm, ingen flips).
   Det som koster, er å bytte til *én global skala* (`W-UV8G`: N5-brudd i 5 av
   11 scenarioer) eller å lagre *fart + retning* i stedet for u/v (`W-SD8`:
   3 brudd; `W-SD10`: 1,03 % anger der `W-UV10` har 0,00 %).
2. **Tre diskvalifiserende flips, alle av samme type: en hard forkastelse
   forsvinner.**
   - `T-3H` (3 t tidssteg) mister `m29` i S-3 ved +8 t — og dermed en **felle**
     som fasiten finner. Felle-settet går fra `{m04,m09,m14,m29}` til
     `{m04,m09,m14}`.
   - `H-6G` (Hs 6-bit, global skala, vanlig avrunding) mister `m26` i S-8 ved
     **alle tre** avganger. `m26` har Hs 4,069 m mot båtens `maxHsM = 4,0` —
     6,9 cm margin mot et kvantiseringstrinn på 19 cm.
   - `K-VERSTE` (kombinasjonen) mister `m29` som `T-3H`, og endrer i tillegg
     `safetyVerdict` fra «usikkert» til «trygt» på `tss-ved-skagen`.
3. **Konservativ avrunding av Hs virker, prisen er målt, og grensen for hva
   den dekker er målt.** Kontrolleksperimentet (§8.3) med *samme* grove
   19 cm-kvantisering avrundet **opp** mister ingen forkastelse — den legger i
   stedet til to falske (`+m11`, `+m15` i S-3) og flytter én ankomst ut av
   dagslysvinduet. Avrundingsretningen bestemmer altså **fortegnet** på
   risikoen og trinnstørrelsen **prisen**. Men konservatismen dekker bare
   kvantiseringen: mellom tidsskivene undervurderer lineær interpolasjon
   Hs-toppen med 0,117 m allerede ved 1 t *uten* kvantisering, og 0,576 m ved
   3 t (§8.4). Krav om avrunding og krav om oppløsning er to halvdeler av
   samme sak.
4. **Strøm: nedtynning er billig, bortfall av romlig struktur er ikke.**
   2×/4×/8× nedtynning av strømgridet ga ingen flips; «kun tidevanns-
   hovedkomponent» (`C-TID`) ga 5,93 % anger på v1s referansestrekk og
   produserte planer som **ikke er gjennomførbare** under sannheten på
   `tss-ved-skagen`. Men: fiksturenes strømstruktur er 39 km bred, og
   nedtynning kan derfor ikke falsifiseres på dem. Sondene med 9 km og 3,3 km
   bånd (§7.2) viser at effekten kommer når strukturen nærmer seg gridavstanden
   — kravet må formuleres på strukturbredde, ikke på kilometer.
5. **Felt-RMSE er en dårlig proxy, som planen forutså — og forskjellen er
   dramatisk.** Referansepakken (1 t) har allerede **13,9 kn** maksimal
   momentan TWS-feil og 1,62 kn RMS mot det analytiske frontfeltet, uten noen
   målbar ruteeffekt. `T-15M` reduserer den til 2,79 kn og kjøper **ingenting**
   (Δt 0,01 %, korridor 0,001 nm). `T-3H` øker den til 16,7 kn — en beskjeden
   RMSE-endring — og mister en felle. Det som skiller dem er ikke vindfeilen,
   men **Hs-feilens fortegn og størrelse i forhold til den harde grensen**:
   verste Hs-underrapportering er 0,12 m ved 1 t, 0,58 m ved 3 t, og S-3s
   fellemedlem har 0,6 m margin.
6. **Avgangsrangeringen må måles med fulle søk — den billige varianten måler
   noe annet.** S-5s billige rangering (kontrollsøk + evaluering) flipper
   toppavgangen både for `T-30M` og `T-15M`, altså pakker som er **finere** enn
   referansen. Med **fullt Pareto-søk per medlem** (P2b) forsvinner hele det
   bildet: samtlige fem målte konfigurasjoner — inkludert `R-4X` og `T-3H` —
   gir samme toppavgang (+4 t), og referansepakken skiller seg 0,08 % fra det
   analytiske feltet med null inversjoner. Forskjellen mellom de to metodene er
   den delte kontrollruten, som velges nesten degenerert. Det som *står* igjen
   i P2b er to reelle rangeringsfunn: `R-4X` bryter ±2 %-båndet på P50
   (3,17 %, 2 inversjoner), og `T-3H` river opp **halen** (ΔP90 5,91 %, 7
   P90-inversjoner) — nøyaktig der medlemmene med harde grenser bor.
7. **Sidefunn om motoren, ikke om pakkene:** på `skjaeloy-skagen-apent` fant
   `H-6G`s søk en rute som er **5,8 % raskere under sannheten** enn den
   referansepakkens søk fant. Det er ikke en egenskap ved 6-bit Hs — det er et
   lodd i etikett-beskjæringen. Men det setter en **målt nedre grense på
   søkets egen suboptimalitet på dette strekket (≈ 6 %)**, og den er større
   enn samtlige kvantiseringseffekter vi måler. Se §11.
8. **Tillegg 2026-09-02 (§9.1): den anbefalte pakken er nå målt som helhet, med
   byte-alignet 8 bit — og den består i kystform, men ikke i utaskjærs-form.**
   `K-ANB-KYST` (u/v 8-bit per flis, 2,5 km, 1 t, strøm 0,8 km, Hs 8-bit per
   flis opp) gir null flips, ingen tapte harde forkastelser, ingen felle-
   endringer, og er umulig å skille fra referansen i P2b (ΔP50 0,01 %).
   `K-ANB-UTASKJAERS` (5 km vind/bølge, 1,6 km strøm) består *sikkerhets*-
   kriteriene like godt, men flipper toppavgangen +4 t → +2 t med ΔP50 3,35 %
   — og kontrollkjøringen viser at årsaken til P50-flippen er 5 km-nettet, ikke
   bitbredden: `R-2X` (5 km, Float32, ingen kvantisering) gir 3,50 % og samme
   flipp. P90-halen rives derimot bare opp når grovt nett og kvantisering
   opptrer *sammen* (5,36 % mot 0,02 % for Float32 på 5 km og 0,00 % for 8 bit
   på 2,5 km) — en interaksjon, ikke en sum.

---

## 2. Metode

### 2.1 Pakkemodellen

Fiksturenes værfelt er analytiske funksjoner. En værpakke er noe annet, og
målingen må måle *den* kjeden:

```
analytisk felt → gridsampling → kvantisering (skala/offset per flis)
              → dekoding → bilineær i rom + lineær i tid → WeatherField
```

`packages/routing/test-fixtures/pack-degradation.ts` implementerer kjeden som
en `WeatherField`-innpakning. Rutemotoren ser ingen forskjell på et pakket og
et upakket felt — det er hele poenget: da måler vi ruteeffekt, ikke felt-RMSE.

Fire valg som er bevisste:

1. **Referansen er selv en pakke.** `REF` = Float32, 2,5 km vind/bølge, 0,8 km
   strøm, 1 t (MEPS- og NorKyst-klassen). Alle akser er **én endring** fra
   `REF`. `ANALYTISK` (fiksturfeltet urørt) er med som egen kolonne, fordi
   referansepakkens *egen* feil må være kjent før noe annet kan tolkes.
2. **Interpolasjonen er identisk i alle konfigurasjoner.** Vind interpoleres
   alltid som vektor (u/v), også når den *lagres* som fart + retning. Da er det
   bare kvantiseringsfeilens struktur som skiller lagringsformene.
3. **`maxTwsKn`/`maxCurrentKn` arves urørt** fra kildefeltet, slik at
   A\*-feltets Vmax-skranke er lik i alle konfigurasjoner. At dekodet vind
   *kan* overstige den arvede skranken telles i stedet (§10, krav 6).
4. **Tidsnettet ankres i feltets `validFromS`**, ikke i epoken, og pakkens
   `validToS` rundes ned til siste hele skive. Ellers hadde en 3 t-pakke
   mistet avgangstidspunktet og målingen blitt en dekningstest.

### 2.2 Tre protokoller

| | spørsmål | instrument | omfang |
|---|---|---|---|
| **P1** | endrer pakken *ruten*? | fullt Pareto-søk per scenario, golden-testenes egen sammenligningsregel (eksakt på diskrete felt, ±2 % på tid, ≤ 0,5 nm korridor) + **kryssevaluering** | 11 scenarioer × 29 konfigurasjoner |
| **P2a/P2b** | endrer pakken *anbefalingen*? | S-5s avgangsvindu, 5 avganger × 30 medlemmer. P2a: kontrollsøk + evaluering (samme oppskrift som vinduet selv ble målt med). P2b: fullt Pareto-søk per medlem | P2a: alle konfigurasjoner. P2b: `ANALYTISK`, `REF`, `R-4X`, `T-3H`, `K-ANBEFALT` |
| **P3** | flipper pakken *gjennomførbarhet eller felle-sett*? | S-3 (5 avganger) og S-8 (3 avganger) × 30 medlemmer. **(a) fast rute:** REF-ruten holdes fast, bare medlemsfeltene degraderes. **(b) egen rute:** hele kjeden degradert. Felle-dom = `trapVerdict` med fullt Pareto-re-søk (R2, backoff 1) | 8 avganger × 29 konfigurasjoner |

**Kryssevalueringen i P1 er det tallet formatvalget står på.** «Ruten flyttet
seg» er ingen kostnad i seg selv. Hver degradert rute seiles derfor gjennom det
**analytiske** feltet med samme evaluator, og sammenlignes med REF-rutens tid i
samme felt:

- **anger** = (degradert plan under sannheten − REF-plan under sannheten) / REF
- **optimisme** = (planen under sannheten − planen i sitt eget felt) / eget felt.
  Positiv optimisme = virkeligheten er verre enn pakken lovet.

Anger og optimisme regnes **kun på ankomstscenarioene**: på `uoppnaelig-mal` og
`hull-i-vaerfeltet` ender ruten per konstruksjon ikke i målet, og «tid» er der
hvor langt beste delrute rakk.

P3s felle-dom kjøres for konfigurasjoner der hardfeil-settet flyttet seg, pluss
et fast sett (`REF`, `H-8N`, `H-8O`, `H-8G`, `H-6G`, `H-6GO`, `K-ANBEFALT`,
`K-VERSTE`) — R2-re-søk er dyre, og et identisk hardfeil-sett kan ikke gi et
annet felle-sett uten at re-søket selv har flyttet seg.

### 2.3 Determinisme

Ingen RNG, ingen nett, ingen klokke i noe som havner i rådataene. Kostnad
rapporteres med deterministiske tellere (søk, evalueringer, gridnoder, fliser),
ikke millisekunder — samme valg som E1′-kjøringen 2026-09-01.

Flis-cachen i pakkemodellen er ren memoisering. Enhetstesten
`pakkedegradering: determinisme` beviser at to pakker av samme felt og spec gir
bit-identiske samples, og at andre oppslag gir samme tall som første.

To uavhengige fulle kjøringer av P3 (før og etter at
konvergenskonfigurasjonene ble lagt til) ga **identiske** hardfeil- og
felle-sett for alle felles konfigurasjoner.

### 2.4 Sanity: harnessen reproduserer den forhåndsregistrerte fiksturen

To uavhengige kontroller mot tall som ble låst før denne målingen fantes:

- `ANALYTISK` i **P2a** gir S-5-vinduet 14,859 / 14,769 / 14,731 / 14,422 /
  14,712 t — **eksakt** tabellen som står forhåndsregistrert i
  `ensemble-s5-departure.ts` (målt 2026-08-31, før kjøring).
- `ANALYTISK` i **P2b** gir 14,403 / 14,378 / 14,293 / 14,289 / 13,842 t —
  **eksakt** S-5-raden for fasitvarianten F i E1′-kjøringen 2026-09-01
  (`tools/e1-maaling/kjorelogg-2026-09-01.txt`).

Harnessen måler altså den fiksturen den tror den måler, med begge metodene.

---

## 3. Konfigurasjonsmatrisen

29 konfigurasjoner, hver **én endring** fra `REF` (unntatt de to
`K-`-kombinasjonene). Full spesifikasjon i
`docs/research/kvantisering-raadata/meta.json`.

| akse | konfigurasjoner |
|---|---|
| baseline | `ANALYTISK` (upakket), `REF` (Float32, 2,5 km / 0,8 km / 1 t) |
| vind | `W-UV8`, `W-UV10`, `W-UV12` (u/v per flis), `W-UV8G` (u/v 8-bit, én global skala), `W-SD8`, `W-SD10` (fart + retning) |
| rom | `R-2X` (5 km), `R-4X` (10 km) |
| tid | `T-3H`, `T-6H` |
| strøm | `C-2X` (1,6 km), `C-4X` (3,2 km), `C-8X` (6,4 km), `C-TID` (kun hovedkomponent), `C-8B` (8-bit, full oppløsning) |
| bølge | `H-8N` (Hs/Tp 8-bit per flis), `H-8O` (per flis, opp), `H-8G` (8-bit global, 4,7 cm), `H-8GO` (global, opp), `H-6G` (6-bit global, 19 cm), `H-6GO` (6-bit global, opp), `P-8G` (kun Tp global 8-bit) |
| konvergens | `T-30M`, `T-15M`, `R-HALV` (1,25 km), `FIN-ALT` (1,25 km + 15 min + 0,4 km) |
| kombinasjon | `K-ANBEFALT`, `K-VERSTE` |

Konvergenskonfigurasjonene ble lagt til **etter** første kjøring, da den viste
at `REF` selv flytter S-5s P50 opptil 2 % mot det analytiske feltet. Uten dem
er 2,5 km/1 t en udokumentert antakelse, ikke en referanse.

---

## 4. Kalibrering: hva referansepakken selv koster

| sammenligning | maks \|Δt\| | maks korridor | maks anger | maks TWS-feil (front) | verste Hs for lav |
|---|---|---|---|---|---|
| `ANALYTISK` mot `REF` | 1,27 % | 2,21 nm | 1,47 % | 13,88 kn (`REF`) | −0,117 m (`REF`) |
| `R-HALV` mot `REF` | 1,28 % | 2,21 nm | 1,47 % | 13,92 kn | −0,117 m |
| `T-15M` mot `REF` | 0,01 % | 0,001 nm | 0,00 % | 2,79 kn | −0,008 m |
| `FIN-ALT` mot `REF` | 0,26 % | 2,12 nm | 0,41 % | 2,72 kn | −0,008 m |

Tre ting følger:

1. **Referansens restfeil er romlig, ikke tidsmessig.** `R-HALV` (1,25 km)
   reproduserer `ANALYTISK` i alle tre ruteeffektkolonnene, mens `T-15M` er
   identisk med `REF`. Hele gapet `ANALYTISK` → `REF` ligger på de to
   strømbånd-sondene, som har struktur på 3–9 km og altså er under-oppløst av
   et 2,5 km-nett.
2. **Feltfeilen ved 1 t er stor og ruteeffekten er null.** 13,88 kn maksimal
   momentan TWS-feil og 1,62 kn RMS gir Δt 0,01 % og korridor 0,001 nm når man
   halverer tidssteget to ganger. Dette er kjernebegrunnelsen for at målingen
   *ikke* bruker felt-RMSE som kriterium.
3. **Ruteeffektens støygulv er ~1,3 % Δt / ~2,2 nm korridor** på denne
   fikstursamlingen — det er hva et strengt *finere* felt gir. Konfigurasjoner
   under dette er ikke skilt fra referansen av målingen.

---

## 5. Akse 1 — vind-kvantisering

| konfig | maks \|Δt\| | maks korridor | maks anger | N5-brudd | maks retn.feil | TWS over deklarert maks |
|---|---|---|---|---|---|---|
| `W-UV8` | 0,00 % | 0,001 nm | 0,00 % | ingen | 7,77° | 4165 punkter, +0,02 kn |
| `W-UV10` | 0,00 % | 0,000 nm | 0,00 % | ingen | 7,83° | 4158 punkter, +0,00 kn |
| `W-UV12` | 0,00 % | 0,000 nm | 0,00 % | ingen | 7,82° | 4158 punkter, +0,00 kn |
| `W-UV8G` | 0,38 % | 4,48 nm | 0,14 % | 5 scenarioer | 7,89° | 10 584 punkter, **+0,09 kn** |
| `W-SD8` | 0,42 % | 3,55 nm | 0,15 % | 3 scenarioer | 7,65° | 4957 punkter, +0,00 kn |
| `W-SD10` | 0,75 % | 4,92 nm | **1,03 %** | 2 scenarioer | 7,88° | 3493 punkter, +0,00 kn |

(Retningsfeilkolonnen er dominert av gridsamplings- og tidsinterpolasjonsfeil,
som er felles for alle konfigurasjonene — referansen selv står på 7,82°.
Kvantiseringens eget bidrag drukner i den, og kolonnen skiller derfor ikke
konfigurasjonene. Det er ruteeffektkolonnene som gjør det.)

**Funn.** Skala/offset **per flis** gjør u/v-kvantisering praktisk talt gratis
helt ned til 8 bit: null Δt, null korridor, null anger, ingen flips i P3, ingen
rangeringsendring i P2a. Det er den adaptive skalaen som gjør det — en flis på
32×32 noder har smalt dynamisk område.

To valg koster:

- **Én global skala** (`W-UV8G`) gir 4,5 nm korridoravvik og N5-brudd i 5 av 11
  scenarioer, og er den eneste konfigurasjonen som overskrider feltets
  deklarerte `maxTwsKn` merkbart (+0,09 kn = et halvt kvantiseringstrinn).
- **Fart + retning som lagringsform** er dårligere enn u/v ved samme
  bitbudsjett. Ved 10 bit gir den 1,03 % anger på S-8 der `W-UV10` gir 0,00 %.
  Årsaken er feilstrukturen: en retningsfeil er en *rotasjon* av vektoren, og
  på tvers av en front — der fartsfeltet er nesten kontinuerlig men retningen
  hopper 68° — er retningskanalen den som bærer informasjonen. u/v fordeler
  feilen på to kanaler med samme skala og unngår dette.

---

## 6. Akse 2 og 3 — romlig og tidsmessig oppløsning

### 6.1 Rom

| konfig | maks \|Δt\| | maks korridor | maks anger | N5-brudd | maks TWS-feil |
|---|---|---|---|---|---|
| `R-2X` (5 km) | 0,73 % | 2,18 nm | 0,49 % | `sonde-stromband-3km` | 13,76 kn |
| `R-4X` (10 km) | 0,63 % | 7,91 nm | 0,00 % | 4 scenarioer | 13,30 kn |

`R-2X` er innenfor støygulvet på alt unntatt 3,3 km-sonden. **Rettelse
2026-09-02 (§9.1):** det gjelder P1. Kjørt i P2b flytter `R-2X` P50 med 3,50 %
og flipper toppavgangen fra +4 t til +2 t — se §9.1. `R-4X` flytter
ruten 7,9 nm på frontfiksturen og bryter N5 i fire scenarioer, men gir
**ingen** flips i P3 og ingen anger — den finner en annen, like god rute.
Rangeringen (P2a) flipper.

### 6.2 Tid — **her ligger den ene diskvalifiserende oppløsningsgrensen**

| konfig | maks \|Δt\| | maks korridor | maks anger | maks TWS-feil (front) | verste Hs for lav | flips |
|---|---|---|---|---|---|---|
| `T-15M` | 0,01 % | 0,001 nm | 0,00 % | 2,79 kn | −0,008 m | ingen |
| `T-30M` | 0,01 % | 0,001 nm | 0,00 % | 8,44 kn | −0,030 m | ingen |
| `REF` (1 t) | — | — | — | 13,88 kn | −0,117 m | — |
| `T-3H` | 0,12 % | 2,82 nm | 0,57 % | 16,69 kn | **−0,576 m** | **S-3 +8 t: mister `m29`** |
| `T-6H` | 7,24 % | 6,00 nm | 4,75 % | 18,22 kn | −0,900 m | ingen (men 7,2 % Δt) |

**Mekanismen er målt, ikke gjettet.** S-3s medlem `m29` har postfrontal
Hs 4,6 m mot båtens grense 4,0 — margin 0,6 m. Ved 3 t tidssteg er verste
temporale underrapportering av Hs 0,576 m, altså akkurat marginen. Den harde
forkastelsen ved 13,96 t (like før ankomst) forsvinner, medlemmet blir
gjennomførbart, og felle-settet krymper fra `{m04,m09,m14,m29}` til
`{m04,m09,m14}`. **En pakke som skjuler en felle er diskvalifisert**, uansett
hvor pen ruten ellers er: `T-3H`s Δt er 0,12 %.

Merk asymmetrien: `T-6H` gir 7,2 % Δt og 4,75 % anger — mye *synligere* skade —
men mister ikke `m29` (fronten er da så utsmurt at Hs-toppen treffer et annet
sted i tid). At en akse er farligere ett sted enn et annet er ikke monotont i
grovhet, og det er nettopp derfor felle-settet måles og ikke bare tid.

Motsatt vei kjøper finere tid ingenting: `T-30M` koster 64 % flere gridnoder
enn `REF` (3,61 M mot 2,19 M i P1) og gir Δt 0,01 %.

**Ikke oppløst i noen av konfigurasjonene:** frontfiksturens vindstille-stripe
er ~10 nm bred og fronten går 18 kn — stripen passerer et punkt på ~17 minutter.
Verken 1 t eller 15 min bærer den som gridverdi. Det er en kjent begrensning
arvet fra `front-weather.ts` (som dokumenterer den selv), ikke noe denne
målingen kan svare på.

---

### 6.3 Avgangsrangeringen (P2a mot P2b)

**P2a — billig (kontrollsøk + evaluering av 30 medlemmer), alle
konfigurasjoner.** Toppavgang +3 t i referansen. Flipper til +1 t / +4 t / +2 t
i `R-4X`, `T-3H`, `T-6H`, `H-8G`, `H-8GO`, `H-6G`, `K-VERSTE` — **og i
`T-30M` og `T-15M`**, som er strengt finere enn referansen. Maks ΔP50 er
2,06 % allerede for `ANALYTISK` og 2,52 % for `R-HALV`. Instrumentet er altså
mettet av rutevalgsdegenerasjon, ikke av pakkekvalitet.

**P2b — fullt Pareto-søk per medlem (5 × 30 søk per konfigurasjon):**

| konfig | P50 per avgang (t) | topp | inv. P50 | inv. P90 | maks ΔP50 | maks ΔP90 |
|---|---|---|---|---|---|---|
| `ANALYTISK` | 14,403 / 14,378 / 14,293 / 14,289 / 13,842 | +4 t | 0 | 0 | 0,08 % | 0,01 % |
| `REF` | 14,403 / 14,381 / 14,305 / 14,290 / 13,835 | +4 t | — | — | — | — |
| `R-4X` | 14,403 / 14,439 / 14,289 / 14,314 / 14,274 | +4 t | 2 | 1 | **3,17 %** | 5,04 % |
| `T-3H` | 14,374 / 14,374 / 14,313 / 14,265 / 13,815 | +4 t | 1 | **7** | 0,20 % | **5,91 %** |
| `K-ANBEFALT` | 14,403 / 14,382 / 14,306 / 14,289 / 13,836 | +4 t | 0 | 0 | 0,01 % | 0,00 % |

Tre lesninger:

1. **Referansepakken er tro mot feltet når man måler riktig.** 0,08 % ΔP50 og
   null inversjoner mot `ANALYTISK`. Toppavgangen er stabil på +4 t.
2. **Ingen av konfigurasjonene flipper toppavgangen** under fulle søk. Per
   E1′-presedensen er ingen rangeringsflipp diskvalifiserende her.
3. **`R-4X` og `T-3H` degraderer på hver sin måte.** `R-4X` treffer P50-kroppen
   (3,17 %, over ±2 %-båndet); `T-3H` lar P50 stå (0,20 %) og river opp P90 med
   7 inversjoner. Det siste er ikke tilfeldig: P90 er halen, og halen er der
   medlemmene som møter harde grenser ligger — samme sted som den tapte fella i
   §6.2.

Legg merke til at **P2a og P2b er uenige om toppavgangen på det udegraderte
feltet**: +3 t mot +4 t. S-5s forhåndsregistrerte kriterium («laveste P50»)
ble målt med kontrollrute-metoden; med fullt søk per medlem peker det på +4 t.
Det er ikke en feil i noen av dem — de måler to forskjellige ting — men det er
verdt å notere for S-5s framtidige bruk.

## 7. Akse 4 — strøm

### 7.1 Nedtynning og kvantisering på fiksturene

| konfig | maks \|Δt\| | maks korridor | maks anger | maks strømfeil | plan feiler under sannhet | flips |
|---|---|---|---|---|---|---|
| `C-2X` (1,6 km) | 0,03 % | 2,02 nm | 0,16 % | 0,001 kn | — | ingen |
| `C-4X` (3,2 km) | 0,63 % | 4,13 nm | 0,00 % | 0,054 kn | — | ingen |
| `C-8X` (6,4 km) | 1,03 % | 4,79 nm | 3,31 % | 0,364 kn | `hull-i-vaerfeltet` * | ingen |
| `C-TID` (kun hovedkomponent) | 0,66 % | 7,66 nm | **5,93 %** | 0,914 kn | `tss-ved-skagen`, `hull-i-vaerfeltet` * | ingen |
| `C-8B` (8-bit, full oppl.) | 0,01 % | 1,09 nm | 0,00 % | 0,002 kn | — | ingen |

\* `hull-i-vaerfeltet`-avvisningene er `noWeather` og er en artefakt av det
scenariet (feltet har en bbox; en rute som legger seg litt annerledes går
utenfor den). De teller **ikke** som sikkerhetsfunn. `tss-ved-skagen`-
avvisningen er derimot ekte: `C-TID`s plan bryter TSS-retningsregelen etter
4,62 t når den seiles i det sanne strømfeltet.

**Funn.** Kvantisering av strøm til 8 bit per flis er gratis. Nedtynning er
billig helt til strukturen forsvinner: 8× (6,4 km) gir 3,3 % anger, og
«kun tidevanns-hovedkomponent» gir 5,9 % anger på v1s referansestrekk og en
plan som ikke er gjennomførbar under sannheten. `C-TID` seiler også en helt
annen taktikk — 1,33 t kryss mot referansens 2,29 t — fordi den tror den har en
strøm den ikke har.

**Men fiksturene kan ikke falsifisere nedtynning.** S-8s strømbånd har 0,35°
halvbredde (~39 km); et 6,4 km-nett har 12 noder tvers over det. At `C-4X` og
`C-8X` ikke gir flips, er derfor et utsagn om *disse feltene*, ikke om
kyststrøm. S-3/S-5/S-7 har **ingen strøm i det hele tatt** — hele
rangeringsaksen (P2a) er strukturelt blind for strøm, og alle nullene i
strømradene der er trivielle.

### 7.2 Sondene: hvor smal må strukturen være før det biter?

Sonder lagt til 2026-09-01, ikke forhåndsregistrerte fiksturer. Samme geometri
som S-8, men med strømbåndet krympet:

| bånd (halvbredde) | `ANALYTISK` mot `REF` | verste konfig | verste anger |
|---|---|---|---|
| 0,35° (~39 km, S-8 selv) | Δt 0,00 %, korridor 0,001 nm | `C-TID` 6,27 nm | 3,22 % (`C-TID`) |
| 0,08° (~9 km) | Δt 0,06 %, korridor 1,05 nm | `K-VERSTE` 4,73 nm | 1,35 % (`C-TID`) |
| 0,03° (~3,3 km) | **Δt 1,27 %, korridor 2,21 nm** | `H-6G` 6,28 nm | 3,31 % (`C-8X`) |

Ved 3,3 km halvbredde er det **referansepakken selv** som ikke klarer
strukturen — og feilen ligger i vind-/bølgenettet på 2,5 km (`R-HALV` med
1,25 km reproduserer `ANALYTISK`), ikke i strømnettet på 0,8 km. Det gir den
formen kravet må ha: **nodeavstanden må være liten mot strukturbredden**, med
en tommelfingerregel på ≤ ¼ av den smaleste strukturen som skal representeres.
For NorKyst-klassens kyststrøm (fronter og virvler på 1–5 km) betyr det
800 m urørt i kystsonen.

---

## 8. Akse 5 — bølge-kvantisering

Dette er aksen der en kvantiseringsfeil kan flippe en **hard** avvisning
(`maxHs`) og dermed gjennomførbarhet og felle-sett.

### 8.1 Ruteeffekt

| konfig | trinn | maks \|Δt\| | maks korridor | maks anger | verste Hs for lav |
|---|---|---|---|---|---|
| `H-8N` (8-bit, flis, nearest) | adaptivt, «cm-nivå» | 0,00 % | 0,001 nm | 0,00 % | −0,003 m |
| `H-8O` (8-bit, flis, opp) | adaptivt | 0,00 % | 0,003 nm | 0,00 % | −0,001 m |
| `H-8G` (8-bit, global 0–12 m) | 4,7 cm | 0,54 % | 4,55 nm | 0,51 % | −0,023 m |
| `H-8GO` (8-bit global, opp) | 4,7 cm | 0,95 % | 6,09 nm | 2,35 % | 0,000 m |
| `H-6G` (6-bit global) | 19 cm | 6,21 % | 6,28 nm | 0,64 % | −0,150 m |
| `H-6GO` (6-bit global, opp) | 19 cm | 0,87 % | 6,28 nm | 1,54 % | −0,064 m |
| `P-8G` (kun Tp global 8-bit) | 0,098 s | 0,53 % | 4,55 nm | 0,37 % | — |

(«Verste Hs for lav» er målt *mellom* tidsskivene og inneholder derfor både
kvantiserings- og interpolasjonsfeil — se §8.4, der de to skilles. Til
sammenligning har `REF`, som ikke kvantiserer Hs i det hele tatt, −0,117 m.
`H-6GO` er altså **bedre** enn referansen på denne kolonnen, og `H-6G`
verre.)

`H-6GO` er den eneste bølgekonfigurasjonen med en diskret endring:
`daylightArrival` går fra `true` til `false` på `skjaeloy-skagen-apent`. Det er
konservatismens pris, ikke en feil.

### 8.2 Flips

| konfig | hardfeil-sett lik `REF` | flippede medlemmer | felle-sett lik `REF` |
|---|---|---|---|
| `H-8N`, `H-8O`, `H-8G`, `H-8GO` | ja | — | ja |
| `H-6G` | **NEI** | S-8 +0 t: −`m26`; +3 t: −`m26`; +6 t: −`m26` | ja |

`m26` i S-8 har `currentKn = 2,4`, `windFromDeg = 45` og verste
**Hs 4,069 m** mot `testBoat().maxHsM = 4,0`. Margin: **6,9 cm**. Halve
kvantiseringstrinnet i `H-6G` er 9,5 cm. Forkastelsen forsvinner i alle tre
avganger, og medlemmet framstår som gjennomførbart.

At felle-settet likevel er «lik REF» for `H-6G` er *ikke* en formildende
omstendighet: i S-8 er felle-settet tomt i utgangspunktet (R2 finner en utvei
fra alle harde feil). Det som gikk tapt, er den harde forkastelsen selv — altså
en `boatLimits`-avvisning som skulle gjort medlemmet ugjennomførbart.

### 8.3 Kontrolleksperiment: er det trinnstørrelsen eller avrundingsretningen?

Kjørt som eget tillegg (`kvantisering-raadata/tillegg-hs-avrunding/`) med
`REF`, `H-8O`, `H-6G` og `H-6GO` over S-3s fem og S-8s tre avganger.
Hypotesen ble skrevet ned før kjøring: *hvis mekanismen er avrundings-
retningen, skal samme grove 19 cm-kvantisering avrundet opp beholde alle
forkastelser.*

| konfig | gj.f.diff | flippede medlemmer | retning |
|---|---|---|---|
| `H-8O` | 0 … 0 | — | — |
| `H-6G` (nearest, 19 cm) | 0 … **+1** | S-8 +0/+3/+6 t: **−`m26`** | **mistet** forkastelse |
| `H-6GO` (opp, 19 cm) | **−1** … 0 | S-3 +6 t: **+`m11`**; +8 t: **+`m15`** | **la til** forkastelse |

Hypotesen holder. Med samme trinnstørrelse snur avrundingsretningen fortegnet
på alle flips: `nearest` mister ekte farer, `opp` legger til falske. `H-6GO`
mister aldri en forkastelse, men prisen er målbar — to falske feller over 240
medlemsevalueringer, og på `skjaeloy-skagen-apent` flyttes ankomsten ut av
dagslysvinduet (`daylightArrival: true → false`).

**Konklusjon:** avrundingsretningen bestemmer *fortegnet* på risikoen,
trinnstørrelsen bestemmer *hvor mye unødig konservatisme* man betaler. Begge må
spesifiseres. Ved 4,7 cm trinn (8-bit global) og adaptivt trinn (8-bit per
flis) er begge avrundingsretninger uten flips i denne fikstursamlingen.

### 8.4 Overlever konservatismen interpolasjonen?

Avrunding opp garanterer at **nodeverdien** er ≥ sannheten. Mellom nodene er
det ikke gitt: lineær interpolasjon undervurderer et lokalt maksimum. Det må
måles, ikke antas — og svaret er todelt.

**(a) Der nettet oppløser strukturen, overlever konservatismen.** Målt direkte
på `m26`s bølgefelt langs 57,8–58,7° N × tre tidspunkter (1203 punkter, 123 av
dem over `maxHsM = 4,0`). `m26`s bølgefelt er *statisk i tid* og glatt i
bredde, så dette isolerer kvantiseringen fra tidsinterpolasjonen:

| kvantisering | verste Hs for lav | punkter over grensen som **forsvant** |
|---|---|---|
| `6 bit global, nearest` (19 cm) | −0,0900 m | **112 av 123** |
| `8 bit global, nearest` (4,7 cm) | −0,0221 m | **3 av 123** |
| `6 bit global, opp` (19 cm) | **0,0000 m** | **0 av 123** |

**Vanlig avrunding er ikke trygg ved 4,7 cm heller** — den mister
overskridelsen i 3 av 123 punkter, i et tynt lag rundt terskelen. At `H-8G`
likevel ikke flippet noe felle-sett i P3, betyr at ruten gikk gjennom det
indre av overskridelsesområdet, ikke at formatet er sikkert. Anbefalingen om
avrunding opp gjelder derfor **uavhengig av trinnstørrelse**.

**(b) Mellom tidsskivene gjør den det ikke.** Feltsonden over hele
scenariosamlingen sampler på skjeve klokkeslett (0,37 t, 2,13 t, …), altså
*mellom* skivene i alle tidsoppløsninger. Da er verste Hs-underrapportering:

| konfig | verste Hs for lav | hva den består av |
|---|---|---|
| `REF` (Float32, ingen kvantisering) | −0,117 m | ren interpolasjonsfeil, 1 t |
| `H-8GO` (8-bit global, opp) | −0,105 m | interpolasjon minus opp-marginen |
| `H-6GO` (6-bit global, opp) | −0,064 m | interpolasjon minus en større opp-margin |
| `H-6G` (6-bit global, nearest) | −0,150 m | interpolasjon **pluss** kvantisering |
| `T-3H` (Float32, 3 t) | −0,576 m | ren interpolasjonsfeil, 3 t |

Konservativ avrunding **reduserer** underrapporteringen (0,117 → 0,105 →
0,064 m etter hvor stor opp-marginen er) men fjerner den ikke: resten er
interpolasjon, ikke kvantisering. Og den resten er den *samme* størrelsen som
felte `T-3H` i §6.2 — 0,576 m mot fellemedlemmets 0,6 m margin.

**Det binder de to kravene sammen.** Kravet om konservativ Hs (§10 krav 1) og
kravet om 1 t tidssteg (§10 krav 3) er ikke to uavhengige tiltak mot to
uavhengige feil — de er to halvdeler av det samme: *dekodet Hs skal ikke ligge
under sannheten der det betyr noe.* Kvantiseringen kan gjøres trygg ved å
velge fortegn; interpolasjonen kan bare gjøres trygg ved å velge oppløsning.

Egenskapen i (a) er låst som regresjonstest i
`packages/routing/src/pack-degradation.test.ts` («konservativ Hs sletter aldri
en hard forkastelse»), med begge halvdeler: opp-varianten skal bevare alle
overskridelser, og nearest-varianten skal miste minst én — ellers måler testen
ingenting.

### 8.5 Tp

`P-8G` (Tp alene, 8-bit global, 0,098 s trinn) gir ingen flips og 0,53 % maks
Δt. Men merk at bratthet er `S = 2πHs/(g·Tp²)`: en relativ Tp-feil slår inn
**dobbelt**. Symmetriargumentet sier at Tp bør rundes **ned** (lavere Tp ⇒
brattere sjø ⇒ konservativ derating). Det er **ikke målt** — `H-6GO`-
eksperimentets motstykke for Tp mangler, og bør kjøres når S-8s
bratthetsderating slås på i produksjon.

---

## 9. Kombinasjonene

| konfig | maks \|Δt\| | maks korridor | maks anger | flips | diskrete endringer |
|---|---|---|---|---|---|
| `K-ANBEFALT` | 0,99 % | 4,86 nm | 1,14 % | **ingen** | ingen |
| `K-VERSTE` | 1,09 % | 4,73 nm | 1,46 % | **S-3 +8 t: −`m29`** | `tss-ved-skagen`: `safetyVerdict` «usikkert» → «trygt», `reachesDestination` false → true |

`K-ANBEFALT` = u/v 10-bit per flis, 2,5 km vind/bølge, 1 t, strøm 1,6 km
10-bit, Hs 8-bit per flis **avrundet opp**, Tp 8-bit per flis, retning 10-bit.
Den passerer alt: ingen gjennomførbarhets- eller felle-flips i noen av de åtte
avgangene, ingen diskrete endringer, ingen rangeringsflipp i verken P2a eller
P2b, og i P2b er den **umulig å skille fra referansen** (ΔP50 0,01 %, ΔP90
0,00 %, null inversjoner). Anger ligger innenfor målingens støygulv.

Én avvik mellom `K-ANBEFALT` og §10: den ble målt med strøm på **1,6 km**, ikke
0,8 km. Det var trygt på disse fiksturene, men §7.2 viser at strømkravet må
formuleres på strukturbredde, og §10 anbefaler derfor 800 m urørt i kystsonen.
`K-ANBEFALT` er altså et *målt gulv*, ikke den anbefalte pakken i kystsonen.

`K-VERSTE` = u/v 8-bit global, 10 km, 3 t, strøm 6,4 km 8-bit global, Hs 8-bit
global nearest. Den arver `T-3H`s tapte felle, og legger til noe verre: på
`tss-ved-skagen` går `safetyVerdict` fra «usikkert» til «trygt». Det er den
eneste konfigurasjonen i hele matrisen som gjør en usikker rute *trygt-merket*.
Uansett hva den ellers måtte spare i båndbredde: **diskvalifisert**.

### 9.1 Tillegg 2026-09-02 — helhetsmåling av den ANBEFALTE konfigurasjonen

> Kjørt natt til 2026-09-02 etter fagagent-review av denne rapporten.
> Rådata: `docs/research/kvantisering-raadata/tillegg-k-anbefalt/`
> (+ `attribusjon-5km/`), tabeller:
> `tools/kvantisering/tabeller-tillegg-k-anbefalt-2026-09-01.txt`, kjørelogger:
> `tools/kvantisering/kjorelogg-tillegg-k-anbefalt-*.txt`.

**Hvorfor tillegget finnes.** Reviewen fant to hull i §9:

1. `K-ANBEFALT` er **ikke** konfigurasjonen §10 anbefaler. Den ble målt med
   strøm på 1,6 km (rapportens eget forbehold over) og med 10-bit u/v, mens
   ytelses-reviewen siden har valgt **byte-alignet 8 bit**.
2. `T-3H` mot `T-6H` (§6.2) beviser at skade **ikke er monoton i grovhet**.
   Da kan «finere er trygt» ikke antas — heller ikke at 10 bit dekker for
   8 bit, eller at 0,8 km strøm dekker for 1,6 km. Anbefalingen må måles som
   den helheten den skal implementeres som.

**To konfigurasjoner, fordi anbefalingen er en konvolutt.** §10 har to
tillatte punkter langs romaksen (2,5 km i kystsonen, 5 km utaskjærs med flagg)
og to langs strømaksen (800 m i kystsonen, 1,6 km utaskjærs). Pakkemodellen har
**én** nodeavstand per felt og kan ikke representere et sonevarierende nett;
begge endene av konvolutten er derfor målt hver for seg:

| konfig | vind/bølge | strøm | tid | kvantisering |
|---|---|---|---|---|
| `K-ANB-KYST` | 2,5 km | 0,8 km | 1 t | u/v 8-bit per flis, strøm 8-bit per flis, Hs 8-bit per flis **OPP**, Tp 8-bit per flis, retning 8-bit |
| `K-ANB-UTASKJAERS` | 5 km | 1,6 km | 1 t | identisk kvantisering |

**Metode.** Samme harness og samme fire protokoller (P1, P2a, P2b, P3), egen
rådatamappe. `REF` ble kjørt på nytt i alle protokollene og **reproduserte
hovedkjøringen**: P1-tidene per scenario, P3s hardfeil- og felle-sett i alle
åtte avganger, og P2b-raden 14,403 / 14,381 / 14,305 / 14,290 / 13,835 er
identiske med kjøringen 2026-09-01. Determinismen holder på tvers av kjøringer
og konfigurasjonsutvalg.

#### Resultat: kystvarianten består som helhet

| kriterium | `K-ANB-KYST` | dom |
|---|---|---|
| P3 hardfeil-sett, fast rute, 8 avganger | identisk med `REF` i alle åtte (S-3: `{m04,m09,m14,m24}`, +8 t også `m29`; S-8: `{m26,m27}`) | **ingen tapte harde forkastelser** |
| P3 felle-sett (R2 pareto, backoff 1) | identisk med `REF` i alle åtte, inkl. `m29` på S-3 +8 t — fella `T-3H` mistet | **ingen felle-flips** |
| P3 gjennomførbarhet, fast og egen rute | 0 … 0 differanse | ingen flips |
| P1 diskrete felt (11 scenarioer) | ingen endring | ingen |
| P1 maks \|Δt\| / maks anger | 0,02 % / 0,00 % | under støygulvet (§4) |
| P2b (fulle søk per medlem) | 14,403 / 14,383 / 14,306 / 14,290 / 13,836; topp **+4 t** som `REF`; 0 P50-inversjoner; maks ΔP50 **0,01 %**, maks ΔP90 **0,00 %** (én P90-inversjon, men med ΔP90 0,00 % — to praktisk talt like tall som bytter plass) | umulig å skille fra referansen |
| P2a (billig) | topp +3 t som `REF`, maks ΔP50 0,01 % | ingen flipp |

To N5-brudd står igjen i P1, begge på korridorkravet alene og begge under
målingens eget støygulv: `s8-vind-mot-strom-kontroll` 2,143 nm og
`sonde-stromband-9km` 1,084 nm (§4: `ANALYTISK` mot `REF` er 2,21 nm på samme
fikstursamling, altså er dette ikke skilt fra «et strengt finere felt»). Tiden
er uendret i begge (−0,02 % og +0,01 %), angeren null, og de diskrete
sikkerhetsfeltene identiske. På `tss-ved-skagen` legger `K-ANB-KYST` seg
**eksakt på `ANALYTISK`-grenen** (5,007 t, korridor 1,745 nm — samme tall som
`ANALYTISK`, `T-15M` og `FIN-ALT` i hovedkjøringen): en tie-break i søket, ikke
en degradering.

**Hs-trinnet ved flis-skala er målt, ikke antatt.** §10 krav 2 («trinn ≤ 5 cm»)
er trivielt oppfylt ved global skala (12 m / 255 = 4,7 cm), men ved **flis**-
skala er trinnet en egenskap ved feltet: `(maks − min i flisen og skiven)/255`.
Sonden `tools/kvantisering/hs-trinn.mjs` måler det direkte med samme
flisgeometri (32×32 noder), på S-3 og S-8 med kontroll + 30 medlemmer, 20
timesskiver:

| variant | maks realisert trinn | maks Hs-spenn i en flis | fliser over 5 cm |
|---|---|---|---|
| `K-ANB-KYST` (2,5 km) | **1,24 cm** | 3,16 m (`m24`) | **0 av 12 400** |
| `K-ANB-UTASKJAERS` (5 km) | 1,17 cm | 2,97 m (`m04`) | 0 av 7 440 |

Ved 8 bit brytes 5 cm-kravet først når Hs-spennet i én flis og skive
overstiger **12,75 m** — det skjer ikke i disse feltene, og er fysisk
usannsynlig i en flis på 80×80 km. Kravet «≤ 5 cm» er altså oppfylt av
flis-skalaen selv, uten en eksplisitt trinngrense i formatet — men grensen bør
likevel stå i spec-en som en **kontroll produsenten kjører**, ikke som en
antakelse (den er billig: én min/maks per flis er allerede beregnet).

#### Resultat: utaskjærs-enden består sikkerhetskriteriene, men **flipper toppavgangen**

`K-ANB-UTASKJAERS` har **ingen** flips i P3 — hardfeil-settene, felle-settene og
gjennomførbarheten er identiske med `REF` i alle åtte avganger, og ingen
diskrete felt endrer seg i P1. På det kriteriet formatvalget hviler på
(sikkerhet) består den.

Men i **P2b** (fulle Pareto-søk per medlem — det instrumentet §11 forbehold 2
sier formatbeslutninger skal hvile på) gjør den noe ingen av de fem
konfigurasjonene i §6.3 gjorde:

| konfig | P50 per avgang (t) | topp | inv. P50 | inv. P90 | maks ΔP50 | maks ΔP90 |
|---|---|---|---|---|---|---|
| `REF` | 14,403 / 14,381 / 14,305 / 14,290 / **13,835** | +4 t | — | — | — | — |
| `K-ANB-KYST` | 14,403 / 14,383 / 14,306 / 14,290 / 13,836 | +4 t | 0 | 1 | 0,01 % | 0,00 % |
| `K-ANB-UTASKJAERS` | 14,443 / 14,445 / **14,293** / 14,299 / 14,299 | **+2 t** | 3 | 3 | **3,35 %** | 5,36 % |

Toppavgangen flytter seg fra +4 t til +2 t, og ΔP50 er 3,35 % — over ±2 %-
båndet, i samme klasse som `R-4X` (3,17 %), som §10 nettopp avviste. Merk hva
som skjer: i det sanne feltet er +4 t klart best (13,835 t, 3,2 % foran
nest beste). Ved 5 km forsvinner hele det forspranget (14,299 t). Det er ikke
en vipping mellom to nesten like avganger — det er at pakkens felt ikke lenger
bærer grunnen til at den siste avgangen var best.

**Attribusjon: det er oppløsningen, ikke bitbredden.** `K-ANB-KYST` har
identisk kvantisering (8 bit overalt) på 2,5 km og er umulig å skille fra
referansen. S-5 har dessuten **ingen strøm i det hele tatt** (§7.1), så
strømaksens 1,6 km kan ikke være årsaken her. Det som gjenstår er 5 km-nettet
for vind/bølge, og kontrollkjøringen bekrefter det: `R-2X` — **samme 5 km, uten
noen kvantisering i det hele tatt (Float32)** — kjørt i P2b i
`attribusjon-5km/`:

| konfig | P50 per avgang (t) | topp | inv. P50 | maks ΔP50 |
|---|---|---|---|---|
| `REF` (reprodusert, tredje uavhengige kjøring) | 14,403 / 14,381 / 14,305 / 14,290 / 13,835 | +4 t | — | — |
| `R-2X` (5 km, Float32) | 14,401 / 14,440 / 14,296 / 14,297 / 14,319 | **+2 t** | 4 | **3,50 %** |

Float32 på 5 km er altså like ille som — marginalt verre enn — 8 bit på 5 km
(3,50 % mot 3,35 %). **På P50-kroppen er bitbredden uskyldig; oppløsningen gjør
hele skaden.**

**Men halen forteller noe annet, og det er en interaksjon.** ΔP90 er
**0,02 %** for `R-2X` (Float32, 5 km) og **5,36 %** for `K-ANB-UTASKJAERS`
(8 bit, 5 km) — mens den samme 8-bit-kvantiseringen på 2,5 km
(`K-ANB-KYST`) gir **0,00 %**. Verken oppløsningen alene eller bitbredden
alene rører P90; sammen gjør de det. Det er nøyaktig den ikke-monotone
oppførselen §6.2 advarer om, det er halen der medlemmene med harde grenser
bor (§6.3 lesning 3), og det er et selvstendig argument for å ikke bære
5 km-lettelsen videre uten en egen måling av *den* kombinasjonen.

Det er også et selvstendig funn om `R-2X`: §6.1 ga den «innenfor
støygulvet på alt unntatt 3,3 km-sonden» på P1-tall, men den ble aldri målt med
det sterke rangeringsinstrumentet. Det er nå gjort, og bildet endrer seg.

**Prisen for å stryke utaskjærs-lettelsen** er målt i samme kjøring: 5 km
koster 1,24 M gridnoder mot 2,18 M for kystvarianten over P1s elleve
scenarioer (43 % færre samples, tilsvarende ~4× færre noder per flate før
flis- og tidsoverhead). Det er en reell båndbredde-/dekodegevinst, og den er
grunnen til at lettelsen ble foreslått i det hele tatt.

#### Hva dette betyr for §10 (anbefaling, ikke beslutning)

1. **Den anbefalte pakken i kystsonen er nå målt som helhet og består** — med
   **8 bit** (byte-alignet), ikke 10. §10s vindrad kan strammes fra «10 bit,
   2 bit over målt grense» til «8 bit per flis, målt som helhet i
   `K-ANB-KYST`»; marginargumentet var uansett svakt, siden skade ikke er
   monoton i grovhet.
2. **§10s romrad bør revideres.** «5 km tillatt på åpent hav med eksplisitt
   flagg» hviler på `R-2X`s P1-tall (0,73 % Δt, ingen flips) — men `R-2X` ble
   **aldri kjørt i P2b**, og med det instrumentet flytter 5 km P50 med 3,35 %
   og flipper toppavgangen. Anbefalingen bør enten strykes (2,5 km overalt),
   eller begrenses til pakker som **ikke** brukes til avgangsrangering — og
   det siste er neppe praktisk, siden robusthetslaget bruker det samme feltet.
   Dette er en anbefaling til Magnus; det er hans beslutning, og den hører
   hjemme i `docs/specs/vaerpakker.md` §9, som fortsatt står åpen.
3. **Sikkerhetskriteriene skiller ikke de to variantene.** Begge holder alle
   harde forkastelser og alle feller. Det som skiller dem er
   *anbefalingskvalitet*, ikke sikkerhet — og det er en annen type argument,
   som bør veies mot båndbreddegevinsten med åpne øyne.

#### Forbehold som gjelder spesielt dette tillegget

1. **Sonevarierende nett er ikke målt.** Pakkemodellen har én nodeavstand per
   felt. De to konfigurasjonene måler endene av konvolutten; at alt *mellom*
   dem består, er en interpolasjon i argumentet, ikke en måling. Særlig er
   **overgangen** mellom en 2,5 km- og en 5 km-sone (en rute som krysser
   sonegrensen, med et sprang i feltoppløsning midtveis) ikke målt i det hele
   tatt.
2. **Strømaksen er ikke testet av rangeringen.** S-5 har ingen strøm, så
   forskjellen mellom 0,8 km og 1,6 km strøm er *usynlig* i P2b. Den hviler
   fortsatt på §7.1/§7.2 og på strukturbredde-argumentet.
3. **Tp rundes til nærmeste**, også her — pakkemodellen har ingen «ned»-modus.
   §8.5s forbehold står uendret.
4. **Hs-trinnsonden måler syntetiske felt.** Konklusjonen er formulert som en
   grense på Hs-spennet i en flis (12,75 m ved 8 bit), som er den formen
   produsenten kan sjekke mot ekte data.
5. §11s forbehold 1, 3, 5, 6 og 7 gjelder uendret (motorens egen
   rutevalgsstøy, syntetiske felt, fikstur-marginer, sondeoppløsning, én
   geografi).

---

## 10. Anbefalte formatvalg med sikkerhetsmargin

| felt | anbefaling | målt grunnlag | margin |
|---|---|---|---|
| **Vind** | u/v-komponenter, **10 bit**, skala/offset **per flis** (flis ≤ 32×32 noder) — **se §9.1: 8 bit er nå målt som helhet og består; byte-alignet 8 bit anbefales** | 8 bit per flis gir null ruteeffekt; 10 bit er 4× finere | 2 bit over målt grense |
| **Vind — avvist** | én global skala; fart + retning som lagringsform | `W-UV8G`: 5 N5-brudd + 0,09 kn over deklarert maks. `W-SD10`: 1,03 % anger der `W-UV10` har 0,00 % | — |
| **Romlig, vind/bølge** | **kildeoppløsning (2,5 km)** i kystsonen; 5 km tillatt på åpent hav med eksplisitt flagg — **utaskjærs-lettelsen er trukket i tvil av §9.1: `R-2X` flipper toppavgangen i P2b (ΔP50 3,50 %)** | `R-2X`: 0,73 % Δt, ingen flips. `R-4X`: 4 N5-brudd, 7,9 nm korridor, og 3,17 % ΔP50 i P2b — over ±2 %-båndet | 2× |
| **Tid** | **1 t. Ingen nedtynning.** | `T-3H` mister en felle (§6.2) og river opp P90-halen (5,91 %, 7 inversjoner, §6.3). `T-30M`/`T-15M` kjøper ingenting for 64 %+ flere noder | 3× (grensen ligger mellom 1 t og 3 t; ikke oppløst nærmere) |
| **Strøm, oppløsning** | **NorKyst 800 m urørt i kystsonen**; ≤ ¼ av smaleste struktur som skal representeres. 1,6 km tillatt utaskjærs | `C-2X`/`C-4X` uten flips på 39 km-struktur; sondene viser effekt når strukturen nærmer seg nettet; `C-TID` gir 5,9 % anger og ugjennomførbar plan | 4× på struktur |
| **Strøm, kvantisering** | u/v **8 bit per flis** | `C-8B`: 0,01 % Δt | — |
| **Strøm — avvist** | «kun tidevanns-hovedkomponent» som eneste strømlag | 5,93 % anger, plan bryter TSS under sannheten | — |
| **Hs** | **8 bit, skala/offset per flis, avrundet OPP** — opp gjelder uansett trinnstørrelse; hvis global skala, trinn ≤ 5 cm | `H-8O` uten flips; `H-6G` (19 cm nearest) mister forkastelse med 6,9 cm margin; `H-6GO` mister ingen; feltprøven i §8.4: nearest mister 3 av 123 overskridelser selv ved 4,7 cm | trinn ≥ 4× under målt bruddpunkt, og fortegnet er sikret uavhengig av trinnet |
| **Tp** | 8 bit per flis; **bør rundes ned** (ikke målt) | `P-8G` uten flips; bratthet går som `Tp⁻²` | — |
| **Bølgeretning** | 8–10 bit syklisk (1,4°/0,35°) | ingen målt effekt | — |

### Eksplisitte krav til `docs/specs/vaerpakker.md`

1. **Hs kvantiseres konservativt oppover.** Dekodet Hs skal aldri være lavere
   enn kildeverdien i en gridnode. Måling: samme kvantisering med vanlig
   avrunding mister en hard `maxHs`-forkastelse med 6,9 cm margin; med
   avrunding opp mistes ingen (§8.3), og feltprøven i §8.4 viser at vanlig
   avrunding mister overskridelser **også ved 4,7 cm trinn** (3 av 123
   punkter). Kravet gjelder derfor uavhengig av trinnstørrelse. Spec-en må
   også si hva konservatismen koster: falske forkastelser, målt til 2 av 240
   medlemsevalueringer ved 19 cm trinn, pluss én ankomst skjøvet ut av
   dagslysvinduet.
2. **Hs-trinnet skal være ≤ 5 cm** (8 bit per flis, eller 8 bit global over
   0–12 m). Krav 1, 2 og 3 er **koblet, ikke uavhengige**: avrunding opp
   fjerner kvantiseringens bidrag til en for lav Hs, men ikke
   interpolasjonens. Målt underrapportering mellom tidsskivene er −0,117 m
   allerede uten kvantisering ved 1 t, og −0,576 m ved 3 t (§8.4). Fortegnet
   sikres av avrundingen; størrelsen av oppløsningen.
3. **Tidssteget er 1 t og skal ikke tynnes.** 3 t skjuler en hard forkastelse
   i frontsituasjon (§6.2) og river opp P90-halen i avgangsrangeringen (§6.3).
   Kravet gjelder alle felt som inngår i harde avvisninger — Hs og TWS — også
   hvis vind skulle leveres grovere. Mekanismen er tidsinterpolasjonens
   undervurdering av Hs-toppen: −0,117 m ved 1 t, −0,576 m ved 3 t, mot en
   fellemargin på 0,6 m.
4. **Vind lagres som u/v med skala/offset per flis**, ikke som fart + retning
   og ikke med én global skala (§5).
5. **Strøm leveres i kildeoppløsning i kystsonen** (NorKyst 800 m).
   Nedtynningskravet formuleres på strukturbredde: nodeavstand ≤ ¼ av den
   smaleste strømstrukturen pakken skal representere. En pakke som bare bærer
   tidevannets hovedkomponent er ikke et strømlag og skal merkes som
   manglende strømdata, ikke som strømdata (N2 — ærlig degradering).
6. **Deklarerte skranker regnes på de DEKODEDE verdiene.** `maxTwsKn` og
   `maxCurrentKn` går inn i A\*-feltets Vmax og gjør restestimatet admissibelt
   (`search.ts` §computeVmax). Kvantisering kan løfte dekodet verdi over
   kildens maksimum med inntil et halvt kvantiseringstrinn — målt til
   **+0,09 kn** for `W-UV8G`. Spec-en må kreve at produsenten enten regner
   maksimum etter dekoding, eller deklarerer kildens maksimum pluss et halvt
   trinn.
7. **Pakkens gyldighet er unionen av skivene den bærer**, og bbox-en er den
   der alle fire interpolasjonsnodene finnes. Grovere nett gir mindre dekning,
   og det skal stå i headeren — ikke skjules ved ekstrapolasjon.
8. **Flisstørrelsen er en del av formatet, ikke en implementasjonsdetalj.**
   Hele gevinsten ved 8-bit vind ligger i at skalaen er adaptiv per flis; med
   én global skala er samme bitdybde utilstrekkelig. Spec-en bør sette et tak
   (målt med 32×32 noder ≈ 80 × 80 km).

---

## 11. Forbehold — hva denne målingen ikke svarer på

1. **Motorens egen rutevalgsstøy er større enn de fleste
   kvantiseringseffektene.** På `skjaeloy-skagen-apent` fant `H-6G`s søk en
   rute som er 5,79 % *raskere* under sannheten enn den referansepakkens søk
   fant (14,41 t mot 15,29 t; 16 mot 17 steg; 4,34 t kryss mot 2,29 t). Det er
   et lodd i etikett-beskjæringen, ikke en egenskap ved 6-bit Hs. Konsekvens:
   **anger under ~2 % kan ikke tolkes** i denne målingen, og §4s støygulv
   gjelder. Flip-kriteriene (gjennomførbarhet, felle-sett, diskrete
   sikkerhetsfelt) er derimot ikke utsatt for denne støyen, og det er dem
   konklusjonene hviler på. At søket har en målt suboptimalitet på ~6 % på
   prosjektets referansestrekk bør uansett inn i motorens backlog.
2. **Den billige avgangsrangeringen (P2a) er et svakt instrument, og bør ikke
   brukes til formatbeslutninger.** Toppavgangen flipper selv for pakker som er
   strengt finere enn referansen (`T-30M`, `T-15M`), fordi kontrollruten velges
   nesten degenerert. Fulle søk per medlem (P2b) er stabile — men koster ~9×
   mer, og bare fem konfigurasjoner ble målt slik. De 24 øvrige har derfor
   **ingen** pålitelig rangeringsmåling; konklusjonene om dem hviler på P1
   (rutediff/anger) og P3 (flips).
3. **Feltene er syntetiske.** Pakkemodellen sampler analytiske funksjoner. En
   ekte MEPS-pakke starter allerede på et 2,5 km-nett — der finnes ingen
   `ANALYTISK`-kolonne, og romaksen betyr «hvor mye kan vi tynne det vi får»,
   ikke «hvor fint må feltet være». Kravene i §10 er formulert som *relativ*
   nedtynning nettopp derfor.
4. **Strøm er strukturelt undertestet.** S-3/S-5/S-7 har ingen strøm; S-8s bånd
   er 39 km bredt. Sondene i §7.2 er konstruert for anledningen og er ikke
   forhåndsregistrerte. Kravet om ¼-strukturbredde er en ekstrapolasjon fra tre
   båndbredder, ikke en måling på ekte NorKyst-felt.
5. **Marginene er fiksturartefakter.** At `m26` har 6,9 cm Hs-margin og `m29`
   0,6 m er egenskaper ved hvordan fiksturene ble konstruert. *Mekanismen* —
   at en kvantiserings- eller interpolasjonsfeil større enn marginen sletter
   forkastelsen — generaliserer; de spesifikke centimeterne gjør det ikke.
   Kravene i §10 er derfor formulert på fortegn og relativ størrelse.
6. **Feltsonden ser ikke fine strukturer.** 21×21-gitteret har ~10 km
   maskevidde og kan ikke oppløse frontfiksturens 10 nm vindstille-stripe.
   Kolonnene i §5 og §6 er kontekst, ikke bevis.
7. **Én geografi.** Alt er Skagerrak/Bohuslän. Ingen ekte skjærgårdstrøm, ingen
   Norskekyst-topografi, ingen tidevannssund.
8. **S-5-fiksturens forhåndsregistrerte toppavgang er metodeavhengig —
   viktig fordi fiksturen gjenbrukes** (lagt til 2026-09-02).
   `packages/routing/test-fixtures/ensemble-s5-departure.ts` har en
   forhåndsregistrert tabell med toppavgang **+3 t**, målt 2026-08-31 med
   kontrollrute-metoden (P2a-oppskriften: ett søk på kontrollfeltet, deretter
   evaluering av 30 medlemmer). Med **fullt Pareto-søk per medlem** (P2b) på
   det **samme, udegraderte** feltet peker vinduet på **+4 t**
   (14,403 / 14,378 / 14,293 / 14,289 / 13,842 for `ANALYTISK`). Begge tall er
   reprodusert bit-eksakt av harnessen (§2.4), og den siste raden er identisk
   med E1′-kjøringens S-5-rad for fasitvarianten. Ingen av dem er feil — de
   måler to forskjellige ting (rangering *gitt én delt plan* mot rangering
   *gitt at hvert medlem seiles optimalt*) — men konsekvensen er at
   «toppavgang +3 t» er en egenskap ved metoden, ikke ved feltet, og bare kan
   sammenlignes mot målinger gjort med samme metode. Forbeholdet er skrevet
   inn i fiksturfilen selv, siden den brukes av flere målinger enn denne.
   Kombinert med forbehold 2 (P2a er et svakt instrument, det flipper
   toppavgangen selv for strengt finere pakker): **bruk fullt søk per medlem
   når S-5 skal skille to varianter.**

---

## 12. Reproduksjon

```
pnpm --filter @morild/routing test          # inkl. pack-degradation.test.ts
npx tsc -b packages/routing                 # tools/ leser dist/
node tools/kvantisering/maaling.mjs --del p1,p2,p3
node tools/kvantisering/maaling.mjs --del p2b
node tools/kvantisering/maaling.mjs --del p3 \
  --konfig H-6G,H-6GO,H-8O --fikstur S-8,S-3 \
  --ut docs/research/kvantisering-raadata/tillegg-hs-avrunding
node tools/kvantisering/tabeller.mjs > tools/kvantisering/tabeller-2026-09-01.txt

# Tillegg §9.1 (helhetsmåling av den anbefalte konfigurasjonen), 2026-09-02:
node tools/kvantisering/maaling.mjs --del p1,p2,p3 \
  --konfig K-ANB-KYST,K-ANB-UTASKJAERS \
  --ut docs/research/kvantisering-raadata/tillegg-k-anbefalt
node tools/kvantisering/maaling.mjs --del p2b \
  --konfig K-ANB-KYST,K-ANB-UTASKJAERS \
  --ut docs/research/kvantisering-raadata/tillegg-k-anbefalt
node tools/kvantisering/maaling.mjs --del p2b --konfig R-2X \
  --ut docs/research/kvantisering-raadata/tillegg-k-anbefalt/attribusjon-5km
node tools/kvantisering/hs-trinn.mjs
node tools/kvantisering/tabeller.mjs \
  --inn docs/research/kvantisering-raadata/tillegg-k-anbefalt \
  > tools/kvantisering/tabeller-tillegg-k-anbefalt-2026-09-01.txt
```

Kjøretid på utviklingsmaskinen: P1 ≈ 12 min, P2a ≈ 6 min, P3 ≈ 10 min,
P2b ≈ 45 min. Alle tall i rådataene er deterministiske; kun konsollens
sekundangivelser er det ikke.
