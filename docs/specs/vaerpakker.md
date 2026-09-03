# Spec: værpakker (`tools/weather-pack`, `packages/weather`, pakke-peker-API)

> **Gjeldende.** §9 (kvantisering/oppløsning) var åpent i utkast v0.1 i
> påvente av `docs/research/kvantiseringsmaaling-2026-09-01.md`. Målingen
> foreligger (inkl. tillegget 2026-09-02, §9.1 der), og Magnus har besluttet
> §9 **todelt** 2026-09-02: logikk/énsidighetsregler og søkefri empiri er
> **låst nå**; noen konkrete terskler (Hs-trinn, «1 t holder»-tilstrekkelighet,
> 5 km-grensen for fallback-/etter-48t-felt) er **midlertidige** og
> remåles mot ekte MEPS/NorKyst-data i fase 3. Se §9 for hvilket punkt som er
> hvilket. Samtidig besluttet Magnus §18s samlepakke med åpne spørsmål (WAM800,
> lagged-ensemble-dybde, flisstørrelse, R2-arkivpolitikk, MetAlerts-geometri,
> sikt, EOF) — se §18, nå omdøpt til beslutningslogg for de spørsmålene.

- Status: **gjeldende (V1–V3 besluttet 2026-09-02; terskler i §9 midlertidige
  til ekte-data-måling)**
- Dato: 2026-09-01, revidert 2026-09-02
- Fase: 3 (`docs/01-prosjektplan.md`)
- Pakker: `tools/weather-pack` (batch), `packages/weather` (feltmodell/
  dekoding), `packages/protocol` (delt `PackageHeader`), pakke-peker-endepunkt
  i `apps/worker`
- Grunnlag: `docs/00-kravspek.md` F2.1–F2.7, F3.5, N2, N3, N4, N6 (F2.2 revidert
  2026-09-02 — se kravspekens endringslogg samme dato);
  `docs/research/kvantiseringsmaaling-2026-09-01.md` (inkl. §9.1
  helhetskontroll og §10-anbefalinger — grunnlaget for §9 under);
  `docs/research/spike-thredds.md`; `docs/research/vaerdata-ensemble.md`;
  `docs/decisions/ADR-0003-batch-i-github-actions.md`;
  `docs/decisions/ADR-0005-ensemble-mekanisme.md`;
  `docs/research/steg3-plan-2026-08-31.md`;
  `docs/specs/farbarhetsmaske.md` §3 (kystlinjevektordata brukt til
  kystsone-definisjonen, §9.4 under). Stil og struktur følger
  `docs/specs/rutemotor.md`.

---

## 1. Formål og kravsporing

Værpakke-pipelinen henter MEPS-ensemble, NorKyst-strøm, bølgedata og
tidevann fra MET/Kartverket, kvantiserer dem til et budsjettert,
versjonert format, og publiserer dem innholdsadressert til R2. Klienten
laster ferdige pakker og dekoder dem (per oppslag som standard, §9.7) til
tallverdier rutemotoren (`docs/specs/rutemotor.md` §4.2) kan lese synkront
og deterministisk.
Denne spec-en dekker **alt mellom THREDDS/MET og `WeatherField`** — den
definerer ikke hvordan feltet *brukes* (det gjør rutemotor-spec-en) og ikke
hvordan robusthetslaget aggregerer over medlemmer (det gjør
`docs/specs/robusthet.md`, fase 4).

| Krav | Hva denne spec-en dekker |
|---|---|
| **F2.1** | Kildestack: MEPS kontroll + 30 medlemmer, NorKyst v3, MET Oceanforecast/WAM800 (bølge m/periode), Kartverket tideapi + vannstand, MetAlerts, sikt (§4) |
| **F2.2** | Fliser/subsetting-geometri, ≤ 30 MB-budsjett m/regnskap per felt, kvantisering/oppløsning (låst todelt), kystsone-definisjon, romlig nedtynning (NorKyst), lagged-ensemble-politikk (§7, §8, §9, §11) |
| **F2.3** | Pakkeformat versjonert (semver), major-avvisning, forrige generasjon beholdt i R2 (§5) |
| **F2.4** | Metadata (modell/init/oppløsning/alder) + kildestatus + healthcheck (§6, §12, §13) |
| **F2.5** | Interpolasjon og retningskonvensjoner enhetstestet; frossen ekte MEPS-testpakke (§3, §17) |
| **F2.6** | MetAlerts-felt i pakke-/punkt-API-kontrakten (§4.5) |
| **F2.7** | Sikt-felt i etappesammendraget (kilde uavklart, §4.6, §18) |
| **F3.5** | Klientens dekodingskontrakt: kvantisert `Uint8Array` som resident representasjon, per-oppslag dekvantisering, transferable ArrayBuffers (§9.7, §15) |
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
- **Eksakt kvantisering/oppløsning** (§9) → **besluttet 2026-09-02** (todelt:
  låst nå / midlertidig til ekte-data-måling), se boksen øverst og §9.

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
| Bølger | MET Oceanforecast 2.0 (punkt) / WAM800 Skagerrak `fou-hi/mywavewam800s_curr` (domene `c4`, ~295 MB/fil helt domene) | 800 m kystnært | ~5,5 døgn (WAM800), 9 dgn (Oceanforecast punkt) | ingen | Oceanforecast: JSON punkt-API, **gyldig førsteleveranse** (besluttet §18 pkt. 1). WAM800 grid: OPeNDAP — subsetting fortsatt uverifisert, spike kjøres etter fase 3-start (§7 pkt. 5) |
| Vannstand/tidevann | Kartverket tideapi | ~30 navngitte havner | prognosehorisont per API | ingen | XML punkt-API |
| MetAlerts | api.met.no MetAlerts | polygon-varsler | aktivt vindu | n/a | JSON punkt-/områdeoppslag (uverifisert i denne fasen; geometriregel besluttet, §4.5/§18 pkt. 5) |
| Sikt | uavklart — se §4.6 | — | — | — | **kilde bevisst utsatt, blokkerer ikke fase 3-exit (§18 pkt. 6)** |

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

**Besluttet 2026-09-02 (§9):** kontroll OG alle 30 medlemmer leveres på
2,5 km (native) — **ikke** 5 km for medlemmene, slik et tidligere
kravspek-utkast antok. Kvantiseringsmålingens helhetskontroll
(`K-ANB-UTASKJAERS`, §9.1) viste at 5 km flipper avgangsrangeringens
toppavgang (+4 t → +2 t, ΔP50 3,35–3,50 %) — og at effekten kommer fra
oppløsningen selv, ikke fra kvantiseringen (`R-2X`, Float32 på 5 km, gir
samme flipp, 3,50 %). 5 km er derfor **ikke** en tillatt lettelse for
medlemmene generelt; den er kun tillatt for (a) fallback-felt (kilden ikke
tilgjengelig i normal oppløsning) og (b) kontrollens horisont utover 48 t
(§9.1 pkt. «medlemshorisont»), og da med 10-bit kvantisering, ikke 8-bit
(P90-halen rives opp av 8-bit×5 km sammen, målt 5,36 %, mens Float32 på
5 km alene bare gir 0,02 % — en interaksjon, ikke en sum). F3.5 (revidert
per ADR-0005) sier at kurs-oppløsningen i søket er lik for kontroll og
medlemmer; §9 her låser i tillegg at FELT-oppløsningen også er lik (2,5 km)
innenfor 48 t-horisonten.

### 4.2 NorKyst — strøm

Overflatestrøm (`u_eastward`, `v_northward`, øverste dybdelag). Romlig
nedtynning fra 800 m er **påkrevd** utenfor kystsonen (spike-funn:
103 041 punkter for Skjæløy–Skagen-bboxen ved full oppløsning — se §8).
**Besluttet 2026-09-02 (§9, §9.4):** 800 m urørt i **kystsonen** (definert
operasjonelt i §9.4), 1,6 km tillatt **utaskjærs**. Grunnlaget er
strukturbredde, ikke en fast kilometergrense i seg selv: kyststrømmens
fronter/virvler er 1–5 km brede, og målingens ¼-regel (nodeavstand ≤ ¼ av
smaleste struktur som skal representeres) er dokumentert begrunnelse, ikke
en direkte måling på ekte NorKyst-data (§9.1 forbehold 2, §11 forbehold 4 i
måledokumentet) — derfor kreves byggetids-verifisering per flis (§9.4).

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
§16). **Geometri besluttet 2026-09-02 (§18 pkt. 5):** et varsel vises når
varselpolygonet **skjærer rutesporet bufret 5 nm**, eller **inneholder
start- eller målpunktet** (selv om selve sporet ikke krysser det — et
varsel som dekker havna man legger ut fra skal vises uansett hvor ruten
går). Aktivt kulingsnivå (eller sterkere) i et vist varsel **farger
anbefalingen** i avgangstabellen (F2.6); svakere varsler vises, men farger
ikke. Eksakt fargekoding (hvilke MetAlerts-nivåer → hvilke UI-farger) er en
presentasjonsdetalj, ikke denne spec-ens ansvar — den eier at
polygon-mot-rute-testen (5 nm / inneholder-endepunkt) er kontrakten
`apps/worker`s proxy og `packages/weather` implementerer likt.

### 4.6 Sikt (F2.7)

**Kilde fortsatt ikke identifisert — bevisst utsatt, besluttet 2026-09-02
(§18 pkt. 6).** MET Locationforecast/MEPS har ikke et direkte
`visibility`-felt i den formen v1 eller denne research-runden har bekreftet
(kun avledede skyfraksjons-/tåkeproxyer, uverifisert). F2.7 sier sikt
«påvirker ikke rutingen i v2.0» — feltet trengs kun til etappesammendraget.
**Beslutning:** dette utsettelsen blokkerer **ikke** fase 3-exit. En liten
oppfølgingsspike på MEPS' `fog_area_fraction` (eller tilsvarende
skyfraksjons-/tåkeproxy) kjøres senere, som egen liten bølge — ikke som
forutsetning for at `tools/weather-pack` går i produksjon for vind/strøm/
bølge/tidevann/MetAlerts. Sikt-kolonnen i etappesammendraget vises som
«ikke tilgjengelig» inntil spiken er kjørt og en kilde er valgt — det er en
`N2`-riktig degradering (manglende felt vist, ikke skjult), ikke en
stille utsettelse.

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
R2-objekter selv om `pointer/vaer-skandinavia.json` peker et annet sted nå,
**innenfor arkivvinduet under**.

**Arkivpolitikk besluttet 2026-09-02 (§18 pkt. 4): 7 døgns rullerende
R2-arkiv for værpakker.** Værpakker eldre enn 7 døgn slettes av en egen
oppryddingsjobb (samme batch-runde eller en separat cron — implementasjonsdetalj).
Dette er bevisst forskjellig fra kartpakkenes arkivpolitikk
(`docs/specs/farbarhetsmaske.md` §7, som beholder lenger fordi kystlinjedata
endrer seg sakte og gamle bygg har verdi som fallback) — værprognoser blir
operasjonelt ubrukelige i løpet av dager, og F3.3s polar-kalibrering (SOG mot
historisk strøm/vind) bruker **METs eget hindcast-arkiv**, ikke vårt eget
7-døgns R2-vindu — vi arkiverer for drift/feilsøking, ikke som datakilde for
kalibrering. 7 døgn er valgt som «nok til å feilsøke en dårlig kjøring i
ettertid», ikke tallfestet mot noe kalibreringsbehov.

---

## 6. Felt og metadata (F2.4)

Hvert felt i pakken bærer, via sin `PackageHeader`:

- `model` — f.eks. `"MEPS"`, `"NorKyst-v3"`, `"WAM800-c4"`,
  `"Oceanforecast-2.0"`.
- `init` — modellens init-tidspunkt, **ikke** `producedAt` (batch-jobbens
  kjøretid). Et felt kan være timer gammelt selv om pakken ble bygget for
  ti minutter siden (lagged-ensemble, §11).
- `resolution` — for vind: `"2.5km"` for **både** kontroll og medlemmer
  innenfor 48 t-horisonten (§9), `"5km"` kun for kontrollens hale utover
  48 t eller for fallback-felt (da med `bitsPerSample: 10` i
  `QuantizationParams`, §9.3). For strøm: `"0.8km"` i kystsonen (§9.4),
  `"1.6km"` utaskjærs — feltet viser den faktiske leverte oppløsningen,
  aldri en nominell/native oppløsning som ikke faktisk ble sendt (samme
  prinsipp som §12s NorKyst-nedtynningsrad).
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

**Flisrutenett — besluttet 2026-09-02 (§18 pkt. 3), IKKE samme som
kartflisene.** `docs/specs/farbarhetsmaske.md` bruker 0,5°×0,25° (valgt for
kystlinje-detaljnivå). Værfliser trenger motsatt avveining: MEPS/NorKyst
har lav nok informasjonstetthet per grad at et finmasket rutenett bare gir
mange små filer med dyr per-flis metadata-overhead (F2.2 nevner eksplisitt
«8-bit kvantisering m/per-flis skala/offset» — hver flis betaler en fast
kostnad for skala/offset-parametre per felt per tidssteg).

**Vedtatt verdi: 2°×2°**, likt spikens bbox-skala (Skjæløy–Skagen-bboxen var
2,3°×2,5° og ga et håndterbart indeksvindu på 106×106 MEPS-punkter). Et
2°-rutenett over Skandinavia (lat 53–72, lon 2–32) gir en håndterbar,
overskuelig flisliste (~10×15 = 150 fliser i det ytre gridet, langt færre
med faktisk hav-dekning), og de fleste enkeltruter (Skjæløy–Skagen-klassen)
krysser 1–3 fliser.

**Subfliser for skala/offset: ≤ 32×32 noder** (§9 krav 8, målt: 32×32 ≈
80×80 km gir Hs-trinn 1,17–1,24 cm i hovedmålingen, §9.1). Hver 2°-flis
deles i et fast antall 32×32-subfliser (siste rad/kolonne kan være mindre
der 2° ikke deler jevnt); hver subflis bærer sin egen skala/offset per felt
per tidssteg. Subflisgrensa er **samme grid** som §9.4 bruker til å
klassifisere kystsone/utaskjærs — én geometri, to bruksområder (kvantisering
og sonevalg), ikke to separate rutenett å holde synkronisert.

**Origo delt med kartflisene (§9 krav, låst nå).** Værflisenes 2°-rutenett
forankres i samme heltallsorigo (hele gradlinjer, `lat mod 2 = 0`,
`lon mod 2 = 0`) som kartflisenes 0,5°×0,25°-rutenett bruker for sin egen
origo — ikke fordi rutenettene er like store (det er de bevisst ikke, se
over), men fordi en klient som har bestemt seg for hvilke kartfliser en rute
berører, kan regne ut de omsluttende værflisene med samme heltallsaritmetikk
uten en egen oppslagstabell, og fordi begge pakketypers pekere kan
forhåndshentes (prefetches) fra samme rutebbox i én runde uten to
runde-avrundinger som kan komme i utakt ved flisgrenser.

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
   **Besluttet 2026-09-02 (§18 pkt. 1): spiken kjøres ETTER fase 3-start, ikke
   som blokkerende forutsetning.** Første ende-til-ende-leveranse i fase 3
   bruker Oceanforecast punkt-API for bølger langs korridoren — dette er en
   **gyldig førsteleveranse**, ikke en midlertidig krykke som må fjernes før
   noe kan vises: punktbølger med periode dekker `packages/polar`s
   derating-behov (§4.3) på de navngitte punktene ruten faktisk passerer.
   WAM800-gridded-bølge (subsetting mot de ~295 MB/fil store filene) er en
   rask oppfølgingsspike når pipelinen for øvrig kjører, og
   forblir et eksplisitt `sourceStatus: degraded`/fallback-tilfelle inntil
   den spiken er kjørt og verifisert.

---

## 8. Budsjettregnskap ≤ 30 MB per rutepakke (F2.2)

En «rutepakke» er de fliser + felt en gitt rute faktisk trenger — typisk
1–3 værfliser (§7) for kontroll + 30 medlemmer + strøm + bølger + metadata,
for hele 61-timershorisonten.

**Regnskap oppdatert 2026-09-02 med §9s låste oppløsning/kvantisering** (2,5
km vind kontroll+medlemmer, 8-bit, 48 t medlemshorisont, 800 m strøm i
kystsonen). **Fortsatt IKKE målt mot en ekte bygget pakke** — det skjer
først når `tools/weather-pack` finnes (§17 pkt. 7). Tallene under er
ekstrapolert fra spikens punkttetthet, ikke lenger fra en `<TBD>`-oppløsning:

| Post | Formel | Overslag | Status |
|---|---|---|---|
| Vind, kontroll | 2 var × ~11 236 pkt (2,5 km, én flis-bbox) × full horisont (~66 t) × 8 bit, **1 t gjennom hele horisonten** (§9.2) | ~1 MB | oppdatert, §9 låst |
| Vind, 30 medlemmer | 2 var × 30 medl × ~11 236 pkt (2,5 km, samme flis) × 49 tidssteg (0–48 t, 1 t) × 8 bit ≈ **32 MB rått** | **~20–28 MB etter delta+gzip** (faktor 1,5–2,5×, F2.2) | **oppdatert, §9 låst — dette er posten som spiser mesteparten av budsjettet** |
| Strøm (NorKyst, 800 m kystsone / 1,6 km utaskjærs) | 2 var × pkt (avhenger av hvor mye av flisen som er kystsone, §9.4) × tidssteg × 8 bit | 2–4 MB (grov skisse, sonevariert nett ikke målt som helhet, §9.1 forbehold 1) | placeholder — sonegrense uprøvd i praksis |
| Bølger | Hs + Tp (+ retning) × pkt/tidssteg, 8-bit, opp-avrundet Hs | samme størrelsesorden som strøm | placeholder, §7 pkt. 5 (Oceanforecast punkt inntil videre — se der) |
| Tidevann/MetAlerts | punkt-JSON, ikke gridded | < 0,1 MB | lav usikkerhet |
| Metadata (per-felt `PackageHeader`, per-subflis skala/offset, 32×32-noder) | fast overhead × antall subfliser × antall felt | < 0,3 MB for 1–3 fliser | lav usikkerhet |
| **Sum, overslag** | | **~25–37 MB** | **ikke lenger klart under budsjettet — se budsjettregelen under** |

**Presisering av tidsoppløsningen i tabellen (rettet 2026-09-02, §19).**
Kontrollradens «1 t» gjelder **hele kontrollens horisont**, ikke et vindu
inne i den. §9.2 er ubetinget for harde felt: **Hs og TWS leveres på 1 t så
langt feltet rekker** — også i kontrollens hale utover 48 t, der §9.1 pkt. 3
lemper på *romlig* oppløsning (5 km) og *bit-bredde* (10-bit), men ikke på
tidsaksen. Formuleringen «1 t innenfor hard-felt-vinduet» stod her tidligere
og var tvetydig: den kunne leses som at det finnes et vindu utenfor hvilket
harde felt kan tynnes. Det gjør det ikke. Vil noen likevel grovne et hardt
felt en gang i framtiden, gjelder énsidighetsregelen i §9.2 (maksimum av
naboskivene, aldri gjennomsnitt) **pluss** flagget om skjeve
gjennomførbarhetstall — «vinduet» er ikke en lisens til å tynne.

**Dette er en vesentlig oppjustering fra utkastets `~10–20 MB`.** Årsaken er
at 5 km-lettelsen for medlemmer (som utkastet implisitt regnet med i
placeholder-tallet `~6 MB ved 8-bit/5 km`) er avvist av §9/F2.2 — medlemmene
går på 2,5 km, fire ganger så mange punkter, og vind-medlemsposten alene
(~20–28 MB) er nå i samme størrelsesorden som hele det tidligere
budsjettoverslaget. **Budsjettregel (F2.2, uendret prinsipp, tallsatt
konsekvens):** lander en ekte, målt rutepakke (delta+gzip inkludert) over
30 MB, legges en budsjettrevisjon til **~40 MB** fram for Magnus med det
målte tallet — rangeringskvalitet (2,5 km-oppløsningen §9 nettopp låste)
ofres ikke for et rundt 30 MB-tall. Gitt regnestykket over er dette ikke
lenger en fjern mulighet; det er sannsynlig nok til at
budsjett-reverifiseringstesten (§17 pkt. 7) bør kjøres tidlig i
implementasjonen, ikke som en avsluttende sjekk.

**Regnskapet skal reverifiseres mot en faktisk bygget, kvantisert pakke**
så snart `tools/weather-pack` finnes — dette overslaget er ikke en
budsjettgaranti, det er argumentet for at 30 MB er et realistisk mål å
designe mot. Regnskapet oppdateres med reelle tall i endringsloggen (§19)
når `tools/weather-pack` bygger sin første ekte pakke.

**Første ekte måling (§19, 2026-09-03) — MÅLT PÅ SYNTETISK FELT, ikke ekte
MEPS.** `tools/weather-pack measure-full-size` bygde en ekte, kvantisert,
delta-kodet og gzippet vind-medlems-pakke for hele Skjæløy→Skagen-bboxen
på denne seksjonens låste oppløsning (2,5 km, 48 t/49 tidssteg, 30
medlemmer, 8-bit): **31,49 MB rått** (stemmer godt med tabellens
`~32 MB rått` over — en god kryssjekk av selve node-/byte-regnskapet) og
**4,32 MB etter delta+gzip** (faktor 7,29×, VESENTLIG bedre enn tabellens
1,5–2,5×-anslag). Denne kompresjonsfaktoren er en egenskap ved det
GLATTE, analytiske syntetiske testfeltet (`tools/weather-pack/src/dry-
run-fixtures.ts`), ikke noe som kan overføres direkte til ekte MEPS-data
— et ekte atmosfærisk felt har mer høyfrekvent, mindre korrelert
romlig/tidsmessig struktur og komprimerer trolig dårligere, sannsynligvis
nærmere (eller svakere enn) det opprinnelige 1,5–2,5×-anslaget. Målingen
dekker KUN vind-medlemmene (denne tabellens tyngste post) — ikke kontroll,
strøm, bølger, tidevann/MetAlerts eller metadata. Full detalj:
`tools/weather-pack/README.md` "Første ekte pakkestørrelse".

**Hard budsjettregel:** bygger en gitt rutepakke over 30 MB, skal
batch-jobben **degradere** (grovere tidstynning, strengere NorKyst-
nedtynning, eller — siste utvei — droppe ensemble-medlemmer fra den halen
med lavest forventet informasjonsverdi, ikke tilfeldig) og markere
`sourceStatus: degraded` med årsak, aldri stille kutte data. Den eksakte
degraderingsrekkefølgen er en implementasjonsdetalj som kvantiseringsmålingen
informerer, ikke en beslutning denne spec-en låser nå.

---

## 9. Kvantisering og oppløsning — LÅST (todelt), besluttet 2026-09-02

**Grunnlag:** `docs/research/kvantiseringsmaaling-2026-09-01.md` (inkl.
§9.1-tillegget 2026-09-02) og kravspekens F2.2-revisjon samme dato. Denne
seksjonen er **todelt, med eksplisitt merking per punkt**:

- **LÅST NÅ** — logikk, énsidighetsregler og konklusjoner som ikke avhenger
  av å måle mot ekte MEPS/NorKyst-data (de er enten rene designvalg, eller
  fastslått av søkefri empiri som ikke er fikstursensitiv i sin konklusjon,
  bare i sin eksakte centimeter/prosent).
- **MIDLERTIDIG** — konkrete terskler som er målt på **syntetiske**
  fikstur-felt (`docs/research/kvantiseringsmaaling-2026-09-01.md` §11
  forbehold 3) og skal **remåles på ekte MEPS/NorKyst-data i fase 3** før de
  regnes som endelige. Se §9.8 for datert liste.

Ingen av de midlertidige punktene er «uavklart» i betydningen «vent med å
implementere» — implementer med tallene som står, men bygg
remålingssjekken (§17 pkt. 7 og under) inn i pipelinen fra dag én, ikke som
en etterpåklokskap.

### 9.1 LÅST — vind: lagringsform, bit-bredde, romlig oppløsning, horisont

1. **u/v-komponenter, 8-bit, skala/offset per subflis** (§7, 32×32 noder,
   byte-alignet). 10-bit ble vurdert og **avvist**: målingens
   helhetskontroll (`K-ANB-KYST`, §9.1 i måledokumentet) består identisk med
   referansen ved 8 bit, og margin-argumentet for 10 bit «var uansett svakt,
   siden skade ikke er monoton i grovhet» (samme dokument, §9.1). 10-bit er
   bit-pakkingsoverhead (ingen byte-alignering) uten en målt gevinst som
   oppveier det. `PackageHeader.formatVersion` (§5) reserverer veien til
   16-bit per lag som en **fremtidig, uavhengig beslutning** hvis et
   spesifikt felt en gang måtte trenge det — dette låser 8-bit *nå*, ikke
   *for alltid*.
2. **Romlig oppløsning: kontroll OG alle 30 medlemmer på 2,5 km**, innenfor
   48 t-horisonten (§9.1 pkt. 3 under). Dette reverserer et tidligere
   kravspek-utkast som antok 5 km for medlemmene. Målt begrunnelse: `K-ANB-
   UTASKJAERS` (5 km) består alle sikkerhetskriterier (ingen tapte harde
   forkastelser, ingen felle-flips) men **flipper avgangsrangeringens
   toppavgang** (+4 t → +2 t, ΔP50 3,35 %, over ±2 %-båndet) i det sterke
   rangeringsinstrumentet (fullt Pareto-søk per medlem, P2b). Attribusjonen
   er målt, ikke antatt: `R-2X` (samme 5 km, **Float32, ingen kvantisering i
   det hele tatt**) gir samme flipp og nesten samme ΔP50 (3,50 %) — feilen
   kommer fra **oppløsningen selv**, ikke fra 8-bit-kvantiseringen.
3. **5 km er derfor reservert til to smale unntak, ikke en generell
   utaskjærs-lettelse:** (a) fallback-felt der kilden ikke er levert i
   normal oppløsning, og (b) kontrollens hale utover 48 t (§9.1 pkt. 3 i
   dette dokumentet — kontroll har full horisont, medlemmer stopper ved
   48 t). I begge unntakene skal kvantiseringen være **10-bit, ikke 8-bit**:
   P90-halen rives opp av kombinasjonen 8-bit×5 km (målt ΔP90 5,36 %) mens
   verken 5 km alene (Float32, ΔP90 0,02 %) eller 8-bit alene (2,5 km,
   ΔP90 0,00 %) gjør det — en **interaksjon**, ikke en sum av to trygge
   valg. Dette er den ene plassen i formatet der bit-bredden IKKE er «8-bit
   er nok»: den finere kvantiseringen kompenserer for oppløsningstapet
   akkurat der halen bor.
4. **Medlemshorisont 48 t, kontroll full horisont** (~61–66 t). Målt
   rangeringsnøytralt for avgangsvinduet (S-5-instrumentet bruker uansett
   bare de første timene av hvert medlems rute til å skille avganger,
   kravspekens F2.2-formulering «primærkutt, rangeringsnøytralt»).

### 9.2 LÅST — tidsoppløsning og énsidighetsregelen for harde felt

**Felt som inngår i harde avvisninger (Hs, TWS) leveres alltid på 1 t
innenfor horisonten.** Felt uten hard-semantikk kan i prinsippet tynnes til
3 t, men ingenting i v2.0-pipelinen gjør det ennå (§9.8 — «1 t
holder»-tilstrekkeligheten for hvilke felt som faktisk kan tynnes er selv
midlertidig).

**Målt mekanisme, ikke gjettet:** `T-3H` (3 t) mister en reell felle — S-3s
medlem `m29` har 0,6 m Hs-margin mot `boat.maxHsM`, og verste temporale
Hs-underrapportering ved 3 t er 0,576 m, akkurat i den størrelsesordenen.
Den harde forkastelsen forsvinner, og felle-settet krymper fra
`{m04,m09,m14,m29}` til `{m04,m09,m14}` — mens `Δt` for samme konfigurasjon
bare er 0,12 % og dermed ikke ville varslet noe hvis rutediff var eneste
instrument. Samme konfigurasjon river opp avgangsrangeringens P90-hale
(ΔP90 5,91 %, 7 inversjoner) — halen er der medlemmer med harde grenser bor
(§6.3 i måledokumentet).

**Énsidighetsregel kodifisert som invariant for eventuell senere grovning**
(gjelder hvis noen i en senere fase vurderer å tynne et hardt felt utover
1 t): en grovnet tidsskive for et hardt felt skal ta **maksimum av de
underliggende naboskivene**, aldri et gjennomsnitt eller en interpolert
verdi. Samme retningslogikk som Hs-avrundingen (§9.3), men på tidsaksen —
og samme pris: en slik grovning skal sette et eksplisitt flagg om at
**gjennomførbarhetstall kan være konservativt skjeve** (færre gjennomførbare
medlemmer enn sannheten er en akseptabel feilretning; flere er det ikke).
Dette er ikke en aktiv kode-invariant i v2.0 (ingen hardt felt grovnes), men
en **grense produsenten aldri skal krysse uten denne kompensasjonen**, skrevet
inn før noen får bruk for den — jf. `T-6H`s asymmetriske funn (§6.2 i
måledokumentet: 7,2 % Δt men INGEN tapt felle, fordi fronten da er utsmurt
til et annet tidspunkt) som viser at skade fra grovning ikke er monoton og
derfor ikke kan sjekkes med bare ett scenario.

### 9.3 LÅST — Hs: hardt krav (uendret prinsipp, nå formelt vedtatt)

**Hs går inn i harde avvisninger** (`docs/specs/rutemotor.md` §5.3, steg
`hsM > boat.maxHsM` → forkast noden; §5.3.2s klaringskrav
`seaStateOffingNmPerM · Hs`). En kvantisert Hs-verdi som er **lavere** enn
den sanne verdien kan derfor skjule en reell avvisning eller en reell
kystbuffer-innstramning — det er retningen som er farlig, ikke
kvantiseringsfeilens størrelse i seg selv.

**Regel: kvantisering av Hs skal aldri kunne gjøre feltet MILDERE enn
kilden.** Konkret: for enhver kildeverdi `hs`, skal den dekodede verdien
`hs_kvantisert ≥ hs` (avrunding **opp**, ikke til nærmeste). Dette er en
konservativ-retning-regel, samme filosofi som `clearanceNm`s
aldri-overestimer-krav i rutemotor-spec-en (§4.1 der) — bare speilvendt,
fordi her er det den *lave* verdien som er den farlige, ikke den høye.

**Målt, ikke antatt:** med vanlig («nearest») avrunding og 19 cm trinn
(6-bit global) mistes en hard forkastelse med 6,9 cm margin (`m26`, S-8);
med samme trinn avrundet **opp** mistes ingen forkastelse, men prisen er to
falske feller over 240 medlemsevalueringer og én ankomst skjøvet ut av
dagslysvinduet. Feltprøven i måledokumentets §8.4 viser at vanlig avrunding
mister ekte overskridelser **også ved 4,7 cm trinn** (3 av 123 punkter) —
kravet gjelder derfor uavhengig av trinnstørrelse, ikke bare ved grove
trinn.

**Enhetstesten:** `decode(encode(hs)) ≥ hs` for et representativt utvalg
`hs`-verdier inkludert grenseverdier (`hs = boat.maxHsM` eksakt, `hs` like
under en kvantiseringsterskel). Låst som regresjonstest i
`packages/routing/src/pack-degradation.test.ts` («konservativ Hs sletter
aldri en hard forkastelse») og skal ha et motstykke i
`packages/weather` når den ekte kodeveien finnes (§17).

**Koblingen til §9.2 er eksplisitt, ikke to uavhengige krav:** avrunding
opp fjerner kvantiseringens bidrag til en for lav Hs, men ikke
interpolasjonens — målt underrapportering mellom tidsskivene er −0,117 m
allerede uten kvantisering ved 1 t, og −0,576 m ved 3 t. Fortegnet sikres
av avrundingen; størrelsen sikres av oppløsningen (§9.2). Ett krav uten det
andre er ikke trygt.

### 9.4 LÅST — kystsonen: operasjonell definisjon, strømoppløsning, ¼-regelen

**Strøm: NorKyst 800 m urørt i kystsonen, 1,6 km tillatt utaskjærs.**
Begrunnelsen er strukturbredde, ikke en fast kilometergrense i seg selv:
kyststrømmens fronter/virvler er 1–5 km brede, og målingens sonder
(§7.2 i måledokumentet) viser at effekten kommer når nodeavstanden nærmer
seg strukturbredden — ved 3,3 km halvbredde er det **vind-/bølgenettet på
2,5 km**, ikke strømnettet på 0,8 km, som er den begrensende faktoren
(`R-HALV` med 1,25 km reproduserer det analytiske feltet på samme sonde).
**¼-regelen** (nodeavstand ≤ ¼ av den smaleste strukturen pakken skal
representere, begrunnet i bilineær rekonstruksjon: `w_min = 4×
kildegitter`) står som **dokumentert begrunnelse, merket ekstrapolasjon**
— den er ikke en direkte måling på ekte NorKyst-data, bare på tre
syntetiske båndbredder (måledokumentets §11 forbehold 4). Produsenten skal
derfor kjøre en **byggetids-verifisering per flis**: maks avvik mellom
dekodet og kildeverdi på en valideringsdag, sjekket mot det som faktisk
sendes — ikke en antakelse om at ¼-regelen holder, en kontroll som beviser
det for hver bygget flis.

**«Kun tidevanns-hovedkomponent» er ikke et strømlag.** Målt: 5,93 % anger
på v1s referansestrekk og en plan som **ikke er gjennomførbar** under
sannheten (`tss-ved-skagen`-TSS-bruddet, §7.1 i måledokumentet). En pakke
som bare bærer tidevannets hovedkomponent skal merkes som **manglende
strømdata** (N2, samme kontrakt som §12s `hsM === undefined`-rad), ikke som
strømdata med redusert kvalitet.

**Kystsonen defineres operasjonelt slik (beslutning tatt av spec-eier under
Magnus' V3-mandat 2026-09-02 — kravspekens F2.2-revisjon delegerer nettopp
denne definisjonen hit):**

> En 32×32-nodes subflis (§7) klassifiseres som **kystsone** hvis avstanden
> fra subflisens senterpunkt til nærmeste punkt på kystlinjevektoren i
> `tools/chart-pack` (`docs/specs/farbarhetsmaske.md` §3 — samme
> vektordatasett som bygger farbarhetsmasken, ikke en ny kilde) er **≤ 20
> nm**. Er avstanden større, er subflisen **utaskjærs**.

**Hvorfor denne regelen og ikke NorKyst-dekning eller skjærgårdsklasse:**

1. **Byggbar med eksisterende data.** `tools/chart-pack` har allerede
   kystlinje som vektordata (flisdelt 0,5°×0,25°, `farbarhetsmaske.md` §3.1).
   `tools/weather-pack` kan gjøre ett avstandsoppslag per subflis mot dette
   datasettet ved byggetid — ingen ny kilde, intet nytt vedlikeholdsbehov.
   NorKyst-dekning duger ikke som kriterium: NorKyst v3 leveres nominelt i
   800 m over **hele** domenet (spikens funn), så «har NorKyst 800 m-data»
   skiller ikke kyst fra åpent hav — det ville klassifisert alt som
   kystsone. Skjærgårdsklasse (en kvalitativ kategori fra Kartverkets
   data) finnes ikke som et entydig, allerede bygget lag denne pipelinen
   kan slå opp i uten selv å definere den — det hadde flyttet problemet, ikke
   løst det.
2. **Verifiserbar.** Regelen er et rent geometrisk predikat: gitt en
   subflis og en kystlinje, er svaret deterministisk. Det kan
   enhetstestes med en fast kystlinjestrekning og en kjent subflis-grid
   (forventet klassifisering notert før testen skrives, samme disiplin som
   golden-fikstene), og produsenten kan telle andelen kystsone/utaskjærs
   per bygg og visualisere grensen på et kart for sanity-sjekk.
3. **20 nm er valgt med margin, ikke tightest mulig.** Skjærgården og
   fjordmunningene der kyststrømmens fronter/virvler er smalest (1–5 km,
   §7.2 i måledokumentet) ligger godt innenfor 20 nm fra land nesten
   overalt i det aktuelle kartområdet; 20 nm gir slingringsmonn mot at
   grensen skal treffe midt i en reell smal struktur. Dette er ikke en målt
   optimal terskel (ingen måling i denne runden tester nøyaktig 20 nm), men
   en **konservativt valgt** terskel — samme filosofi som Hs-avrundingen:
   usikker på eksakt tall, sikker på retningen (heller for mye kystsone enn
   for lite).
4. **Konservativ standardretning ved tvil.** Mangler en subflis
   kystlinjedata i sitt dekningsområde (kant av chart-pack-domenet, eller
   chart-pack ikke bygget for det området ennå), klassifiseres subflisen
   **kystsone** (den dyrere, finere retningen), aldri utaskjærs — samme
   «velg den trygge feilretningen når du er usikker»-logikk som resten av
   §9.
5. **Delt geometri med kvantiseringssubflisen (§7).** Klassifiseringen
   gjøres på **samme** 32×32-subflis-rutenett som bærer skala/offset — ett
   rutenett, to bruksområder, ikke to rutenett som kan komme i utakt.

**Dette er ikke en måling — det er spec-eierens operasjonelle valg for å
gjøre et ellers uverifiserbart krav («full oppløsning nær kysten») til noe
byggbart.** Terskelen (20 nm) er ikke fikstur-testet i
`kvantiseringsmaaling-2026-09-01.md` og står derfor med samme
forbeholdsstatus som §9.8s midlertidige punkter — men selve **eksistensen**
av en fast, geometrisk regel er en logikk-/arkitekturbeslutning, ikke en
terskel, og hører derfor hjemme i LÅST NÅ. Termen justeres om
byggetidsverifiseringen (over) viser at 20 nm systematisk klassifiserer en
reell smal strømstruktur som utaskjærs.

### 9.5 LÅST — TWS-vaktbånd, Tp-retning, strømmens manglende monotoni, dekodede skranker

**TWS-hardgrensen sammenlignes med et vaktbånd, ikke med den nakne
deklarerte grensen.** Vind lagres som u/v (§3, §9.1) og har derfor ingen
triviell «rund alltid opp»-retning for skalarfarten slik Hs har — en
kvantiseringsfeil kan gjøre dekodet TWS **lavere** enn sann TWS. For å
unngå at en sann over-grense-vind slipper gjennom en hard avvisning fordi
kvantiseringen tilfeldigvis rundet ned, skal `rutemotor.md`s
`tws > boat.maxTwsKn`-test, når feltet er kvantisert, i praksis regne
`decodedTws > (boat.maxTwsKn − maxDecodeErrorKn)`, der `maxDecodeErrorKn`
er subflisens dokumenterte maksimale dekodefeil for TWS. For normal
(«nearest») avrunding er dette `scale / 2` — allerede tilgjengelig fra
subflisens lagrede skala, ingen ny feltverdi trengs. Dette er en
matematiker-anbefalt korreksjon fra steg 3-runden, kodifisert her som krav,
ikke bare et forbehold i en rapport.

**Implementert 2026-09-02** i `packages/routing/src/expand.ts`
(`twsExceedsHardLimit`, kalt fra `checkHardNode` — det eneste stedet i motoren
`maxTwsKn` sammenlignes hardt), med `WeatherField.maxDecodeErrorKn` som
bærer av tallet (`packages/routing/src/contracts.ts`). To presiseringer
implementasjonen tvang fram:

1. **Kontrakten bærer én verdi per felt, ikke per subflis.** Motoren har
   ingen flisgeometri — den ser en `WeatherField`. Produsenten skal derfor
   oppgi **maksimum over de subflisene pakken faktisk bærer** (en gyldig øvre
   skranke for hver enkelt subflis). Finkornet per-subflis-bånd er en mulig
   senere presisjonsgevinst, aldri en senere *oppmykning* — retningen er
   låst: skranken skal aldri kunne være for liten.
2. **`scale / 2` gjelder per kanal, ikke direkte på farten.** Med u/v-lagring
   er farten `hypot(u,v)`, og en feil på `scale/2` i hver komponent gir
   `√2 · scale/2` som skranke på farten (omvendt trekantulikhet;
   interpolasjonen er en konveks kombinasjon og kan ikke forstørre den). Med
   fart+retning som lagringsform ville tallet vært `scale/2` direkte — men den
   lagringsformen er avvist (§3, §9.1). Utledningen står i kode i
   `packages/routing/test-fixtures/pack-degradation.ts`
   (`packTwsDecodeErrorKn`), som er den eneste kvantiserte
   `WeatherField`-implementasjonen som finnes før `packages/weather` bygges.

**`maxCurrentKn` har ingen hard sammenligning i v2.0** (den brukes kun i
A\*-bounden, §5.5 i rutemotor-spec-en), så vaktbåndet er per i dag et
TWS-begrep alene. Får strøm en gang en hard grense, gjelder samme regel — og
merk at strøm ikke har noen konservativ avrundingsretning i det hele tatt (se
avsnittet lenger ned), så et vaktbånd der må gå i **begge** retninger.

**Tp: konservativ retning er NED der bratthet mater derating — merket
umålt.** Bratthetsklassen `S = 2πHs/(g·Tp²)` (`docs/specs/rutemotor.md`
§4.3) betyr at en relativ Tp-feil slår inn **dobbelt** i bratthetstallet.
Symmetriargumentet med Hs tilsier at Tp bør avrundes ned (lavere Tp ⇒
brattere sjø ⇒ mer konservativ derating) — men dette er **ikke** målt slik
Hs' opp-avrunding er: måledokumentets §8.5 noterer eksplisitt at
«`H-6GO`-eksperimentets motstykke for Tp mangler». Regelen låses likevel nå
(logikk, ikke terskel) fordi symmetriargumentet er søkefritt gyldig
uavhengig av fikstur — men skal **remåles** med samme metodikk som Hs
(§8.3 i måledokumentet) når `packages/polar`s bratthetsderating er i
produksjon (§9.8).

**Strøm har ingen monoton konservativ retning — sagt eksplisitt, ikke
underforstått.** I motsetning til Hs og (med vaktbånd) TWS, finnes det ikke
en «avrund alltid opp/ned»-regel for strøm som gjør et kvantisert
strømfelt entydig tryggere enn kilden: **både medstrøm og motstrøm kan
være det farlige alternativet**, avhengig av kurs, TSS-geometri og
avdriftsretning relativt land (motstrøm reduserer SOG og øker
eksponeringstiden mot sjøgang/land; medstrøm kan gi falsk trygghet om reell
avdrift eller sette båten inn i en TSS-baklengs situasjon — nøyaktig
mekanismen `C-TID` demonstrerte). Vernet mot en kvantisert strømfeil som
gjør en rute farligere er derfor **ikke** en avrundingsregel, men
**oppløsning** (§9.4s ¼-regel) og **N5** (korridortoleransen fanger et
avvikende strømfelt som en rutediff/anger-verdi, ikke som en garantert
konservativ retning). Dette skal stå eksplisitt i kode-kommentarer der
strømdekoding skjer, slik at ingen senere «fikser» strøm med en Hs-aktig
opp/ned-regel som ikke har noen fysisk begrunnelse.

**Deklarerte `maxTwsKn`/`maxCurrentKn` regnes på de DEKODEDE verdiene.**
`search.ts`s `computeVmax` (A*-restestimatets admissibilitet,
`docs/specs/rutemotor.md`) bruker feltets deklarerte maksimum til å bygge
en øvre skranke som aldri skal undervurdere hva båten faktisk kan møte.
Kvantisering kan løfte en dekodet verdi over kildens nominelle maksimum
med inntil et halvt kvantiseringstrinn (målt **+0,09 kn** for `W-UV8G`,
den globale-skala-varianten §10 avviser av andre grunner). Produsenten skal
derfor enten (a) regne det deklarerte maksimumet **etter** dekoding
(observert maks i det faktiske, kvantiserte feltet), eller (b) deklarere
kildens maksimum pluss et halvt kvantiseringstrinn. Valg (a) foretrekkes —
det krever ingen antakelse om trinnstørrelse og er allerede billig å
beregne siden min/maks per subflis uansett beregnes for skala/offset (§9.4s
Hs-trinn-sonde er samme mønster).

### 9.6 LÅST — sentinelverdi og delt flisgeometri

**Sentinelverdi `255` = «ingen data/land» for alle 8-bit-felt, aldri
forvekslbart med `0`.** `0` er en gyldig dekodet verdi under mange
skala/offset-kombinasjoner (vindstille, ingen strøm) og kan derfor ikke
brukes som mangel-markør. Produsenten skal garantere at ingen gyldig
kildeverdi i en subflis kan kode til rå byteverdi `255` under den valgte
skala/offset (dvs. skalaen velges slik at det reelle maksimumet i
subflisen encoder til ≤ 254, eller `255` ekskluderes eksplisitt fra
encode-området). Dekoderen returnerer `undefined` (samme kontrakt som §12)
når den leser rå byte `255`, uansett felt.

**Flisorigo delt med kartflisene, og NorKyst-kystfliser er egne, mindre
fliser.** Se §7 for full begrunnelse: værflisenes 2°-rutenett forankres i
samme heltallsorigo som kartflisenes 0,5°×0,25°-rutenett (delt prefetch);
strøm får **egne, mindre fliser (0,5°–1°)** fordi NorKyst-strukturen er
finskala nok at 2°-værflisens subflis-oppløsning (32×32 noder over 2°) ikke
gir nok noder per strømstruktur i kystsonen — kystflisene for strøm er en
egen geometri, ikke en gjenbruk av vind/bølge-subflisene.

### 9.7 LÅST — dekodingskontrakt: kvantisert er den residente representasjonen

**Prinsipp (presiserer og delvis korrigerer §15s formulering — se
oppdateringen der):** den kvantiserte byte-payloaden er selve den
residente representasjonen i klienten, ikke en midlertidig form på vei til
en fullt dekodet kopi. **Standardveien er å dekvantisere per oppslag,
direkte fra `Uint8Array`** — én verdi (eller de fire naboverdiene til en
bilineær interpolasjon) konverteres til `number` idet A*-søket faktisk
spør om den, og resultatet kastes igjen. Det finnes **ingen** implisitt
«dekod hele feltet til `Float32Array` først» steg i normalveien.

**Fullt dekodede `Float32Array`-kopier lages kun ved profilert behov** —
dvs. når måling faktisk viser at per-oppslag-dekvantisering er en
ytelsesflaskehals for et gitt felt/medlem, ikke som en generell
optimisme om at det vil bli det. Når det skjer, er mønsteret **per medlem,
dekode-og-slipp**, med et **tak på samtidige dekodede kopier lik antall
Web Worker-tråder** — aldri 30 fulle `Float32`-felt i minnet samtidig
(N6: JS-heap < 500 MB under ensemble-kjøring). Dette er en innstramning av,
ikke en motsigelse til, §15 punkt 3s progressive semantikk: progressiv
betyr «ett medlem av gangen», dette legger til «og som utgangspunkt ikke
engang ett fullt medlem av gangen — bare det oppslaget som faktisk trengs
akkurat nå».

### 9.8 MIDLERTIDIG — terskler som remåles på ekte MEPS/NorKyst-data i fase 3

Disse er **ikke uavklarte i betydningen «vent»** — implementer med tallene
som står. De er merket midlertidige fordi de er målt på **syntetiske**
fikstur-felt (måledokumentets §11 forbehold 3, 6, 7), og skal **remåles**
når `tools/weather-pack` bygger sin første ekte pakke (§17 pkt. 7):

1. **Hs-trinn ≤ 5 cm.** Målt realisert trinn ved flis-skala er
   1,17–1,24 cm på fikstursamlingen (§9.1 i måledokumentet,
   `tools/kvantisering/hs-trinn.mjs`) — trygt god margin til 5 cm-kravet,
   men terskelen selv er «fiksturbetinget»: en ekte MEPS/WAM800-scene med
   brattere Hs-gradient innenfor én subflis kunne i prinsippet gi et annet
   realisert trinn. Byggetids-kontrollen (min/maks Hs per subflis og skive,
   allerede beregnet for skala/offset) skal kjøres på ekte data så snart
   pipelinen finnes, og en subflis som bryter 5 cm skal enten deles
   (mindre subflis) eller flagges.
2. **«1 t holder»-tilstrekkeligheten.** At 1 t tidsoppløsning fanger
   frontpassasjer og Hs-topper godt nok for harde felt er målt på én
   analytisk frontfikstur (§6.2, §8.4 i måledokumentet) med en kjent,
   uoppløst begrensning (10 nm vindstille-stripe, §11 forbehold 6 der).
   Ekte MEPS-fronter kan ha andre bredde-/hastighetskombinasjoner.
3. **5 km-grensen for fallback-/etter-48t-felt (§9.1 pkt. 3).** At 10-bit
   kvantisering på 5 km er «trygt nok» for disse to smale unntakene er
   ekstrapolert fra `K-ANB-UTASKJAERS`s 8-bit-måling (som i seg selv
   flippet toppavgangen) og fra det generelle prinsippet at finere
   kvantisering delvis kompenserer for grovere nett — **ikke** en direkte
   måling av 5 km + 10-bit sammen. Fallback-scenarioet er per definisjon
   sjeldent i drift; første gang det faktisk trer i kraft i produksjon bør
   det logges og sammenlignes mot kontrollfeltet samme kjøring, som en
   ekstra, gratis datapunkt mot denne terskelen.

**Note (besluttet 2026-09-02, midlertidig eierskap): hvordan 48 t-horisonten
telles i gjennomførbarhetsandelen (F4.2).** Medlemshorisonten på 48 t (§9.1
pkt. 4) betyr at et medlems rute kan stoppe fordi **feltet tok slutt**, ikke
fordi seilasen var umulig. Rutemotoren rapporterer da
`coverage.weather = "partial"` (`packages/routing/src/reconstruct.ts`), og
ingen dokument sa før nå hvordan det skal telles. Regelen:

> Et medlem med `coverage.weather = "partial"` telles som **INKONKLUSIVT**
> (egen kategori), **aldri som gjennomførbart og aldri som
> ugjennomførbart**. Andelen inkonklusive rapporteres sammen med
> gjennomførbarhetsandelen. **> 20 % inkonklusive på én avgang ⇒ horisonten
> er for kort for den seilasen** — avgangen flagges i UI som «prognosen rekker
> ikke fram», ikke som en dårlig avgang. Retningen er konservativ: et medlem
> vi ikke har vær nok til å dømme, skal verken pynte på eller ødelegge
> statistikken.

Hvorfor ikke de to enklere alternativene: teller man partial som
gjennomførbart, blir lange seilaser systematisk for optimistiske (jo lenger
ruten er, jo flere medlemmer slipper unna med å bli avkortet før uværet);
teller man partial som ugjennomførbart, straffes lange seilaser like
systematisk, og gjennomførbarhetsandelen slutter å måle været. Begge skjuler
det som faktisk skjedde — at prognosen ikke rakk fram — og bryter N2s ærlige
degradering.

**Terskelen 20 % er valgt, ikke målt** (samme tall og samme rolle som
ADR-0005s inkonklusiv-porter, bevisst likt for å ha én mental modell), og
avgrensningen mot `partial` av *andre* grunner enn horisonten (hull i feltet,
degradert kilde) er ikke skilt ut her — rutemotorens flagg er i dag ett flagg.
**Endelig eier er `docs/specs/robusthet.md` (fase 4)**, som eier F4.2s
aggregering; denne noten er den kontrakten robusthet-spec-en arver og kan
skjerpe, ikke et konkurrerende regelverk. Samme beslutning står som
konsekvenspunkt i `docs/decisions/ADR-0005-ensemble-mekanisme.md`.

### 9.9 Kontrakt: `QuantizationParams`

```ts
// packages/weather — låst kontrakt (§9), ikke lenger placeholder.
interface QuantizationParams {
  /** 8 for vind/strøm/Hs/Tp i normaldrift (§9.1, §9.3). 10 KUN for de to
   *  smale 5 km-unntakene (fallback, kontrollens hale > 48 t — §9.1 pkt. 3).
   *  16 er reservert via formatVersion, ikke brukt i v2.0. */
  readonly bitsPerSample: 8 | 10;
  readonly scale: number;                // per subflis (§7), per tidssteg
  readonly offset: number;
  /** Hs: ALLTID "up" (§9.3). Tp: "down" når feltet brukes til
   *  bratthetsderating (§9.5 — låst logikk, umålt terskel, §9.8).
   *  TWS/vind-komponenter og strøm: "nearest" — se §9.5 for hvorfor disse
   *  IKKE har en triviell avrundingsretning, og vaktbånd/N5 brukes i
   *  stedet for retningsvalg i selve kvantiseringen. */
  readonly roundingMode: "nearest" | "up" | "down";
  /** Rå byteverdi reservert som "ingen data/land" (§9.6). ALLTID 255 for
   *  8-bit-felt i v2.0 — feltet finnes i kontrakten for å gjøre
   *  sentinelverdien eksplisitt i kode, ikke for å tillate at den varierer. */
  readonly sentinelRawValue: 255;
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
degraderingen N2 forbyr.

**Fallback-dybde besluttet 2026-09-02 (§18 pkt. 2):** MET-produktets eget
0–6 t aldersspenn mellom medlemmer i én kjøring er OK og krever ingen
spesialbehandling ut over aldersspenn-feltet over. Er *hele siste kjøring*
ufullstendig, faller batch-jobben tilbake **maks to kjøringer tilbake
(~12 t)**. Er heller ikke den komplett, rapporterer pakken **«ingen
brukbart ensemble»** (kontrollmedlemmet kan fortsatt leveres alene, med
`sourceStatus: degraded` og tydelig årsak) — batch-jobben leter **ikke**
videre bakover. Begrunnelse: et ensemble bygget på en kjøring som er over
12 t gammel gir robusthetslaget (fase 4) et spredningsestimat fra en
prognose som i praksis er en annen prognose enn den kontrollen/vinden
ellers viser — det er «villedende eldre ensemble» kravspekens N2-prinsipp
forbyr, ikke bare «gammelt ensemble». Terskelen for hvor mye lag-dybde
robusthetslaget faktisk trenger å kjenne til *per medlem* (utover
aldersspennet som helhet) er fortsatt en implementasjonsdetalj for
`docs/specs/robusthet.md` (fase 4), ikke noe denne spec-en låser videre.

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
| NorKyst-nedtynning aktiv (utaskjærs, §9.4) | ikke degradert — dette er en **villet** kvalitetsreduksjon innenfor budsjett, ikke et datahull | `resolution`-strengen viser den faktiske, nedtynnede oppløsningen (1,6 km, aldri den native 800 m hvis den ikke faktisk ble levert) |
| «Kun tidevanns-hovedkomponent» tilgjengelig, ingen NorKyst-strøm | **`degraded`** — dette ER et datahull, ikke en villet nedtynning (§9.4) | Merkes manglende strømdata (N2), ikke strømdata med redusert kvalitet |

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

**Rettet 2026-09-03 (D4, spec-drift lukket):** denne seksjonen spesifiserte
tidligere `/api/weather/pointer` og `/api/weather/blob/:contentHash`. Det
var aldri det `apps/worker` faktisk bygget (`docs/specs/app-skjelett.md`
§6.2/§6.3, fase 3 bølge 1D) — koden bruker de generiske, pakketype-nøytrale
stiene `/pointer/:name` og `/blob/:key`, fordi R2-nøkkelmønsteret allerede
er delt mellom vær- og kartpakker. **Stiene under er nå én sannhet med
`app-skjelett.md` §6.2** — se den for full rutetabell og ADR-0006 for
tilgangsmodellen (to bindinger: offentlig speil vs. personlig, se under).

Workeren eier **kun** proxy/cache og pakke-pekere (ADR-0002: klienten
beregner, skyen forbereder) — ingen NetCDF-dekoding, ingen kvantisering
skjer her.

```
GET /pointer/:name
  → pointer/<name>.json, f.eks. pointer/vaer-skandinavia.json
    (cachet, kort levetid — ETag/If-None-Match mot R2)
  Svar: { formatVersion, tiles: [{ tileId, bbox, fields: [{ field, member,
          key, hash, header: PackageHeader }] }] }

GET /blob/:key
  → binærblob fra R2, f.eks. weather/1/<contentHash>.bin
    (immutable — cache-control: max-age lang, siden innholdsadressert
    data aldri endres under samme hash; edge-cachet i tillegg via
    Workerens `caches.default`)
```

**R2-bindingen** `:key`/`:name` slås opp mot er ADR-0006s **offentlige
speil** (`MIRROR_BUCKET` i `apps/worker/wrangler.toml`, fysisk bøtte
`morild-mirror`) — IKKE samme binding som den personlige F6.1-synk-dataen
(D1, `PERSONAL_DB`, tom til fase 5) bruker. `/pointer/` og `/blob/`
importerer strukturelt ikke `PERSONAL_DB` i det hele tatt; se ADR-0006 og
`app-skjelett.md` §6.6.

**Versjoneringsflyt:** klienten holder sin egen `clientFormatVersion`
(kompilert inn, ikke hentet), kaller `/pointer/:name`, og bruker
`checkCompatibility` (§5) på hver `header.formatVersion` FØR den ber om
noen `/blob/:key`. Inkompatibel major → klienten viser en forståelig
melding (F2.3) og fortsetter på sist synkede lokale pakke hvis en finnes
(F6.4: offline først).

**Punkt-API-et for MetAlerts** går gjennom `/proxy/metalerts` (ikke
`/api/weather/point/...` som tidligere utkast antok — samme sti-retting
som over) med korrekt User-Agent og cache-headere (§16) — det er ikke et
innholdsadressert R2-blob, det er et ferskt JSON-svar med kort levetid.
**D2 (ADR-0006 pkt. 4, 2026-09-03):** ruten tar IKKE imot noen
klientstyrt `bbox`- eller annen query-parameter (en tidligere `bbox`-
passthrough var reelt en klientstyrt cache-buster). Den henter alltid hele
Skandinavia-settet fra MET én gang per TTL og server det uendret;
**filtrering til synlig kartutsnitt er klientens ansvar** (`apps/pwa`).
Responsen har to ekstra headere klienten skal lese: `fetched-at` (ISO 8601
— når innholdet sist ble bekreftet gyldig mot MET, IKKE "nå" for hver
respons) og `source-status` (`"ok"` i denne bølgen; `"degraded"` reservert
for en fremtidig MET-utilgjengelighet-fallback, ikke bygget ennå — se
`apps/worker/src/routes/metalerts.ts`s toppkommentar for det kjente
gapet). Ruten har også én Cloudflare rate-limit-regel foran seg
(`apps/worker/wrangler.toml` `[[ratelimits]]`) som misbruksvern — se
ADR-0006 pkt. 4.

Tidevann/nowcast har ingen egen proxy-rute bygget ennå (åpent, ikke en del
av denne rettingen).

---

## 15. Klientens dekodingskontrakt (F3.5)

**Prinsipp, presisert 2026-09-02 (§9.7 låser dekodingskontrakten mer
eksplisitt enn F3.5 alene gjorde):** kvantisert byte-payload lastes som
`ArrayBuffer`, sendes **transferable** til en Web Worker (unngår
COOP/COEP-fellen — strukturert kloning av store buffere er dyrt og/eller
blokkert av isolasjonshoder), og forblir den **residente** representasjonen
i workeren — den dekvantiseres **per oppslag**, ikke til en forhåndsbygget
`Float32Array` som standardvei (§9.7). Et fullt dekodet `Float32Array` for
et medlem er et **unntak for profilert ytelsesbehov**, ikke normalveien.

**Kontrakt:**

1. Worker mottar `{ contentHash, quantizationParams, buffer: ArrayBuffer }`
   (buffer transferred, ikke kopiert). `buffer` beholdes som `Uint8Array`
   i workeren — dette ER den residente representasjonen (§9.7).
2. **Standard oppslagsvei:** `decodeAt(buffer, params, i, j, t) → number`
   (eller de fire nabo-oppslagene en bilineær interpolasjon trenger) er en
   **ren funksjon** — ingen I/O, ingen tilstand, samme regler som
   rutemotorens renhetskrav (`docs/specs/rutemotor.md` §5.1). Resultatet
   brukes og kastes; det bygges ingen mellomliggende full kopi av feltet.
3. **Unntaksvei (profilert behov):** `decodeAll(buffer, params) →
   Float32Array` finnes som en egen, separat ren funksjon for de tilfellene
   måling faktisk viser at gjentatte per-oppslag-dekvantiseringer er en
   flaskehals. Brukt, er mønsteret **per medlem, dekode-og-slipp**, med et
   **tak på samtidige dekodede kopier lik antall Web Worker-tråder**
   (§9.7) — aldri 30 fulle `Float32`-felt i minnet samtidig (N6: JS-heap
   < 500 MB under ensemble-kjøring).
4. Uansett vei, skjer arbeidet **per medlem, ved behov** — progressiv
   semantikk (ADR-0005): kontrollmedlemmet behandles for alle avganger
   først; øvrige 29 medlemmer behandles progressivt mens de
   streames/brukes, ikke alle på forhånd.
5. **Hs-avrundingsregelen (§9.3) håndheves i dekodingen, ikke et sted
   nedstrøms** — uansett om oppslagsveien eller unntaksveien brukes, er
   det én kodevei for Hs-avrunding, og den kan enhetstestes isolert
   (`decode(encode(hs)) ≥ hs`) uten å bygge en hel rutepakke.
   **TWS-vaktbåndet (§9.5)** håndheves i rutemotorens **harde nodesjekk**,
   ikke i dekoderen selv — dekoderen returnerer den rå dekodede farten;
   vaktbånd-korreksjonen er en policy i
   `packages/routing/src/expand.ts::twsExceedsHardLimit`, kalt fra
   `checkHardNode`, ikke en endring av selve tallet.
   **Rettet 2026-09-02 (§19):** dette punktet pekte tidligere på
   `packages/routing/src/clearance.ts`. Det var feil sted: `clearance.ts` eier
   kystbufferen (`docs/specs/rutemotor.md` §5.3.2) og ser aldri TWS. Den harde
   TWS-grensen sammenlignes ett eneste sted i motoren —
   `expand.ts::checkHardNode`, som søket, evaluatoren og rekonstruksjonens
   sluttetappe alle kaller (én sannhet, `rutemotor.md` §5.3/§5.11). Feltet
   `WeatherField.maxDecodeErrorKn` (kontrakten i
   `packages/routing/src/contracts.ts`) bærer båndet inn dit; syntetiske og
   Float32-felt oppgir `0`, og adferden er da bit-identisk med den nakne
   sammenligningen.
6. Dekodede verdier for værUAVHENGIGE felt (strøm — §4) deles på tvers av
   medlemmer (ADR-0005s presisering om delte read-only-cacher gjelder
   identisk her); vind/bølge dekodes per medlem og aldri delt (de ER
   medlemsspesifikke).

---

## 16. API-vilkår, User-Agent og backoff (N3, N4)

**Skrevet 2026-09-03 — MET Norway- og Kartverket-vilkårene finnes nå i
`docs/legal/`:** `docs/legal/met-norway-api.md` (api.met.no:
Locationforecast, Oceanforecast, MetAlerts), `docs/legal/met-norway-thredds.md`
(thredds.met.no: MEPS, NorKyst v3, WAM800/Oceanforecast-grid, inkl.
arkivpolitikken §18 pkt. 4 bygger på) og `docs/legal/kartverket-tideapi.md`
(vannstand.kartverket.no). Innholdet under er en kort oppsummering til
implementasjonstidspunktet — **de tre filene er fasit ved konflikt**, ikke
denne oppsummeringen:

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
- **THREDDS har ingen tallfestet rate-grense** (til forskjell fra
  api.met.nos 20 req/s) — vilkåret der er i stedet et eksplisitt forbud
  mot **parallelle OPeNDAP-sesjoner** pluss en generell rett for MET til
  å blokkere IP-er ved overbelastning (`met-norway-thredds.md`). Alle
  OPeNDAP-kall i `tools/weather-pack` skal derfor være **sekvensielle**,
  samme disiplin som spiken allerede fulgte.
- **Backoff ved 429/503:** eksponentiell backoff med tak, IKKE umiddelbar
  retry-løkke. THREDDS-spiken observerte 503 på NCSS gjennomgående — en
  pipeline som slår hardt tilbake mot en nede tjeneste er dårlig
  medborgerskap selv om den til slutt lykkes. Samme disiplin gjelder mot
  Kartverkets tideapi, som selv dokumenterer at responspauser på flere
  minutter forekommer (`kartverket-tideapi.md`). Konkret backoff-skjema
  (starttid, multiplikator, tak, antall forsøk før `sourceStatus:
  degraded` og fallback til forrige kjøring) er en implementasjonsdetalj,
  ikke en arkitekturbeslutning — men **skal finnes i kode, ikke bare i en
  kommentar om at man burde ha det**.
- **Lisens CC BY 4.0** (MET og Kartverket) — attribusjon i UI, jf.
  kravspek N3. DMI-deriverte data (hvis/når DMI tas i bruk, F2.1 «faset
  inn senere») skal merkes som avledet, ikke MET-attribuert.

---

## 17. Testkrav (F2.5, N5)

1. Retningskonvensjon-tester (§3, punktene 1–3) — kjente verdier, ikke
   egenskapstester alene.
2. Interpolasjon-tester (§3, punkt 4–5) — bilineær rom, lineær tid, på
   syntetiske felt med kjent analytisk svar.
3. Hs-avrundingsregelen (§9.3) — `decode(encode(hs)) ≥ hs` over et
   representativt utvalg inkludert grenseverdier, inkludert regresjonstesten
   fra `packages/routing/src/pack-degradation.test.ts` portert til den ekte
   `packages/weather`-kodeveien.
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
   engangs manuell sjekk. Kjøres tidlig (§8), ikke først ved fase-slutt,
   gitt at det oppdaterte regnestykket ligger nær grensen.
8. **Kystsone-klassifiseringen (§9.4)** — gitt en fast, kjent
   kystlinjestrekning og et kjent subflis-grid, verifiser at
   avstandsberegningen klassifiserer forventede subfliser som kystsone/
   utaskjærs (forventning notert før testen skrives), og at manglende
   kystlinjedekning defaulter til kystsone (§9.4 punkt 4), ikke utaskjærs.
9. **TWS-vaktbåndet (§9.5) — skrevet 2026-09-02, ikke lenger et krav som
   venter.** Gitt en kjent `maxTwsKn` og en kjent `maxDecodeErrorKn`,
   verifiser at **den harde nodesjekken** (`expand.ts::checkHardNode` via
   `twsExceedsHardLimit` — ikke klareringssjekken, se §15 pkt. 5s rettelse)
   forkaster en node der dekodet TWS er innenfor vaktbåndet under den nakne
   grensen, ikke bare når den er over selve `maxTwsKn`. Finnes nå i
   `packages/routing/src/expand.test.ts` (enhetsnivå, inkl. at
   `maxDecodeErrorKn = 0` gir bit-identisk adferd) og
   `packages/routing/src/pack-degradation.test.ts` (på et faktisk kvantisert
   8-bit-felt: naken sammenligning mister harde forkastelser, vaktbåndet
   mister ingen). Skal **porteres til den ekte `packages/weather`-kodeveien**
   når den finnes — der er kravet i tillegg at `maxDecodeErrorKn` faktisk
   regnes fra de brukte skala-parametrene og ikke settes til 0 «foreløpig».
10. **Sentinelverdi 255 (§9.6)** — verifiser at encoder aldri produserer rå
    byteverdi 255 for en gyldig kildeverdi i en gitt subflis (dvs. at
    skala/offset-valget faktisk overholder garantien), og at dekoderen
    returnerer `undefined` når den leser 255, for alle 8-bit-felt.
11. **Dekode-og-slipp-taket (§9.7)** — en test/property som viser at antall
    samtidig dekodede fulle `Float32Array`-kopier (unntaksveien) aldri
    overstiger antall Web Worker-tråder, i et scenario som stresser flere
    medlemmer «samtidig».

---

## 18. Beslutninger 2026-09-02 (tidligere åpne spørsmål til Magnus)

Alle sju punktene under sto som åpne spørsmål i utkast v0.1. Magnus besluttet
dem samlet 2026-09-02, sammen med §9-formatlåsingen. Historikken beholdes
(spørsmålsformuleringen viser *hvorfor* — samme disiplin som resten av denne
spec-ens endringslogg), men punktene er ikke lenger åpne.

1. **WAM800-subsetting — BESLUTTET.** Spiken kjøres **etter** fase 3-start,
   ikke som blokkerende forutsetning. Oceanforecast punkt-API (bølger med
   periode langs korridoren) er en **gyldig førsteleveranse** for fase 3-exit
   — se §7 punkt 5 for hvordan dette er skrevet inn i subsetting-geometrien.
   *(Opprinnelig spørsmål: skal spiken kjøres før eller etter at
   `tools/weather-pack` bygges?)*
2. **Lagged-ensemble-dybde — BESLUTTET.** MET-produktets eget 0–6 t
   aldersspenn er greit uten spesialbehandling. Fallback ved ufullstendig
   siste kjøring går **maks to kjøringer tilbake (~12 t)**; deretter
   rapporteres «ingen brukbart ensemble» — pipelinen leter ikke lenger
   bakover for å unngå en villedende eldre ensemble-tilstand. Se §11 for
   den fulle regelen. *(Opprinnelig spørsmål: hvor gammelt kan et medlem
   være, og hvor langt tilbake skal fallback-kjeden gå?)*
3. **Flisstørrelse — BESLUTTET.** 2°×2° med ≤ 32×32-nodes subfliser for
   skala/offset (samme subflis-grid brukt til kystsone-klassifisering, §9.4).
   Se §7. *(Opprinnelig spørsmål: er 2° fornuftig, eller bør flisene være
   grovere/finere?)*
4. **Arkivpolitikk for R2 — BESLUTTET.** 7 døgns rullerende arkiv for
   værpakker, bevisst kortere enn kartpakkenes (kystlinjedata endrer seg
   sakte; værprognoser blir ubrukelige på dager). F3.3-kalibrering bruker
   METs eget hindcast-arkiv, ikke vårt R2-vindu. Se §5. *(Opprinnelig
   spørsmål: hvor mange generasjoner beholdes, og bør værpakker i det hele
   tatt beholdes lenge for kalibreringsformål?)*
5. **MetAlerts-geometri — BESLUTTET.** Et varsel vises når varselpolygonet
   skjærer rutesporet bufret **5 nm**, eller inneholder start-/målpunktet.
   Aktivt kulingsnivå (eller sterkere) farger anbefalingen. Se §4.5.
   *(Opprinnelig spørsmål: buffer i nm, eller hele polygonet ved
   overlapp?)*
6. **Sikt-kilde — BESLUTTET (utsatt, ikke blokkerende).** Kilden er
   fortsatt ikke identifisert; en liten oppfølgingsspike på
   `fog_area_fraction` (eller tilsvarende proxy) kjøres senere, som egen
   bølge. Blokkerer **ikke** fase 3-exit. Se §4.6. *(Opprinnelig spørsmål:
   egen spike nå, eller vente til senere fase?)*
7. **EOF-encoding — BESLUTTET (bekreftet).** Forblir en ren
   formatreservasjon i v2.0 (`encoding: "raw"` overalt); `k`-eksperimentet
   på ekte MEPS-data er en forskningsoppgave uten forpliktelse til å ta
   `eof`-encoding i bruk. Se §10 — uendret fra utkastet, ingen ny
   informasjon fra kvantiseringsmålingen endret denne vurderingen.
   *(Opprinnelig spørsmål: bekreftelse av at dette forblir en ren
   reservasjon.)*

**Ingen nye åpne arkitekturspørsmål gjenstår i denne spec-en per
2026-09-02.** Gjenværende usikkerhet er implementasjonsdetaljer (eksakt
backoff-skjema §16, eksakt healthcheck-payload-form §13, MetAlerts-
fargekoding §4.5) eller §9.8s daterte remålingspunkter — ingen av dem
krever et nytt valg mellom retninger fra Magnus for at implementasjonen kan
starte.

---

## 19. Endringslogg

- **2026-09-03 (5) — Klienten kobler på ekte vær ende-til-ende (fase 3
  bølge 2C, pwa-agenten).** `apps/pwa`: pakke-peker → Cache API (eget
  navnerom per formatversjon-major, `navigator.storage.persist()` ved
  SW-registrering) → transferert `ArrayBuffer` → `planRoute` på
  kontrollmedlemmet, deretter ensemble-medlemmer progressivt over en
  worker-pool (`navigator.hardwareConcurrency`), MetAlerts filtrert i
  klienten mot rutesporet (§4.5-kontrakten, gjenbruker
  `@morild/charts`s punkt-/segmentprimitiver — ingen ny geometrikode i
  `packages/weather`). To presiseringer i `@morild/weather` (§15s
  dekodingskontrakt, ikke en formatendring):
  1. **`readLayerFrame`/`readLayerFrames`** (`package-format.ts`) og
     **`windMemberLayersFromBytes`** (`field.ts`): ingen eksisterende
     funksjon lot en konsument dele opp et vind-medlems konkatenerte u+v-
     blob (`tools/weather-pack::buildWindMemberPackage`s faktiske
     byte-layout) tilbake til to lag — dette var et reelt klientgap, ikke
     bare mangel på et bekvemmelighetswrapper.
  2. **`toWeatherField`s nye `isControl`-overstyring**
     (`weather-field-adapter.ts`): en per-medlem worker-pool bygger én
     `WeatherPackage` med `windMembers` av lengde 1 PER kall — uten en
     eksplisitt overstyring ville ethvert medlem blitt tolket som
     kontrollen (alltid indeks 0 i sin egen ett-elements array) og
     feilaktig fått full horisont i stedet for 48 t-medlemsgrensen (§9.1
     pkt. 4). Bakoverkompatibel (default uendret: `memberIndex === 0`).
  **Funn, viktig for `docs/specs/robusthet.md` (fase 4):**
  `packages/routing/src/search.ts::environmentAt` setter
  `coverage.weather = "partial"` så snart `waves === undefined ELLER
  current === undefined` i ETT ENESTE punkt — ikke bare når et medlems
  48 t-horisont faktisk er brukt opp. Med en vind-only-pakke (dagens
  reelle tilstand, jf. (4) under og `tools/weather-pack`s README) er
  `coverage.weather` derfor ALLTID `"partial"`, for ALLE medlemmer,
  også kontrollen — og ADR-0005s inkonklusiv-regel («partial ⇒
  inkonklusiv, aldri gjennomførbar/ugjennomførbar»), mekanisk anvendt,
  gjør da HELE ensemblet inkonklusivt. Dette er ærlig (N2) og ikke en
  feil, men gjør F4.2s gjennomførbarhetsandel ikke-meningsfull før
  strøm/bølge faktisk finnes i pakken — verifisert med to isolerte
  integrasjonstester (`apps/pwa/src/weather/pipeline.test.ts`) som
  skiller "felt mangler helt" fra "medlemshorisont brukt opp". Ingen
  endring i `packages/routing` gjort eller foreslått her (utenfor denne
  bølgens mandat — rutemotor-endringer eies av @agent-rutemotor);
  robusthet-spec-en bør ta stilling til om de to fenomenene trenger et
  skille i `coverage`-kontrakten når strøm/bølge faktisk lander.
- **2026-09-03 (4) — Første EKTE MEPS-pakke bygget og målt, vind-only
  (fase 3 bølge 2A, vær-analytikeren).** `tools/weather-pack build-live`
  koblet `--live` til ekte, sekvensiell OPeNDAP-henting mot
  `mepslatest` (§11s `selectEnsembleRun` kjørt mot en EKTE katalog og
  faktiske DDS-oppslag, ikke bare enhetstestet), bygde en ekte,
  kvantisert, delta-kodet vindpakke for de to 2°-flisene
  (`5_28`,`5_29`) Skjæløy–Skagen-ruten faktisk krysser. Full måling,
  funn og anbefaling: `docs/research/pakkestoerrelse-ekte-2026-09-03.md`.
  **To reelle konvensjonsfeil funnet og rettet** (nøyaktig den typen
  CLAUDE.md advarer om, «v1 hadde subtile konvensjonsfeller her»): (1)
  MEPS' `x_wind_10m`/`y_wind_10m` er i **m/s**, men §3 krever **knop** —
  INGEN kode konverterte, usett fordi hele testsuiten kjørte mot
  enhetsløse syntetiske fixtures (`pipeline.ts::convertWindComponentsToKnots`,
  ny, kalt eksplisitt i live-banen, IKKE i den delte
  `fetchWindComponents` — se kommentaren der for hvorfor). (2) MEPS'
  u/v er griddrelative (Lambert-projeksjonens egne x/y-akser, CF
  `standard_name "x_wind"/"y_wind"`), ikke sann øst/nord —
  `tools/weather-pack/src/lambert-rotation.ts` (ny) roterer til sann nord
  FØR kvantisering (2,7–6,3° konvergensvinkel i vår bbox). Rundtur-
  verifisering etter begge rettelser: 0,0001–0,0286 kn avvik, godt
  innenfor `maxDecodeErrorKn`-budsjettet. **Budsjettfunn (§8, viktig for
  Magnus):** ekte MEPS-vind komprimerer nesten ikke med delta+gzip
  (faktor **1,06×**, mot §8s antatte 1,5–2,5× og det syntetiske feltets
  7,29×) — vind alene for de to nødvendige flisene er **27,4 MB**,
  nær hele det opprinnelige 30 MB-budsjettet FØR strøm/bølge/metadata er
  lagt til. §8s budsjettregel («>30 MB ⇒ 40 MB-forslag til Magnus») er nå
  reelt utløst, ikke lenger en fjern mulighet — se rapporten §7 for
  alternativer (ingen valgt her). Pekerformatet fikk et nytt, valgfritt
  `missingFields`-felt (`package-writer.ts::PointerTileEntry`) som
  eksplisitt markerer strøm/bølge som `degraded`/manglende for denne
  bølgens pakke (§12/N2 — vises, aldri skjules), IKKE tatt inn i §5/§14s
  formelle kontrakt ennå (§19-kandidat i rapporten). R2-opplasting IKKE
  gjennomført — bøtta `morild-data` finnes ikke på kontoen ennå (§16 i
  rapporten dokumenterer nøyaktig kommandoen Magnus må kjøre).
- **2026-09-03 (3) — D4 spec-drift lukket, D2/ADR-0006 pkt. 4 implementert
  (fase 3 bølge 2B, plattform-agenten).** §14 rettet: `/api/weather/pointer`
  og `/api/weather/blob/:contentHash` var aldri det `apps/worker` bygget —
  stiene er nå `/pointer/:name`/`/blob/:key`, samme sannhet som
  `app-skjelett.md` §6.2 (ingen kodeendring, kun dokumentasjonen rettet).
  MetAlerts-proxyen (§14) mistet sin `bbox`-passthrough (klientstyrt
  cache-buster, D2) og fikk `fetched-at`/`source-status`-svarheadere +
  én rate-limit-regel (ADR-0006 pkt. 4). `apps/worker`s R2-binding er
  omdøpt `DATA_BUCKET` → `MIRROR_BUCKET` (bøtte `morild-data` →
  `morild-mirror`, ADR-0006 pkt. 1) og har fått en søster-binding
  `PERSONAL_DB` (D1, ADR-0006 pkt. 2, tom til fase 5) som `/pointer/` og
  `/blob/` strukturelt ikke importerer. `/blob/` har fått edge-cache
  (`caches.default`) og svarer 404 (ikke 400) for nøkler utenfor
  `ALLOWED_BLOB_PREFIXES`, identisk med et ekte R2-miss (review-funn,
  ADR-0006 Bekreftelse). Se `apps/worker/wrangler.toml`,
  `docs/decisions/ADR-0006-tilgangsmodell.md`.
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
- **2026-09-02 — status endret til gjeldende; §9 låst (todelt); §18
  besluttet samlet.** Grunnlag:
  `docs/research/kvantiseringsmaaling-2026-09-01.md` (inkl. §9.1-tillegget
  2026-09-02, kjørt etter fagagent-review) og kravspekens F2.2-revisjon
  samme dato. Endringer:
  - **§9 skrevet fullt ut**, merket punkt for punkt LÅST NÅ / MIDLERTIDIG
    (§9.8). Låst: u/v 8-bit byte-alignet (10-bit avvist, §9.1); kontroll OG
    medlemmer 2,5 km, 5 km kun for fallback/etter-48t-felt med 10-bit
    (§9.1); medlemshorisont 48 t (§9.1); 1 t for harde felt m/énsidighets-
    invariant for eventuell senere grovning (§9.2); Hs alltid opp (§9.3,
    uendret prinsipp, nå formelt vedtatt); TWS-vaktbånd, Tp ned (umålt),
    strøm uten monoton retning, deklarerte skranker på dekodede verdier
    (§9.5); sentinel 255, delt flisorigo (§9.6); dekodingskontrakt
    presisert til per-oppslag-dekvantisering som standard, full
    `Float32Array`-dekoding kun ved profilert behov (§9.7 — **§15 oppdatert
    tilsvarende**, ikke lenger i motstrid). Midlertidig, datert
    remåling i fase 3: Hs-trinn ≤ 5 cm, «1 t holder», 5 km-grensen for
    fallback/etter-48t (§9.8).
  - **Kystsonen definert operasjonelt** (§9.4): 32×32-nodes subflis
    klassifiseres kystsone hvis senterpunktet er ≤ 20 nm fra nærmeste
    kystlinje i `tools/chart-pack`s vektordata; ellers utaskjærs; manglende
    kystlinjedekning defaulter til kystsone. Beslutning tatt av spec-eier
    under Magnus' V3-mandat — terskelen (20 nm) er ikke fikstur-testet og
    står med samme forbeholdsstatus som §9.8.
  - **§18 besluttet samlet** og omdøpt til beslutningslogg: WAM800-spike
    etter fase 3-start (Oceanforecast punkt er gyldig førsteleveranse),
    lagged-ensemble-fallback maks 2 kjøringer (~12 t) så «ingen brukbart
    ensemble», 2°-fliser m/32×32-subfliser, R2-arkiv 7 døgn (kalibrering
    bruker METs hindcast-arkiv), MetAlerts 5 nm-buffer/inneholder-endepunkt,
    sikt utsatt (ikke blokkerende), EOF bekreftet ren reservasjon.
  - **Budsjettregnskapet i §8 oppdatert og oppjustert**: vind-medlemmer
    (2,5 km, 48 t, 8-bit) regner nå ~32 MB rått / ~20–28 MB etter
    delta+gzip — vesentlig mer enn utkastets `~6 MB ved 8-bit/5 km`-
    placeholder, fordi 5 km-lettelsen for medlemmer er avvist. Nytt sum-
    overslag ~25–37 MB, ikke lenger klart under 30 MB-grensen; F2.2s
    betingede budsjettrevisjon til ~40 MB er derfor en reell, ikke bare
    hypotetisk, mulighet — budsjett-reverifiseringstesten (§17 pkt. 7) bør
    kjøres tidlig.
  - §4.1 (vind), §4.2 (strøm), §4.5 (MetAlerts), §4.6 (sikt), §5
    (arkivpolitikk), §6 (resolution-strenger), §7 (flisrutenett, WAM800,
    delt flisorigo), §11 (lagged-ensemble fallback), §12 (ny rad for
    «kun tidevann»-degradering), §15 (dekodingskontrakt) oppdatert til å
    reflektere §9/§18-beslutningene i stedet for å peke til dem som åpne.
  - Ingen endring i §3s retningskonvensjoner eller §10s EOF-vurdering —
    disse sto allerede riktig fra 2026-09-01.
- **2026-09-02 (2) — konsistensreview av værpakke-bølgen: tre funn lukket.**
  Funnene kom av at §9 ble låst raskere enn kode og naboavsnitt fulgte etter.
  - **Funn 1 (sikkerhet) — TWS-vaktbåndet fantes bare i spec-en, ikke i
    koden.** §9.5s krav
    (`decodedTws > maxTwsKn − maxDecodeErrorKn`) er nå implementert:
    `WeatherField` (`packages/routing/src/contracts.ts`) har fått
    `maxDecodeErrorKn` (feltets/pakkens maksimale dekodefeil på vindfart;
    syntetiske og Float32-felt oppgir 0), og
    `packages/routing/src/expand.ts` har fått den delte funksjonen
    `twsExceedsHardLimit(env, boat, field)` som `checkHardNode` kaller.
    **Kallstedsgjennomgang:** den harde TWS-sammenligningen fantes ett
    eneste sted i motoren (`checkHardNode`), og søket (`search.ts`, både
    ekspansjonen og Tub-forhåndsruten), evaluatoren (`evaluate.ts`) og
    rekonstruksjonens sluttetappe (`reconstruct.ts`) går alle gjennom den —
    `corridor.ts` og `bailout.ts` sammenligner ikke TWS hardt i det hele
    tatt (`bailout.ts` har sin egen harde Hs-grense per havn, som ikke er
    kvantiseringsutsatt på samme måte, §9.3). `maxCurrentKn` sammenlignes
    **ingen steder** hardt — den brukes kun i Vmax-skranken — så vaktbåndet
    er per i dag et TWS-begrep alene; skulle strøm en gang få en hard
    grense, gjelder samme regel og den skal da inn i samme delte funksjon.
  - **A\*-bounden verifisert (§9.5 siste avsnitt, §9.6).** `computeVmax`
    (`search.ts`) og bail-out-varianten bruker `weather.maxTwsKn`/
    `weather.maxCurrentKn` som deklarerte skranker. Motoren kan ikke selv
    verifisere at de er regnet på *dekodede* verdier — det er produsentens
    plikt — men plikten er nå skrevet på selve kontraktsfeltet i
    `contracts.ts`, der den brytes hvis noen tar tallet fra kilden.
    **Vaktbåndet svekker ikke bounden:** det senker terskelen noder
    forkastes på, så enhver akseptert node har lavere TWS enn før, mens
    Vmax er uendret. Restestimatet forblir admissibelt (`rutemotor.md`
    §5.5).
  - **Tester.** `expand.test.ts`: vaktbånd-enhetstester (verdi rett under
    grensen men innenfor dekodefeilen ⇒ avvist; skarphet på det flyttede
    grensepunktet; dekodefeil 0 ⇒ bit-identisk adferd *og* uendret
    avvisningstekst; båndet gjelder ikke Hs). `pack-degradation.test.ts`:
    ny gruppe som pakker et felt som `W-UV8G` (8-bit u/v, én global skala —
    konfigurasjonen målingen fant +0,09 kn på), måler mot **referansepakken**
    (isolerer kvantiseringen fra grid/tid) og viser at den nakne
    sammenligningen mister harde forkastelser der vaktbåndet ikke mister
    én — begge halvdeler asserteres, ellers hadde testen ingen tenner.
    Regresjon: alle sju golden-ruter **bit-identiske** (syntetiske felt har
    `maxDecodeErrorKn = 0`).
  - **Funn 2 (dokumentasjon) — 48 t-horisont vs. F4.2-telling** besluttet
    og skrevet inn: ny note i §9.8 (`coverage.weather = "partial"` ⇒
    INKONKLUSIVT, > 20 % ⇒ horisonten er for kort, flagges i UI), med
    `docs/specs/robusthet.md` (fase 4) som endelig eier. Samme beslutning
    lagt inn som konsekvenspunkt og falsifiseringsport i ADR-0005.
  - **Funn 3 (mindre) — §8s budsjettabell** presisert: harde felt (Hs, TWS)
    er 1 t gjennom **hele** kontrollens horisont; «hard-felt-vinduet» var en
    tvetydig formulering og er fjernet, med eksplisitt setning om at det
    ikke finnes noe vindu utenfor hvilket harde felt kan tynnes.
  - **§15 pkt. 5 rettet:** vaktbåndet håndheves i `expand.ts::checkHardNode`
    (delt funksjon), ikke i `clearance.ts` — `clearance.ts` eier kystbufferen
    og ser aldri TWS. `docs/specs/rutemotor.md` §4.2/§5.3 og dens
    endringslogg oppdatert tilsvarende.
- **2026-09-03 — `packages/weather` bygget (fase 3 bølge 1B): formatmodul,
  feltmodell, adapter, konvensjonstester, golden-bro.** Implementerer §3,
  §7, §9, §12, §15, §17 i kode for første gang (`packages/weather/src/`:
  `quantize.ts`, `wind-codec.ts`, `delta.ts`, `tiles.ts`,
  `package-format.ts`, `field.ts`, `weather-field-adapter.ts`, `age.ts`,
  `budget.ts`, `samples.ts`). 68 nye tester + 2 arkitekturtester
  (`tools/arch-tests` utvidet til `packages/weather/src`, §"Ufravikelige
  prinsipper" 3/CLAUDE.md). Presiseringer/avvik gjort under implementasjon,
  ingen av dem endrer LÅST logikk eller terskler:
  - **Sentinel-hull ved 10-bit, generalisert (§9.6, §9.9).** §9.9 låser
    `sentinelRawValue: 255` som TS-literal for BÅDE 8-bit og 10-bit, men
    for 10-bit (2¹⁰ = 1024 koder) er `255` ikke toppkoden — en naiv «reserver
    toppkoden»-implementasjon ville enten kollidert med en gyldig
    midt-i-området-verdi (10-bit) eller sløst 768 koder. Implementert som
    en «kompakt indeks» som hopper over rå byteverdi 255 (`quantize.ts`,
    `compactToRaw`/`rawToCompact`): for 8-bit reduserer dette seg eksakt
    til «koder 0..254, ingen hull» (uendret adferd på den dominerende,
    testede stien); for 10-bit brukes 1023 av 1024 mulige koder, ikke bare
    de 254 laveste. Dette var underspesifisert i §9.9 (som ikke sier HVORDAN
    255 unngås ved 10-bit), ikke en endring av noe låst.
  - **10-bit lagres som 2 byte (u16), ikke bit-pakket (§9.1 pkt. 1, pkt. 3,
    `package-format.ts`).** §9.1 pkt. 1 avviser 10-bit for normaldrift
    delvis fordi det «er bit-pakkingsoverhead (ingen byte-alignering) uten
    en målt gevinst» — men sier ikke hvordan de to 10-bit-unntakene (§9.1
    pkt. 3) faktisk skal lagres. Ekte bit-pakking (5 byte per 4 prøver) er
    ikke implementert her — en dokumentert, budsjettmessig pessimistisk
    forenkling (dobbelt så mange byte som teoretisk minimum for disse to
    smale, sjeldne stiene) som `tools/weather-pack` kan erstatte med ekte
    bit-pakking uten å røre dekodingskontrakten (`QuantizationParams` er
    uendret uansett byte-layout).
  - **Delta-koding (§8s "delta+gzip") levert som delt, testet primitiv
    (`delta.ts`), ikke fullt innkoblet i `package-format.ts`s
    subflis-lagring ennå.** §9.9s låste `QuantizationParams`-kontrakt
    nevner ingen delta-modus — det bekrefter at delta-koding er et
    transportlags-tiltak (byte-transform for gzip-vennlighet), ikke en del
    av selve kvantiseringsskjemaet. `encodeTemporalDeltaU8`/
    `decodeTemporalDeltaU8` er bit-eksakt rundtur-testet og klar for
    `tools/weather-pack` å ta i bruk når den bestemmer per-subflis-
    lagringen; å faktisk oppnå 1,5–2,5×-tallet mot ekte kvantiserte fliser
    er den pipelinens jobb, ikke denne modulens.
  - **Budsjett-tallet er en formel, ikke en bygget pakke (§8, §17 pkt. 7).**
    `budget.ts::estimatePackageBudget` regner etter §8s tabellformler; en
    syntetisk Skjæløy→Skagen-bbox (2,3°×2,5° margin, 2,5 km vind, 48 t,
    30 medlemmer) gir **vind-medlemmer ≈ 31,5 MB rått** (samsvarer med §8s
    «~32 MB rått») og **rå totalsum ≈ 39,8 MB**, dvs. allerede over den
    opprinnelige 30 MB-grensen FØR delta+gzip — konsistent med §8s
    observasjon om at regnskapet «ikke lenger er klart under budsjettet».
    Estimert sum etter et 2×-delta/gzip-anslag (midtpunkt av 1,5–2,5×)
    ≈ 19,9 MB. Dette er fortsatt IKKE en målt, ekte bygget pakke (§17
    pkt. 7 gjenstår til `tools/weather-pack` finnes) — tallet er en
    krysssjekket formel (verifisert mot faktisk `buildLayer`-byte-
    forbruk i `budget.test.ts`), ikke en byggetids-måling.
  - **`tools/weather-pack` funnet allerede under bygging, parallelt (annen
    agent).** Der finnes en midlertidig lokal
    `format-contract.ts`/`quantize.ts` («TODO: erstattes av
    @morild/weather») med samme grensesnittnavn (`QuantizationParams`,
    `WindSample`, `CurrentSample`, `WaveSample`,
    `windComponentsToSample`/`windSampleToComponents`,
    `computeScaleOffset`, `encodeValue`/`decodeValue`,
    `computeMaxDecodeErrorKn`, `twsExceedsHardLimitWithGuardBand`).
    `packages/weather/src/index.ts` eksporterer nå kompatibilitetsaliaser
    under nøyaktig disse navnene, slik at overgangen som er forespeilet der
    («samme funksjonsnavn... bytte er en importendring, ikke en
    omskriving») faktisk blir det. **Ikke reconcilert:** deres
    `quantize.ts::computeScaleOffset` bruker `maxRawValue = 2^bits − 2`
    (reserverer TOPPKODEN) uavhengig av bit-bredde — for 10-bit betyr det
    at rå byteverdi 255 IKKE unngås spesifikt (kolliderer i prinsippet med
    en gyldig midt-i-området 10-bit-kode, se sentinel-hull-punktet over).
    Deres egen `verifiesSentinelNeverCollides`-sjekk ville fanget dette ved
    byggetid for en konkret flis, men formelen produserer det latente
    problemet i utgangspunktet. Siden 10-bit er et smalt, ikke-blokkerende
    unntak (§9.1 pkt. 3), flagges dette her for reconciliering når de to
    bølgene møtes — ikke rettet i `tools/weather-pack` av denne agenten
    (utenfor oppdraget, og filene der er under aktiv, samtidig endring).
  - **Ingen ekte, frosset MEPS-testpakke levert (§3 punkt 6, §17 pkt. 6).**
    Denne bølgen har ingen tilgang til å hente og manuelt verifisere et
    ekte MEPS-uttrekk mot en uavhengig kilde (`ocean.met.no` e.l.) — spec-en
    er eksplisitt om at dette ALDRI skal være en syntetisk generator.
    `packages/weather/fixtures/` er derfor IKKE opprettet i denne bølgen;
    alle konvensjons- og interpolasjonstester (§17 pkt. 1–2) kjører mot
    syntetiske, analytiske felt (samme disiplin som
    `packages/routing/test-fixtures`). Dette er en åpen leveranse, ikke en
    stille utsettelse — F2.5s «ekte testpakke»-krav står ufullført til
    noen (batch-jobben, eller Magnus manuelt) faktisk henter og verifiserer
    et uttrekk.
- **2026-09-03 (2) — `tools/weather-pack` byttet til `@morild/weather`
  (fase 3 bølge 1D): sentinel-hull forent, delta-koding koblet inn, første
  ekte pakkestørrelse målt.** Fullfører reconsilieringen forrige punkt
  flagget.
  - **Sentinel-hull ved 10-bit, forent.** `tools/weather-pack`s lokale
    `format-contract.ts`/`quantize.ts` (`TODO: erstattes av
    @morild/weather`) er slettet. `pipeline.ts`, `package-writer.ts`,
    `source-status.ts` og `quantize.test.ts` importerer nå
    `@morild/weather`/`@morild/protocol` direkte (workspace-avhengighet i
    `tools/weather-pack/package.json`). `packages/weather`s
    `compactToRaw`/`rawToCompact`-løsning (§9.6, forrige punkt) er nå
    eneste implementasjon. Ny test
    (`packages/weather/src/quantize.test.ts`) sveiper HELE det
    representerbare kompakt-indeks-området for både 8- og 10-bit og
    beviser at `encodeLinear` aldri produserer rå 255 for noen gyldig
    verdi.
  - **Ett til avvik reconsiliert, oppdaget under selve bytte-jobben (ikke
    tidligere flagget):** weather-packs `computeScaleOffset` ga `scale=1`
    for en degenerert subflis (`min===max`, f.eks. vindstille over hele
    subflisen). `@morild/weather`s `computeLinearParams` gir bevisst
    `scale=0` her: dekoding blir da EKSAKT kildeverdien for enhver gyldig
    kompakt indeks (null kvantiseringsfeil), dokumentert i
    `package-format.ts` og forutsatt av golden-bro-testens krav om
    `maxDecodeErrorKn=0` for konstante felt. `scale=1` ville gitt et
    (ubrukt, men semantisk feil) ett-trinns "spøkelses"-avvik ved
    dekoding av en teoretisk raw≠0-verdi. `tools/weather-pack`s
    tilsvarende test er oppdatert til å bevise `scale=0`, med forklarende
    kommentar om hvorfor tallet endret seg.
  - **Delta-koding koblet inn i subflis-lagringen (§8).** Forrige bølge
    leverte `encodeTemporalDeltaU8`/`decodeTemporalDeltaU8` som en testet,
    men ukoblet primitiv (payload var node-major/tid-innerst, primitiven
    tid-major/node-innerst). `package-format.ts` har fått
    `deltaEncodeLayerPayload`/`deltaDecodeLayerPayload` (transponerer
    mellom de to layoutene, kaller SAMME `delta.ts`-primitiv — ingen ny
    delta-matematikk) og `serializeLayer`/`deserializeLayer` har fått en
    `deltaCoded`-opsjon som gjenbruker headerens tidligere reserverte
    byte som flagg. En dekodet `Layer` er alltid i rå kvantiserte koder —
    `deltaCoded` er usynlig for enhver forbruker, ren transportlags-
    transform (bekrefter forrige bølges antakelse). Kun 8-bit støttes
    (kaster eksplisitt for 10-bit, en sjelden, ikke-budsjett-dominerende
    sti, §8). Bit-eksakt rundtur-testet
    (`packages/weather/src/package-format.test.ts`), og
    `tools/weather-pack::buildWindMemberPackage` bruker det nå som
    standard (`deltaCoded: true`).
  - **Pipeline-trinnene skriver nå ekte pakkelag.** Den forrige, ad-hoc
    subflis-løkken (`encodeWindChannelForMember`, egen lokal
    serialisering) er erstattet av `buildWindMemberLayers` (bygger
    `Layer`-objekter via `@morild/weather::buildLayer`) og
    `buildWindMemberPackage` (serialiserer via `serializeLayer`).
    **Dokumentert forenkling, ikke løst:** `windLayerGeometry` behandler
    det hentede OPeNDAP-indeksvinduet som om nodene er jevnt fordelt over
    bboxen i lat/lon — MEPS' native rutenett er faktisk en
    Lambert-projeksjon. Korrekt for byte-regnskapet (node-/byte-antall er
    identisk uansett projeksjon), men IKKE geografisk nøyaktig. Ekte
    reprojeksjon er gjenstående arbeid, samme kategori som
    `grid.ts::classifyCoastalZone`s injiserte avstandsfunksjon.
  - **Første ekte pakkestørrelse (§8, §17 pkt. 7).** Ny
    `tools/weather-pack/src/measure-full-size.ts` (kjørt manuelt, IKKE en
    del av `pnpm test` — for tung til å kjøre på hver kjøring) bygde en
    ekte pakke for Skjæløy→Skagen (samme bbox som
    `packages/weather/src/budget.test.ts`) på §9s låste oppløsning: **31,49
    MB rått, 4,32 MB etter delta+gzip** (faktor 7,29×). Skrevet inn i §8
    over og `tools/weather-pack/README.md`, merket «målt på syntetisk felt
    (glatt — ekte MEPS komprimerer trolig dårligere)» — det rå tallet
    krysssjekker node-/byte-regnskapet godt (31,49 MB mot estimatets
    ~32 MB), men kompresjonsfaktoren er IKKE overførbar til ekte data.
  - **Testtall:** `packages/weather` 72 tester (opp fra 68 forrige bølge —
    sentinel-sveip, delta-payload-integrasjon, serialize/deserialize
    med `deltaCoded`). `tools/weather-pack` 100 tester (samme scenarioer
    som før, nå mot den delte modulen, pluss ekte-lag- og
    delta/gzip-smoke-tester). Alle pakker: 654 tester grønt (`pnpm test`),
    `pnpm check`/`tsc -b`/`pnpm test:arch` uendret grønt.
  - **Drive-by-funn, ikke del av oppdraget men rettet i samme fil:** en
    pre-eksisterende, `Math.random()`-basert flaketest i
    `packages/weather/src/package-format.test.ts`
    (`layerMaxDecodeError`-gruppen) feilet i ca. 1 av 3 kjøringer fordi
    testens geometri (`nodesLat:40, tileNodes:32`) uventet ga TO
    subflis-RADER (fire subfliser, ikke to som kommentaren antok) — begge
    "brede" subflisene fikk uavhengig tilfeldig spredning, og testen leste
    kun én av dem. Rettet ved å redusere til én subflis-rad
    (`nodesLat:32`), verifisert stabil over 8+ gjentatte kjøringer.
