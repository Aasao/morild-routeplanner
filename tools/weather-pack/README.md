# tools/weather-pack

Batch-jobben som henter MEPS/NorKyst/WAM800/Oceanforecast fra THREDDS,
subsetter, kvantiserer og publiserer værpakker (`docs/specs/vaerpakker.md`).
Kjøres av `.github/workflows/weather-pack.yml` (ADR-0003: GitHub Actions
cron), med lokal kjøring som fallback.

**Fase 3, bølge 1C/1D.** Bygger fundamentet (OPeNDAP-subsetting, DAP2-dekoding,
kvantisering, lagged-ensemble, kildestatus, pakkeskriving, healthcheck) og
wirer VIND-feltet fullt ut ende-til-ende i dry-run — nå via `@morild/weather`s
delte encode/pakke-implementasjon (`buildLayer`/`serializeLayer`/delta-koding),
ikke en lokal kopi. IKKE produksjonsklar — se "Hva venter" nederst.

**Fase 3, bølge 3A (2026-09-04, D7-syntesen — «format E»).** Første EKTE
værpakke bygget for nettbrett-røyktesten: **1°-fliser** (`WEATHER_TILE_DEG`,
D7.1), flisvalg fra endepunkt-bbox + ≥0,5° sikkerhetsmargin (D7.2, ALDRI en
stram korridor-antakelse), **sertifikat i hver felt-header**
(`CertifiedPackageHeader`, D7.4, `docs/specs/vaerpakker.md` §9.10),
**klippe-assert** i `buildLayer` (D7.4, hard-feil, defense-in-depth) og
**subflis-adresserbar lesing** (`computeSubtileByteRanges`/
`readLayerSubtile`, D7.5 — forberedelse for korridor-Range-henting, ikke
bygget her). Se "Første EKTE MEPS-måling, bølge 3A" under for tall fra det
faktiske bygget.

## Kjøreinstruks

```bash
pnpm install
pnpm --filter @morild/weather-pack dry-run   # bygger tsc + kjører dry-run-demo (liten, rask)
pnpm --filter @morild/weather-pack cli -- --live  # nektes uten verifisert legal-fil (se under)
pnpm --filter @morild/weather-pack measure-full-size  # syntetisk full-skala måling (§8) — se "Første ekte pakkestørrelse" under
pnpm --filter @morild/weather-pack build-live  # EKTE THREDDS-henting (§16-gate) — se "Live-bygging" under. Gjør faktiske, sekvensielle nettverkskall.
```

`pnpm test` (fra repo-roten) kjører alle enhetstestene under `src/`.
`pnpm check` kjører `tsc -b` + eslint på tvers av hele monorepoet, inkl.
denne pakken.

### Dry-run (standard)

`pnpm --filter @morild/weather-pack dry-run` bygger en liten
demonstrasjonspakke fra et **syntetisk** vindfelt
(`src/dry-run-fixtures.ts`) — ingen nettverkskall gjøres. Resultatet
(en peker + logg over medlemspakkenes størrelse/nøkkel) skrives til
`.dry-run-output/` (git-ignorert). Dette er IKKE `packages/weather`s
frosne, ekte MEPS-testfixture (§3 punkt 6, §17 pkt. 6) — det er kun
weather-packs eget offline utviklings-/CI-spor.

### `--live` (`cli.ts`)

Av som standard. Nekter å kjøre (avslutter med kode 1) med mindre
`docs/legal/met-norway-*.md` finnes OG inneholder en linje som matcher
`Status: ... verifisert` (`src/legal-gate.ts`). `cli.ts`s `--live`-gren
selv gjør fortsatt ingen ekte henting (se `build-live-package.ts` under for
det) — den demonstrerer bare at porten faktisk åpner/lukker riktig.

### Live-bygging (`build-live-package.ts`, fase 3 bølge 2A, 2026-09-03)

`pnpm --filter @morild/weather-pack build-live` gjør EKTE, sekvensielle
OPeNDAP-kall mot `thredds.met.no` (§16 — aldri parallelle sesjoner) og
bygger en full, kvantisert, delta-kodet vindpakke (kontroll+30 medlemmer,
2,5 km, 48 t, 1 t) for de to 2°-flisene (`5_28`,`5_29`) som dekker
Skjæløy–Skagen-ruten. Skriver til `out/` (git-ignorert):
`out/weather/1/<hash>.bin` (én fil per medlem per flis, 60 filer),
`out/pointer-vaer-skandinavia.json`, `out/build-report.json` (full måling
+ rundtur-verifisering). Grid-indeksvinduet caches permanent til
`.grid-index-cache.json` (§7 punkt 1, git-ignorert).

**Full måling, funn og budsjettvurdering:**
`docs/research/pakkestoerrelse-ekte-2026-09-03.md`. Kort versjon: **to
reelle konvensjonsfeil ble funnet og rettet** ved første kjøring mot ekte
data (m/s→knop-konvertering manglet helt; MEPS' u/v er griddrelative, ikke
sann nord — se `lambert-rotation.ts`), og **ekte MEPS-vind komprimerer
mye dårligere enn antatt** (delta+gzip-faktor 1,06×, mot spec-ens antatte
1,5–2,5× og det syntetiske feltets 7,29×) — vind alene for de to nødvendige
flisene er 27,4 MB, nær hele det opprinnelige 30 MB-budsjettet.

### Manglende vinddata: fyllverdi og utelatte medlemmer (2026-09-29)

Funn med ekte data: i MEPS' lagged-ensemble var medlemmene 9, 10, 11, 24,
25, 26 NetCDF-fyllverdi (`_FillValue` ≈ 9,969e36) i alle fliser, noder og
tidssteg. Uten håndtering ble fyllverdien kvantisert som tall og fikk et
sertifikat med `maxDecodeErrorKn` ≈ 1e33 og `clippedSamples` 0. Nå
(`pipeline.ts`, kalt fra `build-live-package.ts::buildTile`):

1. `_FillValue`/`missing_value` for `x_wind_10m`/`y_wind_10m` leses fra
   den samme `.das` som LCC-sjekken (`parseWindMissingValuesFromDas`).
2. På RÅ m/s, FØR knop-konvertering og rotasjon: en verdi som er fyll,
   ikke-endelig eller fysisk umulig (`|u|` eller `|v|` > 150 m/s,
   `WIND_PLAUSIBLE_MAX_MS`) er «mangler» — u OG v settes til NaN
   (`maskMissingWindValues`), som blir sentinel i pakken, aldri et tall.
3. Et medlem der **mer enn 50 %** (`WIND_MEMBER_MAX_MISSING_FRACTION`) av
   noder × tidssteg i flisen mangler, skrives ikke til pekeren
   (`assessWindMembers`); det føres i flisens `missingFields` som
   `{ field: "wind", member, sourceStatus }` så klienten kan telle nevneren.
   Vindens `sourceStatus` blir `degraded` med «n av 30 medlemmer har
   vinddata — utelatt: …». Kontrollen (medlem 0) uten data ⇒ bygget feiler.
4. Byggerapporten (`build-report.json`, `tiles[].excludedWindMembers`) og
   konsollen logger hvilke medlemmer som ble utelatt og hvorfor.

`lagged-ensemble.ts` teller fortsatt medlemmer fra DDS-dimensjonen — det er
et nominelt tall; datanivåets sjekk skjer per flis etter hentingen.

## Struktur

| Fil | Ansvar |
|---|---|
| `src/grid.ts` | Værfliser (`WEATHER_TILE_DEG` — **1° siden bølge 3A/D7.1**, delt origo med kartflisene), ≤32×32-nodes subfliser for FETCH-vinduet (§7), kystsone-klassifisering (§9.4). |
| `src/direction-budget.ts` | Retningsbudsjett fra en kjent fart-dekodefeil (`maxDirectionErrorDeg`) + feltskanning (`fieldMaxDirectionErrorDeg`, D7.4-sertifikatets `maxDirectionErrorDeg`). |
| `src/das-verification.ts` | Verifiserer MEPS' faktiske LCC-projeksjonsparametre (fra `.das`) mot `lambert-rotation.ts`s hardkodede konstanter — hard-feil ved avvik. |
| `src/dap2.ts` | Dependency-fri DAP2-binærdekoder (`.dods`-responser) — spike-thredds.md funn 9 ("gjenstående arbeid"), nå skrevet. |
| `src/opendap-client.ts` | Grid-indeks-cache (permanent, §7 punkt 1), URL-bygging for "alle 30 medlemmer i ett kall" (§7 punkt 2), eksponentiell backoff (§16). |
| `src/lagged-ensemble.ts` | §11/§18 pkt. 2: siste komplette kjøring, fallback maks 2 kjøringer tilbake, ellers "ingen brukbart ensemble". |
| `src/source-status.ts` | §12-tabellens `SourceStatus`-konstruktører (ordlyd konsistent på tvers av kallsteder). |
| `src/package-writer.ts` | Innholdsadressering (SHA-256 → R2-nøkkel, §5), pekerbygging, 7-døgns arkivvindu (§18 pkt. 4). |
| `src/healthcheck.ts` | §13-payload + `runWithHealthcheck` (ping i en `finally`, uansett utfall). |
| `src/legal-gate.ts` | §16-porten `--live` går gjennom. |
| `src/dry-run-fixtures.ts` | Syntetisk `FetchLike` for dry-run/tester — ALDRI brukt bak `--live`. |
| `src/pipeline.ts` | Orkestrerer fetch→subset→encode→skriv for vindfeltet via `@morild/weather`s `buildLayer`/`serializeLayer` (ekte pakkelag, delta-koding); samme steg-mønster gjenbrukes for andre felt. |
| `src/cli.ts` | Entrypunkt (`dry-run` / `--live`-gate). |
| `src/measure-full-size.ts` | Engangsmåling: SYNTETISK, full-skala vind-medlemspakke for Skjæløy→Skagen — se "Første ekte pakkestørrelse" under. IKKE en del av `pnpm test`. |
| `src/quantize.test.ts` | **Ikke lenger en lokal implementasjon.** Testet opprinnelig weather-packs egen (nå slettede) `quantize.ts`/`format-contract.ts`; tester nå `@morild/weather`s tilsvarende produsent-side-API (samme navn, samme scenarioer) — weather-packs egen regresjonsdekning av den delte modulen. |
| `src/lambert-rotation.ts` | **Nytt, bølge 2A.** MEPS' u/v er griddrelative (Lambert-projeksjonens egne x/y-akser), ikke sann øst/nord — roterer til sann nord FØR kvantisering (§19 2026-09-03-funn, se `docs/research/pakkestoerrelse-ekte-2026-09-03.md` §5). |
| `src/live-source.ts` | **Nytt, bølge 2A.** Ekte katalog-/DDS-parsing (§11 mot en EKTE `mepslatest`-katalog) og bbox→indeksvindu-probing (to-pass, samme strategi som spiken) — rene funksjoner skilt fra de tynne `fetchImpl`-nettverkskallene. |
| `src/build-live-package.ts` | Hoved-orkestrator for EKTE THREDDS-bygging — se "Live-bygging" under. IKKE en del av `pnpm test` (gjør ekte nettverkskall). **Bølge 3A:** 1°-fliser fra endepunkt-bbox+margin (D7.2), sertifikat per medlem (D7.4), klippe-assert (`onClip`, hard-feil). **2026-09-27:** NorKyst-strøm etter vinden, se "Strøm (NorKyst)" under. |
| `src/current-geometry.ts` | **Nytt 2026-09-27 (strom-produsent.md).** Ren geometri for strøm: fill-sjekk på rå Int16 før avskalering, sjømaske, regulært ~800 m-gitter per 1°-flis, NN mot kildens 2D lat/lon (haversine) med kystkant-forlengelse ≤ `COAST_EXTENSION_CELLS` = √2 celler, kystmaske (`COAST_FILL_PROXIMITY_CELLS` = 3), tidsmatching, lokalisering av indeksvinduet. Gjenbruker BEVISST ingenting fra vindens `windLayerGeometry`/`sampleFromFetchedGrid`. |
| `src/norkyst-source.ts` | **Nytt 2026-09-27.** NorKyst-nettverk (sekvensielt, §16): `.dds`/`.das` (koding verifiseres HARDT), `forecast_reference_time`, løpende tidsakse, lat/lon, nærmeste-punkt-lokalisering (spike 05-mønsteret), u/v overflate (depth 0). |
| `src/current-package.ts` | **Nytt 2026-09-27.** Strøm u/v (knop, MOT) og kystmaske som `Layer` via `buildLayer`/`serializeLayer`, full rundtur fra serialisert nyttelast, sertifikat (uten retningsskranke), pekeroppføringer `current`/`current-coastal`. |
| `src/current-fixtures.ts` | Syntetiske polarstereografiske gitter (70°Ø sentralmeridian ⇒ ~60° dreid i Skagerrak) for strømtestene. Ikke brukt i produksjon. |

## `@morild/weather`-integrasjonen (fullført, 2026-09-03)

`format-contract.ts` og `quantize.ts` var en **lokal, midlertidig** kopi av
kontraktene `docs/specs/vaerpakker.md` §9/§15 låser, skrevet parallelt med
`packages/weather` (annen agent). Begge filene er nå **slettet** —
`pipeline.ts`, `quantize.test.ts`, `package-writer.ts` og `source-status.ts`
importerer fra `@morild/weather`/`@morild/protocol` (workspace-avhengighet
i `package.json`). Encode-siden (skala/offset per subflis, Hs opp,
TWS-vaktbånd-utledning, sentinel, delta-koding) har nå ÉN implementasjon,
i `packages/weather`.

**To reconsilierte avvik** (`docs/specs/vaerpakker.md` §19, 2026-09-03,
"sentinel-hull forent"):
1. **Sentinel ved 10-bit.** Weather-packs opprinnelige `computeScaleOffset`
   reserverte toppkoden `2^bits−2` uavhengig av bit-bredde — riktig for
   8-bit, men for 10-bit unngår ikke det spesifikt rå byteverdi 255 (som
   ligger midt i det 10-bit-representerbare området, ikke i toppen).
   `@morild/weather`s `compactToRaw`/`rawToCompact` («kompakt indeks som
   hopper over 255») er nå eneste implementasjon — bevist aldri å
   produsere raw 255 for noen gyldig verdi, for BÅDE 8- og 10-bit
   (`packages/weather/src/quantize.test.ts`, full sveip over hele det
   representerbare området per bit-bredde).
2. **Degenerert subflis (`min===max`).** Weather-packs opprinnelige
   `computeScaleOffset` ga `scale=1` for en flat subflis (vilkårlig
   ett-trinns skritt). `@morild/weather`s `computeLinearParams` gir
   bevisst `scale=0`: dekoding blir da EKSAKT kildeverdien for enhver
   gyldig kompakt indeks — null kvantiseringsfeil, ikke et lite,
   ett-trinns avvik (golden-bro-testens krav om `maxDecodeErrorKn=0` for
   konstante felt). `tools/weather-pack/src/quantize.test.ts`s tilsvarende
   test er oppdatert til å bevise DEN oppførselen.

**Pipeline-trinnene skriver nå ekte pakkelag:** `buildWindMemberLayers`
bygger `Layer`-objekter via `buildLayer` (i stedet for den forrige,
ad-hoc subflis-løkken som skrev en lokal, ikke-spec-eid serialisering), og
`buildWindMemberPackage` serialiserer dem via `serializeLayer` — inkl.
§8s delta-koding (`serializeLayer(layer, {deltaCoded: true})`, default på).

**Dokumentert forenkling, IKKE løst i denne bølgen:** `windLayerGeometry`
(`pipeline.ts`) behandler det hentede OPeNDAP-indeksvinduets (y,x)-noder
som om de er jevnt fordelt over bboxen i lat/lon. MEPS' native rutenett er
en Lambert-projeksjon, ikke et jevnt lat/lon-rutenett — dette er korrekt
for BYTE-REGNSKAPET (§8, se måletallene under), men IKKE geografisk
nøyaktig for et ekte uttrekk. Ekte reprojeksjon til et regulært
lat/lon-rutenett er gjenstående arbeid (samme kategori som
`grid.ts::classifyCoastalZone`s injiserte avstandsfunksjon).

## Status: `docs/legal/met-norway-*.md` (§16-gaten)

**Gaten er åpen** — `docs/legal/met-norway-thredds.md` matcher
`legal-gate.ts`s `Status:\s*.*verifisert`-mønster (status der er formelt
«delvis verifisert», som fortsatt inneholder substrengen «verifisert» —
en bevisst, dokumentert regel i `legal-gate.ts`, ikke en smutthull-bug:
lisens/vilkår ER verifisert, kun THREDDS' eksakte rate-grense er
uverifisert, jf. samme dokuments «Gjenstår»-liste). `build-live-package.ts`
gjør nå ekte THREDDS-kall bak denne porten — se "Live-bygging" over.

## Strøm (NorKyst) — `docs/specs/strom-produsent.md` (2026-09-27)

`build-live` bygger nå NorKyst v3 800 m overflatestrøm
(`fou-hi/norkystv3_800m_m00_be`) etter vinden, for de samme 1°-flisene:

1. `.dds`/`.das` (koding verifiseres hardt: `_FillValue −32767`,
   `scale_factor 0.001`, m/s, tid i sekunder siden 1970 — avvik ⇒ bygget
   feiler), `forecast_reference_time` (⇒ `init`), og de siste 192 verdiene
   av den løpende tidsaksen. Vindens 49 tidssteg (kontrollens `t0S`, 1 t)
   matches EKSAKT; det NorKyst ikke har blir sentinel.
2. Indeksvindu per flis: nærmeste-punkt-søk mot en grov prøve av hele
   domenet (stride 6×10), så en lokal fulloppløst blokk (±170 celler) og
   containment mot flisen + margin (0,05° lat / 0,1° lon) KUN der. Vinduet +
   lat/lon caches i `.norkyst-grid-cache.json` (git-ignorert, eget
   nøkkelrom — tidsaksen caches ikke).
3. `u_eastward`/`v_northward` for depth-indeks 0 i ETT kall hver,
   sekvensielt. Sjømaske: en node er sjø bare hvis den aldri er fill.
4. Regulært gitter 1/139° × 1/70° (≈ 800 m), NN mot kildens 2D lat/lon
   (haversine) til nærmeste sjønode innenfor √2 lokale celler, ellers
   sentinel. Kystmaske: forlenget ELLER ≤ 3 celler fra fill.
5. `buildLayer` (8-bit, delta, `linear`) + klippe-assert + FULL rundtur
   (alle noder × tidssteg, sentinel ⇔ sentinel, maske bit for bit) — brudd
   ⇒ bygget feiler. Pekeroppføringer `current` og `current-coastal`
   (member 0, delt av alle medlemmer). Kystmaskens header logger
   `coastalMask.{extensionCells, fillProximityCells, rule}`.
6. NorKyst nede / flis utenfor domenet ⇒ `missingFields` med årsak for
   strøm (N2); vinden bygges uansett.

**Byggerapporten** (`out/build-report.json`, `current[]`) har per flis:
native vindu og fill-andel, antall noder med verdi ved grense 1 og √2,
andel «sjønære» noder uten verdi ved grense 1 og √2, forlengede noder,
kystmerket andel av nodene med verdi, sertifikat, rundtur og fasit-punktene
Drøbaksund/Hvaler/Skagerrak (dekodet pakke vs. NN direkte i kildens
lat/lon). **NB:** «sjønær» (minst én native sjønode innenfor 2 celler) er en
NÆRMING til «farbar» — den ekte farbarhetsmasken finnes ikke i
`tools/weather-pack`. Den ekte farbar-andelen må måles mot masken etter
første `build-live` (spec §5, målingene som rapporteres).

## Hva som IKKE er wiret opp ennå (bevisst, ikke glemt)

- **Bølge (Oceanforecast/WAM800), tidevann, MetAlerts**: bølge er
  steg 3 (ADR-0007, punktbølge via Worker-proxy — egen spec). Strøm er
  bygget, se over. Enheten må sjekkes per kilde (m/s ≠ knop — fellen som
  rammet vind, `docs/research/pakkestoerrelse-ekte-2026-09-03.md` §4).
- **Kystflis-geometri §9.6** (0,5–1°-fliser, 1,6 km utaskjærs): strøm
  bygges i dag i 800 m over HELE 1°-flisen (spec §2). Utløses hvis
  pakken måles over 40 MB (spec §6).
- **R2-opplasting fra CI**: selve opplastingen er skrevet
  (`pnpm --filter @morild/weather-pack upload-r2`, `src/upload-r2.ts`,
  2026-09-27 — blober først, peker sist, stikkprøver lest tilbake), og
  `.github/workflows/weather-pack.yml` kjører `build-live` + `upload-r2`
  hver 3. time. Uten secrets (`CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`) blir det dry-run med advarsel. 7-døgns
  arkivopprydding (spec §5) er ikke bygget.
- **Kystsone-avstandsoppslag mot ekte kystlinjedata**
  (`tools/chart-pack`s vektordata, §9.4): `grid.ts::classifyCoastalZone`
  tar imot en injisert avstand — selve oppslaget mot chart-pack-geometrien
  er ikke koblet inn her.
- **Byggetids-verifisering av ¼-regelen** (§9.4) — krever ekte data
  (post-legal-gate), ikke noe som kan gjøres i dry-run.
- **Ekte reprojeksjon** av MEPS' native (Lambert-projiserte) rutenett til
  et regulært lat/lon-rutenett — se avsnittet over. `measure-full-size.ts`
  og `pipeline.ts` behandler i dag det hentede indeksvinduet som om det ER
  et jevnt lat/lon-rutenett, en dokumentert forenkling som holder for
  byte-regnskapet, men ikke for et ekte geografisk uttrekk.
- **Budsjett-reverifisering mot en ekte bygget, GZIPPET pakke inkl. alle
  felt** (§8, §17 pkt. 7) — `measure-full-size.ts` gir det FØRSTE
  datapunktet (kun vind-medlemmer, syntetisk felt, se under), men strøm,
  bølge, tidevann/MetAlerts og metadata er ikke lagt til i samme måling
  ennå, og ekte MEPS-data (post-legal-gate) er ikke brukt.

## Første EKTE MEPS-måling, bølge 3A — 1°-fliser, sertifikat, R2-opplasting (2026-09-04)

`pnpm --filter @morild/weather-pack build-live` bygde en EKTE, kvantisert,
delta-kodet vindpakke (kontroll+30 medlemmer, 2,5 km, 48 t, 1 t) for
**seks 1°-fliser** (D7.1/D7.2 — endepunkt-bbox Skjæløy–Skagen + 0,5°
sikkerhetsmargin: `10_57`,`11_57`,`10_58`,`11_58`,`10_59`,`11_59`), mot
kjøring `meps_lagged_6_h_latest_2_5km_20260903T21Z.nc`.

| Flis | Noder | Rått (30 medl., u+v) | `maxDecodeErrorKn` (sertifikat, medlem 0) | `maxDirectionErrorDeg` |
|---|---|---|---|---|
| 10_57 | 46×27 | 3,65 MB | 0,0785 kn | 1,6° |
| 11_57 | 45×27 | 3,57 MB | 0,0764 kn | 4,0° |
| 10_58 | 46×27 | 3,65 MB | 0,0986 kn | 28,8° |
| 11_58 | 46×26 | 3,52 MB | 0,0891 kn | 73,1° |
| 10_59 | 46×25 | 3,38 MB | 0,0668 kn | 75,9° |
| 11_59 | 45×25 | 3,31 MB | 0,0361 kn | 71,1° |
| **Sum** | — | **21,08 MB rått / 20,17 MB delta+gzip (faktor 1,05×)** | — | — |

`clippedSamples: 0` for alle 180 (6×30) medlemspakker — klippe-assertet
(§9.10 punkt 4) løste seg aldri ut. `maxDirectionErrorDeg` varierer mye
mellom fliser fordi det avhenger av feltets FAKTISKE fartsfordeling
(lavere fart ⇒ større retningsusikkerhet, §9.5) — flisene lengst nord/øst
(10_59/11_59) har mer stille vær i denne kjøringen. Rundtur-verifisering
(medlem 0, alle fliser) besto — se konsollutskriften/`out/build-report.json`
(git-ignorert) for fullstendige tall.

**~21 MB for 6× 1°-fliser vs. ~27,4 MB for 2× 2°-fliser (bølge 2A, samme
korridor)** — 1°-flisene gir en mindre, men ikke dramatisk mindre, pakke
(den forventede ~36 %-noderaksjonen fra `kompresjonsmaaling-2026-09-03.md`
gjelder KORRIDORENS faktiske dekningsbehov, ikke den rause D7.2-margin-
bboxen bygget her — seks 1°-fliser med 0,5° margin på alle kanter dekker
mer areal enn to 2°-fliser dekket brukbart av korridoren i praksis).

**R2:** lastet opp til `morild-mirror` (`weather/1/<hash>.bin` × 180 +
`pointer/vaer-skandinavia.json`), verifisert med stikkprøver
(`wrangler r2 object get`) — se PR/commit-rapporten for full liste.

## Første EKTE MEPS-måling (bølge 2A, `build-live-package.ts`, 2026-09-03)

`pnpm --filter @morild/weather-pack build-live` bygde (2026-09-03,
kjøring `meps_lagged_6_h_latest_2_5km_20260903T04Z.nc`) en EKTE, kvantisert,
delta-kodet vindpakke mot ekte THREDDS-data for de to 2°-flisene
(`5_28`,`5_29`) som dekker Skjæløy–Skagen-ruten. **Bekrefter spådommen
under nesten ordrett:** ekte MEPS-vind komprimerer BETYDELIG dårligere enn
det syntetiske feltet.

| Steg | Ekte MEPS (30 medl., 2 fliser) | Syntetisk (under, samme dag) |
|---|---|---|
| Rått | 28,94 MB | 31,49 MB (større bbox, se under) |
| Etter delta+gzip | **27,41 MB (faktor 1,06×)** | 4,32 MB (faktor 7,29×) |

**Budsjettkonsekvens:** vind alene for nøyaktig de flisene ruten trenger
er 27,4 MB — nær hele det opprinnelige 30 MB-budsjettet FØR strøm, bølge
og metadata er lagt til. Full måling, to reelle konvensjonsfeil funnet og
rettet underveis (m/s→knop-konvertering manglet; MEPS' u/v er
griddrelative, ikke sann nord), og en anbefaling til Magnus om
budsjettspørsmålet: `docs/research/pakkestoerrelse-ekte-2026-09-03.md`.

## Første SYNTETISKE pakkestørrelse (§8, §17 pkt. 7 — MÅLT, 2026-09-03, tidligere samme dag)

`pnpm --filter @morild/weather-pack measure-full-size` bygde en
kvantisert (`buildLayer`), delta-kodet og gzippet vind-medlems-pakke for
HELE Skjæløy→Skagen-bboxen (samme bbox som
`packages/weather/src/budget.test.ts`: 57,4–59,7° N, 8,0–12,6° Ø) på §9s
låste oppløsning: **2,5 km, 48 t (49 tidssteg), 30 medlemmer, 8-bit u/v**.
Rutenettet ble 104 × 108 noder.

| Steg | Målt (30 medlemmer, u+v) | Spec-ens estimat (§8) |
|---|---|---|
| Rått (kvantiserte koder) | **31,49 MB** | ~32 MB |
| Etter gzip, UTEN delta (baseline) | 7,98 MB (faktor 3,95×) | — (§8 målte ikke denne separat) |
| Etter delta+gzip | **4,32 MB** (faktor 7,29×) | ~20–28 MB (faktor 1,5–2,5×) |

**Dette er MÅLT PÅ ET SYNTETISK FELT** (`dry-run-fixtures.ts`s glatte,
analytiske sinus-/cosinus-mønster) — **IKKE ekte MEPS-data.** Det rå tallet
(31,49 MB) stemmer godt med spec-ens formel-estimat (~32 MB, se
`packages/weather/src/budget.ts`) — det er en god kryssjekk av selve
node-/byte-regnskapet. Kompresjonsfaktoren (7,29× for delta+gzip) er
derimot vesentlig BEDRE enn spec-ens 1,5–2,5×-estimat, fordi et syntetisk,
glatt felt har mye mindre romlig/tidsmessig høyfrekvent variasjon enn et
ekte MEPS-uttrekk (turbulent atmosfærisk strømning komprimerer merkbart
dårligere). **Konklusjon:** dette bekrefter node-/byte-regnskapet i §8,
men sier IKKE at 4,32 MB er et realistisk produksjonstall — ekte MEPS
komprimerer trolig dårligere, kanskje i nærheten av spec-ens opprinnelige
1,5–2,5×-anslag eller svakere. En ekte måling mot faktisk hentet
MEPS-data (post-legal-gate) er fortsatt gjenstående arbeid.

Målingen dekker KUN vind-medlemmene (§8s tyngste post) — kontroll, strøm,
bølger, tidevann/MetAlerts og metadata er ikke inkludert i dette tallet.

## Testtall

Se kjøreloggen fra `pnpm test` — dekker (§17), nå mot `@morild/weather`s
delte implementasjon: retningskonvensjoner (vind FRA vs. strøm MOT, kjente
verdier), komponentrom-interpolasjon (rom+tid, inkl. 350°/10°-
grensetilfellet), Hs-avrundingsregelen (`decode(encode(hs)) >= hs`, §9.3),
TWS-vaktbåndet (§9.5), sentinel 255 (§9.6, inkl. den reconsilierte
10-bit-garantien), degenerert subflis (`scale=0`, reconsiliert 2026-09-03),
kystsone-klassifisering (§9.4, inkl. "manglende dekning ⇒ kystsone"),
subflis-/subsetting-geometri (§7, inkl. reststørrelser), ekte pakkelag via
`buildWindMemberLayers`/`buildLayer` med bit-eksakt rundtur, delta-koding
koblet inn i `buildWindMemberPackage` (bit-identisk dekodet payload med og
uten `deltaCoded`, `gzipSync`-smoke-test), DAP2-binærdekoding (Float32 og
padded Int16, §funn 9), OPeNDAP-URL-bygging og "alle medlemmer i ett kall"
(§7 punkt 2), grid-indeks-cache (§7 punkt 1), eksponentiell backoff (§16),
lagged-ensemble-fallback (§11/§18 pkt. 2), kildestatus-ordlyd (§12),
innholdsadressering + arkivvindu (§5/§18 pkt. 4), healthcheck-`finally`-
kontrakten (§13) og legal-gaten (§16).

**Strøm (2026-09-27, `current-*.test.ts`, `norkyst-source.test.ts`):** fill
sjekket på rå Int16 før avskalering (også midt i en gyldig blokk), m/s→knop
og fortegn, NN mot 2D lat/lon på et ekte polarstereografisk gitter dreid
~60° (feiler om indeksvindu-forenklingen gjeninnføres — og viser at
`windLayerGeometry` bommer med > 5 km median på samme gitter), egenskapstest
over tilfeldig fill (verdier kun fra én sjønode, ingen midling, innenfor √2
celler, kystmasken som definert), forlengelsesgrensen, lokalisering over et
buet hårnål-domene der bbox-containment aliaserer, `.das`-verifisering mot
den ekte NorKyst-`.das`-en fra spiken, sekvensiell henting, full rundtur og
kystmaskens hjørneregel via klientens dekoder.
