# Beslutningsgrunnlag fase 4a — robusthet (`docs/specs/robusthet.md`)

- Dato: 2026-09-04
- Status: grunnlag for fagagent-panelet (`/panel`) før spec-utkast og
  beslutningspunkter D8.x legges frem for Magnus
- Kilder: `docs/00-kravspek.md` F3.5, F4.1–F4.6, N2, N6, B3;
  `docs/decisions/ADR-0005-ensemble-mekanisme.md`;
  `docs/specs/rutemotor.md` §4.2, §4.8, §5.5, §5.6, §5.11, §9;
  `docs/specs/vaerpakker.md` §9, §9.8; kodekartlegging 2026-09-04 (under);
  `docs/research/v1-innsikt-robusthet-2026-09-04.md`;
  `docs/research/maaling-e1-2026-08-31.md`; `docs/research/spike-ensemble-perf.md`.

## 1. Spørsmålet

Fase 4a skal gjøre ensemblet til et produkt: 30 MEPS-medlemmer + kontroll
per avgang, aggregert til robusthetstall og presentert slik at Magnus kan
ta en avgjørelse i cockpit. Spec-en `robusthet.md` er eier av
F4.2-aggregeringen (ADR-0005 sier det eksplisitt). Hva må den fastsette,
og hvilke valg har reell konsekvens?

## 2. Rammer som allerede er vedtatt (ikke til diskusjon)

- **Mekanisme F** (ADR-0005): hvert medlem kjøres med samme fulle
  Pareto-søk og samme kursoppløsning som kontrollen. Robusthetstall
  konstrueres KUN fra fulle søk. Korridor-evaluator = S1b-diff-verktøy.
- **Inkonklusiv-kategorien**: medlem med `coverage.weather = "partial"`
  telles verken som gjennomførbart eller ugjennomførbart; andel
  rapporteres alltid; > 20 % ⇒ «horisonten er for kort» i UI.
- **Progressiv semantikk er UX-kontrakten** (F3.5): kontroll for alle
  avganger først (tabell på sekunder), full ensemble for valgt/topp-avgang
  < 60 s, øvrige avganger strømmet. Delt A*-felt/Tub og delte read-only
  cacher for væruavhengige oppslag er tillatt.
- **Presentasjon (B3, 2026-08-30)**: trafikklys + P90 som plantid + én
  beslutningsregel med klokkeslett; statistikk bak et trykk. Vær-langs-
  ruten-bånd med ensemble-vifte (F4.4).
- **Rangering** etter robust ytelse (P90 + gjennomførbarhet), avgangsvindu
  med 1 t oppløsning (F4.5).
- **Bail-out** (F4.6): kuratert havnebok (personlig, synket) + per
  rutekandidat «lengste strekk uten brukbart alternativ: X t» og «tid til
  nærmeste bail-out gjennom passasjen». R2-semantikk med backoff i fysisk
  tid min(Δt, 1800 s).
- **Falsifiseringsporter** i ADR-0005: (1) nettbrett-måling FØR
  spakprioritering — **fortsatt umålt**; (2) vise-versa-port ved > 60 s
  per avgang etter tiltak; (3) ekte-data-port; (4) horisont-port 20 %;
  (5) P90-separert rangeringsfikstur bygges i 4a.
- Perturbasjon utover vær (F4.3): avgangstid, cruising-faktor ±0,05, strøm.
- Fase 4b (ikke nå): korridor-stabilitet, automatisk følsomste-faktor-
  attribusjon, regime-klynging, format-kandidater.

## 3. Hva som finnes i kode i dag (kartlegging 2026-09-04)

| Del | Status | Hvor |
|---|---|---|
| Motor kjenner ikke ensemble; ett medlem = ett `WeatherField` | ferdig | `packages/routing/src/contracts.ts` |
| Delt A*-felt i API (`RouteInput.field`, `tubBoundS`) | finnes, **brukes ikke av klienten** | `search.ts`, `distance-field.ts`; `apps/pwa/src/workers/weather-routing.worker.ts` sender ikke `field` |
| Progressivt API `createSearch/advance/snapshot/finish/stop` | ferdig | `search.ts` |
| Evaluator (`evaluateRoute`, styr-mot-veipunkt, én-sannhet-test) | ferdig | `evaluate.ts` |
| R2/bail-out-mekanikk (`r2Verdict`, `harbourApproachable`, 6 t, vaktbånd) | ferdig, men `backoffSteps` i steg, ikke fysisk tid | `bailout.ts` |
| Havneliste | kun interim-fikstur (8 havner) | `test-fixtures/bailout-harbours.ts` |
| Ensemble-orkestrering i klient: kontroll først, så worker-pool, callbacks | finnes | `apps/pwa/src/weather/ensemble.ts` (`runEnsemble`) |
| Aggregering: gjennomførbar/ugjennomførbar/inkonklusiv/feil, P50/P90 varighet (floor-indeks), horisont-port | finnes, **uspesifisert** | samme fil, `summarizeEnsemble` |
| Spredning kryss/motor, paret per-medlem-differanse, rangering av avganger | mangler | — |
| Perturbasjon avgangstid/cruising/strøm som produksjonsmekanisme | mangler (kun fiksturer S-5, `perturbation.ts`) | `test-fixtures/` |
| Presentasjon: trafikklys, plantid, beslutningsregel, bånd, vifte | mangler (én tekstlinje) | `apps/pwa/src/weather-ui.ts` |
| Arkitekturtest «F4.2 kun fra fulle søk» (ADR-0005 krav) | mangler | `tools/arch-tests` |
| Fiksturer S-1…S-8 (30 medlemmer, front, avgangsvindu, bimodal, vind-mot-strøm), E1-utfall, m24-felle | ferdig | `test-fixtures/ensemble*.ts`, `e1-forkrav.test.ts` |
| Medlemsaksess: `toWeatherField(pkg, k)`, 48 t medlemshorisont, strøm/bølger delt | ferdig | `packages/weather/src/weather-field-adapter.ts` |

Ytelse: PC 67–99 s per avgang (fullt ensemble, E1-måling); nettbrett
antatt 2–4× — **umålt**. Rått 11–53 min for 5–8 avganger mot 60 s-budsjett.

v1-innsikt: v1 hadde ingen ensemble, sju faste avgangsoffset med delt
A*-felt. Loggene (218k rader) viser cruising-faktor 0,86 (10–15 kn) til
1,21 (< 10 kn) mot default 0,90 — spredningen er regimeavhengig og større
enn ±0,05.

## 4. Designvalg med reell konsekvens (D8.x — utkast)

**D8.1 Hvor bor robusthetslaget.**
(a) Ny ren pakke `packages/robustness` (aggregering, rangering, bail-out-
tall, beslutningsregel; importerer kun `@morild/routing`-typer + geo; ingen
I/O), med `apps/pwa` som tynn scheduler over worker-poolen.
(b) Alt i `apps/pwa/src/weather/` som i dag.
(c) Inn i `packages/routing`.
Anbefaling: (a) — testbar, deterministisk, arkitekturtest kan bevise at
den bare kaller `planRoute`/`createSearch`. (c) bryter «motoren kjenner
ikke ensemble».

**D8.2 Delt A*-felt og tub i praksis.** Feltet bygges én gang per
(start, mål, maskeversjon, oppløsning) og deles på tvers av avganger og
medlemmer (§5.5). Valg: bygges i hovedtråd eller egen worker; overføres
som transferable ArrayBuffer (kopi per worker) vs. SharedArrayBuffer
(krever COOP/COEP — F3.5 sier unngå). Tub-bound fra kontrollkjøringen
gjenbrukes for medlemmene? (Kontrollens beste tid + margin som bound kan
kutte medlemmer feil hvis medlemmet er tregere — må være konservativ.)

**D8.3 Definisjon av F4.2-tallene.**
- Persentil: nærmeste-rang på sorterte gjennomførbare (n_f), P90 = element
  ⌈0,9·n_f⌉, eller interpolert? Med n_f ≤ 30 er forskjellen inntil ett
  medlem. Hva når n_f < 10?
- Gjennomførbarhetsandel = n_f / (n_f + n_inf); inkonklusive utenfor
  nevneren, rapportert separat; feil (algoritmisk abort) egen kategori.
- Paret per-medlem-differanse (ADR-0005) — mellom hva? Forslag: mellom
  avgang A og B per medlem (samme medlem, to avganger) for rangering.
- Spredning i kryss-/motorandel: P50/P90 av `beatS/durationS` og
  `motorS/durationS`.
- Trafikklys-regel (konkret): grønt = andel ≥ 0,9 og inkonklusiv ≤ 0,2 og
  P90 ≤ brukerens tidsbudsjett (eller uten budsjett: P90/P50 ≤ 1,25?);
  gult = andel 0,7–0,9 eller P90-brudd; rødt = andel < 0,7 eller
  kontrollen selv ugjennomførbar. Tallene er forslag — panelet bes ta
  stilling.

**D8.4 Perturbasjon (F4.3) — hva kjøres, og på hva.**
Hver perturbasjon er et fullt søk (F). Forslag: perturbasjoner kjøres på
KONTROLLEN, ikke på alle medlemmer: cruising-faktor {0,85, 0,90, 0,95}
(kravspek ±0,05; v1-data antyder bredere), strøm-skalering {0,8, 1,2},
avgangstid dekkes av 1 t-vinduet (F4.5). Det gir 4 ekstra søk per avgang
(vs. 120 om alle medlemmer perturberes). Alternativ: perturbasjoner bare
på topp-avgangen. Spørsmål: er kontroll-perturbasjon tilstrekkelig for
«følsomste faktor», eller må minst cruising-faktor kjøres på P90-medlemmet?

**D8.5 Beslutningsregel med klokkeslett (F4.4) i 4a-omfang.**
Full automatisk attribusjon er 4b. 4a-forslag: finn tidligste tidspunkt
t* etter avgang der gjennomførbare og ugjennomførbare medlemmer skiller
seg i vind (TWD-sektor eller TWS-terskel) ved posisjonen kontrollruten har
ved t*; formuler «sjekk kl. HH:MM: <vilkår>? Hvis ikke — <handling>».
Fallback når ingen skilleregel finnes: «ingen enkel sjekk skiller
utfallene — se viften». Er dette en trygg forenkling, eller lover den mer
enn den holder?

**D8.6 Bail-out-tallene (F4.6).**
«Lengste strekk uten brukbart alternativ» = maks over ruten av tid t der
ingen havn i havneboken er anløpbar (`harbourApproachable` med medlemmets
vær ved t) innen R2_LIMIT (6 t) — beregnet på kontrollruten med
kontrollvær (billig) eller som P90 over medlemmer (dyrt: krever
R2-søk)? Forslag: kontroll-basert i tabellen, per-medlem for valgt avgang.
Havnebok-datamodell: `BailoutHarbour` + notater + `updated_at`/enhets-ID
(F6.1 LWW). `backoffSteps` → fysisk tid.

**D8.7 Ytelse og progressivitet.** Rekkefølge: kontroll × alle avganger →
ensemble for topp-avgang (etter kontrollrangering) → øvrige avganger etter
kontrollrangering → perturbasjoner. Spaker (uvaliderte): profilsøk over
vinduet, alloc-fri hot-loop, delt cache, tub fra kontroll, worker-pool =
hardwareConcurrency − 1. **Sekvensiell tidlig-stopp** (stopp etter k
medlemmer ved forhåndsregistrert konfidensregel) endrer F4.2-semantikk —
eksplisitt spørsmål til Magnus. Spakprioritering er BETINGET av
nettbrett-tallet (port 1).

**D8.8 Arkitekturtest.** `packages/robustness` og `apps/pwa` importerer
aldri `variants.ts`/`corridor.ts` (målevarianter); robusthetsstatistikk
tar bare `RouteResult` fra `planRoute`/`createSearch`. Skrives i første
bølge.

**D8.9 Rangeringsfikstur P90-separert** (ADR-0005 pkt. 5): fikstur der
topp-avgang under P90 ≠ topp-avgang under P50 med margin > støygulv.

## 5. Spørsmål panelet bes svare på

1. D8.1–D8.9: GODKJENN / ENDRE (hva) / AVVIS (hvorfor) per punkt.
2. Hva mangler i listen som vil bite oss i 4a?
3. Hvilke av spakene i D8.7 bør prioriteres FØR nettbrett-tallet
   foreligger (hvis noen), og hva er trygt å utsette?
4. Er kontroll-basert perturbasjon (D8.4) og kontroll-basert bail-out-
   tall (D8.6) ærlige nok under N2, eller skjuler de spredning?
