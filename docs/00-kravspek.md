# Kravspesifikasjon RoutePlanner v2 «Morild»

- Status: **GODKJENT av Magnus 2026-08-30 (v1.0)**
- Historikk: v0.1 og v0.2 (etter review fra seiler- og arkitekt-agent, se
  `docs/research/review-seiler.md` og `review-arkitekt.md`) samme dag
- Grunnlag: `docs/research/` (v1-analyse, marked, kartdata, værdata/ensemble,
  plattform, to reviews)

## 1. Formål og visjon

En personlig værruter og seilasplanlegger for Dufour 41 «Morild» som:

1. foreslår ruter som er **trygge** (tolker kartdata maskinelt — dybder,
   skjær, tørrfall, bruer/luftspenn, trafikkseparasjon — ikke bare kystlinje
   som v1),
2. er **robuste** (vurderer følsomhet for endringer i vind, bølger, strøm,
   avgangstid og båtytelse — og hva en plan B koster: bail-out-alternativer
   er en del av robusthetsbegrepet),
3. kjører som **app på Android-telefon og -nettbrett**, hostet på Magnus'
   Cloudflare-konto, offline med sist synkede data.

Geografisk omfang: **Skandinavia** (norskekysten, Skagerrak/Kattegat, svenske
og danske farvann, vestlige Østersjøen). Resten av verden utenfor scope.

Markedsposisjonering: robusthetsvurdering finnes kun i PredictWind
Professional (offshore) og racing-verktøyet Expedition; dybdedata-
kvalitetstransparens finnes ingen steder. Appens to unike kjerner.

## 2. Bruksscenarier (styrende)

- **S1 Kveldsplanlegging:** «Skjæløy → Skagen, avgang i morgen 06–14»
  (kandidater per time). Appen viser trafikklys + klartekst per avgang:
  «Robust. Regn med inntil 31 t (typisk 27). Frisk SV slør hele veien, verst
  utenfor Skagen natt til lørdag. Lengste strekk uten nødhavn: 6 t.» Skjøre
  avganger vises med hvorfor.
- **S1b Morgen-re-sjekk:** over morgenkaffen: diff mot gårsdagens plan på
  ferske kjøringer — «planen holder» eller «vinduet har krympet, ny
  anbefaling».
- **S2 Underveis-revisjon:** telefon i cockpit, «revider herfra»; målt vs.
  prognose flagges og svekker tilliten eksplisitt.
- **S3 Trygg skjærgårdsrute:** Bohuslän: aldri grunnere enn sikkerhetskontur,
  aldri under for lav bru/spenn, farled foretrekkes, tynn dybdedekning
  merkes «verifiser mot sjøkart her».
- **S5 Retur-deadline:** «Hjem i Skjæløy senest søndag 18:00 — hvor langt tør
  jeg gå?» Baklengs-planlegging mot frist med risikotall («35 % risiko for
  hard motorkryss hjem hvis du går til Skagen nå»).
- **S6 Havnevalg mot morgendagens vær** (fase 5+): «hvor bør vi ligge i natt,
  gitt SV frisk i morgen?» — ly-retning per havn mot prognose.
- **S4 Ukesplan** (fase 4+, lav prioritet): rekkevidde over flere dager.

## 3. Funksjonelle krav

### F1 Kart og farbarhet (kjerne 1: «kart som tolkes»)

- **F1.0** **Prefabrikkert-prinsipp** (Magnus' føring 2026-08-30): all
  kystlinje-, dybde- og farbarhetsprosessering skjer i byggetid
  (chart-pack-pipeline → ferdige pakker i R2) — aldri runtime-henting/
  -beregning i klienten slik v1 gjorde med Overpass. Klienten laster kun
  ferdigberegnede, versjonerte pakker.
- **F1.1** Farbarhetsmaske for norske farvann fra Kartverkets åpne vektordata
  (dybdepunkt, dybdekurver, tørrfall, grunne, skjær) + Kystverkets farleder.
  **V1-semantikk: ren polygonalgebra** — sjøareal ∖ (areal grunnere enn
  sikkerhetskonturen ∪ tørrfall ∪ buffrede skjær/grunner), der
  sikkerhetskonturen er nærmeste kartlagte dybdekurve ≥ (dypgang + margin) —
  ECDIS-logikk (med 2,6 m terskel: 5 m-kurven). Kontur-constrained
  interpolasjon er en senere forbedring, kun hvis konturen måles for
  restriktiv. Masken er **statisk ved sjøkartnull** (null vannstand =
  konservativt); ingen tidevanns-åpning av grunne områder i v2.0.
- **F1.2** Sikkerhetsmargin: statisk margin (std. 0,5 m) **+ sjøgangstillegg**
  (f(Hs), grovt +0,5×Hs på eksponerte segmenter) — marginen brukes ved valg
  av sikkerhetskontur og ved flagging. **Negativ meteorologisk vannstand**
  (Kattegat/Bæltene/Østersjøen kan gå 0,5–1 m under referansen ved
  østavind/høytrykk) hentes fra vannstandsprognose og vises som flagget
  risiko på berørte segmenter.
- **F1.3** Føre-var-regel og tillitsnivåer: areal mellom sonderinger antas
  aldri trygt. Tre nivåer per segment — `trygt` / `usikkert` (tynn/gammel
  dekning; tillatt men flagget) / `no-go` — synlige på ruten. Kartverkets
  datakvalitetslag eksponeres i UI (unik funksjon).
- **F1.4** **Seilingshøyde:** no-go der fri høyde < mastehøyde + margin
  (bruer, luftspenn — Sotenkanalen-klassen feller). Vertikale hindre hentes
  fra kartdata og ligger i masken på linje med dybde.
- **F1.5** **Trafikkseparasjon og skipsleder:** TSS (Skagen, Oslofjorden) og
  ferge-/skipsledkorridorer som statiske kartobjekter i masken med
  geometriregel (kryss på tvers, ikke langs — Regel 10) og kostnad; vises i
  UI. Krever ikke AIS.
- **F1.6** **Verne- og forbudssoner** med datointervall (fågel-/
  sälskyddsområden i Bohuslän, skytefelt) som sesongbevisste no-go/
  unngå-soner.
- **F1.7** Svenske/danske farvann: beste åpne kilde (EMODnet, DDM, OSM) med
  eksplisitt lavere tillit og **sterk farled-bias** (ruten holder hovedled;
  avvik flagges). `ChartSource`-abstraksjon; **datum per kilde er et felt i
  kontrakten** (DDM er middelverdi-modell, ikke sjøkartnull).
- **F1.8** Kartvisning: MapLibre GL, Kartverket sjøkartraster-WMTS,
  egenbygde PMTiles-vektorlag, OpenSeaMap-merker. Attribusjon + «ikke for
  navigasjon»-disclaimer.
- **F1.9** Offline: valgte kartområder (raster + vektor + maske) uten nett.

### F2 Vær- og havdata (kjerne 2: «beregninger som fungerer riktig»)

- **F2.1** **v2.0-kjernestack (bevisst kuttet):** MEPS 2,5 km / 30 medlemmer
  (≤ 61 t) for vind · NorKyst-800 for strøm · MET Oceanforecast/WAM800 for
  bølger (med periode!) · Kartverket tideapi + vannstandsprognose · MET
  Nowcast underveis. **Faset inn senere:** > 61 t-horisont via Open-Meteo
  ensemble-API (ECMWF som JSON — ingen egen GRIB2-stack); DMI/CMEMS når
  Østersjø-turer planlegges.
- **F2.2** Værpakker: cron-batch → komprimerte, innholdsadresserte felt i R2,
  **faste fliser over Skandinavia per modellkjøring** (ikke on-demand).
  **Budsjett: ≤ 30 MB per rutepakke** (revidert 2026-09-02 etter
  kvantiseringsmålingen, `docs/research/kvantiseringsmaaling-2026-09-01.md`):
  8-bit kvantisering m/per-flis skala/offset, u/v i byteformatet;
  **ensemble-medlemmer og kontroll på 2,5 km** (5 km målt
  rangeringsfarlig — toppavgang-flipp fra oppløsningen alene; 5 km
  tillates kun for fallback-/etter-48 t-felt, da med 10-bit);
  **medlemshorisont 48 t** (primærkutt, rangeringsnøytralt for
  avgangsvinduet), kontroll full horisont; **felt som inngår i harde
  avvisninger (Hs, TWS) alltid 1 t innen horisonten** (3 t målt å miste
  felle-medlem via interpolasjon), 3 t kun for felt uten hard-semantikk;
  Hs avrundes alltid opp; delta-koding + gzip. **NorKyst-strøm beholdes
  på 800 m i kystsonen** (kystsonen defineres operasjonelt i
  `specs/vaerpakker.md`); «kun tidevannskomponent» er ikke et strømlag.
  Budsjettregel: den ekte pakken måles i fase 3; lander den over 30 MB
  tross delta+gzip, legges budsjettrevisjon frem for Magnus med målt
  tall — rangeringskvalitet ofres ikke for et rundt tall. **Målt
  2026-09-03 (`docs/research/pakkestoerrelse-ekte-2026-09-03.md`): ekte
  MEPS komprimerer 1,06×, vind alene 27,4 MB. Besluttet D6-C: interim tak
  50 MB slik at bølge 3 kan starte; endelig tall settes på
  entropi-/kompresjonsmåling (fast fysisk LSB, medlem−kontroll-residual,
  romlig prediktor, 1°-fliser) — og fast LSB låses først etter at
  kvantiseringsharnessen er re-kjørt på den (sikkerhetssemantikk).
  2,5 km / 1 t / 30 medlemmer røres ikke.**
  Lagged-ensemble-politikk: siste komplette 30 medlemmer (én fil per
  kjøring med ensemble-dimensjon, jf. `spike-thredds.md`), aldersspenn i
  metadata.
- **F2.3** Pakkeformat er **versjonert (semver)**; app avviser høyere major
  med forståelig melding; forrige generasjon beholdes i R2.
- **F2.4** Alle felt bærer metadata (modell, init, oppløsning, alder) og
  **kildestatus** («06Z manglet — dette er 00Z»); UI viser alder og årsak;
  batch-jobben pinger healthcheck (varsling når pipelinen er død > 12 t).
- **F2.5** Interpolasjon og retningskonvensjoner (vind FRA, strøm MOT)
  enhetstestes; frossen **ekte** MEPS-testpakke i repoet.
- **F2.6** **Offisielle farevarsler (MetAlerts)** vises for området langs
  ruten i avgangstabellen; aktivt kuling-/stormvarsel farger anbefalingen.
- **F2.7** **Sikt** fra modellene inn i etappesammendraget; flagg «sikt
  < 1 nm ventet i trafikkert farvann». Påvirker ikke rutingen i v2.0.

### F3 Rutemotor

- **F3.1** Rutemotoren designes fra **beste praksis og teori** (metodikk-
  gjennomgang → ADR før implementasjon: isokron-familien er bransjestandard
  for seilruting, men graf-/tidsekspanderte alternativer og nyere
  litteratur vurderes eksplisitt). **v1 er referanse og fasit-baseline** —
  innsiktene derfra (celle-pruning, bautstraff, A*-vannavstandsfelt på grov
  oppløsning 500 m–1 km dekoblet fra maskens, segmentvis
  sikkerhetsettersjekk, stagnasjonsvakt) tas med der metodikkgjennomgangen
  bekrefter dem, ikke portert ukritisk. Ren, deterministisk kjerne.
  *(Presisert etter Magnus' føring 2026-08-30: ikke legg for mye vekt på
  v1s løsninger.)*
- **F3.2** Båtmodell fra v1: polarer (PTE/GTE), cruising-faktor, motorseiling
  m/drivstoff (standard **7,0 kn / 4,0 l/t**, alltid justerbart i UI —
  besluttet 2026-08-30), maks TWS. Bølgegrenser og derating som funksjon av
  **bratthet (Hs/Tp²-klasse)**, ikke Hs alene, og eksplisitt
  **vind-mot-strøm-flagg** på segmenter der komponentene står mot hverandre
  over terskel (Skagerrak/Kattegat-fella).
- **F3.3** Polar-kalibrering mot v1-loggene (SOG − historisk NorKyst-strøm;
  Kattegat-bins uten strømfasit kalibreres SOG-basert m/flagg). Kjøres når
  THREDDS-tooling finnes (etter fase 3-spike) — ikke i fase 2s exit.
- **F3.4** Kostnadsfunksjon utover tid: kryssandel (vekt skalert med
  etappelengde), motorandel, natt-timer — og **dagslys-ankomst som hardt/
  mykt krav** («ankomst soloppgang+1 til solnedgang−1»); mørketimer som
  skravur i avgangstabellen; kryss-timer i mørket vises separat.
  Konfigurerbart **maks sammenhengende etappetid**-tak (mannskap).
- **F3.5** Ytelse (revidert 2026-09-01 per ADR-0005; opprinnelig
  omdefinert etter arkitekt-review): S1 er 150–210 kjøringer, ikke 30.
  **Progressiv beregning er UX-kontrakten**: kontrollmedlem for alle
  avganger først (tabell på sekunder), deretter ensemble strømmet per
  avgang — full ensemble-analyse for valgt/topp-avgang < 60 s; øvrige
  avganger kan strømme over lengre tid. **Medlemmer kjøres med samme
  fulle Pareto-søk og samme kursoppløsning som kontrollen** (E1′-målt:
  redusert medlemsoppløsning gir utrygge gjennomførbarhetstall med
  fortegnsflip, og skalar/etikett-tak sparer bare 2–11 % — se
  ADR-0005 med falsifiseringsporter). Delt A*-felt/Tub-bound og delte
  read-only-cacher for væruavhengige oppslag. Minnemodell: **per-medlem
  transferable ArrayBuffers** (unngår COOP/COEP-fellen); dekoding
  kvantisert→Float32 i worker on demand.
  **Revidert 2026-09-04 (D8.13, D8.2):** «< 60 s for valgt/topp-avgang»
  er en **hypotese under ADR-0005 port 1/2** til PC-remåling av én avgang
  og nettbrett-målingen er kjørt (målt grunnlag: 67–99 s per avgang på PC
  på full oppløsning); progressiv semantikk er kontrakten uansett utfall,
  og UI lover ikke 60 s før tallet finnes. Delt Tub-bound kun som *soft*
  bound med redningsvei (et medlem beskåret av bound telles aldri
  ugjennomførbart), aldri i R2-søk. Se `docs/specs/robusthet.md` §4.1/§6.
  **Revidert 2026-09-05 (D10.1, D9.1):** spak 7 målt (PC, 6°/1800 s, delt
  felt: 79–87 s sekvensielt per avgang, pool-anslag 16–23 s med 5–6
  workere). «< 60 s» strykes som løfte. **Kontrakten:** kontrollruten for
  alle avganger på sekunder; robusthetstallene bygges utelukkende fra
  fulle søk mens seileren ser på — hvert tall er enten endelig (30 av 30)
  eller vist som tellinger med eksakte skranker; advarsler kan bli
  endelige før alle er ferdige, grønt aldri; appen lover ingen ferdig-tid
  og viser målt tid. Delt Tub er forkastet (D9.1); delt A*-felt beholdes.
  Ytelsesspaker (profilsøk, alloc-fri hot-loop, read-only-cacher) tas
  etter nettbrett-tallet og etter fase 4a bølge 3–5, betinget av tallet.

### F4 Robusthet (kjerne 3: appens signatur)

- **F4.1** Ensemble-ruting per medlem med delt A*-felt (fase 4a).
- **F4.2** Robusthetsmål fase 4a: spredning i seilingstid (P50/P90),
  gjennomførbarhetsandel innenfor grensene, spredning i kryss-/motorandel.
  **Fase 4b (forskningsdel, etter 4a):** geometrisk korridor-stabilitet og
  automatisk følsomste-faktor-attribusjon.
- **F4.3** Sensitivitet utover vær: perturber avgangstid, cruising-faktor
  og strøm. **Revidert 2026-09-04 (D8.4):** cruising-faktor {0,85; 0,90;
  0,95} og strøm ×{0,8; 1,2} på kontrollen, pluss cruising 0,85 på verste
  gjennomførbare medlem for valgt avgang; opprinnelig ±0,05 var for smalt
  mot v1-loggenes 0,86–1,21 (regimeavhengig — noteres som kjent
  forenkling). Perturbasjoner påvirker aldri trafikklyset og merkes
  «basert på kontrollvær». **Implementert 2026-09-05 (bølge 4,
  `docs/specs/robusthet.md` §4.4):** `perturbationPlan`/
  `summarizeSensitivity` i `packages/robustness` — planen (5–6 søk: 3
  cruising- + 2 strømfaktorer på kontrollen, pluss cruising 0,85 på
  verste gjennomførbare medlem) og aggregeringen er rene funksjoner;
  selve søkene kjøres av appen. Motoren mangler i dag en cruising-/
  strømskaleringsknapp på `RouteInput` — se pakkens egen
  toppkommentar for hva som må bygges (`BoatModel`-/`WeatherField`-
  dekoratorer) før perturbasjonene faktisk kan kjøres.
- **F4.4** **Presentasjon (etter seiler-review):** trafikklys + én setning
  klartekst; P90 som *plantid* («regn med inntil 31 t»), ikke statistikk;
  følsomste faktor som **beslutningsregel med klokkeslett** («sjekk 05:30:
  har vinden dreid SV? Hvis ikke — utsett»); **vær-langs-ruten-bånd**
  (tidslinje med vindpiler/bølge, ensemble-vifte). Persentiler, medlemstall
  og korridorplott bak et trykk.
- **F4.5** Rangering etter robust ytelse (P90 + gjennomførbarhet), ikke
  beste-tilfelle; skjøre ruter vises med hvorfor. Avgangsvindu med
  **1 times oppløsning** (solgangsbris-timing), robusthetskolonner.
- **F4.6** **Bail-out i robusthetsbildet:** kuratert nødhavn-/ankringsliste
  (starter som personlig havnebok — Magnus' egne notater, synket) + per
  rutekandidat: «lengste strekk uten brukbart alternativ: X t» og tid til
  nærmeste bail-out gjennom passasjen.

### F5 Underveis (live)

- **F5.1** GPS (forgrunn), «revider herfra», XTE mot plan.
- **F5.2** Målt-vs-prognose-avvik senker rutens tillit og foreslår re-ruting.
- **F5.3** v1-broen (NMEA→HTTP) og Signal K som valgfrie kilder.
  Bakgrunns-GPS krever Capacitor — utenfor v2.0, forberedt via
  `LocationProvider`.

### F6 Persistens, eksport, app

- **F6.1** Ruter/analyser/innstillinger lagres lokalt + synk telefon↔
  nettbrett med **last-write-wins per objekt** (`updated_at` + enhets-ID);
  lagringsteknologi (D1-skjema vs. R2/KV JSON-blobber) avgjøres i ADR —
  enkleste som oppfyller LWW vinner.
- **F6.2** GPX-eksport og Web Share (→ B&G-app → Zeus) som i v1.
- **F6.3** PWA på Cloudflare Pages; TWA-APK (sideload) som valgfri finish.
  Norsk UI; enhetsvalg m/s / kn.
- **F6.4** Offline først: siste vær-/kartpakker + ruter uten nett, med
  aldersvisning. Tilgangsmodell (Cloudflare Access foran Worker-API vs.
  enkel API-nøkkel) avgjøres i ADR — Access-utløp må ikke kunne «drepe»
  offline-appen (kjent service-worker-felle).

## 4. Ikke-funksjonelle krav

- **N1 Sikkerhetsramme:** planleggingsverktøy, ikke navigasjonsautoritet;
  disclaimer; ingen rute uten tillitsnivå.
- **N2 Ærlig degradering:** manglende data vises, aldri skjules — også i
  batch-pipelinen (kildestatus, healthcheck).
- **N3 Lisenser:** dokumentert i `docs/legal/` før bruk; attribusjon i UI;
  MET User-Agent fra Worker; DMI-deriverte data merkes.
- **N4 Kost:** gratis datakilder + eksisterende Cloudflare-konto (+ evt.
  GitHub Actions gratis-nivå for batch); ingen nye betalte tjenester uten
  godkjenning.
- **N5 Testbarhet:** enhetstester geometri/fysikk; golden-route-regresjon
  med frosne felt og **toleranse** (ikke bit-eksakt — Math.sin/cos er
  implementasjonsdefinert); **50+ fasit-punkter** for farbarhet inkl.
  danske/svenske som skal gi `usikkert`; kalibreringstester.
- **N6 Ytelse:** F3.5; kartinteraksjon 60 fps-mål; **JS-heap < 500 MB**
  under ensemble-kjøring på nettbrettet.

## 5. Arkitektur (høyt nivå — ADR-er i fase 0)

```
apps/
  pwa/        — MapLibre-UI, Web Worker-pool, offline-lager
  worker/     — Cloudflare Worker: API-proxy (UA/cache), pakke-pekere
tools/
  weather-pack/   — batch (GitHub Actions cron → R2; lokal fallback)
  chart-pack/     — batch: Kartverket-vektor → maske + PMTiles → R2
packages/
  geo/ charts/ weather/ polar/ routing/ protocol/
```

Klienten beregner, skyen forbereder. Batch-jobbens hjem (GitHub Actions
anbefalt) besluttes som ADR-0003 — se beslutningspunkt B2.

## 6. Utenfor scope i v2.0

Farvann utenfor Skandinavia · flere brukere · bakgrunns-GPS/BLE (Capacitor
senere) · AIS-mottak, ankervakt, MOB · offisielle ENC-er (PRIMAR B2B) · iOS ·
tidevanns-åpning av grunne områder (bevisst konservativ statisk maske) ·
generisk havnedatabase (personlig havnebok i stedet) · Efs-/navigasjons-
varsler og måne-/lysdata (senere) · krengningsproxy (bølgedrevet komfort
dekkes av derating + kryssandel).

## 7. Beslutningspunkter

| # | Beslutning | Status |
|---|---|---|
| B1 | Dypgang | **BESLUTTET 2026-08-30: 2,10 m (standardkjøl)**; margin 0,5 m + sjøgangstillegg |
| B2 | Batch-jobbens hjem | **BESLUTTET 2026-08-30: GitHub Actions cron, offentlig repo**, lokal PC som fallback (→ ADR-0003) |
| B3 | Robusthets-UI | **BESLUTTET 2026-08-30: trafikklys + P90-plantid + beslutningsregel**; statistikk bak trykk. **Revidert 2026-09-04 (D8.11):** format låst, men «P90-plantid» erstattes av *verste gjennomførbare + typisk* (og terskeltelling «framme før mørket i k av n» der terskel finnes), og fire vedheng er obligatoriske på førstesiden: dekningslinje (MEPS; bølge/strøm ikke usikkerhetsberegnet), `coverage.bailout` ved bail-out-tallet, kontrollvær-merke, betinget varsellinje. Se `docs/specs/robusthet.md` §4.7 |
| B4 | Cloudflare Workers-plan | **Delvis lukket 2026-08-30:** wrangler-innlogging verifisert; plannivå bekreftes ved første deploy. B2 (batch i GitHub Actions) gjør spørsmålet lite kritisk — Workeren er kun proxy/cache og lever på gratisplan om nødvendig |
| B5 | Sverige-ambisjon | **VEDTATT med godkjenningen:** «usikkert»-nivå + sterk farled-bias |
| B6 | Tilgangsmodell | Avgjøres i ADR (fase 0/5): Access foran Worker-API vs. API-nøkkel |
| B7 | Motorverdier | **BESLUTTET 2026-08-30: standard 7,0 kn / 4,0 l/t, alltid justerbart i UI**; kalibreres mot logg |
| B8 | Norske apper | **LUKKET 2026-08-30:** seilo.no finnes ikke; Orca er norsk (hardware-knyttet). Båtens Verden-listen gjennomgått — KystVær/Båtfart notert som datakilde-ideer, se markedsrapportens tillegg |

## 8. Godkjenning

Ved godkjenning: dokumentet døpes om til `00-kravspek.md`; fase 0 starter
(inkl. THREDDS-/batch-spike og ensemble-ytelses-spike med v1-motoren).
Endringer etter godkjenning skjer som daterte revisjoner.

## Endringslogg

- **2026-09-07 (D12.1–D12.5, Magnus, etter /panel — se
  `docs/research/ekspertpanel-d12-boelge4-2026-09-05.md` og
  `docs/specs/robusthet.md` §7):** F4.6 nødhavn over ensemblet som tre
  profiler rangert på feltgap (bølge 6, aldri «maks over 30»); dypgang og
  klaring obligatoriske i båtmodellen (ingen stille fallback); dybdegate
  `min(kai, ankring)` beholdt som kjent begrensning, gate per anløpstype
  i 4b; F4.3-perturbasjon over worker-poolen; avgangstid bokført i
  medlemssammendraget.
- **2026-09-05 (bølge 4, `docs/specs/robusthet.md` §3.4/§4.4/§4.6):**
  F4.3 implementert — `perturbationPlan`/`summarizeSensitivity` i
  `packages/robustness` (rene funksjoner; søkene kjøres av appen; motoren
  mangler foreløpig en cruising-/strømskaleringsvei på `RouteInput`, se
  `perturbation.ts`s toppkommentar); beslutningsregelen (D8.5) levert som
  `deriveDecisionRule` — geometrisk divergens av medlemssporene med
  margin-, konkordans- og leave-one-out-gater, obligatorisk kodet
  fallback, testet mot et konstruert frontscenario og en seedet
  støyfikstur (100 kjøringer, fallback-andel ≈ 100 %, komfortabelt over
  95 %-kravet).
- **2026-09-05 (D11.1–D11.4, Magnus, etter /panel — se
  `docs/research/ekspertpanel-d11-boelge3-2026-09-05.md` og
  `docs/specs/robusthet.md` §7):** F4.2-klassifisering: all partial
  værdekning er inkonklusiv, også når målet nås (grunn «dekning-felt» —
  en andel uten bølgedata er ingen robusthetsandel; ADR-0005-lesningen
  bekreftet over §3.2-tabellens første utkast); nødhavnsøk (F4.6) kjører
  alltid uten Tub-bound (D11.2, sikkerhetsdefault til havnefeltet D8.10);
  Tub-margin 0,25 beholdes med forhåndsregistrerte kriterier før
  stramming (D11.3); trafikklys: rødt dominerer gule rader, egen
  begrunnelse «tynt grunnlag» (D11.4).
- **2026-09-05 (D10.1–D10.6, Magnus, etter /panel — se
  `docs/research/ekspertpanel-d10-f35-etter-spak7-2026-09-05.md` og
  `docs/specs/robusthet.md` §7):** F3.5 revidert etter spak 7 — progressiv
  semantikk med tellinger og eksakte skranker er kontrakten, «< 60 s»
  strøket (D10.1); nettbrett-målingen som kopierbar JSON per medlem
  (D10.2); vise-versa-porten beholdt med omskrevet utfallsmengde (F12 ut;
  D10.3); eksakte skranker i UI (D10.4, bølge 3); S1b-evaluatoren som
  pool-orakel, kun rekkefølge (D10.5, bølge 3); bakgrunnsberegning ved
  lading som eget spor (D10.6, fase 4b). Avvist: 15-av-30-modus, F12,
  felles søkestamme, server-side A*-felt.
- **2026-09-05 (D9.1–D9.5, Magnus, etter /panel — se
  `docs/research/ekspertpanel-d9-delt-tub-2026-09-05.md` og
  `docs/specs/robusthet.md` §7):** delt Tub-bound mellom ensemblemedlemmer
  forkastet etter skademåling (0 % spart, netto tap; D9.1) — F3.5s «delt
  Tub kun soft» er dermed avløst av «delt A*-felt, ingen delt Tub».
  F4.2-klassifisering skjerpet: budsjettstopp (stagnasjon/avbrudd) og
  manglende vær i avgangspunktet er inkonklusivt, aldri «ugjennomførbar»;
  motorens egen Tub-beskjæring uten mål utløser omkjøring uten bound
  (maks én per medlem, D9.4); `prunedBound`/`tubBoundS` alltid i
  kvitteringen (D9.2). Motorens grådige Tub-rute skal gjøres
  skrankekomplett (klaring, dagslys, veipunkter) i fase 4a bølge 3 etter
  forhåndsregistrert gapmåling (D9.3). Skademålingen kjøres som egen
  `test:damage` (D9.5).
- **2026-09-04 (D8.1–D8.13, Magnus, etter /panel — se
  `docs/research/ekspertpanel-4a-robusthet-2026-09-04.md` og
  `docs/specs/robusthet.md` §7):** fase 4a-robusthet vedtatt som anbefalt.
  Ny ren pakke `packages/robustness` (D8.1); delt A*-felt i klienten, delt
  Tub kun soft m/redningsvei (D8.2, F3.5 revidert); F4.2-tall: nærmeste-
  rang, inkonklusive/feil ut av nevneren, vist plantid = verste
  gjennomførbare + typisk, terskeltelling som primærsetning, rå k/N, ingen
  farge før endelig, provisoriske terskler stemplet og remåles på ekte MEPS
  (D8.3); perturbasjon per F4.3-revisjonen (D8.4); beslutningsregel fra
  medlemsrutenes geometriske divergens m/leave-one-out, konkordans og
  obligatorisk fallback (D8.5); bail-out samplet langs hele ruten m/dybde-
  og mørke-gate, `coverage.bailout`, backoff i fysisk tid, kontrollvær
  merket (D8.6) og baklengs havnefelt som admissibel forfilter (D8.10);
  spakrekkefølge m/PC-remåling før nettbrett, sertifikater kun i
  advarselsretning, sekvensiell tidlig-stopp avvist (D8.7);
  arkitekturtest først m/`provenance` (D8.8); rangeringsfikstur S-9
  m/forhåndsregistrering + LOO (D8.9); B3 revidert (D8.11); prognose-
  kvittering per avgang (D8.12); F3.5 «< 60 s» som hypotese under
  ADR-0005 port 1/2, drivstoff vist m/«ikke usikkerhetsberegnet»-merke
  (D8.13). Bindende: ingen sikkerhetsklassifiserende konstant fryses på
  syntetiske data.
- **2026-09-04 (D7.1–D7.5, Magnus, etter /panel — se
  `docs/research/ekspertpanel-d7-vaerpakkeformat-2026-09-04.md`):**
  bølge 3 kjører på dagens adaptive 8-bit-format med 1°-fliser (E);
  fast LSB (B foran A), medlems-anomali, korridor-subfliser og companding
  er 4b-kandidater avgjort av harness på EKTE fliser over 3–5 init; C/D
  avvist. Vilkår vedtatt: (i) flisvalg-sikkerhetsregel — fliser fra
  A*-feltets rekkevidde (fallback endepunkt-bbox + ≥ 0,5°), manglende
  flis ⇒ flagg «rute begrenset av værdekning», aldri stille avvisning
  (F2.2/F3.1); (ii) per-flis vaktbånd fra header i rutemotoren
  (compositeWeatherField: aktuell flis' bånd) + klippe-assert; (iii)
  rangeringskriteriet i kvantiseringsharnessen nedgradert til
  deskriptivt m/uavgjort-bånd = søkets støygulv (flipp-frekvens → 4b);
  (iv) byggetids-sertifisert maks dekodefeil per flis/felt i header,
  klienten avviser fliser uten sertifikat; (v) subflis-adresserbar layout
  m/offset-tabell; (vi) harness kjøres på ≥ 1 ekte flis i bølge 3.
  E′ (tapsfri Paeth) utløses ved målt totalpakke > 25 MB.
- **2026-09-03 (2) (D6-C, Magnus):** F2.2 interim tak 50 MB etter målt
  1,06× komprimering på ekte MEPS; kompresjonsspike (fast LSB,
  medlem−kontroll, romlig prediktor, 1°-fliser) avgjør endelig tall;
  harness-remåling før fast LSB låses.
- **2026-09-03 (fase 3 bølge 1-beslutninger D1–D5, Magnus):** ADR-0006
  tilgangsmodell vedtatt (to-lags: offentlig speil uten Access; personlige
  data på egen binding bak service token; Worker under Pages-domene;
  misbruksvern på proxyer — B6/F6.4 lukket). MetAlerts-proxy uten
  klientstyrt cache-buster + rate-limit (D2). Mekanisk git-vern for
  parallelle agenter i `.claude/settings.json` (D3). Bølge 2-scope:
  vind-only ende-til-ende, Cache API + storage.persist, spec-drift
  §14 rettes (D4). Øvrige app-skjelett-valg godkjent som spec (D5).
- **2026-09-02 (værpakke-format, V1–V3 besluttet av Magnus etter
  fagagent-review):** F2.2 revidert — medlemmer 2,5 km (5 km strøket som
  rangeringsfarlig), horisont 48 t for medlemmer, harde felt alltid 1 t,
  Hs opp, NorKyst 800 m i kystsonen, betinget budsjettregel (~40 MB ved
  målt behov). §18-spørsmålene i `specs/vaerpakker.md` besluttet som
  samlepakke (WAM800-spike etter fase 3-start, lagged-fallback maks 2
  kjøringer, 2°-fliser m/subfliser, R2-arkiv 7 døgn, MetAlerts-regel
  5 nm-buffer, sikt utsatt, EOF ren reservasjon). §9-formatlåsing todelt:
  logikk/énsidighetsregler låst nå, terskler midlertidige til ekte data.
- **2026-08-31 (3) (steg 3-beslutninger, se
  `docs/research/steg3-plan-2026-08-31.md`):** tidsbokset målepakke
  (~1 uke), fase 3 starter 2026-09-07 uansett måleutfall;
  korridorpakke og τ-felt betinget/gated; CATZOC-semantikkforberedelse
  i klaringskontrakten (effektivt krav = basiskrav + f(CATZOC, dybde),
  f=0 til kalibrering, F1.2); måleplan E1′ revidert per
  djevelens-advokat-review (R2 operasjonalisert m/Pareto-re-søk-fasit,
  to nye fiksturer S-7/S-8, to-parameter-front m/kontroller).
- **2026-09-01 (ADR-0005 vedtatt):** ensemble-mekanisme = fullt
  Pareto-søk per medlem på kontrolloppløsning; F3.5 revidert (setningen
  om redusert medlemsoppløsning 10–12° strøket — målt utrygg for
  F4.2-tall; progressiv semantikk presisert: full analyse for
  valgt/topp-avgang < 60 s, øvrige strømmet). Korridor-evaluator kun
  S1b-diff. Se `docs/decisions/ADR-0005-ensemble-mekanisme.md` og
  `docs/research/maaling-e1-2026-08-31.md`.
- **2026-08-31 (2) (R3 + QA-guardrail, se
  `docs/research/beslutningsgrunnlag-r3-e1-2026-08-31.md`):**
  kystbufferen (minOffing + sjøgangstillegg) håndheves langs hele korden,
  lagdelt: eksakt Lipschitz-gate i søket, bisection ved gate-miss, full
  korridorsjekk i ettersjekk/konsolidering/sluttetappe (F1.2/F3.1).
  QA-validatoren promoteres til byggetids-guardrail: sonderinger grunnere
  enn sitt bånd behandles som VALSOU-punktfarer og delpolygonet kan aldri
  gi `trygt` (F1.1/F1.2). Åpne-kurver-stitching flyttes frem til før
  første reelle rute utenfor farled.
- **2026-08-31 (beslutninger etter ekspertpanel-rundene, se
  `docs/research/ekspertpanel-*.md`):** `Grunne`-punktfarer tolkes etter
  VALSOU-modellen (no-go kun når angitt dybde < krav eller dybde mangler,
  F1.1); ytelsesmålet for kontrollkjøring er §7-budsjettet <5 s på
  nettbrett + progressiv tegning (F3.5) — <1 s forkastet; geometrisk
  forenkling av sikkerhetspolygoner i routing-pakken forbys i
  farbarhetsmaske-spec; golden-fasitpunkter verifiseres kart-først
  (forventning notert før testkjøring). Ensemble-mekanismen (E1′)
  avgjøres empirisk i målepakken før ADR-0005.
- **2026-08-30 (tillegg etter godkjenning):** `docs/decisions/ADR-0004-rutemetodikk.md`
  (rutemetodikk) godkjent av Magnus. Tekniske avklaringer besluttet samme
  dag: TSS-krysningsvinkel **±30° fra tvers** (kurs 60–120° på
  ledretningen godtas, F1.5/F3.4), **nøytrale faste søkevekter** i
  rutemotoren (brukervekter styrer kun rangering/presentasjon, ikke
  søkerommet, F3.4), og **hard avvisning ved sjøgang** når bølgedata
  finnes (Hs-tillegget inngår i klaringstallet ved oppslag, F1.2). Se
  `docs/specs/rutemotor.md` §9 og `docs/specs/farbarhetsmaske.md` §8 for
  full liste over avklaringer.
- **v1.0 (2026-08-30): GODKJENT.** Motorstandard justert til 7,0 kn /
  4,0 l/t (alltid justerbart i UI). B1–B3, B5, B7, B8 lukket; B4
  verifiseres i fase 0; B6 avgjøres i ADR. Norske apper fra Båtens
  Verden-listen gjennomgått (markedsrapportens tillegg).
- **v0.2 (2026-08-30):** Innarbeidet seiler-review (seilingshøyde F1.4,
  TSS F1.5, vernesoner F1.6, sjøgangstillegg + negativ vannstand F1.2,
  bølgebratthet + vind-mot-strøm F3.2, MetAlerts F2.6, sikt F2.7, dagslys/
  mannskap F3.4, bail-out F4.6, presentasjon F4.4, scenarier S1b/S5/S6,
  1 t-avgangsoppløsning) og arkitekt-review (polygon-maske uten
  interpolasjon F1.1, statisk K0-datum, pakkebudsjett ≤ 30 MB F2.2,
  kildekutt F2.1, versjonering F2.3, kildestatus/healthcheck F2.4,
  progressiv beregning + minnemodell F3.5, A*-felt-oppløsning F3.1,
  kalibrering flyttet F3.3, LWW-synk F6.1, Access-felle F6.4, robusthet
  delt 4a/4b). Kuttet: krengningsproxy; korridor-stabilitet → 4b.
- **v0.1 (2026-08-30):** Første utkast.
