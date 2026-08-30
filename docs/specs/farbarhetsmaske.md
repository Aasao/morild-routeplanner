# Spec: Farbarhetsmaske

- Status: utkast — venter på Magnus' gjennomgang før `tools/chart-pack` bygges
- Dato: 2026-08-30
- Grunnlag: `docs/00-kravspek.md` F1.0–F1.9, N1/N2/N3/N5/N6 · `docs/research/kartdata-skandinavia.md`
  · `docs/research/review-seiler.md` · `docs/research/review-arkitekt.md` (M3, M4, B7)
  · `docs/decisions/ADR-0001…0003` · `packages/protocol/src/package-header.ts`

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
fra sjø/land-basispolygonet trekkes tørrfall og buffrede skjær/grunner —
disse er alltid `no-go` uavhengig av dypgangskrav, siden de er presise
punkt-/arealfarer, ikke dybdekurve-baserte.

Ved oppslag med et gitt klaringskrav `k` (i meter):

1. Finn hvilket bånd punktet ligger i (eller tørrfall/skjær/utenfor-pakke).
2. Er punktet i tørrfall/skjær → `no-go`.
3. Er båndets nedre grense < nødvendig sikkerhetskontur (nærmeste kartlagte
   kurve ≥ `k`, jf. F1.1s ordlyd — eksempelet i kravspeken er 2,6 m → 5 m-
   kurven) → `no-go`.
4. Ellers: `trygt` hvis punktet er innenfor et farled-polygon **eller** i en
   sone med god datakvalitet (§3.7); ellers `usikkert` (føre-var-regelen,
   F1.3 — «areal mellom sonderinger antas aldri trygt»).

Dette er den viktigste designbeslutningen i denne spec-en og bør
kvalitetssikres av kartdata-agenten mot faktiske Kartverket-eksporter før
fase 1-bygging starter (se §8).

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
    | "gammel-pakke";
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
  ikke påvirket av skjæret.
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

### 6.2 Frossen ekte test-fikstur

Som F2.5s «frossen ekte MEPS-testpakke»: en liten, ekte utsnitt-pakke
(Oslofjorden + Ytre Hvaler + nordre Bohuslän) sjekkes inn i repoet som
testfixture for `packages/charts`, bygget én gang med `tools/chart-pack`
mot ekte kildedata. Golden-oppslagstestene i §6.3 kjører mot denne
fiksturen — ingen nettverksavhengighet i testkjøring.

### 6.3 Golden-oppslagstester — 50+ kuraterte fasit-punkter

Kandidatene under er **forslag til startpunkter, ikke fasit** — hvert
merket punkt må verifiseres av Magnus mot et offisielt sjøkart (papir eller
Kartverkets «Se sjøkart»/WMTS) før det låses som testfasit. Koordinater er
grove/omtrentlige der de er oppgitt.

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

1. **Luftspenn-datum (høy prioritet, sikkerhetskritisk):** hvilken
   vannstandsreferanse bruker Kartverkets «Sjøkart – maritim
   infrastruktur»-datasett for oppgitt fri høyde under bruer/luftspenn?
   Feil antakelse her er en direkte mastehøyde-sikkerhetsfeil, ikke bare en
   unøyaktighet.
2. **Datakvalitetslaget:** finnes Kartverkets sjøkart-datakvalitet som
   maskinlesbart vektorlag/attributt, eller kun som WMS-rasterbilde? Dette
   avgjør om §3.4 steg 4s `trygt`-gate er byggbar som spesifisert eller må
   falle tilbake til en mer konservativ regel (kun `trygt` innenfor
   farled-polygon).
3. **Skjær-/grunne-buffer-radius:** 15–25 m foreslått i §4 steg 4 — hvilket
   tall gjenspeiler faktisk posisjonsusikkerhet i Kartverkets
   50 m-graderte punkttetthet, og bør det variere med sondering-alder?
4. **Miljødirektoratets Naturbase-API:** krever trolig forhåndsavtale
   («all bruk av API-et skal avtales med Miljødataseksjonen på forhånd») —
   skal dette avklares nå (fase 0/1) eller skal norske kystverneområder
   utsettes til svenske Bohuslän-soner er på plass?
5. **UI-skille mellom «mangler kartdekning» og «kartlagt no-go»:** §5
   krever at disse ikke vises likt, men denne spec-en definerer ikke
   symbolikken — hører det til `specs/kartvisning.md` (ikke skrevet ennå),
   eller skal et minimumskrav (f.eks. skravur vs. fylt rødt) fastsettes her?
6. **Gammel-pakke-terskelen** (12 måneder foreslått i §5) — fornuftig, eller
   bør den kobles til en kjent Kartverket-revisjonssyklus/Efs-frekvens i
   stedet for et fast tall?
7. **`tools/arch-tests`-utvidelse:** bør `packages/charts` legges til
   `ALLOWED_PACKAGE_IMPORTS`-grensesnittet i
   `tools/arch-tests/import-boundaries.ts` på samme måte som
   `packages/geo`/`packages/routing` nå (ren, ingen I/O, ingen
   `packages/weather`-import)? Dette er en implementasjonsdetalj, men
   bør besluttes før `packages/charts` får ekte kode.
8. **Turf vs. geos-wasm:** er en dedikert liten fase 1-spike (prøvekjør
   turf mot en ekte Kartverket-eksport, se om boolsk algebra holder) verdt
   en dags arbeid før hele pipelinen legges opp rundt turf, slik
   THREDDS-/ensemble-spikene ble gjort for værsiden?
9. **Svensk hovedled-ekvivalent:** finnes det et åpent, maskinlesbart
   farled-datasett for svensk skjærgård (tilsvarende Kystverkets
   `Hovedled og biled`) som kan gi farled-bias i Bohuslän, eller må det
   leses ut av OpenSeaMap-tagging (lavere kvalitet, jf. research §3)?
