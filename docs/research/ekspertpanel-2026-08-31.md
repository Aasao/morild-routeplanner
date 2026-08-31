# Ekspertpanel 2026-08-31 — fire uavhengige vurderinger av fase 1/2-funnene

- Dato: 2026-08-31
- Status: ferdig — grunnlag for Magnus' beslutninger (ytelse vs. Pareto,
  `Grunne`-semantikk, åpne-kurver-hullet)
- Metode: fire uavhengige agenter med hver sin faglige rolle — professor i
  multiobjektiv stioptimering, produksjonsutvikler værruting (PredictWind-
  type), ytelsesingeniør storskala ruting (Google Maps-type), erfaren
  marinkartolog. **Dette er simulerte fagperspektiver, ikke reelle personer**
  — verdien ligger i at hver leste beslutningsgrunnlaget (byggstatus,
  ADR-0004, spec-ene, faktisk kode) uavhengig og fra sitt ståsted.
  Hovedsesjonens syntese og vekting står nederst.

## 1. Matematikkprofessor (multiobjektiv korteste vei)

**Hovedfunn: dette er trolig ikke en Pareto-eksplosjon.** 170k/15k ≈ 11×,
men sektornøkkelen alene gir ×9 — gjennomsnittlig Pareto-front per tilstand
er ~1,2–1,5 etiketter. Tidsdimensjonen diskriminerer knapt i
isokronformuleringen (tS vokser i låst takt), og beat/motor/natt er
korrelert med tid på døgnet → fronten er degenerert mot 2–3 effektive
dimensjoner. **Må verifiseres empirisk** (histogram over antikjedestørrelse
per tilstand) før spak velges.

Vurdering av spakene:
- **maxLabelsPerCell 6→4: frarådes.** Ikke-monotonien på ren kryssetappe er
  alvorlig — kryssruter er nettopp der flere sektorer per celle *må*
  sameksistere; hele avvik 1+3 i ADR-0004 ble kjøpt for dette.
- **Måldominans-pruning (NAMOA*-stil): tapsfri.** Forkast etiketter der
  `(tS + lb_tid, beatS, motorS, nightS)` domineres av en måletikett;
  generaliserer Tub-bounden fra 1 til 4 dimensjoner, lb finnes alt i
  A*-feltet.
- **Betinget sektornøkling:** sektor som nøkkel kun ved bidevind
  (`tack ≠ 0`); ellers kollaps. Feil skrankebar (≤ manøverledd per steg),
  angriper ×9 direkte. Verifiseres mot golden-kryssetappen.
- **ε-dominans/kvantisering** av myke dimensjoner (f.eks. 300 s-grid) ved
  akkumulering: deterministisk, skrankebar feil. Vilkåret i rutemotor-spec
  §9 spm. 3 («målt etikett-eksplosjon») er nå oppfylt — Magnus' beslutning.
- **Bidireksjonalitet: frarådes** (tidsavhengige kostnader).
- **Færre sektorer globalt / grovere cellDeg globalt: frarådes** (usmålbar
  suboptimalitet / skjærgårdskvalitet).

**Om ensemblet — metodisk kjernepoeng:** robusthet av en *plan* måles ved å
**evaluere en fast kandidatrute under hvert medlems værfelt** (ren
simulering langs ruten, millisekunder) — ikke ved re-optimering per medlem.
Re-optimering måler noe annet (adaptiv oppnåelig ytelse). Skalar
re-optimering per medlem gir tre skjevheter: optima trekkes mot søkevektene
(spredning underestimeres), Pareto-alternativene får ingen
robusthetsvurdering, og skalar utkasting er målt ikke-monoton → støy i
gjennomførbarhetsandelen. **Best: Pareto-kontroll + fast-rute-evaluering
per medlem**, ev. supplert med én skalar re-optimering per medlem som
regret-diagnostikk.

Usikkerhet flagget: degenereringshypotesen er utledet, ikke målt; tallene
er fra ett slør-strekk; skjærgård kan avvike.

## 2. Produksjonsutvikler værruting (PredictWind-type)

- **Ingen kommersiell ruter kjører Pareto per ensemble-medlem.**
  PredictWind/Expedition/qtVlm er skalare isokronmotorer per kjøring;
  ensemble = N skalare kjøringer + spredningsvisning på toppen. Flermåls-
  Pareto lever i akademia, ikke i produksjon. (Antagelse flagget:
  PredictWinds interne detaljer er ikke offentlige, men produkt-outputen er
  konsistent med dette.)
- **Ensemblets jobb er statistikk over 30 tall**, ikke 30 perfekte ruter.
  Systematisk motorbias (få prosent, korrelert på tvers av medlemmer)
  kanselleres i spredning/rangering. Det som IKKE tåles er *ulik*
  degradering per medlem — medlemmer som treffer labelCap/stagnasjon
  forurenser gjennomførbarhetsandelen med algoritmiske artefakter. Hardt
  prunet Pareto er her *farligere* enn jevn skalar/evaluering.
- **<1 s-målet er strengere enn noe reelt bruksscenario.** Spec §7s eget
  budsjett er <5 s på nettbrett; bransjebrukere venter rutinemessig
  10–60 s. Progressiv tegning av isokronfronter kjøper mer opplevd
  hastighet enn halvering av totaltid. Erfaringstall: 2–5 s til første
  kontrollrute, <60 s til full robusthetsanalyse strømmet per avgang.
- Anbefaler valideringsmåling før låsing: kjør 30 medlemmer begge veier på
  PC én gang; er P50/P90 og avgangsrangering stabile innenfor
  N5-toleransen, er saken empirisk lukket.
- ADR-0004 trenger datert tillegg/ADR-0005: Pareto-ambisjonen gjelder
  kontroll/presentasjonslaget, ikke ensemblegrunnlaget. Medlem-aborter
  telles separat i gjennomførbarhetsandelen (N2).

## 3. Ytelsesingeniør (Google Maps-type)

Konstant-faktor-funn i faktisk kode (packages/routing/src):
1. **Objektallokering per kandidat i hot-loopen** (største samlepost):
   StepKinematics + LatLon (expand.ts:137–146), SoftContribution
   (expand.ts:191), ny CostVector (expand.ts:169), distancesToEnds-closure
   allokert selv når ubrukt (search.ts:659), LabelInit-literal
   (search.ts:709). ~10M kandidater × 5–8 objekter → GC-trykk trolig gjemt
   i den «flate» profilen. **GC-andel er ikke målt — mål først.**
2. **Feilmeldingsstrenger ingen leser:** reject() bygger template-strenger
   m/toFixed (expand.ts:70–77, 283–288); søket sjekker kun `.ok`.
3. **InsertOutcome-objekt per kall** (label-store.ts:130–240) → heltall.
4. **costOf() allokerer i evict-veiene** (label-store.ts:200, 253, 269,
   333) og costScore regnes på nytt — legg `score: Float64Array` i arena.
5. activeInCell-spread per sjekk; dobbel dominans-skann
   (search.ts:735 + label-store.ts:136); tre Map-er → flat slot-tabell;
   arena/Map gjenskapes per kjøring (gjenbruk + clear() for ensemble).

Vurdering: **konstant-faktor alene gir 1,5–2,5× (anslag) — ikke <1 s.**
Strukturelt (færre kandidater) er den reelle spaken. WASM egner seg godt
(2–4× + jitter-fritt) men **sist**, og krever datadrevet ChartSource-
adapter (typed arrays, ikke callbacks) — ellers spises gevinsten av
grensekryssinger.

Ensemble-deling: delt A*-felt/Tub finnes alt i API-et — verifiser at
orkestratoren bruker dem; løft clearanceCache (search.ts:119) fra
per-kjøring til delt; **prekomputert fareavstandsfelt** (distance
transform, bygget i skyen per F1.0) gjør åpent-vann-segmenter til ett
array-oppslag for alle 30 medlemmer — konservativt, semantikk uendret;
delt natt-tabell (celle × tidssteg); batch medlemmer i samme worker med
gjenbrukt arena. Inkrementell rekomputasjon på tvers av medlemmer:
forskning, ikke plan.

Prioritert: (1) instrumenter GC-/maske-andel, ½ dag; (2) alloc-fri
hot-loop, 2–3 dager, 1,5–2×; (3) strukturbeslutningen med Magnus;
(4) fareavstandsfelt, 3–5 dager; (5) ensemble-deling, 2–3 dager,
1,3–1,8×; (6) WASM kun hvis 1–5 ikke når budsjettet målt på faktisk
nettbrett.

## 4. Marinkartolog

- **Felle 1 — åpne kurver er et sikkerhetshull i no-go-retning.** 66 % av
  kurvene droppes (buildDepthBands bruker kun lukkede ringer). Fail-safe
  for `trygt`, men en reell 2–5 m-grunne hvis kurve krysser
  kartbladgrensen havner utenfor alle bånd → `usikkert` i stedet for
  `no-go`. Ruteren behandler `usikkert` som seilbart-med-flagg — tap av
  kartlagt fareinformasjon, verste feilretning. Må lukkes før skala
  (stitching eller «flis først»-arkitekturen fra chart-pack-README).
- **Felle 2 — byggetids-QA:** «kurven omslutter alt grunnere» ryker for
  depresjonskurver og er ikke S-57s sannhet (DEPARE-arealer er
  autoritative). Validator: ingen dybdepunkt-sondering i et bånd skal være
  grunnere enn båndets nedre grense — brudd karanteneres/flagges.
- **Felle 3 — `Grunne` som blank no-go er feil vei (VALSOU-modellen):**
  no-go hvis dybde < valgt sikkerhetskontur eller dybde mangler; ellers
  ingen blokkering. 30 m-grunner som sperrer lærer brukeren å ignorere
  masken. **Sikkerhetssemantikk → Magnus.**
- **CATZOC kvantitativt, ikke binært:** legg f(CATZOC, dybde) til
  `kravTilDybdeM` før kurvevalg (A1: 0,5 m + 1 % d; A2/B: 1,0 m + 2 % d;
  C/D/U: aldri `trygt`). Merk: CATZOC B har ±50 m posisjonsusikkerhet —
  mer enn 20 m-skjærbufferen; buffer bør være CATZOC-avhengig.
- **Flis-budsjett — trygge grep (dekker trolig 4–5×-gapet):** skjær/grunne
  som (punkt, radius) i stedet for buffer-polygoner (mer konservativt enn
  turfs innskrevne ring!), heltalls-/deltakoding, 5–6 desimaler (7 ≈ 1 cm
  er over-presist mot ±5 m kilde), fjern kolineære punkter, slå sammen
  dype bånd (> ~20–30 m) til ett. **Farlig:** vertex-forenkling
  (Douglas-Peucker) av sikkerhetspolygoner, zoom-lag-dropping i
  routing-pakken. Forby geometrisk forenkling eksplisitt i spec.
- **Golden-punktene er sirkulære i dag:** plukket med pointOnFeature fra
  samme geometri som testes → beviser intern konsistens, ikke samsvar med
  virkeligheten. Protokoll: **kart først, kode etterpå** (Magnus velger
  punkt i offisielt sjøkart og leser av forventning FØR kjøring);
  proveniens per punkt (koordinat, kartreferanse+dato, CATZOC,
  skjermbilde, verifisert-av); punkter ≥ 50–100 m fra avgjørende grense;
  par (rett innenfor/utenfor); farled-`trygt`-punktene er de sterkeste
  påstandene — verifiser kartlagt dybde langs leden; inkluder ett bevisst
  kjent-svakhet-punkt for åpne-kurver-hullet (N2) til det er lukket.

Helhetsdom: arkitekturen (bånd for alle kurver, kontur valgt ved oppslag,
datum per lag, aldri-`trygt` ved ukjent datum) er kartografisk sunn —
risikoen ligger i åpne kurver og punktfarenes semantikk.

## 5. Syntese (hovedsesjonen)

**Konvergens på ytelsesspørsmålet — tre uavhengige perspektiver lander
samme sted:**

1. **Ensemblet skal ikke være 30 fulle søk.** Matematikeren viser at
   fast-rute-evaluering per medlem er *metodisk riktigere* for
   robusthetsscore (ikke bare billigere); produksjonsutvikleren bekrefter
   at ingen i bransjen re-optimerer per medlem med Pareto; begge advarer
   mot at hard pruning gir medlemsavhengige artefakter i akkurat tallet
   appen er til for. Fast-rute-evaluering er ~1000× billigere enn søk og
   løser F3.5-budsjettet strukturelt.
2. **Ikke prune hardere (6→4) som primærløsning.** Alle tre fraråder:
   målt ikke-monotoni på kryssetappe treffer motorens raison d'être.
3. **<1 s er feil mål.** Spec §7 sier <5 s nettbrett; progressiv tegning
   viktigere enn totaltid. Kontrollkjøringens 3,7–4,0 s PC er innenfor
   rekkevidde av alloc-fri hot-loop (1,5–2×) + tapsfri måldominans-pruning
   uten å ofre noe.
4. **Diagnosen bør etterprøves:** mål antikjedestørrelser (er fronten
   tynn?) og GC-andel før store grep. Begge målinger er ~½–1 dag.

**Kartfunnene er viktigere enn ytelsesspørsmålet:** åpne-kurver-hullet er
en ekte sikkerhetsfeil i no-go-retning (bryter prinsipp 1s ånd selv om
degraderingen er «ærlig»), og `Grunne`-semantikken over-blokkerer på en
måte som undergraver tilliten til masken. Begge er
sikkerhetssemantikk → Magnus. Flis-budsjettet ser løsbart ut med kun
trygge grep. Golden-protokollen (kart først) bør innføres før de 11
punktene «MÅ VERIFISERES AV MAGNUS» sjekkes — ellers verifiseres feil
ting.

### Beslutningspunkter til Magnus (destillert)

| # | Beslutning | Panelets samstemte anbefaling |
|---|---|---|
| E1 | Ensemble-arkitektur | Fast-rute-evaluering per medlem (+ ev. skalar re-opt som diagnostikk); Pareto kun på kontroll. ADR-0005/tillegg til ADR-0004 |
| E2 | Ytelsesmål kontroll | Forkast <1 s; styr mot spec §7s <5 s nettbrett + progressiv tegning |
| E3 | Pruning | Behold cellCap 6; tapsfri måldominans-pruning + betinget sektornøkling før ε-dominans vurderes |
| E4 | `Grunne`-semantikk | VALSOU-modellen (no-go kun når dybde < krav eller mangler) — sikkerhetssemantikk, kun Magnus |
| E5 | Åpne-kurver-hullet | Lukkes før skala; straks: dybdepunkt-QA i bygget + kjent-svakhet-golden |
| E6 | CATZOC | Kvantitativt dybdetillegg i kravTilDybdeM + CATZOC-avhengig skjærbuffer |
| E7 | Flis-budsjett | De fem trygge grepene; forby vertex-forenkling i spec |
| E8 | Golden-protokoll | Kart-først m/proveniens før verifisering av de 11 |

Forutgående målinger (ingen beslutning nødvendig, gjøres uansett):
antikjede-histogram, GC-/maske-andel i profil, valideringsmåling
skalar-vs-Pareto-ensemble på PC.
