# Ensemble-perf spike (Fase 0/2, steg 3 — nettbrett-målingen)

To målebygg i denne mappen:

1. **`index.html`** — v1-motoren (verbatim uttrekk fra
   `morild_weather_router.html`), spike 2 fra fase 0. Kjøres helt uten nett,
   ingen server nødvendig (dobbeltklikk filen). Referanse — **ikke endret**
   av steg 3-arbeidet.
2. **`v2-engine.html` + `mikrobench.html`** (steg 3, `docs/research/steg3-plan-2026-08-31.md`
   §4 pkt. 2 / `docs/research/maaleplan-e1-2026-08-31.md`) — kjører **den
   ekte v2-motoren** (`packages/routing`), fullt instrumentert. Trenger en
   lokal server (se under) fordi motoren er ekte TypeScript-bygget ESM, ikke
   en inlinet kopi.

Alle tre er målespiker: ingen retry/backoff, ingen produksjonsherding.
`v2-worker.mjs` og `serve.mjs` er kildekode + bevismateriale for målingen,
ikke tenkt gjenbrukt i `apps/pwa` uten videre arbeid.

## Hvorfor en lokal server for v2-motoren

`packages/routing` importerer `@morild/geo` som en *bar* modul-spesifikator
(`import { haversineNm } from "@morild/geo"`) — det virker i Node
(pnpm-workspace-symlinker) og i en bundler, men ikke direkte i en nettleser
uten importmap eller bundling. I stedet for å innføre en bundler-avhengighet
(ingen finnes i repoet i dag) eller stole på nettleser-støtte for
importmap-i-Worker (usikker på tvers av Android-nettlesere), er `serve.mjs`
en ~100-linjers nulldependency Node-server som:

- server statiske filer fra denne mappen som normalt, OG
- proxyer `/engine/geo/…`, `/engine/routing/…`, `/engine/charts/…` mot de
  faktisk kompilerte `dist/`-mappene til `packages/geo`, `packages/routing`
  og `packages/charts`, med én tekstsubstitusjon:
  `"@morild/geo"` → `"/engine/geo/index.js"` — slik at nettleseren aldri ser
  noe annet enn ordinære relative ES-modul-imports.
- serverer `packages/charts/testdata/oslofjord-hvaler.json.gz` med
  `Content-Encoding: gzip`, slik at `fetch()` dekomprimerer den transparent.

Motoren selv er **uendret av dette** — proxyen skriver kun om import-URL-er i
kopier serveren sender over nettverket, aldri filene på disk.

## Kjøreinstruks — PC (utvikling/sanity-sjekk)

```
pnpm check                              # bygger dist/ for alle pakker
node tools/spikes/ensemble-perf/serve.mjs
# åpne http://localhost:8787/v2-engine.html og http://localhost:8787/mikrobench.html
```

Bygg pakkene på nytt (`pnpm check`) etter enhver endring i
`packages/routing`, `packages/geo` eller `packages/charts` — serveren leser
`dist/`, ikke `src/`.

## Kjøreinstruks — Magnus' nettbrett (selve målingen)

Forutsetninger (steg3-plan §4 pkt. 8, værruting-utviklerens protokoll):

1. **Batteri 50–80 %, IKKE på lader.** Lading endrer CPU-throttling-profilen
   på de fleste Android-enheter.
2. **Flymodus på.** Ingen nettverkstrafikk skal konkurrere med målingen —
   serveren kjører lokalt på samme maskin/nettverk som serverer filene, se
   under for hvordan det løses uten internett.
3. Åpne siden i en **PWA-kontekst** hvis mulig (installert/«Legg til på
   startskjerm» fra Chrome), ellers vanlig fane — noter hvilket i rapporten.

**Nettverk i flymodus:** `serve.mjs` må kjøre et sted nettbrettet når over
lokalt nett. To alternativer:
- Kjør `node tools/spikes/ensemble-perf/serve.mjs` på en PC på samme
  Wi-Fi-nett (uten internett-tilgang aktivert på selve nettet er greit,
  lokal Wi-Fi uten WAN fungerer), og åpne `http://<PC-ens-IP>:8787/…` på
  nettbrettet. Flymodus + Wi-Fi på (Android tillater dette) gir isolasjon
  fra mobilnett/bakgrunnstrafikk samtidig som lokal Wi-Fi-server nås.
- Alternativt: `adb reverse tcp:8787 tcp:8787` fra en PC koblet til
  nettbrettet via USB, kjør serveren på PC-en, åpne
  `http://localhost:8787/…` på nettbrettet — fungerer i ekte flymodus siden
  trafikken går over USB, ikke radio.

**Kjørerekkefølge på nettbrettet:**

1. Åpne `v2-engine.html`. Sjekk «Enhetsinfo»-kortet — kopiér `userAgent` og
   `hardwareConcurrency` inn i rapporten manuelt hvis JSON-eksporten ikke
   gjøres først (den tar dem med automatisk).
2. Velg scenario `skjaeloy-skagen-apent`, kjør **«Kjør kontrollmedlem»** én
   gang — sanity-sjekk at reached=true og at tallene ser fornuftige ut før
   protokollen kjøres.
3. Trykk **«Kjør fullt måleprotokoll»**. Dette kjører automatisk: 3 kalde +
   10 varme kjøringer (forkaster første varme), deretter HELE sekvensen en
   gang til (rygg-mot-rygg) — 26 motorkjøringer totalt, ingen manuell
   inngripen underveis. Vent til status sier «Protokoll ferdig» —
   drift-rapporten (>20 % = throttling-flagg) vises automatisk.
4. Gjenta punkt 2–3 for scenario `bohuslan-trange-sund`.
5. Kjør **«Kjør ensemble over worker-pool»** med 30 medlemmer for begge
   scenarioene — dette er hovedtallet for ensemble-skalering
   (`navigator.hardwareConcurrency`-basert poolstørrelse, se
   «Pool-størrelse»-feltet — la stå på 0/auto med mindre du bevisst vil
   teste en annen poolstørrelse).
6. Kjør **«Structured-clone-probe»** for begge scenarioer.
7. Trykk **«Last ned JSON»** — filen inneholder ALT fra kjøringen
   (enhetsinfo, alle diagnostikk-tall, protokoll, klone-probe). Send filen
   tilbake — ikke skriv av tall manuelt, JSON-en er fasiten.
8. Åpne `mikrobench.html`. Trykk **«Kjør mikrobenchmark»** (standard
   500×20 = 10 000 kall per metode holder normalt — sett ned til f.eks.
   200×20 hvis nettbrettet henger synlig lenge). Last ned/kopiér JSON-en
   når «Ferdig» vises.

**GC-måling (valgfritt tillegg, IKKE en forutsetning for punktene over):**
koble nettbrettet til Chrome DevTools via `chrome://inspect` fra en PC på
samme USB/nett, åpne Performance-panelet mot nettbrett-fanen, og ta opp et
GC-spor mens punkt 3 eller 5 kjører. Dette gir GC-pause-histogrammet
måleplanen nevner som tillegg — det er ikke bygget inn i selve spiken fordi
det krever ekstern tooling uansett (ingen ren i-siden-måling gir samme
presisjon som DevTools' egen GC-instrumentering).

## Hva som måles hvor (kryssreferanse til steg3-plan §4)

| § pkt. | Hva | Hvor i koden |
|---|---|---|
| 1 | Fase-klokker (konstruksjon/søkeløkke/rekonstruksjon+ettersjekk) | `v2-worker.mjs` → `runMember()`, rundt `createSearchForTesting`/`advance`/`finish` |
| 2 | Splittet hard-pruning | `packages/routing/src/search.ts` (`pruned.hardConstraint*`) — se rapport for hvorfor dette KREVDE en liten, ren, tellende utvidelse av motoren |
| 3 | Tellende maske-dekorator | `v2-worker.mjs` → `makeCountingMask()` — i spiken, IKKE i `packages/routing` |
| 4 | Antikjede-histogram | `packages/routing/src/search.ts` (`RouteSearch.labelStoreSnapshot()`, ny lesende metode) + `v2-worker.mjs` → `buildAntichainHistogram()` |
| 5 | Gate-statistikk + heap-estimat | `diagnostics.clearance`/`clearanceRecheck` (fantes fra R3) + `v2-worker.mjs` sitt analytiske `BYTES_PER_LABEL`-anslag, kryssjekket mot `arenaBytes().length` |
| 6 | Structured-clone/postMessage-kostnad | `v2-engine.html` → «Structured-clone-probe»-knappen |
| 7 | Mikrobench ekte maske | `mikrobench.html` |
| 8 | Protokoll (kald/varm, rygg-mot-rygg, ensemble-pool) | `v2-engine.html` → «Kjør fullt måleprotokoll»/«Kjør ensemble over worker-pool» |

## Kjente avgrensninger (dokumentert, ikke skjult — N2)

- **«Kald» kjøring** tilnærmes med en fersk `Worker` per kjøring, ikke en
  full sideomlasting (JS-motorens kompilerte kode fra `serve.mjs`-hentingen
  kan likevel være OS-diskcachet). En ekte kald-start-måling ville krevd at
  Magnus laster siden på nytt 26 ganger manuelt — vurdert for dyrt for
  gevinsten; avviket er i praksis lite fordi hver `Worker` får sin egen
  V8-isolate og må JIT-kompilere motoren på nytt uansett.
- **Antikjede-histogrammet er periodisk** (hver N. søkeiterasjon +
  sluttdump), ikke synkronisert med motorens interne
  `isochroneSnapshotHours` (den er ikke eksponert per søkeiterasjon uten å
  bryte kapslingen ytterligere). Nær nok for formålet — fordelingen endrer
  seg ikke brått fra én iterasjon til neste.
- **Ensemble-medlemmene i denne spiken er en lastgenerator, ikke E1'** —
  deterministisk perturbasjon (±20 % styrke, ±25° retning per medlem, seedet
  med `mulberry32` fra `test-fixtures/seeded-random.ts`) brukt KUN for å gi
  30 forskjellige, men sammenlignbare, søk å måle ytelse på. Dette er ikke
  ensemble-mekanisme-valideringen (E1'/A/B/F-variantene) — den har sin egen
  måleplan (`docs/research/maaleplan-e1-2026-08-31.md`).
- **`performance.memory`** er Chrome/Chromium-only og måler kun
  hovedtrådens JS-heap — selve søket kjører i en Worker med egen heap.
  Arena-anslaget (etiketter × 76 byte, kryssjekket mot `arenaBytes().length`)
  er det mer treffsikre tallet for selve søket.
