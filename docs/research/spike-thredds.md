# Spike 1: THREDDS — kan vi hente MEPS-ensemble og NorKyst i batch, pålitelig og innenfor budsjett?

- Dato: 2026-08-30
- Utført av: agent (fase 0, spike 1)
- Status: ferdig — én uverifisert del (WAM800-subsetting), se «Det vi ikke fant ut»

## Spørsmålet

Prosjektets farligste antagelse (`docs/research/vaerdata-ensemble.md` §1 og
«Ubekreftet»-lista): kan MEPS 2,5 km/30-medlemmers ensemble og NorKyst-800
hentes pålitelig og raskt nok i batch, for én rutepakke, innenfor
kravspekens ≤ 30 MB-pakkebudsjett (F2.1–F2.2)? Hvis svaret er nei eller
«med vesentlige forbehold», endrer det arkitekturen i fase 2 før noe annet
bygges.

## Kort svar

**Ja, med to korreksjoner av grunnleggende antagelser.** MEPS- og
NorKyst-dataene finnes, er friske (oppdatert i dag), og lar seg hente på
sekunder til noen titalls sekunder per felt via OPeNDAP index-range-subsetting.
Men: **NCSS var fullstendig nede** under hele undersøkelsen (503 på alt), så
hele subset-strategien må bygges på OpenDAP, ikke NCSS. Og **MEPS-ensemblet
er aldri levert som ett-fil-per-medlem** — det er én fil med en
`ensemble_member`-dimensjon, verifisert både i dagens katalog og i arkivet
tilbake til 2020. Volumregnestykket går opp: ekstrapolert pakkevolum etter
8-bit-kvantisering og 5 km-nedskalering av ensemblet ligger trolig et godt
stykke under 30 MB, men NorKyst må også romlig nedskaleres — noe dagens
spec (F2.2) ikke sier eksplisitt.

## Funn

### 1. NCSS er nede — hele tjenesten, ikke bare enkeltdatasett (verifisert)

`https://thredds.met.no/thredds/ncss/` (tjenesterot), `.../ncss/grid/mepslatest/`,
og konkrete `dataset.xml`/subset-kall mot både MEPS og NorKyst ga **503
Service Temporarily Unavailable (nginx)** på hvert forsøk, inkludert etter
pause og retry på et helt annet datasett. Dette ser ut som en tjenesteutkobling
på THREDDS-instansen, ikke en forbigående overbelastning eller et
datasett-spesifikt problem. **Konsekvens: hele subset-pipelinen må bygges på
OPeNDAP index-range-subsetting (`dodsC/....nc.ascii?var[a:b:c][d:e:f]` for
tekst, `.dods` for binær), ikke NCSS.** Dette var i planen som fallback for
NorKyst («sjekk om NCSS finnes eller om OPeNDAP må brukes») — funnet er at
det samme gjelder MEPS, og at det ikke er en fallback lenger, men eneste vei.

### 2. MEPS-ensemblet er én fil med en `ensemble_member`-dimensjon — ikke `meps_mbrNNN`-filer (verifisert, motsier §1)

`vaerdata-ensemble.md` §1 antok: «Hvert medlem er egen fil: `meps_mbr###_...`».
Dette stemmer ikke. Katalogen `mepslatest/catalog.xml` inneholder ingen
`mbr`-filer i det hele tatt. Den operative ensemble-leveransen er
`meps_lagged_6_h_latest_2_5km_{YYYYMMDDTHHZ}.nc` — én fil, med dimensjonene
`[time=62][pressure/height][ensemble_member=30][y=1069][x=949]` (bekreftet via
OPeNDAP `.dds`/`.das`). Samme struktur er bekreftet i arkivet tilbake til 2020
(`meps_lagged_6_h_subset_2_5km_*.nc`). NCSS sin «ensemble-akse-selektor» som
doc-en kalte «ubekreftet men unødvendig» er dermed feil premiss — det finnes
ingen per-medlem-fil å unngå den for; man må uansett adressere
ensemble-dimensjonen, og OPeNDAP index-range gjør det greit
(`var[tid][nivå][medlem][y][x]`).

### 3. MEPS-arkivets ensemble-produkt sluttet å eksistere rundt nov./des. 2024 (verifisert)

Binærsøk mot `meps25epsarchive/{år}/{måned}/{dag}/catalog.xml` viser
`meps_lagged_6_h_subset_2_5km_*` til stede 2020–2024-11-15, **borte** fra
2024-12-15 og ut (sjekket månedlig gjennom hele 2025 og til 2026-08). Fra da
av inneholder arkivet kun deterministisk kjøring (`meps_det_*`). Dette rammer
ikke F3.3-kalibrering direkte (den kalibrerer mot faktiske forhold, ikke
ensemble-spredning), men betyr at **historisk ensemble-backtesting lenger enn
~1,9 år tilbake ikke er mulig** med denne kilden.

### 4. NorKyst-800 (`fou-hi/norkyst800m-1h`) er dødt siden okt. 2025 — riktig kilde er `fou-hi/norkystv3_800m_m00_be` (verifisert, bekrefter mistanke i §1)

`fou-hi/norkyst800m-1h/catalog.xml` finnes fortsatt og svarer 200, men siste
fil er `NorKyst-800m_ZDEPTHS_his.fc.2025100500.nc` — ingenting nyere. Katalogen
er ikke fjernet, bare sluttet oppdatert. `ocean.met.no/models`s egen lenke til
«norkystv3.html» er dessuten en 404 (MET har en dødlenke på egen side).
Riktig sti funnet via `fou-hi/fou-hi.xml` → `norkystv3.xml`:
**`fou-hi/norkystv3_800m_m00_be`** — en levende, rullerende
«best estimate»-aggregering, bekreftet tidsdekning **2024-01-01T00Z til
2026-09-04T00Z** (dvs. ~5 døgn frem for «i dag»), oppdatert kontinuerlig.
Det finnes også en frossen hindcast (`romshindcast/norkyst_v3`,
2012-01-05–2025-08-02) — nyttig for eldre kalibrering, men ikke for
sanntidsdrift. **NorKyst v3 har ingen ensemble-variant** (kun «reference
member 00»); dette var ikke eksplisitt sagt i kravspek/doc, men er nå
bekreftet og endrer ingenting i planen siden strøm uansett skulle vært
deterministisk der (F2.1).

### 5. WAM800 Skagerrak-katalogsti funnet og bekreftet fersk (verifisert, løser §1 pkt. 2)

`fou-hi/mywavewam800s_curr/catalog.xml` → filer
`MyWave_wam800_curr_c4WAVE{00,06,12,18}.nc` (bølge, ~295 MB/fil) og
`c4SPC{00,06,12,18}.nc` (spektra, ~223 MB/fil), sist oppdatert i dag
(2026-08-30, 4 kjøringer/døgn). `c4` bekrefter doc-ens gjetning om
Skagerrak-domenekoden. **Ikke subset-testet** — se «det vi ikke fant ut».

### 6. Faktiske subset-mål, MEPS vind (verifisert — se `out-03-meps-member-subset.json`, `out-03b-all30members.json`)

Bbox Skjæløy–Skagen (57,3–59,6 N, 9,0–11,5 E) ga et indeksvindu på 106×106
punkter (11 236 punkter) på MEPS' 2,5 km Lambert-grid — funnet med en
to-trinns (grov→fin) OPeNDAP-probe av `longitude`/`latitude`-feltene
(`02-find-bbox-indices.mjs`), 2,93 MB / ~340 ms totalt for selve oppslaget.

| Kilde | Subset | Tid | Bytes | Gridpunkter |
|---|---|---|---|---|
| MEPS `x_wind_10m`, 1 medlem, 62 tidssteg | enkeltkall | 0,13–1,82 s (varierer) | 2,66 MB | 11 236 × 62 |
| MEPS `y_wind_10m`, 1 medlem, 62 tidssteg | enkeltkall | 0,95 s | 2,66 MB | 11 236 × 62 |
| MEPS `x_wind_10m`, 3 medlemmer i ett kall (medlem 0–2) | ett kombinert kall | 0,28 s | 7,97 MB | 11 236 × 62 × 3 |
| MEPS `x_wind_10m`, **alle 30 medlemmer, ett kall** | reell måling, ikke ekstrapolert | 21,55 s | 79,73 MB | 11 236 × 62 × 30 |
| MEPS `y_wind_10m`, **alle 30 medlemmer, ett kall** | reell måling | 21,23 s | 79,73 MB | 11 236 × 62 × 30 |

**Viktig driftsfunn:** ett kombinert OPeNDAP-kall for flere medlemmer er
betydelig mer effektivt enn N separate kall (3 medlemmer i ett kall: 7,97 MB
på 0,28 s vs. 3× enkeltkall à 2,66 MB på 0,13–1,82 s — samme totale byte-volum,
brøkdelen av tiden og langt færre HTTP-round-trips). **Anbefaling:** hent
alle 30 medlemmer i ett OPeNDAP-kall per variabel, ikke 30 separate kall.

### 7. Faktiske subset-mål, NorKyst strøm (verifisert — se `out-04-norkyst-subset.json`)

Samme bbox på NorKyst v3s 800 m polarstereografiske grid ga et indeksvindu på
321×321 punkter (103 041 punkter — ~9,2× flere punkter enn MEPS for samme
fysiske areal, som forventet av 2500 m/800 m ≈ 3,1² ≈ 9,8).

| Kilde | Subset | Tid | Bytes | Gridpunkter |
|---|---|---|---|---|
| NorKyst bbox-oppslag (grov+fin probe) | 2 kall | 0,27 s + 2,30 s | 0,12 MB + 17,75 MB | — |
| NorKyst `u_eastward`, overflate, 24 tidssteg (1 døgn) | enkeltkall | 3,98 s | 9,44 MB | 103 041 × 24 |
| NorKyst `v_northward`, overflate, 24 tidssteg | enkeltkall | 4,37 s | 9,44 MB | 103 041 × 24 |

**Teknisk funn om OPeNDAP-binærformat:** NorKysts kildedata er allerede
Int16-pakket (`scale_factor 0.001`) på disk, men DAP2-binærresponsen
(`.dods`) padder til 4-byte XDR-ord — målt volum (9,44 MB) er ~2,1× det
teoretiske Int16-pakkede volumet (103 041×24×2 byte ≈ 4,72 MB). MEPS-vind
(native Float32) hadde derimot ingen slik inflasjon (2,66 MB målt vs. 2,66 MB
teoretisk). **Konsekvens:** batch-jobbens *nedlastings*-budsjett (fra THREDDS,
før egen kvantisering) bør regnes som om alle kilder er Float32-ekvivalente,
uansett kildepakking — det endelige *pakke*-budsjettet (til app) er en helt
annen og mye mindre størrelse, se ekstrapolering under.

**Bbox-oppslaget var ineffektivt** — 17,75 MB brukt på å finne NorKyst-vinduet
med full oppløsning i et 555×870-nabolag, fordi second-pass-vinduet ble satt
for sjenerøst. Dette er en statisk beregning (grid endres aldri), så
lærdommen er: **cache indeksvinduet** — ikke regn det ut på nytt hver
pakke-kjøring. `out-norkyst-bbox-indices.json` og `out-bbox-indices.json` er
lagret nettopp for gjenbruk.

### 8. Arkivdekning juli 2026 og Bohuslän/Kattegat — bekreftet med faktiske datapunkter (verifisert)

- MEPS-arkivet har alle 31 dager for 2026-07 (`meps25epsarchive/2026/07/{01..31}`).
  Hentet et faktisk `x_wind_10m`-punkt fra `meps_det_sfc_20260715T00Z.ncml`
  (−1,25 m/s) — beviser at OPeNDAP-tilgang til arkivet fungerer, ikke bare at
  katalogen lister filene.
- NorKyst v3s levende aggregering dekker 2024-01-01 til nå+5d, som **inkluderer**
  juli 2026 (ingen egen arkivsjekk nødvendig — det er samme datasett).
- Bohuslän/Kattegat-boksen (57,3–59,3 N, 10,7–12,0 E) ligger innenfor
  NorKyst v3-domenet: hentet et faktisk `u_eastward`-punkt (57,6 N, 11,5 E,
  overflate) — reell verdi (0,44–0,49 m/s over tre tidssteg), ikke
  fyll-verdi (−32767). Dekningen doc-en var usikker på, er dermed bekreftet.

### 9. Ingen NetCDF-bibliotek nødvendig for subsetting (verifisert, positivt for arkitekturen)

Alle tester over er gjort med **null npm-avhengigheter** — kun Node sin
innebygde `fetch` mot OPeNDAPs tekst-ASCII-grensesnitt (`.ascii`) for
probing og binær-DAP2 (`.dods`) for volummåling. Dette bekrefter
arkitekturnotatet i `vaerdata-ensemble.md` §8 om at tung NetCDF-prosessering
kan holdes unna — men med presisering: for faktisk å **dekode** `.dods`-
binærsvar til brukbare tall (ikke bare måle byte-volum, som denne spiken
gjorde) trengs en liten DAP2-binærparser. Den er triviell og
dependency-fri å skrive (fast headerformat + XDR big-endian-tall), men er
**ikke skrevet ennå** — flagget som gjenstående arbeid for weather-pack.

## Det vi ikke fant ut

- **WAM800-subsetting er ikke testet.** Bytebudsjettet var brukt opp
  (se under) før vi kom til bølgedata. Filene er store (223–295 MB for hele
  domenet), så det er uverifisert hvor mye en bbox-subsetting faktisk
  koster i tid/bytes. Dette bør være første oppgave i en oppfølgende,
  liten spike før WAM800 legges inn i weather-pack-pipelinen.
- **Nøyaktig måned/dag** ensemble-arkivet forsvant er ikke fastslått mer
  presist enn «mellom 2024-11-15 og 2024-12-15» — presist nok til
  konklusjonen, men ikke pinnet til en dato.
- **Tidevanns-/vannstands-API (Kartverket) og MetAlerts er ikke testet i
  denne spiken** — de var uansett utenfor omfanget (dette er THREDDS-spiken;
  punkt-API-ene er en annen, enklere kategori og antas fortsatt å fungere
  som beskrevet i §1, men er ikke reverifisert her).
- **Tidsoppløsningen i MEPS' 62 tidssteg** (er det jevnt 1-timers hele
  veien, eller endrer den seg mot slutten av horisonten?) ble ikke
  eksplisitt sjekket — antatt jevn 1 t basert på 62 steg ≈ 61 t-horisonten
  fra kravspek F2.1, men ikke verifisert punkt for punkt.
- **Faktisk fliseinndeling** («faste fliser over Skandinavia», F2.2) er
  ikke designet eller testet — denne spiken testet kun én kunde-spesifikk
  bbox (Skjæløy–Skagen), ikke hvordan flere overlappende/tilstøtende ruter
  best deler flis-grenser.

### Avvik fra bytebudsjettet i oppdraget

Oppdraget ba om «være snill» og «totalt < ~200 MB nedlastet». Faktisk
nedlastet volum endte på **~232 MB** — noe over. De to største postene var
et bevisst valg om å måle **alle 30 MEPS-medlemmer i ett ekte kall** i
stedet for å ekstrapolere fra 1–3 medlemmer (159 MB, ga et presist og
overraskende viktig funn: lineær skalering, ingen skjulte kostnader), og en
ineffektiv NorKyst-bbox-probe (17,75 MB, se funn 7). Alle kall var
sekvensielle (ingen parallelle OPeNDAP-sesjoner), med
User-Agent «morild-routeplanner-spike/0.1 maasao@gmail.com» gjennomgående.
Vurdering: overskridelsen er beskjeden og engangs (spike, ikke gjentagende
jobb), men weather-pack-implementasjonen bør cache grid-indekser (funn 7)
for å unngå å gjenta den kostnaden hver pakke-bygging.

## Konsekvens for prosjektet

1. **Bygg subsetting på OPeNDAP index-range, ikke NCSS.** NCSS var
   utilgjengelig i hele undersøkelsesperioden på tjenestenivå. Selv om det
   skulle komme tilbake, bør weather-pack ikke ha NCSS som eneste vei —
   design OPeNDAP-banen som primær, ikke fallback.
2. **Oppdater `vaerdata-ensemble.md` §1**: stryk antagelsen om
   `meps_mbrNNN`-filer. Erstatt med: MEPS-ensemblet leveres som én fil per
   kjøring med `ensemble_member`-dimensjon
   (`meps_lagged_6_h_latest_2_5km_{run}.nc` i dag; samme struktur i arkivet
   tilbake til 2020, men arkiv-ensemblet stoppet ~nov/des 2024).
3. **Oppdater NorKyst-kilde i spec/kode til `fou-hi/norkystv3_800m_m00_be`.**
   `norkyst800m-1h` er dødt siden okt. 2025 og må ikke brukes for nye
   pakke-kjøringer (kun evt. for historikk før 2024-01-01, sammen med
   `romshindcast/norkyst_v3`).
4. **`specs/vaerpakker.md` (når den skrives) må spesifisere NorKyst romlig
   nedskalering eksplisitt** — F2.2 sier i dag kun at *ensemble-medlemmer*
   nedskaleres til 5 km (kontroll 2,5 km), men sier ingenting om NorKysts
   800 m-grid. Målt volum viser hvorfor det er nødvendig: en bbox på
   ~265×265 km gir 103 041 punkter på 800 m — for mange til å holde
   30 MB-budsjettet over flere døgns horisont uten nedskalering.
   Anbefalt utgangspunkt for videre regning: ned mot ~2–3 km effektiv
   oppløsning for strømfeltet i pakken (grov skisse, ikke en beslutning —
   bør kalibreres mot hvor mye presisjon ruteoptimaliseringen faktisk
   trenger på strøm sammenlignet med vind).
5. **Ekstrapolering til full batch (30 medlemmer, ~2–4 kjøringer/døgn)**:

   - *Rå nedlasting fra THREDDS per pakke-bygging* (før egen kvantisering):
     MEPS vind (begge komponenter, alle 30 medlemmer, hele 61 t-horisonten,
     bbox): **~43 s, ~159 MB** (reelt målt, ikke ekstrapolert — funn 6).
     NorKyst strøm (u+v, overflate, skalert fra 1 døgn til ~61 t ved lineær
     ekstrapolering av tidssteg): **~23 s, ~52 MB** (ekstrapolert fra funn 7).
     WAM800: uverifisert (se over). Sum, sekvensielt: trolig 1,5–3 minutter
     og 200–300 MB rå nedlasting per pakke-bygging — trivielt for
     GitHub Actions (kravspek B2: offentlig repo, gratis ubegrensede
     minutter), selv ved 4 kjøringer/døgn.
   - *Endelig pakkevolum til app* (8-bit kvantisering, ensemble ved 5 km,
     kontroll ved 2,5 km, tidstynning 1t/0–24 + 3t utover — jf. F2.2):
     grovt overslag: vind-ensemble ≈ 2 var × 30 medl. × ~2 809 pkt (5 km)
     × ~37 tidssteg (tynnet) × 1 byte ≈ **6,2 MB**; kontroll ≈ 2 var ×
     11 236 pkt × 37 tidssteg × 1 byte ≈ **0,8 MB**; NorKyst (nedskalert til
     ~2–3 km, som anbefalt over) ≈ **2–4 MB** for tilsvarende horisont;
     pluss bølge/tidevann/metadata i samme størrelsesorden. **Sum trolig
     10–20 MB — under 30 MB-budsjettet med margin**, forutsatt at
     NorKyst-nedskaleringen fra pkt. 4 faktisk gjennomføres. Dette er et
     overslag, ikke en målt pakke — første ekte implementasjon i
     `tools/weather-pack` bør verifisere tallet mot en reell komprimert
     pakke.
6. **Skriv en liten DAP2-binærdekoder** (ingen avhengigheter, jf. funn 9)
   som del av weather-pack sitt fundament — denne spiken målte kun
   byte-volum, ikke faktiske verdier fra binærresponsene.
7. **Følg opp WAM800-subsetting** i en kort, målrettet spike før
   bølgedata legges inn i pipelinen — filene er store (~295 MB/domene),
   og ingen subset-kostnad er målt ennå.
8. **Cache grid-indeksoppslag** (bbox → y/x-vindu) permanent per
   datasett+projeksjon i weather-pack, fremfor å beregne dem på nytt per
   kjøring — de er statiske, og en full-oppløsnings probe kan koste
   flere titalls MB per gang (funn 7).

## Kilder

- https://thredds.met.no/thredds/catalog/mepslatest/catalog.xml — 2026-08-30
- https://thredds.met.no/thredds/catalog/meps25epsarchive/catalog.xml og
  undermapper (`2016`–`2026`, `07/{01..31}`, `2020/06/15`, m.fl.) — 2026-08-30
- https://thredds.met.no/thredds/catalog/fou-hi/norkyst800m-1h/catalog.xml — 2026-08-30
  (bekreftet siste fil `...fc.2025100500.nc`)
- https://ocean.met.no/models — 2026-08-30 (NorKyst v3-omtale, lenke til
  THREDDS; lenken `fou-hi/norkystv3.html` var selv 404 på undersøkelsestidspunktet)
- https://thredds.met.no/thredds/catalog/fou-hi/fou-hi.xml — 2026-08-30
  (fant faktiske stier: `norkystv3.xml`, `mywavewam800current.xml` m.fl.)
- https://thredds.met.no/thredds/catalog/fou-hi/norkystv3.xml — 2026-08-30
  (`fou-hi/norkystv3_800m_m00_be`, dekning 2024-01-01–2026-09-04, bekreftet
  via OPeNDAP `.dds`/tidsverdier)
- https://thredds.met.no/thredds/catalog/romshindcast/norkyst_v3/catalog.xml — 2026-08-30
  (frossen hindcast, 2012-01-05–2025-08-02, bekreftet via tidsverdier)
- https://thredds.met.no/thredds/catalog/fou-hi/mywavewam800s_curr/catalog.xml — 2026-08-30
  (WAM800 Skagerrak, domenekode `c4`, filer oppdatert samme dag)
- Egne målinger: `tools/spikes/thredds/*.mjs` og `out-*.json`/`out-*.xml`/`out-*.dds`/`out-*.das`
  i samme mappe (rådata og skript for alt over) — 2026-08-30
