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
  **Budsjett: ≤ 30 MB per rutepakke** — 8-bit kvantisering m/per-flis
  skala/offset, ensemble-medlemmer på 5 km (kontroll på 2,5 km), tidstynning
  (1 t 0–24, 3 t etterpå), delta-koding — **og romlig nedtynning av
  NorKyst-strøm i pakken** (spike-funn 2026-08-30: 800 m-rådata sprenger
  ellers budsjettet; full oppløsning beholdes kun nær ruten/kysten).
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
- **F3.5** Ytelse (omdefinert etter arkitekt-review): S1 er 150–210
  kjøringer, ikke 30. **Progressiv beregning er UX-kontrakten**:
  kontrollmedlem for alle avganger først (tabell på sekunder), deretter
  ensemble strømmet per avgang. Medlemmer kjøres med redusert
  kursoppløsning (10–12°; kontroll 6°) og delt A*-felt/Tub-bound.
  Minnemodell: **per-medlem transferable ArrayBuffers** (unngår COOP/COEP-
  fellen); dekoding kvantisert→Float32 i worker on demand.

### F4 Robusthet (kjerne 3: appens signatur)

- **F4.1** Ensemble-ruting per medlem med delt A*-felt (fase 4a).
- **F4.2** Robusthetsmål fase 4a: spredning i seilingstid (P50/P90),
  gjennomførbarhetsandel innenfor grensene, spredning i kryss-/motorandel.
  **Fase 4b (forskningsdel, etter 4a):** geometrisk korridor-stabilitet og
  automatisk følsomste-faktor-attribusjon.
- **F4.3** Sensitivitet utover vær: perturber avgangstid, cruising-faktor
  (±0,05), strøm.
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
| B3 | Robusthets-UI | **BESLUTTET 2026-08-30: trafikklys + P90-plantid + beslutningsregel**; statistikk bak trykk |
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
