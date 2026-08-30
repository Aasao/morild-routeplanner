# Prosjektplan RoutePlanner v2

- Status: **AKTIV — kravspek godkjent 2026-08-30, fase 0 i gang**
- Dato: 2026-08-30
- Arbeidsform: Claude Code med spesialistagenter (`.claude/agents/`),
  modellruting i `docs/03-modellruting.md`, beslutninger som ADR-er.

## Prinsipper for gjennomføring (beste praksis Claude Code)

1. **Spec før kode, ADR før arkitektur.** Hver fase starter med spec-er i
   `docs/specs/`; implementasjon skjer mot godkjent spec.
2. **Små verifiserbare bølger.** Hver bølge ender i kjørbare tester +
   oppdatert dokumentasjon; ingenting «90 % ferdig» på tvers av bølger.
3. **Kontekstdisiplin.** Utforsking og store søk går via subagenter
   (haiku/sonnet); hovedsesjonen brukes til beslutninger, spec-er og
   kritisk algoritmearbeid. Funn skrives til `docs/` umiddelbart.
4. **Verifiser mot virkeligheten.** Golden-route-tester med frosne værfelt;
   farbarhetstester mot kjente skjær/leder; kalibrering mot v1-loggene;
   røyktest i browser-preview før hver fase lukkes.
5. **Ærlig rapportering.** Feilende tester rapporteres med utdata; hoppede
   steg sies eksplisitt.

## Faser

### Fase 0 — Fundament + spikes (etter arkitekt-review: kritisk vei først)
**Mål:** repo klart til effektivt arbeid, og prosjektets farligste antagelser
avkreftet/bekreftet med målinger.
- pnpm-monorepo (apps/, packages/, tools/), TypeScript strict, vitest,
  lint + arkitekturgrense-test (routing-pakken importerer aldri I/O).
- ADR-mal, `docs/legal/`-mal, `.dev.vars.example`, CI (GitHub Actions:
  check + test).
- ADR-0001: monorepo/teknologivalg. ADR-0002: «klienten beregner, skyen
  forbereder». **ADR-0003: batch-jobbens hjem** (anbefalt: GitHub Actions
  cron → R2, lokal PC som fallback — avhenger av beslutning B2).
- **Spike 1 (THREDDS):** frittstående skript — hent MEPS-medlem-subsets +
  NorKyst-utsnitt via NCSS/OPeNDAP, mål tid og størrelse, verifiser
  WAM800-sti og NorKyst-katalogversjon, sjekk at arkivet dekker juli 2026
  (kalibreringsbehovet). Resultat → `specs/vaerpakker.md`-forutsetninger.
- **Spike 2 (ensemble-ytelse):** kjør v1-motoren 30× i workers på
  Android-nettbrettet med syntetisk perturberte felt — ekte tall for
  F3.5-budsjettet før porten begynner.
**Exit:** `pnpm check && pnpm test` grønt i CI; begge spike-rapporter i
docs/research/. — *Agenter: plattform (ADR), vaer-analytiker (spike 1),
implementer, qa-runner. Modell: sonnet; ADR-review i hovedsesjon.*

### Fase 1 — Kartfundament (kjerne 1)
**Mål:** farbarhetsmaske for norske farvann + kartvisning.
- Spec: `specs/farbarhetsmaske.md` (pipeline fra kartdata-rapporten §5,
  tillitsnivåer, pakkeformat).
- `tools/chart-pack`: last Kartverket-vektordata (dybdepunkt/-kurver,
  tørrfall, grunne, skjær) + Kystverket farled → sikkerhetskontur-polygon
  + tillitsgrid → innholdsadressert pakke i R2. PMTiles-bygg for visning.
- Maske-semantikk v1 (etter arkitekt-review M3): **ren polygonalgebra**
  (sikkerhetskontur = nærmeste kurve ≥ terskel; ingen interpolasjon), pluss
  seilingshøyde (bruer/spenn), TSS/skipsleder og vernesoner (seiler-review).
- `packages/charts`: ChartSource-abstraksjon (m/datum-felt per kilde) +
  farbarhetsoppslag m/tester mot kjente fasit-punkter (kjent skjær
  blokkerer, kjent led er åpen, kjent bru stenger — **minst 50 kuraterte
  tilfeller**, inkl. danske/svenske som skal gi `usikkert`).
- `apps/pwa` skjelett: MapLibre m/sjøkartraster + egne vektorlag.
**Exit:** farbarhetsoppslag verifisert mot fasit-punktene; kart vises på
Android-nettbrett via Pages-preview. — *Agenter: kartdata (spec+pipeline),
implementer, qa-runner, code-reviewer. Modell: sonnet; geometrialgoritmer
som blir vanskelige → rutemotor-agent (opus).*

### Fase 2 — Rutemotor-port + polar-kalibrering
**Mål:** v1-motoren som testet, ren TypeScript-pakke — nå mot farbarhetsmaske.
- Spec: `specs/rutemotor.md` (port-plan fra v1-funksjonsanalysen, semantiske
  endringer eksplisitt: farbarhet i stedet for kystlinje).
- `packages/geo`, `packages/polar`, `packages/routing` med enhetstester;
  golden-route-harness (frosne værfelt i testdata).
- Golden-tester sammenligner geometri/tid med toleranse, ikke bit-eksakt
  (Math.sin/cos er implementasjonsdefinert per V8-versjon).
**Exit:** golden-ruter reproduserer v1-adferd (dokumenterte avvik OK når
farbarhet er årsak). **Kalibreringen er flyttet ut av fase 2-exit** (krever
historisk NorKyst via THREDDS-tooling, jf. arkitekt-review M7) — den kjøres
som egen bølge etter fase 3-spiken, med SOG-basert fallback m/flagg for
bins uten strømfasit. — *Agenter: rutemotor (opus), v1-arkeolog (haiku),
implementer, qa-runner. Kalibreringsanalyse: sonnet med Bash/skript.*

### Fase 3 — Værdata ende-til-ende (deterministisk)
**Mål:** kuttet v2.0-kjernestack (MEPS kontroll, NorKyst-800, MET bølger,
tideapi — jf. F2.1) → rute i appen.
- Spec: `specs/vaerpakker.md` (feltformat m/semver, ≤ 30 MB-budsjett,
  kvantisering, faste fliser, lagged-ensemble-politikk, kildestatus —
  forutsetninger fra fase 0-spiken).
- `tools/weather-pack`: batch-jobb i valgt hjem (ADR-0003, GitHub Actions
  anbefalt) THREDDS → subset → kvantiserte felt → R2, m/healthcheck-ping.
  `apps/worker`: proxy m/User-Agent + cache for punkt-API-er (inkl.
  MetAlerts); pakke-pekere.
- Kalibreringsbølgen (fra fase 2) kjøres når subset-tooling finnes.
- `packages/weather`: feltmodell + interpolasjon m/konvensjonstester.
- Første ende-til-ende: v1-paritet + dybdetrygghet + 800 m strøm.
**Exit:** rute Skjæløy→Skagen beregnes i appen på ekte data; røyktest på
nettbrett. — *Agenter: vaer-analytiker (spec+pipeline), plattform (worker),
implementer, qa-runner. Modell: sonnet.*

### Fase 4 — Robusthet (kjerne 3, appens signatur)
**Mål:** ensemble-ruting + robusthetsscore + utvidet avgangsvindu.
- Spec: `specs/robusthet.md`. Skrives i hovedsesjonen (Fable/Opus) —
  uutforsket territorium og prosjektets vanskeligste designarbeid.
- **Fase 4a:** ensemble-kjøring m/delt A*-felt og progressiv beregning
  (kontroll for alle avganger først, ensemble strømmet per avgang, jf.
  F3.5); P50/P90 + gjennomførbarhetsandel; perturbasjon avgangstid/
  cruising-faktor/strøm; bail-out-mål (F4.6); presentasjon per F4.4
  (trafikklys + plantid + beslutningsregel + vær-langs-ruten-bånd).
- **Fase 4b (etter 4a er i bruk):** geometrisk korridor-stabilitet og
  automatisk følsomste-faktor-attribusjon.
**Exit 4a:** S1 med ekte MEPS-medlemmer; progressiv UX verifisert;
minnebudsjett (< 500 MB heap) målt på nettbrettet. — *Agenter: rutemotor
(opus) + hovedsesjon for design; vaer-analytiker; implementer.*

### Fase 5 — App-opplevelse
**Mål:** ekte app-følelse.
- Offline-lager (værpakker, kartpakker, ruter), D1-synk telefon↔nettbrett,
  GPX/Web Share, PWA-finpuss, TWA-APK (Bubblewrap, sideload).
**Exit:** installert på telefon + nettbrett; full planleggingsflyt offline
med forhåndssynkede data. — *Agenter: plattform, implementer, qa-runner.
Modell: sonnet.*

### Fase 6 — Underveis
**Mål:** live-bruk i cockpit.
- GPS (forgrunn), revider-herfra, XTE, målt-vs-prognose m/tillitsjustering,
  valgfri v1-bro/Signal K-integrasjon.
**Exit:** røyktest i båten (eller simulert med v1-loggreplay via broen).
— *Agenter: implementer, plattform. Modell: sonnet.*

### Løpende
- code-reviewer etter hver implementasjonsbølge, før commit.
- Dokumentvedlikehold: CLAUDE.md-kommandoseksjon, specs, ADR-er.
- Fase-rekkefølgen 1↔2 kan delvis parallelliseres (kartpipeline er
  uavhengig av motor-port); 3 krever 2; 4 krever 3.

## Risikoer og mottiltak

| Risiko | Mottiltak |
|---|---|
| MEPS/NorKyst-subsetting tregere/tyngre enn antatt | Måles i **fase 0-spike** før noen spec låses; fallback Open-Meteo ensemble (ECMWF som JSON) |
| Batch-pipelinen dør mens båten er på tur | GitHub Actions-cron (uavhengig av lokal PC) + healthcheck-varsling + kildestatus i pakke-peker |
| Farbarhetsmaske gir falsk trygghet | Tillitsnivåer (F1.2), føre-var-regel, kuraterte fasit-tester, disclaimer |
| Ensemble-ytelse på nettbrett | Delt A*-felt (v1-teknikk), redusert kursoppløsning per medlem, WASM som siste utvei |
| Kartverket-vilkår for tile-caching | E-post-avklaring (plattform-rapporten); fallback: direkte WMTS uten mellomlagring |
| Svenske dybdedata stengt | Eksplisitt «usikkert»-nivå; scope-spørsmål 2 i kravspeken |
