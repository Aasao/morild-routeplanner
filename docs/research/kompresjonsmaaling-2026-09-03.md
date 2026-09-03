# Kompresjonsmåling — entropi-eksperiment på EKTE vindpakke (D6-C, 2026-09-03)

- Dato: 2026-09-03
- Beslutning: D6-C (Magnus) — kompresjonsspike på den EKTE værpakken, som
  alternativ 3 i `docs/research/pakkestoerrelse-ekte-2026-09-03.md` §7
  varslet («undersøk om delta+gzip er feil kompresjonsstrategi for ekte
  MEPS-felt»), FØR en 40 MB-budsjettrevisjon tas endelig.
- Grunnlag: `docs/research/pakkestoerrelse-ekte-2026-09-03.md` (målt
  faktor 1,06× — `gzipNoDeltaTotal` 14,87 MB mot rått 14,88 MB, bytene er
  nær full entropi), fagagent-diagnosen samme dag (per-skive min/maks
  gir LSB ≈ 0,1–0,2 kn — finere enn ruteren trenger; 8-bit per flis er
  «gratis» ved ≥0,5 kn toleranse; delta i TID er feil akse — feltet
  flytter ~15 celler/time ved 2,5 km).
- Kode: `tools/weather-pack/src/entropy-experiment.ts` (nytt),
  `tools/weather-pack/src/grid.ts` (flisstørrelse nå parameter).
- Data: de allerede nedlastede, ekte blobene i
  `tools/weather-pack/out/weather/1/` (kontroll + 30 medlemmer, fliser
  5_28/5_29, init `2026-09-03T04:00:00Z`) — **ingen nye THREDDS-kall**
  denne bølgen.

---

## 1. Metode (kort)

For hver flis og hvert medlem: les den serialiserte, delta-kodede
u/v-blob'en via `readLayerFrames` (som automatisk delta-dekoder tilbake
til RÅ per-slice-kvantiserte koder — `package-format.ts`s dokumenterte
kontrakt), rekonstruer fysisk verdi (kn) via `decodeLayerNode` (dagens
per-subflis-per-tidssteg skala/offset). Dette ER den eneste kilden til
fysisk verdi som finnes — de virkelig rå THREDDS-tallene ble ikke lagret
separat.

Re-kvantiser den rekonstruerte fysiske verdien under 4 alternative,
**faste** (globale, ikke per-slice-adaptive) skjemaer, i tillegg til
"dagens" skjema (brukt direkte, ingen rekvantisering nødvendig):

| Kvant-id | Beskrivelse | Bit-bredde (målt) |
|---|---|---|
| `dagens` | Per subflis (≤32×32 noder), per tidssteg, adaptiv min/maks (produksjon i dag) | 8 |
| `lsb025-perTile` | Fast LSB 0,25 kn, offset = flisens observerte min (u og v poolet) | 16 (5_28), **8 (5_29)** |
| `lsb025-none` | Fast LSB 0,25 kn, offset = −40 kn (fast, dataUAVHENGIG antatt grense) | 16 |
| `lsb05-perTile` | Fast LSB 0,5 kn, offset = flisens observerte min | 8 |
| `lsb05-none` | Fast LSB 0,5 kn, offset = −40 kn (fast) | 8 |

`±40 kn` er valgt med margin over det FAKTISK observerte området i disse
to flisene (se §3) — IKKE en universell garanti for alle MEPS-forhold
(representativitetsforbeholdet i §7 gjelder like mye her).

For hver kvantisering: 6 prediktorer, anvendt PÅ DE KVANTISERTE KODENE
(byte-nivå-transform, samme prinsipp som `@morild/weather::delta.ts`s
"fysisk agnostisk"):

1. **ingen** — rå koder.
2. **tidsdelta** — dagens produksjonsskjema (mod-256-differanse langs
   tidsaksen per node, `@morild/weather::delta.ts`s matematikk).
3. **romlig venstre-nabo** — mod-M-differanse mot forrige kolonne, samme
   rad/tidssteg.
4. **2D MED/Paeth** (JPEG-LS' Median Edge Detector) — predikerer fra
   venstre+over+øvre-venstre, samme tidssteg.
5. **medlem − kontroll** — residual per medlem mot kontrollmedlemmet
   (kontrollen selv lagres "ukodet", kun kvantisert).
6. **medlem − kontroll + romlig** — som (5), deretter romlig venstre-nabo
   PÅ residualen.

30 kombinasjoner totalt, per flis. For hver kombinasjon: gzip (node:zlib,
nivå 9) og brotli (kvalitet **9**, bevisst IKKE 11 — fart/kvalitet-
avveining for denne spikens kjøretid, ikke en påstand om brotlis
maksimale evne) **per medlemsfil** (samme konvensjon som
`build-live-package.ts`s regnskap: komprimert per medlem, summert — matcher
hvordan blobene faktisk overføres). Empirisk entropi (bit/sample, ordre-0
Shannon) regnes på et PULJET histogram over ALLE medlemmer+begge kanaler
(u,v) for den flisen — en nedre grense for enhver koder, rapportert ved
siden av gzip/brotli slik at gapet er synlig.

Full kode: `tools/weather-pack/src/entropy-experiment.ts`. Full rå-output:
`tools/weather-pack/out/entropy-experiment-report.json` (git-ignorert).

---

## 2. Hovedresultat — beste kombinasjon

**Fast global LSB 0,5 kn + 2D MED/Paeth-prediktor** slår alt annet målt,
med god margin, for begge fliser:

| Flis | rått | gzip | brotli (kval. 9) | maxDecodeErrorKn |
|---|---|---|---|---|
| 5_28 | 14,88 MB | **3,82 MB** | 3,94 MB | 0,3536 |
| 5_29 | 14,06 MB | **3,74 MB** | 3,85 MB | 0,3536 |
| **Sum (begge fliser)** | **28,94 MB** | **7,56 MB** | 7,79 MB | 0,3536 |

**Mot dagens produksjonsskjema** (adaptiv 8-bit + tidsdelta, målt på
NYTT her — se §6 for kryssjekk mot `pakkestoerrelse-ekte-2026-09-03.md`s
tall): 26,84 MB gzip. **Forbedring: 26,84 → 7,56 MB, faktor 3,55×
BEDRE enn i dag** — eller regnet fra rått: dagens faktor er 1,06×, den
nye kombinasjonen er **3,83×**.

Kostnaden: `maxDecodeErrorKn` stiger fra dagens observerte 0,107–0,120 kn
til 0,3536 kn (0,5 kn LSB, `hypot(0,25;0,25)`). Fagagentens diagnose
samme dag anslo at ≥0,5 kn toleranse er akseptabelt for rutingen — dette
tallet ligger under den grensen, men **er ikke selv verifisert mot
rangeringskvalitet** (se §5/§7).

**`offset=per flis` vs. `offset=ingen (fast −40 kn)` gir IDENTISK (eller
praktisk identisk) resultat** ved samme LSB — forventet og en god
sanity-sjekk: Shannon-entropi er invariant under en konstant additiv
forskyvning av symbolalfabetet, og gzip/brotli er i praksis nesten like
upåvirket. Den ENE reelle forskjellen er bit-bredde ved grensetilfeller
(se §3): et data-uavhengig fast offset må dekke verste tenkelige tilfelle
og kan derfor trenge FLERE bit enn et per-flis-tilpasset offset i noen
fliser.

---

## 3. Full matrise (bytes, entropi, maxDecodeErrorKn)

### 3.1 Kombinert (begge fliser), sortert på gzip

| Kvantisering | Prediktor | Bit | gzip MB | brotli MB | maxDecodeErrorKn | Kombinert feilgrense (residual) |
|---|---|---|---|---|---|---|
| lsb05-none | 2d-med | 8 | **7,56** | 7,79 | 0,3536 | – |
| lsb05-perTile | 2d-med | 8 | 7,56 | 7,79 | 0,3536 | – |
| lsb05-perTile | romlig-venstre | 8 | 8,93 | 9,05 | 0,3536 | – |
| lsb05-none | romlig-venstre | 8 | 8,94 | 9,05 | 0,3536 | – |
| lsb05-none | medlem-kontroll+romlig | 8 | 10,32 | 10,44 | 0,3536 | 0,7071 |
| lsb05-perTile | medlem-kontroll+romlig | 8 | 10,32 | 10,44 | 0,3536 | 0,7071 |
| lsb025-perTile | 2d-med | 16 | 11,09 | 11,23 | 0,1768 | – |
| lsb025-none | 2d-med | 16 | 11,97 | 12,10 | 0,1768 | – |
| lsb025-perTile | romlig-venstre | 16 | 13,34 | 13,15 | 0,1768 | – |
| lsb025-none | romlig-venstre | 16 | 14,43 | 14,13 | 0,1768 | – |
| lsb05-perTile | tidsdelta | 8 | 14,47 | 14,25 | 0,3536 | – |
| lsb05-none | tidsdelta | 8 | 14,48 | 14,25 | 0,3536 | – |
| lsb025-perTile | medlem-kontroll+romlig | 16 | 14,78 | 14,63 | 0,1768 | 0,3536 |
| lsb05-none | ingen | 8 | 14,83 | 13,78 | 0,3536 | – |
| lsb05-perTile | ingen | 8 | 14,83 | 13,78 | 0,3536 | – |
| lsb025-none | medlem-kontroll+romlig | 16 | 16,09 | 15,67 | 0,1768 | 0,3536 |
| lsb05-none | medlem-kontroll | 8 | 16,15 | 15,73 | 0,3536 | 0,7071 |
| lsb05-perTile | medlem-kontroll | 8 | 16,15 | 15,74 | 0,3536 | 0,7071 |
| dagens | 2d-med | 8 | 18,96 | 19,12 | 0,1196* | – |
| lsb025-perTile | tidsdelta | 16 | 21,28 | 20,29 | 0,1768 | – |
| dagens | romlig-venstre | 8 | 21,53 | 21,34 | 0,1196* | – |
| dagens | medlem-kontroll+romlig | 8 | 21,72 | 21,77 | 0,1196* | 0,2392* |
| lsb025-perTile | ingen | 16 | 22,19 | 20,59 | 0,1768 | – |
| lsb025-perTile | medlem-kontroll | 16 | 22,93 | 21,54 | 0,1768 | 0,3536 |
| lsb025-none | tidsdelta | 16 | 23,37 | 21,66 | 0,1768 | – |
| lsb025-none | ingen | 16 | 23,66 | 21,38 | 0,1768 | – |
| lsb025-none | medlem-kontroll | 16 | 24,88 | 22,82 | 0,1768 | 0,3536 |
| dagens | tidsdelta (= dagens produksjon) | 8 | 26,84 | 26,76 | 0,1196* | – |
| dagens | medlem-kontroll | 8 | 27,95 | 27,90 | 0,1196* | 0,2392* |
| dagens | ingen | 8 | 28,34 | 27,95 | 0,1196* | – |

`*` **"dagens" `maxDecodeErrorKn` er den STØRSTE observerte over de 60
medlem×kanal-lagene** (0,1196 for 5_28, 0,1068 for 5_29 — se §6), IKKE en
enkelt skala som for de faste LSB-variantene. Kombinert feilgrense for
`medlem-kontroll`-variantene på "dagens" er strukturelt SVAKERE begrunnet
enn for de faste LSB-variantene: kontrollens og medlemmets per-slice
skala/offset er beregnet UAVHENGIG av hverandre (hver `buildWindMemberPackage`-
kjøring finner sin egen min/maks), så en rå kode-differanse mellom dem
blander to forskjellige skala/offset-par — tallet (2× enkelt-feilen) er en
grov øvre skranke, ikke en tett en. For de FASTE LSB-variantene er
kontroll og medlem kvantisert med NØYAKTIG samme skala/offset, så
2×-skranken er tett og meningsfull. Dette er selv et argument for at en
global, delt kvantisering er en forutsetning for at medlem-kontroll-
residualkoding skal gi mening — se §9.1-notatet i `docs/specs/
vaerpakker.md`.

### 3.2 Per-flis detaljtabell

Full per-flis-tabell (alle 60 celler) er for lang til å gjengi her —
se `tools/weather-pack/out/entropy-experiment-report.json` (`tiles[].variants[]`)
for hver flis' egne tall. Ett bemerkelsesverdig funn derfra: `lsb025-perTile`
trenger **16-bit på 5_28** (observert spenn 65,5 kn ÷ 0,25 kn = 264
nivåer > 256) men **fitter i 8-bit på 5_29** (observert spenn 54,9 kn ÷
0,25 kn = 222 nivåer ≤ 256) — et grensetilfelle som viser at 0,25 kn LSB
med per-flis-tilpasset offset er MARGINALT for 8-bit i dette datasettet;
et smalere offset (f.eks. separat per kanal u/v i stedet for poolet) ville
trolig løst dette for begge fliser, men er ikke testet her.

---

## 4. Entropigap

Entropien er en nedre grense for enhver koder (Shannon, ordre-0, ikke
kontekstmodellert). To ytterpunkter, illustrert med 5_28:

- **`dagens`+`ingen`** (dagens rå bytes, ukomprimert transportform):
  entropi **7,933 bit/sample** (teoretisk 14,75 MB) mot **faktisk gzip
  14,67 MB** — praktisk talt PÅ entropigrensen. Dette bekrefter
  `pakkestoerrelse-ekte-2026-09-03.md`s observasjon ordrett: bytene er
  nær full entropi, INGEN generell koder (gzip, brotli, eller i
  prinsippet en optimal aritmetisk koder) kan gjøre nevneverdig bedre med
  DENNE kvantiseringen/prediktoren.
- **`lsb05`+`2d-med`** (beste kombinasjon): entropi **1,812–1,967
  bit/sample** (teoretisk 3,37–3,46 MB) mot **faktisk gzip 3,74–3,82
  MB** — gzip er innenfor **~8–13 %** av entropigrensen. Det ER et lite,
  men reelt gap: en spesialisert entropikoder (range-/aritmetisk koding
  med samme ordre-0-modell) kunne i prinsippet vinne ytterligere
  8–13 % (~0,3–0,5 MB), men IKKE et sted i nærheten av gzips svakhet på
  dagens skjema. Gevinsten ligger overveldende i
  kvantiserings-/prediktorvalget, ikke i entropikoderen.

**Konklusjon:** problemet med dagens 1,06×-faktor er IKKE at gzip er en
svak koder — det er at dagens kvantisering+prediktor produserer
byte-strømmer som ER nær maksimal entropi. Å bytte akse (romlig i stedet
for tidsmessig prediktor) og grovne skalaen (fast 0,5 kn i stedet for
adaptiv ~0,1–0,2 kn) flytter selve entropien ned med en faktor **~4,3×**
(7,93 → 1,81 bit/sample på 5_28) — gzip følger med, praktisk talt uten
behov for en bedre koder.

---

## 5. 1°-flisregnskap

**Endring:** `tools/weather-pack/src/grid.ts`s `tileIdForLonLat`,
`tileBounds` og `tilesOverlapping` tar nå en valgfri `tileSizeDeg`-
parameter (default `WEATHER_TILE_DEG = 2`, uendret). Å bytte standard
flisstørrelse er nå bevisst redusert til **én linje**
(`WEATHER_TILE_DEG`-konstanten) — IKKE gjort av denne bølgen; Magnus skal
se tallet under først. `pipeline.ts` trengte INGEN endring — den er
allerede bbox-agnostisk (tar `bbox` direkte, ikke en flisstørrelse).

**Metode:** rutens bbox er endepunktenes bounding box (samme metode som
`apps/pwa/src/weather/tile-select.ts::boundingBoxOf` faktisk bruker, og
samme metode som produksjonens `TARGET_TILES`-valg i
`build-live-package.ts` implisitt reproduserer): Skjæløy (59,1032°N,
10,9327°Ø) til Skagen (57,7211°N, 10,5836°Ø) →
bbox [10,5836–10,9327 Ø, 57,7211–59,1032 N]. Node-tellingen er EKSAKT
(lest fra de faktiske `LayerGeometry`-verdiene i de nedlastede blobene —
`nodesLat`/`nodesLon`/`latStepDeg`/`lonStepDeg` — samme lineære
tilnærming produksjonskoden selv bruker for byte-regnskapet, jf.
`pipeline.ts::windLayerGeometry`s dokumenterte forenkling), ikke en grov
arealbrøk.

| Skjema | Fliser | Areal | Noder (u/v, én kanal) |
|---|---|---|---|
| **Dagens (2°)** | 5_28 (10-12°Ø,56-58°N) + 5_29 (10-12°Ø,58-60°N) | 8 deg² | 5060+4784 = **9844** |
| **1°, kun cellene ruten faktisk krysser** | (10-11°Ø,57-58°N) + (10-11°Ø,58-59°N) + (10-11°Ø,59-60°N) | 3 deg² | 1215+1196+1170 = **3581** |
| **Andel** | | **37,5 %** av arealet | **36,4 %** av nodene |

Skalert lineært på det MÅLTE vind-datasettet (samme fysiske innhold, kun
mindre utsnitt — kompresjonsegenskapene bør derfor overføres direkte):

| | Rått | gzip (dagens tidsdelta) | gzip (beste: lsb05+2d-med) |
|---|---|---|---|
| 8 deg² (dagens, MÅLT) | 28,94 MB | 26,84 MB | 7,56 MB |
| 3 deg² (1°-fliser, EKSTRAPOLERT ×0,364) | **10,53 MB** | **9,77 MB** | **2,75 MB** |

**1°-flising og kvantiserings-/prediktorbytte er UAVHENGIGE, komponerbare
gevinster.** Kombinert (1°-fliser + lsb05+2d-med): vind alene lander rundt
**2,75 MB** for hele Skjæløy–Skagen-korridoren — ned fra §19 (4)s 27,4 MB,
en samlet faktor på **~10×**. Selv med et konservativt strøm-/bølge-/
metadata-påslag (`pakkestoerrelse-ekte-2026-09-03.md` §6s 2–5 MB-anslag,
selv om det anslaget òg trolig er optimistisk av samme grunn som vind
var), er en pakke godt innenfor 30 MB — trolig i et 5–15 MB-område i
stedet for 27–40 MB.

**Operasjonell avveining, IKKE kvantifisert her (til Magnus):** 1°-fliser
gir 3 fliser å hente/cache i stedet for 2 for DENNE ruten (flere R2-
objekter, flere separate nettverksoppslag), og — viktigere — en rute som
avviker fra den rette linjen mellom endepunktene (isokron-ruting med
kryssing, ikke en luftlinje) kan trenge en 4. eller 5. 1°-flis som en
2°-flis ville dekket "gratis" innenfor sin generøse margin. Dagens
2°-fliser er dermed mer ROBUSTE mot rutevariasjon; 1°-fliser er billigere
for EN kjent, smal korridor. Dette er ikke målt (krever et ekte,
beregnet isokron-spor, ikke bare endepunktene) og bør vurderes før 1°
faktisk velges som ny standard.

---

## 6. Kryssjekk mot `pakkestoerrelse-ekte-2026-09-03.md`

`dagens`+`tidsdelta` her (26,84 MB gzip, begge fliser) er den SAMME
matematiske transformen produksjonen faktisk bruker
(`serializeLayer({deltaCoded:true})`), regnet på nytt fra de samme
blobene. Forrige måling rapporterte **27,41 MB** (`gzipDeltaTotal`,
`build-report.json`). Avviket (~2 %) forklares av gzip-nivå: denne
spikens tall bruker eksplisitt **nivå 9** (`node:zlib`s sterkeste), mens
`build-live-package.ts` kalte `gzipSync` uten eksplisitt nivå (Nodes
standard, nivå 6) — en svakt sterkere komprimering her er forventet, ikke
et avvik som svekker tilliten til metoden. `dagens`+`ingen` (28,34 MB) er
tilsvarende sammenlignbar med forrige målings `gzipNoDeltaTotalExtrapolert`
(28,94 MB, ekstrapolert fra kun medlem 0 × 30 — denne spikens tall er
EKTE per-medlem-målt, ikke ekstrapolert, en presisering av samme tall).

---

## 7. Representativitet (fagagentens forbehold, gjentatt)

Dette er **én init** (04Z 3. sept 2026), **to fliser** over åpent
Skagerrak, i et regime som (ut fra det observerte hastighetsområdet,
opptil ~36 kn) inkluderer noe frisk vind, men ikke er verifisert mot et
stille høytrykk eller en kraftig frontpassasje. **3–5 init over ulike
værregimer** trengs før noe tall i denne rapporten (spesielt den faste
0,5 kn LSB-en og `±40 kn`-grensen for `-none`-variantene) låses som ny
standard. Spesifikt:

- Et regime med SVAKERE vind (stille høytrykk) kan ha et smalere
  fysisk område — bra for `-perTile`-variantene (smalere spenn, kanskje
  8-bit selv ved 0,25 kn), men irrelevant for `-none`-variantenes faste
  grense.
- Et regime med STERKERE vind (storm) kunne i prinsippet nærme seg eller
  overskride `±40 kn`-grensen denne rapporten brukte for `-none`-
  variantene — verifiser mot faktiske stormtilfeller før den grensen
  låses, ikke bare mot denne ene, moderate init.
- Den faste LSB-ens PÅVIRKNING PÅ RANGERINGSKVALITET (ikke bare byte-
  størrelse/`maxDecodeErrorKn`) er IKKE målt her — det krever
  `tools/kvantisering`s skadeharness (§9.8 i `docs/specs/vaerpakker.md`,
  parallell bølge samme dag), kjørt mot disse konkrete kandidatverdiene.

---

## 8. Anbefaling til Magnus (tall, ikke adjektiver)

1. **Beste målte kombinasjon:** fast global LSB 0,5 kn + 2D MED/Paeth-
   prediktor. Vind alene (kontroll+30 medlemmer, begge fliser): **7,56 MB
   gzip** (mot dagens 27,4 MB, faktor **3,83×** mot dagens **1,06×**),
   til kostnaden `maxDecodeErrorKn` 0,3536 kn (mot dagens ~0,11 kn).
2. **1°-fliser er en uavhengig, komponerbar gevinst:** samme rute trenger
   kun 36,4 % av dagens nodeareal → vind alene ~2,75 MB EKSTRAPOLERT
   kombinert med (1). Standard flisstørrelse er IKKE endret (fortsatt
   2°) — parameteren finnes nå, bytte er én linje.
3. **Ingen av tallene er klare til å låses ennå:** (a) kun én init/to
   fliser målt (§7), (b) den faste LSB-en er IKKE verifisert mot
   rangeringskvalitet, kun mot byte-størrelse og rå kvantiseringsfeil
   (krever `tools/kvantisering`s harness, parallell bølge), (c) 1°-
   flisenes robusthet mot faktisk (ikke luftlinje-) ruteavvik er ikke
   undersøkt.
4. **Konkret forslag:** behold §8s INTERIM 50 MB-tak (satt i
   `docs/specs/vaerpakker.md` denne bølgen) til (3b) er gjort — kjør
   `tools/kvantisering`s skadeharness mot en kandidat på 0,5 kn fast LSB
   + 2D MED-prediktor, på MINST 3 init (ulike regimer). Består den,
   er en pakke på 5–15 MB (vind+1°-fliser) et realistisk mål — vesentlig
   under BÅDE dagens 27,4 MB-vind-alene-funn og den tidligere varslede
   40 MB-budsjettrevisjonen, uten at 2,5 km-oppløsningen ofres.
