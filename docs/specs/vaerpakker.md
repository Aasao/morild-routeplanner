# Spec: værpakker (`tools/weather-pack`, `packages/weather`, pakke-peker-API)

> **Utkast — venter på Magnus og på kvantiseringsmålingen.**
> Kvantiserings- og oppløsningsfeltene (§9) er bevisst ikke fylt inn: de
> avgjøres av `docs/research/kvantiseringsmaaling-2026-09-01.md`, som kjøres
> parallelt med dette utkastet (jf. «Kvantisering FØR formatlåsing»,
> `docs/research/steg3-plan-2026-08-31.md`). Alt annet i denne spec-en er
> uavhengig av det tallet og kan implementeres/reviewes nå.

- Status: **utkast**
- Dato: 2026-09-01
- Fase: 3 (`docs/01-prosjektplan.md`)
- Pakker: `tools/weather-pack` (batch), `packages/weather` (feltmodell/
  dekoding), `packages/protocol` (delt `PackageHeader`), pakke-peker-endepunkt
  i `apps/worker`
- Grunnlag: `docs/00-kravspek.md` F2.1–F2.7, F3.5, N2, N3, N4, N6;
  `docs/research/spike-thredds.md`; `docs/research/vaerdata-ensemble.md`;
  `docs/decisions/ADR-0003-batch-i-github-actions.md`;
  `docs/decisions/ADR-0005-ensemble-mekanisme.md`;
  `docs/research/steg3-plan-2026-08-31.md`. Stil og struktur følger
  `docs/specs/rutemotor.md`.

---

## 1. Formål og kravsporing

Værpakke-pipelinen henter MEPS-ensemble, NorKyst-strøm, bølgedata og
tidevann fra MET/Kartverket, kvantiserer dem til et budsjettert,
versjonert format, og publiserer dem innholdsadressert til R2. Klienten
laster ferdige pakker og dekoder dem til `Float32`-felt rutemotoren
(`docs/specs/rutemotor.md` §4.2) kan lese synkront og deterministisk.
Denne spec-en dekker **alt mellom THREDDS/MET og `WeatherField`** — den
definerer ikke hvordan feltet *brukes* (det gjør rutemotor-spec-en) og ikke
hvordan robusthetslaget aggregerer over medlemmer (det gjør
`docs/specs/robusthet.md`, fase 4).

| Krav | Hva denne spec-en dekker |
|---|---|
| **F2.1** | Kildestack: MEPS kontroll + 30 medlemmer, NorKyst v3, MET Oceanforecast/WAM800 (bølge m/periode), Kartverket tideapi + vannstand, MetAlerts, sikt (§4) |
| **F2.2** | Fliser/subsetting-geometri, ≤ 30 MB-budsjett m/regnskap per felt, romlig nedtynning (NorKyst), lagged-ensemble-politikk (§7, §8, §11) |
| **F2.3** | Pakkeformat versjonert (semver), major-avvisning, forrige generasjon beholdt i R2 (§5) |
| **F2.4** | Metadata (modell/init/oppløsning/alder) + kildestatus + healthcheck (§6, §12, §13) |
| **F2.5** | Interpolasjon og retningskonvensjoner enhetstestet; frossen ekte MEPS-testpakke (§3, §17) |
| **F2.6** | MetAlerts-felt i pakke-/punkt-API-kontrakten (§4.5) |
| **F2.7** | Sikt-felt i etappesammendraget (kilde uavklart, §4.6, §18) |
| **F3.5** | Klientens dekodingskontrakt: kvantisert→Float32 i worker, transferable ArrayBuffers (§15) |
| **N2** | Ærlig degradering: kildestatus/degraderingsflagg per felt, aldri stille substitusjon (§12) |
| **N3** | API-vilkår (User-Agent, rate limit, backoff) dokumentert og håndhevet (§16) |
| **N4** | Gratis kilder + GitHub Actions gratisnivå (ADR-0003), ingen nye betalte tjenester (§16) |
| **N6** | Budsjett og minneavtrykk ved dekoding i klienten (§8, §15) |

## 2. Avgrensning — hva denne spec-en bevisst IKKE dekker

- **Rutemotorens forbruk av feltet** (`WeatherField`-kontrakten,
  interpolasjonsalgoritmen sett fra søket, hvordan `undefined` håndteres i
  ekspansjonssteget) → `docs/specs/rutemotor.md` §4.2, §5.3. Denne spec-en
  definerer hva som *produseres* og hvordan det *dekodes*; rutemotor-spec-en
  eier hva søket *gjør* med det.
- **Ensemble-aggregering og robusthetsmål** (P50/P90,
  gjennomførbarhetsandel, korridor-stabilitet) → `docs/specs/robusthet.md`,
  fase 4. Denne spec-en leverer 30 uavhengige `WeatherField`-instanser (ett
  per medlem) og vet ikke at de brukes sammen.
- **Kartpakker** (farbarhetsmaske, PMTiles) → `docs/specs/farbarhetsmaske.md`.
  Fliseinndelingen der (0,5°×0,25°, valgt for kystlinje-kompleksitet) er
  **ikke** samme rutenett som værflisene i §7 — begrunnelse der.
- **Polar-kalibrering mot v1-loggene** (F3.3) → egen bølge, kjøres når denne
  pipelinen finnes (kravspek §3 F3.3).
- **Presentasjon** (vær-langs-ruten-bånd, F4.4) → fase 5/robusthet-spec.
  Denne spec-en leverer tall og metadata; ikke UI.
- **Eksakt kvantisering/oppløsning** (§9) → åpent med vilje, se boksen øverst.

---

## 3. Sentrale begreper og konvensjoner

**Kontrakten under må være bit-for-bit konsistent med
`docs/specs/rutemotor.md` §3 og §4.2 — dette er nøyaktig konvensjonsfellen
v1 gikk i, og F2.5 krever eksplisitt testing av den.**

| Størrelse | Enhet | Konvensjon | Kilde i pakken |
|---|---|---|---|
| Vindretning | grader [0,360) | **FRA** — vinden kommer fra denne retningen | MEPS `x_wind_10m`/`y_wind_10m` → **lagret som u/v-komponenter** i byteformatet (skala/offset per flis); **dekoderen** regner om til `(speedKn, fromDeg)` før feltet forlater `packages/weather` (se merknad under) |
| Bølgeretning | grader [0,360) | **FRA** (MET-konvensjon — sjøen kommer fra denne retningen) | Oceanforecast/WAM800 `thhh`/`Pdir` |
| Strøm `u`, `v` | knop | **MOT** — `u` = komponent mot øst, `v` = komponent mot nord | NorKyst v3 `u_eastward`/`v_northward`, lagret som komponenter **og dekodet som komponenter** — strøm er additiv med båtfart som vektor, så komponentformen er riktig helt fram til rutemotoren (til forskjell fra vind, som dekodes til fart+retning) |
| Hs | meter | signifikant bølgehøyde | Oceanforecast/WAM800 `hs`/`VHM0` |
| Tp | sekunder | bølgeperiode (topp/peak) | Oceanforecast/WAM800 `tp`/`VTPK` — **kan mangle** selv når Hs finnes (§12) |
| Vannstand | meter, relativt sjøkartnull | TIDE (astronomisk) + SURGE (meteorologisk) + TOTAL | Kartverket tideapi, `refcode=sjokartnull` |
| Tid | epoke-sekunder (UTC) | samme klokke som `WeatherField.validFromS/validToS` i rutemotor-spec-en | alle kilder normaliseres til UTC ved henting |

**Hvor typeskillet vind/strøm lever — og hvor det ikke lever
(rettet 2026-09-01, se §19):** vindretning FRA og strømretning MOT er fysisk
forskjellige størrelser satt sammen i samme dokument nettopp fordi de lett
forveksles. Skillet håndheves i **det dekodede API-et**: `packages/weather`
eksporterer `WindSample` (`speedKn`, `fromDeg`) og `CurrentSample` (`u`, `v`)
som distinkte typer, uten noen felles `VectorSample`, slik at det er en
kompileringsfeil — ikke en kjøretidsfeil — å bytte dem om nedstrøms.

**Byteformatet er en annen sak, og der er begge u/v.** Vind lagres i pakken som
u/v-komponenter med skala/offset per flis, ikke som fart + retning.
Kvantiseringsmålingen 2026-09-01
(`docs/research/kvantiseringsmaaling-2026-09-01.md` §5, §10 krav 4) avviste
fart+retning som lagringsform på målte tall: `W-SD10` (fart + retning, 10 bit)
gir 1,03 % anger på S-8 der `W-UV10` gir 0,00 %, og `W-SD8` bryter N5 i tre
scenarioer. Mekanismen er feilstrukturen — en retningsfeil er en *rotasjon* av
vektoren, og over en front (der farten er nesten kontinuerlig, men retningen
hopper 68°) bærer retningskanalen informasjonen alene; u/v fordeler feilen på
to kanaler med samme skala.

**Kontrakten blir dermed:** `x_wind_10m`/`y_wind_10m` fra MEPS lagres som u/v i
byteformatet, og **dekoderen** (`decode`, §15) regner om per oppslag med
`speed = hypot(u,v)`, `fromDeg = norm360(atan2(-u,-v)·180/π)` og returnerer
`WindSample`. Konverteringen enhetstestes mot kjente par (§17). Kostnaden er to
transcendentale operasjoner per oppslag i stedet for null; det er en bevisst
handel mot 1,03 % anger, og den er liten fordi dekodingen uansett skjer per
medlem i workeren (§15 pkt. 3). Interpolasjon skjer i **komponentrommet** før
konverteringen (§3 punkt 4–5), slik at hverken vindretning eller vindfart
noen gang blir lineært interpolert som skalar.

**Enhetstestene i F2.5 skal minst dekke** (kjente verdier, ikke bare
egenskapstester):

1. Nordavind 10 kn (`fromDeg=0`) gir `(u,v) = (0,-10)` og vice versa.
2. Østavind 10 kn (`fromDeg=90`) gir `(u,v) = (-10,0)`.
3. Nordgående strøm 2 kn (`v=2, u=0`) er MOT nord, ikke FRA nord — påse at
   ingen kode et sted kaller `atan2(-u,-v)` på strømkomponentene (den
   klassiske ombyttingsbuggen).
4. Bilineær rom-interpolasjon av vind interpolerer **komponenter** — i
   pakkeformatet er `u,v` de lagrede kanalene, så dette er den naturlige
   veien; `fromDeg` skal aldri interpoleres direkte (360°/0° er samme
   retning; lineær interpolasjon av vinkler uten omveien om komponenter gir
   feil svar nær nord). Testen skal også dekke et felt levert som
   fart+retning fra en ekstern kilde: da må konverteringen til komponenter
   skje **før** interpolasjonen, ikke etter.
5. Tids-interpolasjon (mellom to tidssteg i pakken) skjer i samme
   komponentrom for vind; strøm interpoleres direkte i `(u,v)`. Konvertering
   til `WindSample` skjer **etter** all interpolasjon, som siste steg i
   oppslaget.
6. Et frosset, **ekte** MEPS-uttrekk (ikke syntetisk) i
   `packages/weather/fixtures/`, med kjente punktverdier verifisert manuelt
   mot `ocean.met.no`/en uavhengig visualisering før den fryses — dette er
   F2.5s «ekte testpakke» og skal aldri erstattes av en syntetisk generator.

---

## 4. Kildestack og ansvarsfordeling (F2.1)

| Felt | Kilde | Oppløsning (kilde) | Horisont | Ensemble | Hentemetode |
|---|---|---|---|---|---|
| Vind | MEPS `meps_lagged_6_h_latest_2_5km_{run}.nc` | 2,5 km | 61 t (66 t kontroll) | 30 medlemmer (kontroll = medlem 0, deterministisk) | OPeNDAP index-range (`spike-thredds.md` — NCSS er nede, ikke en fallback lenger) |
| Strøm | `fou-hi/norkystv3_800m_m00_be` | 800 m | ~5 døgn rullerende | ingen (kun «reference member 00» — verifisert i spiken) | OPeNDAP index-range |
| Bølger | MET Oceanforecast 2.0 (punkt) / WAM800 Skagerrak `fou-hi/mywavewam800s_curr` (domene `c4`, ~295 MB/fil helt domene) | 800 m kystnært | ~5,5 døgn (WAM800), 9 dgn (Oceanforecast punkt) | ingen | Oceanforecast: JSON punkt-API. WAM800 grid: OPeNDAP — **subsetting uverifisert, se §18 pkt. 1** |
| Vannstand/tidevann | Kartverket tideapi | ~30 navngitte havner | prognosehorisont per API | ingen | XML punkt-API |
| MetAlerts | api.met.no MetAlerts | polygon-varsler | aktivt vindu | n/a | JSON punkt-/områdeoppslag (uverifisert i denne fasen, §18 pkt. 5) |
| Sikt | uavklart — se §4.6 | — | — | — | **kilde ikke identifisert ennå (§18 pkt. 6)** |

**Ensemble-produktets faktiske form** (rettelse arvet fra `spike-thredds.md`,
gjelder også denne spec-en): MEPS-ensemblet er **ikke** 30 separate filer.
Det er én fil med dimensjonene
`[time=62][nivå][ensemble_member=30][y][x]`. Batch-jobben henter **alle 30
medlemmer i ett OPeNDAP-kall per variabel** (målt 21–22 s / ~80 MB for
u/v hver, `spike-thredds.md` funn 6) — ikke 30 sekvensielle kall. Kontroll
(medlem 0) er den deterministiske kjøringen i samme fil; det finnes **ingen
egen kontrollfil å foretrekke** — medlem 0 er per MEPS-konvensjon det
ukontrollerte/deterministiske medlemmet (jf. `vaerdata-ensemble.md` §1,
verifisert av spiken). Dette er grunnlaget for CLAUDE.mds prinsipp «N
medlemmer fra start, med deterministisk kontrollkjøring som medlem 0» —
her er det bokstavelig sant, ikke en arkitekturmetafor.

**NorKyst har ingen ensemble-variant.** Strømfeltet er identisk for alle 30
ruteberegninger; `packages/routing`s `WeatherField.current()` er likevel en
metode på samme grensesnitt som `wind()`/`waves()` for hvert medlem — i
praksis peker alle 30 medlemmers `current()` til samme underliggende
dekodede buffer (delt, read-only — ADR-0005s presisering om delte
vær-uavhengige oppslag gjelder analogt her: strømmen er ikke
værUAVHENGIG, men den er **medlemsUAVHENGIG**, og deling er derfor trygt
uten å bryte per-medlem-isolasjon).

### 4.1 MEPS — vind

Kontroll ved 2,5 km (native), ensemble ved en oppløsning som fastsettes av
kvantiseringsmålingen (§9) — **ikke** låst til 5 km slik et tidligere
kravspek-utkast antok; F3.5 (revidert per ADR-0005) sier eksplisitt at
kursOPPLØSNING i søket er lik for kontroll og medlemmer, men sier ingenting
om FELT-oppløsningen, som er et eget spørsmål denne spec-en eier.

### 4.2 NorKyst — strøm

Overflatestrøm (`u_eastward`, `v_northward`, øverste dybdelag). Romlig
nedtynning fra 800 m er **påkrevd** (spike-funn: 103 041 punkter for
Skjæløy–Skagen-bboxen ved full oppløsning — se §8); graden av nedtynning og
om den er uniform eller kystnær-variabel er åpent, §9.

### 4.3 Bølger

**Krever periode**, ikke bare Hs (F2.1 eksplisitt: «MET Oceanforecast/
WAM800 for bølger (med periode!)»). Grunn: `packages/polar`s
derating-funksjon (`docs/specs/rutemotor.md` §4.3) bruker
Hs/Tp²-bratthetsklasse, ikke Hs alene — en pakke uten Tp tvinger enten
en konservativ antatt-verst-Tp (mildere sjø ser brattere/farligere ut enn
den er) eller degraderer derating til Hs-only med et flagg. **Valgt
regel:** mangler Tp der Hs finnes, settes `waves().tpS = undefined` (ikke
en gjettet verdi) og `packages/polar` faller tilbake til en dokumentert
konservativ Hs-only-derating med eget flagg — se
`docs/specs/rutemotor.md` §4.3 (allerede skrevet med `tpS?: number`
valgfri) og §12 under.

### 4.4 Tidevann/vannstand

Punkt-API, ikke gridded — hentes for et lite antall navngitte havner langs
ruten (start, mål, bail-out-kandidater) og for negativ-vannstand-risikoen
(F1.2) på Kattegat/Bælte-/Østersjø-segmenter. Går via `apps/worker`
proxy'en som JSON-punktoppslag, **ikke** en del av den kvantiserte
gridded rutepakken (§5) — den har sin egen `PackageHeader`-instans med
`model: "Kartverket-tideapi"`.

### 4.5 MetAlerts (F2.6)

Punkt-/områdeoppslag mot api.met.no, samme proxy-mønster som tidevann.
**Ikke spiket i denne fasen** — antas å fungere som beskrevet i
`vaerdata-ensemble.md` (samme UA-/rate-limit-regime som Locationforecast,
§16), men eksakt polygon-mot-rute-geometri (hvilke varsler «langs ruten»
betyr presist) er en åpen implementasjonsdetalj, ikke en åpen
arkitekturbeslutning — se §18 pkt. 5.

### 4.6 Sikt (F2.7)

**Kilde ikke identifisert.** MET Locationforecast/MEPS har ikke et direkte
`visibility`-felt i den formen v1 eller denne research-runden har bekreftet
(kun avledede skyfraksjons-/tåkeproxyer, uverifisert). F2.7 sier sikt
«påvirker ikke rutingen i v2.0» — feltet trengs kun til
etappesammendraget, så konsekvensen av at kilden er uavklart er lav
hastverk, men den skal ikke besluttes stilltiende når pipelinen bygges.
Se §18 pkt. 6.

---

## 5. Pakkeformat: semver og innholdsadressering (F2.3)

Gjenbruker `packages/protocol`s `PackageHeader` (samme type som
kartpakkene): `formatVersion` (semver for selve *skjemaet*, ikke for
modellkjøringen), `producedAt`, `model`, `init`, `resolution`,
`sourceStatus`. **Én `PackageHeader` per felt, ikke én per pakke** — vind,
strøm og bølger kan ha ulik `init`-tid og ulik `sourceStatus` samtidig
(«06Z manglet, dette er 00Z» kan gjelde vind uten å gjelde strøm), og F2.4
krever at det er synlig per felt.

**Kompatibilitet** følger nøyaktig `checkCompatibility` i
`packages/protocol/src/package-header.ts`: samme major aksepteres uansett
minor/patch; ulik major avvises med forståelig melding (F2.3). Klienten
kaller denne funksjonen — den samme koden kartpakkene bruker — før den
forsøker å dekode noe som helst.

**Innholdsadressering** følger kartpakkenes etablerte mønster
(`docs/specs/farbarhetsmaske.md` §3.4, `plattform-android-cloudflare.md`):

```
R2-nøkkel:   weather/<formatVersion-major>/<contentHash>.bin
Peker:       pointer/vaer-skandinavia.json  →  { tileId, field, member } → { key, hash, header }
```

`contentHash` = SHA-256 av **den ferdig kvantiserte** byte-payloaden (etter
§9s koding, før eventuell ytterligere gzip). To kjøringer som (uvanlig,
men mulig ved uendret vær) produserer byte-identisk kvantisert felt, deler
dermed R2-objekt — innholdsadressering, ikke tidsstempel-adressering.
`producedAt`/`init` ligger i pekeren og i `PackageHeader`, ikke i
R2-nøkkelen, nettopp for at identisk innhold fra to kjøringer ikke skal
dupliseres i lagring.

**Forrige generasjon beholdes** (F2.3): batch-jobben sletter aldri gamle
R2-objekter selv om `pointer/vaer-skandinavia.json` peker et annet sted nå.
Opprydding (arkivpolitikk) er en åpen driftsbeslutning, §18 pkt. 7.

---

## 6. Felt og metadata (F2.4)

Hvert felt i pakken bærer, via sin `PackageHeader`:

- `model` — f.eks. `"MEPS"`, `"NorKyst-v3"`, `"WAM800-c4"`,
  `"Oceanforecast-2.0"`.
- `init` — modellens init-tidspunkt, **ikke** `producedAt` (batch-jobbens
  kjøretid). Et felt kan være timer gammelt selv om pakken ble bygget for
  ti minutter siden (lagged-ensemble, §11).
- `resolution` — for vind/strøm: streng som `"2.5km"` (kontroll),
  `"<TBD>km"` (ensemble, §9), `"800m→<TBD>km"` (NorKyst, nedtynnet).
- `sourceStatus` — `{status: "ok"}` eller
  `{status: "degraded", reason: "06Z manglet — dette er 00Z"}` (F2.4s
  eget eksempel, brukt ordrett som mønster).

**Alder vises alltid i UI** (kravspek F2.4: «UI viser alder og årsak»).
`packages/weather` eksponerer en ren funksjon
`ageAt(header: PackageHeader, nowEpochS: number): { ageS: number, stale: boolean }`
(terskel for `stale` er en presentasjonsbeslutning, ikke denne spec-ens —
den returnerer bare tallet).

---

## 7. Faste fliser og subsetting-geometri (F2.2)

**Prinsipp, låst nå:** batch-jobben bygger **faste fliser over hele
Skandinavia per modellkjøring** — ikke on-demand-subsetting per rute. Dette
er eksplisitt i F2.2 og er en arkitekturbeslutning uavhengig av
kvantiseringstallet: klienten/Workeren komponerer en «rutepakke» ved å
plukke ut hvilke ferdigbygde fliser en gitt rute berører, den ber aldri
batch-jobben om et skreddersydd uttrekk.

**Flisrutenett — foreslått, IKKE samme som kartflisene.**
`docs/specs/farbarhetsmaske.md` bruker 0,5°×0,25° (valgt for
kystlinje-detaljnivå). Værfliser trenger motsatt avveining: MEPS/NorKyst
har lav nok informasjonstetthet per grad at et finmasket rutenett bare gir
mange små filer med dyr per-flis metadata-overhead (F2.2 nevner eksplisitt
«8-bit kvantisering m/per-flis skala/offset» — hver flis betaler en fast
kostnad for skala/offset-parametre per felt per tidssteg).

**Forslag (åpent for Magnus, ikke bare kvantiseringsmålingen):** værfliser
på **2°×2°** eller lik spikens bbox-skala (Skjæløy–Skagen-bboxen var
2,3°×2,5° og ga et håndterbart indeksvindu på 106×106 MEPS-punkter). Et
2°-rutenett over Skandinavia (lat 53–72, lon 2–32) gir en håndterbar,
overskuelig flisliste (~10×15 = 150 fliser i det ytre gridet, langt færre
med faktisk hav-dekning), og de fleste enkeltruter (Skjæløy–Skagen-klassen)
krysser 1–3 fliser. Dette er en **foreslått** verdi, ikke besluttet — se
§18 pkt. 3.

**Subsetting-geometri (uavhengig av flisstørrelse, gjelder alltid):**

1. Grid-indeksoppslag (bbox → y/x-vindu per datasett+projeksjon) caches
   **permanent** i `tools/weather-pack` — ikke beregnes på nytt per
   kjøring. Spike-funn 7: et unødvendig re-oppslag kostet 17,75 MB i seg
   selv; grid-geometrien er statisk (samme projeksjon, samme
   kildeoppløsning) og endres kun når MET bytter modellgrid.
2. Alle 30 MEPS-medlemmer hentes i **ett** OPeNDAP-kall per variabel per
   flis, aldri 30 separate kall (spike-funn 6: samme byte-volum, brøkdel
   av tiden, langt færre round-trips).
3. NorKyst-bboxen per flis skal være akkurat flisens utstrekning, ikke et
   sjenerøst nabolag — spikens ineffektive prøve (555×870-vindu for å
   finne et 321×321-vindu) er en dokumentert antimønster, ikke en
   mal.
4. Subsetting går **utelukkende via OPeNDAP index-range** (`.dods`), ikke
   NCSS. NCSS var nede under hele spiken (503 på alt) og designes ikke inn
   som primærvei; skulle NCSS komme tilbake, er det en mulig fremtidig
   optimalisering, ikke noe pipelinen skal avhenge av fra dag én.
5. **WAM800-subsetting er fortsatt uverifisert** (spikens åpne punkt).
   Første oppgave før bølgefeltet kobles inn i den faktiske pipelinen er en
   liten oppfølgingsspike som måler bbox-subset-kostnad mot de ~295 MB/fil
   store WAM800-filene — se §18 pkt. 1. Inntil den er kjørt, bygges
   pipelinen med bølger fra Oceanforecast punkt-API (som allerede finnes
   og fungerer) og WAM800-gridded-varianten er et eksplisitt
   `sourceStatus: degraded`/fallback-tilfelle, ikke en forutsetning.

---

## 8. Budsjettregnskap ≤ 30 MB per rutepakke (F2.2)

En «rutepakke» er de fliser + felt en gitt rute faktisk trenger — typisk
1–3 værfliser (§7) for kontroll + 30 medlemmer + strøm + bølger + metadata,
for hele 61-timershorisonten.

**Foreløpig regnskap (ekstrapolert fra `spike-thredds.md`, IKKE målt mot en
ekte kvantisert pakke — tallene under er overslag, og cellene merket
`<TBD>` avhenger av §9):**

| Post | Formel | Overslag | Status |
|---|---|---|---|
| Vind, kontroll | 2 var × ~11 236 pkt (2,5 km, én flis-bbox) × ~37 tidssteg (tynnet) × `<TBD>` bit/sample | ~0,8 MB ved 8-bit | placeholder, §9 |
| Vind, 30 medlemmer | 2 var × 30 medl × `<TBD>` pkt (ensemble-oppløsning) × ~37 tidssteg × `<TBD>` bit/sample | ~6 MB ved 8-bit/5 km | placeholder, §9 |
| Strøm (NorKyst, nedtynnet) | 2 var × `<TBD>` pkt (nedtynnet oppløsning) × `<TBD>` tidssteg × `<TBD>` bit/sample | 2–4 MB (grov skisse) | placeholder, §9 |
| Bølger | Hs + Tp (+ retning) × `<TBD>` pkt/tidssteg | samme størrelsesorden som strøm | placeholder, §9 + §7 pkt. 5 |
| Tidevann/MetAlerts | punkt-JSON, ikke gridded | < 0,1 MB | lav usikkerhet |
| Metadata (per-felt `PackageHeader`, per-flis skala/offset) | fast overhead × antall fliser × antall felt | < 0,2 MB for 1–3 fliser | lav usikkerhet |
| **Sum, overslag** | | **~10–20 MB** | **under budsjettet med margin, forutsatt at nedtynningen i §9 faktisk gjennomføres — spikens egen konklusjon, ikke verifisert mot en ekte bygget pakke** |

**Regnskapet skal reverifiseres mot en faktisk bygget, kvantisert pakke**
så snart `tools/weather-pack` finnes — dette overslaget er ikke en
budsjettgaranti, det er argumentet for at 30 MB er et realistisk mål å
designe mot. Regnskapet oppdateres med reelle tall i endringsloggen (§19)
når `tools/weather-pack` bygger sin første ekte pakke.

**Hard budsjettregel:** bygger en gitt rutepakke over 30 MB, skal
batch-jobben **degradere** (grovere tidstynning, strengere NorKyst-
nedtynning, eller — siste utvei — droppe ensemble-medlemmer fra den halen
med lavest forventet informasjonsverdi, ikke tilfeldig) og markere
`sourceStatus: degraded` med årsak, aldri stille kutte data. Den eksakte
degraderingsrekkefølgen er en implementasjonsdetalj som kvantiseringsmålingen
informerer, ikke en beslutning denne spec-en låser nå.

---

## 9. Kvantisering og oppløsning — ÅPENT (venter på måling)

> **Ingenting i denne seksjonen er besluttet.** Tallene under er eksplisitt
> `<TBD>` inntil `docs/research/kvantiseringsmaaling-2026-09-01.md`
> foreligger og Magnus har tatt stilling til den. Denne spec-en skal
> **ikke** oppdateres med gjettede tall i mellomtiden — placeholder-en
> under er kontrakten resten av dokumentet refererer til.

### 9.1 Hva målingen avgjør

1. **Bit-bredde per felt.** F2.2 antar 8-bit m/per-flis skala/offset som
   utgangspunkt, men om det holder presisjon (spesielt for Hs og for
   svak-vind-regimet der TWA-følsomheten er høyest) er ikke verifisert.
2. **Romlig oppløsning, ensemble-vind.** Et tidligere kravspek-utkast antok
   5 km; det er en anbefaling fra spiken, ikke en måling av ruteeffekt.
3. **Romlig oppløsning/nedtynningsgrad, NorKyst-strøm.** Spiken foreslår
   «ned mot ~2–3 km effektiv oppløsning» som **grov skisse, ikke en
   beslutning» (dens egen ordlyd) — og om nedtynningen bør være uniform
   over flisen eller variere med avstand til kyst/rute (jf. F2.2s formulering
   «full oppløsning beholdes kun nær ruten/kysten», som ikke er presisert
   noe sted) er en åpen designakse i seg selv, ikke bare et tall.
4. **Tidsoppløsning.** F2.2s utgangspunkt (1 t 0–24 t, 3 t etterpå) er en
   forutsetning, ikke en målt avveining mot ruteeffekt.
5. **Delta-koding** (F2.2 nevner den som mulig budsjett-tiltak) — brukes
   den, og for hvilke felt.

**Metoden** (fra steg3-plan): golden-ruter kjørt på degraderte felt
(varierende bit-bredde, 2,5 vs. 5 km, 1 vs. 3 t, NorKyst-nedtynning
trinnvis) sammenlignes på **rutediff og avgangsrangering** (N5s
toleransebegrep), ikke felt-RMSE — en kvantiseringsfeil som ikke endrer
noen rutebeslutning er irrelevant selv om den er stor i rå tallverdi, og en
liten feltfeil som flipper en avgangsrangering er ikke det.

### 9.2 Hs — hardt krav, uavhengig av målingens tall

**Hs går inn i harde avvisninger** (`docs/specs/rutemotor.md` §5.3, steg
`hsM > boat.maxHsM` → forkast noden; §5.3.2s klaringskrav
`seaStateOffingNmPerM · Hs`). En kvantisert Hs-verdi som er **lavere** enn
den sanne verdien kan derfor skjule en reell avvisning eller en reell
kystbuffer-innstramning — det er retningen som er farlig, ikke
kvantiseringsfeilens størrelse i seg selv.

**Regel, gjeldende uansett hva målingen konkluderer om bit-bredde/skala:**
**kvantisering av Hs skal aldri kunne gjøre feltet MILDERE enn kilden.**
Konkret: for enhver kildeverdi `hs`, skal den dekodede verdien
`hs_kvantisert ≥ hs` (avrunding **opp**, ikke til nærmeste). Dette er en
konservativ-retning-regel, samme filosofi som `clearanceNm`s
aldri-overestimer-krav i rutemotor-spec-en (§4.1 der) — bare speilvendt,
fordi her er det den *lave* verdien som er den farlige, ikke den høye.

**Hvordan dette implementeres (skala/offset-formen)** avhenger av §9.1s
bit-bredde-valg, men uansett endelig form skal enhetstesten være:
`decode(encode(hs)) ≥ hs` for et representativt utvalg `hs`-verdier
inkludert grenseverdier (`hs = boat.maxHsM` eksakt, `hs` like under en
kvantiseringsterskel). Dette er en **hard, ikke-omsettelig** regel i denne
spec-en — kvantiseringsmålingen avgjør bit-bredde og skala, men avgjør
**ikke** om regelen gjelder. Endelig presis avrundingsformel skrives inn
her når målingen lander (§19).

### 9.3 Placeholder-kontrakt inntil målingen lander

```ts
// packages/weather — foreløpig type, feltene under fylles fra målingen.
interface QuantizationParams {
  readonly bitsPerSample: number;        // <TBD> — §9.1 pkt. 1
  readonly scale: number;                // per-flis, per-tidssteg
  readonly offset: number;
  /** Hs ALENE: avrundingsretning er ALLTID "opp" (§9.2), uavhengig av
   *  bitsPerSample/scale. Andre felt bruker vanlig nærmeste-verdi. */
  readonly roundingMode: "nearest" | "up";
}
```

---

## 10. Reservert felt: EOF/basis×koeffisient-encoding (valgfritt, ikke besluttet)

Kvantefysiker-rådets forslag (`ekspertpanel-fysikk-2026-08-31.md`,
gjenfortalt i steg3-plan-en): representere ensemble-spredningen som en
liten empirisk ortogonalfunksjon-basis (EOF) × per-medlem-koeffisienter,
i stedet for 30 fulle felt. Potensielt stort budsjettkutt **hvis**
ensemblet har lav effektiv rang (fysisk plausibelt for storskala
vindfelt, men **ikke undersøkt** på ekte MEPS-data).

**Denne spec-en reserverer plass i formatet for et slikt encoding-felt**
(en `encoding: "raw" | "eof"`-diskriminant på feltnivå i pakke-headeren,
med `eof`-varianten båret av et eget skjema som IKKE er designet ennå),
men **låser ingenting**: `k`-beslutningen (hvor mange basisfunksjoner)
krever ekte MEPS-ensembledata — et syntetisk ensemble ville gitt kunstig
lav rang og fått eksperimentet til å «lykkes» trivielt uansett metode
(kvantefysiker-rådets eget forbehold). Første ekte MEPS-uttrekk
(§17 pkt. 6, den frosne testpakken) er en forutsetning for å i det hele
tatt undersøke dette, ikke bare for å beslutte det.

**v2.0-implementasjonen bruker `encoding: "raw"` overalt.** `eof` er et
mulig fase 3b/4-tiltak hvis budsjettregnskapet (§8) viser at
rå-kodingen ikke holder etter at §9 er besluttet — ikke et krav for
første ende-til-ende-leveranse.

---

## 11. Lagged-ensemble-politikk (F2.2)

MEPS-ensemblet leveres «lagged»: 5 nye medlemmer hver time, opptil 6 t
gamle ved siste kjøring (`vaerdata-ensemble.md` §1). Batch-jobben henter
**siste komplette 30-medlemmers kjøring** — én fil med
`ensemble_member=30`-dimensjonen, ikke et sammensurium av medlemmer fra
ulike kjøringstidspunkter satt sammen selv (den sammensetningen er MET sin
jobb, ikke vår).

**Aldersspenn i metadata:** fordi kjøringen er lagget, er ikke alle 30
medlemmer like «ferske» — dette skal være synlig, ikke skjult bak ett
enkelt `init`-tidspunkt for hele ensemblet. `PackageHeader.init` for
vindfeltet er kjøringens navngitte init-tid (`{run}` i filnavnet); et eget,
dokumentert tilleggsfelt (utformes ved implementasjon, se §18 pkt. 2 for
hvor mye lag-dybde robusthetslaget faktisk trenger å vite om) bærer
aldersspennet mellom eldste og yngste medlem i den hentede kjøringen.

**Hvis siste kjøring ikke er komplett** (færre enn 30 medlemmer levert,
eller `ensemble_member`-dimensjonen mangler helt): `sourceStatus:
degraded` med årsak, og batch-jobben faller tilbake til **forrige
komplette kjøring**, ikke til et delvis ensemble — et robusthetsmål bygget
på 22 av 30 medlemmer uten at det er synlig er nøyaktig den stille
degraderingen N2 forbyr. Terskelen for «komplett» og hvor langt tilbake
fallback-kjeden strekker seg er en driftsbeslutning, §18 pkt. 2.

---

## 12. Kildestatus og degraderingsflagg per felt (N2)

**Prinsipp:** manglende eller degradert data flagges **på feltnivå**, aldri
ved stille substitusjon (f.eks. å late som Hs = 0 når kilden mangler, eller
å bruke gårsdagens strøm uten å si det).

**Kontrakten mot rutemotoren er presis og allerede delvis skrevet der:**
`WeatherField.waves(...)` returnerer `undefined` når feltet mangler helt i
rom/tid, og returnerer `{hsM, tpS: undefined, fromDeg: undefined}` når Hs
finnes men periode/retning mangler. `packages/routing`s
`FLAG_SJOEGANG_DATA_MANGLER` (`packages/routing/src/cost.ts`) settes
nøyaktig når `hsM === undefined` ankommer klareringssjekken
(`packages/routing/src/clearance.ts`) — **denne spec-ens jobb er å sørge
for at pakken/dekoderen aldri fyller inn en gjettet Hs-verdi der kilden
manglet**, fordi det ville slukket flagget uten å fjerne risikoen. Samme
logikk gjelder `tpS`: mangler perioden alene (Hs finnes), er det en svakere
degradering (Hs-only-derating, §4.3) med sitt eget, mildere flagg — ikke
`FLAG_SJOEGANG_DATA_MANGLER`, som betyr «vi vet ingenting om sjøgangen»,
ikke «vi vet noe, men ikke alt».

**Per felt, `sourceStatus` dekker minst:**

| Situasjon | `sourceStatus` | Nedstrøms konsekvens |
|---|---|---|
| Forventet kjøring (f.eks. 06Z) manglet, forrige (00Z) brukt | `degraded`, årsak `"06Z manglet — dette er 00Z"` (F2.4s eget eksempel) | Alder vises i UI; ingen endring i selve tallene |
| Ensemble ufullstendig, falt tilbake til eldre komplett kjøring | `degraded`, årsak m/antall medlemmer og alder | Robusthetslaget (fase 4) må lese aldersfeltet, ikke bare late som 30 ferske medlemmer |
| WAM800 grid utilgjengelig, Oceanforecast punkt brukt i stedet | `degraded`, årsak `"WAM800 util­gjengelig — punktbølge brukt"` | Grovere romlig oppløsning på bølge enn normalt |
| Hs finnes, Tp mangler | ikke pakke-nivå degradert (Tp er valgfritt i `WeatherField.waves`) | `packages/polar` Hs-only-derating, eget mildere flagg |
| Hs mangler helt for et gitt punkt/tid | feltet `undefined` for det punktet — **ikke** pakke-nivå `degraded` med mindre HELE feltet mangler | `FLAG_SJOEGANG_DATA_MANGLER` i rutemotoren |
| NorKyst-nedtynning aktiv (§9) | ikke degradert — dette er en **villet** kvalitetsreduksjon innenfor budsjett, ikke et datahull | `resolution`-strengen viser den faktiske, nedtynnede oppløsningen (aldri den native 800 m hvis den ikke faktisk ble levert) |

---

## 13. Healthcheck-kontrakt (ADR-0003, F2.4)

Batch-jobben pinger `HEALTHCHECK_URL` (fra `.dev.vars.example`/GitHub
Actions-secret) ved **hver kjøring**, uavhengig av om kjøringen lyktes.

**Minimum payload** (form avgjøres ved implementasjon, semantikk låst her):

- `runId`, `startedAt`, `finishedAt`.
- Per felt: lyktes henting? Falt den tilbake (til hvilken kjøring)?
  Endelig `sourceStatus`.
- Totalt bygget pakkevolum (§8-regnskapet, faktisk målt denne kjøringen).
- Om noe felt ble degradert utenfor forventet mønster (f.eks. WAM800
  utilgjengelig tre kjøringer på rad — et mønster, ikke en enkelthendelse).

**Varsling ved pipeline død > 12 t** (kravspek F2.4 ordrett) er
healthcheck-tjenestens ansvar (utenfor denne spec-ens skjema — typisk en
enkel «ping en URL, varsle ved uteblitt ping» heartbeat-tjeneste), ikke noe
`tools/weather-pack` selv implementerer utover å pinge pålitelig, også ved
delvis feil (en batch-jobb som crasher FØR den rekker å pinge skjuler
nettopp feilen healthchecken skal fange — pingen skal skje i en `finally`,
ikke bare på lykkelig vei).

---

## 14. Pakke-peker-API-et (`apps/worker`)

Workeren eier **kun** proxy/cache og pakke-pekere (ADR-0002: klienten
beregner, skyen forbereder) — ingen NetCDF-dekoding, ingen kvantisering
skjer her.

```
GET /api/weather/pointer
  → pointer/vaer-skandinavia.json (cachet, ETag/If-None-Match mot R2)
  Svar: { formatVersion, tiles: [{ tileId, bbox, fields: [{ field, member,
          key, hash, header: PackageHeader }] }] }

GET /api/weather/blob/:contentHash
  → binærblob fra R2 (immutable — cache-control: max-age lang, siden
    innholdsadressert data aldri endres under samme hash)
```

**Versjoneringsflyt:** klienten holder sin egen `clientFormatVersion`
(kompilert inn, ikke hentet), kaller `/pointer`, og bruker
`checkCompatibility` (§5) på hver `header.formatVersion` FØR den ber om
noen `blob`. Inkompatibel major → klienten viser en forståelig melding
(F2.3) og fortsetter på sist synkede lokale pakke hvis en finnes (F6.4:
offline først).

**Punkt-API-ene** (tidevann, MetAlerts, evt. nowcast) går gjennom en
egen, enklere proxy-rute (`/api/weather/point/...`) med korrekt
User-Agent og cache-headere (§16) — de er ikke innholdsadresserte
R2-blobber, de er ferske JSON-svar med kort levetid.

---

## 15. Klientens dekodingskontrakt (F3.5)

**Prinsipp (allerede vedtatt i F3.5, gjentatt her fordi denne spec-en eier
implementasjonen):** kvantisert byte-payload lastes som `ArrayBuffer`,
sendes **transferable** til en Web Worker (unngår COOP/COEP-fellen —
strukturert kloning av store buffere er dyrt og/eller blokkert av
isolasjonshoder), og dekodes til `Float32Array` **i workeren, on demand**
— ikke alle 30 medlemmer dekodet på forhånd «for sikkerhets skyld».

**Kontrakt:**

1. Worker mottar `{ contentHash, quantizationParams, buffer: ArrayBuffer }`
   (buffer transferred, ikke kopiert).
2. Dekoding er en **ren funksjon**: `decode(buffer, params) → Float32Array`
   — ingen I/O, ingen tilstand, samme regler som rutemotorens renhetskrav
   (`docs/specs/rutemotor.md` §5.1), fordi det dekodede feltet mates
   direkte inn i `WeatherField`, som må være deterministisk.
3. Dekoding skjer **per medlem, ved behov** — progressiv semantikk
   (ADR-0005): kontrollmedlemmet dekodes og brukes for alle avganger
   først; øvrige 29 medlemmer dekodes progressivt mens de streames/brukes,
   ikke alle på forhånd. Dette holder minneavtrykket nede (N6: JS-heap
   < 500 MB under ensemble-kjøring) — 30 fullt dekodede `Float32`-felt
   samtidig i minnet er nøyaktig den typen forhåndsarbeid progressiv
   beregning skal unngå.
4. **Hs-avrundingsregelen (§9.2) håndheves i `decode`, ikke et sted
   nedstrøms** — det er én kodevei for Hs-dekoding, og den kan
   enhetstestes isolert (`decode(encode(hs)) ≥ hs`) uten å bygge en hel
   rutepakke.
5. Dekodede `Float32Array`-buffere for værUAVHENGIGE felt (strøm — §4)
   deles på tvers av medlemmer (ADR-0005s presisering om delte
   read-only-cacher gjelder identisk her); vind/bølge dekodes én gang per
   medlem og aldri delt (de ER medlemsspesifikke).

---

## 16. API-vilkår, User-Agent og backoff (N3, N4)

**Denne spec-en stiller kravet; det formelle vilkårsdokumentet mangler
foreløpig i `docs/legal/`** (eksisterende filer der dekker Kartverket/
Kystverket/EMODnet/OpenSeaMap/DDM/Naturbase — **ingen MET Norway-fil
ennå**). Før `tools/weather-pack` går i produksjon skal
`docs/legal/met-norway-api-vilkaar.md` skrives (innhold under er allerede
research-et i `vaerdata-ensemble.md` §1 og skal overføres dit, ikke
gjentas fritt fra minnet ved implementasjon):

- **Maks 20 req/s per applikasjon totalt** (api.met.no) — gjelder
  aggregert over alle installasjoner, ikke per bruker. GitHub Actions
  batch-kjøring er trygt godt innenfor dette (sekvensielle THREDDS-kall,
  ikke api.met.no-punktkall i volum), men Workerens punkt-proxy (§14) MÅ
  rate-begrense hvis flere klienter (telefon + nettbrett samtidig) kunne
  nærme seg grensen — usannsynlig for én bruker, men prinsipielt riktig å
  bygge inn.
- **Obligatorisk, identifiserende User-Agent** m/kontaktinfo — forfalsket
  UA gir permanent blokkering. Format brukt i spiken:
  `morild-routeplanner/<versjon> maasao@gmail.com` — samme mønster
  videreføres i `tools/weather-pack` og `apps/worker`s proxy, **aldri**
  en generisk/tom UA-streng.
- **Caching-krav:** respekter `Expires`, bruk `If-Modified-Since`/ETag der
  tilgjengelig. `apps/worker`s proxy-rute (§14) er selve
  mekanismen kravet peker på («mobilapper skal gå via egen backend/
  caching-proxy»), ikke en implementasjonsdetalj.
- **Backoff ved 429/503:** eksponentiell backoff med tak, IKKE umiddelbar
  retry-løkke. THREDDS-spiken observerte 503 på NCSS gjennomgående — en
  pipeline som slår hardt tilbake mot en nede tjeneste er dårlig
  medborgerskap selv om den til slutt lykkes. Konkret backoff-skjema
  (starttid, multiplikator, tak, antall forsøk før `sourceStatus:
  degraded` og fallback til forrige kjøring) er en implementasjonsdetalj,
  ikke en arkitekturbeslutning — men **skal finnes i kode, ikke bare i en
  kommentar om at man burde ha det**.
- **Lisens CC BY 4.0** (MET) — attribusjon i UI, jf. kravspek N3. DMI-
  deriverte data (hvis/når DMI tas i bruk, F2.1 «faset inn senere») skal
  merkes som avledet, ikke MET-attribuert.

---

## 17. Testkrav (F2.5, N5)

1. Retningskonvensjon-tester (§3, punktene 1–3) — kjente verdier, ikke
   egenskapstester alene.
2. Interpolasjon-tester (§3, punkt 4–5) — bilineær rom, lineær tid, på
   syntetiske felt med kjent analytisk svar.
3. Hs-avrundingsregelen (§9.2) — `decode(encode(hs)) ≥ hs` over et
   representativt utvalg inkludert grenseverdier.
4. `checkCompatibility`-bruken i pakke-peker-flyten (§14) — gjenbruk av
   eksisterende `package-header.test.ts`-mønster, ikke en ny
   implementasjon av semver-sjekken.
5. Kildestatus-propagering (§12) — gitt en pakke bygget med et manglende
   felt, verifiser at `WeatherField` returnerer `undefined` (ikke en
   gjettet verdi) og at riktig flagg settes i en ende-til-ende-test som
   går helt inn i `packages/routing` (samme mønster som
   `e1-forkrav.test.ts` som allerede tester
   `FLAG_SJOEGANG_DATA_MANGLER`).
6. **Frossen, ekte MEPS-testpakke** (§3 punkt 6) i
   `packages/weather/fixtures/` — hentet én gang, verifisert manuelt mot
   en uavhengig kilde, aldri regenerert stille (endringer i den krever en
   datert begrunnelse i denne spec-ens endringslogg, samme disiplin som
   golden-fiksturene i rutemotor-spec-en).
7. Budsjettregnskapet (§8) reverifiseres med en test/rapport-skript som
   måler faktisk bygget pakkestørrelse mot 30 MB-grensen — ikke bare en
   engangs manuell sjekk.

---

## 18. Åpne spørsmål til Magnus

1. **WAM800-subsetting er ikke spiket.** Skal en liten oppfølgingsspike
   (mål bbox-subset-kostnad mot de ~295 MB/fil store WAM800-filene) kjøres
   FØR `tools/weather-pack` bygges, eller er Oceanforecast punkt-API
   («degradert» bølgeoppløsning, men fungerende) et akseptabelt
   utgangspunkt for første ende-til-ende-leveranse (fase 3-exit i
   `01-prosjektplan.md`), med gridded WAM800 som en rask oppfølging?
2. **Lagged-ensemble-dybde:** hvor gammelt kan et medlem være før
   robusthetslaget (fase 4) bør vite om det spesifikt (ikke bare
   ensemblets `init` som helhet)? Og: hvis siste kjøring er ufullstendig,
   hvor mange kjøringer tilbake skal fallback-kjeden gå før pipelinen
   heller flagger «ingen brukbart ensemble» enn å stadig lete lenger
   bakover?
3. **Flisstørrelse (§7):** er 2° et fornuftig utgangspunkt, eller bør
   værflisene være enda grovere (færre, større filer — enklere
   pekerlogikk) eller finere (mindre overflødig data per rute)? Dette er
   uavhengig av kvantiseringsmålingen og kan besluttes nå.
4. **Arkivpolitikk for R2** (§5, §13): forrige generasjon beholdes per
   F2.3, men hvor mange generasjoner tilbake, og skal gamle
   værpakker (i motsetning til kartpakker) i det hele tatt beholdes lenge
   — de blir raskt operasjonelt ubrukelige (prognosen er utdatert), men
   kan ha verdi for F3.3-kalibrering/backtesting. Uten en grense vokser
   R2-bucketen ubegrenset.
5. **MetAlerts-geometri:** eksakt regel for «varsel langs ruten» (buffer i
   nm rundt sporet? hele varselpolygonet hvis det overlapper i det hele
   tatt?) er ikke spesifisert. Lav hastegrad (F2.6 er visning, ikke
   ruting), men bør besluttes før implementasjon, ikke under.
6. **Sikt-kilde (F2.7)** er ikke identifisert. Skal dette research-es som
   egen liten spike, eller er sikt-feltet lavt nok prioritert (kravspeken
   sier eksplisitt «påvirker ikke rutingen i v2.0») til å vente til en
   senere fase uten å blokkere fase 3-exit?
7. **EOF-encoding (§10):** bekreftelse av at dette forblir en ren
   formatreservasjon i v2.0, og at `k`-eksperimentet på ekte MEPS-data
   (når den frosne testpakken finnes) er en forskningsoppgave uten
   forpliktelse til å faktisk ta i bruk `eof`-encoding selv om det skulle
   vise seg lovende.

---

## 19. Endringslogg

- **2026-09-01 — utkast v0.1.** Skrevet parallelt med
  kvantiseringsmålingen (`docs/research/kvantiseringsmaaling-2026-09-01.md`,
  ikke lest av denne spec-en per instruks — §9 er bevisst tomt for tall).
  Grunnlag: `docs/00-kravspek.md` (F2.1–F2.7, F3.5, N2–N6),
  `docs/research/spike-thredds.md`, `docs/research/vaerdata-ensemble.md`,
  `docs/decisions/ADR-0003`, `docs/decisions/ADR-0005`,
  `docs/research/steg3-plan-2026-08-31.md`. Ingen kode skrives mot denne
  spec-en før §9 er fylt inn og Magnus har godkjent utkastet (§18).
- **2026-09-01 — §3 rettet: vindens lagringsform.** Utkastet sa at vind
  «omregnes til fart+retning ved kvantisering, ikke lagret som rå U/V».
  Det er i direkte motstrid med kvantiseringsmålingen
  (`docs/research/kvantiseringsmaaling-2026-09-01.md` §5 og §10 krav 4), som
  målte nettopp den lagringsformen og forkastet den: `W-SD10` gir 1,03 %
  anger der `W-UV10` gir 0,00 %, og `W-SD8` bryter N5 i tre scenarioer.
  Rettet til: **u/v lagres i byteformatet; dekoderen konverterer til
  `WindSample` (`speedKn`, `fromDeg`)**. Typeskillet FRA/MOT — spec-ens
  opprinnelige og fortsatt gyldige begrunnelse — lever i det **dekodede
  API-et** (`WindSample` vs. `CurrentSample`, ingen felles `VectorSample`),
  ikke i byteformatet. §3s testliste punkt 4–5 presisert tilsvarende:
  interpolasjon i komponentrom, konvertering som siste steg.
  **§9 er ikke rørt** — kvantiseringstallene er fortsatt åpne og venter på
  Magnus, jf. boksen øverst.
