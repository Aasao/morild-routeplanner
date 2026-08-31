# tools/chart-pack

Byggetids-pipeline for farbarhetsmasken (`docs/specs/farbarhetsmaske.md`).
Denne README-en dekker **fase 1, bølge 1**: en spike + en ekte, liten
test-pakke for Skjæløy/Hvaler-området. Ikke produksjonspipelinen for
Skandinavia — se "Avvik fra spec" nederst.

## 1. Turf-vs-geos-wasm-spike — konklusjon

**Valg: `@turf/turf` v7, ingen `geos-wasm`.**

Kjørt mot ekte Kartverket/Kystverket-geometri for testområdet (§2), ikke
syntetiske firkanter — se `src/spike/turf-vs-geos.ts`
(`pnpm --filter @morild/chart-pack spike` etter `pnpm --filter
@morild/chart-pack build` for tsc).

**Korrekthet:** ingen selvskjærende polygoner (`turf.kinks`) blant de 1291
lukkede dybdekurve-ringene i testområdet; union/differanse/buffer ga
geometrisk riktige resultater verifisert både med eksplisitte
punkt-i-polygon-sjekker i `pipeline.test.ts` (§6.1-fasit) og mot ekte
skjær/tørrfall/farled-punkter i `packages/charts/src/golden-oslofjord-hvaler.test.ts`.
**Viktig funn:** turf v7s boolske operasjoner (`@turf/union`,
`@turf/difference`) er internt bygget på `@turf/jsts` — samme robuste
topologimotor (JSTS, portert fra JTS/Java) som var alternativet. Valget
mellom "turf" og "geos-wasm" er dermed i praksis et valg mellom to
JS-vennlige innpakninger av lignende robusthet, ikke et valg mellom en
robust og en skjør motor — det reduserer risikoen ved å velge turf
betydelig sammenlignet med hva §4-tabellen antok da spec-en ble skrevet.

**Ytelse (ekte tall, testområdets datasett — 3762 dybdekurver hvorav 1291
lukkede, 578 skjær, 3913 grunne, 2308 tørrfallspolygoner):**

| Operasjon | Første forsøk | Etter optimalisering |
|---|---|---|
| `buildDepthBands` (union pr. dybdeverdi + differanse mellom nabobånd, 12 bånd) | 3,3–5,1 s | (uendret, allerede greit) |
| `buildDryFallZones` (kun parsing+polygonbygging, ingen global union) | 9,2 s (med union) | 17–25 ms (union fjernet, se under) |
| `buildBufferedHazards` (buffer 20 m × 4491 punkter) | 0,6–10,4 s | uendret, akseptabelt |
| `subtractHazardsFromBands` (bånd ∖ tørrfall) | **139,9 s** (én stor union ∖ én stor union) | **6,6 s** etter runde 1 (bbox-filtrert PR band) → **under 1 s** etter runde 2 (bbox-filtrert per enkelt-polygon i bandet) |
| `subtractHazardsFromBands` (bånd ∖ skjær/grunne) | (ikke fullført — prosessen ble drept ved ~1,15 GB minnebruk, se historikk) | 6,5 s → under 1 s |

**Konkret, overførbart funn for neste bølge (nasjonal skala):** boolsk
differanse mellom to STORE, komplekse multipolygoner skalerer dårlig i
JSTS/turf — en union av 2308 spredte tørrfallspolygoner er billig (de er
disjunkte, biblioteket optimerer for det), men å differensere ett stort
dybdebånd (som selv er en multipolygon spredt over hele flisen) mot den
store tørrfall-unionen tar minutter. Løsningen som fungerte: filtrer
farepolygonene til kun dem hvis bounding box overlapper **hvert enkelt
delpolygon i bandet** (ikke bandets samlede bbox — det grunneste bandet
dekker uansett hele området) FØR union+differanse. Se kommentaren over
`subtractHazardsFromBands` i `src/pipeline.ts`. For hele Skandinavia (§7:
150–250 fliser) bør dette gjøres PER FLIS (kutt til et lite geografisk
område helt tidlig i pipelinen, ikke bygg bånd nasjonalt og flis etterpå)
— se "Neste bølge" nederst.

## 2. Rå-data — ekte Kartverket/Kystverket-uttrekk

Se `testdata/raw/METADATA.md` for full kilde-/spørringsdokumentasjon,
lisensreferanser og to konkrete WFS-kvirker som kostet tid å finne
(akse-rekkefølge per tjeneste, og at Kystverkets WFS ikke klipper features
til spørrings-bboksen). Kort oppsummert:

- Bbox: 59,05–59,30° N, 10,60–11,00° Ø (Hvaler/ytre Fredrikstad-skjærgården).
- Kartverket Sjøkart–Dybdedata: `Dybdekurve` (3762), `Tørrfall` (2308),
  `Skjær` (578), `Grunne` (3913), `Datakvalitet` (112, med CATZOC-attributt
  — se legal-notatet).
- Kystverket: `Farledsareal` (layer_554, 2 polygoner) + `Hovedled og biled`
  (layer_552, 20 linjesegmenter, kun hentet som kontekst denne bølgen).
- Totalt gzippet: **2,6 MB** — godt innenfor oppdragets < 100 MB-grense.

## 3. Hva er bygget

- `src/gml.ts` — formåls-tilpasset GML-parser for nøyaktig de skjemaene disse
  to WFS-ene faktisk returnerer (ikke en generell GML-bibliotek-erstatning,
  se filens toppkommentar).
- `src/geometry.ts` — turf-wrappere (union/differanse/buffer/validering) med
  konvertering til/fra pakkeformatet i `@morild/charts`, inkl. avrunding til
  7 desimaler (se "Størrelsesfunn" under).
- `src/pipeline.ts` — selve algoritmen: `buildDepthBands` (§3.4),
  `subtractHazardsFromBands` (tørrfall/skjær/grunne, §4 steg 4),
  `buildFarledZones`/`buildDataQualityZones` (§3.5), `buildTilePayloads`
  (§3.1/§4 steg 6 — ekte klipping til flisgrensen med `@turf/bbox-clip`,
  ikke bare gruppering).
- `src/build.ts` — orkestrerer alt over mot `testdata/raw/*.gml.gz` og
  skriver `testdata/pack/oslofjord-hvaler.json.gz` (kjør med
  `pnpm --filter @morild/chart-pack build`).
- `src/pipeline.test.ts` — §6.1-fasit-tester på syntetisk, håndbygget
  geometri (nøstede firkanter, tørrfall-hull, skjær-buffer-radius,
  flisgrense-splitting).
- Fixturen kopiert til `packages/charts/testdata/oslofjord-hvaler.json.gz`
  og brukt av `packages/charts/src/golden-oslofjord-hvaler.test.ts` — se
  den pakkens README/rapport for `ChartSource`-oppslagstestene.

## 4. Størrelsesfunn (§7 i spec-en)

Målt, ikke antatt: to fliser (0,5°×0,25° hver) med full skjærgårds-
kompleksitet (2308 tørrfallspolygoner + 4491 buffrede skjær/grunne-punkter
+ 12 dybdebånd + farled + datakvalitet) ble **3,3 MB gzippet** før
avrunding, **2,25 MB** etter avrunding av koordinater til 7 desimaler
(fjerner 15–17-sifret flyttallsstøy fra turfs boolske operasjoner — ren
gevinst, ingen presisjonstap som betyr noe på denne skalaen). Det er
**langt over** spec-ens foreslåtte ≤ 500 KB/flis-budsjett (§7) — dette er en
ekte, målt overskridelse for skjærgårdstette fliser, ikke en antakelse.
Spec-en forutså nettopp dette scenariet ("binær pakking... er en dokumentert
fremtidig optimalisering hvis målte flisstørrelser sprenger budsjettet") —
det er nå målt til å sprenge budsjettet, ca. 4-5× for denne typen tett
skjærgårdsflis. Anbefalt til neste bølge: fastpunkt-/delta-koding av
koordinater, og/eller å representere buffrede skjær/grunne-punkter som
`(punkt, radius)` i pakken i stedet for ferdig-bufrede polygoner (klienten
gjør selv en enkel avstandssjekk — billigere å lagre, og
`point-in-polygon.ts` har allerede avstandsprimitiver som kunne dekke det).

## 4a. QA-validator: dybdepunkt-sondering vs. bånd (felle 2, beslutning 2026-08-31)

`validateSoundingsAgainstBands` (`src/pipeline.ts`) sjekker, FØR skjær/grunne
trekkes fra dybdebåndene, at ingen dybdepunkt-sondering med kjent dybde
havner geometrisk i et bånd den er grunnere enn (bånd `(lower, upper)`
påstår "dypere enn `lower`"). Kjørt mot `Grunne`-punktene som
ground-truth-proxy (se §3.4-notatet i spec-en: intet eget `Dybdepunkt`-lag
er ingestert i denne bølgen).

**Ekte funn i denne fixturen: 503 av 3913 (12,9 %) Grunne-soundinger
bryter regelen** — typisk mønster: en Grunne sondert til 32–39 m havner
geometrisk i 40–50 m-bandet. Årsak, mest sannsynlig: åpne-kurver-hullet
(§5 avvik #1) — når en avgrensende mellomliggende kurve (f.eks. 30 m- eller
40 m-konturen akkurat der) er droppet fordi den krysser kartbladgrensen,
blir 40–50 m-bandet kunstig for stort og sluker areal som i virkeligheten
er grunnere. Dette er IKKE en feil i selve differanse-algoritmen (§6.1s
fasit-tester på syntetisk geometri viser at den er korrekt) — det er et
konkret, målt symptom på samme rotårsak som felle 1 (åpne kurver), synlig
her fordi validatoren sammenligner mot uavhengige punktmålinger i stedet
for kun å stole på kurvetopologien. Brudd flagges i
`header.layers[dybdebaand].sourceStatus` (og løfter toppnivå-`sourceStatus`
til `"degraded"` med antall) — bygget stoppes ikke, i tråd med N2 (synlig,
ikke blokkerende). Se `docs/specs/farbarhetsmaske.md` §4 steg 4a.

## 5. Avvik fra spec (med begrunnelse)

1. **Kun lukkede dybdekurve-ringer brukes** (1291 av 3762, 34 %). Kartverkets
   dybdekurver er kartblad-inndelt — en kontur som fortsetter inn i naboarket
   returneres som en åpen linje i vårt bbox-uttrekk. Å stitche disse sammen
   på tvers av kartblad (eller hente et mye større område og stole på at
   konturene lukker seg innenfor det) er en ekte GIS-oppgave som fortjener
   egen tid, ikke en snarvei i denne bølgen. Konsekvens: dybdebåndene i
   testpakken dekker mindre areal enn den fulle sonderte skjærgården —
   pakkens `sourceStatus` er satt til `"degraded"` med forklaring, og
   `layers[].sourceStatus` for `dybdebaand` bærer samme forklaring (N2: ærlig
   degradering, ikke skjult).
2. **Ingen reprojeksjon (`proj4`)**: begge WFS-ene ble spurt med
   `srsName=EPSG:4326`/`EPSG:4258` og svarte i geografiske koordinater
   direkte — ingen UTM-transformasjon var nødvendig for DENNE bølgens
   uttrekk. En nasjonal kjøring som henter native UTM-soner (25832/33/35)
   trenger fortsatt `proj4` som spec-en sier.
3. **Farled-tillitsløft bruker kun `Farledsareal` (layer_554)**, ikke
   `Hovedled og biled` (layer_552, en senterlinje — ikke et areal). Dette
   var ikke opplagt før pipelinen faktisk hentet begge lagene og så
   geometritypen (se legal-notatet).
4. **Luftspenn, TSS, vernesone: ingen ekte kilde ingestert.** Typene
   (`AirDraftZone`, `TssLane`, `ProtectedZone`) og oppslagsregelen (inkl.
   "uverifisert luftspenn-datum gir maks usikkert") er implementert i
   `packages/charts` og dekket av syntetiske §6.1-tester, men pakken for
   dette testområdet har tomme lister for alle tre. Kartverkets
   "maritim infrastruktur"-URL er fortsatt uverifisert (spec §8 pkt. 1);
   TSS/vernesone lå utenfor oppdragets eksplisitte omfang for denne bølgen
   ("dybdebånd... ∖ tørrfall ∖ buffrede skjær/grunner... farled...
   tillitsgrid").
5. **LØST (2026-08-31, VALSOU-modellen, E4).** `Grunne`-punkter ga tidligere
   alltid no-go når buffret, uansett `dybde`-attributt (observert opptil
   218 m i testdataene, median 4,7 m av 3913 målte — se
   `docs/specs/farbarhetsmaske.md` §3.4). Magnus besluttet 2026-08-31 at
   dette var feil vei: en falsk sperring (30 m-grunne som blokkerer en
   2,6 m-klaring) undergraver tilliten til hele masken. `buildBufferedHazards`
   bærer nå `dybde`-attributtet gjennom til pakkeformatet
   (`BufferedHazardPoint.dybdeM`); selve no-go-avgjørelsen flyttet til
   oppslagstidspunktet i `packages/charts/src/chart-source.ts`: no-go kun
   når `dybdeM < kravTilDybdeM` eller `dybdeM` mangler. **Funn i denne
   fixturen: 3913 av 3913 Grunne-objekter (100 %) har et `app:dybde`-
   attributt** — "mangler dybde"-grenen i VALSOU-regelen er reell kode
   (dekket av en syntetisk fasit-test), men ikke observert i ekte data ennå.
   `Skjær` beholder den gamle regelen (alltid no-go) — bekreftet at 578 av
   578 Skjær-objekter ALDRI har `app:dybde` i kildedataene, så det finnes
   ikke noe tall å avveie mot der.
6. **`vintage`/`init` i pakkeheaderen bruker uttaksdatoen** (`datauttaksdato`
   fra WFS-responsen), ikke en sammenslåing av hvert objekts
   `førsteDatafangstdato`/`oppdateringsdato`. Ærlig, dokumentert forenkling
   — se legal-notatet.
7. **Ingen R2-publisering, ingen PMTiles-bygging** (spec §4 steg 9–10) —
   pakken skrives kun til en lokal fil i denne bølgen, som oppgitt i
   oppdraget ("skrevet til lokal fil, R2-publisering kommer senere").
8. **`tools/arch-tests` er ikke endret** — behovet er dokumentert i
   `packages/charts/TODO.md` i stedet, som instruert.

## 6. Neste bølge

- **PMTiles/visning** (§4 steg 10) — separat artefakt fra samme kildelag.
- **Air draft-lag**: avklar Kartverkets "maritim infrastruktur"-URL (§8
  pkt. 1) FØR ekte luftspenn-geometri hentes — datummet er
  sikkerhetskritisk (§8 pkt. 1s egen advarsel).
- **TSS-lag**: hent Kystverkets `TSS områder` (layer_706) og avklar om
  lane-akseretning er et attributt eller må avledes geometrisk.
- **Resten av Skandinavia**: krever (a) stitching av dybdekurver på tvers av
  kartblad ELLER en arkitekturendring til "flis først, algebra per flis"
  (se spike-konklusjonen om ytelse), (b) `proj4`-reprojeksjon for
  UTM-native uttrekk, (c) en løsning på §4-tabellens Sverige/Danmark-kilder
  (EMODnet/DDM), (d) en løsning på størrelsesbudsjettet (seksjon 4 over) FØR
  det skaleres til 150–250 fliser.
- **Landmaske/kystlinje**: denne bølgen bygger ikke et eget sjø/land-
  basispolygon (§4 steg 1) — det grunneste bandet (0 til laveste kartlagte
  kurve) fungerer som en de facto konservativ erstatning fordi det uansett
  alltid gir no-go, men det er ikke det samme som en ekte kystlinje-
  differanse. Bør vurderes eksplisitt i en ADR om det er godt nok
  permanent, eller bør bygges skikkelig med `Kystkontur`/`Landareal`-laget
  (begge hentet i GetCapabilities-utforskningen, ikke i denne pakken).
