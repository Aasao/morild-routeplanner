# Forarbeid: strøm og bølger i værpakken («bolk 2»)

- Status: **forarbeid, ikke spec.** Grunnlag for en kommende revisjon av
  `docs/specs/vaerpakker.md` §4.2/§4.3/§7 pkt. 5/§8, men låser ingenting selv.
- Dato: 2026-09-27
- Skrevet av: vær-analytikeren, jf. D13.5 (`docs/specs/robusthet.md` §7) og
  ekspertpanelet `docs/research/ekspertpanel-d13-nettbrett-2026-09-27.md`
  §1.3/§3 (marin meteorolog: NorKyst delt referansemedlem, Oceanforecast
  punktbølge «ikke gridded», WAM800 utsatt).
- **Ingen kode kjørt eller endret i denne bølgen** — et måleprogram kjørte
  samtidig mot `vite dev` på samme maskin (instruks fra oppdraget). Alt
  under er lesing av eksisterende dokumenter/kode + direkte, tidsstemplede
  HTTP/OPeNDAP-oppslag mot MET sine egne tjenester (ikke mot repoet).

---

## 0. Sammendrag — det viktigste før detaljene

1. **Motorens forbrukskontrakt er allerede ferdig for strøm OG bølge.**
   `packages/routing`s `WeatherField.current()`/`waves()`,
   `packages/weather`s `CurrentLayers`/`WaveLayers`/`decodeCurrentAt`/
   `decodeWavesAt`/`toWeatherField`, og pakke-pekerens `PointerFieldEntry`
   (`field: "current" | "waves"`) er alle skrevet, typet og enhetstestet —
   se §2. **Det er PRODUSENT-siden i `tools/weather-pack` som mangler**
   (ingen NorKyst-/Oceanforecast-henting finnes i `pipeline.ts` i dag),
   ikke motoren. Dette er en vesentlig lettere oppgave enn å bygge et nytt
   felt fra bunnen.
2. **Kritisk, verifisert funn (ikke i noe eksisterende dokument):**
   **Oceanforecast 2.0s faktiske JSON-respons har INGEN bølgeperiode-felt.**
   Verifisert med et rått, tidsstemplet `curl`-kall mot
   `api.met.no/weatherapi/oceanforecast/2.0/complete` 2026-09-27 (se §3.2)
   — `details`-objektet inneholder nøyaktig fem nøkler:
   `sea_surface_wave_from_direction`, `sea_surface_wave_height`,
   `sea_water_speed`, `sea_water_temperature`, `sea_water_to_direction`.
   **Ingen `tp`/periode-felt finnes i det hele tatt**, verken under det
   navnet eller noe annet. Dette står i direkte spenning med
   `docs/00-kravspek.md` F2.1 («MET Oceanforecast/WAM800 for bølger **med
   periode!**») og `docs/specs/vaerpakker.md` §4.3 («Krever periode, ikke
   bare Hs»). Se D14.1 — dette er det viktigste beslutningspunktet i dette
   dokumentet.
3. **Oceanforecast gir også strøm i punktform** (`sea_water_speed`,
   `sea_water_to_direction`) — ikke bare bølge. Ikke en erstatning for
   NorKyst (grovere, ingen gridded flate), men et gratis, allerede-hentet
   kryssjekk-datapunkt langs samme kall som henter bølge (§3.2).
4. **Punktbølge passer strukturelt dårlig inn i dagens gridded
   Layer-/kvantiserings-maskineri** (`WaveLayers` er bygget for
   `LayerLookup`, altså et rutenett). §7 pkt. 5 sier «punktbølge langs
   korridoren», men F2.2s faste-fliser-prinsipp («ikke on-demand per
   rute») og punkt-APIets natur (ett lat/lon-kall per punkt, ikke en
   flate) trekker i hver sin retning. Anbefaling: behandle punktbølge som
   tidevann (§4.4) — en egen, ikke-gridded, worker-proxy-vei, ikke en del
   av R2-batch-pipelinen. Se D14.2.
5. **NorKyst er verifisert (ikke bare antatt) i dag, med nye konkrete
   feller** utover det som allerede sto i agent-minnet: kilden er selv
   **Int16-pakket** (`scale_factor 0.001`, `_FillValue -32767`) på et
   **polart stereografisk grid** — se §3.1 og felle-listen §6.

---

## 1. Hva som allerede er besluttet (lest, ikke gjentatt i detalj)

- `docs/specs/vaerpakker.md` §4.2: NorKyst 800 m i kystsonen / 1,6 km
  utaskjærs, medlemsuavhengig delt referanse (`fou-hi/norkystv3_800m_m00_be`,
  «reference member 00», ingen ensemble). §9.4: kystsone-definisjon (≤ 20 nm
  fra kystlinjevektoren, samme 32×32-subflis-grid som vind).
- §4.3: bølge krever periode for `packages/polar`s Hs/Tp²-bratthetsklasse;
  mangler Tp der Hs finnes → `waves().tpS = undefined`, konservativ
  Hs-only-derating med eget flagg (allerede designet som en **leilighetsvis**
  degradering — se D14.1 for hvorfor «alltid, strukturelt» er noe annet).
- §7 pkt. 5: WAM800-subsetting utsatt; Oceanforecast punkt-API er **vedtatt
  gyldig førsteleveranse** for bølge med periode — men periode-feltet
  eksisterer altså ikke i praksis (§3.2, §0 pkt. 2).
- §8: budsjett-tabellen har strøm/bølge som **placeholder**
  («2–4 MB grov skisse», «samme størrelsesorden som strøm») — ikke målt,
  og skrevet **før** 1°-flisbyttet (§19, 2026-09-04). Tallet er ikke
  reverifisert mot 1°-geometrien for noe annet enn vind.
- §9.5: strøm har **ingen monoton konservativ avrundingsretning** — vernet
  er oppløsning + N5, ikke en Hs-aktig opp/ned-regel. Gjelder uendret her.
- §9.6: NorKyst får **egne, mindre kystfliser (0,5°–1°)**, ikke gjenbruk av
  vindens 1°-subfliser — en egen geometri som ikke er bygget i kode ennå
  (`grid.ts::classifyCoastalZone` tar imot en injisert avstand; selve
  chart-pack-oppslaget er ikke koblet inn, jf. README).
- ADR-0005: `WeatherField.current()`/`waves()` er allerede del av
  grensesnittet én per medlem peker på; strøm er delt read-only på tvers av
  medlemmer (medlemsuavhengig, ikke værUAVHENGIG — presiseringen står i §4.2).
- `docs/decisions/ADR-0005` og §9.8 (kravspek/ADR): medlem med
  `coverage.weather = "partial"` telles **inkonklusivt**, aldri
  gjennomførbar/ugjennomførbar. §19 (5) i vaerpakker.md fant at en
  vind-only-pakke gjør ALLE medlemmer «partial» fordi
  `environmentAt` krever både `waves` og `current` definert — dette er
  **fortsatt sant** og forklarer hvorfor D13.5 (strøm/bølge før flere
  målinger) er riktig prioritert: uten strøm+bølge er ethvert
  gjennomførbarhets-/robusthetstall fra ensemblet meningsløst per dagens
  kode, ikke bare «mindre presist».
- `tools/weather-pack/README.md` «Hva som IKKE er wiret opp»: bekrefter at
  strøm/bølge/tidevann/MetAlerts deler stegmønsteret
  (`FetchLike → dap2 → quantize → package-writer`) med vind, men at **kun
  vind faktisk er koblet sammen**. Advarselen der («NorKyst er trolig m/s,
  ikke knop») er nå **bekreftet, ikke lenger «trolig»** — se §3.1.

---

## 2. Motorens forbrukskontrakt — allerede klar, verifisert ved lesing av kode

**`packages/routing/src/contracts.ts`** (`WeatherField`):

```ts
export interface CurrentSample {
  readonly u: number; // MOT-retning, komponent mot øst, knop
  readonly v: number; // MOT-retning, komponent mot nord, knop
}
current(lat: number, lon: number, epochS: number): CurrentSample | undefined;
waves(lat: number, lon: number, epochS: number): WaveSample | undefined;
```

Dette er **allerede kalt** fra `packages/routing/src/expand.ts` (linje ~114,
`NodeEnvironment.current`) — ruteren *bruker* strøm og bølge i hver node i
dag, den får bare `undefined` fordi ingen pakke leverer feltene ennå.

**`packages/weather/src/field.ts`** har ferdige, testede dekodefunksjoner:

- `CurrentLayers { u: LayerLookup; v: LayerLookup }` og
  `decodeCurrentAt(layers, lat, lon, epochS): CurrentSample | undefined`
  — dekoder **komponenter direkte**, ingen `atan2` noensinne (kommentaren i
  koden siterer nøyaktig §3s regel om at strøm aldri konverteres til
  fart+retning).
- `WaveLayers { hs: LayerLookup; tp?: LayerLookup; dir?: LayerLookup }` og
  `decodeWavesAt(...)` — implementerer allerede §12s regel (`hsM`
  mangler → hele resultatet `undefined`; `tp`/`dir` mangler individuelt →
  feltene utelates fra det returnerte objektet, ikke satt til en gjettet
  verdi).

**`packages/weather/src/weather-field-adapter.ts`** (`WeatherPackage`,
`toWeatherField`) har **allerede** feltene `current?: CurrentLayers` og
`waves?: WaveLayers`, og bygger `wind()`/`waves()`/`current()`-metodene på
`WeatherFieldLike` fra dem — `waves()` er dessuten bevisst **uavhengig** av
vindens `validToS`/48t-medlemsgrense (kommentar: «bølgelaget kan ha sin egen,
uavhengige dekning»).

**`tools/weather-pack/src/package-writer.ts`** (`PointerFieldEntry.field:
string`, kommentert `"wind" | "current" | "waves" | ...`) er allerede
generisk over feltnavn, og `PointerMissingFieldEntry` (§12/N2) er allerede
skrevet for akkurat «strøm/bølge mangler i denne flisen».

**Konklusjon:** det finnes **ingen kjent motor-/dekodingsendring** som må
gjøres for at strøm og gridded bølge skal virke — kontrakten venter allerede.
Det eneste stedet dette IKKE stemmer er punktbølge (§0 pkt. 4, D14.2): en
punktliste passer ikke inn i `WaveLayers`/`LayerLookup` uten enten (a) en
ny, enkel «point-field»-implementasjon av `waves()` som ikke bruker
`Layer`-maskineriet i det hele tatt, eller (b) å tvinge hvert punkt inn som
en absurd 1×1-nodes «flis» (anbefales ikke — overkompliserer noe som
naturlig er en oppslagstabell).

---

## 3. Datakilder — verifisert vs. antatt

### 3.1 NorKyst v3 — strøm (THREDDS/OPeNDAP)

**Verifisert i dag (2026-09-27), direkte mot kilden — ikke bare gjenbruk av
2026-08-30-spikens tall:**

```
curl .../fou-hi/norkystv3_800m_m00_be.das
```

```
u_eastward {
    String units "meter second-1";
    String standard_name "eastward_sea_water_velocity";
    String grid_mapping "projection_stere";
    Int16 _FillValue -32767;
    Float32 add_offset 0.0;
    Float32 scale_factor 0.001;
}
v_northward { ... samme mønster, standard_name "northward_sea_water_velocity" ... }
projection_stere {
    String grid_mapping_name "polar_stereographic";
    Float64 straight_vertical_longitude_from_pole 70.0;
    Float64 latitude_of_projection_origin 90.0;
    Float64 standard_parallel 60.0;
    ...
}
```

```
curl .../fou-hi/norkystv3_800m_m00_be.dds
```

```
Float64 time[time = 23999];
Grid { Int16 u_eastward[time=23999][depth=15][Y=1148][X=2747]; ... }
Grid { Int16 v_northward[time=23999][depth=15][Y=1148][X=2747]; ... }
Grid { Float64 lon[Y=1148][X=2747]; }   // 2D lat/lon-arrays finnes, indeksjustert med u/v
Grid { Float64 lat[Y=1148][X=2747]; }
```

- **Enhet: m/s, verifisert** (`units "meter second-1"`). Spec/kode må
  konvertere til knop (`3600/1852`), akkurat som vind — README's advarsel
  var korrekt.
- **`standard_name` er `eastward_sea_water_velocity`/
  `northward_sea_water_velocity` — SANN øst/nord, ikke griddrelativt.**
  Dette er en vesentlig forskjell fra MEPS' `x_wind_10m`/`y_wind_10m`
  (griddrelative, krever Lambert-rotasjon). **NorKyst trenger ingen
  vektor-rotasjon** — komponentene er allerede i geografiske retninger. Det
  som likevel må håndteres er **hvilken kildecelle** som representerer et
  gitt lat/lon (grid-oppslag, ikke retningsrotasjon) — se neste punkt.
- **Grid: `projection_stere` (polar stereografisk), IKKE et regulært
  lat/lon-rutenett** — bekrefter spikens funn («polarstereografisk grid»).
  Datasettet eksponerer imidlertid egne 2D `lat`/`lon`-arrays
  indeksjustert med `u_eastward`/`v_northward` (`Y×X = 1148×2747`), så et
  nøyaktig lat/lon-oppslag per kildeindeks er mulig **uten** å selv
  implementere den stereografiske proj/inv-transformasjonen — samme
  mønster som MEPS-håndteringen (indeksvindu-probe, permanent cache, §7
  pkt. 1), ikke en ny algoritmiklasse. **Ekte reprojeksjon til subflisens
  regulære lat/lon-grid er likevel IKKE gjort noe sted i dag** (samme
  erkjente forenkling README allerede beskriver for vind — «det hentede
  indeksvinduet behandles som om det ER et jevnt lat/lon-rutenett»); å
  arve akkurat den forenklingen for NorKyst er en bevisst, ikke en ny,
  gjeld — men feilstørrelsen er uverifisert for NorKysts finere,
  brattere polarstereografiske celler nær 800 m.
- **Kildedata er selv Int16-pakket** (`scale_factor 0.001`,
  `_FillValue -32767`) — se felle-liste §6, punkt 1: dette er en
  OPeNDAP-servers EGEN kvantisering, adskilt fra og FØR vår egen 8-bit
  kvantisering (§9.1).
- **Depth-dimensjon:** `u_eastward`/`v_northward` har en `depth[depth=15]`
  akse — spec sier «overflatestrøm, øverste dybdelag»; verifisert at
  overflatelaget faktisk er en indeks (trolig `depth=0`, ikke sjekket
  eksakt hvilken retning `depth`-aksen løper i denne filen — «positive
  down» sto på en annen variabel (`depth`), ANTA øverste = indeks 0, men
  verifiser eksplisitt før produksjon).
- **Ensemble: bekreftet ingen** — kun denne ene, deterministiske
  «best estimate»-strømmen (`_m00_be` i navnet er nettopp «member 00, best
  estimate»). Konsistent med §4.2/ADR-0005.
- **Domenestørrelse:** 1148×2747 noder, hele rullerende arkivet er `time =
  23999` (fra 2024-01-01 og fremover — IKKE per-kjøring, det er en
  kontinuerlig aggregering). Indeksvindu må beregnes mot **denne** tidsaksen
  (samme prinsipp som MEPS' grid-indeks-cache, men NorKysts tidsakse er
  selv en løpende akkumulering, ikke en ny fil per kjøring — annerledes
  cache-invalideringslogikk enn MEPS' `.grid-index-cache.json`, som er
  nøkkel-basert på kjøringsnavn).
- **Horisont: ~5 døgn rullerende**, bekreftet konsistent med tidligere
  spike og legal-dokumentet (`2024-01-01 → nå+5 døgn`).

### 3.2 MET Oceanforecast 2.0 — bølge (og punktstrøm) via api.met.no

**Verifisert i dag (2026-09-27) med et RÅTT `curl`-kall (ikke
AI-oppsummert dokumentasjon alene — dokumentasjonssiden ble også lest, men
den faktiske JSON-en er sannheten her):**

```
curl -A "morild-routeplanner-research/0.1 maasao@gmail.com" \
  "https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=57.7&lon=11.2"
```

```json
{
  "properties": {
    "meta": { "updated_at": "2026-09-27T09:08:38Z",
      "units": {
        "sea_surface_wave_from_direction": "degrees",
        "sea_surface_wave_height": "m",
        "sea_water_speed": "m/s",
        "sea_water_temperature": "celsius",
        "sea_water_to_direction": "degrees"
      }
    },
    "timeseries": [
      { "time": "2026-09-27T11:00:00Z",
        "data": { "instant": { "details": {
          "sea_surface_wave_from_direction": 240.8,
          "sea_surface_wave_height": 0.6,
          "sea_water_speed": 0.3,
          "sea_water_temperature": 15.8,
          "sea_water_to_direction": 328.7
        }}}}, ... ]
  }
}
```

**Funn:**

1. **Ingen bølgeperiode i det hele tatt.** `details`-objektet har nøyaktig
   fem nøkler, alltid de samme gjennom hele 205-elements tidsserien som ble
   hentet. Ingen `tp`, `sea_surface_wave_period`,
   `sea_surface_wave_mean_period`, `sea_surface_wave_zero_upcrossing_period`
   eller lignende. Datamodell-dokumentasjonen (`docs.api.met.no/doc/
   oceanforecast/datamodel`) nevner heller ikke periode blant sine
   dokumenterte felt. **Dette er det viktigste avviket fra
   `docs/specs/vaerpakker.md` §4.3 og kravspekens F2.1 i hele dette
   forarbeidet — se D14.1.**
2. **Bølgeretning er FRA** (`sea_surface_wave_from_direction`, meteorologisk
   konvensjon) — stemmer med §3-tabellens krav. **Strøm er MOT**
   (`sea_water_to_direction`, oseanografisk konvensjon) — stemmer også,
   samme konvensjonspar som NorKyst.
3. **Punktet leverer OGSÅ strøm** (`sea_water_speed`/`sea_water_to_direction`)
   — grovere og punktbasert, ikke en erstatning for NorKysts gridded flate,
   men et gratis kryssjekk-datapunkt langs samme kall (nyttig for en
   fremtidig byggetids-sanity-sjekk av NorKyst-nedtynningen, samme idé som
   §9.4s byggetids-verifisering).
4. **Horisont: ~8,5 døgn, time-oppløsning gjennomgående** (205 tidssteg,
   27/9 kl. 11 → 5/10 kl. 23 i denne hentingen) — god margin utover MEPS'
   61–66 t og NorKysts ~5 døgn.
5. **Cache-vindu kort:** responsens `Expires`-header lå ~32 minutter foran
   `Last-Modified` i denne hentingen — kort, men ikke urimelig for en
   worker-proxy med `If-Modified-Since`/ETag (§16-mønsteret er allerede
   skrevet for MetAlerts/proxyen, samme mønster gjenbrukes direkte).
6. **Sjøtemperatur følger med gratis** (`sea_water_temperature`) — ikke
   etterspurt av noen spec i dag, ikke noe å bygge mot, bare notert.

### 3.3 WAM800 — bevisst ikke undersøkt videre her

Uendret fra §7 pkt. 5/§18 pkt. 1: subsetting fortsatt uverifisert, egen
spike anbefalt separat. **Ny relevans etter D14.1:** hvis Oceanforecast
mangler periode strukturelt (ikke bare leilighetsvis), er WAM800-gridded
(eller et annet periodefelt) det eneste kjente alternativet for ekte
periode-data — dette hever WAM800-spikens prioritet fra «rask
oppfølging når pipelinen for øvrig kjører» til et reelt input til D14.1s
beslutning, uten at denne bølgen selv kjører spiken.

---

## 4. Vilkår (docs/legal/)

**Begge relevante filer finnes allerede og dekker kildene eksplisitt** —
ingen ny fil trengs:

- `docs/legal/met-norway-thredds.md` nevner **NorKyst v3** ved navn
  (`fou-hi/norkystv3_800m_m00_be`) som en av tjenestene THREDDS-vilkårene
  gjelder for, inkl. arkivdekning (§ «Arkivpolitikk»-tabellen har en egen
  rad for NorKyst v3). Sekvensiell-kall-kravet, UA-anbefalingen og
  backoff-disiplinen gjelder identisk for et fremtidig NorKyst-kall som for
  MEPS.
- `docs/legal/met-norway-api.md` nevner **Oceanforecast 2.0** eksplisitt ved
  navn i første avsnitt, inkludert at den brukes «som gyldig
  førsteleveranse for bølge m/periode inntil WAM800-grid er verifisert» —
  denne teksten bør oppdateres i en fremtidig revisjon i lys av D14.1 (den
  antar fortsatt at periode faktisk leveres), men selve **vilkårsdekningen**
  (UA, 20 req/s, caching, koordinatpresisjon 4 desimaler, mobil-
  overpollingsforbud) er allerede skrevet og gjelder Oceanforecast likt med
  Locationforecast/MetAlerts — samme api.met.no-vilkårssett.
- **Ingen ny vilkårsfil trengs for denne bølgen.** Det eneste
  oppdateringsbehovet er en presisering i `met-norway-api.md` når/hvis
  D14.1 avgjøres (én setning, ikke et nytt dokument).

---

## 5. Anslag (merket tydelig — ingen av disse er målt)

### 5.1 Pakkestørrelse, strøm (NorKyst) på de seks eksisterende 1°-flisene

Utgangspunkt: dagens seks vind-fliser (`10_57`,`11_57`,`10_58`,`11_58`,
`10_59`,`11_59`, §19 2026-09-04) har 45–46 × 25–27 noder ved 2,5 km. NorKyst
skal etter §9.4/§9.6 leveres på **egen, finere kystflisgeometri** (0,5–1°,
800 m i kystsonen), ikke gjenbruke vindens 1°-subfliser direkte — så et
ekte flisregnskap for strøm krever at §9.6s kystflis-geometri faktisk bygges
først. Som et **grovt, øvre** anslag for planlegging (ANTAR hele
Skjæløy–Skagen-korridoren regnes som kystsone, 800 m, verste fall):

- 1° ≈ 111 km; ved 800 m gir det ≈ 139×139 noder per fullstendig
  1°×1°-kystflis.
- 2 variabler (u, v) × ~139×139 noder × ~65 tidssteg (0–66 t, 1 t,
  kontrollens fulle horisont — strøm har ingen medlemsgrense siden det ikke
  er noe medlem) × 1 byte ≈ **2,5 MB per flis, rått**.
- × 6 fliser ≈ **~15 MB rått**, FØR delta/gzip. Basert på §19s funn at ekte
  atmosfærisk (og trolig ekte oseanografisk) data komprimerer nær **1,0–1,1×**
  med dagens delta+gzip-skjema (IKKE det syntetiske feltets 7,3×), er et
  realistisk anslag **~13–16 MB** for strøm alene over disse seks flisene —
  størrelsesordenen «betydelig, ikke ubetydelig» i et 30(–50) MB-budsjett
  som allerede er presset av vind alene (27,4 MB målt for vind, §19 (4)).
- **Dette tallet er sannsynligvis for høyt** hvis en vesentlig andel av
  korridoren faktisk klassifiseres «utaskjærs» (1,6 km, en fjerdedel så
  mange noder) — men andelen er ukjent før §9.6s kystflis-/klassifiserings-
  kode faktisk kjøres mot ekte kystlinjedata. **Ikke en budsjettgaranti,
  bare et startpunkt for hvorfor §17 pkt. 7s reverifisering haster her óg.**

### 5.2 Pakkestørrelse, punktbølge (Oceanforecast)

Uavhengig av forrige avsnitt hvis D14.2 (§ under) legger punktbølge utenfor
R2-batch-pipelinen: 5 felt × ~8 byte (tall) × ~65–205 tidssteg × N punkter.
For N = 10–20 korridorpunkter og 66 t horisont (matchet mot MEPS, ikke
Oceanforecast's fulle 8,5 døgn): **10–20 punkter × 5 felt × 67 tidssteg ×
~10 byte JSON-overhead ≈ 35–70 KB** — trivielt i ethvert budsjett, og
uansett IKKE en del av 30 MB-regnestykket hvis det leveres som JSON via
proxy (samme størrelsesorden som tidevann/MetAlerts, §8-tabellens «< 0,1 MB»-
rad, ikke strøm/bølge-radene).

### 5.3 Byggetid i cron (sekvensielle kall, §16)

Spikens NorKyst-mål (2026-08-30): `u_eastward` og `v_northward`, hver
~4 s for 24 tidssteg over et 103 041-punkts helt-domene-vindu — et vesentlig
STØRRE uttrekk enn en enkelt 1°-kystflis vil være. For seks fliser × 2
variabler, med den samme «vilt varierende fetch-tid»-erfaringen som MEPS
(0,4–34,6 s per flis, agent-minnet), er et grovt anslag **1–5 minutter
ekstra**, sekvensielt, lagt til dagens cron-kjøring — ikke en showstopper for
et 3-timers cron-intervall, men bør måles ved første `build-live`-kjøring med
strøm koblet inn, ikke antas. Oceanforecast-punktkall, HVIS de fortsatt
kjøres i batch-jobben (D14.2 kan fjerne dem derfra helt), er hver et lite,
raskt punkt-JSON-kall (< 1 s typisk for api.met.no) × N punkter — sekunder,
ikke minutter.

### 5.4 Motorendringer (oppsummert fra §2)

**Ingen** i `packages/routing`. **Ingen** i `packages/weather`s
gridded-dekodingsvei for strøm (alt finnes). For gridded bølge: samme —
`WaveLayers`/`decodeWavesAt` er klare. For **punktbølge** derimot: en ny,
liten, ren funksjon trengs et sted (trolig `apps/pwa` eller en ny liten fil
i `packages/weather`) som bygger en `waves()`-implementasjon fra en liste
punkter + tidsserier (nærmeste punkt + lineær tidsinterpolasjon, ANALOG til
men IKKE samme kode som `LayerLookup`s bilineære romlige interpolasjon —
punkter har ingen naboer å interpolere romlig mellom). Dette er ny kode,
men liten og isolert; ingen endring i `WeatherField`-kontrakten kreves siden
`waves()`-signaturen allerede er punkt-i-rom-og-tid, ikke grid-spesifikk.

---

## 6. Felle-liste

1. **NorKyst er selv Int16-pakket med `_FillValue -32767`, `scale_factor
   0.001`.** En pipeline som leser rå Int16 og multipliserer med
   `scale_factor` FØR den sjekker `== -32767` vil regne land-/no-data-celler
   som en gyldig, absurd **−32,767 m/s** strøm (≈ −63 700 knop) — akkurat
   den typen feil som stille ville ha ødelagt `computeObservedMaxSpeedKn`/
   `maxCurrentKn` (som IKKE har noen konservativ retning å falle tilbake på,
   §9.5). Sjekk `_FillValue` FØR avskalering, alltid.
2. **Enhet: NorKyst er m/s, verifisert (ikke lenger «trolig»).** Samme felle
   som traff vind (§19 (4)) — konverter til knop eksplisitt, test med kjente
   par, ikke stol på at et «nytt felt» arver riktig enhet fra
   `fetchWindComponents`-mønsteret (README's advarsel, nå bekreftet reell).
3. **NorKyst trenger IKKE vektor-rotasjon (til forskjell fra vind) — men
   trenger et korrekt grid-indeksoppslag** (polar stereografisk, egne 2D
   lat/lon-arrays). Å anta at NorKyst er «som vind, bare med en annen
   rotasjonsmatrise» er feil retning på feilen — komponentene er allerede
   sanne øst/nord; risikoen ligger i å plukke FEIL kildecelle for en gitt
   subflis-node, ikke i å rotere feil vinkel.
4. **Oceanforecast har ingen periode-verdi** — verifisert direkte, ikke
   antatt. Enhver kode som antar `waves().tpS` «som regel finnes, av og til
   mangler» for denne kilden vil i praksis ALLTID falle i Hs-only-grenen —
   ikke en bug, men et strukturelt faktum spec-en per i dag ikke er skrevet
   for å forvente (§4.3 er skrevet for «leilighetsvis manglende», ikke
   «alltid manglende for hele kilden»). Se D14.1.
5. **Punktbølge er ikke en flate.** `decodeWavesAt`/`WaveLayers` forventer
   `LayerLookup` (bilineær rom-/tidsinterpolasjon over et grid). Et forsøk
   på å presse punktdata inn i den veien (f.eks. en falsk 1×1-nodes «flis»
   per punkt) vil enten krasje på geometriantakelser eller gi meningsløs
   «interpolasjon» mellom fysisk fjerne punkter behandlet som naboceller.
   Bygg en egen, enkel vei i stedet (§5.4).
6. **NorKysts tidsakse er en løpende aggregering (`time = 23999` over hele
   2024→nå+5d), ikke én ny fil per kjøring som MEPS.** Dagens
   `.grid-index-cache.json`-mønster (nøkkel = kjøringsnavn) passer ikke
   direkte — en NorKyst-indekscache må nøkles på noe annet (f.eks.
   bbox+dato-vindu), ellers blir cachen enten evig voksende eller
   permanent feil idet vinduet skyver seg videre.
7. **Depth-indeksen for «overflate» er antatt, ikke bekreftet eksakt** i
   denne bølgen (§3.1) — verifiser `depth`-aksens retning og at indeks 0
   faktisk er overflaten før noe bygges på antakelsen.
8. **Landmaske i strømfeltet er ikke det samme spørsmålet som
   `_FillValue`.** `_FillValue` fanger celler UTENFOR NorKysts modell-
   domene/på tørt land i modellens EGEN maske — det er ikke nødvendigvis
   identisk med farbarhetsmaskens landdefinisjon (`packages/geo`/
   chart-pack). Et punkt som farbarhetsmasken sier er sjø, men som NorKyst
   (grovere enn 800 m i virkeligheten, eller feilklassifisert i en bukt)
   markerer som fill, skal gi `current() → undefined` (§12, ikke en gjettet
   0), IKKE en stille antakelse om at «sjø i chart-pack ⇒ data i NorKyst».
9. **20 req/s-taket på api.met.no gjelder AGGREGERT, og et punktbølge-design
   som gjør ett kall per korridorpunkt PER RUTEPLANLEGGING (D14.2) må
   fortsatt gå via `apps/worker`s proxy med caching** — et design der
   klienten kaller Oceanforecast direkte per punkt, hver gang en rute
   planlegges, bryter caching-kravet (§16/`met-norway-api.md` punkt 3) selv
   med lav egen trafikk, fordi det er nettopp den typen «hent likt igjen og
   igjen»-mønster vilkårene advarer mot.

---

## 7. Åpne spørsmål til Magnus (D14.x)

### D14.1 — Oceanforecast mangler periode: hva gjør vi med F2.1/§4.3s periode-krav?

**Situasjon (verifisert, §3.2):** Oceanforecast 2.0s faktiske respons har
ingen periode-verdi. F2.1 sier eksplisitt «bølger (med periode!)»; §4.3
bygger `packages/polar`s bratthetsderating på Hs/Tp². Uten Tp faller ALT
gjennom til Hs-only-derating (allerede designet, men ment som unntak, ikke
regel).

**Alternativer:**

- **(a) Aksepter Hs-only som permanent tilstand for punktbølge-leveransen,
  eksplisitt flagget** (ikke skjult — §12s mønster brukes bokstavelig: hvert
  eneste punkt/tidssteg mangler `tpS`). Billigst, leverbart nå. Ulempe:
  F2.1s krav er da strukturelt ikke oppfylt før WAM800 (som HAR periode i
  sine kildevariabler — ikke verifisert her, men sannsynlig gitt WAM800 er
  et ekte bølgespektralmodell-produkt) er spiket og levert. Konservativ
  derating er sikker (§9.5-filosofi: heller for forsiktig), men reduserer
  produktkvalitet varig, ikke midlertidig som spec-en i dag antar.
- **(b) Fremskynd WAM800-spiken** (§7 pkt. 5, «rask oppfølging») til FØR
  bølge 6/D13.5s neste steg, spesifikt for å hente periode — reverserer
  §18 pkt. 1s prioritering (Oceanforecast punkt FØR WAM800-spike). Dyrere
  nå, men lukker det reelle gapet i stedet for å bygge videre på en kilde
  som ikke leverer det kravet ber om.
- **(c) Behold Oceanforecast for Hs/retning/strøm-kryssjekk, hent KUN
  periode fra en annen kilde** (om en finnes — ikke identifisert i denne
  bølgen; MEPS/Locationforecast har ingen kjent periode-variabel heller).
  Sannsynligvis ikke praktisk mulig uten WAM800 eller en helt ny kilde.
- **(d) Revider F2.1/§4.3 til å eksplisitt akseptere Hs-only som
  v2.0-leveranse**, med periode faset inn «senere» (samme mønster som §4.6s
  sikt-utsettelse) — ærlig dokumentert nedgradering av en kravspek-linje,
  ikke en stille implementasjonsdetalj.

**Anbefaling:** (a) for **første** leveranse (raskest, minst risiko, og
Hs-only-derating er allerede en spesifisert, trygg — om konservativ —
degraderingsvei), KOMBINERT med å heve WAM800-spikens prioritet i planen
(effektivt en tidligere (b)) fremfor å la den bli en uspesifisert
«engang»-oppgave. Ren (d) uten (b) risikerer å låse en varig kvalitetstap
Magnus ikke fikk se konsekvensen av før den ble permanent.

### D14.2 — Hvor hører punktbølge (og evt. punktstrøm-kryssjekk) hjemme arkitektonisk?

**Spenning:** §7 pkt. 5 sier «punktbølge langs korridoren» (rute-spesifikt),
men F2.2s faste-fliser-prinsipp sier eksplisitt «ikke on-demand-subsetting
per rute». Et punkt-API kan strukturelt ikke bygges som en «flis over hele
Skandinavia» på samme måte som MEPS/NorKyst — det er ett kall per
koordinat.

**Alternativer:**

- **(a) Batch-jobben velger et FAST rutenett av punkter** (analogt
  tidevannets ~30 navngitte havner, §4.4) som dekker hele det aktuelle
  kartområdet forhåndsdefinert, uavhengig av faktisk rute — bevarer F2.2s
  «ingen on-demand»-prinsipp, men et fast punktgrid tett nok til å være
  nyttig langs enhver mulig rute i Skagerrak/Kattegat kan fort bli mange
  punkter (kostnad ukjent, ikke anslått her).
  Går via R2/pointer-pipelinen som et eget `field: "waves-point"`.
- **(b) Live worker-proxy, som tidevann/MetAlerts** — klienten ber
  `apps/worker` om bølgepunkter langs DEN AKTUELLE ruten idet en rute
  planlegges (samme mønster som `/proxy/metalerts`), proxyen cacher med
  `If-Modified-Since`/ETag (§16-kravet, allerede skrevet infrastruktur for
  et annet punkt-API). **Bryter IKKE** F2.2s «ingen on-demand» hvis den
  regelen leses som å gjelde SPESIFIKT den store, gridded batch-pipelinen
  (MEPS/NorKyst/WAM800) — punktbølge er strukturelt mer likt tidevann enn
  vind, og tidevann er allerede unntatt fra den gridded pipelinen (§4.4
  sier eksplisitt «ikke en del av den kvantiserte gridded rutepakken»).
- **(c) Hybrid:** batch-jobben forhåndshenter et fast, grovt punktgrid (a)
  for offline-bruk (F1.9/F6.4), MENS worker-proxyen (b) gir en ferskere,
  rute-presis oppdatering når nett er tilgjengelig — mest robust, mest
  kompleks, to kodeveier å vedlikeholde.

**Anbefaling:** (b), av samme grunn som tidevann allerede gjør det slik:
punkt-API-er som ikke er en flate hører hjemme i proxy-mønsteret, ikke i
den gridded batch-pipelinen — det er den eksisterende presedensen i
spec-en selv (§4.4), ikke et nytt prinsipp som må forsvares. Ulempen
(ingen bølgedata offline uten en tidligere plan lagret) er den samme
avveiningen tidevann allerede har akseptert.

### D14.3 — Skal NorKyst reprojiseres ekte, eller arve vindens indeksvindu-forenkling?

**Situasjon:** README dokumenterer allerede at MEPS' Lambert-grid IKKE
reprojiseres ekte i dag (indeksvinduet behandles som om det er lat/lon).
Samme forenkling for NorKysts polare stereografiske grid er den billigste
veien til en første leveranse, men NorKyst er finere (800 m mot 2,5 km) og
brattere nær kysten (§9.4s ¼-regel-begrunnelse) — feilstørrelsen av «late
som stereografisk = lat/lon» er ukjent og potensielt større i relativ
forstand enn for vind.

**Alternativer:** (a) arve forenklingen nå, mål avviket empirisk ved første
`build-live`-kjøring (§9.4s byggetids-verifisering dekker dette delvis
allerede — men den tester ¼-regelen, ikke reprojeksjonsfeilen spesifikt);
(b) bygg en ekte punkt-for-punkt nærmeste-nabo-oppslag mot kildens egne
2D lat/lon-arrays (mulig uten selv å implementere proj/inv, se §3.1) FØR
første strøm-leveranse.

**Anbefaling:** (a) med en eksplisitt, datert måling tidlig (samme
filosofi som §17 pkt. 7 for budsjett) — ikke la forenklingen stå
uverifisert på ubestemt tid slik den har gjort for vind siden 2026-09-04.

---

## 8. Filer lest/verifisert i denne bølgen (for sporbarhet)

- `docs/specs/vaerpakker.md` (§3, §4, §7, §8, §9, §12, §14–19 — hele filen
  delvis, de nevnte seksjonene i sin helhet)
- `docs/00-kravspek.md` (F1.0–F1.9, F2.1–F2.7)
- `docs/decisions/ADR-0005-ensemble-mekanisme.md` (hele)
- `docs/legal/met-norway-thredds.md`, `docs/legal/met-norway-api.md` (hele)
- `tools/weather-pack/README.md` («Hva som IKKE er wiret opp», «Første EKTE
  MEPS-måling»)
- `packages/routing/src/contracts.ts`, `packages/routing/src/expand.ts`
- `packages/weather/src/field.ts`, `packages/weather/src/weather-field-adapter.ts`
- `tools/weather-pack/src/package-writer.ts`, `tools/weather-pack/src/pipeline.ts`
  (grep for current/waves — ingen treff, bekrefter README)
- `docs/research/ekspertpanel-d13-nettbrett-2026-09-27.md` (§1.3, §1.4)
- `docs/research/spike-thredds.md` (NorKyst-funn, funn 4/7)
- Levende kilder, hentet 2026-09-27 med identifiserende User-Agent:
  `thredds.met.no/.../norkystv3_800m_m00_be.das`,
  `.../norkystv3_800m_m00_be.dds`,
  `api.met.no/weatherapi/oceanforecast/2.0/complete?lat=57.7&lon=11.2`,
  `docs.api.met.no/doc/oceanforecast/datamodel`,
  `api.met.no/weatherapi/oceanforecast/2.0/documentation`
