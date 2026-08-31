# Spec: rutemotor (`packages/routing`)

> **Gjeldende (ADR-0004 godkjent 2026-08-30).**
> Denne spec-en implementerer `docs/decisions/ADR-0004-rutemetodikk.md`, som
> Magnus godkjente 2026-08-30. Endres ADR-en, endres denne spec-en i samme
> slengen, med datert endringslogg nederst.

- Status: gjeldende (ADR-0004 godkjent 2026-08-30)
- Dato: 2026-08-30, sist endret 2026-08-31 (§5.11 evaluator, §7 E2)
- Fase: 2 (`docs/01-prosjektplan.md`)
- Pakke: `packages/routing`, med `packages/geo`, `packages/polar` og
  `packages/charts` som avhengigheter

---

## 1. Formål og kravsporing

Rutemotoren finner én seilingsrute fra start til mål gjennom et gitt
vær-/havfelt og en gitt farbarhetsmaske, og returnerer ruten sammen med et
ærlig svar på hvor trygg og hvor sikker den er. Den er **ren og
deterministisk**: samme input gir samme rute, alltid, uten I/O.

| Krav | Hva denne spec-en dekker |
|---|---|
| **F3.1** | Metodevalg (isokron-kjerne per ADR-0004), ren deterministisk kjerne, hvilke v1-innsikter som videreføres og hvilke som forkastes |
| **F3.2** | Båtmodell-kontrakten motoren konsumerer: polar (PTE/GTE), cruising-faktor, motorseiling m/drivstoff, maks TWS, derating på bølgebratthet (Hs/Tp²-klasse), vind-mot-strøm-flagg |
| **F3.4** | Kostnadsvektor utover tid (kryss, motor, natt), dagslys-ankomst som hardt/mykt krav, maks sammenhengende etappetid |
| **F3.5** | Progressiv/steg-vis beregning, kursoppløsning (6° kontroll / 10–12° medlem), delt A\*-felt og delt Tub-bound, minnemodell |
| **F1.1–F1.7** | Konsumeres via farbarhetsmasken: sikkerhetskontur, tørrfall/skjær, seilingshøyde, TSS-geometriregel, vernesoner, tillitsnivåer per segment |
| **F4.1** | Motoren er ensemble-klar: et medlem er én kjøring med eget vindfelt, delt felt/bound |
| **N1, N2** | Ingen rute uten tillitsnivå; ærlig degradering ved manglende maske, manglende vær, ikke nådd mål |
| **N5** | Enhetstester per komponent, golden-route-regresjon med toleranse, egenskapstester |
| **N6** | Ytelses- og minnebudsjett med etikett-tak |

Motoren **oppfyller ikke** F4.2–F4.6 alene; den leverer råstoffet
(per-medlem-ruter, kostnadsvektorer, Pareto-alternativer) som robusthetslaget
bygger på.

## 2. Avgrensning — hva denne spec-en bevisst IKKE dekker

- **Robusthetsaggregering** (P50/P90, gjennomførbarhetsandel, korridor-
  stabilitet, trafikklys, følsomste-faktor-attribusjon, bail-out-mål,
  rangering) → `docs/specs/robusthet.md`, fase 4. Motoren kjenner ikke
  begrepet «ensemble»; den kjøres bare mange ganger.
- **Konstruksjon av farbarhetsmasken** (Kartverket-vektor → sikkerhetskontur,
  tillitsgrid, TSS-geometri, vernesoner, pakkeformat) →
  `docs/specs/farbarhetsmaske.md`, fase 1. Denne spec-en definerer kun hva
  motoren **trenger** fra masken (§4.1).
- **Værpakkeformat, kvantisering, nedlasting og dekoding** →
  `docs/specs/vaerpakker.md`, fase 3. Motoren ser kun en ferdig dekodet,
  synkron feltaksessor (§4.2).
- **Worker-pool, planlegging av 150–210 kjøringer, transferable buffers,
  progressiv strømming til UI** → `apps/pwa` + `specs/robusthet.md`. Motoren
  leverer et *steg-vis* API (§5.6) slik at orkestrering er mulig; den
  orkestrerer ikke selv, og den yielder aldri til event-loopen.
- **Polar-kalibrering mot v1-loggene** (F3.3) → egen bølge etter fase 3-spiken.
- **Underveis-revisjon, XTE, målt-vs-prognose** (F5) → fase 6. Motoren støtter
  dem indirekte ved at «revider herfra» bare er en ny kjøring med ny start.
- **GPX-eksport og presentasjon** (F6.2, F4.4) → fase 5.

---

## 3. Sentrale begreper og konvensjoner

Alle retnings- og enhetskonvensjoner er eksplisitte og enhetstestes (F2.5):

| Størrelse | Enhet | Konvensjon |
|---|---|---|
| Vindretning `windFromDeg` | grader [0,360) | **FRA** — vinden kommer fra denne retningen |
| Bølgeretning `waveFromDeg` | grader [0,360) | **FRA** — sjøen kommer fra denne retningen (MET-konvensjon) |
| Strøm `currentU`, `currentV` | knop | **MOT** — `u` = komponent mot øst, `v` = komponent mot nord |
| Kurs `headingDeg` | grader [0,360) | kurs gjennom vannet, rettvisende |
| SOG-retning `sogDirDeg` | grader [0,360) | resultantretning etter strømaddisjon |
| TWA | grader [0,180] | `angDiff(windFromDeg, headingDeg)` — v1-semantikk |
| Fart | knop | STW for polarfart, SOG etter strøm |
| Tid | **hele sekunder** siden avgang (`tS`), og epoke-sekunder (UTC) for feltoppslag |
| Avstand | nautiske mil |

**Kryss (bidevind)** er definert som `TWA < beatTwaDeg` (standard **60°**, jf.
v1s kryssandel-definisjon), konfigurerbart.

**Natt** er definert som soltimer der solens høyde over horisonten er
`< -0,833°` (øvre solrand ved horisonten). Solhøyde beregnes med en ren
matematisk NOAA-basert funksjon i `packages/geo` — den er *ikke* I/O og bryter
ikke determinismen.

**Dagslys-ankomst** (F3.4) er definert som ankomst i vinduet
`[soloppgang + 1 t, solnedgang − 1 t]` i målets posisjon på ankomstdøgnet.

---

## 4. Datamodell og kontrakter

### 4.1 Inn-kontrakt: farbarhetsmasken

> **Merk:** `docs/specs/farbarhetsmaske.md` er under skriving parallelt med
> denne spec-en (2026-08-30) og finnes ikke ennå. Grensesnittet under er
> rutemotorens **behov**, formulert som en forespørsel til den spec-en. De
> autoritative navnene, signaturene og verdiområdene fastsettes der; denne
> spec-en oppdateres (med endringslogg) når den lander. Er det uenighet,
> vinner farbarhetsmaske-spec-en på navn og semantikk, og denne spec-en på
> hvilke operasjoner som må finnes.

```ts
/** Tillitsnivå per posisjon/segment (F1.3). */
type Tillit = "trygt" | "usikkert" | "no-go";

interface SegmentVerdict {
  readonly passable: boolean;          // hard: false ⇒ kandidaten forkastes
  readonly tillit: Tillit;             // "usikkert" er tillatt, men flagges
  readonly reason?: string;            // f.eks. "under sikkerhetskontur", "bru 12 m"
}

/**
 * Alt motoren trenger fra kartsiden. Rene, synkrone, deterministiske
 * oppslag mot en ferdigbygd pakke (F1.0 — ingen runtime-henting).
 */
interface NavigabilityMask {
  /** Punkt-test. Brukes på kandidatpunktet før den dyrere segmenttesten. */
  pointVerdict(lat: number, lon: number): SegmentVerdict;

  /**
   * Segment-test: kan båten gå i rett linje fra a til b?
   * Dekker dybde/sikkerhetskontur, tørrfall, skjær/grunner, seilingshøyde
   * (F1.4 — masten er en parameter i pakken, ikke i kallet) og
   * sesongstengte soner (F1.6 — bakt inn i pakken ved bygging for turens
   * datointervall). Dette er motorens dyreste sjekk.
   */
  segmentVerdict(
    aLat: number, aLon: number, bLat: number, bLon: number,
  ): SegmentVerdict;

  /**
   * Avstand fra punkt til nærmeste ikke-farbare areal, i nm, avkortet ved
   * maxNm (returnerer maxNm hvis lenger unna). Brukes til kystbuffer
   * (v1: land.near / minOff).
   */
  clearanceNm(lat: number, lon: number, maxNm: number): number;

  /** TSS/skipsled-geometri (F1.5) — se §5.4 for regelen. */
  tssVerdict(
    aLat: number, aLon: number, bLat: number, bLon: number,
  ): TssVerdict;

  /** Dekningsgrad for området ruten faktisk berører (N2). */
  readonly coverage: "full" | "partial" | "none";
  /** Datum/kilde per region — bæres videre til resultatets tillitsfelt (F1.7). */
  readonly sources: readonly { readonly name: string; readonly datum: string }[];
}

type TssVerdict =
  | { readonly kind: "none" }
  | { readonly kind: "crossing"; readonly angleDeg: number }   // vinkel mot ledaksen
  | { readonly kind: "along"; readonly withDirection: boolean };
```

Invarianter motoren stoler på:

1. **Renhet.** Ingen I/O, ingen tilstand som endres mellom kall. Samme
   argumenter → samme svar, alltid.
2. **Konservativ.** `segmentVerdict` returnerer aldri `passable: true` for et
   areal den ikke har data for; manglende data gir `tillit: "usikkert"` (som
   er tillatt) eller `passable: false` med grunn (F1.3 «areal mellom
   sonderinger antas aldri trygt»).
3. **Symmetri.** `segmentVerdict(a,b)` og `segmentVerdict(b,a)` gir samme
   `passable`. (TSS-vurderingen er *ikke* symmetrisk — den er
   retningsavhengig, og det er hele poenget.)

### 4.2 Inn-kontrakt: værfelt-aksessor

```ts
interface WeatherField {
  /** Vind FRA, i knop og grader. undefined = utenfor dekning i rom eller tid. */
  wind(lat: number, lon: number, epochS: number):
    { readonly speedKn: number; readonly fromDeg: number } | undefined;

  /** Bølger. hs i meter, tp i sekunder, retning FRA. tp/fromDeg kan mangle. */
  waves(lat: number, lon: number, epochS: number):
    { readonly hsM: number; readonly tpS?: number; readonly fromDeg?: number } | undefined;

  /** Strøm MOT, komponenter i knop (u = øst, v = nord). */
  current(lat: number, lon: number, epochS: number):
    { readonly u: number; readonly v: number } | undefined;

  /** Konservative maksverdier over hele feltet — brukes til Vmax/Tub (§5.5). */
  readonly maxTwsKn: number;
  readonly maxCurrentKn: number;

  /** Gyldig tidsvindu (epoke-sekunder). Utenfor dette returnerer alt undefined. */
  readonly validFromS: number;
  readonly validToS: number;

  /** Metadata som følger med til resultatet (F2.4). */
  readonly header: PackageHeader;   // @morild/protocol
}
```

Ett ensemble-medlem = én `WeatherField`. Motoren vet ikke at det finnes
andre medlemmer.

### 4.3 Inn-kontrakt: båtmodell (`packages/polar`, F3.2)

```ts
interface BoatModel {
  /** Polarfart (STW, knop) ved gitt TWS/TWA, allerede skalert med
   *  cruising-faktor og seilvalg (PTE/GTE). Ren bilineær interpolasjon. */
  boatSpeedKn(twsKn: number, twaDeg: number): number;

  /** Deratingfaktor [0,1] fra bølgebratthet (Hs/Tp²-klasse, ikke Hs alene),
   *  relativ sjøretning og fart. Gulv defineres i polar-pakken. */
  waveFactor(hsM: number, tpS: number | undefined, relDirDeg: number): number;

  /** Harde ytelsesgrenser (F3.2) — brudd forkaster noden, ikke bare straffer. */
  readonly maxTwsKn: number;
  readonly maxHsM: number;

  /** Motorseiling (B7: standard 7,0 kn / 4,0 l/t, alltid justerbart). */
  readonly motorThresholdKn: number;   // under denne STW kobles motor inn
  readonly motorSpeedKn: number;
  readonly motorFuelLPerH: number;
}
```

### 4.4 Tilstandsnøkkel

Isokronsøket beskjærer på **tilstand**, ikke på posisjon alene.

```
stateKey = cellKey * 9 + courseSector      // 8 kurssektorer + NO_COURSE
```

**`cellKey`** — kollisjonsfri heltallsnøkkel over Skandinavia-bboxen:

```
iLat = round(lat / cellDeg) - LAT_MIN_IDX      // lat ∈ [53, 72]
iLon = round(lon / cellDeg) - LON_MIN_IDX      // lon ∈ [2, 32]
cellKey = iLat * LON_STRIDE + iLon
```

med `cellDeg` standard **0,02°** (v1s verdi), `LON_STRIDE = 4096` (romslig for
30°/0,02° = 1500 kolonner). Posisjoner utenfor bboxen forkastes med
`abortReason: "outsideDomain"` — vi lager aldri en nøkkel vi ikke kan bevise
er kollisjonsfri. (v1s `round(la/cell)*100000 + round(lo/cell)` er *ikke*
kollisjonsfri for negative lengdegrader; det er en stille bug vi ikke arver.)

**`courseSector`** — forrige kurs diskretisert i **8 sektorer à 45°**:

```
courseSector = floor(norm360(headingDeg + 22.5) / 45) mod 8
```

Sektor 0 dekker altså [337,5°, 22,5°). Startnoden har ingen forrige kurs og
får den reserverte sektoren `NO_COURSE = 8`, som gir
`stateKey = cellKey * 9 + sector` — vi bruker **9** som multiplikator, ikke 8,
nettopp for at «ingen kurs» skal være en egen tilstand og ikke kollidere med
sektor 0.

**Halseside (babord/styrbord bidevind) er ikke en nøkkeldimensjon.** Den er en
deterministisk funksjon av etikettens kurs og vindretningen i etikettens
posisjon/tid: `tack = sign(norm180(headingDeg − (windFromDeg + 180)))`, med
`tack = 0` når `TWA ≥ beatTwaDeg` (ikke bidevind). Den lagres på etiketten og
brukes i bautstraffen (§5.3), men å nøkle på den ville duplisert tilstander
uten å skille dem — vinden i en gitt celle på et gitt tidspunkt er den samme
for alle etiketter der.

### 4.5 Etikett

Etiketter lagres i en **arena** (struct-of-arrays i typede arrays), aldri som
objekter per node. Indeksen i arenaen er etikettens identitet; `parent` peker
til forelderindeks, `-1` for start.

```ts
/** Logisk view av én rad i arenaen. Materialiseres kun ved rekonstruksjon. */
interface Label {
  readonly lat: number;            // Float64Array
  readonly lon: number;            // Float64Array
  readonly tS: number;             // Int32Array  — sekunder siden avgang
  readonly beatS: number;          // Int32Array  — sekunder med TWA < beatTwaDeg
  readonly motorS: number;         // Int32Array  — sekunder med motor inne
  readonly nightS: number;         // Int32Array  — sekunder i mørke
  readonly headingDeg: number;     // Float32Array — kurs INN til denne etiketten
  readonly sector: number;         // Uint8Array  — 0..7, eller NO_COURSE = 8
  readonly tack: number;           // Int8Array   — -1 babord, +1 styrbord, 0 ikke bidevind
  readonly parent: number;         // Int32Array
  readonly flags: number;          // Uint16Array — bitmaske, se under
  // Diagnostikk-/rapportfelt, ikke del av dominansen:
  readonly twsKn: number;          // Float32Array
  readonly twdDeg: number;         // Float32Array
  readonly bspKn: number;          // Float32Array
  readonly hsM: number;            // Float32Array
}
```

`flags`-bitene: `USIKKER_TILLIT`, `MOTOR`, `NATT`, `KRYSS`,
`VIND_MOT_STROM`, `TSS_LANGS`, `SJOEGANGS_MARGIN_OVERSKREDET`,
`NEGATIV_VANNSTAND_RISIKO`. Flaggene er rapportering (F1.2, F1.3, F3.2), ikke
kostnad.

**Minne per etikett:** 8+8 (pos) + 4×4 (kostnad) + 4 (heading) + 1 + 1 + 4
(parent) + 2 (flags) + 4×4 (diagnostikk) = **~62 B**, avrundet til 64 B med
justering. Se §7.

### 4.6 Pareto-dominans — presis definisjon

Kostnadsvektoren er `c(L) = (tS, beatS, motorS, nightS)`, alle **hele
sekunder** (Int32). Heltallslagring er et bevisst determinismevalg: alle
sammenligninger er eksakte, ingen epsilon, ingen avhengighet av
flyttallsavrunding. Akkumulering skjer med `Math.round` på hvert bidrag, ikke
på summen.

> **Etikett A dominerer etikett B** (skrives `A ≺ B`) hvis og bare hvis
> A og B ligger i **samme tilstand** (samme `stateKey`), og
>
> - `A.tS ≤ B.tS` **og** `A.beatS ≤ B.beatS` **og** `A.motorS ≤ B.motorS`
>   **og** `A.nightS ≤ B.nightS`, **og**
> - minst én av de fire ulikhetene er streng.
>
> Er alle fire like, dominerer ingen av dem den andre; da avgjør
> **duplikatregelen**: den nye etiketten forkastes (den eksisterende ble
> funnet først i den deterministiske ekspansjonsrekkefølgen, og å beholde
> den første gjør resultatet uavhengig av hvor mange like veier som finnes).

Egenskaper som skal enhetstestes: irrefleksivitet (`¬(A ≺ A)`), antisymmetri
(`A ≺ B ⇒ ¬(B ≺ A)`), transitivitet (`A ≺ B ∧ B ≺ C ⇒ A ≺ C`), og at
dominans aldri sammenligner etiketter i ulike tilstander.

**Invariant:** etikettmengden i en tilstand er til enhver tid en **antikjede**
under `≺` — ingen etikett i mengden dominerer en annen. Håndheves ved
innsetting (§5.7) og verifiseres av en assertion-harness i testbygg.

**Fjerning er trygt.** Når en ny etikett A dominerer eksisterende B i samme
tilstand, fjernes B fra tilstandens *aktive* etikettliste. Det taper ingen
beskjæringsevne, fordi dominans er transitiv: alt B ville beskåret, beskjærer
A minst like hardt. B blir **ikke** slettet fra arenaen — allerede ekspanderte
barn av B er fortsatt gyldige ruter og har fortsatt en gyldig forelderpeker.

**ε-dominans er ikke aktivert i v2.0.** Grensesnittet har plass til en
`epsilonS`-vektor (standard `[0,0,0,0]`), men fordi ε-dominans bytter
korrekthet mot fart på en måte vi ikke har målt behovet for, er den en
eksplisitt åpen mulighet (§9, spm. 3), ikke en standardverdi.

### 4.7 Konfigurasjon

```ts
interface RouteInput {
  readonly start: LatLon;
  readonly dest: LatLon;
  readonly departEpochS: number;          // UTC-sekunder, oppgitt av kalleren
  readonly weather: WeatherField;
  readonly mask: NavigabilityMask | undefined;   // undefined ⇒ degradert modus (§6)
  readonly boat: BoatModel;
  readonly field?: DistanceField;          // delt A*-felt (§5.5); bygges hvis fraværende
  readonly tubBoundS?: number;             // delt Tub-bound fra kontrollmedlemmet
  readonly options: RouteOptions;
}

interface RouteOptions {
  // Søkeoppløsning (F3.5)
  readonly headingStepDeg: number;         // 6 kontroll, 10–12 medlem
  readonly timeStepS: number;              // 1800 eller 3600
  readonly cellDeg: number;                // 0.02
  readonly courseSectors: 8;               // låst i v2.0, se §8 spm. 5

  // Etikett-tak (ADR-0004 mottiltak)
  readonly maxLabelsPerState: number;      // 4
  readonly maxLabelsPerCell: number;       // 12 (på tvers av sektorer)
  readonly maxTotalLabels: number;         // 250_000 (absolutt tak 400_000)

  // Avbrudd (v1-arv)
  readonly maxIterations: number;          // 1500
  readonly stagnationIterations: number;   // 80

  // Beskjæring
  readonly tubMarginFrac: number;          // 0.25
  readonly boundSlack: number;             // 1.09 (v1) — gjør bound-en konservativ
  readonly coneDeg?: number;               // UNDEFINED som standard (ADR-0004 avvik 2)

  // Myke vekter (F3.4) — brukes til rangering og utkasting, ALDRI i Pareto-vektoren
  readonly weightBeat: number;
  readonly weightMotor: number;
  readonly weightNight: number;
  readonly beatWeightLengthScaling: boolean;   // «vekt skalert med etappelengde»

  // Harde brukerkrav (F3.4)
  readonly requireDaylightArrival: boolean;    // false ⇒ mykt kostnadsledd
  readonly maxContinuousLegS?: number;         // mannskapstak, se §8 spm. 9
  readonly minOffingNm: number;                // kystbuffer, 0.5 (v1)
  readonly offingExemptNearEndsNm: number;     // 3.0 (v1: havneanløp)
  readonly beatTwaDeg: number;                 // 60

  // Rapportering
  readonly isochroneSnapshotHours: number;     // 6 (v1)

  /** Referansemodus: slår AV alle tapsgivende beskjæringer (etikett-tak,
   *  Tub-bound, stagnasjonsvakt, kjegle). Kun for egenskapstester på små
   *  problemer — aldri i produksjon. */
  readonly exactMode: boolean;                 // false
}
```

### 4.8 Ut-kontrakt

```ts
interface RouteResult {
  readonly reached: boolean;
  readonly abortReason?:
    | "stagnation" | "labelCap" | "iterationCap" | "noExpandableLabels"
    | "noWeatherAtStart" | "outsideDomain" | "callerStopped";

  readonly legs: readonly RouteLeg[];      // konsolidert (§5.9)
  readonly steps: readonly RouteStep[];    // ett per tidssteg (intervallsnitt, F4.4-bånd)

  readonly totals: {
    readonly durationS: number;
    readonly distanceNm: number;
    readonly beatS: number;
    readonly motorS: number;
    readonly nightS: number;
    readonly beatAtNightS: number;         // «kryss-timer i mørket» (F3.4)
    readonly fuelL: number;
    readonly arrivalEpochS: number;
    readonly daylightArrival: boolean;
    /** Hardt krav brutt (§5.8). Settes både når den reelle ankomsten er i
     *  mørket OG når ruten ikke ender i målet i det hele tatt — kravet er
     *  «ankomst i målet i dagslys». */
    readonly violatesDaylightRequirement: boolean;
  };

  /** Utfallet av den direkte sluttetappen (§5.8). */
  readonly finalLeg: {
    readonly status:
      | "ikke-forsokt"        // reached = false; abortReason forklarer
      | "ikke-nodvendig"      // siste steg er allerede i mål (≤ 0,3 nm)
      | "lagt-til"
      | "avvist-farbarhet"    // segmentVerdict eller TSS-regelen
      | "avvist-vaer"         // ingen vinddata / utenfor værfeltets tidsvindu
      | "avvist-baatgrenser"  // TWS/Hs over båtens grenser
      | "avvist-fart";        // ingen framdrift mot målet
    readonly reason: string | null;
    readonly shortfallNm: number;          // avstand fra siste steg til målet
  };

  readonly safety: {
    /** Kan aldri være "trygt" når finalLeg.status er en avvist-*-status (§5.8). */
    readonly verdict: "trygt" | "usikkert" | "usikker-rute";
    /** Ender ruten faktisk i målet? Sant kun for finalLeg.status
     *  ∈ {"lagt-til", "ikke-nodvendig"}. Dette — ikke `reached` — er
     *  spørsmålet «kom vi fram» (§5.8). */
    readonly reachesDestination: boolean;
    readonly recheckPassed: boolean;       // §5.10 — uavhengig ettersjekk
    readonly failingSegments: readonly SegmentRef[];
    readonly flaggedSegments: readonly SegmentRef[];  // usikkert, sjøgang, vind-mot-strøm, TSS
  };

  readonly coverage: {
    readonly mask: "full" | "partial" | "none";
    readonly weather: "full" | "partial";
    readonly fieldUsed: boolean;
    readonly weatherHeader: PackageHeader;
    readonly chartSources: readonly { name: string; datum: string }[];
  };

  /** Ikke-dominerte alternativer i målcellen (opptil maxLabelsPerState − 1).
   *  Dette er den nye evnen ADR-0004 kjøper — råstoff for F3.4/F4.4/F4.5. */
  readonly alternatives: readonly RouteAlternative[];

  readonly isochrones: readonly { hours: number; points: readonly LatLon[] }[];

  readonly diagnostics: {
    readonly iterations: number;
    readonly labelsCreated: number;
    readonly peakActiveLabels: number;
    readonly pruned: {
      readonly dominated: number; readonly bound: number;
      readonly deadEnd: number; readonly hardConstraint: number;
      readonly capEvicted: number; readonly noWeather: number;
    };
  };
}
```

`RouteResult` er **ren data** — ingen funksjoner, ingen sirkulære referanser —
slik at den kan structured-clones ut av en worker uten spesialbehandling.

---

## 5. Adferd

### 5.1 Determinisme — ufravikelige regler

Motoren inneholder **ingen** av følgende: `Date.now`, `new Date`,
`performance.now`, `Math.random`, `setTimeout`, `setInterval`, `queueMicrotask`,
`fetch`, `crypto`, `node:`-import, tilgang til `globalThis`-tilstand, eller
`await`. Håndheves statisk av `tools/arch-tests` (§6.5), ikke av disiplin.

Videre:

- **All tid kommer inn som parameter** (`departEpochS`), aldri fra klokka.
- **Ingen `for…in`** og ingen iterasjon over objektnøkler. `Map`/`Set` brukes
  kun der innsettingsrekkefølgen er deterministisk gitt input.
- **All `sort` bruker en total komparator** — ingen sammenligning kan returnere
  0 for to forskjellige elementer. Der naturlige nøkler er like, brytes
  uavgjort på arena-indeks (som er deterministisk).
- **Kursløkken går alltid i samme rekkefølge** (`h = 0, step, 2·step, …`), og
  frontier-listen behandles i innsettingsrekkefølge.
- **Motoren yielder aldri.** v1 gjorde `await new Promise(r=>setTimeout(r,0))`
  hver 20. iterasjon for å holde UI levende. Det er *kallerens* ansvar i v2 og
  gjøres via det steg-vise API-et (§5.6). Dette er et bevisst v1-avvik.

**Determinismens rekkevidde:** byte-identisk resultat er garantert for samme
input i **samme JS-motor/build**. På tvers av V8-versjoner er `Math.sin/cos/
atan2/asin` implementasjonsdefinert, og da gjelder kun toleransesammenligning
(N5). Egenskapstesten i §6.3 tester det første; golden-testene tester det
andre.

### 5.2 Hovedløkken

```
1. Valider input, bygg/motta A*-felt, beregn Vmax og Tub  (§5.5)
2. Sett inn startetiketten i tilstand (cellKey(start), NO_COURSE)
3. For iter = 1 … maxIterations:
     a. for hver etikett i frontier:  ekspander (§5.3)
     b. hvis ingen nye etiketter → abortReason = "noExpandableLabels", stopp
     c. hvis totalt antall etiketter > maxTotalLabels → "labelCap", stopp
     d. oppdater beste-avstand-til-mål; hvis ingen forbedring på
        stagnationIterations iterasjoner → "stagnation", stopp
     e. hvis (iter·timeStep) passerer neste isokron-snapshot → lagre front
     f. hvis beste avstand < reachRadius → reached = true, stopp
     g. frontier = de nye etikettene
4. Rekonstruer rute fra beste etikett (§5.8), konsolider (§5.9),
   kjør uavhengig sikkerhetsettersjekk (§5.10), bygg resultat
```

`reachRadius = max(2,0 nm, timeStepS/3600 · 4 · 0,5)` — v1s formel, beholdt.

Merk at dette er **label-setting, ikke label-correcting**: `tS` vokser
monotont langs enhver sti (`tS_barn = tS_forelder + timeStep + straff ≥
tS_forelder`), så en etikett trenger aldri korrigeres bakover. Det er
begrunnelsen fra `rutemetodikk.md` §2, og den holder bare så lenge ingen
kostnadskomponent kan bli negativ — en invariant som enhetstestes.

### 5.3 Ekspansjonssteget — rekkefølge

Rekkefølgen er **billige tester → harde constraints → myke kostnader →
innsetting**, med én bevisst nyanse (se boksen under).

**Per etikett `n` i frontier, én gang (før kursløkken):**

- `w = weather.wind(n.lat, n.lon, departEpochS + n.tS)`.
  `undefined` → `pruned.noWeather++`, hopp over etiketten (v1-adferd).
- **Hard:** `w.speedKn > boat.maxTwsKn` → forkast etiketten (F3.2 — «ruten går
  rundt uvær»).
- `wv = weather.waves(...)`. **Hard:** `wv.hsM > boat.maxHsM` → forkast.
- `cur = weather.current(...)` (valgfritt; `undefined` → 0).
- `isNight = sunAltitudeDeg(n.lat, n.lon, epoch) < -0.833`.

**Per kurs `h` i `0, headingStep, 2·headingStep, …`:**

| # | Steg | Type | Kost |
|---|---|---|---|
| 1 | `bsp = boat.boatSpeedKn(tws, twa) · waveFactor(...)`; motorseiling hvis `bsp < motorThreshold` | billig | tabelloppslag |
| 2 | `bsp ≤ 0,05` → forkast | billig | — |
| 3 | Strømaddisjon → `sog`, `sogDir`; `sog ≤ 0,05` → forkast | billig | — |
| 4 | `np = stepLatLon(n, sogDir, sog · timeStep/3600)` | billig | — |
| 5 | Utenfor domenebbox → forkast | billig | — |
| 6 | Bautstraff (§5.3.1) → `tS` | billig | — |
| 7 | Myke akkumuleringer: `beatS`, `motorS`, `nightS` | billig | — |
| 8 | **Dominanstest** mot tilstandens etikettliste (§4.6) | billig | ≤ 4 heltallssammenligninger × 4 |
| 9 | A\*-feltoppslag `Dn`; `undefined` → `pruned.deadEnd++` | billig | typed-array-indeks |
| 10 | Tub-bound: `tS + Dn·3600/(boundSlack·Vmax) > Tub·(1+tubMarginFrac)` → forkast | billig | — |
| 11 | Kjegle, **hvis** `coneDeg` er satt (av som standard) | billig | ett `bearing` |
| 12 | **Hard:** `mask.pointVerdict(np)` → `no-go` forkastes | middels | punktoppslag |
| 13 | **Hard:** kystbuffer — `mask.clearanceNm(np, minOffing) < minOffing`, unntatt < `offingExemptNearEndsNm` fra start/mål. Svar caches per `cellKey` (v1-mønster) | middels | cachet |
| 14 | **Hard:** `mask.segmentVerdict(n, np).passable === false` → forkast | **dyr** | geometri |
| 15 | **Hard:** TSS-regelen (§5.4) | middels | — |
| 16 | **Hard:** dagslys-ankomst hvis `requireDaylightArrival` og `np` er innenfor `reachRadius` av målet. Merk: dette er en *teleportering* — sjekken måler tiden i `np`, ikke etter den direkte sluttetappen. Den reelle ankomsten sjekkes på nytt i §5.8 | billig | — |
| 17 | Flagg: `usikkert`-tillit, sjøgangsmargin, vind-mot-strøm, TSS-langs | billig | — |
| 18 | **Innsetting** i tilstanden med dominans + tak (§5.7) | billig | — |

> **Hvorfor dominanstesten (8) kommer før de harde geometritestene (12–15).**
> Semantikken i ADR-0004 er at ingen myk kostnad kan redde en kandidat som
> bryter en hard constraint. Den semantikken er sikret av at **innsetting alltid
> er siste steg** — en etikett kommer aldri inn i tilstandsmengden før alle
> harde sjekker er kjørt. Rekkefølgen mellom *forkastende* filtre er derimot en
> ren ytelsesdetalj: å forkaste tidlig kan aldri gjøre en ugyldig kandidat
> gyldig. Dominanstesten er den billigste og mest treffsikre filteret vi har,
> og å legge den foran den dyre segmenttesten sparer nettopp de
> `mask.segmentVerdict`-kallene v1s profil viser er dominerende.
> **Invariant som testes:** for enhver returnert rute er hvert segment
> `passable` — verifisert uavhengig i §5.10.

#### 5.3.1 Bautstraff (ADR-0004 avvik 3)

v1: flat `+90 s` når `angDiff(h, forrigeKurs) > 15°`. v2:

```
tackPenaltyS(dHeadingDeg, tackFrom, tackTo, twsKn) =
    0                                       hvis |dHeading| ≤ minorCourseChangeDeg (15°)
    manoeuvreBaseS · f(|dHeading|)          hvis halseside er uendret
    tackBaseS + manoeuvreBaseS · f(|dHeading|)   hvis halseside skifter (-1 ↔ +1)
```

der `f(x) = x / 90` avkortet til `[0, 2]` (en 180°-kursendring koster dobbelt
av en 90°), `manoeuvreBaseS` standard **30 s** og `tackBaseS` standard
**60 s** — til sammen 90 s for en typisk bautt, altså **kalibrert til å gi v1s
tall for v1s typiske tilfelle**, slik at golden-diffene mot v1 blir tolkbare.
En gipp (halseside skifter på lens, `tack = 0` i begge ender) koster bare
manøverleddet.

`twsKn` er med i signaturen fordi bauting i lite vind koster mer fart enn i
frisk bris; **koblingen er ikke aktivert i v2.0** (faktor 1,0) fordi vi ikke
har kalibreringsdata for den ennå (F3.3-loggene). Signaturen står der for at
kalibreringsbølgen skal slippe å endre kallsteder.

### 5.4 TSS-regelen (F1.5, ADR-0004 avvik 4)

Egen, navngitt funksjon — ikke en generisk sonekostnad:

| `tssVerdict(a,b)` | Handling |
|---|---|
| `none` | ingenting |
| `crossing` med `angleDeg ≥ tssCrossMinDeg` (standard **60°**) | **tillatt**, ingen kostnad |
| `crossing` med `angleDeg < tssCrossMinDeg` | **hard avvisning** — «kryss på tvers, ikke skrått» |
| `along` med `withDirection: true` | tillatt, **myk** kostnad (`tssAlongCostS` per sekund i leden, standard 0 i v2.0) + flagg `TSS_LANGS` |
| `along` med `withDirection: false` | **hard avvisning** — seiling mot trafikkretningen |

Begrunnelsen for å gjøre «langs i feil retning» hardt og ikke bare svært dyrt
er ADR-0004s hard/myk-prinsipp: en tilstrekkelig høy myk kostnad kan i
prinsippet fortsatt vinne mot et alternativ som er enda dyrere på andre
dimensjoner. Et sikkerhets-/regelkrav skal aldri kunne tapes i en avveining.

`tssCrossMinDeg = 60°` er **et forslag som trenger bekreftelse** (§9, spm. 8):
Regel 10 sier «så nær rett vinkel som praktisk mulig», ikke en tallgrense.

### 5.5 A\*-vannavstandsfelt og Tub-bound

- **Konstruksjon:** Dijkstra fra målet på et 8-nabo-grid med oppløsning
  **500 m–1 km** (F3.1), dekoblet fra maskens oppløsning. Kanter stenges av
  farbarhetsmasken — ikke bare av kystlinjen, som i v1. Dette er en semantisk
  utvidelse: feltet blir dybdebevisst, ikke bare landbevisst.
- **Float64 er påkrevd.** v1 fant en avrundingsbug med Float32 som ga
  foreldede celler. Regresjonstest i §6.1.
- **Bruk 1 — blindvei-eliminering:** `field.at(np)` udefinert (og heller ikke
  definert i 3×3-nabolaget, jf. v1s `atNear`) ⇒ innestengt vann eller utenfor
  felt ⇒ forkast.
- **Bruk 2 — admissibel restestimat:** `tRest ≥ Dn · 3600 / Vmax`, der
  `Vmax = max(maks polarfart ved feltets maks-TWS, motorfart) + maks strøm +
  0,3`. `boundSlack = 1,09` (v1) deler ytterligere ned estimatet og gjør
  bound-en **konservativ**: den beskjærer mindre enn den strengt kunne, og kan
  derfor ikke kutte en optimal rute på grunn av et for optimistisk estimat.
- **Tub** (øvre tidsgrense) settes fra en grådig forhåndsrute mot feltets
  gradient (15°-kursoppløsning, som v1), eller mottas ferdig fra kalleren
  (delt bound på tvers av ensemble-medlemmer, F3.5).
- **Konsekvens som må stå tydelig:** Tub-bound er **endimensjonal** — den
  beskjærer på tid. En etikett som er tregere men bedre på kryss/motor/natt
  kan bli kuttet. Derfor `tubMarginFrac = 0,25` (v1 brukte
  `Tub + step + tackPen`, som er langt strammere) og derfor er bound-en av i
  referansemodus.
- **Feltet er væruavhengig** og bygges én gang per `(start, dest, maskeversjon,
  feltoppløsning)` og deles på tvers av alle avganger og alle
  ensemble-medlemmer (F3.5, F4.1, spike-rapportens anbefaling).
- Er start utilgjengelig i feltet (`atNear(start) === undefined`), slås feltet
  **av** for kjøringen (v1-adferd), `coverage.fieldUsed = false`, og både
  blindvei-pruning og Tub-bound bortfaller. Det er en ærlig degradering med
  ytelseskostnad, ikke en feil.

### 5.6 Progressiv beregning (F3.5)

Motoren eksponerer et **steg-vis, synkront** API. Den yielder aldri selv.

```ts
function createSearch(input: RouteInput): Search;

interface Search {
  /** Kjører inntil `maxIterations` iterasjoner og returnerer status.
   *  Kalleren bestemmer hvor ofte den slipper event-loopen til. */
  advance(maxIterations: number): SearchProgress;
  /** Gyldig delresultat når som helst: beste rute så langt + isokroner. */
  snapshot(): RouteResult;
  /** Avslutter og bygger endelig resultat (inkl. sikkerhetsettersjekk). */
  finish(): RouteResult;
  /** Kaller ber om stopp; neste finish() får abortReason "callerStopped". */
  stop(): void;
}

interface SearchProgress {
  readonly done: boolean;
  readonly iterations: number;
  readonly bestDistanceNm: number;
  readonly labels: number;
}

/** Bekvemmelighet: løkke over advance() til done. */
function planRoute(input: RouteInput): RouteResult;
```

Dette gir F3.5s UX-kontrakt direkte: hver isokron-front er et gyldig
delresultat, og `snapshot()` er alltid trygg å kalle. Orkestreringen
(kontrollmedlem for alle avganger først, deretter ensemble strømmet per
avgang) ligger utenfor motoren.

### 5.7 Innsetting, tak og utkasting

```
insert(state, ny):
  1. hvis noen eksisterende E i state har E ≺ ny  → forkast ny (pruned.dominated++)
  2. hvis noen eksisterende E har identisk kostnadsvektor → forkast ny (duplikatregel)
  3. fjern alle eksisterende E der ny ≺ E fra state sin aktive liste
  4. legg ny inn i arenaen og i state sin aktive liste
  5. hvis |state| > maxLabelsPerState → kast ut én (regelen under)
  6. hvis Σ|states i samme celle| > maxLabelsPerCell → kast ut én i cellen
```

**Utkastingsregelen** (deterministisk, ingen tilfeldighet):

```
score(L) = L.tS
         + weightBeat'  · L.beatS
         + weightMotor  · L.motorS
         + weightNight  · L.nightS
```

der `weightBeat' = weightBeat · (1 + log10(max(1, distanceNm/10)))` hvis
`beatWeightLengthScaling` (F3.4: «vekt skalert med etappelengde»). Etiketten
med **høyest** score kastes. Uavgjort brytes leksikografisk på
`(tS, beatS, motorS, nightS, headingDeg, arenaIndex)` — arena-indeksen er
alltid unik, så komparatoren er total.

Utkastede etiketter fjernes kun fra den aktive listen, aldri fra arenaen
(barn beholder gyldige forelderpekere).

> **Konsekvens som ikke skal skjules:** utkasting gjør motoren til en
> heuristikk. Vektene brukeren velger påvirker dermed ikke bare rangeringen,
> men hvilke ruter som i det hele tatt overlever søket. Det er en reell
> designsvakhet og er §9 spm. 1.

### 5.8 Rekonstruksjon og alternativer

Målcellen (alle sektorer, innenfor `reachRadius`) kan holde flere
ikke-dominerte etiketter. Primærruten er den med lavest `score` (samme
funksjon som i §5.7). Øvrige ikke-dominerte etiketter returneres som
`alternatives`, sortert på score, med sin fulle kostnadsvektor — det er dette
F3.4 og F4.4 skal presentere som «raskere, men mer kryss».

Rekonstruksjon følger `parent`-kjeden bakover fra valgt etikett og reverserer.
`steps` er alle rå tidssteg (til intervallsnitt og vær-langs-ruten-båndet,
F4.4); `legs` er konsolidert (§5.9).

**Direkte sluttetappe** (v1-arv): når `reached` er sant men siste punkt er
`> 0,3 nm` fra målet, legges en direkte etappe til målet. Etappen merkes
eksplisitt `direkteSlutt: true` i `legs`, slik at UI kan si det.

Sluttetappen er en **etterbehandling, ikke et søkesteg** — men den er en reell
seilas, og skal derfor bestå de samme sjekkene som ethvert søkesteg, i denne
rekkefølgen (skjerpet 2026-08-31, se §10):

1. `mask.segmentVerdict(siste, mål).passable` **og** TSS-regelen (§5.4).
   Etterbehandling skal aldri kunne innføre et brudd søket selv ville avvist.
2. Værfeltets gyldige tidsvindu, og `wind(siste, t_siste) !== undefined`.
3. `checkHardNode` — båtens ytelsesgrenser (§5.3 steg 3).
4. **Kinematikk med søkets egne funksjoner:** `environmentAt` +
   `courseToSteer` + `stepKinematics` + `softContribution`, altså *inkludert
   strøm*, motorterskel, bølgefaktor og `beatTwaDeg`. Tiden på etappen er
   `distanse / VMG` der `VMG = SOG · cos(∠(SOG-retning, peiling til mål))` —
   fart over grunn projisert på peilingen. Bautstraff (§5.3.1) påløper som
   for ethvert annet steg.
5. `VMG ≤ 0,05 kn` (`MIN_SPEED_KN`) ⇒ etappen er ikke seilbar.

Feiler **noen** av disse, legges etappen **ikke** til. Ruten ender da ved
siste ordinære steg, og `finalLeg` sier eksplisitt hvilken sjekk som stoppet
den (`status`, `reason`) og hvor langt fra målet ruten stoppet
(`shortfallNm`). Vi later aldri som om båten kom fram, og vi legger aldri til
en etappe med distanse men uten tid (N2). `reached` beholdes som søkets eget
svar — «innenfor `reachRadius`» — fordi det er dét det betyr; det er
`finalLeg` som forteller om ruten faktisk ender i målet.

> **Hvorfor ikke bare la den useilbare etappen stå med 0 s?** Fordi da lyver
> `totals`: distansen er med, tiden er ikke, og ankomsttid, `fuelL` og alle
> avledede tall blir feil. Golden-invarianten «hvert steg som flytter båten
> koster tid» pinner dette.

**Reell dagslysankomst.** Søkets dagslyssjekk (§5.3 steg 16) måler på
etiketten *før* sluttetappen, altså på en teleportering inn til målet. Etter at
sluttetappen har fått reell tid, kjøres kravet på nytt: primærruten velges som
den **først rangerte ikke-dominerte kandidaten som både når målet
(`finalLeg.status ∈ {"lagt-til", "ikke-nodvendig"}`) og oppfyller
`requireDaylightArrival` med reell ankomsttid**. Holder ingen av kandidatene
kravet, returneres den best rangerte likevel — men med
`totals.violatesDaylightRequirement: true`. Ruten leveres aldri stille med
`daylightArrival: false` når brukeren har satt kravet hardt.

> **Hvorfor «når målet» er en del av kravet** (funn 1a, code-review runde 2
> 2026-08-31): uten det leddet kan en kandidat med *avvist* sluttetappe vinne
> dagslyskravet nettopp fordi den gir opp tidlig nok. «Ankomsten» er da bare
> tidspunktet ruten stoppet, et stykke fra havn — og en kandidat som faktisk
> kommer fram, men i mørket, ville tapt for den. Et krav om ankomst i dagslys
> kan aldri oppfylles av en rute som ikke ankommer.

`totals.daylightArrival` måles **der ruten faktisk ender**, ikke i målet — ble
sluttetappen avvist, er det siste ordinære steg som er ankomstpunktet.
`totals.violatesDaylightRequirement` settes tilsvarende når kravet er satt og
ruten ikke ender i målet, uansett hvor lyst det er der den stoppet.

**Ærlig flagging av en avvist sluttetappe.** `finalLeg.status` alene er ikke
nok: den ligger et nivå ned i resultatet, og alle *toppnivå*-signalene
(`reached: true`, `safety.verdict: "trygt"`, `safety.recheckPassed: true`,
`failingSegments: []`) sa tidligere «komplett, trygg rute» om en rute som
endte 1,7 nm fra havn. To ting sikrer at det ikke kan overses:

1. **`safety.reachesDestination`** — sant kun når `finalLeg.status` er
   `"lagt-til"` eller `"ikke-nodvendig"`. Dette er boolsken nedstrøms kode
   skal lese for «kom vi fram». `reached` er og forblir søkets eget, svakere
   svar («fant en etikett innenfor `reachRadius`»); de to kan være uenige, og
   da er det `reachesDestination` som forteller sannheten.
2. **`safety.verdict` gulves til minst `"usikkert"`** når `finalLeg.status` er
   en `avvist-*`-status. Verdikten heves *ikke* til `"usikker-rute"`: ingen
   del av linjen som faktisk tegnes er farlig, og å blande «farlig linje»
   sammen med «kom ikke fram» ville gjort begge signalene mindre nyttige.

Gulvet gjelder bevisst **ikke** `"ikke-forsokt"`. Der er `reached: false`
allerede et toppnivå-signal som sier hele sannheten, og ruten er en ærlig
delrute (samme semantikk som `uoppnaelig-mal`-fiksturen). Det farlige
tilfellet er motsigelsen `reached: true` samtidig med en avvist sluttetappe.

### 5.9 Konsolidering

Sammenslåing av påfølgende ~like kurser (v1s `consolidate`, mot
isokron-sagtann). To krav utover v1:

1. En sammenslåing gjennomføres **kun** hvis det resulterende, lengre
   segmentet består `mask.segmentVerdict(...).passable`. Konsolidering skal
   aldri kunne skape en rute som krysser en grunne to korte segmenter gikk
   utenom.
2. Konsolidering endrer aldri `totals` — tid, kryss, motor og natt beregnes
   fra `steps`, ikke fra `legs`.

Konkav hull som alternativ til konsolidering er navngitt og utsatt
(ADR-0004, «Alternativer vurdert»).

### 5.10 Uavhengig sikkerhetsettersjekk (forsvar i dybden)

Etter rekonstruksjon og konsolidering kjøres **hvert** segment i den ferdige
ruten på nytt gjennom `mask.segmentVerdict` og `tssVerdict` — av kode som
ikke deler tilstand med søket, og som ikke stoler på noen cache fra søket.

- Alle segmenter `passable` og `tillit === "trygt"` → `verdict: "trygt"`.
- Ett eller flere `tillit === "usikkert"` → `verdict: "usikkert"`, segmentene
  listes i `flaggedSegments`.
- **Ett eller flere `passable === false` → `verdict: "usikker-rute"`,
  `recheckPassed: false`, segmentene listes i `failingSegments`.** Ruten
  returneres likevel (N2: vi skjuler den ikke), men den er eksplisitt merket
  og skal aldri presenteres som en anbefaling.

At ettersjekken noen gang feiler er per definisjon en bug i søket. Derfor:
hver gang den feiler i test eller drift, skrives en golden-test som
reproduserer tilfellet før feilen fikses.

### 5.11 Rute-evaluator (`evaluateRoute`)

> **Besluttet 2026-08-31 (Magnus).** Evaluator-kjernen bygges nå, før
> ytelsesarbeidet, som måleinfrastruktur for E1′-valideringen (skalart søk vs.
> korridor-evaluering per ensemble-medlem) og som byggekloss for fase 4.
> Bakgrunn: `docs/research/ekspertpanel-runde2-2026-08-31.md` §5
> (ytelsesingeniørens fallgruveliste), §6 punkt 4 og §7. Dette er
> **evaluator-kontrakten**, ikke en metodebeslutning om ensemble-mekanismen —
> den er fortsatt åpen (E1′).

**Formål.** Gitt en rute (en sekvens veipunkter) og et *vilkårlig* værfelt:
seil ruten gjennom feltet og rapporter samme kostnadsvektor, samme flagg og
samme harde dom som søket ville gitt. Det er dette som gjør det mulig å spørre
«hvordan går kontrollruten i medlem 17?» uten å søke på nytt, og å måle hva et
billigere søk taper mot full Pareto.

**Én-sannhet-prinsippet (ufravikelig).** Evaluatoren er en **tynn løkke over de
samme frie funksjonene søket bruker** — `stepKinematics`, `softContribution`,
`accumulateSoft`, `checkHardNode`, `checkClearance`, `checkSegment`,
`checkTssStep` (`expand.ts`), `tackOf`/`tackPenaltyS` (`tack.ts`),
`daylightArrival` (`daylight.ts`). Ingen kopiert kinematikk, ingen kopiert
kostlogikk, ingen «nesten lik» variant. Avviker de to, er det en bug i én av
dem, og egenskapstesten under skal fange den. Trenger evaluatoren noe søket
ikke eksponerer, er svaret å eksportere funksjonen — ikke å skrive den om
igjen.

**Semantikk: styr-mot-veipunkt, ikke replay-av-kurs.** Ruten er en geometri,
ikke en kursliste. Under perturbert vind og strøm driver båten av linjen, og en
seiler korrigerer for det. Evaluatoren setter derfor per tidssteg den kursen
gjennom vannet som gjør at **resultanten etter strøm** peker mot neste
veipunkt (klassisk strømtriangel, løst ved fastpunktiterasjon fordi polarfarten
selv avhenger av kursen), og går videre til neste veipunkt når det er nådd.
Konsekvenser som skal stå tydelig:

- Er strømmen sterkere enn båtfarten på tvers av linjen, finnes ingen slik
  kurs. Da styres det rett mot veipunktet og avdriften aksepteres — best
  effort, og steget flagges i rapporten.
- Retning og avstand til neste veipunkt regnes med **samme flate
  approksimasjon som `stepLatLon`** (`packages/geo`). Det er den nøyaktige
  inversen av kinematikken søket flytter båten med; storsirkelpeiling ville
  innført et systematisk avvik på inntil ~0,1° per steg som søket ikke har.
- Siste steg inn til et veipunkt er et **delsteg**: varigheten skaleres med
  hvor stor del av steget som faktisk trengs. Uten det ville evaluatoren
  akkumulert et helt tidssteg for de siste hundre metrene.

**Tilstand som tres gjennom.** Kurs inn, halseside (`tackOf`) og
sektoretikett bæres fra steg til steg nøyaktig som i søket. Startpunktet har
etiketten `NO_COURSE`, og **første steg får derfor bautstraff 0** — ellers
ville evaluatoren straffet en kurs båten ikke kom fra.

**Harde sjekker re-kjøres.** Klaring (med sjøgangstillegg), segment-farbarhet,
TSS-regelen og dagslys-ankomst kjøres på nytt i evalueringen, mot evaluatorens
egen maske og eget værfelt — uten cache fra noe søk. Det er samme forsvar i
dybden som §5.10, og det er det som gjør evaluatoren brukbar som
gjennomførbarhetstest.

**Rapportering, ikke boolean.** En hard avvisning returneres som en post med
`reason`, `lat`, `lon`, `tS`, `epochS` og hvilket veipunkt/steg den oppstod
i — «medlem 17 feiler» er ubrukelig, «medlem 17 mister klaringen 0,31 nm sør
for Vinga etter 9 t 30 min» er det som kan handles på. Evalueringen stopper
ved første harde avvisning; delresultatet fram dit returneres (N2).

**Renhet.** Samme regler som motoren ellers (§5.1): ingen I/O, ingen klokke,
ingen `Math.random`, ingen `await`. Samme input → samme evaluering, alltid.

**Egenskapstest — én-sannhet-testen (obligatorisk, §8.3).** For hver
golden-fikstur: kjør søket, evaluer den funne ruten mot *samme* værfelt, maske,
båt og `timeStepS`, og krev at evaluatorens kostnadsvektor er lik søkets
innenfor toleranse. Testen kjøres mot den **ukonsoliderte stegsekvensen**
(`RouteResult.steps`/etikettkjeden), aldri mot `legs`: konsolideringen (§5.9)
er en presentasjonsoperasjon som med vilje endrer geometrien, og å evaluere den
ville målt konsolideringen i stedet for kjernen. Toleransen er «noen få
sekunder», ikke ±2 % — dette er ikke en toleranse mot V8-forskjeller, det er en
identitetstest mellom to kodeveier i samme prosess.

---

## 6. Ærlig degradering (obligatorisk seksjon, N2)

| Situasjon | Adferd |
|---|---|
| `mask === undefined` | Søket kjører uten farbarhetssjekk. `coverage.mask = "none"`, `safety.verdict = "usikker-rute"` **uansett resultat**. Motoren kan ikke returnere `"trygt"` uten maske. |
| `mask.coverage === "partial"` | Søket kjører normalt. `coverage.mask = "partial"`; alle segmenter i udekket område får `tillit: "usikkert"` og flagges. |
| Vind mangler i en node | Noden ekspanderes ikke (`pruned.noWeather++`). Mangler vind allerede i startpunktet: `abortReason: "noWeatherAtStart"`, tom rute, forklarende resultat. |
| Vind mangler et stykke ut i tid | Søket stopper naturlig der feltet slutter; `reached: false` med `abortReason` og `coverage.weather = "partial"`. Vi ekstrapolerer aldri utenfor `validToS`. |
| Bølger/strøm mangler | Best effort: `waveFactor = 1`, strøm = 0. Segmentene flagges ikke som feil, men `coverage.weather = "partial"` og feltets header viser hva som manglet (F2.4). |
| A\*-felt kan ikke bygges / start utilgjengelig | `fieldUsed: false`; ingen blindvei-pruning, ingen Tub-bound. Kjøringen blir tregere — det rapporteres, ikke skjules. |
| Målet ikke nådd | `reached: false` + `abortReason`. Beste delrute returneres slik at brukeren ser hvor langt motoren kom og hvorfor den stoppet. |
| Etikett-taket nås | `abortReason: "labelCap"`. Dette er *ikke* en stille kvalitetsforringelse — det står i resultatet og skal vises. |
| Sjøgangstillegg (F1.2) overskrider maskens statiske margin | Segmentet flagges `SJOEGANGS_MARGIN_OVERSKREDET` og får `tillit: "usikkert"`. Det avvises **ikke** — masken er bygd med statisk margin, og vi later ikke som vi kan gjøre den strengere i ettertid. Se §9 spm. 10. |
| Negativ meteorologisk vannstand i prognosen | Flagg `NEGATIV_VANNSTAND_RISIKO` på berørte segmenter (F1.2). Flagg, ikke constraint, i v2.0. |

---

## 7. Ytelses- og minnebudsjett

Fra F3.5 og N6, med tallgrunnlag fra `docs/research/spike-ensemble-perf.md`.

> **BESLUTTET 2026-08-31 (Magnus, E2).** Ytelsesmålet for én deterministisk
> rute er **denne seksjonens < 5 s på nettbrett, kombinert med progressiv
> tegning** (§5.6). Et foreslått < 1 s-mål er **forkastet**; tube-/korridor-
> begrensning av søkerommet er reserve hvis interaktiv bruk senere krever mer,
> ikke et mål i seg selv. Bakgrunn og full argumentasjon:
> `docs/research/ekspertpanel-runde2-2026-08-31.md` §6–§7 og
> `docs/research/ekspertpanel-fysikk-2026-08-31.md`.
>
> To rekkefølge-føringer følger av samme beslutning: (a) nettbrett-måling med
> instrumentert bygg går **foran** alt ytelsesarbeid — tallene under er fortsatt
> PC-ekstrapolasjoner; (b) evaluator-kjernen (§5.11) bygges **før** optimering
> av den varme løkka, slik at optimeringen har måleinfrastruktur og ikke
> dupliserer arbeid i de delte kjernefunksjonene.

| Budsjett | Mål | Grunnlag |
|---|---|---|
| Én deterministisk rute (kontroll, 6°) | **< 5 s** på moderat Android-nettbrett | spike F1: 210–450 ms på PC, ×2–4 → 0,4–1,8 s. ADR-0004s korreksjoner spiser av denne margen — se «må måles» |
| Ett ensemble (30 medlemmer × 1 avgang, 12°, worker-pool, delt felt) | **< 60 s** | spike F1: 1,3–2,1 s på PC, ×2–4 → 2,7–8,4 s |
| S1 fullt (5–7 avganger × 30 medlemmer) | < 60 s opplevd via progressiv strømming | spike: ekstrapolert 16–52 s på nettbrett — **ikke målt**, flagget i spike-rapporten |
| JS-heap under ensemble-kjøring | **< 500 MB** | N6 |

**Minneregnskap per kjøring (etikett-arena):**

| Post | Standard | Absolutt tak |
|---|---|---|
| `maxTotalLabels` | 250 000 | 400 000 |
| Bytes per etikett (§4.5) | 64 B | 64 B |
| Arena | **16 MB** | 25,6 MB |
| Tilstandsindeks (`Map<stateKey, Int32Array-slot>`) | ~6 MB | ~10 MB |
| A\*-felt (Float64, delt, ikke per medlem) | 1–8 MB totalt | 8 MB |
| **Per samtidig medlem** | **~22 MB** | ~36 MB |
| × 6 workers | **~132 MB** | ~216 MB |

Innenfor N6, men ikke lenger neglisjerbart slik det var i v1 (spike F7:
< 9 MB hovedtråd). Arena-buffere skal være transferable (F3.5s minnemodell)
slik at de ikke kopieres ut av workeren.

**Det som må måles før tallene låses** (og som spec-en ikke later som den
vet):

1. Kostnaden ved å fjerne kjeglen — samme golden-rute med `coneDeg`
   `undefined` vs. `165` vs. `115`, målt i `labelsCreated` og wall-clock.
2. Faktisk etikett-multiplikator: hvor mange etiketter per celle oppstår i
   praksis i Bohuslän vs. åpent farvann, ved sektorantall 8 / 12 / 16.
3. Kostnaden ved `mask.segmentVerdict` mot ekte kartpakke — den erstatter v1s
   `land.crosses` og er trolig dyrere. Andelen av total kjøretid skal
   instrumenteres.
4. S1s fulle skala (150–210 kjøringer) på nettbrett — arvet åpen fra
   spike-rapporten.
5. Structured-clone-kostnaden ved å sende hele `RouteResult` ut av workeren
   (spike-rapporten strippet dette bort og målte det ikke).

---

## 8. Testkrav (N5)

### 8.1 Enhetstester per komponent

| Komponent | Hva som testes |
|---|---|
| `cellKey` | Kollisjonsfrihet over hele Skandinavia-bboxen ved `cellDeg = 0,02` (uttømmende over gitteret); at negative lengdegrader ikke kolliderer (v1-buggen vi ikke arver); at punkter utenfor bboxen avvises |
| `courseSector` | Wrap ved 0/360; at 337,5° og 22,4° gir samme sektor; at `NO_COURSE` aldri kolliderer med sektor 0 |
| `dominates` | Irrefleksiv, antisymmetrisk, transitiv (egenskapstest over seedet generert vektorsett); at like vektorer ikke dominerer hverandre; at etiketter i ulike tilstander aldri sammenlignes |
| `insert` | Antikjede-invarianten holder etter vilkårlige innsettingssekvenser; at fjerning av dominerte ikke svekker senere beskjæring; at taket kaster ut deterministisk og alltid samme etikett for samme sekvens |
| `tackPenaltyS` | Symmetri i `|Δkurs|`; null under 15°; monoton i `|Δkurs|`; halsbytte koster strengt mer enn samme-hals-kursendring av samme størrelse; at v1s typiske tilfelle gir 90 s |
| A\*-felt | Kjente småfikstur-grid: uåpnelige lommer gir `undefined`; feltet er monotont avtagende mot målet; `atNear` finner nabo når senteret er på land. **Regresjonstest: feltet beregnet i Float32 gir foreldede celler på en konstruert fikstur — testen feiler hvis implementasjonen ikke er Float64** (v1-bug → test, per prosjektets regel) |
| Tub-bound | På et lite problem i referansemodus: kjøring med bound gir samme optimale `tS` som uten bound (admissibilitet) |
| TSS-regel | Alle fem tilfellene i §5.4-tabellen; at «langs, feil retning» avvises uansett hvor høy den myke kostnaden settes |
| Hard/myk-skillet | Test som setter en absurd høy myk kostnad (1e9) og verifiserer at en no-go-passasje fortsatt ikke blir gyldig |
| Konsolidering | En konstruert sagtann som ville blitt slått sammen til et segment gjennom en grunne, blir **ikke** slått sammen |
| Sikkerhetsettersjekk | En rute konstruert med et segment gjennom no-go gir `recheckPassed: false` og korrekt `failingSegments` |
| Sol/natt | Kjente soloppgangs-/solnedgangstider for Skjæløy og Skagen på kjente datoer, innenfor ±2 min |
| Retningskonvensjoner | Vind FRA / strøm MOT / bølge FRA (F2.5) — eksplisitte tester med håndregnede tilfeller |

### 8.2 Golden-route-harness (`pnpm test:golden`)

- **Frosne felt.** Værfelt og kartpakke som **committede fiksturer**, ikke
  genererte. Så lenge ekte MEPS-uttrekk ikke finnes (fase 3), brukes
  syntetiske, deterministiske felt — merket som syntetiske i fiksturen, og
  byttet til ekte MEPS-uttrekk når F2.5s frosne testpakke lander (§9 spm. 11).
- **Rutesett (minimum):**
  1. **Skjæløy → Skagen**, åpent farvann, slør — v1s referansestrekk.
  2. **Bohuslän-skjærgård**, trange sund — tester maskeavhengighet og
     sektor-tilstandsrommet der det er verst.
  3. **Ren kryssetappe** (mål rett mot vinden) — tester bautstraffen og
     halseside-logikken.
  4. **Etappe gjennom TSS ved Skagen** — tester retningsregelen.
  5. **Uoppnåelig mål** (blokkert av land/uvær) — tester ærlig avbrudd:
     `reached: false` med riktig `abortReason`.
  6. **Etappe med hull i værfeltet** — tester degraderingen.
- **Sammenligning:** `totals.durationS` innenfor toleranse (**±2 %**, N5 —
  ikke bit-eksakt, `Math.sin/cos` er implementasjonsdefinert), rutegeometri
  innenfor en korridor (maks tverravvik mot referansesporet **≤ 0,5 nm**), og
  **eksakt** likhet på de diskrete feltene: `reached`, `abortReason`,
  `safety.verdict`, `recheckPassed`, antall `failingSegments`.
- **Regel:** hver algoritmeendring krever ny golden-kjøring, og enhver diff
  skal forklares i §10s endringslogg. Uforklarte differ blokkerer commit.
- **v1-paritet** (fase 2 exit): golden-rutene sammenlignes også mot v1s
  resultat for samme input. Avvik er **tillatt og forventet** der årsaken er
  (a) farbarhet i stedet for kystlinje, (b) fjernet kjegle, (c) Pareto-valg —
  men årsaken må navngis per avvik.

### 8.3 Egenskapstester

- **Determinisme (ufravikelig).** Samme input kjørt tre ganger i samme prosess
  gir **byte-identisk** resultat: arena-buffere sammenlignes byte for byte, og
  det serialiserte `RouteResult` sammenlignes som streng. Samme kjøring i en
  fersk worker gir samme bytes. Testen kjøres på alle golden-rutene.
  *(På tvers av V8-versjoner gjelder kun toleranse — se §5.1.)*
- **Monotonitet.** I **referansemodus** (`exactMode: true`, alle tapsgivende
  beskjæringer av, små problemer): å stramme en hard constraint gjør aldri
  ruten raskere. Konkret, for hver av
  `minOffingNm ↑`, `boat.maxTwsKn ↓`, `boat.maxHsM ↓`,
  `requireDaylightArrival: false → true`, og «legg til en no-go-polygon»:
  `optimal(strengere).tS ≥ optimal(løsere).tS`, og den strengere løsningen er
  aldri Pareto-bedre på noen komponent.
  I **normal modus** (med etikett-tak) kjøres samme test som en
  *rapporterende* test: brudd feiler ikke bygget automatisk, men logges og må
  vurderes — takene gjør motoren til en heuristikk, og det er ærligere å måle
  avviket enn å påstå en garanti vi ikke har.
- **Antikjede-invariant.** Med assertions påslått verifiseres etter hver
  iterasjon at ingen tilstands etikettliste inneholder et dominert par.
- **Ingen negative kostnadsbidrag.** `tS`, `beatS`, `motorS`, `nightS` vokser
  monotont langs enhver forelderkjede — grunnlaget for label-setting (§5.2).
- **Én sannhet (evaluator vs. søk).** For hver golden-fikstur gir
  `evaluateRoute(søkets ukonsoliderte stegsekvens, samme felt/maske/båt/
  timeStepS)` samme kostnadsvektor som søket rapporterte, innenfor noen få
  sekunder, og uten hard avvisning. Se §5.11.
- **Sikkerhetsinvariant.** For hver returnert rute med
  `safety.verdict !== "usikker-rute"`: hvert segment består en uavhengig
  `segmentVerdict`. Kjøres på alle golden-ruter og på et sett tilfeldig
  genererte (seedet i **testen**, ikke i motoren) start/mål-par i
  Bohuslän-fiksturen.

### 8.4 Arkitekturtest (`pnpm test:arch`)

Utvides med statisk kildesjekk på `packages/routing` og `packages/geo`:
ingen forekomst av `Date.now`, `new Date`, `Math.random`, `performance.now`,
`setTimeout`, `setInterval`, `queueMicrotask`, `fetch`, `crypto`,
`node:`-import — og ingen `await`/`async` i motorens hovedvei. Dette er
determinisme håndhevet strukturelt (ADR-0004 «Bekreftelse» punkt 6).

---

## 9. Åpne spørsmål

1. **Brukervekter påvirker søkerommet, ikke bare rangeringen.** Utkastingsregelen
   (§5.7) bruker brukerens vekter for kryss/motor/natt. Det betyr at to
   brukere med ulike preferanser får ulike *kandidatmengder*, ikke bare ulik
   rangering av samme mengde. Alternativet er faste, nøytrale vekter i
   utkastingen (mer forutsigbart, men kaster kanskje ut nettopp den ruten
   brukeren ville foretrukket). **Spørsmål til Magnus: hva er riktigst — at
   motoren leter der du bryr deg, eller at den leter likt uansett?**
   **BESLUTTET 2026-08-30 (Magnus):** nøytrale faste vekter i søket;
   brukerens vekter styrer kun rangering/presentasjon, ikke utkastingen.
2. **Trenger kostnadsvektoren en femte dimensjon «kryss i mørket»?** F3.4 vil
   vise kryss-timer i mørket separat. Utledet fra `beatS` og `nightS` er det
   ikke — de to kan overlappe vilkårlig. Vi foreslår å **beregne den som eget
   felt i `totals`** (fra `steps`) uten å ta den inn i Pareto-vektoren, siden
   en femte dimensjon øker antall ikke-dominerte etiketter merkbart. Bekreftes.
   **BESLUTTET 2026-08-30 (Magnus):** beregnes i `totals` (fra `steps`),
   holdes UTE av Pareto-vektoren — dette er Magnus' tekniske valg,
   konsistent med de nøytrale søkevektene i spm. 1.
3. **ε-dominans:** aktiveres den, og med hvilke konstanter? Standard er av
   (§4.6). Bør vurderes hvis måling 2 i §7 viser etikett-eksplosjon i
   skjærgård. **BESLUTTET 2026-08-30 (Magnus):** av som standard;
   revurderes kun ved målt etikett-eksplosjon.
4. **`tubMarginFrac = 0,25`** er et gjetningsbasert startpunkt. Riktig verdi
   må måles: hvor mye Pareto-materiale mister vi ved 0 / 0,1 / 0,25 / ∞?
   **BESLUTTET 2026-08-30 (Magnus):** kalibreres empirisk i implementasjonen
   (golden-målinger), ikke besluttet på forhånd.
5. **Sektorantall 8 vs. 12 vs. 16** — låst til 8 i v2.0, men skal måles på
   Bohuslän-tilfellet (§7 måling 2) før tallet regnes som endelig. Samme
   spørsmål: bør **halseside** likevel bli en egen nøkkeldimensjon (×2) hvis
   kryssruter viser seg dårlige? **BESLUTTET 2026-08-30 (Magnus):** start 8;
   12/16 kun hvis golden-avvik viser behov.
6. **Skal kjeglen fjernes helt fra koden**, eller beholdes som en `undefined`
   -som-standard sikkerhetsventil? Spec-en velger det siste (kode som ligger
   der og ikke brukes er en risiko i seg selv, men å måtte skrive den på nytt
   i felt er verre). Bekreftes. **BESLUTTET 2026-08-30 (Magnus):** beholdes
   som valgfri sikkerhetsventil, av som standard (som ADR-en sier).
7. **v1s stagnasjonsvakt på 80 iterasjoner** ble kalibrert mot v1s skalare
   pruning. Med Pareto-etiketter forbedres «beste avstand til mål» kanskje
   sjeldnere fordi flere etiketter overlever i bredden. Terskelen må
   re-kalibreres mot golden-rutene — 80 er et startpunkt, ikke en fasit.
   **BESLUTTET 2026-08-30 (Magnus):** kalibreres empirisk i implementasjonen
   (golden-målinger), ikke besluttet på forhånd.
8. **`tssCrossMinDeg = 60°`.** Regel 10 sier «så nær rett vinkel som praktisk
   mulig», ikke et tall. Hvilken vinkel er riktig for en 41-fots seilbåt som
   krysser Skagen-TSS-en i bidevind? **Dette berører sikkerhets-/regelsemantikk
   og skal ikke besluttes av en agent.** **BESLUTTET 2026-08-30 (Magnus): ±30°
   fra tvers (kurs 60–120° på ledretningen godtas).**
9. **Maks sammenhengende etappetid (F3.4, mannskapstak).** Dette er en
   sti-historikk-egenskap («tid siden siste brukbare havn»), ikke en
   node-egenskap — å håndheve det hardt i søket krever en femte
   tilstandsdimensjon og er tett koblet til bail-out-listen (F4.6, fase 4).
   **Forslag: i v2.0 håndheves det som en etterfilter/flagging på ferdige
   ruter, ikke som en hard constraint i søket.** Bekreftes.
   **BESLUTTET 2026-08-30 (Magnus):** etterfilter/flagging i v2.0 (som
   foreslått).
10. **Sjøgangstillegget (F1.2)** kan ikke gjøre en statisk maske strengere i
    ettertid. Vi flagger (§6). Er det godt nok, eller skal kartpakken bygges i
    to marginvarianter (0,5 m og 0,5 m + typisk sjøgang) som motoren velger
    mellom per segment? Avhenger av `specs/farbarhetsmaske.md`.
    **BESLUTTET 2026-08-30 (Magnus): avvis når bølgedata finnes** —
    Hs-tillegget går inn i klaringstallet ved oppslag; flagg der data
    mangler.
11. **Golden-fiksturer med ekte MEPS-data** finnes ikke før fase 3 (F2.5).
    Bekreft at syntetiske, deterministiske felt er akseptabelt som
    golden-grunnlag i fase 2, med bytte til ekte uttrekk i fase 3.
    **BESLUTTET 2026-08-30 (Magnus):** ja — syntetiske deterministiske felt i
    fase 2, ekte MEPS-uttrekk i fase 3.
12. **Dagslys-ankomst:** gjelder det hardt kun sluttankomsten, eller også
    anløp av mellomhavner? v2.0 har ikke mellomhavner i rutemodellen, så
    spec-en antar **kun sluttankomst**. Bekreftes. **BESLUTTET 2026-08-30
    (Magnus):** ja — kun sluttankomst i v2.0.
13. **Grensesnittnavnene i §4.1** må avstemmes mot
    `docs/specs/farbarhetsmaske.md` når den lander.

---

## 10. Endringslogg

- **2026-08-31 (3) — funn 1 fra code-review runde 2: dagslysomvalget kunne
  velge en rute som ikke kom fram.** Se
  `docs/research/steg2-status-2026-08-31.md`.
  - **Buggen (KRITISK).** R4-omvalgsløkken i `reconstruct.ts` krevde kun at
    kandidaten ankom i dagslys, ikke at den faktisk nådde målet. En kandidat
    med `finalLeg.status: "avvist-*"` kunne dermed *vinne* dagslyskravet
    nettopp fordi den stoppet tidlig nok — og bli presentert med
    `reached: true`, `daylightArrival: true`,
    `violatesDaylightRequirement: false` og `safety.verdict: "trygt"` mens den
    endte 1,5+ nm fra havn. Kombinasjonen finnes i to av de sju
    golden-fiksturene, så den var ikke hypotetisk.
  - **1a — omvalget krever nå at ruten når målet** (§5.8): kandidaten må ha
    `finalLeg.status ∈ {"lagt-til", "ikke-nodvendig"}` **i tillegg til**
    dagslys. Holder ingen kandidat begge deler, returneres den best rangerte
    som før, men flagget.
  - **1b — shortfall kan ikke lenger overses av naiv nedstrøms kode**
    (§4.8, §5.8). Valgt mekanisme, to deler:
    1. **Nytt felt `safety.reachesDestination: boolean`** — sant kun for
       `"lagt-til"`/`"ikke-nodvendig"`. Dette er «kom vi fram»-boolsken;
       `reached` beholder sin egen, svakere betydning.
    2. **`safety.verdict` gulves til `"usikkert"`** når sluttetappen ble
       avvist. *Ikke* `"usikker-rute"` — linjen som tegnes er farbar, og de to
       signalene skal ikke blandes. Gulvet gjelder ikke `"ikke-forsokt"`, der
       `reached: false` allerede sier alt (samme semantikk som
       `uoppnaelig-mal`).
    3. `totals.violatesDaylightRequirement` settes også når kravet er satt og
       ruten ikke ender i målet: kravet er «ankomst *i målet* i dagslys».
    - **Vurdert og forkastet:** å legge shortfall inn som et
      `flaggedSegments`-element. Et `SegmentRef` peker på en `legIndex` som
      finnes i ruten; den manglende etappen gjør per definisjon ikke det, og
      en syntetisk `legIndex: -1` ville forurenset en liste hvis kontrakt er
      «segmenter i denne ruten».
  - **Nye tester (+6):** fem i `reconstruct.test.ts` som bygger
    `ResultContext` direkte (kandidat A: når målet, ankommer i mørke;
    kandidat B: når IKKE målet, «ankommer» i dagslys, dårligere rangert) —
    B velges aldri over A, fallbacken flagges ærlig, gulvet på `verdict`
    gjelder også uten dagslyskrav, og `"ikke-forsokt"` endrer ikke
    verdikten. Pluss én ny golden-invariant: «en avvist sluttetappe kan aldri
    stå som trygt», som også pinner at `reachesDestination` ikke kan drifte
    fra `finalLeg.status`. Buggen er verifisert reprodusert: med
    reach-kravet slått av faller den nye testen.
  - **Golden-diff (regenerert).** Ingen totaler, ingen geometri og ingen
    `finalLegStatus` er endret. To felt:

    | Fikstur | Diff | Forklaring |
    |---|---|---|
    | alle sju | `+ reachesDestination` | Nytt felt i `exact`-blokken, slik at det ikke kan drifte stille. `true` for de fire som ender i målet, `false` for `ren-kryssetappe`, `tss-ved-skagen` (avvist sluttetappe) og `uoppnaelig-mal`/`hull-i-vaerfeltet` (`reached: false`) |
    | ren-kryssetappe | `safetyVerdict` **trygt → usikkert** | `finalLegStatus: "avvist-fart"`; ruten ender 1,65 nm fra målet. Alle segmentene består fortsatt ettersjekken (`failingSegmentCount: 0`, `recheckPassed: true`) — det er nettopp derfor «trygt» var villedende |
    | tss-ved-skagen | `safetyVerdict` **trygt → usikkert** | `finalLegStatus: "avvist-farbarhet"`; ruten ender 1,71 nm fra målet. Samme begrunnelse |

  - **Konsekvens for UI:** «kom vi fram» leses fra
    `safety.reachesDestination`, aldri fra `reached` alene. En rute med
    `verdict: "usikkert"` og `reachesDestination: false` skal vise
    `finalLeg.shortfallNm` og `finalLeg.reason` eksplisitt.
- **2026-08-31 (2) — sluttetappen fikset: E-funn, R4 og R5.** Fikse-bølgen
  etter code-review + evaluator-bygg, se
  `docs/research/steg2-status-2026-08-31.md`.
  - **E-funn (§5.8) — useilbar og tidsfri sluttetappe.** `reconstruct.ts`
    regnet sluttetappens kinematikk selv, uten strøm og uten fartssjekk:
    `extraS = bspKn > 0.1 ? … : 0`. Med målet rett mot vinden og motoren av
    ble `bspKn ≈ 0`, og etappen fikk **full distanse uten tid** i `totals`.
    Fikset ved at etappen nå bruker søkets egne funksjoner (`environmentAt`,
    `courseToSteer`, `stepKinematics`, `softContribution`) og at farten måles
    som VMG mot målet. **Valgt semantikk (spec §5.8 over):** en etappe båten
    ikke kan seile legges *ikke* til; ruten ender ved siste ordinære steg og
    `finalLeg` sier hvorfor og hvor langt unna. Det er samme svar som allerede
    gjaldt når `segmentVerdict`/TSS avviste etappen — forskjellen er at det nå
    er synlig i stedet for stille. Alternativet «legg til med reell tid
    likevel» finnes ikke: det er nettopp det båten ikke kan.
  - **R4 (§5.3 steg 16 + §5.8) — hardt dagslyskrav sjekket før sluttetappen
    hadde tid.** Søkets sjekk er en teleportering. Kravet kjøres nå på nytt
    med reell ankomsttid: primærruten velges blant de ikke-dominerte
    kandidatene som fortsatt holder kravet, og holder ingen, settes
    `totals.violatesDaylightRequirement`. Ny felt i ut-kontrakten (§4.8).
  - **R5 (§5.8)** — hardkodet `60` erstattet av `opts.beatTwaDeg`; forsvinner
    strukturelt ved at `softContribution` nå brukes i stedet for egen
    flagg-logikk.
  - **Én sannhet:** `environmentAt` flyttet fra `search.ts`/`evaluate.ts` til
    `expand.ts` og deles nå av søket, evaluatoren og sluttetappen.
  - **Ny ut-kontrakt:** `RouteResult.finalLeg` og
    `totals.violatesDaylightRequirement` (§4.8). Begge er med i
    golden-snapshotens `exact`-blokk, så de kan ikke drifte stille.
  - **Nye tester (+7, 190 grønt i `@morild/routing`):** «funn 2026-08-31»
    snudd til å pinne korrekt adferd + positiv motpart mot evaluatoren;
    R5-test med `beatTwaDeg ∈ {45, 60, 80}` på en sluttetappe med TWA 70,8°;
    tre R4-tester (brudd flagges / dagslys holder / kravet ikke satt); to nye
    golden-invarianter («hvert steg som flytter båten koster tid» og
    «`finalLeg.shortfallNm` = faktisk avstand til målet»).
  - **Golden-diff (regenerert, hver endring attributert).** Geometrien er
    uendret i alle sju; `natt-og-dagslysankomst` er den eneste med endret
    `nightS` (= endret varighet).

    | Fikstur | `finalLegStatus` | Diff | Forklaring |
    |---|---|---|---|
    | skjaeloy-skagen-apent | lagt-til | +57 s (beatS/motorS +57, fuelL +0,06 L) | 1,686 nm sluttetappe: **+52 s strøm** (SOG 5,82 kn mot BSP 6,12 kn — motstrøm som ikke ble regnet med før) **+5 s manøverstraff** (16,3° kursendring) |
    | bohuslan-trange-sund | lagt-til | +24 s | 1,843 nm: **+4 s** strøm/kurskorreksjon, **+20 s manøverstraff** (60,2°) |
    | natt-og-dagslysankomst | lagt-til | +26 s (durationS og nightS) | 1,850 nm, felt uten strøm ⇒ **hele diffen er manøverstraffen** (77,0° kursendring inn på sluttetappen) |
    | ren-kryssetappe | **avvist-fart** | distanse 49,06 → 47,41 nm (−1,652), steg 25 → 24, etapper 8 → 7, **durationS uendret (41 464 s)** | Selve E-funnet: den fjernede etappen kostet 0 s. At varigheten ikke endres er beviset på at etappen var gratis |
    | tss-ved-skagen | **avvist-farbarhet** | ingen tall endret | Etappen ble allerede avvist av TSS-regelen (fiks fra forrige sesjon) — nå er avvisningen synlig, 1,713 nm fra målet |
    | uoppnaelig-mal, hull-i-vaerfeltet | ikke-forsokt | ingen tall endret | `reached = false`; ingen sluttetappe forsøkes |

  - **Konsekvens som ikke skal skjules:** `ren-kryssetappe` og
    `tss-ved-skagen` rapporterer nå `reached: true` samtidig som ruten ender
    hhv. 1,65 og 1,71 nm fra målet. Det er ærligere enn før (da var stumpen
    enten gratis eller usynlig borte), men det betyr at UI **må** lese
    `finalLeg` og ikke anta at siste steg er målet.
- **2026-08-31 — E2-beslutningen inn i §7; ny §5.11 rute-evaluator;
  evaluatoren implementert.** Kilder:
  `docs/research/ekspertpanel-runde2-2026-08-31.md` §5–§7 og
  `docs/research/ekspertpanel-fysikk-2026-08-31.md`.
  - **§7:** Magnus' E2-beslutning skrevet inn — ytelsesmålet er § 7s < 5 s på
    nettbrett + progressiv tegning; < 1 s-målet er forkastet, tube/korridor er
    reserve. To rekkefølge-føringer notert: nettbrett-måling før ytelsesarbeid,
    evaluator før optimering av den varme løkka.
  - **§5.11 (ny):** evaluator-kontrakten — formål, én-sannhet-prinsippet,
    styr-mot-veipunkt-semantikken, tilstand som tres gjennom, harde sjekker
    re-kjørt, rapportering med posisjon/tid/årsak, renhet, og
    én-sannhet-egenskapstesten mot ukonsolidert stegsekvens. §8.3 fikk et
    tilsvarende punkt. Dette er *ikke* ADR-0005 og avgjør ikke E1′.
  - **Implementasjon:** `packages/routing/src/evaluate.ts` +
    `src/evaluate.test.ts` (21 tester). Én-sannhet-testen kjører over alle sju
    golden-fiksturene; målt avvik mot søkets egen kostnadsvektor er **0 s** på
    alle fire komponentene i alle sju (toleransen i testen er 2 s).
  - **Avvik fra spec-teksten, gjort bevisst under implementasjonen:**
    1. **Flat geometri i styringen.** §5.11 sier «samme flate approksimasjon
       som `stepLatLon`»; det er implementert som lokale hjelpefunksjoner
       `flatCourseDeg`/`flatDistanceNm` i `evaluate.ts`, ikke i
       `packages/geo`. Grunn: de er inversen av *motorens* stegmodell, ikke
       generell navigasjonsmatematikk. Flyttes til `geo` hvis flere pakker
       trenger dem.
    2. **`harbourEnds` lagt til i inn-kontrakten.** Kystbuffer-unntaket
       (§5.3 steg 13) gjelder anløp av havn, ikke enden av det ruteutsnittet
       man tilfeldigvis ba om. Uten dette ville evaluering av en delrute målt
       unntaket mot feil punkt.
    3. **`pointVerdict` re-kjøres også**, selv om §5.11 bare lister klaring,
       segment, TSS og dagslys. Søket gjør det (§5.3 steg 12), og
       én-sannhet-prinsippet veier tyngre enn listen.
  - **Funn (evaluatoren fant det, ikke et menneske): den direkte sluttetappen
    kan være useilbar.** `reconstruct.ts` (§5.8) legger på sluttetappen inn til
    målet med sin egen kinematikk — uten strøm, og uten å sjekke at båten kan
    gjøre fart på kursen. I golden-fiksturen «ren-kryssetappe» ligger målet
    rett mot vinden med motoren av, og den siste stumpen blir dermed *gratis*:
    `bspKn ≈ 0` gir `extraS = 0`, altså avstand uten tid i `totals`.
    `segmentVerdict` og TSS-regelen består, så ingen eksisterende sjekk fanget
    det. **Fikset i oppføringen «2026-08-31 (2)» over** — dette avsnittet står
    igjen som historikk for hvordan funnet ble gjort.
- **2026-08-30 — ADR-0004 godkjent; §9 avklart.** Magnus godkjente
  ADR-0004 (via strukturert spørsmål, alle punkter etter anbefaling).
  Spec-status endret fra utkast til gjeldende. §9 spm. 1, 2, 3, 5, 6, 8, 9,
  10, 11, 12 markert BESLUTTET; spm. 4 og 7 besluttet kalibrert empirisk i
  implementasjonen (golden-målinger), ikke låst på forhånd.
- **2026-08-30 — utkast v0.1.** Første versjon, skrevet mot
  `docs/decisions/ADR-0004-rutemetodikk.md` (status foreslått). Ingen kode
  skrives før ADR-en er godkjent. Grensesnittet mot farbarhetsmasken (§4.1)
  er formulert som et *behov* fordi `docs/specs/farbarhetsmaske.md` ennå ikke
  fantes da denne spec-en ble skrevet.
