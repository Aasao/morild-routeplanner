# Beslutningsgrunnlag R3 (kystbuffer) og E1′ (målingsdesign) — fagagentenes råd

- Dato: 2026-08-31. Svar fra de fire runde 1-agentene (kartolog,
  værruting, ytelse, matematiker) på Magnus' påventende beslutninger,
  etter steg 2-commit c828ce2. Simulerte fagperspektiver.

## R3 — kystbuffer langs korden: ALLE FIRE anbefaler (b), lagdelt

Enstemmig avvisning av (a) «dokumentert restrisiko»:
- **Kartolog:** «et hardt krav som bare kontrolleres i endepunktene er
  ikke kontrollert» — ECDIS' route check skanner hele leggen (XTD/guard
  zone); (a) gjør kravet per definisjon mykt.
- **Værruting:** bransjenormen ER veipunkt-sampling (Expedition/qtVlm
  sjekker landkryssing geometrisk, men ikke offing-avstand kontinuerlig;
  seilere tegner manuelle sperrelinjer) — men «(b) er billig nok til at
  (a) er vanskelig å forsvare».
- **Ytelse:** «kostnadsargumentet taler ikke lenger for (a)».
- **Matematiker:** leverer den formelle garantien (under).

Anbefalt lagdelt mekanisme (konvergens kartolog/ytelse/matematiker):
1. **Eksakt Lipschitz-gate i søket (gratis):** klaring d(·) til faresettet
   er 1-Lipschitz ⇒ skarp betingelse **d(A) + d(B) ≥ 2·minOffing + L**
   (L = kordelengde) garanterer at intet kordepunkt bryter kravet.
   d(B) beregnes alt i steg 13 (cellKey-cachet); d(A) er forelderens —
   lagres i arenaen (~1 MB Float32Array). Forbehold: clearanceNm-avkorting
   ved maxNm er gyldig nedre skranke (gaten forblir sunn), men maxNm bør
   være ≥ minOffing + L/2; korde-vs-storsirkel neglisjerbart ved L ≤ 4 nm.
2. **Ved gate-miss:** rekursiv bisection (matematiker: sjekk midtpunkt,
   samme gate per halvdel — Lipschitz-sertifisert intervallmetode,
   kontinuerlig garanti) / sphere-marching (ytelse: hopp
   klaring(p) − krav frem per oppslag — samme idé). Fast finmasket
   sampling UTEN Lipschitz-terskel frarådes (restlekkasje).
3. **Full korridorsjekk alltid i den autoritative stien** (ettersjekk
   §5.10, konsolidering, sluttetappe) — hundrevis av segmenter,
   millisekunder.

Forutsetning (matematiker): garantien krever at clearanceNm ALDRI
overestimerer avstand — må garanteres av maskespec-en, ikke antas.
Skjærgårds-forbehold (ytelse/matematiker): gaten passerer sjelden i
skjærgård (nær 100 % miss i Bohuslän ved 1 t-steg) — der bærer
bisection/marching kostnaden, og prisen per nermesteFareAvstandNm-kall
er UMÅLT. → Mål den i nettbrett-målingen; er den dyr, rykker
fareavstandsfeltet (prekomputert distance transform) frem fra fase 5.

**Nytt ytelses-varsku (ytelse):** de nye eksakte segmenttestene
(~16 µs) × reelt kandidatantall (0,5–1M) kan dominere kjøretiden på
EKTE maske — 3,7 s-tallet er målt på syntetisk maske. Må inn i
nettbrett-målingen.

## QA-funnet — kartologens skjerpede råd (ny beslutning til Magnus)

12,9 %-funnet endrer risikobildet kvalitativt: målt systematisk
feilklassifisering i USIKKER retning (3 m-sondering i kunstig stort
«5–10 m»-bånd bedømmes seilbar ved 2,6 m krav). Flagging er varsling,
ikke beskyttelse. Råd i rekkefølge:
1. **Straks:** promoter validatoren fra QA til byggetids-guardrail —
   sondering grunnere enn båndets nedre grense behandles som
   VALSOU-punktfare (no-go hvis dybde < krav), og delpolygonet kan aldri
   gi `trygt`. Ufarliggjør de 503 punktene uten stitching.
2. Tidlig bruk i fixture-området er akseptabel MED guardrail + farled-bias
   (farled er uavhengig verifisert geometri).
3. **Stitching rykker frem:** fra «fase 5/skala» til «før første rute
   utenfor farled brukes reelt» — 1-av-8 feilrate i båndtilordning er for
   høy til å hvile permanent på sonderingsnettet (50 m gradert).

## E1′ — forhåndsregistrert målingsdesign (værruting + matematiker)

Nøkkel: **kriteriene skrives i docs/ FØR kjøring; ikke juster etter å ha
sett tallene.** Medlemmene er parede — sammenlign per-medlem-differanser,
aldri fordelingsoverlapp; rapporter per fikstur, aldri aggregert.

- **Scenarier (min. 6, minst to ulike synoptiske situasjoner):** slør-
  referanse; ren kryssetappe (målt ikke-monoton); **frontpassasje med
  timing-spredning over medlemmene (±3–9 t)** — viktigste fiksturen,
  finnes neppe i dag og MÅ bygges (uten den er felle-deteksjon utestet);
  Bohuslän-skjærgård; avgangsvindu der rangeringen vipper; degradert
  data (bølger mangler); grensetilfelle nær maxTws/maxHs.
- **Omfang:** 6 scenarier × 5 avganger × 30 medlemmer, alle motorvarianter
  på identisk input (syntetisk ensemble: kontrollfelt + seedede
  deterministiske perturbasjoner — tidsskyv, rotasjon, skalering).
- **Størrelser:** P50/P90-ankomst; P50/P90 også på beat/motor/natt
  (skalar-bias treffer myke dimensjoner først); gjennomførbarhetsandel;
  **felle-settets identitet** (hvilke medlemmer feiler R2, ikke bare
  antall); topp-avgang + Kendall-τ; rutetopologi; null algoritmiske
  aborter telt som «ugjennomførbar»; per-medlem-differansens median+IQR
  (dokumenterer at bias er uniform — premisset for troverdig spredning).
- **Beslutningsregel (asymmetrisk):** billigste metode vinner hvis på
  ALLE fiksturer: identisk felle-sett, samme topp-avgang, Kendall-τ ≥ 0,8,
  P50/P90-ankomst innen ±2 % (N5) eller < 20 % av medlemsspredningen,
  gjennomførbarhet ± 1 medlem. **Feil felle-sett er diskvalifiserende
  uansett størrelse** (sikkerhetssemantikk). Avvik kun i myke fordelinger
  m/uendret rangering: akseptabelt, dokumenteres. Alt annet ⇒ hybrid
  (korridor + R2-re-søk) foran skalar; full Pareto siste utvei.
  Korridor-evaluering måles samtidig men kun mot S1b-diff-bruken.

## Destillert til Magnus — BESLUTTET 2026-08-31 (Magnus)

Magnus besluttet panelets anbefalinger samme dag: **R3 = (b) lagdelt**
(Lipschitz-gate + bisection + full sjekk i autoritativ sti) og
**QA-guardrail promoteres straks** (sonderinger som VALSOU-farer,
delpolygon aldri `trygt`). Stitching-timing justert som anbefalt. E1′
forblir åpen til den forhåndsregistrerte målingen er kjørt
(`docs/research/maaleplan-e1-2026-08-31.md`).

## Implementert og verifisert 2026-08-31 (samme dag)

- **R3:** `packages/routing/src/clearance.ts` (checkClearanceCorridor —
  punkttest er L=0-spesialtilfellet, én-sannhet), arena-utvidelse,
  Lipschitz-korrigert klaringscache (v1-arvens celle-cache kunne selv
  overestimere — fikset), kall i søk/evaluator/konsolidering/ettersjekk/
  sluttetappe, instrumentering. Spec §5.3.2.
- **R3 beviste seg selv:** golden bohuslan-trange-sund passerte et skjær
  med 0,088 nm klaring (krav 0,15) — reell lekkasje, rute nå flyttet
  (+46 s, spor inntil 0,86 nm). Gate-statistikk: 94 % pass åpent hav,
  71 % skjærgård (syntetisk maske; ekte-maske-pris = §7 måling 3b).
- **Guardrail:** 503 VALSOU-punktfarer + 273 delpolygoner som aldri gir
  `trygt`; ingen eksisterende golden-punkter berørt.
- **Konservativitets-revisjon fant motsatt fortegn av hypotesen:**
  innskrevet-polygon-avstand og vertex-only nearestRingPoint
  OVERestimerte (kontraktbruddretningen) — fikset (kantbasert
  projeksjon + eksakt sirkelformel); garantien R3-gaten hviler på
  holder nå for den reelle kodeveien.
- Verifisert samlet: 368 + 5 + 15 tester grønt, check 0 feil.
  Review-port: ingen sikkerhetsfunn.

Oppfølging (grad 3 fra review, ingen hastesak):
1. ~~Spore hvilken Pareto-kandidat som forsvant i bohuslan (alternatives
   2→1) — brukersynlig, bør forklares før det blir vane.~~ **Lukket
   2026-08-31:** begge pre-R3-alternativene lekket ved samme skjær som
   primærruten (0,088 < 0,15 nm, målt brudd — ikke uncertified-
   konservatisme); regresjonstest lagt til. Se
   `bohuslan-alternativ-bortfall-2026-08-31.md`.
2. ChartSource→NavigabilityMask-adapteren (fase 3) må implementere
   maxNm-avkortingen og verifisere klaringskontrakten mot ekte pakke.
3. Når ekte sonderingsdata (ikke Grunne-proxy) tas i bruk: bekreft med
   test at bandsFinal-hullene og guardrail-punktfarene forblir
   konsistente (i dag sammenfallende, dokumentert bevisst).

| Beslutning | Panelets råd | Merknad |
|---|---|---|
| R3 | **(b) lagdelt:** Lipschitz-gate i søk + bisection ved miss + full sjekk i ettersjekk/konsolidering/sluttetappe | Enstemmig; (a) avvist av alle fire |
| QA-guardrail | Promoter validator til guardrail STRAKS (sonderinger som VALSOU-farer, delpolygon aldri `trygt`) | Sikkerhetssemantikk → Magnus |
| Stitching-timing | Frem fra fase 5 til «før første rute utenfor farled brukes reelt» | Justerer runde 2-planen |
| E1′ | Ingen beslutning nå — forhåndsregistrert måling per design over; frontpassasje-fiksturen må bygges først | Design klart til å skrives som måleplan |
