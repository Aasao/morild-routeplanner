# Spike: NorKyst-geometri — naivt indeksvindu vs nearest-neighbour (2026-09-27)

Isolert geometri-spike, D14.3 (`docs/specs/vaerpakker.md` §18b pkt. 3–4).
Kjørt før produsentsiden i `tools/weather-pack` skrives, jf. rekkefølgen
vedtatt i D14.3 pkt. 4. Kode: `tools/spikes/thredds/05-norkyst-geometri-
compare.mjs` (frittstående, rører ikke `tools/weather-pack/src`,
`packages/` eller `apps/`). Rådata: `tools/spikes/thredds/out-05-norkyst-
geometry-compare.json`.

Kilde: `https://thredds.met.no/thredds/dodsC/fou-hi/norkystv3_800m_m00_be`
(samme LIVE «best estimate»-aggregering som tidligere spike 04). Sekvensielle
OPeNDAP-kall, `User-Agent: morild-routeplanner-spike/0.1 maasao@gmail.com`
(§16), ~0,6 s pause mellom kall.

## Metode

For hvert av de tre områdene (Drøbaksund 59,65°N/10,62°Ø, Hvaler
59,05°N/11,05°Ø, åpent Skagerrak-vann på ruten Skjæløy–Skagen 58,3°N/10,3°Ø):

1. **Lokalisering** (ny lærdom, se «Fella som ble funnet» under): nærmeste-
   punkt-søk (haversine, ikke bbox-containment) mot en grov, striden
   (stride 6×10) prøve av HELE NorKyst-domenet (1148×2747 noder), deretter
   et lokalt (geografisk sammenhengende) fullopplasnings-vindu på ±130
   native celler rundt treffet.
2. **Flisens indeksvindu**: `tileWin = findWindow(...)` innenfor DENNE
   lokale blokken, avgrenset til den 1°×1°-flisen `tileBounds()`
   (`tools/weather-pack/src/grid.ts`, `WEATHER_TILE_DEG = 1`) faktisk ville
   gitt for testpunktet — dvs. nøyaktig det indeksvinduet
   produksjonspipelinen ville hentet for denne bboxen.
3. **To oppslagsmetoder** for tre testpunkter per område (vest/midt/øst i
   flisen, samme breddegrad):
   - **Naiv** (`windLayerGeometry`-stil, `tools/weather-pack/src/
     pipeline.ts`): `latStepDeg=(north-south)/(yCount-1)`,
     `lonStepDeg=(east-west)/(xCount-1)`, `nearestIndex` fra flisens
     ANTATTE jevne rutenett. Dette er EKSAKT den funksjonen som allerede
     brukes for vind — testet her mot NorKyst-geometrien for å tallfeste
     hva som ville skjedd om den ble gjenbrukt uendret.
   - **NN**: brute-force nærmeste ekte node i det hentede vinduet, mot
     kildens egne 2D `lat`/`lon`-arrays (`values[y][x]`, IKKE 1D-akser).
4. Rådata (Int16, `_FillValue -32767`, `scale_factor 0.001`) sjekkes for
   fyll FØR avskalering (§D14.3-krav). Retning: `atan2(u_eastward,
   v_northward)` = strøm MOT, grader fra nord (samme konvensjon som
   spec/Oceanforecast, ingen vektorrotasjon — `eastward`/`northward` er
   allerede sann øst/nord, bekreftet i forrige bølge).
5. Lokal gridrotasjon: peiling fra native node `(y,x)` til `(y,x+1)` (dvs.
   kildegriddets egen "x-retning") relativt til sann øst, midt i hvert
   flisvindu ± et kvart vindu i y.

## Funn

### 1. Posisjonsfeil: naiv indeksvindu vs NN

| Område | Testpunkt | Naiv posisjonsfeil | NN posisjonsfeil |
|---|---|---:|---:|
| Drøbaksund | vest-i-flis | **33 911 m** | 355 m |
| Drøbaksund | midt-i-flis | **14 670 m** | 311 m |
| Drøbaksund | øst-i-flis | **39 219 m** | 285 m |
| Hvaler | vest-i-flis | **58 248 m** | 443 m |
| Hvaler | midt-i-flis | **62 309 m** | 391 m |
| Hvaler | øst-i-flis | **18 653 m** | 310 m |
| Skagerrak-åpent | vest-i-flis | **43 914 m** | 348 m |
| Skagerrak-åpent | midt-i-flis | **26 000 m** | 306 m |
| Skagerrak-åpent | øst-i-flis | **30 995 m** | 300 m |

Naiv metode: **14,7–62,3 km** feil (samme node ALDRI truffet i noen av de 9
testpunktene, `sameNode: false` gjennomgående). NN: konsekvent 280–450 m
(under en native cellediagonal på 800 m-gridet, som forventet — dette ER
riktig oppslag).

Dette gjelder for en 1° flis (`WEATHER_TILE_DEG`, samme flisstørrelse som
brukes for vind i dag) — NorKyst-gridets ~800 m nativoppløsning gjør at en
naiv jevn-fordeling over en hel breddegrad bommer med en størrelsesorden
som er 15–75× nodeavstanden. Selv med en MYE mindre flis ville feilen
skalere proporsjonalt med flisstørrelsen (samme rotasjonsmekanisme), så
"mindre flis" alene løser ikke problemet — det reduserer bare skadeomfanget,
det fjerner ikke den strukturelle bug-klassen.

### 2. Fart/retning: naiv vs NN der begge traff sjø

| Område | Testpunkt | Fartsdiff | Retningsdiff |
|---|---|---:|---:|
| Drøbaksund | midt-i-flis | 0,06 kn | **147°** |
| Skagerrak-åpent | vest-i-flis | 0,15 kn | 33° |
| Skagerrak-åpent | midt-i-flis | 0,21 kn | 32° |
| Skagerrak-åpent | øst-i-flis | **0,95 kn** | 34° |

I Skagerrak-åpent er dette et rent åpent-vann-strekk (lite fyll, se pkt. 3)
— retningsfeilen ligger stabilt rundt 32–34° (matcher gridrotasjonen, se
pkt. 4) i ALLE tre testpunktene, IKKE tilfeldig støy. Fartsdiff 0,95 kn ved
testpunktet lengst øst i flisen er stort i absolutt forstand for et
strømfelt som typisk ligger under 1–2 kn i Skagerrak — den naive metoden
ville ikke bare gitt feil retning, men kunne feilaktig doblet/halvert
anslått strømbidrag i en rutekalkulasjon.

I Drøbaksund/Hvaler er de fleste naive treff **FYLTE** (land/no-data, se
pkt. 3) — der er feilen enda mer alvorlig enn en vinkel-/fartsavvik: naiv
oppslag gir `undefined` (ingen strømdata i det hele tatt) et sted der ekte
sjø faktisk har strøm, i et av de trangeste og strømsterkeste sundene på
ruten.

### 3. Fyll-andel (land/`_FillValue`) i flisvinduet

| Område | Fylte celler | Totalt | Andel |
|---|---:|---:|---:|
| Drøbaksund | 15 230 | 17 424 | **87,4 %** |
| Hvaler | 11 193 | 17 689 | **63,3 %** |
| Skagerrak-åpent | 661 | 17 956 | 3,7 % |

Drøbaksund/Hvaler-flisene er dominert av land (skjærgård) — en 1°×1° flis
her dekker mye mer landareal enn sjø. Dette forsterker naiv-metodens
alvorlighetsgrad: i de fleste flisceller finnes det ingen gyldig
strømverdi i utgangspunktet, så et unøyaktig indeksoppslag har stor
sannsynlighet for å treffe land selv om testpunktet selv er midt i en
seilbar led. `_FillValue`-sjekk FØR avskalering fungerte som forventet
(rå `-32767` ble aldri avskalert til en falsk `-32,767 m/s`) — men
selve VALGET av hvilken node som spørres er det som svikter i naiv-metoden.

### 4. Lokal gridrotasjon (målt, ikke antatt)

| Område | Målt rotasjon (grid-x mot sann øst) |
|---|---|
| Drøbaksund | −59,0° til −59,8° (3 målinger) |
| Hvaler | −58,6° til −59,4° |
| Skagerrak-åpent | −59,3° til −60,1° |

Konsistent **~59–60°** i hele korridoren — stemmer med `docs/specs/
vaerpakker.md`s antakelse («sentralmeridian 70°Ø ⇒ ~60° gridrotasjon i
Skagerrak») og bekrefter at rotasjonen er lokalt stabil over det aktuelle
farvannet (ingen overraskende sprang mellom de tre områdene). Dette er
selve mekanismen bak feilen i pkt. 1–2: en 1° lat/lon-boks blir i det
native, ~60°-roterte gridet en SKEIV parallellogramform, ikke et rektangel
— `nearestIndex`s antakelse om at flisens (y,x)-akser følger lat/lon-aksene
er strukturelt feil for dette gridet (samme klasse feil som Lambert-
rotasjonsfellen for MEPS-vind, men her i selve GEOMETRIEN/indekseringen,
ikke i vektorkomponentene — `eastward`/`northward` trenger ingen
vektorrotasjon, kun riktig NODEVALG).

### 5. Depth-indeks for overflaten

**Bekreftet, ikke lenger antatt**: `depth[0] = 0.0` (m, `positive: "down"`)
— verifisert direkte fra en firehjørne-`.ascii`-probe av `depth`-arrayet.
Alle uttrekk i denne spiken brukte `depth`-indeks 0.

### 6. Domenets form (ny lærdom under veis — se «Fella» under)

Firehjørne-probe av hele NorKyst-domenet (1148×2747 noder):

| Hjørne | lat | lon |
|---|---:|---:|
| (y=0, x=0) | 54,29°N | 8,70°Ø |
| (y=0, x=2746) | 69,25°N | 37,55°Ø |
| (y=1147, x=0) | 57,34°N | −4,61°Ø |
| (y=1147, x=2746) | 75,73°N | 18,33°Ø |

Domenet er en lang, buet stripe langs hele norskekysten (Skagerrak til
Nord-Norge/Barentshavet), ikke en enkel rett rektangulær utsnitt — `y` og
`x` øker begge langs kystens forløp (krum bane), ikke langs uavhengige
lat/lon-akser.

## Fella som ble funnet underveis (metodisk, verdt å vite for neste spike)

Første forsøk lokaliserte flisvinduer med et rent **bbox-containment**-søk
(«er dette grovt striden punktet innenfor flisens padding?») over en
kombinert, striden (15×25) prøve av hele domenet. Dette ga et HELT FEIL
treff for Drøbaksund — vinduet som ble funnet dekket faktisk et annet,
sørligere kyststrekk (lat opptil 58,86°, ikke i nærheten av Drøbaksunds
59,65°N). Årsak: siden domenet er en lang buet stripe (pkt. 6), kan en
grovt striden bbox-containment-test plukke opp et koordinatpar med
overlappende lat/lon-rekkevidde et helt annet sted i indeksrommet — en
form for aliasing som er spesifikk for buede/ikke-rektangulære grid.
Fikset ved å bytte til **nærmeste-punkt-søk** (minimum haversine-avstand,
ikke boks-medlemskap) for grov lokalisering, etterfulgt av et lokalt,
geografisk sammenhengende finoppslag. Skrives ned her fordi den samme
fellen kan ramme en NAIV implementasjon av produsentsiden dersom noen
gjenbruker et bbox-filter-mønster fra et rektangulært grid (MEPS/Lambert
er langt mindre buet over Skagerrak-utsnittet) uten å teste det mot
NorKysts fulle, buede utstrekning.

## Anbefaling

1. **Nearest-neighbour mot kildens 2D `lat`/`lon`-arrays er obligatorisk**
   for NorKyst-strøm, ikke en forsiktighetsregel — den naive
   indeksvindu-forenklingen er MÅLT å gi 15–62 km posisjonsfeil, opptil
   147° retningsfeil og reelle land-treff i trange sund. Dette bekrefter
   D14.3s krav direkte med tall; ingen grunn til å vurdere unntak.
2. **Regrid til et regulært lat/lon-gitter i pakken** (produsentsiden i
   `tools/weather-pack`), bygget slik:
   a. Hent kildens `lat`/`lon` (2D) + `u_eastward`/`v_northward` for
      flisens indeksvindu (funnet via nærmeste-punkt-søk, se «Fella»
      over — IKKE bbox-containment på en grovt striden prøve).
   b. Masker `_FillValue` FØR enhver interpolasjon/nedtynning (§D14.3,
      allerede krav — bekreftet kritisk her siden 63–87 % av en kystnær
      flis kan være land).
   c. For hver ønsket regulær lat/lon-node i pakkeformatet: NN-oppslag
      (evt. bilineær mellom de 4 nærmeste native nodene som en senere
      forbedring, men NN er det verifiserte minimumskravet) mot det
      maskerte native gridet — ALDRI indeksaritmetikk på flisens bbox.
   d. Kystpåslag (2–3 celler fra kystlinjen, §D14.3): gitt at Drøbaksund/
      Hvaler har 63–87 % fyll i en 1°-flis, bør kystnær usikkerhet
      vurderes IKKE bare som et fast antall celler fra land, men som en
      egen, synlig degraderingstilstand i disse flisene spesifikt («trangt
      sund, 800 m-grid, posisjonsnøyaktighet ikke verifisert her» — teksten
      er allerede vedtatt i D14.3, denne spiken bekrefter at den bør
      utløses OFTE for disse to områdene, ikke som en sjelden randsak).
3. **Ingen indeksvindu-gjenbruk fra vind-pipelinen** for NorKyst i det
   hele tatt — `windLayerGeometry`/`sampleFromFetchedGrid` (`pipeline.ts`)
   må IKKE parameteriseres til å dekke strøm; skriv en egen, NN-basert
   funksjon for strøm fra bunnen av (egen fil, f.eks.
   `current-geometry.ts`), for å unngå at en fremtidig refaktorering
   fristes til å "gjenbruke" den vind-spesifikke, lat/lon-uniform-
   antakende koden.
4. **Lokaliseringsmønsteret** (nærmeste-punkt-søk → lokalt sammenhengende
   finoppslag) fra denne spiken bør gjenbrukes direkte i produsentsidens
   probe-logikk for NorKyst — det er allerede verifisert å unngå
   bbox-aliasing-fellen over det buede domenet.

## Gjenstår / uverifisert

- Kun 3 områder × 3 testpunkter (9 punkter totalt) — ett tidssteg, én
  kjøring. Ikke en statistisk fordeling av feilen over hele ruten eller
  over tid; tallene over er representative størrelsesordener, ikke en
  garantert øvre/nedre grense.
- Bilineær interpolasjon mot de 4 nærmeste native nodene (i stedet for
  ren NN) er IKKE testet her — ville redusert NN-feilen ytterligere (fra
  ~300–450 m til teoretisk under halve cellestørrelsen), men er vurdert
  som en senere forbedring, ikke et krav denne bølgen.
- Kystpåslagets eksakte celletall (2–3, jf. D14.3) er ikke kalibrert mot
  disse konkrete fyll-andelene her — anbefalingen i pkt. 2d over er en
  observasjon, ikke en tallfestet parameter.
