# Spec: robusthet (fase 4a) — ensemble, robusthetstall, bail-out, presentasjon

> **Status: Vedtatt 2026-09-04 (Magnus: «anbefalinger besluttet», uten
> avvik)** — alle anbefalingene i §7 (D8.1–D8.13) gjelder som besluttet.
> Utkastet ble skrevet av hovedsesjonen etter fagagent-panel
> (`docs/research/ekspertpanel-4a-robusthet-2026-09-04.md`, to runder +
> tilsvar + votering). Kravspek-revisjonene (F3.5, F4.3, B3) er ført i
> `docs/00-kravspek.md` samme dag. Bølgeplan:
> `docs/research/fase4a-plan-2026-09-04.md`.

- Dato: 2026-09-04
- Fase: 4a (prosjektplanen §Fase 4)
- Pakker: ny `packages/robustness` (ren), `apps/pwa` (scheduler + UI),
  små kontraktendringer i `packages/routing` (§3.1)
- Eier av: F4.2-aggregeringen (ADR-0005 utpeker denne spec-en)
- Grunnlag: `docs/research/beslutningsgrunnlag-4a-robusthet-2026-09-04.md`,
  `docs/research/v1-innsikt-robusthet-2026-09-04.md`

---

## 1. Formål og kravsporing

Fase 3 leverte én rute på kontrollprognosen. Fase 4a gjør ensemblet til et
produkt: 30 MEPS-medlemmer + kontroll per avgang, aggregert til
robusthetstall Magnus kan ta en avgjørelse på i cockpit, med ærlig
merking av hva tallene dekker og ikke dekker.

| Krav | Dekkes slik |
|---|---|
| F4.1 | Ensemble per medlem med delt A\*-felt (§4.1); orkestrering i `packages/robustness` + `apps/pwa` |
| F4.2 | Gjennomførbarhetsandel, inkonklusiv-andel, verste/typisk seilingstid, terskeltellinger, spredning i kryss-/motorandel (§3.3, §4.2) |
| F4.3 | Perturbasjon av cruising-faktor og strøm på kontrollen, lav cruising på verste medlem (§4.4) |
| F4.4 | Trafikklys + én setning, plantid, beslutningsregel, vær-langs-ruten-bånd; statistikk bak trykk (§4.6) |
| F4.5 | Rangering etter robust ytelse med deterministisk tie-break; 1 t avgangsvindu (§4.3) |
| F4.6 | Havnebok, «lengste strekk uten brukbart alternativ», «tid til nærmeste bail-out» (§3.5, §4.5) |
| F3.5 | Progressiv beregning; kontroll først; **< 60 s som hypotese under ADR-0005 port 1/2** (§6) |
| N1, N2 | Ingen tall uten kilde og dekning; ærlig degradering (§4.7) |
| N5 | Testkrav (§5) |
| N6 | Minnemodell for 150–210 `RouteResult` (§6.2) |

Vedtatte rammer som arves uendret: ADR-0005 (mekanisme F; robusthetstall
kun fra fulle søk; inkonklusiv-kategori; horisont-port 20 %; R2-semantikk
med backoff i fysisk tid), `vaerpakker.md` §9 (30 medlemmer, 48 t
medlemshorisont), `rutemotor.md` §4.8/§5.5/§5.6/§5.11 (ut-kontrakt, delt
felt, progressivt API, evaluator), kravspek B3 (trafikklys + P90-plantid +
beslutningsregel — foreslått revidert i D8.11).

## 2. Avgrensning — hva denne spec-en bevisst IKKE dekker

- **Fase 4b:** geometrisk korridor-stabilitet, automatisk følsomste-
  faktor-attribusjon utover D8.5-regelen, regime-klynging, aldersvekting
  av lagget ensemble, format-kandidater (D7), full R2-fellefrihet i alle
  medlemmer, bredere/regimebetinget cruising-matrise.
- **Rutemotorens indre** (`packages/routing`): kun to kontraktendringer
  (§3.1); søkemekanikken røres ikke. Ytelsesspaker inne i motoren
  (profilsøk, betinget sektornøkling, alloc-fri hot-loop) spesifiseres
  ikke her — de prioriteres etter spak 7/8 (§6.3).
- **Motorforbruk-usikkerhet:** ikke modellert; drivstofftall vises med
  merke «ikke usikkerhetsberegnet» (D8.13).
- **Live-verifisering av beslutningsregelen** (F5): ikke i 4a; regelen
  sier «sjekk selv».
- **Havneboken som datainnsamling:** spec-en definerer skjema og gates;
  Magnus fyller boken over sesonger. Interim-listen i test-fixtures er
  aldri produksjonsdata.
- **Synk av havnebok/kvitteringer** (F6.1): skjemaet bærer `updatedAt` +
  enhets-ID, men synkmekanismen er fase 5.

## 3. Datamodell og kontrakter

Konvensjoner som overalt ellers: vind FRA, strøm MOT, tider i sekunder
(`epochS`), avstander i nm. Alt i `packages/robustness` er ren data +
rene funksjoner: ingen I/O, ingen klokke, ingen `Math.random`, ingen
`await`. Samme input → samme utdata, uavhengig av rekkefølgen resultater
ankommer i.

### 3.1 Endringer i `packages/routing` (krever oppdatering av rutemotor.md)

1. **`RouteResult.provenance: "planRoute" | "createSearch"`** — settes
   kun av de to inngangene. `packages/robustness` avviser (kaster) ethvert
   resultat uten dette feltet eller med annen verdi. Dette er
   ADR-0005s bekreftelseskrav gjort strukturelt, ikke bare
   import-basert (D8.8).
2. **`R2Config.backoffS`** erstatter `backoffSteps`: backoff i fysisk tid
   `min(Δt, 1800 s)` (ADR-0005). `backoffSteps` fjernes; ingen
   kompatibilitetslag.
3. **Soft bound-diagnose:** `RouteResult.diagnostics.pruned.bound` finnes
   allerede. Ingen ny motorendring — men §4.1 forbyr å klassifisere et
   medlem som ugjennomførbart når `pruned.bound > 0 && !reachesDestination`.

### 3.2 Medlemsutfall

```ts
type OutcomeKind = "feasible" | "infeasible" | "inconclusive" | "error";

interface MemberOutcome {
  readonly memberIndex: number;          // 0 = kontroll, 1..30 = medlemmer
  readonly kind: OutcomeKind;
  /** Redusert form beholdes for ALLE medlemmer (§6.2). */
  readonly summary: MemberSummary;
  /** Full RouteResult beholdes kun for medlemmer §6.2 navngir. */
  readonly full?: RouteResult;
  readonly error?: string;               // kind === "error"
}

interface MemberSummary {
  readonly durationS: number; readonly distanceNm: number;
  readonly beatS: number; readonly motorS: number; readonly nightS: number;
  readonly beatAtNightS: number; readonly fuelL: number;
  readonly arrivalEpochS: number; readonly daylightArrival: boolean;
  readonly flags: number;                // FLAG_* fra cost.ts, rute-nivå
  readonly safetyVerdict: "trygt" | "usikkert" | "usikker-rute";
  readonly coverageWeather: "full" | "partial";
  readonly prunedBound: number;          // for §4.1-ventilen
  /** Posisjon per hele time fra avgang, for viften og D8.5. */
  readonly hourlyTrack: readonly LatLon[];
}
```

Klassifisering (`classifyMember`, ren funksjon, erstatter dagens i
`apps/pwa/src/weather/ensemble.ts`):

| Vilkår | kind |
|---|---|
| `coverage.weather === "partial"` **eller** `abortReason === "noWeatherAtStart"`, og ikke `safety.reachesDestination` | `inconclusive`, grunn `dekning` (ADR-0005) |
| `coverage.weather === "partial"` og `safety.reachesDestination` (nådd målet, men et felt manglet — bølger/strøm) | `inconclusive`, grunn `dekning-felt` (D11.1, vedtatt 2026-09-05) |
| `pruned.bound > 0` og ikke `reachesDestination` | **ikke klassifiserbar** — søket kjøres om uten bound (§4.1), maks én gang per medlem (D9.4) |
| kastet/`abortReason` ∈ {labelCap, iterationCap, noExpandableLabels, outsideDomain} uten mål | `error` |
| `abortReason` ∈ {stagnation, callerStopped} uten mål | `inconclusive`, grunn `budsjett` (D9.2) |
| `safety.reachesDestination === true` | `feasible` |
| ellers | `infeasible` |

`MemberOutcome.inconclusiveReason: "dekning" | "budsjett" | "bound"`
(`bound` reservert for bølge 3s ensemble-budsjett). `MemberSummary`
bærer alltid `prunedBound` og `tubBoundS` (motorens egen horisont, `null`
når den grådige forhåndsruten ikke nådde målet) — rapportert som
*horisont*, ikke sertifikat (D9.3). Testvakt: intet medlem klassifiseres
`infeasible` med `pruned.bound > 0`.

**D11.1 (vedtatt 2026-09-05):** all `partial` dekning er inkonklusiv —
også når målet ble nådd (grunn `dekning-felt`): en andel regnet uten
bølgedata er en øvre skranke presentert som estimat. UI viser «k kom
fram på vind alene — bølger og strøm mangler i pakken». Skillet
horisont/manglende felt i motoren (D11.1 c) kommer når bølger/strøm er
i pakken. Regelen bor i `packages/robustness/src/outcome.ts`.

**Konsekvens for nevneren (bølge 3-avhengighet):** etter D9.2 er
`infeasible` nåbar kun via «ikke nådd, full dekning, ingen beskjæring,
ingen budsjett-/verktøystopp» — som motoren i praksis ikke produserer
(uttømt søk ender som `noExpandableLabels` ⇒ `error`). Inntil
`diagnostics.termination` (D9.2 b-full) gjør «uttømt uten tak, uten
bound, full dekning» til et positivt sertifikat for `infeasible`, må
trafikklyset (§4.2.3) vise «usikkert grunnlag» + antall avklarte i
stedet for andel når `nInc + nErr > 1/3` — nevneren kan ikke tolkes som
«andel gjennomførbare» før sertifikatet finnes.

*Rekkefølgen presisert 2026-09-04 (bølge 1) og D9.2 vedtatt 2026-09-05:* ventilen står **før**
`error`. Skademålingen (`packages/routing/src/shared-tub.damage.test.ts`)
viste at en for stram bound kan beskjære hele fronten slik at søket dør av
`noExpandableLabels` — tabellen bokstavelig lest ville stemplet det
«beregningen feilet» der bounden kuttet ruten. Omkjøring er den eneste
retningen som aldri lyver. `inconclusive` står likevel først: tok
værfeltet slutt, er svaret «ikke bevist» uansett bound. **Åpent (D9.2):**
motorens *egen* Tub (ADR-0004, alltid på utenfor `exactMode`) treffer
samme vilkår — i S-7 hadde 8 av 30 medlemmer `pruned.bound > 0` uten mål
også uten delt Tub, og motoren har ingen «ingen Tub»-bryter. **Vedtak
D9.2 (b-min):** ventilen er generisk (gjelder også motorens egen Tub);
`noTubBound`-opsjon, uttømmende `abortReason`-test og
`diagnostics.termination` kommer i bølge 3 (b-full).

Et `feasible`-medlem kan ha `safetyVerdict !== "trygt"`; det påvirker
ikke tellingen, men bæres videre til presentasjonen som flagg.

### 3.3 Avgangssammendrag (F4.2)

```ts
interface ThresholdSpec {
  readonly id: string;                   // "moerke", "tidsbudsjett", …
  readonly label: string;                // «framme før mørket»
  readonly passes: (m: MemberSummary) => boolean;
}

interface DepartureSummary {
  readonly departEpochS: number;
  readonly control: MemberOutcome;
  readonly members: readonly MemberOutcome[];   // sortert på memberIndex
  readonly complete: boolean;                   // alle 30 klassifisert
  readonly nF: number; readonly nInf: number;
  readonly nInc: number; readonly nErr: number;
  /** nF / (nF + nInf). Inkonklusive og feil er IKKE i nevneren. */
  readonly feasibleShare: number | null;        // null når nF + nInf === 0
  readonly inconclusiveShare: number;           // nInc / 30
  readonly horizonTooShort: boolean;            // inconclusiveShare > 0,20
  /** Seilingstid blant gjennomførbare, nærmeste-rang (§4.2). */
  readonly durationWorstS: number | null;       // maks — det VISTE tallet
  readonly durationP50S: number | null;
  readonly durationP90S: number | null;         // rangeringsnøkkel, ikke vist som «plantid»
  readonly beatShareP50: number | null;  readonly beatShareP90: number | null;
  readonly motorShareP50: number | null; readonly motorShareP90: number | null;
  readonly fuelWorstL: number | null;           // merkes «ikke usikkerhetsberegnet»
  readonly thresholds: readonly { id: string; k: number; n: number }[]; // k av n gjennomførbare består
  readonly light: TrafficLight;
  readonly certificate: Certificate | null;     // §4.2.3
  readonly stamp: RobustnessStamp;              // §3.6
}

interface TrafficLight {
  readonly color: "gronn" | "gul" | "rod" | "beregner";
  readonly reason: "andel" | "tid" | "inkonklusiv" | "tynt-utvalg" | "ingen-kontrollrute" | null;
  readonly kOfN: { k: number; n: number };      // vises rått, aldri prosent
  readonly provisionalThresholds: true;         // DA6-stempel
}
```

### 3.4 Perturbasjon og beslutningsregel

```ts
interface PerturbationRun {
  readonly kind: "cruising" | "current";
  readonly factor: number;               // 0,85 | 0,90 | 0,95 ; 0,8 | 1,2
  readonly basis: "kontroll" | "verste-medlem";
  readonly outcome: MemberOutcome;
}
interface SensitivityReport {
  readonly runs: readonly PerturbationRun[];
  /** Perturbasjoner påvirker ALDRI TrafficLight. Konflikt vises som egen linje. */
  readonly conflict: boolean;            // kontroll gjennomførbar, en perturbasjon ikke
  readonly mostSensitive: "cruising" | "current" | null;
  readonly label: "basert på kontrollvær";
}

interface DecisionRule {
  readonly checkEpochS: number;          // t*
  readonly position: LatLon;             // skillepunkt på kontrollruten
  readonly test: "nord" | "sor" | "ost" | "vest";   // «er du nord for punktet?»
  readonly explanation: string;          // vindsektor/-terskel i parentes
  readonly hitRate: { k: number; n: number };       // «skiller 28 av 30»
  readonly concordance: number;          // andel medlemmer enige om retning på skillet
  readonly action: string;               // «vent til …» / «revurder ruten»
}
type DecisionAdvice =
  | { readonly kind: "regel"; readonly rule: DecisionRule }
  | { readonly kind: "fallback"; readonly text: string };  // alltid kodet
```

### 3.5 Havnebok og bail-out

```ts
interface HarbourBookEntry extends BailoutHarbour {     // fra bailout.ts
  readonly id: string;
  /** null ⇒ havnen EKSKLUDERES fra R2 og flagges «mangler dybde». */
  readonly minDepthAtQuayM: DepthRef | null;
  readonly minDepthAtAnchorageM: DepthRef | null;
  /** Default false: ikke mørketrygt før Magnus sier det. */
  readonly nightApproachSafe: boolean;
  readonly updatedAt: number; readonly deviceId: string;   // F6.1 LWW
  readonly tideNote?: string; readonly notes?: string; readonly verified?: boolean;
}
interface DepthRef { readonly valueM: number; readonly source: string; readonly date: string }

/** Avkortet baklengs vannavstandsfelt fra én havn (D8.10). Væruavhengig;
 *  bygges én gang per (havn-id, maskeversjon, oppløsning); Float32,
 *  Infinity utenfor Vmax·R2_LIMIT_S. Deles på tvers av alle avganger og
 *  medlemmer som transferable ArrayBuffer. */
interface HarbourField { readonly harbourId: string; readonly maskVersion: string;
  readonly cellDeg: number; readonly bbox: BBox; readonly distanceNm: Float32Array; readonly vmaxKn: number }

interface BailoutSample {
  readonly epochS: number; readonly position: LatLon;
  readonly lowerBoundS: number;          // min_h D_h(p)·3600/Vmax
  readonly status: "ingen-innen-6t" | "naadd" | "ikke-anloepbar" | "ukjent";
  readonly harbourId: string | null; readonly timeToHarbourS: number | null;
  readonly gatesFailed: readonly ("dybde" | "moerke" | "vaer" | "mangler-dybde")[];
  readonly searched: boolean;            // fullt R2-søk faktisk kjørt
}
interface BailoutProfile {
  readonly samples: readonly BailoutSample[];
  readonly longestGapS: number | null;   // maks strekk uten «naadd», rundet OPP med ½ sampleintervall
  readonly coverage: "none" | "partial" | "full";   // tom bok / noen havner uten dybde / alle gates evaluert
  readonly basis: "kontrollvaer" | "medlemmer";      // 4a: alltid kontrollvaer
  readonly label: "kontrollvær — ikke ensemble-sjekket" | "maks over medlemmer";
  readonly sampleIntervalS: number; readonly limitS: number;
  /** Listen bak «partial» (§4.5 pkt. 4) og kostnadstall (§6.3) — lagt til i bølge 4. */
  readonly missingDepthHarbourIds: readonly string[]; readonly missingFieldHarbourIds: readonly string[];
  readonly searchCount: number; readonly fieldScreenedSamples: number;
}
```

### 3.6 Stempel og kvittering

```ts
interface RobustnessStamp {
  readonly maskVersion: string; readonly packageId: string; readonly packageInitEpochS: number;
  readonly memberAgesS: readonly number[];      // lagget ensemble
  readonly optionsHash: string;                 // RouteOptions + robusthetskonstanter
  readonly estimator: "naermeste-rang-v1";
  readonly thresholds: { gronn: 0.9; rod: 0.7; inkonklusiv: 0.2; konkordans: 0.75 };  // provisoriske
}

/** Skrives når Magnus faktisk seiler på en plan (D8.12). Fryses ved planlegging. */
interface PlanReceipt {
  readonly plannedAtEpochS: number; readonly departEpochS: number;
  readonly stamp: RobustnessStamp;
  readonly summary: Omit<DepartureSummary, "members" | "control">;
  readonly memberKinds: readonly OutcomeKind[]; readonly memberArrivalEpochS: readonly (number | null)[];
  readonly advice: DecisionAdvice; readonly bailout: Pick<BailoutProfile, "longestGapS" | "coverage" | "basis">;
  /** Fylles inn etterpå, aldri overskrives: faktisk ankomst eller avbrudd. */
  readonly realized?: { arrivalEpochS: number | null; aborted: boolean; note?: string };
}
```

## 4. Adferd

### 4.1 Ensemble-kjøring (F4.1, ADR-0005)

- **Ett medlem = ett fullt søk** via `planRoute`/`createSearch` med samme
  `RouteOptions` som kontrollen. Ingen annen inngang eksisterer for tall
  som ender i `DepartureSummary`.
- **Delt A\*-felt:** bygges én gang per (start, mål, maskeversjon,
  oppløsning) i hovedtråden eller en dedikert worker, sendes som
  transferable `ArrayBuffer`-kopi til hver pool-worker, og legges i
  `RouteInput.field` for alle medlemmer og alle avganger. Ingen
  `SharedArrayBuffer`.
- **Delt Tub (D8.2):** `tubBoundS` fra kontrollen kan gis til medlemmer
  kun som *soft* bound: et medlem som terminerer uten
  `reachesDestination` mens `pruned.bound > 0` er **ikke bevist
  ugjennomførbart** og kjøres om uten bound før det klassifiseres. Delt
  Tub slås ikke på i produksjon før skademålingen i §5.3 er grønn. Tub
  gis aldri til R2-søk.
- **Rekkefølge (progressivt, F3.5):** (1) kontroll for alle avganger i
  vinduet; (2) sertifikatsjekk (§4.2.3); (3) fullt ensemble for
  topp-avgangen etter kontrollrangering; (4) øvrige avganger etter
  kontrollrangering; (5) perturbasjoner for valgt avgang; (6)
  bail-out-profil for valgt avgang. Innen én avgang kjøres medlemmene
  **verste-først** etter et gratis orakel (A\*-feltets lengde ×
  medlemmets middelvind langs kontrollruten) — ikke skalarsøk.
  Rekkefølgen påvirker aldri tall, bare når sertifikater kan slå til.
- **Worker-pool:** `hardwareConcurrency − 1`, minimum 1, maksimum 6,
  til nettbrett-målingen sier noe annet. Lytterne registreres med
  `{ once: true }` per jobb (kjent lekkasje i dagens `runOnWorker`).
- **Kontrollen feiler:** `error` eller `inconclusive` på kontrollen
  stopper ikke ensemblet; UI viser «ingen kontrollrute å tegne» og
  bruker verste/typisk medlem som geometri for bånd og viften. Aldri
  rødt automatisk (kontrollen er ett av 31).

### 4.2 F4.2-tallene

**4.2.1 Persentiler.** Over de `nF` gjennomførbare medlemmene sortert på
`durationS`, deretter `memberIndex`: nærmeste-rang
`k = ⌈p · nF / 100⌉`, 1-indeksert, `P = x₍ₖ₎`. Ingen interpolasjon.
`durationWorstS = x₍ₙF₎`. Alle tre er `null` når `nF = 0`.

**4.2.2 Vist tall vs. nøkkel.** Det *viste* plantidstallet er
`durationWorstS` («regn med inntil») sammen med `durationP50S`
(«typisk»). Ordet «P90» og tallet `durationP90S` vises kun bak trykket.
Når `nF < 12` vises «verste av nF gjennomførbare» og flagget
`tynt-utvalg`. Der en terskel er definert (mørkeankomst er alltid
definert via `daylightArrival`; tidsbudsjett når Magnus har satt ett), er
**terskeltellingen primærsetningen**: «framme før mørket i k av n
utfall». P90/verste er sekundærlinje: «hvis forsinket: opptil X t».

**4.2.3 Trafikklys.** Beregnes kun når `complete` eller et sertifikat
foreligger; ellers `beregner` med `kOfN` = ferdige av 30.
Med `s = feasibleShare` og `t = min over terskler av k/n` (1 hvis ingen):

| Vilkår | color | reason |
|---|---|---|
| `nF + nInf === 0` (bare inkonklusive/feil) | gul | inkonklusiv |
| `inconclusiveShare > 0,2` | gul | inkonklusiv (horisont for kort) |
| `nF < 12` | gul | tynt-utvalg |
| `s ≥ 0,9` og `t ≥ 0,9` | grønn | — |
| `s < 0,7` | rød | andel |
| `s ≥ 0,7` og `s < 0,9` | gul | andel |
| `s ≥ 0,9` og `t < 0,9` | gul | tid |

*Presisering bølge 3 (review-funn, D11.4 — venter Magnus):* rødt
dominerer de gule radene: er `s < 0,7` blant de avgjorte, gis `rod/andel`
selv om horisont-, tynt-utvalg- eller usikkert-grunnlag-raden også
treffer — et varsel skal aldri mykes stille. Sertifikatet `rod/andel`
følger formelen `nInf > 0,3 · N` (sunt for `s` uansett resten); D10.4s
skranker (`j/N`, `(j + N − k)/N`) har en annen nevner og vises som
tellinger, ikke som sertifikat. `gul/tid`-taket trekker også fra `nErr`.

Tersklene 0,9/0,7/0,2 er **provisoriske, syntetisk kalibrert** og bærer
stempelet i `RobustnessStamp`; de remåles under ADR-0005 port 3. Ingen
hysterese. Prosent vises aldri; `kOfN` vises.

**Sertifikater (deterministiske, kun i advarselsretning):** før
`complete` kan `rod/andel` bevises når `nInf > 0,3 · 30`, og `gul/tid`
når antall gjennomførbare som bryter terskelen allerede er
`≥ nF_max − ⌈0,9 · nF_max⌉ + 1` for enhver mulig `nF_max ≤ 30 − nInf − nInc`.
Grønn kan aldri sertifiseres. Sertifikatet er et utsagn om det fulle
ensemblet, utledet fra en delmengde; tallene endres ikke. Sekvensiell
tidlig-stopp basert på konfidens finnes ikke (D8.7).

**4.2.4 Spredning i kryss/motor** — nærmeste-rang P50/P90 av
`beatS/durationS` og `motorS/durationS` over gjennomførbare.
`fuelWorstL = maks fuelL` merket «ikke usikkerhetsberegnet».

### 4.3 Rangering av avganger (F4.5)

`nF_max` = største `nF` i vinduet. Avganger med `nF ≥ nF_max − 2` er
**robust-settet** og rangeres på (`durationP90S` ↑, `feasibleShare` ↓,
`departEpochS` ↑). Øvrige avganger følger, rangert på (`feasibleShare` ↓,
`durationP90S` ↑, `departEpochS` ↑). Avganger uten `complete` rangeres
etter kontrollens `durationS` og merkes «foreløpig». Paret per-medlem-
differanse mellom to avganger vises bak trykket kun når
`|nF(A) − nF(B)| ≤ 2`, med `n_felles` oppgitt. Rangeringen er en total
ordning; to avganger med identisk nøkkel skilles av tidligste avgang.

### 4.4 Perturbasjon (F4.3, D8.4)

På valgt avgang, etter ensemblet: kontrollen kjøres med cruising-faktor
{0,85; 0,90; 0,95} og strømskalering {0,8; 1,2} (fem ekstra søk — tellingen
«4» i D8.4 var feil, rettet 2026-09-05), pluss
cruising 0,85 på **verste gjennomførbare medlem** (1 søk;
kommutasjonsargumentet: en tregere båt møter en annen værsekvens).
Resultatene vises som «følsomhet»-linje merket «basert på kontrollvær»
og påvirker aldri trafikklyset. `conflict = true` (kontroll
gjennomførbar, en perturbasjon ikke) gir varsellinjen «konfliktsignal —
se detaljer». Kravspekens ±0,05 (F4.3) revideres datert til dette
intervallet; v1-loggenes 0,86–1,21 noteres som kjent forenkling.

### 4.5 Bail-out (F4.6, D8.6, D8.10)

1. **Havnefelt:** for hver havn i boken bygges `HarbourField` ved
   maskeoppdatering eller første bruk: avkortet Dijkstra over
   farbarhetsmasken fra havnen, stopp ved `D > vmaxKn · R2_LIMIT_S/3600`.
   `vmaxKn` = båtens maks polarfart + maks strøm i pakken (øvre skranke
   over alle medlemmer). Feltet **siler kun i én retning**: `lowerBoundS
   > R2_LIMIT_S` beviser «ingen havn innen 6 t»; `≤` beviser ingenting.
2. **Sampling langs hele ruten** (ikke bare ved harde avvisninger):
   hvert 30. minutt langs den anbefalte rutens `steps`, pluss ved hvert
   segmentskifte. For hvert punkt: `lowerBoundS` fra feltene; er den
   `> R2_LIMIT_S` ⇒ `ingen-innen-6t` uten søk. Ellers kandidathavner i
   stigende `lowerBoundS`; for hver: gates **dybde** (null ⇒
   `mangler-dybde`, ekskludert), **mørke** (ankomst utenfor dagslys og
   `!nightApproachSafe` ⇒ `moerke`), deretter fullt R2-søk
   (`mode: "pareto"`, udelt maske, ingen Tub) + `harbourApproachable`
   med **kontrollvær** i 4a. Første `naadd` avslutter punktet.
3. **Tall:** `longestGapS` = lengste sammenhengende strekk (i rutetid)
   uten `naadd`, rundet opp med et halvt sampleintervall; «≥ 6 t» når
   ingen havn nås. Båndet (F4.4) tegner `timeToHarbourS` per sample.
4. **Dekning:** tom bok ⇒ `coverage: "none"` og teksten «havnebok
   mangler dekning her» — aldri «ingen brukbart alternativ». Noen havner
   ekskludert for manglende dybde ⇒ `"partial"` med liste.
5. **Basis:** 4a beregner alltid på kontrollvær, merket
   «kontrollvær — ikke ensemble-sjekket». Maks over medlemmer for valgt
   avgang er en egen bølge betinget av kostnadsmålingen (§6.3).
6. R2 er unntatt alle sertifikat-/rekkefølgemekanismer.

### 4.6 Beslutningsregel (F4.4, D8.5)

Beregnes for valgt avgang når `complete` og `nF ≥ 12` og `nInf ≥ 3`:

1. For hver hele time `h` etter avgang: posisjon per medlem fra
   `hourlyTrack` (gjennomførbare og ugjennomførbare; inkonklusive
   utelates). Projiser på tverretningen til kontrollrutens kurs ved `h`.
2. `t*` = første `h` der de to klassene skilles av en margin ≥ 2 nm
   (provisorisk) med **konkordans ≥ 0,75**: minst 75 % av medlemmene i
   hver klasse på «sin» side. Skillepunktet = kontrollrutens posisjon ved
   `t*`; `test` = siden de gjennomførbare ligger på.
3. **Leave-one-out:** regelen må gi samme `t*` (± 1 t) og samme side når
   hvert enkelt medlem utelates. Ellers fallback.
4. `explanation` = vindsektor/TWS-terskel som skiller klassene ved `t*`
   på skillepunktet, hvis en slik finnes med samme konkordans; ellers
   tom.
5. Tekst: «Sjekk selv kl. HH:MM ved [sted]: er du [nord] for [punkt]?
   (vinden har da dreid [SV]). Hvis ikke — [vent til neste vindu /
   revurder ruten]. Skiller k av n utfall.» Klokkeslettet er aldri
   eneste trigger; viften vises alltid ved siden av.
6. Fallback (alltid kodet): «Ingen enkelt sjekkpunkt skiller utfallene i
   dag — følg vindviften underveis og revider om vinden avviker fra
   kartet.»

Konkordans 0,75 og margin 2 nm er provisoriske (DA6) og skal testes mot
en støyfikstur (§5.5) før de brukes.

### 4.7 Presentasjon og ærlig degradering (F4.4, N2, D8.11)

Førstesiden per avgang, i denne rekkefølgen, ingenting av det bak trykk:

1. Trafikklys + én setning. Gul navngir alltid årsak. Under beregning:
   «Beregner (k av 30) …», aldri blank.
2. Plantid: terskelform når terskel finnes («Framme før mørket i 27 av
   30 utfall. Hvis forsinket: opptil 33 t.»), ellers pessimistisk par
   («Regn med inntil 33 t, typisk 27 t.»).
3. Beslutningsregel eller fallback (§4.6).
4. Fast linje: «Vindanslag (MEPS, 30 medlemmer) · bølge og strøm er ikke
   usikkerhetsberegnet».
5. Bail-out: «Lengste strekk uten trygg havn: X t» + `coverage` +
   «kontrollvær — ikke ensemble-sjekket».
6. Betinget varsellinje: «tynt utvalg (n gjennomførbare)»,
   «horisonten er for kort for denne seilasen», «konfliktsignal — se
   detaljer», «ingen kontrollrute å tegne».
7. Vær-langs-ruten-bånd: tidslinje med vindpiler/Hs fra kontrollen,
   ensemble-vifte (min, P10, P50, P90, maks av `hourlyTrack`) og
   bail-out-bånd.

Bak trykket: P50/P90, `nF/nInf/nInc/nErr`, medlemstabell, paret
differanse, kryss-/motorspredning, følsomhetslinje, drivstoff (merket),
aldersspenn for lagget ensemble, `RobustnessStamp`, kvitteringslogg.

| Situasjon | Vises |
|---|---|
| Pakke mangler / for gammel (`age.stale`) | ingen robusthetstall; kontrollrute merket «prognose N t gammel» |
| `coverage.weather = partial` på > 20 % | gul «horisont for kort»; andel alltid vist |
| `nErr > 0` | eget flagg «k medlemmer feilet i beregningen» — aldri i nevneren |
| `nF < 12` | «verste av nF» + `tynt-utvalg`; ordet P90 aldri |
| Kontrollen feiler | «ingen kontrollrute å tegne»; verste/typisk medlem som geometri |
| Havnebok tom / uten dybde | `coverage.bailout` none/partial med tekst; aldri «ingen alternativ» |
| Delt Tub avslått / redningsvei kjørt | ingen synlig forskjell — tallene er identiske per §4.1 |
| Perturbasjon mangler (tidsnød) | følsomhetslinje «ikke beregnet», aldri antatt |
| Progressiv: bare topp-avgang ferdig | øvrige rader «foreløpig (kontroll)» |

## 5. Testkrav (N5)

### 5.1 Arkitektur (`tools/arch-tests`, skrives først — D8.8)
- `packages/robustness` importerer kun `@morild/routing`, `@morild/geo`,
  `@morild/protocol`; aldri `variants.js`/`corridor.js`; ingen I/O.
- `apps/pwa` importerer ikke `variants.js`/`corridor.js`.
- Enhetstest: `summarize` kaster på `RouteResult` uten `provenance`.
- Enhetstest: medlem med `pruned.bound > 0 && !reachesDestination` kan
  ikke klassifiseres — funksjonen returnerer «kjør om».
- Enhetstest: bail-out-søk kalles alltid med `mode: "pareto"` og uten
  `tubBoundS`.

### 5.2 Determinisme og estimatorer
- Samme 31 `RouteResult` i vilkårlig ankomstrekkefølge ⇒ bit-identisk
  `DepartureSummary` (permutasjonstest over 20 tilfeldige, seedede
  rekkefølger).
- Nærmeste-rang mot håndregnede fasiter for `nF ∈ {1, 9, 10, 11, 12, 29, 30}`.
- Nevner: inkonklusive og feil endrer ikke `feasibleShare`.
- Trafikklys-tabellen (§4.2.3) rad for rad, inkl. `beregner` før
  `complete`.
- Sertifikat: monotont (aldri tilbakekalt når flere medlemmer kommer),
  aldri grønn, og lik endelig farge på alle S-1…S-8-fiksturer.
- Rangering: total ordning; tie-break på S-5s bit-like avganger.

### 5.3 Delt felt og Tub (skademåling, forhåndsregistrert)
S-3 og S-7, 30 medlemmer, (a) uten delt Tub, (b) med soft delt Tub +
redningsvei: **null** endring i klassifisering, bit-identiske
`MemberSummary`. Delt A\*-felt: bit-identiske resultater med og uten
`RouteInput.field`.

### 5.4 Rangeringsfikstur (D8.9, ADR-0005 pkt. 5)
Ny fikstur S-9 på S-7-generatoren: avgang A med 25 raske + 5 sene
medlemmer, avgang B med alle etter fronten. Forhåndsregistrert:
`argmin P50 = A`, `argmin P90 = B`. Aksept: rangeringen invariant under
leave-one-out for alle 30 medlemmer. Bygges **etter** at §4.2 er
implementert.

### 5.5 Beslutningsregel
- S-3: finner `t*` ved frontpassasjen med konkordans ≥ 0,75; LOO holder.
- Støyfikstur (S-1 med tilfeldig, seedet klassetildeling): regelen skal
  gi fallback i ≥ 95 % av 100 seedede kjøringer.
- Fallback-teksten finnes alltid; regel uten fallback er kompileringsfeil
  (typen `DecisionAdvice`).

### 5.6 Bail-out
- Golden `skjaeloy-skagen-apent` + interim-havneliste: profilen gir
  minst ett `naadd`-punkt (dagens R2 gir null på trygg rute).
- Tom havnebok ⇒ `coverage: "none"`, `longestGapS: null`.
- Havn uten dybde ⇒ ekskludert med `mangler-dybde`, `coverage: "partial"`.
- Mørke-gate: havn med `nightApproachSafe: false` forkastes ved ankomst
  utenfor dagslys.
- Feltet er admissibelt: for 200 seedede punkter er `lowerBoundS ≤`
  faktisk R2-tid der R2 lykkes (aldri over).
- `backoffS` = `min(Δt, 1800)` uavhengig av tidssteg.

### 5.7 Kvittering
- `PlanReceipt` skrives ved «seil på denne planen», er JSON-stabil og
  `realized` kan bare settes én gang.

## 6. Ytelses- og minnebudsjett

### 6.1 Kjente tall og status for løftet
| Størrelse | Verdi | Kilde |
|---|---|---|
| Fullt ensemble, én avgang, PC | 67–99 s | `maaling-e1` §7.4 (full oppløsning) |
| Spikens 1,3–8,4 s/avgang | **ugyldig** (12°) | ADR-0005 pkt. 4 |
| Nettbrett-faktor | 2–4× **antatt, umålt** | ADR-0005 port 1 |
| Anslag topp-avgang på nettbrett etter spak 1–6 | 68–200 s | panelet §3.3 |
| Bail-out uten havnefelt, 1 medlem | 4–12 min | panelet §3.3 |
| Bail-out med havnefelt, 1 medlem | < 40 R2-søk, anslått < 2 min | panelet §3.3 |
| A\*-felt Skjæløy→Skagen | ~0,2–0,3 MB | panelet §1.3 |

**F3.5s «< 60 s for topp-avgang» er en hypotese** til spak 7 (PC-remåling
av én avgang på full oppløsning med rigg på plass) og spak 8
(nettbrett-målingen, ADR-0005 port 1) er kjørt. UI lover ikke 60 s før
tallet finnes; progressiv semantikk («kontroll på sekunder, resten
strømmet») er UX-kontrakten uansett utfall.

### 6.2 Minne (N6, < 500 MB heap)
Full `RouteResult` beholdes kun for: kontroll, P50-, P90-, verste
medlem, og de fem viftemedlemmene per avgang (maks 9 × 5–8 avganger).
Alle andre reduseres til `MemberSummary` ved mottak i hovedtråden;
`hourlyTrack` er ≤ 48 punkter. Havnefelt: ~0,3 MB × antall havner, delt.
Arena-/buffergjenbruk i worker-poolen er et krav, ikke en spak.

### 6.3 Spaker og porter (rekkefølge vedtatt av panelet)
1. `{ once: true }`-fiks; 2. delt A\*-felt gjennom worker-meldingen; 3.
soft delt Tub etter skademåling; **7. PC-remåling av én avgang** (hard
exit for bølge 2 — viser den > 40–50 s, er nettbrett-tallet i praksis
avgjort); **8. nettbrett-måling** (port 1). Deretter, kun ved behov og
etter tallet: profilsøk over vinduet, alloc-fri hot-loop, delte
read-only-cacher, betinget sektornøkling. Vise-versa-porten (ADR-0005
port 2) utløser F12-remåling automatisk ved > 60 s etter tiltak.
Bail-out-kostnaden måles separat på én ekte 84 nm-rute med ekte
havnetetthet før per-medlem-bail-out vurderes.

**Status bølge 1 (2026-09-04/05):** spak 1 og 2 er inne (`apps/pwa`:
lyttere per jobb med `{ once: true }` + lekkasjetest; kontroll-workeren
bygger feltet med `buildFieldForInput` og sender `DistanceFieldData` til
medlemmene). **Spak 3 er målt og forkastet som ytelsestiltak** — den
forhåndsregistrerte skademålingen (§5.3, `shared-tub.damage.test.ts`):

| | S-3 | S-7 |
|---|---|---|
| kontrollens `tubBoundS` | 14,0 t | 22,1 t |
| klassifiseringsflipp m/soft delt Tub + redning | 0 | 0 |
| `MemberSummary` bit-identisk | ja | ja |
| redningsveier utløst | 1 | 14 |
| iterasjoner spart i 1. pass | 0,0 % | 0,0 % |
| totalt arbeid inkl. redning | +2,6 % | +59 % |

Sikkerhetskriteriet holdt, men bounden kjøper ingenting: motorens egen
Tub (ADR-0004) prunes allerede alt den delte bounden ville tatt, og
redningsveiene koster. Se D9.1.

## 7. Åpne spørsmål — beslutningspunkter til Magnus (D8.1–D8.13)

Format: alternativer, kort pro/contra, anbefaling, panelets votum.

**D8.1 Hvor bor robusthetslaget.** (a) ny ren `packages/robustness` +
tynn scheduler i `apps/pwa`; (b) alt i `apps/pwa`; (c) i
`packages/routing`. Pro (a): testbar, arkitekturtest kan bevise «kun
fulle søk»; contra: én pakke til. (b) er dagens tilstand, uspesifisert.
(c) bryter «motoren kjenner ikke ensemble». **Anbefaling: (a).** Panel:
enstemmig GODKJENN.

**D8.2 Delt A\*-felt og Tub.** Felt: koble inn i klienten (finnes i
API-et, brukes ikke). Tub: (a) delt fra kontrollen som hard bound —
sparer mest, men beviselig utrygt (falsk ugjennomførbarhet, lyver i to
retninger); (b) soft bound med redningsvei og skademåling før den slås
på; (c) ingen delt Tub. **Anbefaling: felt ja; Tub (b).** Panel:
enstemmig ENDRE til (b); aldri i R2.

**D8.3 F4.2-tallene.** (a) som grunnlaget: P90 som plantid, prosent,
0,9/0,7 på punktestimat; (b) §4.2: nærmeste-rang, feil ut av nevner,
*verste gjennomførbare + typisk* som vist tall, terskeltelling som
primærsetning der terskel finnes, rå k/N, ingen farge før endelig,
provisoriske terskler stemplet; (c) (b) + Wilson-grense på trafikklyset.
Pro (b): to uavhengige biaser (MEPS-underdispersjon, tynn P90) trekker
samme vei — P90 alene lover for mye; contra: mer tekst. (c) trukket av
matematikeren selv (krever 30/30 for grønt). **Anbefaling: (b).** Panel:
5 ENDRE i retning (b), 1 GODKJENN presisert.

**D8.4 Perturbasjon.** (a) kravspekens ±0,05 på kontrollen; (b) {0,85;
0,90; 0,95} + strøm ±20 % på kontrollen, 4 søk; (c) (b) + cruising 0,85
på verste gjennomførbare medlem, 5 søk; (d) alle medlemmer, 120 søk.
Pro (c): kommutasjonsargumentet, 1 søk ekstra; contra: én kodevei til.
(d) uforsvarlig kostnad. **Anbefaling: (c); F4.3 revideres datert.**
Panel: 3 for (c), 3 for (b); ingen for (a)/(d).

**D8.5 Beslutningsregel.** (a) vindsektor ved punkt (grunnlaget); (b)
geometrisk divergens av medlemsrutene som sjekk («er du nord for X kl.
HH:MM»), vind som forklaring, gates LOO + konkordans + treffrate i
teksten + fallback alltid; (c) ingen regel i 4a, bare viften. Pro (b):
GPS-sjekkbar uten værtolkning; contra: multippel-testing-fare, derfor
gates og støyfikstur. **Anbefaling: (b).** Panel: enstemmig ENDRE mot (b)
(to vil ha det som eksperiment ved siden av (a), tre som metode).

**D8.6 Bail-out-tall.** (a) kun `coverage.bailout` og «≥ 6 t/ukjent»
(pragmatiker); (b) §4.5: sampling langs hele ruten, havnefelt som
forfilter, dybde- og mørke-gate kodet fra dag én, kontrollvær merket,
`backoffS`; (c) (b) + maks over medlemmer for valgt avgang i 4a. Pro
(b): dagens R2 gir null på en trygg rute — (b) er bugfiksen; dybde uten
sjekk er D7.3-feilklassen. (c) betinget av kostnadsmåling. **Anbefaling:
(b), (c) som egen bølge etter måling.** Panel: 4 ENDRE/GODKJENN (b), 1
GODKJENN betinget havnefelt, pragmatiker (a) — bevart uenighet om
havnebok-felter; hovedsesjonen følger kartologen.

**D8.7 Ytelse og progressivitet.** (a) spakprioritering nå på ADR-ens
anslag; (b) rekkefølge 1→2→3→7→8 med spak 7 som hard exit før
nettbrett; sertifikater kun i advarselsretning; sekvensiell tidlig-stopp
avvist; (c) sekvensiell tidlig-stopp som konfidensregel. **Anbefaling:
(b).** Panel: enstemmig (b); (c) AVVIST av alle som voterte.

**D8.8 Arkitekturtest.** (a) import-grense; (b) (a) + `provenance` +
bound-ventil + pareto-krav for bail-out. **Anbefaling: (b), skrives
først.** Panel: enstemmig.

**D8.9 Rangeringsfikstur.** (a) full forhåndsregistrert protokoll
(jackknife, 6°/10°-invarians, ≥ 3×/5 %); (b) forhåndsregistrert
toppavgang + LOO-invariant rangering, bygd på S-7-generatoren, etter
D8.3. **Anbefaling: (b).** Panel: enstemmig ENDRE ned til (b).

**D8.10 Baklengs havnefelt** (lateral 1, nytt). (a) bygg avkortet felt
per havn som admissibel forfilter, siler kun i «ingen havn»-retning;
(b) uten felt — F4.6 koster 4–12 min per medlem og er ikke gjennomførbart.
**Anbefaling: (a), forutsetning for D8.6.** Panel: 4 GODKJENN, ingen mot.

**D8.11 B3 revideres** (kravspek §7, Magnus' beslutning 2026-08-30).
(a) B3 uendret; (b) format låst (trafikklys + én setning + regel), fire
obligatoriske vedheng: dekningslinje (MEPS; bølge/strøm ikke dekket),
`coverage.bailout` ved bail-out-tallet, kontrollvær-merke, betinget
varsellinje; «P90-plantid» erstattes av verste+typisk / terskeltelling.
**Anbefaling: (b).** Panel: værruting, kartolog, meteorolog for (b);
djevelens advokat ville revidert hardere.

**D8.12 Prognose-kvittering** (lateral 5, nytt). (a) `PlanReceipt` fra
dag én, reliability-analyse ved sesongslutt; (b) ikke nå. Pro (a):
eneste måte å etterprøve om tallene stemmer; billig. **Anbefaling: (a).**
Panel: 3 GODKJENN, ingen mot.

**D8.13 F3.5 og motorforbruk.** (a) F3.5s «< 60 s» omformuleres datert
til hypotese under ADR-0005 port 1/2 med progressiv semantikk som
kontrakt; drivstoff vises med «ikke usikkerhetsberegnet»-merke,
usikkerhet eget punkt senere. (b) la stå. **Anbefaling: (a).** Panel:
ytelse, matematiker, værruting for (a).

**Forbehold Magnus bør vite:** ytelsesingeniørens ærlige anslag er
P(< 60 s for én avgang på nettbrett etter spak 1–6) under 30 %. Spec-en
er skrevet slik at produktet er ærlig uansett utfall, men bølge 2 kan
ende med at F3.5 må revideres hardere enn D8.13.

**Bølge 1-funn (2026-09-05) — beslutningspunkter D9.1–D9.5. Vedtatt av
Magnus 2026-09-05 som anbefalt («anbefalinger besluttet»): D9.1 (a),
D9.2 (b-min) nå + (b-full) bølge 3, D9.3 (a) i bølge 3 med (b) først,
D9.4 (a), D9.5 (a).**
Panel: `docs/research/ekspertpanel-d9-delt-tub-2026-09-05.md` (to runder +
tilsvar; grunnlag i `beslutningsgrunnlag-d9-delt-tub-2026-09-05.md`).

**D9.1 Delt Tub etter skademålingen.** (a) Forkast delt Tub helt: ingen
`tubBoundS` i worker-meldingen (slik bølge 1 allerede er kodet);
`RouteInput.tubBoundS` beholdes i API-et for måling; skademålingen
beholdes som regresjonsvakt. (b) Behold bak flagg. (c) Slå på. Pro (a):
0 % spart beskjæring, egen Tub-beregning koster ikke målbart (S-3 20,6 s
vs 21,9 s, S-7 20,1 s vs 21,0 s for 10 medlemmer), bransjenorm (ingen
kryss-medlem-bounding i produksjonsprodukter). Contra (b): nødvei bak
flagg som aldri kjøres «på». **Anbefaling: (a).** Panel: enstemmig
GODKJENN (6/6); gjenåpningsutløser hvis delt felt forlates i produksjon.

**D9.2 Ventilens rekkevidde og klassifiseringshullet.** (a) Ventil kun
ved delt bound. (b-min) Ventilen forblir generisk (`pruned.bound > 0` og
ikke nådd ⇒ kjør om, tak 1 per medlem); `stagnation`, `callerStopped`
⇒ `inconclusive` med grunn «budsjett», `noWeatherAtStart` ⇒
`inconclusive` med grunn «dekning», `outsideDomain` ⇒ `error` — ingen
av dem er bevis på ugjennomførbarhet og skal ikke i nevneren som
`infeasible`; `prunedBound` og `tubBoundS` (som «søkets horisont», ikke
sertifikat) alltid i `MemberSummary`/kvittering; test-assert «intet
medlem klassifiseres `infeasible` med `pruned.bound > 0`». (b-full)
(b-min) + `noTubBound`-opsjon i motoren + uttømmende test per
`abortReason` + strukturert `diagnostics.termination` — bølge 3. (c)
Omkjøring via `exactMode`. Måling: i S-1…S-8 (210 søk) er alle 30
tilfeller av bound-beskjæring uten mål værhorisont (`partial`) — null
ville blitt `infeasible` i dag; hullet er strukturelt, ikke empirisk.
**Anbefaling: (b-min) nå, (b-full) i bølge 3.** Panel: (a) avvist av
4/6 som regresjon fra dagens generiske kode; (b-min) nå GODKJENN 5/6;
(c) AVVIS enstemmig. Dette endrer klassifisering (sikkerhetssemantikk)
— retningen er konservativ (færre `infeasible`, aldri flere `feasible`;
`feasibleShare`-nevneren krymper, andelen kan stige).

**D9.3 Motorens grådige Tub-rute er ikke skrankekomplett** (matematiker,
tilsvar): `computeTubBound` sjekker hard-node, maske og TSS, men ikke
klaringskorridor, dagslysankomst eller veipunkter ⇒ bounden kan ligge
under det skrankede optimum; 1,25-marginen er eneste vern. (a) Legg de
tre skrankene inn i den grådige ruten (flere avbrudd ⇒ oftere ingen
bound ⇒ mindre beskjæring; golden-ruter kan flytte seg og må
re-verifiseres). (b) Behold, men mål gapet: rapporter maxₘ T\*ₘ /
tubBoundS over fiksturene og på ekte vær. (c) Ignorer. **Anbefaling:
(a) i bølge 3, med (b) som forhåndsregistrert måling først** (endring i
ADR-0004-motoren; Magnus eier sikkerhetssemantikken). Panel: reist i
tilsvar, ikke votert separat.

**D9.4 Rerun-tak.** (a) Per medlem = 1 (omkjøring uten bound er
maksimalsøket; idempotent) nå; ensemble-budsjett («samlet omkjøringstid
≤ 50 % av førstepasset» eller «> 25–30 % omkjøringer ⇒ stopp og merk
resten `inconclusive` grunn budsjett») i bølge 3 sammen med
`ikkeAvgjort`-grunnen. (b) Ensemble-tak nå. **Anbefaling: (a)** —
omkjøring trigges under D9.1 (a) kun av egen Tub, som i dag aldri skjer
i fikstursuiten. Panel: uenig om form (matematiker: per medlem +
budsjett; ytelse: ensemble-andel; værruting: via `ikkeAvgjort`).

**D9.5 Skademålingens plass i testsuiten.** (a) Egen `pnpm test:damage`
(kjøres av `/qa` når `packages/routing/src/search.ts` eller
`packages/robustness` er endret, og i CI nattlig/ved PR), ut av standard
`pnpm test` (sparer ~170 s per kjøring). (b) Behold i standard. (c)
Slett. **Anbefaling: (a).** Panel: ytelse + pragmatiker GODKJENN;
matematiker «vakt beholdes» (oppfylt av (a)).

**Bølge 2-funn (2026-09-05, spak 7) — beslutningspunkter D10.1–D10.6.
Vedtatt av Magnus 2026-09-05 som anbefalt («anbefalinger besluttet»):
D10.1 (a), D10.2 (b), D10.3 (a), D10.4 (a) bølge 3, D10.5 (a) bølge 3,
D10.6 (a) eget spor etter nettbrett-tallet.** Panel: `docs/research/ekspertpanel-d10-f35-etter-spak7-2026-09-05.md`
(grunnlag `beslutningsgrunnlag-d10-f35-etter-spak7-2026-09-05.md`, rådata
`maaling-spak7-2026-09-05.md`). PC, full oppløsning 6°/1800 s, delt felt:
kontroll 3,3–3,7 s; 30 medlemmer sekvensielt 79–87 s (median 2,4–3,3 s
per medlem, ~170 k etiketter); pool-anslag 16–23 s med 5–6 workere, 28–36 s
med 3. Nettbrett-faktor umålt. Dekoding per medlem 32 ms (1 %).

**D10.1 F3.5 etter spak 7.** (a) Progressiv semantikk er kontrakten;
«< 60 s for topp-avgang» strykes som løfte, målt tid vises i UI; ingen
nye spaker før nettbrett-tallet. (b) (a) + spak 4–6 nå. (c) 15 av 30
medlemmer først. (d) F12 grov modus. **Anbefaling: (a).** Panel: (a)
enstemmig; (b) godkjent i runde 1 av alle tre eksperter og trukket av
alle tre i tilsvar (port 1, 3–5 dager for 1,2–1,8×) — etter bølge 3–5
og betinget av tallet; (c) avvist (produserer et tall §4.2.3 forbyr;
nevner-endring uten kalibrering); (d) avvist (ADR-0005 pkt. 4).
Kontrakt (til F3.5): «Kontrollruten for alle avganger på sekunder;
robusthetstallene bygges utelukkende fra fulle søk mens du ser på —
hvert tall er enten endelig (30 av 30) eller vist som tellinger med
eksakte skranker; advarsler kan bli endelige før alle er ferdige, grønt
aldri; appen lover ingen ferdig-tid.»

**D10.2 Nettbrett-målingen (ADR-0005 port 1).** (a) Avlesning av
panelet (kontrolltid, ensemble-veggklokke). (b) (a) + kopierbar JSON:
`hardwareConcurrency`, brukt pool, minne der det finnes, per medlem
`memberIndex`, søketid, dekodetid, etiketter, iterasjoner, orakelrang og
realisert `durationS`, Periodic Background Sync-støtte; tre kjøringer.
(c) Egen målingsside. **Anbefaling: (b).** Panel: enstemmig.

**D10.3 Vise-versa-porten (ADR-0005 port 2).** (a) Beholdes; utløses
først når nettbrett-tallet foreligger og > 60 s etter tiltak;
utfallsmengden omskrives: F12 ut, «gjenåpne F3.5-semantikk /
medlemshorisont / avgangsvindu» inn. (b) Utløses nå på PC-anslaget. (c)
Slettes. **Anbefaling: (a).** Panel: enstemmig (matematiker: «en
falsifiseringsport slettes ikke fordi vi tror vi vet svaret»).

**D10.4 Eksakte skranker i UI (utvidelse av §4.2.3, bølge 3).** Etter k
ferdige med j gjennomførbare og m ugjennomførbare: `s_min = j/30`,
`s_max = (j + 30 − k)/30`; vis «k av 30 — j har gått, m kom ikke fram,
resten ukjent»; trafikklys kun ved skrankekryss (`s_max < 0,7` ⇒ rød,
terskeltelling ⇒ gul), grønn aldri før 30, aldri sd, aldri prosent.
(a) Vedta som §4.2.3-tekst. (b) Løpende punktestimat ± sd. (c) Kun
«k av 30». **Anbefaling: (a).** Panel: matematiker + værruting for (a);
(b) avvist (skjevt utvalg under verste-først); (c) utilstrekkelig
(brukbarhetsgulv, djevelens advokat).

**D10.5 S1b-evaluatoren som pool-orakel (§4.1 verste-først).** (a)
Erstatt «A\*-feltets lengde × middelvind» med S1b-evaluert kontrollrute
per medlem (predikert `durationS`, tidlig ugjennomførbarhetssignal),
kun rekkefølge, aldri vist som tall; permutasjonstest dekker
orakelbytte; orakelrang logges så treffsikkerheten faller ut av
D10.2-JSON-en. (b) Behold dagens orakel. **Anbefaling: (a), bølge 3.**
Panel: 4 for, ingen mot (ADR-0005s τ-klausul: rekkefølge er lovlig).

**D10.6 Bakgrunnsberegning ved lading (eget spor, etter tallet).** (a)
Når pakken lander OG enheten lader: kjør ensemblet for lagrede
strekk/vindu, inputs-hash-invalidering (maske-/pakkeversjon, båt,
vindu), vist som «beregnet i natt kl HH:MM — pakke X t gammel»; beste
innsats (Periodic Background Sync er Chrome/TWA-spesifikk). (b) Ikke
nå. **Anbefaling: (a) som eget spor etter nettbrett-tallet,
spec-utkast i fase 4b.** MET-vilkår berøres ikke (lokal CPU, ikke poll).
Avvist av panelet: felles stamme (< 2 % gevinst, førsteordens
korrekthetsrisiko), server-side A\*-felt (20–30 ms), «verste 10 av 30».

**Bølge 3-funn (2026-09-05) — beslutningspunkter D11.1–D11.4. Vedtatt av
Magnus 2026-09-05 som anbefalt: D11.1 (a) nå + (c) når bølger/strøm er i
pakken, D11.2 (a), D11.3 (a), D11.4 (a) m/reason-splitt. Panel:
`docs/research/ekspertpanel-d11-boelge3-2026-09-05.md`.**

**D11.1 «partial + nådd mål».** (a) ADR-0005-lesningen: all `partial`
dekning ⇒ inkonklusiv (grunn «dekning»), uansett mål — vind-only-pakker
gir 100 % inkonklusivt til bølge/strøm er i pakken; (b) §3.2-tabellen
bokstavelig: nådd mål ⇒ feasible, forbeholdet bæres av rutens flagg
(`VAERDEKNING_BEGRENSET`, `SJOEGANG_DATA_MANGLER`, usikkert-gulv); (c)
skille de to «partial»-årsakene i motoren (horisont vs manglende felt):
horisont ⇒ inkonklusiv, manglende felt ⇒ feasible med flagg.
**Anbefaling: (a) nå, (c) når strøm/bølger er i pakken** (fase 3-rest) —
en gjennomførbarhetsandel regnet uten bølgedata er ikke et
robusthetstall for en seilbåt (panel: øvre skranke presentert som
estimat; skjevheten størst i sterkvindsmedlemmene, forvrenger også
rangeringen). Implementert med `inconclusiveReason: "dekning-felt"` og
UI-tekst «k kom fram på vind alene — bølger og strøm mangler i pakken»
(værruting-utviklerens (c)-tekst uten å røre nevneren).

**D11.2 Skal R2/bail-out sette `noTubBound: true`?** `r2SearchInput`
nekter delt Tub og felt, men motoren regner egen bound i re-søket, og R2
har ingen ventil/omkjøring. (a) Ja — bail-out-søk kjører alltid uten
Tub-bound (dyrere, men «kan du komme deg i havn» skal aldri beskjæres av
et anslag). (b) Nei, behold egen bound (gapmålingen: aldri > 1,25).
**Anbefaling: (a)** — panel enstemmig; djevelens advokat: midlertidig
sikkerhetsdefault til havnefeltet (D8.10) gjør bail-out billig nok til
å kjøres alltid. Én linje i `r2SearchInput` når vedtatt.

**D11.3 `tubMarginFrac = 0,25` mot målt maks-gap 1,036** (~7× slakk).
(a) La stå til ekte-data-porten (ADR-0005 port 3). (b) Stram til 0,10
etter måling på ekte fliser. **Anbefaling: (a)** — panel enstemmig.
Kriterier før stramming (matematiker): sluttetappen (reachRadius) inn i
bounden; gapet målt mot `noTubBound`-referanse for alle medlemmer; maks
ratio < 1,05 med korteste etappe ≤ 3 t i settet (2,4 % absolutt tid
skalerer 1/T — 0,10 brytes av enhver etappe under ~3,3 t).

**D11.4 Rødt dominerer gule rader i §4.2.3** (review-funn bølge 3: et
rødt sertifikat underveis kunne ende som gult/tynt-utvalg ved
`complete`). (a) Rekkefølgen presisert som i §4.2.3 (rød før horisont/
tynt-utvalg/usikkert-grunnlag), sertifikat = `nInf > 0,3·N`. (b) Behold
tabellen bokstavelig og stram sertifikatet til å bevise «ingen gul rad
kan treffe» (i praksis aldri rødt før complete). **Anbefaling: (a)** —
implementert som konservativ presisering med panelets ENDRE: ny reason
`rod/tynt-grunnlag` når `nF + nInf < 12` eller `nInc + nErr > N/3`
(fargen mykes aldri, begrunnelsen påstår ingen andel materialet ikke
bærer); død `s < 0,7`-rad etter gul-radene fjernet; sertifikatets
forutsetning «ingen omklassifisering fra infeasible» (omkjøringen ferdig
før telling) står i §4.1. Bekreftes.

**Bølge 4-funn (2026-09-05) — beslutningspunkter D12.1–D12.5, til
Magnus.** Grunnlag `docs/research/beslutningsgrunnlag-d12-boelge4-2026-09-05.md`,
panel `ekspertpanel-d12-boelge4-2026-09-05.md`. Kostnadsmåling: 32
samples, 33 R2-søk, 3,3 s per profil på golden (PC); admissibilitet 200
punkter 0 brudd.

**D12.1 Bail-out over medlemmer (bølge 6, D8.6 c).** (a) Alle
gjennomførbare medlemmer, «maks over medlemmer». (b) Kun kontrollvær.
(c) Tre profiler: kontroll + de to medlemmene med størst *feltgap*
(billig forsortering på havnefeltets nedre skranke langs hvert medlems
`hourlyTrack`, ingen R2-søk), vist som «verste testede værutfall: inntil
X t fra havn (kontrollvær: Y t)». **Anbefaling: (c), spec nå,
implementasjon i bølge 6 etter nettbrett-tallet.** Panel: (c) enstemmig;
djevelens advokat: rang på gap, ikke seilingstid (tatt inn).

**D12.2 `BoatModel.draughtM`/`depthClearanceM`.** (a) Obligatoriske
(typefeil å utelate), verdien satt eksplisitt ett sted (`test-boat.ts`:
Morild 2,6 m + klaring) og arvet av `packages/polar`s fabrikk fra typen.
(b) Valgfrie med 2,6 m-fallback. **Anbefaling: (a).** Panel: alle for
(a); djevelens advokat: kun med eksplisitt fabrikkverdi (tatt inn).

**D12.3 Dybdegaten.** (a) Behold `min(kai, ankring)` — konservativt
(færre havner godtas, aldri kortere strekk vist), dokumentert som kjent
begrensning. (b) `max` når kaia er verifisert. (c) Gate per anløpstype
(kai/ankring) med `nightApproachSafe` per type. **Anbefaling: (a) nå,
(c) som eksplisitt gjenåpning av 4a-kuttet «havnebok-felter» i fase 4b.**
Panel: kartolog + værruting (c); pragmatiker utsett; djevelens advokat
(c) kun som eksplisitt gjenåpning.

**D12.4 Perturbasjonsfasen.** (a) Seks søk sekvensielt på én worker. (b)
Over poolen parallelt. (c) Tre søk. **Anbefaling: (b).** Panel: 4 av 5
(b). I tillegg (ytelsesingeniør): bail-out-profilen gates til valgt
avgang når avgangsvinduet (F4.5) kommer — i dag én avgang.

**D12.5 `departEpochS` i `MemberSummary`.** (a) Legg til (ren
bokføring; `checkEpochS` utledes i dag fra ankomst − varighet). (b)
Behold. **Anbefaling: (a).** Panel enstemmig.

## 8. Endringslogg

- 2026-09-04: første utkast (hovedsesjonen) etter fagagent-panel med to
  runder og tilsvar. Samme dag: **D8.1–D8.13 vedtatt av Magnus som
  anbefalt** — status Vedtatt. Anbefalingene i §7 er dermed
  beslutningene; alternativene står som historikk.
- 2026-09-05: bølge 1 levert — `provenance`/`backoffS`/`buildFieldForInput`
  i routing (rutemotor.md), `packages/robustness`-skjelett, arkitekturtest
  D8.8, once-fiks + delt felt i PWA. §3.2-rekkefølge presisert (ventil
  før error). §6.3: skademålingens tall, spak 3 forkastet som
  ytelsestiltak. Beslutningspunkter D9.1–D9.5 (§7) etter panel.
- 2026-09-05: **D9.1–D9.5 vedtatt** som anbefalt. Gjennomført samme dag:
  §3.2-tabellen revidert (stagnation/callerStopped ⇒ inconclusive
  «budsjett», noWeatherAtStart ⇒ inconclusive «dekning», outsideDomain ⇒
  error; `inconclusiveReason`, `tubBoundS` i `MemberSummary`; testvakt
  mot infeasible m/beskjæring); skademålingen flyttet til
  `pnpm test:damage` (egen CI-jobb, betinget i `/qa`). Bølge 3 arver
  D9.2 (b-full), D9.3 (a) etter måling, D9.4 ensemble-budsjett.
- 2026-09-05: bølge 2 spak 7 målt (`maaling-spak7-2026-09-05.md`);
  §7 D10.1–D10.6 etter panel. **Vedtatt samme dag.** Gjennomført: D10.2
  (b) — `apps/pwa/src/weather/measurement.ts`, worker-timing (dekode/
  felt/søk), kopierbar JSON i panelet; kravspek F3.5 revidert (D10.1).
  Bølge 3 arver D10.4 (eksakte skranker, §4.2.3) og D10.5 (S1b-orakel,
  §4.1); D10.6 til fase 4b-spec.
- 2026-09-05: **bølge 3 levert.** Routing: `noTubBound`,
  `diagnostics.termination`, skrankekomplett Tub-rute (D9.3 a) etter
  forhåndsregistrert gapmåling (`tub-gap.damage.test.ts`: aldri > 1,25;
  S-7s omkjøringskostnad falt +59 % → +17 %). Robustness: §4.2.1
  estimatorer, §4.2.3 trafikklys/sertifikater + D10.4-skranker, §4.3
  rangering, D9.4 `nextAction`, S-9-fikstur (argmin P50 = A, argmin P90
  = B, LOO-invariant). App: klassifisering via robustness med omkjøring
  uten Tub, D10.5-orakel (S1b i worker), stempel/`EnsembleContext`,
  `renderDepartureText`. D11.1–D11.4 vedtatt samme dag og gjennomført:
  «partial + nådd mål» ⇒ inkonklusiv `dekning-felt` i robustness (ikke
  app-overstyring), `r2SearchInput` setter `noTubBound: true` (D11.2),
  `rod/tynt-grunnlag` (D11.4); D11.3-kriterier i §7.
- 2026-09-05: **bølge 4 levert.** Routing: havnebok m/gates (dybde,
  mørke, vær), avkortet baklengs havnefelt (D8.10, admissibilitet 200
  punkter 0 brudd, `harbourFieldVmaxKn` = `r2VmaxKn` + 0,3 kn), `bailoutProfile`
  (§4.5), kostnadsmåling: 32 samples, 33 R2-søk, 3,3 s på golden 85 nm.
  Robustness: `deriveDecisionRule` (§4.6, LOO, støyfikstur 100 % fallback),
  `perturbationPlan`/`summarizeSensitivity` (§4.4; fem + én søk — «4»
  rettet), `withCruisingFactor`/`withCurrentScale`. App: bail-out-profil
  på kontrollen (interim-havnebok, merket FIKSTUR i UI), perturbasjonsfase
  etter ensemblet, beslutningsregel og følsomhet i panelet. Review: 4
  funn fikset (vmax-margin, fikstur-merking, prosent, dypgang i wrapper).
  Åpent: D12.1–D12.5 (§7, panel).
