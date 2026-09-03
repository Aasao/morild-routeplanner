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

## Kjøreinstruks

```bash
pnpm install
pnpm --filter @morild/weather-pack dry-run   # bygger tsc + kjører dry-run-demo (liten, rask)
pnpm --filter @morild/weather-pack cli -- --live  # nektes uten verifisert legal-fil (se under)
pnpm --filter @morild/weather-pack measure-full-size  # ekte full-skala måling (§8) — se "Første ekte pakkestørrelse" under
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

### `--live`

Av som standard. Nekter å kjøre (avslutter med kode 1) med mindre
`docs/legal/met-norway-*.md` finnes OG inneholder en linje som matcher
`Status: ... verifisert` (`src/legal-gate.ts`). Per nå (denne bølgen) er
selve THREDDS-hentingen ikke koblet inn i `cli.ts` sin `--live`-gren ennå —
porten er bygget og testet, men CLI-en stopper eksplisitt etter at porten
åpner i stedet for å late som en full produksjonskjøring skjedde. Se
"Hva venter".

## Struktur

| Fil | Ansvar |
|---|---|
| `src/grid.ts` | 2°×2°-fliser (delt origo med kartflisene), ≤32×32-nodes subfliser for FETCH-vinduet (§7), kystsone-klassifisering (§9.4). |
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
| `src/measure-full-size.ts` | Engangsmåling: ekte, full-skala vind-medlemspakke for Skjæløy→Skagen — se "Første ekte pakkestørrelse" under. IKKE en del av `pnpm test`. |
| `src/quantize.test.ts` | **Ikke lenger en lokal implementasjon.** Testet opprinnelig weather-packs egen (nå slettede) `quantize.ts`/`format-contract.ts`; tester nå `@morild/weather`s tilsvarende produsent-side-API (samme navn, samme scenarioer) — weather-packs egen regresjonsdekning av den delte modulen. |

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

## Hva venter på `docs/legal/met-norway-*.md`

- `--live` er bygget og testet (`legal-gate.test.ts`), men den faktiske
  THREDDS-hentingen er **ikke koblet inn** i `cli.ts`s `--live`-gren ennå —
  se kommentaren i `cli.ts`. Når legal-filen er verifisert, er neste steg å
  erstatte `createDryRunFetch()` med `fetch` (global) bak `--live`, med
  `buildUserAgent` og ekte `datasetUrl`-oppslag mot
  `mepslatest`/`fou-hi`-katalogene (se `docs/research/spike-thredds.md`
  for verifiserte stier).
- Ingen ekte HTTP-kall er gjort fra dette repoet i denne bølgen.

## Hva som IKKE er wiret opp ennå (bevisst, ikke glemt)

- **Strøm (NorKyst), bølge (Oceanforecast/WAM800), tidevann, MetAlerts**:
  samme steg-mønster (`FetchLike` → dap2 → quantize → package-writer)
  dekker dem alle, men kun VIND er fullt koblet sammen i `pipeline.ts`
  denne bølgen (spec-ens mest detaljerte felt — u/v-lagring, TWS-vaktbånd,
  lagged-ensemble). `docs/specs/vaerpakker.md` §7 punkt 5 gjør
  Oceanforecast-punktbølge til en **gyldig førsteleveranse** for fase
  3-exit — den er ikke bygget her ennå.
- **R2-opplasting**: `.github/workflows/weather-pack.yml` har et
  kommentert skjelett for opplastingssteget (bak secrets). Selve
  S3-kompatible PUT-kallet mot R2 er ikke skrevet — `package-writer.ts`
  gir nøkkel+hash+payload; å sende dem til R2 er gjenstående arbeid når
  Cloudflare-secrets faktisk skal brukes fra CI.
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

## Første ekte pakkestørrelse (§8, §17 pkt. 7 — MÅLT, 2026-09-03)

`pnpm --filter @morild/weather-pack measure-full-size` bygde en EKTE,
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
