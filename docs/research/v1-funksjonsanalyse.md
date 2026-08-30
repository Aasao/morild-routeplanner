# V1-funksjonsanalyse: «Morild» værruter (C:\RoutePlanner)

> Skrevet 2026-08-30 som grunnlag for v2-kravspesifikasjonen.
> V1-kodebasen er FASIT og skal behandles som skrivebeskyttet referanse.

## Hva v1 er

Én selvstendig HTML-fil (`morild_weather_router.html`, ~94 KB, Leaflet + vanilla JS)
pluss en null-avhengighets Node-bro (`morild_bridge.js`) som kobler B&G Zeus
(NMEA 0183 over TCP) til appen. Bygget sommeren 2026 om bord i Dufour 41 «Morild».
Alt kjører i nettleseren; ingen backend. PWA-installerbar (manifest genereres runtime).

## Kjernefunksjonalitet

### Rutemotor (isokron + A*-akselerasjon)
- Isokron-søk med 6° kursoppløsning (60 kurser), tidssteg 30/60 min.
- Celle-pruning: numerisk cellenøkkel (~0,02°), beste ankomsttid per celle.
- Bautstraff: +90 s ved kursendring > 15°.
- Kjegle-begrensning rundt peiling start→mål (165° med land, 115° uten).
- **A*-akselerasjon:** vann-avstandsfelt fra målet (Dijkstra på 8-nabo-grid,
  kanter stengt av kystlinje, Float64 pga. avrundingsbug med Float32).
  Gir landbevisst underestimat + blindvei-eliminering. Feltet gjenbrukes
  på tvers av avganger (delt mellom workers).
- Øvre tidsgrense (Tub) fra grådig forhåndsrute → bound-pruning.
- Stagnasjonsvakt (80 steg uten forbedring → ærlig avbrudd), nodetak 140k.
- Kjøres i Web Worker (kildekode serialisert til Blob), fallback hovedtråd.
  Parallell avgangsanalyse over inntil 4 workers.
- Etterbehandling: konsolidering av ~like kurser (fjerner isokron-sagtann),
  direkte sluttetappe hvis mål ikke nådd, **sikkerhetsettersjekk** av hvert
  rutesegment mot landmasken uavhengig av ruteren.

### Båtmodell
- Ekte VPP-polarer for Dufour 41 (Felci Yacht Design): PTE og GTE,
  10 TWS-kolonner (4–30 kn) × 15 TWA-rader (36–180°), bilineær interpolasjon,
  lineær skalering under 4 kn TWS, avvikling 30–36° mot vinden.
- Cruising-faktor 0,70–1,00 (standard 0,90) — skalerer race-VPP til virkelighet.
- Bølge-derating (heuristikk): motsjø −9 %/m, tverrsjø −4,5 %/m, medsjø −2 %/m,
  gulv 45 %. Bruker bølgeretning når kjent, ellers vind-som-proxy.
- Motorseiling: under STW-terskel (std. 4 kn) brukes motorfart (std. 6,5 kn,
  Volvo D2-60F-estimat), forbruk l/t (std. 3,0), tank 250 l. Motortimer,
  liter og «Mot%» rapporteres.
- Harde grenser: maks TWS og maks Hs (node forkastes, ruten går rundt uvær).

### Værdata (alt klientside, gratis, nøkkelfritt)
- **Vind:** Open-Meteo forecast API, `best_match` (≈ MET Norway 1 km / ICON-EU
  i norske farvann), multi-punkt-kall (grid inntil 11×11 = 108 punkter,
  0,4°-oppløsning), timesverdier, inntil 16 dager.
- **Bølger + havstrøm:** Open-Meteo Marine API (Copernicus SMOC ~8 km,
  tidevann innbakt), inntil 7 dager. Best effort — feiler stille.
- Bilineær rom-interpolasjon + lineær tid-interpolasjon (U/V-komponenter,
  Float32Array per gridpunkt).
- Kjent svakhet: 8 km strømgrid er for grovt kystnært; dekker ikke alltid
  skjærgård. Ingen usikkerhets-/ensembledata.

### Landunngåelse
- OSM-kystlinje (`natural=coastline`) via Overpass (to endepunkter, retry),
  0,6°-fliser, throttling 350 ms, ny runde på feilede fliser.
- **Persistent flis-cache i IndexedDB** (1 års levetid) — andre kjøring i
  samme område laster ingenting.
- Douglas-Peucker-forenkling (adaptiv: eps økes til masken < 60k segmenter).
- Romlig hash-grid (0,05°-celler) med per-segment bbox for raske
  `crosses(p,q)`- og `near(p, nm)`-oppslag.
- Kystbuffer (min. avstand til land, std. 0,5 nm) — unntatt < 3 nm fra
  start/mål (havneanløp). Buffersvar caches per rutecelle.
- Ærlig degradering: delvis lastet maske → rød stiplet rute + eksplisitt
  advarsel; segmentkryss telles og varsles.
- **Kjent hovedhull: ser KUN kystlinje — ingen dybder, skjær eller grunner.**
  Appen sier eksplisitt: «ruteren ser ikke undervannsskjær/grunner – det gjør
  DU på kartlaget.» A*-feltet kan stenge passasjer < ~1,5 nm.

### Avgangsvindu-analyse (proto-robusthet)
- Kjører ruteren for avgang +0/+6/+12/+18/+24/+36/+48 t med delt værfelt og
  delt A*-felt, parallelt over workers.
- Per avgang: varighet, ETA, distanse, snitt/maks TWS, maks Hs, kryssandel
  (TWA < 60°), motortimer, liter. Beste avgang markeres; klikk laster den.
- Dette er kimen til v2s robusthetsvurdering — men v1 varierer bare
  avgangstid, ikke værusikkerhet.

### Live-integrasjon (bro + Signal K)
- `morild_bridge.js`: TCP-klient mot Zeus (NMEA 0183, output-only nettverk),
  parser RMC/GGA/VTG/HDT/HDG/VHW/MWV/MWD/DPT/MTW med checksum-validering.
- Sann vind prioritert: MWD direkte > MWV-T + heading > beregnet fra AWA/AWS
  + STW/SOG (vektortriangel).
- HTTP-API: `/live` (snapshot m/data-alder), `/track` (30 s-punkter, ring
  50k), server appen selv.
- **CSV-logg hver 5 s** til `logs/morild_YYYYMMDD.csv` — uavhengig av
  nettleser. Felt: pos, SOG, COG, HDT, STW, TWS/TWA/TWD, AWS/AWA, dyp, sjøtemp.
- App-side: posisjon + spor i kart, XTE mot planlagt rute, målt-vs-prognose
  vind (avvik flagges > 4 kn), «Revider rute herfra» (ny rute fra faktisk
  posisjon, avgang nå). Signal K (`/signalk/v1/api/vessels/self/...`) som
  fallback-kilde.

### Kart og eksport
- Bakgrunn: CARTO Voyager eller **Kartverket sjøkartraster WMTS**
  (`cache.kartverket.no/v1/wmts/.../sjokartraster/...webmercator`).
- Overlegg: OpenSeaMap sjømerker, kystlinjemaske, isokroner (fargegradient),
  strømkorridor langs ruten (grønn medstrøm / rød motstrøm, land maskeres via
  A*-feltet), bølge-/strømpiler på grid, «forhold per time» ved båtens
  faktiske posisjon/tid, live-lag.
- Tabeller: veipunkter, intervall-sammendrag (1/3/6 t, vektor-midlede
  retninger), fullskjerm-overlay med fontskalering (mobil).
- Eksport: GPX (`<rte>`), Web Share API → B&G-appen → Zeus (nærmeste mulige
  automatikk; Zeus-nettet er output-only).
- Enhetsvalg: vind i m/s (yr-konvensjon) eller kn; båtfart i kn eller m/s.

## Loggdata-arsenalet (kalibrering)

28 CSV-filer, **~218 000 rader** à 5 s fra 2026-07-04 → 2026-08-01
(Oslofjorden → Bohuslän → Kattegat, av filenes posisjoner å dømme).
- TWS/TWD/AWA/AWS: komplett i de store filene.
- **STW: mangler/0 i praksis (padlehjul ute av drift?)** → polar-kalibrering
  må bruke SOG − strømestimat, ikke STW.
- Dybde og sjøtemperatur logget hele veien.
Dette datasettet er gull for: kalibrering av cruising-faktor per TWA/TWS-bin,
validering av bølge-derating, og ettersyn av prognose-vs-målt vind.

## Styrker å videreføre i v2

1. Isokron + A*-felt-arkitekturen er gjennomtenkt og rask — behold algoritme-
   kjernen, porter til TypeScript med tester.
2. Ærlig degradering overalt (delvis kystlinje, manglende strømdata, mål ikke
   nådd) — dette er en designfilosofi, ikke en detalj.
3. Flis-cache-mønsteret (IndexedDB, innholdsnøkkel, retry) gjenbrukes for
   dybdedata.
4. Klientberegning i workers fungerer — server trengs som data-forbereder,
   ikke som beregningsmotor.
5. Bro/live-økosystemet (NMEA-parsing, XTE, målt-vs-prognose) er ferdig
   utviklet tankegods.
6. Avgangsvindu-tabellen er riktig UX-idé for robusthet — utvid dimensjonene.

## Hull v2 må tette

| # | Hull | Konsekvens i v1 |
|---|------|-----------------|
| 1 | Ingen dybde-/grunne-data | Ruter kan gå over skjær; bruker må selv verifisere mot kartlag |
| 2 | Én deterministisk prognose | Ingen usikkerhetsvurdering; rute kan være skjør for små værendringer |
| 3 | 8 km strømdata | Ubrukelig i skjærgård/sund; tidevannsstrøm feil dimensjonert |
| 4 | Ingen persistens av ruter/planer | Alt forsvinner med fanen (unntatt kyst-cache) |
| 5 | Ingen app-innpakning | Kjørte via lokal Node-bro / file:// |
| 6 | Monolitt uten tester | 2 400 linjer i én fil; alt verifisert manuelt |
| 7 | Polar ukalibrert mot logg | Cruising-faktor er slider-gjetning; 218k rader ubrukt |
| 8 | Ruteoptimering kun på tid | Ingen komfort-/sikkerhetsvekting |
