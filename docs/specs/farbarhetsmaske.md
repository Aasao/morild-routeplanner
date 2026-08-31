# Spec: Farbarhetsmaske

- Status: utkast — venter på Magnus' gjennomgang før `tools/chart-pack` bygges
- Dato: 2026-08-30, oppdatert 2026-08-31 (se «Endringslogg» nederst)
- Grunnlag: `docs/00-kravspek.md` F1.0–F1.9, N1/N2/N3/N5/N6 · `docs/research/kartdata-skandinavia.md`
  · `docs/research/review-seiler.md` · `docs/research/review-arkitekt.md` (M3, M4, B7)
  · `docs/decisions/ADR-0001…0003` · `packages/protocol/src/package-header.ts`
  · `docs/research/ekspertpanel-2026-08-31.md` og
  `docs/research/ekspertpanel-runde2-2026-08-31.md` §7 (Magnus' kartdata-
  beslutninger 2026-08-31: E4 VALSOU, E7 forenklingsforbud, E8 kart-først-lite,
  QA-validator, kjent-svakhet-golden)

## 1. Formål og kravsporing

Farbarhetsmasken er det laget som gjør at ruteren *tolker* kartdata i stedet
for å bare vise det (CLAUDE.md prinsipp 2). Denne spec-en dekker:

| Krav | Dekning i denne spec-en |
|---|---|
| F1.0 Prefabrikkert-prinsipp | §4 Byggepipeline: all prosessering skjer i `tools/chart-pack` i byggetid; klienten (`packages/charts`) gjør kun oppslag mot ferdige pakker, ingen geometriberegning på klienten utover polygon-/punkttester |
| F1.1 Ren polygonalgebra, ingen interpolasjon | §3.4 Dybdebånd, §3.6 sikkerhetskontur-regel |
| F1.2 Margin + sjøgangstillegg + negativ vannstand | §3.6 (grensesnitt-kontrakt: `packages/charts` kjenner ikke vær — se §2 avgrensning) |
| F1.3 Føre-var-regel og tillitsnivåer | §3.2, §3.7 (datakvalitet gater `trygt`) |
| F1.4 Seilingshøyde | §3.5 Luftspenn-laget |
| F1.5 TSS/skipsleder | §3.5 TSS/farled-laget |
| F1.6 Verne-/forbudssoner | §3.5 Vernesone-laget |
| F1.7 Sverige/Danmark, datum per kilde | §3.3 Datum, §3.7 tillitsnivå for utenlandske kilder |
| F1.8 Kartvisning | §4 steg 10 (PMTiles) — selve MapLibre-stilingen er utenfor scope, se §2 |
| F1.9 Offline, valgte områder | §3.1 Fliseinndeling |
| N1 Ingen rute uten tillitsnivå | §5 Degraderingsadferd |
| N2 Ærlig degradering | §5 |
| N3 Lisens/attribusjon | `docs/legal/*` (én fil per kilde, skrevet sammen med denne spec-en) |
| N5 Testbarhet, 50+ fasit-punkter | §6 Testkrav |
| N6 Ytelse i indre løkke | §6.4, §7 |

## 2. Avgrensning

Denne spec-en dekker **ikke**:

- **Kontur-constrained interpolasjon.** F1.1 er eksplisitt: v1-semantikken er
  ren polygonalgebra. Interpolasjon er en *senere* forbedring, kun aktuell
  hvis 5 m-kurven i praksis måler seg for restriktiv — det krever en egen
  ADR før det bygges, ikke en revisjon av denne spec-en.
- **Tidevanns-åpning av grunne områder.** Masken er statisk ved sjøkartnull
  (K0). Ingen tidsavhengig geometri i v2.0 (M4).
- **Sjøgangstillegg og negativ vannstand som geometri.** Dette er
  *tidsavhengige* størrelser som avhenger av værprognosen. `packages/charts`
  skal aldri importere eller kjenne til `packages/weather` (lagdelingsregelen
  i CLAUDE.md). Denne spec-en definerer derfor `ChartSource` slik at
  ruteren selv regner ut det **effektive** klaringskravet (dypgang + statisk
  margin + f(Hs) + vannstandsavvik) og sender det inn som ett tall — se §3.6.
  Selve utregningen av f(Hs) og vannstandsavviket hører hjemme i
  `specs/rutemotor.md` (kommer i fase 2).
- **Kostnadsfunksjonen for TSS-kryssing** (F1.5 nevner «kostnad»). Denne
  spec-en leverer geometri + retningsinformasjon; hvor mye det skal *koste*
  å seile langs en TSS-lei er en rutemotor-beslutning (F3.4).
- **Svensk/dansk farbarhet som egen autoritativ kilde.** Sverige har ikke
  åpen dybdedata (research §2); v2.0-strategien er tillitsnivådegradering +
  farled-bias (B5), ikke å bygge en norsk-kvalitets maske for svenske/danske
  farvann. Se §3.7.
- **MapLibre-styling og UI-visning av tillitsnivåer.** F1.8 sitt
  visningsansvar (raster-WMTS, PMTiles-stil, disclaimer-plassering) hører
  til en `specs/kartvisning.md` som ikke er skrevet ennå — denne spec-en
  leverer kun PMTiles-artefaktet.
- **Rutemotorens bruk av masken** (A*-felt på 500 m–1 km, segmentvis
  sikkerhetsettersjekk — B7/F3.1). Denne spec-en definerer *grensesnittet*
  ruteren kaller (§3.6) og et **hardt krav til rutemotor-spec-en**: enhver
  rute som presenteres eller merkes `trygt` MÅ ha kjørt `segmentTest()` med
  det faktiske dynamiske klaringskravet på hvert akseptert segment — den
  raske rutenettet i §6.4 er kun en pruning-heuristikk, aldri
  sikkerhetsavgjørende alene.
- **PRIMAR/S-57/S-101.** Kommersiell B2B-avtale, ikke en vei for v2.0
  (research §1).

## 3. Datamodell og kontrakter

### 3.1 Fliseinndeling og pakkeformat

**Fliser:** et enkelt lat/lon-rutenett, 0,5° lengdegrad × 0,25° breddegrad
(~15 nm × ~15 nm ved 59°N). Bevisst valg fremfor slippy-map z/x/y-fliser:
routing-oppslaget trenger eksakt geometri, ikke zoom-avhengig forenkling —
se boksen i §4 steg 10 om hvorfor PMTiles og routing-pakken er to separate
artefakter fra samme kildedata. Rutenettet gjør at F1.9 («valgte
kartområder») blir en liste med flis-ID-er brukeren synker, ikke alt-eller-
ingenting for Skandinavia.

Hver flis er en selvstendig, komprimert fil med alle lag klippet til flisens
grense. Format foreslås som JSON (koordinater som `[lon, lat]`-ringer,
GeoJSON-kompatibelt for enkel feilsøking/visualisering) + gzip ved lagring i
R2 — **ikke** en egen binærkoding i v2.0. Begrunnelse: datavolumet er lite
nok (§7) til at lesbarhet under feilsøking veier tyngre enn marginal
størrelsesgevinst; binær pakking (fastpunkt-koordinater, delta-koding) er en
dokumentert fremtidig optimalisering hvis målte flisstørrelser sprenger
budsjettet — samme «mål før du optimerer»-holdning som værpakkens
kvantisering fikk (M2).

**Pakke-header** (utvider `PackageHeader` fra `packages/protocol`):

```ts
interface ChartLayerMetadata {
  id: ChartLayerId; // "dybdebaand" | "torrfall" | "skjaer" | "luftspenn"
                     // | "farled" | "tss" | "vernesone" | "datakvalitet"
  kilde: string;          // f.eks. "Kartverket Sjøkart – Dybdedata"
  datum: Datum;           // se §3.3 — datum er PER LAG, ikke bare per kilde
  vintage: string;        // ISO-dato: kildeuttrekkets tidspunkt
  baselineTillit: TrustLevel | "n/a"; // TSS/luftspenn setter ikke tillit selv
  sourceStatus: SourceStatus; // gjenbruk fra packages/protocol
}

interface ChartPackageHeader extends PackageHeader {
  boundingBox: [west: number, south: number, east: number, north: number];
  tileGrid: { lonStepDeg: 0.5; latStepDeg: 0.25 };
  tiles: ChartTileId[]; // manifest — hvilke fliser finnes faktisk i pakken
  layers: ChartLayerMetadata[];
}
```

`PackageHeader`s generiske felt fylles slik for kartpakken: `model` =
kortnavn på kildekombinasjonen (f.eks. `"Kartverket+Kystverket+DDM+
Naturvårdsregistret"`), `init` = eldste lag-vintage i pakken (den mest
konservative dateringen som vises i UI), `resolution` = flisrutenettets
mål (`"0.5°x0.25°"`). Toppnivå-`sourceStatus` er den verste av alle
lag-statusene; `layers[].sourceStatus` gir den presise, per-lag versjonen —
dette er nødvendig fordi ett lag (f.eks. Kystverkets TSS-WFS) kan feile og
falle tilbake til forrige kjørings kopi mens resten av pakken er frisk, og
det skal være synlig (N2), ikke smurt ut til én boolsk «ok».

### 3.2 Tillitsnivåer

```ts
type TrustLevel = "trygt" | "usikkert" | "no-go";
```

Ikke en firenivå-skala: manglende dekning (flis ikke bygget/ikke synket) er
**ikke** et fjerde tillitsnivå, men en egen degraderingstilstand
(`"utenfor-pakke"`) i oppslagsresultatet — se §3.6 og §5. Å blande dette inn
i tillitsnivåene ville gjort «vi mangler data her» umulig å skille fra «vi
vet dette er farlig», som er nøyaktig den forvirringen N2 skal forhindre.

### 3.3 Datum per lag

```ts
type Datum = "K0" | "MHW" | "DDM-middelverdi" | "ukjent";
```

Viktig presisering fra kartdata-rapporten: **selv innad i Kartverkets egen
kilde er datum ulikt per lag** — dybdekurver/-punkter er referert
sjøkartnull (K0), mens kystlinje/tørrfall/skjær er referert middels
høyvann (MHW). Datum-feltet i `ChartLayerMetadata` er derfor **per lag**,
ikke per kildeorganisasjon. Danmarks Dybdemodel er eksplisitt en
middelverdi-modell (`"DDM-middelverdi"`) — dette er ikke sjøkartnull, og et
DDM-lag skal derfor **aldri** kunne gi `trygt`, uansett målt dybde (§3.7).
Lag uten kjent datum (f.eks. et OSM/OpenSeaMap-avledet supplement) merkes
`"ukjent"` og har samme `trygt`-forbud.

### 3.4 Dybdebånd — kjernen i F1.1

**Nøkkelinnsikt for denne spec-en:** F1.2 krever et *dynamisk* klaringskrav
(dypgang + statisk margin + sjøgangstillegg + vannstandsavvik varierer per
segment og avgangstid), mens F1.1 krever at masken er *statisk*
byggetids-polygonalgebra. Disse forenes ved at pipelinen **ikke** velger
én sikkerhetskontur ved byggetid, men i stedet bygger **alle** dybdebånd
mellom nabokurver, og at valget av hvilken kurve som er sikkerhetskonturen
gjøres i `farbar()`/`segmentTest()` ved oppslagstidspunktet — fortsatt ren,
deterministisk polygonalgebra (ingen interpolasjon, bare båndoppslag +
sammenligning), men uten å måtte forhåndsanta ett dypgangstall.

Pipelinen bygger, for hver dybdekurveverdi $c_i$ i den kartlagte serien
(2, 5, 10, 15, 20, 30, 40, 50, 100, 150 m …):

```
bånd(c_i, c_{i+1}) = areal_grunnere_enn(c_{i+1}) ∖ areal_grunnere_enn(c_i)
```

der `areal_grunnere_enn(c)` er polygonet innenfor dybdekurve `c` (standard
sjøkartkonvensjon: kurven omslutter alt grunnere vann). Fra **alle** bånd og
fra sjø/land-basispolygonet trekkes tørrfall og buffrede skjær/grunner som
geometri (§4 steg 4) — men **Grunne** og **Skjær** har ulik no-go-semantikk
ved selve oppslaget, se VALSOU-boksen under.

**VALSOU-modellen for `Grunne` (E4, beslutning 2026-08-31, Magnus).**
Punktfarer av typen `Grunne` gir **no-go KUN når** det angitte
dybdeattributtet er mindre enn kravet ved oppslag (`kravTilDybdeM`), **eller**
når dybdeattributtet mangler; **ellers ingen blokkering** fra selve
grunne-punktet. Dette erstatter den tidligere regelen («alt buffret Grunne er
alltid `no-go`, uansett dybde») — den regelen ble forkastet fordi en
30 m-grunne som sperrer en 2,6 m-krav-rute lærer brukeren å ignorere masken
(falske sperringer undergraver tillit, jf. marinkartolog-vurderingens felle 3
og ekspertpanelets samstemte anbefaling E4). `Skjær` beholder den gamle,
strengere regelen: **alltid** `no-go` når punktet er innenfor bufferen,
uavhengig av dybde — bekreftet i fase 1-bølge 2-fixturen at `Skjær` aldri har
et dybdeattributt i kildedataene (578 av 578 uten `app:dybde`), så det finnes
ikke noe tall å avveie mot; `Skjær` er en presis, ikke-dybdebasert punktfare
på samme måte som tørrfall. `Grunne` har derimot alltid et dybdeattributt i
observerte data (3913 av 3913 i samme fixture, spredning fra -0,92 m til
218 m, median 4,7 m) — VALSOU-regelens «dybde mangler»-gren er dermed reell
kode (dekket av en fasit-test), men ikke observert i ekte data ennå.

Ved oppslag med et gitt klaringskrav `k` (i meter):

1. Finn hvilket bånd punktet ligger i (eller tørrfall/skjær/grunne/utenfor-pakke).
2. Er punktet i tørrfall eller innenfor en Skjær-buffer → `no-go`. Er punktet
   innenfor en Grunne-buffer → `no-go` KUN hvis Grunnens dybdeattributt
   mangler eller er `< k` (VALSOU-modellen over); ellers fortsett til steg 3
   som om Grunne-punktet ikke fantes.
3. Er båndets nedre grense < nødvendig sikkerhetskontur (nærmeste kartlagte
   kurve ≥ `k`, jf. F1.1s ordlyd — eksempelet i kravspeken er 2,6 m → 5 m-
   kurven) → `no-go`.
4. Ellers: `trygt` hvis punktet er innenfor et farled-polygon **eller** i en
   sone med god datakvalitet (§3.7) **og ikke i en guardrail-sone (under)**;
   ellers `usikkert` (føre-var-regelen, F1.3 — «areal mellom sonderinger
   antas aldri trygt»).

Dette er den viktigste designbeslutningen i denne spec-en og bør
kvalitetssikres av kartdata-agenten mot faktiske Kartverket-eksporter før
fase 1-bygging starter (se §8).

**QA-validator for dybdebånd-konstruksjonen (felle 2, beslutning
2026-08-31).** Bånd-konstruksjonen i §4 steg 4 antar at «kurven omslutter
alt grunnere» — ikke alltid sant for reelle S-57-avledede data
(depresjonskurver, selvskjæring, kartblad-topologifeil). Byggepipelinen skal
derfor validere DEPARE-uavhengig ground-truth mot de ferdige båndene: **ingen
dybdepunkt-sondering som havner geometrisk innenfor et bånd skal ha en målt
dybde grunnere enn båndets nedre grense.** Brudd flagges i byggerapporten og
i pakkens `sourceStatus`/`layers[].sourceStatus` (aldri stille sluket, N2) —
se §4 og §6 for byggetids- og testkrav.

**Guardrail for feilklassifiserte bånd (promotert fra QA-varsling,
beslutning 2026-08-31 — se
`docs/research/beslutningsgrunnlag-r3-e1-2026-08-31.md` «QA-funnet»).**
Fase 1-bølge 2-fixturen målte at 503 av 3913 (12,9 %) Grunne-soundinger
brukt som QA-validatorens ground-truth-proxy bryter regelen over — et
systematisk, IKKE tilfeldig, mønster (typisk: en 32–39 m-sondering havner i
et kunstig for stort 40–50 m-bånd, trolig et symptom på åpne-kurver-hullet
under). Flagging alene i byggerapporten er varsling, ikke beskyttelse: en
seiler som stoler på masken ser aldri byggeloggen. Validatoren er derfor
promotert fra ren QA til en byggetids-guardrail som endrer selve pakken:

1. **VALSOU-punktfare.** Hver flagget sondering legges inn i pakkens
   `bufferedHazards` som et `kind: "grunne"`-punkt (samme mekanisme som §4
   steg 4/E4), med `dybdeM` satt til den FAKTISK målte (feilklassifiserte)
   dybden og senterkoordinat i sonderingens posisjon. Oppslagsregelen er
   identisk E4/VALSOU: `no-go` KUN hvis `kravTilDybdeM` er strengere enn
   denne dybden, ellers ingen blokkering fra punktet alene. Dette er en
   EGEN, eksplisitt mekanisme (`buildSoundingGuardrails` i
   `tools/chart-pack`) — ikke bare en observasjon om at Grunne-punktene
   allerede får dette via §4 steg 4: ground-truth-kilden i denne bølgen ER
   Grunne-punkter (proxy), så de to mekanismene overlapper i praksis nå, men
   den dagen et ekte `Dybdepunkt`-lag (generelle soundinger, IKKE alle
   VALSOU/Grunne-objekter) finnes, er guardrailen den ENESTE kilden til
   punktbeskyttelse for dem.
   - **Bufferradius: 25 m** (halve sonderingsnettets 50 m-gradering, README
     "QA-validator"), bevisst FORSKJELLIG fra standard skjær-/grunne-
     bufferen på 20 m (§8 pkt. 3, som begrunnes med posisjonsusikkerhet for
     ETT punkt). Begrunnelse: en flagget sondering representerer ikke bare
     sitt eget punkt, men et areal på omtrent sonderingsnettets skala der
     bånd-inndelingen er bevist upålitelig. Dette er et dokumentert,
     forsiktig anslag — IKKE en målt verdi — for hvor langt utover selve
     punktet den samme usikkerheten trolig strekker seg, før bånd-
     delpolygon-flagget (som dekker hele det upålitelige delpolygonet,
     uavhengig av avstand) uansett tar over som den reelle beskyttelsen.
2. **Bånd-delpolygon-tak.** Det spesifikke delpolygonet (ett element i
   `DepthBand.polygons` — f.eks. én sammenhengende skjærgårds-/øyform) som
   den flaggede sonderingen geometrisk ligger i, kan ALDRI gi `trygt` ved
   oppslag — maks `usikkert`, med årsak `usikker-sondering-i-baand` i
   `aarsaker`, selv om delpolygonet ellers ville fått tillitsløft fra farled
   eller god datakvalitet (§3.4 steg 4). Dette er den faktiske
   beskyttelsen for RESTEN av delpolygonet som punktfaren (25 m) ikke når —
   uten dette ville et delpolygon som er BEVIST upålitelig fortsatt kunne
   returnere `trygt` et lite stykke fra selve sonderingspunktet. Geometrien
   flagges fra de RÅ (pre-hazard-subtraksjon) båndene — samme bånd-sett som
   selve QA-validatoren kjøres mot — fordi sonderingspunktet uansett senere
   skjæres ut som et hazard-hull i det ferdige bandet (ALLE Grunne-punkter,
   ikke bare flaggede, bufres og trekkes fra), så et søk i det FERDIGE
   bandet ville aldri funnet et treff.
3. **Ufarliggjør uten stitching.** Denne to-delte mekanismen gjør at
   feilklassifiserte bånd aldri kan lure en bruker til `trygt` — verken
   punktvis (VALSOU) eller for hele det upålitelige delpolygonet (tak) —
   UTEN å måtte vente på at åpne-kurver-stitchingen (under) faktisk lukker
   selve rotårsaken. Guardrailen er et sikkerhetsnett, ikke en fiks av
   bånd-konstruksjonen; stitching er fortsatt den egentlige løsningen.

Målt i fase 1-bølge 2-fixturen: 503 VALSOU-punktfarer og 273 unike
bånd-delpolygoner flagget (se `tools/chart-pack/README.md` "QA-validator" og
`packages/charts/src/guardrail-golden.test.ts` for et faktisk berørt
fasit-punkt).

### 3.4.1 CATZOC-avhengig effektivt dybdekrav (frosset kontrakt, B4)

**Beslutning 2026-08-31 (Magnus, B4 i steg 3-planen):** CATZOC-tillegget
forberedes semantisk NÅ, men kalibreres IKKE i denne bølgen. Bakgrunnen er
kartologens ekspertpanel-vurdering (`docs/research/ekspertpanel-2026-08-31.md`
§4): «CATZOC kvantitativt, ikke binært» — dagens maske bruker CATZOC kun som
en binær datakvalitets-gate (§3.4 steg 4: A1/A2/B kan gi tillitsløft, C/D/U
kan aldri gi `trygt`), men behandler ellers alle A1/A2/B-soner likt. En reell
sikkerhetskontur burde derfor strengt tatt kreve *mer* klaring i en B-sone
enn i en A1-sone, fordi CATZOC-klassen også sier noe om dybdemålingens egen
usikkerhet — ikke bare om hvorvidt et tillitsløft er tillatt.

**Kontrakten som fryses nå:** det effektive dybdekravet ved oppslag er

```
effektivtKravTilDybdeM = basiskrav + f(CATZOC-sone)
```

implementert som `effectiveDepthRequirement(basiskrav, catzocSone)` i
`packages/charts/src/catzoc.ts`, der `catzocSone: CatzocClass | undefined`
er CATZOC-klassen (eller «ingen klassifisert sone») som dekker punktet/korden
det slås opp mot. **`f` er FORELØPIG 0 for ALLE kategorier** — ingen
kalibrering mot ekte sonderingsdata er gjort. Alle tre oppslagsveier i
`chart-source.ts` som sammenligner et klaringskrav mot kartlagt dybde går via
denne funksjonen, ikke mot `kravTilDybdeM` rått:

- `evaluatePoint` — dybdebånd-sikkerhetskontur (`safetyContourFor`) og
  VALSOU-klaringssjekken for `Grunne`-punktfarer (§3.4 steg 2/3).
- `evaluateChordAgainstTile` — samme to sammenligninger, langs korden, med
  CATZOC-sonen valgt som den DÅRLIGSTE (lavest tillit) sonen korden krysser
  (`worstCatzocAlongChord`) — føre-var-retningen, konsistent med resten av
  spec-ens føre-var-prinsipp (F1.3), selv om den er uten praktisk betydning
  så lenge `f = 0`.
- `nermesteFareAvstandNm`s klaring-avledning (samme `safetyContourFor`-kall).

**Hvorfor fryse kontrakten nå i stedet for å vente på kalibrering (E7-logikken,
§4.1):** å legge til CATZOC-sone-oppslag ved alle tre kallesteder er en billig,
mekanisk endring i dag fordi den ikke flytter noen grense (`f = 0` ⇒ identisk
adferd, pinnet av regresjonstesten under). Å ettermontere den samme
oppslagsveien SENERE, når kalibrerte tall faktisk skal inn, ville krevd å
spore opp og endre de samme tre kallestedene på nytt — med reell risiko for å
glemme ett av dem (nøyaktig den typen semantikk-spredning §4.1s forenklings-
forbud allerede advarer mot). Ved å fryse grensesnittet nå blir en fremtidig
kalibrering en ren PARAMETERENDRING i `catzocSurcharge` (inni `catzoc.ts`),
ikke en semantikkendring som må godkjennes og spores gjennom kallestedene på
nytt.

**Kartologens foreslåtte fremtidige kalibreringstabell** (ekspertpanel
2026-08-31 §4, IHO S-57-aktig dybdenøyaktighetsform a + b·d, der d er
dybden) — **ikke implementert, kun dokumentert som grunnlag for en senere
ADR/spec-revisjon**:

| CATZOC | Foreslått f(dybde) |
|---|---|
| A1 | 0,5 m + 1 % av dybden |
| A2/B | 1,0 m + 2 % av dybden |
| C/D/U | aldri `trygt` — UENDRET binær gate (§3.4 steg 4), ikke et f-tillegg |

**Eksplisitt utenfor denne forberedelsens omfang** (til en senere bølge,
kartologens påminnelse i steg3-plan §Nytt fra runden):

- Selve kalibreringen av `f` (tallene i tabellen over er et forslag, ikke
  verifisert mot ekte sonderingsdata).
- **CATZOC i skjærbuffer-vurderingen.** Kartologen påpeker at CATZOC B har
  ±50 m posisjonsusikkerhet — mer enn dagens faste 20 m skjær-/grunne-buffer
  (§4 steg 4, §8 pkt. 3). At buffer-radius bør være CATZOC-avhengig er en
  SEPARAT forberedelse (en annen kontrakt: `bufferRadiusM` i
  `BufferedHazardPoint`, ikke `effectiveDepthRequirement`) og tas i en senere
  bølge — notert her for å ikke miste den observasjonen på veien.

**Testkrav (regresjonsvakt for f=0-kontrakten):**
`packages/charts/src/catzoc.test.ts` pinner at
`effectiveDepthRequirement(basiskrav, catzocSone)` returnerer `basiskrav`
uendret for alle seks CATZOC-klasser og for `undefined` (ingen klassifisert
sone) — dagens adferd er derfor identisk med og uten hooken. De **eksisterende
testene i `golden-oslofjord-hvaler.test.ts` og `guardrail-golden.test.ts` er
den egentlige regresjonen**: siden `f = 0`, skal ALLE eksisterende
forventninger (inkl. CATZOC-A1/-C-punktene) fortsatt bestå uendret etter at
`evaluatePoint`/`evaluateChordAgainstTile`/`nermesteFareAvstandNm` er
omskrevet til å kalle `effectiveDepthRequirement`.

### 3.5 De øvrige lagene

- **Luftspenn (F1.4):** punkt-/linjeobjekter (bruer, kraftspenn,
  fortøyningskabler på blåskjellanlegg) med `friHoydeM` og **egen
  `datum`** for den vertikale referansen. **Uverifisert:** hvilken
  vannstandsreferanse (MHW? MHWS?) Kartverkets «Sjøkart – maritim
  infrastruktur»-datasett bruker for oppgitt klaring — se §8, høy
  prioritet. Regel: `no-go` der `friHoydeM < mastehoydeM + margin`
  (mastehøyde+margin er et klientparameter, ikke bakt inn i pakken).
- **TSS/farled (F1.5):** polygoner for TSS-lane + separasjonssone, med lane-
  aksens retning lagret slik at ruteren kan beregne krysningsvinkel (Regel
  10: kryss så nær 90° som praktisk mulig). Farled-/hovedled-polygoner
  (Kystverkets «Hovedled og biled», «Toveisfarled») brukes òg som
  tillitsløft i §3.4 steg 4. TSS gir **ingen** trust-nivå og **ingen**
  `no-go` — kun en `tssAnnotasjon` i oppslagsresultatet (retning,
  lei-ID), fordi kryssing er lovlig og kostnaden hører til rutemotoren
  (§2).
- **Vernesone (F1.6):** polygon + `gyldigFra`/`gyldigTil` (dag-måned,
  gjentas årlig — sesongbaserte fugle-/sælskyddsområder i Bohuslän er
  typisk vår/sommer hekke-/kastetid) + `regel: "no-go" | "unnga"`. Oppslag
  tar `dato` som eksplisitt parameter (ikke systemklokke — se §3.6) nettopp
  for at sesongreglene skal være rene funksjoner av input.
- **Datakvalitet:** Kartverkets sjøkart-datakvalitetslag — brukes som gate
  for `trygt` i §3.4 steg 4. **Uverifisert:** om dette finnes som eget
  vektorlag/attributt (S-57 CATZOC-aktig kvalitetsklasse per objekt) eller
  kun som WMS-rasterbilde (`wms.sjokart_datakvalitet`) uten maskinlesbar
  vektorform — se §8. Hvis kun WMS finnes, må pipelinen enten rastervektorisere
  WMS-responsen (skjørt, unøyaktig) eller falle tilbake til en konservativ
  standardregel («kun `trygt` innenfor farled-polygon, ellers alltid
  `usikkert`») til et vektoralternativ er bekreftet.

### 3.6 Klient-API: `ChartSource`

```ts
export type TrustLevel = "trygt" | "usikkert" | "no-go";

export interface HazardReason {
  readonly kind:
    | "grunnere-enn-sikkerhetskontur"
    | "torrfall"
    | "skjaer-buffer"
    | "for-lav-luftspenn"
    | "vernesone-aktiv"
    | "lav-datakvalitet"
    | "utenfor-farled-lav-tetthet"
    | "utenlandsk-kilde-lav-tillit"
    | "ukjent-eller-uegnet-datum"
    | "gammel-pakke"
    | "usikker-sondering-i-baand"; // guardrail-tak, §3.4 "Guardrail for feilklassifiserte bånd"
  readonly detail: string;      // menneskelesbar forklaring til UI
  readonly sourceLayer: string; // hvilket lag/kilde årsaken kom fra
}

export interface TssAnnotation {
  readonly lane: string;         // TSS-/farled-ID
  readonly aksebæringGrader: number;
}

export type FarbarhetResultat =
  | {
      readonly dekning: "dekket";
      readonly nivaa: TrustLevel;
      readonly aarsaker: readonly HazardReason[];
      readonly tss?: TssAnnotation;
    }
  | { readonly dekning: "utenfor-pakke"; readonly grunn: string };

export interface ChartSource {
  /**
   * `kravTilDybdeM` og `kravTilLuftspennM` er FERDIG UTREGNEDE effektive
   * krav (dypgang + statisk margin + sjøgangstillegg + vannstandsavvik,
   * hhv. mastehøyde + margin) — ChartSource kjenner ikke vær, kun tall.
   * `dato` er eksplisitt input (aldri systemklokke) for determinisme.
   */
  farbar(
    punkt: LatLon,
    kravTilDybdeM: number,
    kravTilLuftspennM: number,
    dato: string,
  ): FarbarhetResultat;

  /** Strengeste nivå + union av alle unike årsaker langs segmentet. */
  segmentTest(
    fra: LatLon,
    til: LatLon,
    kravTilDybdeM: number,
    kravTilLuftspennM: number,
    dato: string,
  ): FarbarhetResultat;

  /** `null` = ingen registrert fare innenfor søkeradius. */
  nermesteFareAvstandNm(
    punkt: LatLon,
    kravTilDybdeM: number,
  ): { readonly avstandNm: number; readonly retningGrader: number } | null;
}
```

Invarianter (håndheves av enhetstester og bør legges til
`tools/arch-tests`, se §8):

- `packages/charts` importerer aldri `fetch`/`fs`/`node:`-moduler eller
  `packages/weather` — kun `@morild/geo` og `@morild/protocol`, samme
  grense som allerede håndheves for `packages/geo`/`packages/routing`.
- Samme input → samme output. Ingen systemklokke, ingen skjult tilstand.
- `farbar`/`segmentTest` gjør **ingen** I/O — flisdata er allerede lastet
  inn i minnet av kallerkoden (Web Worker) før `ChartSource` konstrueres.
- **`farbar` og `segmentTest` bruker samme geometri for samme lag** (funn 2,
  code-review runde 2 2026-08-31). For punktfarer (skjær/grunne) betyr det
  eksakt sirkel — avstand til `centerLat`/`centerLon` mot `bufferRadiusM` —
  i *begge*, ikke sirkel i den ene og den bufrede polygon-tilnærmingen i den
  andre. Konkret invariant: `segmentTest(p, p, …)` (degenerert korde) gir
  samme `nivaa` som `farbar(p, …)`. Polygon-fallbacken beholdes kun for
  fikstyrer/pakker uten senter-felt.

### 3.6.1 Konservativitets-garanti for `nermesteFareAvstandNm` (forutsetning for R3-gaten)

**Garanti (beslutning 2026-08-31, matematiker-forutsetning i
`docs/research/beslutningsgrunnlag-r3-e1-2026-08-31.md` R3):**
`nermesteFareAvstandNm` (og enhver klaringsavledning av den, f.eks. i
rutemotorens Lipschitz-gate `d(A) + d(B) ≥ 2·minOffing + L`) skal **ALDRI
overestimere** avstanden til nærmeste kartlagte fare. Underestimering er
tillatt og trygt (gaten blir strengere/mer konservativ, aldri farligere) —
overestimering er et kontraktsbrudd: en for stor rapportert avstand kan la
et faktisk usikkert kordepunkt passere gaten ukontrollert.

**Revisjon utført 2026-08-31 — to funn, ett rettet, ett dokumentert som
kjent, ufarlig begrensning:**

1. **RETTET: vertex-only nærmeste-punkt overestimerte for tørrfall/
   dybdebånd.** Den tidligere `nearestRingPoint` sammenlignet kun mot
   ringens HJØRNER, ikke kantens punkter generelt. Siden hjørner er en
   delmengde av kantens punkter, kan et vertex-only minimum rapportere en
   STØRRE avstand enn den faktiske korteste avstanden til kanten (f.eks. et
   punkt rett utenfor midten av en lang kant, langt fra begge hjørner) — en
   ren overestimering. Erstattet med `nearestPolygonPoint` (edge-basert,
   `packages/charts/src/point-in-polygon.ts`), som gjenbruker samme
   projeksjon/nærmeste-punkt-logikk som `distanceToSegmentNm`. For tørrfall
   og dybdebånd ER polygonet den sanne faregeometrien (ingen
   sirkel-tilnærming), så denne banen er nå **eksakt** — ingen gjenværende
   over- eller underestimering.
2. **DOKUMENTERT, IKKE FJERNET: punkt+radius-farer (skjær/grunne) via
   senterfelt er nå også eksakt; polygon-FALLBACKEN (uten senterfelt)
   overestimerer fortsatt, i MOTSATT retning av oppdragets opprinnelige
   hypotese.** Oppdraget spurte om polygon-fallbacken *underestimerer*
   avstand til en sirkelfare (siden den innskrevne polygon-tilnærmingen,
   §4.1, er MINDRE enn den sanne sirkelen). Retningen er sjekket formelt og
   er **motsatt**: for et punkt `Q` UTENFOR sirkelen (senter `O`, radius
   `r`) og et hvilket som helst punkt `X` på den innskrevne polygonens kant
   (som per konstruksjon ligger på eller innenfor sirkelen, `|OX| ≤ r`),
   gir trekantulikheten `|QX| ≥ |OQ| − |OX| ≥ |OQ| − r`. Minimum over alle
   slike `X` (avstand til polygonet) er derfor **alltid ≥** avstanden til
   den sanne sirkelen (`|OQ| − r`) — polygon-fallbacken OVERESTIMERER,
   aldri underestimerer, akkurat den retningen garantien forbyr.
   - **Fikset for den path-en som faktisk brukes i produksjon:** når
     `centerLat`/`centerLon` finnes (som de ALLTID gjør i pakker bygget av
     `tools/chart-pack`, se `BufferedHazardPoint`-kommentaren i
     `pack-format.ts`), brukes nå eksakt sirkelformel
     (`haversineNm(punkt, senter) − bufferRadiusM`, aldri under 0) i stedet
     for avstand-til-polygon. Denne banen er eksakt — garantien holder
     uforbeholdent for alle ekte pakker.
   - **Ikke fikset (bevisst, med begrunnelse):** polygon-fallbacken (kun
     nådd for eldre/håndbygde fikstyrer UTEN senterfelt — aldri fra ekte
     `tools/chart-pack`-pakker) har ingen senterpunkt å regne eksakt fra.
     En fiks ville krevd å GJETTE et senter (f.eks. polygon-centroid), noe
     som er skjørt for vilkårlig håndbygd testgeometri og ikke verdt
     kompleksiteten for en kodesti som aldri nås i produksjon. Risikoen er
     null i praksis (garantien håndheves der det faktisk betyr noe), men er
     eksplisitt dokumentert og regresjonstestet som en KJENT BEGRENSNING
     (`packages/charts/src/index.test.ts`, "KJENT BEGRENSNING: uten
     senterpunkt...") — ærlig degradering (N2), ikke en skjult antakelse.
3. **Uendret, allerede korrekt: dybdebånd-avstanden.** `distanceToPolygonNm`
   (nå konsolidert inn i `nearestPolygonPoint`) var allerede edge-basert og
   eksakt for dybdebånd — bandet ER den sanne faregeometrien, ingen
   sirkel-tilnærming er involvert.

## 4. Byggepipeline (`tools/chart-pack`)

**Frekvens — bevisst annerledes enn værpipelinen:** kystlinje og dybdedata
endres sakte (måneder til år, ikke timer). Anbefaling: `workflow_dispatch`
(manuell trigger) som hovedvei — kjøres når Magnus vet at kildedata er
oppdatert, et fasit-punkt er rettet, eller et nytt lag legges til — pluss en
lav-frekvent cron (f.eks. månedlig) som sikkerhetsnett mot ukjente
kildeoppdateringer, med samme healthcheck-mønster som værpipelinen (F2.4-
analogi). Dette er en bevisst avvik fra ADR-0003s cron-forventning for
værpipelinen; ADR-0003 navngir allerede `tools/chart-pack` som en fremtidig
beboer av samme GitHub Actions-infrastruktur, så selve *hjemmet* er
besluttet — kun *kadensen* avgjøres her.

Steg:

1. **Hent.** Last ned kildelagene via dokumenterte WFS/OGC API-endepunkter
   (se `docs/legal/*` for full liste med lisens/vilkår per kilde):
   - Kartverket Sjøkart–Dybdedata (dybdepunkt, dybdekurver, tørrfall,
     grunne, skjær) — WFS `https://wfs.geonorge.no/skwms1/wfs.dybdedata`
     eller OGC API Features `https://hybasapi.atgcp1-prod.kartverket.cloud/`.
   - Kartverket «Sjøkart – maritim infrastruktur» (luftspenn/bruer) —
     eksakt tjeneste-URL **uverifisert**, se §8.
   - Kystverkets WFS `https://services.kystverket.no/wfs.ashx` — lag
     `GJELDENDE-Hovedled og biled`, `GJELDENDE-Farledsareal`,
     `Toveisfarled`, `TSS områder`, `Anbefalte ruter 2021`,
     `Anbefalt rute punkt`.
   - Naturvårdsregistrets WFS
     `https://geodata.naturvardsregistret.se/naturvardsregistret/wfs?`
     (djur- och växtskyddsområden, Bohuslän-vernesoner med sesongdatoer).
   - Miljødirektoratets Naturbase (norske kystnære verneområder, f.eks.
     Ytre Hvaler) — eksakt WFS-tilgang **uverifisert**, se §8 (API krever
     trolig forhåndsavtale med Miljødataseksjonen).
   - Geodatastyrelsens DDM v2.0 GeoTIFF
     `https://dataforsyningen.dk/data/4817` (dansk dybdemodell, kun
     rasterkontekst — se §3.7).
   - EMODnet Bathymetry (fallback/kontekst utenfor norsk/dansk dekning).
2. **Reprojiser & normaliser.** UTM (EPSG:25832/33/35) → WGS84 (`proj4`);
   map hvert kildelags attributter til det interne skjemaet i §3.
3. **Valider geometri.** Sjekk selvskjæring/ugyldige polygoner (turf
   `kinks`/gyldighetssjekk) før boolsk algebra — vanligste årsak til at en
   byggejobb feiler er malformert kildegeometri, ikke logikkfeil. Ugyldige
   features logges og karanteneres (aldri stille droppet — bygge-rapporten
   er også underlagt N2).
4. **Bygg dybdebånd** (§3.4) — polygon-differanse av nøstede
   «grunnere enn»-polygoner, deretter subtraher tørrfall + buffrede
   skjær/grunner fra alle bånd og fra sjø/land-basisen. Buffer-radius for
   skjærpunkter (posisjonsusikkerhet) er **ikke fastsatt** — foreslå
   15–25 m som utgangspunkt, bekreftes av Magnus/seiler-erfaring (§8).
   Grunne-punktenes dybdeattributt bæres gjennom til pakkeformatet i stedet
   for å forkastes ved buffring — no-go-avgjørelsen for Grunne skjer ved
   oppslag, ikke her (VALSOU-modellen, §3.4).
4a. **QA-valider dybdebåndene mot kjente dybdepunkt-soundinger** (felle 2,
   beslutning 2026-08-31) — FØR skjær/grunne trekkes fra båndene, slik at
   validatoren tester selve kurve-/bånd-konstruksjonen, ikke sluttresultatet
   etter at hazard-geometri allerede har skåret hull rundt de samme
   punktene. Enhver sondering med kjent dybde som havner geometrisk innenfor
   et bånd, men er grunnere enn båndets nedre grense, er et brudd:
   flagges/telles i byggerapporten og gjør pakkens/lagets `sourceStatus`
   `"degraded"` med antall brudd — bygget **stopper ikke** (en enkelt
   avvikende sondering skal ikke blokkere en hel nattlig kjøring, samme
   filosofi som geometrivalideringen i steg 3), men bruddet er aldri stille
   sluket (N2). Ground-truth-kilde i fase 1-bølge 2: `Grunne`-punktene (som
   allerede har `app:dybde`) brukes som proxy siden et eget
   `Dybdepunkt`-lag (generelle enkeltsonderinger) ikke er ingestert ennå —
   dokumentert degradering, ikke skjult.
4b. **Bygg guardrail-artefaktene** fra 4a-bruddene (§3.4 «Guardrail for
   feilklassifiserte bånd», beslutning 2026-08-31, promotert fra ren
   QA-varsling): VALSOU-punktfarer (lagt til `bufferedHazards`, 25 m buffer,
   `dybdeM` = den faktisk sonderte dybden) + bånd-delpolygon-flagg (lagt til
   et nytt `soundingGuardrail`-lag) for hvert unike delpolygon minst én
   flagget sondering ligger i. Kjøres mot de RÅ (pre-hazard-subtraksjon)
   båndene fra 4a, av samme grunn som 4a selv (sonderingspunktet skjæres
   uansett ut som et hazard-hull senere). Implementert som
   `buildSoundingGuardrails` i `tools/chart-pack/src/pipeline.ts`.
5. **Overlegg** farled, datakvalitet, TSS, vernesone og luftspenn som egne
   attributt-bærende lag (ikke smeltet inn i dybdebåndene).
6. **Flis** alle lag til 0,5°×0,25°-rutenettet (§3.1), klipp polygoner ved
   flisgrense.
7. **Kvantiser & pakk** hver flis til JSON+gzip med lag-metadata.
8. **Skriv `ChartPackageHeader`** + flismanifest.
9. **Publiser til R2**, innholdsadressert (hash av pakkeinnhold som nøkkel)
   + oppdater `pointer/skandinavia.json` — samme mønster som værpakken og
   katalogpakkens `pointer/no.json` (ADR-0001).
10. **Bygg PMTiles for visning** — separat kjøring av `tippecanoe` over en
    (lossy, zoom-forenklet) GeoJSON-eksport av samme kildelag.
    **Arkitekturpoeng:** PMTiles-utgangen og routing-pakken er **to
    forskjellige artefakter** fra samme kilde, aldri samme fil — MVT-fliser
    forenkler geometri per zoom-nivå, noe som er greit for visning men ville
    vært en stille sikkerhetsfeil hvis routing-oppslaget leste fra dem
    (F1.1 krever eksakt polygonalgebra).
11. **Healthcheck-ping** med per-lag status (hvilke lag lyktes/falt tilbake
    til forrige kjørings kopi).

**Verktøyvalg og begrunnelse:**

| Formål | Verktøy | Begrunnelse |
|---|---|---|
| Boolsk polygonalgebra (union/differanse/buffer) | `@turf/turf` (JSTS-basert) | Ren TS/JS, ingen WASM-toolchain i `tools/`, passer monorepoet. Robusthet mot virkelig kartdatas topologi (selvskjæring, hull) er **ikke** verifisert ennå — foreslå en liten fase-1-spike (samme mønster som THREDDS-/ensemble-spikene) som prøvekjører turf mot en ekte Kartverket-eksport før hele pipelinen bygges. `geos-wasm` er reserve hvis turf viser seg for skjørt på reell geometri. |
| Reprojeksjon | `proj4` | Etablert, ren JS, tilstrekkelig nøyaktighet for denne bruken. |
| Vektorfliser/PMTiles | `tippecanoe` | Bransjestandard, native PMTiles-output (`-o out.pmtiles`). Native binær — må installeres i GitHub Actions-jobben (apt/prebuilt), dokumenteres i workflow-filen når den skrives. |
| Geometrivalidering | turf `kinks` + egen gyldighetssjekk | Fanger vanligste feilklasse (malformert kildeeksport) før algebra kjøres. |

### 4.1 Forbud mot geometrisk forenkling av sikkerhetspolygoner (E7, beslutning 2026-08-31)

**Vertex-forenkling (Douglas-Peucker og lignende algoritmer) av
sikkerhetspolygoner er eksplisitt forbudt** i `packages/charts` og
`packages/routing` — og skal ikke brukes i `tools/chart-pack` heller for
routing-artefaktet (steg 7 «Kvantiser & pakk»). Begrunnelse (marinkartolog-
vurderingen): forenkling flytter polygonkanter i en retning som ikke er
garantert konservativ — en forenklet skjær-/grunne-kontur kan bli MINDRE enn
originalen på steder der presisjon er sikkerhetskritisk, stikk i strid med
F1.1s krav om eksakt polygonalgebra. Dette er nøyaktig grunnen til at §4
steg 10 allerede skiller PMTiles-visningsartefaktet (lossy, zoom-forenklet)
fra routing-pakken (eksakt) — forbudet her gjør det skillet eksplisitt og
ufravikelig, ikke bare en arkitekturkommentar.

Flis-/størrelsesbudsjettet i §7 skal i stedet angripes med disse **trygge**
grepene, som ikke flytter noen sikkerhetsgrense:

- **Punkt+radius i stedet for ferdig-bufrede polygoner** for skjær/grunne —
  klienten gjør en enkel avstandssjekk (`point-in-polygon.ts` har allerede
  avstandsprimitiver). Dette er faktisk MER konservativt enn en bufret
  polygon fra turf (en sirkel omslutter alltid minst like mye areal som
  turfs innskrevne tilnærming). **Gjelder både `segmentTest` og `farbar`**
  (funn 2, code-review runde 2 2026-08-31): differansen mellom den
  innskrevne polygonkanten og den sanne sirkelbuen er et reelt areal — for
  et 100 m-buffer lagret som innskrevet firkant er sliveren opp mot 29 m
  bred — og et punkt der ga tidligere ikke `no-go` fra `farbar`, mens
  `segmentTest` (som allerede brukte sirkelen) sa `no-go`.
- **Heltalls-/deltakoding** av koordinater ved lagring.
- **Desimalreduksjon** til 5–6 desimaler (7 desimaler ≈ 1 cm er over-presist
  mot kildedatas ±5 m posisjonsusikkerhet) — allerede delvis gjort
  (`round7` i `tools/chart-pack/src/geometry.ts`; vurder å senke videre til
  5–6 i neste bølge).
- **Fjerning av kolineære punkter** — tre eller flere punkter på samme rette
  linje representeres like eksakt med to, ingen arealendring.
- **Sammenslåing av dype bånd** (f.eks. > 20–30 m) til ett — presisjonen der
  er uansett irrelevant for et fritidsfartøys klaringskrav, og dette endrer
  ikke grensene til NOE bånd som faktisk kan bli en sikkerhetskontur for
  Morilds dypgang.

Felles egenskap for alle fem: den geometriske grensen som avgjør `no-go`
flytter seg **aldri**, kun representasjonen av den. Dette skal håndheves
som en kodegranskings-regel (ingen `simplify()`/Douglas-Peucker-import i
`packages/charts`, `packages/routing` eller routing-artefakt-stien i
`tools/chart-pack`) inntil et eventuelt automatisk lint-/arch-test kan
verifisere det (se §8).

## 5. Degraderingsadferd (obligatorisk, N1/N2)

| Situasjon | Adferd |
|---|---|
| **Manglende flis** (ikke bygget ennå, eller ikke synket lokalt for offline-bruk) | `ChartSource` returnerer `{ dekning: "utenfor-pakke", grunn }`. Ruteren behandler dette **fail-closed**: segmentet er ikke ruterbart før flisen er synket — aldri stille tolket som `trygt`. UI skiller visuelt mellom «mangler kartdekning her» og et kartlagt `no-go`-hinder (samme farve/symbolikk for begge ville feilinformere i den andre retningen — se §8, åpent UI-spørsmål). Pakkens manifest (`tiles`-listen i headeren) skiller «finnes i siste pakke, men ikke lastet ned lokalt» fra «finnes ikke i pipelinen i det hele tatt» — sistnevnte er en byggefeil som healthchecken skal fange, ikke en normal offline-tilstand. |
| **Gammel pakke** | `producedAt` og per-lag `vintage` vises i UI med alder. Siden kystlinje endrer seg sakte, er ikke *alder* i seg selv farlig — men appen skal avvise en pakke med høyere `formatVersion.major` enn den er bygget mot (F2.3-mønsteret, gjenbrukt fra `packages/protocol`), og flagge i UI hvis siste vellykkede bygg er eldre enn en terskel (foreslå 12 måneder som «sjekk om kildene har oppdatert seg») uten å blokkere bruk. |
| **Kilde uten datum, eller datum ≠ K0** | Laget kan aldri gi `trygt` (§3.3, §3.7) — maks `usikkert`, uansett målt dybde. Årsak `"ukjent-eller-uegnet-datum"` alltid med i `aarsaker`. |
| **Område uten dybdedekning** (hull mellom sonderinger, eller utenfor et lags geografiske dekningsområde men innenfor flisens grense) | Aldri `trygt` per default (F1.3 «areal mellom sonderinger antas aldri trygt») — `usikkert` med årsak `"lav-datakvalitet"` eller `"utenfor-farled-lav-tetthet"`, med mindre punktet ligger i et bånd som også er `no-go` av andre grunner (tørrfall/skjær/grunnere enn kontur), som vinner. |

## 6. Testkrav

### 6.1 Enhetstester — polygonalgebra-primitiver

Syntetiske, håndlagde geometrier (ikke ekte kartdata) med kjent fasit,
samme filosofi som `packages/geo/src/geo.ts`s porterte, presist definerte
formler:

- Bånd-konstruksjon: to nøstede firkanter → korrekt ring-differanse.
- Tørrfall-subtraksjon fjerner riktig areal fra alle bånd og fra
  sjø/land-basisen.
- Skjær-buffer: punkt innenfor buffer-radius → `no-go`; rett utenfor →
  ikke påvirket av skjæret. **Inkludert sliver-testen** (funn 2): et punkt
  som ligger utenfor den innskrevne polygon-tilnærmingen, men innenfor den
  sanne sirkelen, skal gi `no-go` — og `farbar` og `segmentTest` skal være
  enige om det.
- **Geometriprimitivene testes direkte, ikke bare gjennom `segmentTest`**
  (funn 3, code-review runde 2 2026-08-31). `segmentsIntersect`,
  `segmentIntersectsPolygon`, `segmentEntirelyWithinAnyPolygon` og
  `distanceToSegmentNm` avgjør om et rutesegment er farbart; grensetilfellene
  deres skal pinnes eksplisitt, med den valgte konvensjonen skrevet ut:
  kollineær overlapp (delvis, inneslutning, felles endepunkt), endepunkt på
  motpartens indre (T-form), tangering av hjørne og av kant (begge teller som
  treff — føre-var), hull i polygon (kord inne i hullet er *ikke* treff; kord
  fra hullet og ut er det), og degenererte segmenter der `fra === til`
  (punkt-i-polygon-semantikk, og `distanceToSegmentNm` faller tilbake til
  punkt-til-punkt-avstand). Filen er
  `packages/charts/src/point-in-polygon.test.ts`.
- **Nøkkeltest for §3.4-designet:** en syntetisk 3 m-sondering uten
  omkringliggende dybdekurve mellom 2,6 m og 5 m skal gi `no-go` for et
  klaringskrav på 2,6 m — selv om 3 m > 2,6 m — fordi nærmeste kartlagte
  kurve ≥ 2,6 m er 5 m-kurven, og punktet ligger i båndet under den.
  Dette er den viktigste enkelttesten for at F1.1 faktisk er implementert
  som spesifisert, ikke som en naiv terskeltest på rådybde.
- TSS-krysningsvinkel: syntetisk lane-akse + testpunkt på begge sider →
  korrekt beregnet vinkel, ingen `no-go`/trust-endring fra TSS alene.
- Vernesone-dato: punkt innenfor sesong → `no-go`/`unngå`; samme punkt
  utenfor sesong → `trygt`/`usikkert` som om laget ikke fantes.
- **Guardrail for feilklassifiserte bånd (§3.4, beslutning 2026-08-31):**
  i `tools/chart-pack` — en syntetisk sondering grunnere enn båndets nedre
  grense (`validateSoundingsAgainstBands`-brudd) gir via
  `buildSoundingGuardrails` (a) en VALSOU-punktfare i `bufferedHazards` med
  `dybdeM` satt til sonderingens faktiske dybde og (b) nøyaktig det
  delpolygonet sonderingen geometrisk ligger i, flagget i
  `soundingGuardrail`; flere brudd i samme delpolygon dedupliserer til én
  sone med korrekt `violationCount`; `buildTilePayloads` klipper og bærer
  sonen gjennom til flisen. I `packages/charts` — samme delpolygon kan
  ALDRI gi `trygt` fra `farbar()`/`segmentTest()` selv når det ellers ville
  fått tillitsløft fra farled/god datakvalitet, med årsak
  `usikker-sondering-i-baand`; punktfaren følger uendret E4/VALSOU (no-go
  kun hvis kravet er strengere enn den sonderte dybden).
- **Konservativitets-garanti for `nermesteFareAvstandNm` (§3.6.1):**
  `nearestPolygonPoint` finner en kortere (korrekt) avstand til midten av en
  lang kant enn til nærmeste hjørne (regresjon mot den tidligere vertex-only
  overestimeringen); punkt+radius-farer med senterfelt gir eksakt
  sirkelavstand (`senter − radius`), ikke avstand til den innskrevne
  polygon-tilnærmingen; polygon-fallbacken UTEN senterfelt er dekket av en
  eksplisitt «KJENT BEGRENSNING»-test som dokumenterer at den fortsatt
  overestimerer (se §3.6.1 pkt. 2) — en regresjonsvakt, ikke en påstand om
  at fallbacken er trygg i produksjon.

### 6.2 Frossen ekte test-fikstur

Som F2.5s «frossen ekte MEPS-testpakke»: en liten, ekte utsnitt-pakke
(Oslofjorden + Ytre Hvaler + nordre Bohuslän) sjekkes inn i repoet som
testfixture for `packages/charts`, bygget én gang med `tools/chart-pack`
mot ekte kildedata. Golden-oppslagstestene i §6.3 kjører mot denne
fiksturen — ingen nettverksavhengighet i testkjøring.

### 6.3 Golden-oppslagstester — 50+ kuraterte fasit-punkter

**Kart-først-protokollen (E8, beslutning 2026-08-31, «lite»-variant).**
Et golden-punkt skrives inn i tabellen under FØR testkoden skrives eller
kjøres, i denne rekkefølgen: (1) Magnus velger et punkt i et offisielt
sjøkart (Kartverkets «Se sjøkart»/WMTS, eller papirkart) og leser av det
forventede svaret der — IKKE ved å kjøre koden mot fikstur-geometrien og se
hva den svarer; (2) koordinat + kartreferanse (kartblad/WMTS-utsnitt +
dato/versjon) og forventet nivå skrives i tabellen; (3) testen skrives og
kjøres, og skal reprodusere det allerede noterte forventede svaret. Dette
er den fulle rekkefølgen som gjør testen til en uavhengig sjekk av koden mot
virkeligheten — det motsatte av å plukke et punkt FRA geometrien som testes
(som kun beviser intern konsistens, se boksen under). Proveniens-apparatet
er bevisst forenklet i denne runden (Magnus, ikke et fullt CI-skjema): én
tabellrad per punkt er nok, ingen egen skjermbilde-/signaturprosess.

**De 11 eksisterende punktene i
`packages/charts/src/golden-oslofjord-hvaler.test.ts` (merket «MÅ
VERIFISERES AV MAGNUS», inkl. de som kun er merket «intern konsistens») er
IKKE bygget etter denne protokollen** — de ble plukket med
`turf.pointOnFeature`/`turf.centroid` FRA den samme fikstur-geometrien som
testes (se filens toppkommentar). De beviser at koden gjør det den sier den
gjør mot ekte innlest geometri, men ikke at akkurat DETTE punktet faktisk er
en skjærgård/led/grunne i virkeligheten — sirkulær verifisering. Alle 11 skal
**re-verifiseres av Magnus** mot et offisielt sjøkart etter protokollen over
før de kan regnes som testfasit i N5-forstand; til det er gjort forblir de
merket som de er (regresjonsvern for koden, ikke uavhengig sannhetssjekk).

Kandidatene under er **forslag til startpunkter, ikke fasit** — hvert
merket punkt må velges/verifiseres av Magnus mot et offisielt sjøkart (papir
eller Kartverkets «Se sjøkart»/WMTS) FØR testkjøring, etter protokollen
over, før det låses som testfasit. Koordinater er grove/omtrentlige der de
er oppgitt; tabellen bør utvides med en «Kartreferanse»-kolonne
(kartblad/WMTS-utsnitt + dato) idet hvert punkt faktisk verifiseres.

| Kategori | Kandidat | Ca. posisjon | Forventet | Status |
|---|---|---|---|---|
| No-go, skjær | Steilene (Nesodden, indre Oslofjord) | ~59,75° N 10,60° Ø | `no-go` for standard dypgang | **UBEKREFTET** |
| No-go, skjær | Torbjørnskjær/Heia (sør for Hvaler) | ~59,02° N 10,77° Ø | `no-go` | **UBEKREFTET** |
| No-go, grunne | Grunne nær Bastøy fergeled | ~59,42° N 10,53° Ø | `no-go` | **UBEKREFTET** |
| Åpen led | Drøbaksundet, østre løp (Kaholmen) | ~59,66° N 10,62° Ø | `trygt`/`usikkert`, ikke `no-go` | **UBEKREFTET** — kontrasteres mot vestre (grunne) løp som separat `no-go`-punkt |
| Åpen led | Færder fyr, innseiling | ~59,03° N 10,53° Ø | `trygt` | **UBEKREFTET** |
| Åpen led | Hovedled gjennom ytre Oslofjord (Kystverket-lag) | (velges fra Kystverkets `Hovedled og biled`-geometri) | `trygt` | **UBEKREFTET** |
| Luftspenn | Sotenkanalens bru (Hunnebostrand) | Bohuslän | `no-go` for mastehøyde ~19–20 m ved oppgitt klaring lukket | **UBEKREFTET**, avhenger av §8-datum-avklaring |
| Luftspenn (kontroll — skal IKKE stenge) | Svinesundsbroen (moderne høybro) | Riksgrense NO/SE | ikke `no-go` for samme mastehøyde | **UBEKREFTET** |
| TSS | Skagen TSS — krysningspunkt vinkelrett på lane | Skagens Rev | ingen trust-endring, `tssAnnotasjon` med akseretning | **UBEKREFTET geometri** |
| TSS | Skagen TSS — punkt langs lane-aksen | Skagens Rev | `tssAnnotasjon` tilstede (kostnad er rutemotorens ansvar, se §2) | **UBEKREFTET** |
| Vernesone | Sälskyddsområde, ytre Bohuslän-skjærgård | (velges fra Naturvårdsregistrets datasett) | `no-go`/`unngå` i hekke-/kastesesong, åpent utenfor | **UBEKREFTET**, eksakt sesongdato fra kilde |
| Vernesone | Fågelskyddsområde, samme region | (velges fra datasett) | som over | **UBEKREFTET** |
| Utenlandsk kilde — bør gi usikkert | Åpent vann i svensk sone, utenfor farled | Skagerrak, svensk side | `usikkert`, **aldri** `trygt` | **UBEKREFTET geometri**, prinsippet (aldri trygt) er derimot spec-fastsatt |
| Utenlandsk kilde — farled-bias | Punkt på godt merket hovedled i Bohuslän-skjærgården | (Kystverket-ekvivalent på svensk side, om finnes, ellers Naturvårdsregistret/OSM-farled) | `usikkert` men lavere friksjon enn omkringliggende areal | **UBEKREFTET** |
| Dansk DDM | Punkt i danske farvann dekket kun av DDM | Kattegat/Bælt | `usikkert`, aldri `trygt` (middelverdi-datum) | **UBEKREFTET geometri**, prinsipp spec-fastsatt |
| Algoritmisk (syntetisk, ikke geografisk) | 3 m-sondering uten nabokurve 2,6–5 m | n/a | `no-go` ved 2,6 m krav (§6.1) | **Fasit ved konstruksjon — ingen geografisk verifisering nødvendig** |

Dette gir 15 geografiske kandidater + 1 algoritmisk = 16 startpunkter.
**Gjenstående 34+ for å nå N5s 50+ identifiseres av Magnus/kartdata-agenten
under fase 1-bygging** ved manuell gjennomgang av faktisk sjøkart — denne
spec-en foreslår kategoribredden (no-go/åpen led/luftspenn/TSS/vernesone/
utenlandsk), ikke den fulle listen.

### 6.3.1 Kjent-svakhet-golden: åpne-kurver-hullet (felle 1, N2, beslutning 2026-08-31)

§4 steg 3/4 dropper i dag alle ÅPNE dybdekurve-ringer (de som krysser
kartbladgrensen, se `tools/chart-pack/README.md` «Avvik fra spec» #1) — i
fase 1-bølge 2-fixturen 66 % av dybdekurvene. Dette er en fail-safe for
`trygt`-retningen (en droppet kurve gjør ALDRI et areal falskt trygt via
bånd-logikken alene), men er et reelt sikkerhetshull i `no-go`-retningen: en
faktisk kartlagt grunne hvis avgrensende kurve krysser kartbladgrensen
havner utenfor alle bånd og faller til føre-var-standardregelen
(`usikkert`), ikke `no-go` — selv om Kartverkets egen dybdekurve på det
stedet dokumenterer en reell grunne. Ruteren behandler `usikkert` som
seilbart-med-flagg, ikke som blokkert — dette er tap av kartlagt
fareinformasjon i verste retning (marinkartolog-vurderingens felle 1).

**Krav:** testsvitten for `packages/charts` skal inneholde **minst ett
eksplisitt dokumentert kjent-svakhet-testpunkt** for dette hullet — et punkt
der (a) en droppet åpen dybdekurve fra kildedataene dokumenterer en reell,
navngitt grunne/dybde, og (b) dagens maske svarer `usikkert` i stedet for
`no-go`. Testen skal:

- Referere den konkrete kildefeaturen (f.eks. `dybdekurve.<id>` og dens
  `app:dybde`-attributt) som bevis for at dette er en ekte, autoritativ
  dybdeopplysning, ikke en syntetisk konstruksjon.
- Assertere dagens (uønskede) `usikkert`-oppførsel eksplisitt, med en
  kommentar som gjør det klart at dette er en KJENT SVAKHET, ikke korrekt
  atferd — testen er en regresjonsvakt mot at hullet blir usynlig, ikke en
  påstand om at oppførselen er riktig.
- Lenke til `tools/chart-pack/README.md` «Avvik fra spec» #1 og til denne
  seksjonen, slik at testen oppdateres (endres til å forvente `no-go`) den
  dagen kurve-stitching på tvers av kartblad er implementert. **Timing
  justert 2026-08-31** (se `docs/research/beslutningsgrunnlag-r3-e1-2026-08-31.md`
  «QA-funnet» pkt. 3): stitching rykker frem fra «fase 5/ved skala» til «FØR
  første reelle rute utenfor farled brukes reelt» — en 1-av-8 feilrate i
  bånd-tilordning (12,9 %-funnet) er for høy til å hvile permanent på
  sonderingsnettet, selv med guardrailen (§3.4) som midlertidig sikkerhetsnett.
- IKKE slettes eller løsnes uten at det underliggende hullet faktisk er
  lukket — testen finnes eksplisitt for at regresjon i denne retningen aldri
  skjer stille.

### 6.3.2 Guardrail-fasit mot et faktisk berørt fixture-punkt (beslutning 2026-08-31)

I tillegg til de kart-først-protokollerte punktene i §6.3 (som verifiserer
maskens tolkning mot et OFFISIELT sjøkart) og kjent-svakhet-punktet i §6.3.1
(dokumenterer et hull), skal testsvitten inneholde minst én fasit-test som
verifiserer guardrailen (§3.4) mot et FAKTISK QA-brudd-punkt fra den frosne
fixturen selv — ikke en syntetisk konstruksjon, og heller ikke et punkt som
krever uavhengig sjøkart-verifisering (guardrailen validerer intern
konsistens mellom sondering og bånd, ikke en påstand om hva som er sant i
virkeligheten). Testen skal:

- Navngi den konkrete kildefeaturen (f.eks. `grunne.7257`, sondert 39 m,
  liggende i det geometrisk overlappende 40–50 m-bandet).
- Assertere at standard klaringskrav ALDRI gir `trygt` på dette punktet
  (uansett tillitsløft), med årsak `usikker-sondering-i-baand`.
- Assertere VALSOU-punktfarens virkemåte uendret: `no-go` når kravet er
  strengere enn den sonderte dybden, ingen blokkering fra punktet alene
  ellers.
- Rapportere fixturens faktiske guardrail-omfang (antall flaggede
  delpolygoner/punktfarer) som en eksplisitt regresjonsvakt — et tall som
  ENDRER seg når kildedata oppdateres eller stitching lukker hullet, og som
  skal synes i testfeil, ikke bare i byggeloggen.

Filen er `packages/charts/src/guardrail-golden.test.ts`. Fase 1-bølge
2-fixturen: 503 VALSOU-punktfarer og 273 unike bånd-delpolygoner flagget.

### 6.4 Ytelseskrav

`farbar()`/`segmentTest()` kalles i indre løkke av isokron-/A*-søket
(F3.5: 150–210 kjøringer × mange celleutvidelser per kveldsplanlegging).
Foreslåtte mål, **ikke verifiserte** — bekreftes empirisk ved fase 1-exit,
samme evidensbaserte mønster som ensemble-ytelses-spiken:

- **Grovt rutenett for A*-pruning** (B7: 500 m–1 km, dekoblet fra maskens
  oppløsning): forhåndsbakt `Uint8Array` per flis ved standard
  klaringskrav (uten dynamiske tillegg) → mål **≤ 1 µs** per oppslag (ren
  array-indeksering). Dette er en *optimistisk* pruning-heuristikk — den
  bruker aldri de dynamiske tilleggene, og skal derfor aldri være
  strengere enn den eksakte sjekken, kun eventuelt mer tillatende (trygt,
  siden segmentvis ettersjekk er autoritativ — se §2).
- **Eksakt polygon-/segmenttest** med fullt dynamisk klaringskrav: mål
  **≤ 100 µs** typisk per kall (flisbasert forhåndsfiltrering + punkt-i-
  polygon mot et beskjedent lokalt sett med features). Kalles sjeldnere
  enn grovsjekken — én gang per akseptert segment, ikke per
  celleutvidelse.

## 7. Størrelsesbudsjett

Kartpakken har en annen budsjettfilosofi enn værpakken (F2.2s ≤ 30 MB *per
kjøring*): kystlinje endres sakte, så en **stor men sjelden hentet** lokal
kartcache er akseptabel, mens værpakkens gjentatte per-kjøring-nedlasting
ikke tåler samme størrelse. Foreslåtte, **ikke verifiserte** tall:

- Per flis (komprimert, JSON+gzip): mål **≤ 500 KB**, typisk 50–200 KB for
  kystnære fliser med moderat skjærgårdskompleksitet.
- Full Skandinavia-kystdekning (~150–250 relevante fliser — åpent hav uten
  skjærgård trenger ikke egne detaljerte fliser): grovt **75–125 MB** som
  et absolutt engangs-tak, lastet ned én gang, ikke per øktstart.
- Typisk offline-synk for én tur (F1.9, «valgte kartområder» — noen titalls
  fliser langs en planlagt rute): **lav tosifret MB**, godt innenfor
  mobildata-komfort.
- Minneavtrykk i klienten: dekodede fliser holdt i minnet under en økt er
  et lite tillegg til værensemblets minnebudsjett (N6: < 500 MB heap) —
  ingen egen grense foreslått her, men bør måles sammen med
  ensemble-minnemodellen i fase 1/2, ikke isolert.

## 8. Åpne spørsmål til Magnus

**Sjøgang (jf. `docs/specs/rutemotor.md` §9 spm. 10) — BESLUTTET 2026-08-30
(Magnus):** klaringstallet som sendes inn ved oppslag (`kravTilDybdeM` i
§3.6s `ChartSource`-kontrakt) skal inkludere Hs-tillegget f(Hs); der
bølgedata finnes, gir det **hard avvisning** (`no-go`) på samme måte som
resten av klaringskravet, ikke bare et flagg. Der bølgedata mangler,
flagges segmentet i stedet (§5-mønsteret for degradering).

1. **Luftspenn-datum (høy prioritet, sikkerhetskritisk):** hvilken
   vannstandsreferanse bruker Kartverkets «Sjøkart – maritim
   infrastruktur»-datasett for oppgitt fri høyde under bruer/luftspenn?
   Feil antakelse her er en direkte mastehøyde-sikkerhetsfeil, ikke bare en
   unøyaktighet. **Uavklart 2026-08-30 — konservativ regel inntil
   verifisert:** et luftspenn med uverifisert datum gir maks `usikkert`,
   aldri `trygt`; verifiseres mot Kartverket før regelen kan lempes.
2. **Datakvalitetslaget:** finnes Kartverkets sjøkart-datakvalitet som
   maskinlesbart vektorlag/attributt, eller kun som WMS-rasterbilde? Dette
   avgjør om §3.4 steg 4s `trygt`-gate er byggbar som spesifisert eller må
   falle tilbake til en mer konservativ regel (kun `trygt` innenfor
   farled-polygon).
3. **Skjær-/grunne-buffer-radius:** 15–25 m foreslått i §4 steg 4 — hvilket
   tall gjenspeiler faktisk posisjonsusikkerhet i Kartverkets
   50 m-graderte punkttetthet, og bør det variere med sondering-alder?
   **BESLUTTET 2026-08-30 (Magnus), foreløpig:** standard **20 m**,
   konfigurerbar — markert «foreløpig, Magnus kan justere», ikke eksplisitt
   låst.
4. **Miljødirektoratets Naturbase-API:** krever trolig forhåndsavtale
   («all bruk av API-et skal avtales med Miljødataseksjonen på forhånd») —
   skal dette avklares nå (fase 0/1) eller skal norske kystverneområder
   utsettes til svenske Bohuslän-soner er på plass? **BESLUTTET 2026-08-30
   (Magnus):** utsettes; v2.0 bruker statiske uttrekk.
5. **UI-skille mellom «mangler kartdekning» og «kartlagt no-go»:** §5
   krever at disse ikke vises likt, men denne spec-en definerer ikke
   symbolikken — hører det til `specs/kartvisning.md` (ikke skrevet ennå),
   eller skal et minimumskrav (f.eks. skravur vs. fylt rødt) fastsettes her?
6. **Gammel-pakke-terskelen** (12 måneder foreslått i §5) — fornuftig, eller
   bør den kobles til en kjent Kartverket-revisjonssyklus/Efs-frekvens i
   stedet for et fast tall? **BESLUTTET 2026-08-30 (Magnus):** ja
   (12 måneder).
7. **`tools/arch-tests`-utvidelse:** bør `packages/charts` legges til
   `ALLOWED_PACKAGE_IMPORTS`-grensesnittet i
   `tools/arch-tests/import-boundaries.ts` på samme måte som
   `packages/geo`/`packages/routing` nå (ren, ingen I/O, ingen
   `packages/weather`-import)? Dette er en implementasjonsdetalj, men
   bør besluttes før `packages/charts` får ekte kode. **BESLUTTET
   2026-08-30 (Magnus):** ja — implementeres i fase 1-bygget.
8. **Turf vs. geos-wasm:** er en dedikert liten fase 1-spike (prøvekjør
   turf mot en ekte Kartverket-eksport, se om boolsk algebra holder) verdt
   en dags arbeid før hele pipelinen legges opp rundt turf, slik
   THREDDS-/ensemble-spikene ble gjort for værsiden? **BESLUTTET 2026-08-30
   (Magnus):** ja, én dags spike først i chart-pack-bygget.
9. **Svensk hovedled-ekvivalent:** finnes det et åpent, maskinlesbart
   farled-datasett for svensk skjærgård (tilsvarende Kystverkets
   `Hovedled og biled`) som kan gi farled-bias i Bohuslän, eller må det
   leses ut av OpenSeaMap-tagging (lavere kvalitet, jf. research §3)?
   **BESLUTTET 2026-08-30 (Magnus):** undersøkes i fase 1-implementasjonen.
10. **CATZOC-kalibrering (f i §3.4.1):** kontrakten
    (`effectiveDepthRequirement`) er frosset og implementert 2026-08-31 (B4)
    med `f = 0` for alle kategorier. Selve kalibreringen (kartologens
    foreslåtte a + b·d-tabell) og den separate CATZOC-avhengige
    skjærbuffer-radiusen er **fortsatt åpne** — tas i en senere bølge når
    reelt kalibreringsgrunnlag (sondering vs. faktisk grunnstøtingshistorikk
    e.l.) finnes. **BESLUTTET 2026-08-31 (Magnus, B4):** forbered kontrakten
    nå, kalibrer senere.

## 9. Endringslogg

- **2026-08-31 (kartdata-agent, B4 CATZOC-semantikkforberedelse — se
  `docs/research/steg3-plan-2026-08-31.md` og
  `docs/research/ekspertpanel-2026-08-31.md` §4, Magnus' beslutning samme
  dag):**
  - **Nytt §3.4.1** fryser kontrakten for et fremtidig CATZOC-avhengig
    dybdekrav: effektivt dybdekrav ved oppslag =
    `basiskrav + f(CATZOC-sone)`, med `f = 0` for ALLE kategorier inntil
    kalibrering. Kartologens foreslåtte fremtidige kalibreringstabell
    (A1: 0,5 m + 1 % d; A2/B: 1,0 m + 2 % d; C/D/U: uendret binær gate) er
    dokumentert som grunnlag, ikke implementert. CATZOC B/Cs rolle i
    skjærbuffer-radiusen (±50 m posisjonsusikkerhet for CATZOC B, mer enn
    dagens faste 20 m-buffer) er eksplisitt notert som en SEPARAT,
    fortsatt-åpen forberedelse (§8 pkt. 10) — ikke dekket av denne
    funksjonen.
  - **Implementert** som `effectiveDepthRequirement(basiskrav, catzocSone)` i
    nytt `packages/charts/src/catzoc.ts`. Alle tre oppslagsveier som
    sammenligner et klaringskrav mot kartlagt dybde
    (`evaluatePoint`/`evaluateChordAgainstTile`s dybdebånd-sikkerhetskontur
    og VALSOU-klaringssjekk, samt `nermesteFareAvstandNm`s
    klaring-avledning) i `packages/charts/src/chart-source.ts` går nå via
    denne funksjonen i stedet for å bruke `kravTilDybdeM` rått. Den binære
    CATZOC-gaten (C/D/U kan aldri gi `trygt`) er UENDRET.
  - **Regresjon:** ny `packages/charts/src/catzoc.test.ts` pinner at
    `f = 0` for alle seks CATZOC-klasser og for `undefined` (ingen
    klassifisert sone). Alle eksisterende tester i
    `golden-oslofjord-hvaler.test.ts`, `guardrail-golden.test.ts` og
    `index.test.ts` består uendret (377 tester grønt totalt i
    `pnpm test` etter endringen) — den egentlige regresjonsvakten for at
    hooken ikke endrer dagens adferd.
- **2026-08-31 (kartdata-agent, QA-guardrail-promotering + konservativitets-
  revisjon — se `docs/research/beslutningsgrunnlag-r3-e1-2026-08-31.md`
  «QA-funnet», Magnus' beslutning samme dag):**
  - **Guardrail for feilklassifiserte bånd** (nytt avsnitt i §3.4, §4 steg
    4b, §6.1, §6.3.2): byggetids-QA-validatoren (§4 steg 4a) er promotert
    fra ren varsling til en guardrail som endrer pakken. Hver flagget
    sondering blir (a) en VALSOU-punktfare (`bufferedHazards`, 25 m buffer
    — begrunnet som halve sonderingsnettets 50 m-gradering, §3.4) med
    `dybdeM` = den faktisk sonderte dybden, og (b) et flagg på det
    spesifikke bånd-delpolygonet den ligger i (nytt `soundingGuardrail`-lag,
    `SoundingGuardrailZone` i `pack-format.ts`) som gjør at delpolygonet
    ALDRI kan gi `trygt` — maks `usikkert`, årsak `usikker-sondering-i-baand`
    (ny `HazardReason.kind`). Implementert som `buildSoundingGuardrails` i
    `tools/chart-pack/src/pipeline.ts`, kalt fra `build.ts`, lest av
    `evaluatePoint`/`evaluateChordAgainstTile` i
    `packages/charts/src/chart-source.ts`. **Målt i fase 1-bølge
    2-fixturen: 503 VALSOU-punktfarer og 273 unike bånd-delpolygoner
    flagget** fra de 503 QA-bruddene (12,9 % av 3913 sjekkede Grunne-
    soundinger). Ny fasit-test mot et faktisk berørt punkt
    (`grunne.7257`, sondert 39 m i 40–50 m-bandet) i
    `packages/charts/src/guardrail-golden.test.ts` (§6.3.2) og
    guardrail-enhetstester i `tools/chart-pack/src/pipeline.test.ts` (§6.1).
    Fixturen regenerert (`packages/charts/testdata/oslofjord-hvaler.json.gz`);
    alle 12 eksisterende tester i `golden-oslofjord-hvaler.test.ts` (inkl. de
    4 som forventer `trygt`) består uendret — ingen av dem treffer et av de
    273 flaggede delpolygonene (bekreftet ved at testsvitten fortsatt er
    grønn: en `trygt`-forventende test ville feilet umiddelbart hvis den
    hadde truffet en guardrail-sone).
  - **Stitching-timing justert** (§6.3.1): fra «fase 5/ved skala» til «FØR
    første reelle rute utenfor farled brukes reelt» — guardrailen er et
    sikkerhetsnett, ikke en erstatning for å lukke selve åpne-kurver-hullet.
  - **Konservativitets-garanti for `nermesteFareAvstandNm` spec-festet og
    revidert** (nytt §3.6.1, forutsetning for R3-gaten i rutemotoren): denne
    funksjonen skal ALDRI overestimere avstand til fare. Revisjon fant og
    rettet én reell overestimering (vertex-only nærmeste-punkt for
    tørrfall/punktfare-polygon, erstattet av edge-basert
    `nearestPolygonPoint`) og dokumenterte én gjenværende, men ufarlig,
    begrensning: punkt+radius-farer får nå eksakt sirkelavstand når
    senterfelt finnes (alle ekte pakker), mens den gamle polygon-FALLBACKEN
    (kun eldre/håndbygde fikstyrer uten senterfelt) fortsatt overestimerer —
    **motsatt retning av oppdragets opprinnelige hypotese** (som antok
    underestimering); bevist formelt med trekantulikheten i §3.6.1 og
    dekket av en eksplisitt «KJENT BEGRENSNING»-regresjonstest i
    `packages/charts/src/index.test.ts`.
- **2026-08-31 (code-review runde 2, funn 2 og 3):**
  - **Funn 2 (viktig): `evaluatePoint` testet punktfarer mot polygonet, ikke
    mot sirkelen.** R1-fiksen ga `segmentTest()` eksakt sirkelgeometri
    (`centerLat`/`centerLon` + `bufferRadiusM`), men `farbar()` fortsatte å
    bruke `pointInPolygon` mot den ferdig-bufrede polygon-tilnærmingen. Den
    tilnærmingen er **innskrevet** (§4.1) og under-dekker derfor den sanne
    sirkelen mellom hjørnene: i sliveren mellom kord og bue lå punktet
    innenfor `bufferRadiusM`, men utenfor polygonet — og punkttesten slapp
    det gjennom mens segmenttesten ville stoppet det. To tester på samme
    fare kunne altså gi motsatt svar, og den mildeste av dem var den
    punktvise. Fikset med felles hjelper `pointWithinHazardBuffer` i
    `packages/charts/src/chart-source.ts`: eksakt punkt-i-sirkel når
    senter-feltene finnes, polygon-fallback ellers (kun for eldre/håndbygde
    fikstyrer, se `BufferedHazardPoint`). Ny invariant i §3.6; §4.1 og §6.1
    oppdatert. **+5 tester** i `index.test.ts`, inkludert sliver-testen
    (100 m buffer lagret som innskrevet firkant, punkt 85 m fra senter i
    kant-midtretningen: utenfor polygonet, innenfor sirkelen → `no-go`) og
    en test på at `farbar` og `segmentTest` nå er enige.
  - **Funn 3 (mindre): geometriprimitivene manglet direkte enhetstester.**
    `segmentsIntersect`, `segmentIntersectsPolygon`,
    `segmentEntirelyWithinAnyPolygon` og `distanceToSegmentNm` var kun
    dekket indirekte via `segmentTest()`. Ny fil
    `packages/charts/src/point-in-polygon.test.ts` (**+43 tester**) pinner
    grensetilfellene: kollineær overlapp, endepunkt-på-kant/T-form,
    tangering av hjørne og kant, hull i polygon, tomme polygonlister og
    degenererte (punkt-)segmenter. Konvensjonene som testene låser er
    dokumentert i §6.1 — spesielt at berøring teller som treff (føre-var)
    og at `segmentEntirelyWithinAnyPolygon` heller gir falskt «ikke
    innenfor» enn falskt «innenfor».
- **2026-08-31 (Magnus, etter ekspertpanel-vurdering — se
  `docs/research/ekspertpanel-2026-08-31.md` §4 og
  `docs/research/ekspertpanel-runde2-2026-08-31.md` §5–§7):**
  - **E4 VALSOU-modellen for `Grunne`** innført i §3.4: no-go kun ved
    dybde `< kravTilDybdeM` eller manglende dybdeattributt, ellers ingen
    blokkering. Erstatter den tidligere «alltid no-go»-regelen for buffrede
    Grunne-punkter (Skjær er uendret: alltid no-go, har aldri
    dybdeattributt i kildedataene). Implementert i
    `packages/charts/src/chart-source.ts` (`evaluatePoint` steg 2) og
    `tools/chart-pack/src/pipeline.ts` (`buildBufferedHazards` bærer nå
    `dybdeM` gjennom for Grunne).
  - **E7 forbud mot geometrisk forenkling** av sikkerhetspolygoner
    (Douglas-Peucker/vertex-forenkling) i `packages/charts`,
    `packages/routing` og routing-artefaktet i `tools/chart-pack` — nytt
    §4.1, med liste over hvilke fem grep som ER trygge (punkt+radius,
    heltalls-/deltakoding, desimalreduksjon, kolineær-fjerning,
    bånd-sammenslåing).
  - **E8-lite kart-først-protokoll** for golden-fasitpunkter innført i
    §6.3: punkt velges i offisielt sjøkart med forventet svar notert FØR
    testkjøring, koordinat + kartreferanse i tabell. De 11 eksisterende
    punktene i `golden-oslofjord-hvaler.test.ts` (plukket fra samme
    geometri som testes) er eksplisitt markert som IKKE bygget etter denne
    protokollen og må re-verifiseres av Magnus.
  - **QA-validator for dybdebånd** (felle 2) lagt til §3.4/§4 steg 4a:
    byggetids-sjekk av at ingen dybdepunkt-sondering innenfor et bånd er
    grunnere enn båndets nedre grense; brudd flagges i byggerapport og
    `sourceStatus`, stopper ikke bygget. Implementert som
    `validateSoundingsAgainstBands` i `tools/chart-pack/src/pipeline.ts`,
    kjørt mot `Grunne`-punktene som ground-truth-proxy (intet eget
    `Dybdepunkt`-lag ingestert ennå).
  - **Kjent-svakhet-golden for åpne-kurver-hullet** (felle 1, N2) krevd i
    ny §6.3.1: minst ett dokumentert testpunkt der en droppet åpen
    dybdekurve dokumenterer en reell grunne, men masken i dag svarer
    `usikkert` i stedet for `no-go` — regresjonsvakt til stitching lukker
    hullet (§4 «Neste bølge», ikke denne bølgen).
- **2026-08-31 (kartdata-agent, code-review-fiks R1/R2):**
  - **R1 (kritisk): `segmentTest()` var 20-punkts sampling, ikke eksakt
    geometritest** — i strid med §2/§6.4s krav om at den segmentvise
    ettersjekken er autoritativ. En smal fare plassert mellom to
    prøvepunkter kunne passere uoppdaget. Fikset i
    `packages/charts/src/chart-source.ts`: `segmentTest()` finner nå ALLE
    fliser korden faktisk krysser (`tilesAlongSegment`, rutenett-
    grensekrysning langs korden — ikke en bounding box-overapproksimasjon)
    og tester korden mot den faktiske ring-/polygongeometrien i hver
    (`evaluateChordAgainstTile`, ny segment-mot-polygon-skjæringsprimitiv i
    `point-in-polygon.ts`: `segmentIntersectsPolygon`/-`AnyPolygon`/
    `segmentEntirelyWithinAnyPolygon`). Punktfarer (skjær/grunne) testes med
    eksakt avstand-fra-kord-til-senterpunkt mot `bufferRadiusM` (§4.1) —
    mer presist og mer konservativt enn å teste mot den ferdig-bufrede
    polygon-tilnærmingen. Dette krevde et nytt, valgfritt
    `centerLon`/`centerLat`-felt på `BufferedHazardPoint` (pack-format),
    satt av `tools/chart-pack/src/pipeline.ts` sin `buildBufferedHazards`
    fra kildepunktet FØR buffring (bevart uendret gjennom flisklipping, i
    motsetning til selve `polygon`-feltet). VALSOU-regelen (E4) gjelder
    identisk i den nye segment-testen. Målt ytelse: ~15–17 µs/kall på
    utviklingsmaskin (§6.4-mål: ≤100 µs) — ikke-verifisert budsjett, men
    god margin. Regresjonstest lagt til i
    `packages/charts/src/index.test.ts` (`segmentTest — strengeste nivå +
    union av årsaker`).
  - **R2 (viktig): flisoppdeling i byggetid (`touchedTiles`,
    `tools/chart-pack/src/pipeline.ts`) fant fliser kun via
    polygon-ring-HJØRNER** — en polygon som dekker en mellomflis uten selv å
    ha et hjørne der (f.eks. en smal, langstrakt polygon over tre fliser på
    rad) falt stille ut av den mellomste flisen. Fikset til bbox-basert
    flisoppdagelse (polygonets bounding box mot flis-rutenettets indekser,
    bevisst over-approksimasjon — etterfølgende `clipPolygonToTile` fjerner
    det som ikke faktisk overlapper); fliser der ALLE lag ble tomme etter
    klipping filtreres bort igjen, slik at «tom flis utelates fra
    manifestet»-kontrakten i §4 steg 6 fortsatt holder. Regresjonstest i
    `tools/chart-pack/src/pipeline.test.ts`. Testfiksturene
    (`tools/chart-pack/testdata/pack/` og `packages/charts/testdata/`) er
    regenerert med begge fiksene; flis-/geometriinnholdet for
    Oslofjorden/Hvaler-testområdet var UENDRET av R2 (verifisert ved
    A/B-sammenligning av bygget med gammel vs. ny `touchedTiles` — ingen
    farled-/hazard-/bånd-polygon i dette konkrete rådatasettet traff
    hjørne-bugen), men fikk `centerLon`/`centerLat` lagt til på alle 4494
    buffrede punktfarer fra R1.
