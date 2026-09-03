# Spec: app-skjelett (`apps/pwa`, `apps/worker`)

> **Status: foreslått av plattform-agenten 2026-09-03, bygget på anbefalingen
> (CLAUDE.md: «fortsett autonomt», reversible valg).** Punkter merket
> **[FORESLÅTT]** er arkitekturvalg med varig konsekvens innenfor rammen
> ADR-0001/ADR-0002 allerede har satt (monorepo, TS strict, MapLibre +
> PMTiles, Cloudflare Pages + Workers + R2, klienten beregner). De er ikke
> nye ADR-er i seg selv — de er implementasjonsvalg *innenfor* de vedtatte
> ADR-ene — men flagges fordi de er dyre å reversere i praksis. Magnus kan
> overstyre hvert enkelt uten at resten av skjelettet må bygges om.

- Dato: 2026-09-03
- Fase: 3, bølge 1D (`docs/research/fase3-plan-2026-09-02.md`)
- Pakker: `apps/pwa`, `apps/worker`

---

## 1. Formål og kravsporing

`apps/` fantes ikke ved bølge-start — PWA-skjelettet fra fase 1 ble aldri
bygget, og fase 3 kan ikke levere «rute i appen på ekte data» uten det. Denne
spec-en dekker **skjelettet**: strukturen, byggverktøyet, offline-strategien
og Worker-proxy-formen — ikke selve vær-/kart-integrasjonen (den kommer i
bølge 2/3 når `packages/weather` og pakke-peker-flyten faktisk finnes).

| Krav | Hva denne spec-en dekker |
|---|---|
| F1.8 | Kartvisning: MapLibre + Kartverket sjøkartraster-WMTS, attribusjon + disclaimer |
| F1.9 (delvis) | Offline-lagringsmekanismen (Cache API / IndexedDB) klargjøres — selve «valgte kartområder»-logikken er farbarhetsmaske-/kartpakke-spec-ens bølge |
| F2.6 (delvis) | Worker-proxy-ruten for MetAlerts (`/proxy/metalerts`) — selve UI-visningen i avgangstabellen er fase 4/`specs/robusthet.md` |
| F6.3 | PWA på Cloudflare Pages, norsk UI, manifest |
| F6.4 | Tilgangsmodell for Worker-API-et — foreslått løsning under (§7) |
| N3 | MET User-Agent fra Worker, committet fallback |
| N4 | Ingen nye betalte tjenester; avhengigheter minimert og begrunnet (§3) |
| ADR-0002 | Web Worker-hosting av `@morild/routing`; ingen ruteberegning i `apps/worker` |

## 2. Avgrensning — hva denne spec-en bevisst IKKE dekker

- **Pakke-peker-fetch for ekte værdata/kartpakker** (nedlasting, dekoding,
  IndexedDB-skjema for faktiske pakke-payloads) → `docs/specs/vaerpakker.md`
  §14/§15 og `docs/specs/farbarhetsmaske.md`, bølge 2. Denne spec-en bygger
  *ruten* dataene skal gå (Worker-endepunkter, klientens
  kompatibilitetssjekk-kontrakt), ikke selve integrasjonen.
- **Farbarhetsmaske-/PMTiles-produksjon** → `tools/chart-pack`
  (`docs/specs/farbarhetsmaske.md`). Denne spec-en klargjør kun et tomt,
  stilsatt vektorlag klart til å ta imot en ekte PMTiles-kilde.
- **Robusthetspresentasjon, avgangstabell, GPX-eksport** → fase 4/5/6.
- **TWA/Bubblewrap-emballasje** → egen, senere, billig finish
  (`plattform-android-cloudflare.md` §2) — ikke del av skjelettet.
- **Formell ADR for F6.4s tilgangsmodell** — F6.4 ber eksplisitt om en ADR.
  §7 under er et **forslag bygget som reversibel default**, ikke den
  formelle beslutningen; Magnus bør beslutte dette skriftlig før noe
  sensitivt noensinne legges bak samme Worker.

## 3. Byggverktøy — vurdering og valg

**[FORESLÅTT] `apps/pwa`: Vite + vanilla TypeScript, ingen UI-rammeverk.**

| Alternativ | Vurdering |
|---|---|
| **Vite + vanilla TS (valgt)** | Én utvikler, appen er kart + skjemaer + tabeller — ikke en komponent-tung SPA med dyp tilstand. Vite gir rask dev-server, native ESM Web Worker-import (`new Worker(new URL(...), { type: "module" })`, ingen ekstra config), og null ekstra kjøretids-avhengighet utover det appen faktisk trenger (MapLibre). Minimum overflate å holde oppdatert i et solo-prosjekt. |
| React/Vue/Svelte | Vraket for nå — ingen av dem løser et reelt problem her ennå (ingen komponent-gjenbruk av betydning, ingen store reaktive tilstandstrær). Kart-tunge apper (MapLibre) drar sjelden nytte av virtual-DOM-lag rundt selve kartcanvaset uansett. Revurderes hvis UI-kompleksiteten i fase 4 (robusthetsvisning, avgangstabell) faktisk krever komponentgjenbruk — det er en `apps/pwa`-intern refaktorering, ikke en re-arkitektur, siden domenelogikken allerede ligger i `packages/`. |
| Create-React-App/annet | Ikke vurdert — Vite er de-facto standard nå, ingen grunn til eldre verktøy. |

**[FORESLÅTT] `apps/worker`: Cloudflare Workers via `wrangler`, hånd-rullet
ruting (ingen `itty-router`/`hono`).** Tre-fire ruter er for lite til å
begrunne en ny avhengighet (N4-ånden: minimer overflate); en `resolveRoute`-
switch er lett å enhetsteste uten en ruter-avhengighet i det hele tatt
(§6.4). Revurderes hvis rutetallet vokser vesentlig (batch-admin-ruter,
D1-CRUD for F6.1) — da er `hono` et rimelig, lett valg.

**Offline-lagring — [FORESLÅTT] hånd-rullet, ikke `idb-keyval`/`localForage`
i skjelettet ennå.** Skjelettet trenger ingen faktisk pakkelagring i denne
bølgen (§2); når bølge 2 kobler på ekte pakke-nedlasting, revurderes dette
konkret mot IndexedDB-skjemaets faktiske form (nøkler, indekser) — å legge
til et bibliotek da, med et ekte skjema foran seg, er en bedre avgjørelse
enn å gjette nå.

**PMTiles-biblioteket (`pmtiles`-npm-pakken) legges IKKE til ennå** — ADR-0001
har alt bestemt at PMTiles skal brukes, men `tools/chart-pack` produserer
ingen `.pmtiles`-fil i dag (bygger foreløpig GeoJSON/polygonalgebra, ingen
R2-publisering). Å legge til en klientavhengighet for et format vi ikke har
noen fil å lese ennå er unødig overflate. Vektorlaget i §5 er en tom
GeoJSON-kilde med en kommentar som peker hit; `pmtiles`-pakken legges til i
samme commit som den første ekte `.pmtiles`-filen kobles på.

**Ingen `vite-plugin-pwa`.** Manifest og service worker hånd-skrives
(§6.2/§6.3) — F1.9/F6.4s offline-krav er fortsatt i bevegelse (kommer i
bølge 2/3), og et plugin som genererer service worker-logikk automatisk
gjør Access-fellen (§7) og pakke-fallback-semantikken vanskeligere å se og
teste eksplisitt. Revurderes når offline-cache-strategien er stabil nok til
at generert boilerplate faktisk sparer noe.

## 4. Struktur

```
apps/
  pwa/
    index.html
    package.json
    vite.config.ts
    tsconfig.json            # DOM-lib, hovedtråden
    tsconfig.worker.json     # WebWorker-lib, rutemotor-workeren
    public/
      manifest.webmanifest
      icons/morild.svg
      sw.js                  # hånd-skrevet, ikke bygget av Vite
    src/
      main.ts                # bootstrap: kart + disclaimer + hello-route
      map.ts                 # MapLibre-oppsett, Kartverket-lag, vektor-lag
      kartverket-wmts.ts     # KVP-URL-bygging + addProtocol-adapter (§5.2)
      hello-route.ts          # starter workeren, tegner resultatet
      workers/
        routing.worker.ts    # laster @morild/routing, kjører golden-fikstur
      style.css
  worker/
    package.json
    wrangler.toml
    tsconfig.json
    src/
      index.ts               # fetch-handler, kobler rute → handler
      router.ts               # ren funksjon: pathname → Route (testbar)
      router.test.ts
      env.ts                  # Env-kontrakt (R2-binding, valgfri UA-override)
      cors.ts
      user-agent.ts
      user-agent.test.ts
      routes/
        healthz.ts
        pointer.ts
        blob.ts
        blob.test.ts
        metalerts.ts
```

## 5. `apps/pwa`

### 5.1 Kart (F1.8)

`map.ts` setter opp en MapLibre GL-instans med:

1. **Rasterkilde `kartverket-sjokartraster`** — Kartverkets WMTS-lag
   `sjokartraster` (verifisert mot `GetCapabilities` 2026-09-03: layer-id
   `sjokartraster`, stil `default`, format `image/png`, `TileMatrixSet`
   `webmercator`). **Attribusjon `© Kartverket` er satt på selve
   MapLibre-kilden** (`attribution: "© Kartverket"`), slik at den vises i
   kartets standard attribusjonskontroll og ikke kan forsvinne ved en
   fremtidig UI-refaktorering som glemmer en frittstående tekstboks.
2. **«Ikke for navigasjon»-disclaimer** — en fast, alltid-synlig HTML-stripe
   over/under kartflaten (ikke inni MapLibre-attribusjonen — den skal ikke
   kunne skjules bak et attribusjon-ikon), jf.
   `docs/legal/kartverket-sjokart-raster-wmts.md`.
3. **Tomt vektorlag `farbarhet` (GeoJSON, tom `FeatureCollection`)** — klar
   til å bli erstattet med en PMTiles-kilde når `tools/chart-pack` publiserer
   (§3). Lag-stilen (linje/fyll for usikre/farlige soner) er satt opp nå så
   fargevalget er testet visuelt, selv om det ikke tegner noe ennå.
4. **Hello-route-laget** — en GeoJSON `LineString`-kilde `hello-route`,
   tegnet når Web Workeren (§5.3) svarer.

### 5.2 Kartverket-WMTS uten padding-fellen

WMTS-en bruker **null-utfylte to-sifrede `TileMatrix`-identifikatorer for
zoom 0–9** (`"00"`..`"09"`) og vanlige tall fra 10 og opp (`"10"`..`"18"`) —
bekreftet mot den faktiske `GetCapabilities` 2026-09-03. MapLibres
`{z}/{x}/{y}`-tile-URL-mal støtter ikke betinget nullutfylling, så
`kartverket-wmts.ts` registrerer et `maplibregl.addProtocol("kvwmts", …)`
som fanger opp den allerede-substituerte `kvwmts://tile/{z}/{x}/{y}`-URL-en,
parser ut z/x/y, bygger den ekte KVP `GetTile`-URL-en med riktig
`tilematrix`-utfylling, og henter tilen selv. Kartverkets CDN sender
allerede `access-control-allow-origin: *` (verifisert), så dette er et rent
klient-side URL-oversettelsesproblem — **ingen server-side proxy eller
mellomlagring** (i tråd med `kartverket-sjokart-raster-wmts.md`s eksplisitte
forbud mot caching av WMTS-fliser før skriftlig avklaring).

### 5.3 Web Worker-hosting av `@morild/routing` (ADR-0002)

`routing.worker.ts` er en **modul-Web Worker** (`{ type: "module" }`) som
importerer `@morild/routing` direkte — ruteberegningen kjører aldri på
hovedtråden eller i `apps/worker`. Meldingsprotokollen er bevisst minimal
siden dette kun er «hello route»-beviset for at motoren faktisk kan lastes
og kjøres fra en nettleser-Worker-kontekst:

```ts
type ToWorker = { readonly type: "run-hello-route" };
type FromWorker =
  | {
      readonly type: "hello-route-result";
      readonly scenario: string;
      readonly purpose: string;
      readonly reached: boolean;
      readonly steps: readonly { lat: number; lon: number }[];
      readonly totals: { durationS: number; distanceNm: number };
    }
  | { readonly type: "error"; readonly message: string };
```

Workeren kjører `planRoute()` på **golden-fiksturen `skjaeloy-skagen-apent`**
(`@morild/routing`s `test-fixtures/golden-scenarios.js`, eksponert via en ny,
eksplisitt pakke-eksport — se §5.4) med syntetisk vær og en syntetisk
landmaske (samme input golden-testen bruker). Resultatet
(`RouteResult.steps`) er rene tall (lat/lon/tid) og krysser tilbake til
hovedtråden via vanlig `postMessage` (strukturert kloning er billig her —
resultatet er småt; dette er *ikke* det transferable-ArrayBuffer-mønsteret
`vaerpakker.md` §15 krever for kvantiserte feltbuffere, som ikke finnes i
denne bølgen).

Denne golden-fikstur-kjøringen er **midlertidig bevis**, ikke
produksjonsvei: når bølge 2/3 kobler på ekte vær-/farbarhetsdata, erstattes
`"run-hello-route"` med en ekte `"plan-route"`-melding som tar inn en faktisk
`RouteInput` bygget fra nedlastede pakker. Meldingsprotokollens form
(diskriminert union, plain-data-resultat) er ment å overleve det byttet.

### 5.4 Ny pakke-eksport i `@morild/routing` (dev/demo-bruk)

`packages/routing/package.json` får en ekstra, navngitt `exports`-oppføring:

```jsonc
"./test-fixtures/golden-scenarios": {
  "types": "./dist/test-fixtures/golden-scenarios.d.ts",
  "default": "./dist/test-fixtures/golden-scenarios.js"
}
```

Bevisst **én navngitt fil**, ikke en wildcard mot hele `test-fixtures/`-
mappen — golden-fiksturene er allerede ment å være stabile, dokumenterte
referansepunkter (samme disiplin som golden-testene selv), og en presis
eksport gjør det tydelig at dette IKKE er en generell invitasjon til å
importere testverktøy fra `apps/`.

### 5.5 PWA-manifest og service worker (F6.3, F1.9-forberedelse)

`public/manifest.webmanifest`: norsk `name`/`short_name`, `display:
"standalone"`, `start_url: "/"`, `background_color`/`theme_color`, ett
SVG-ikon (`purpose: "any"`). **Kjent gap:** kun SVG-ikon i denne bølgen —
Android/Chrome installasjons-UI foretrekker rasterikoner (PNG 192/512); PNG-
sett legges til før TWA-emballasje (§3) gjør dette til et krav, ikke en
kosmetisk mangel akkurat nå.

`public/sw.js` (hånd-skrevet, ikke bygget/transpilert — enkel nok til å leve
som ren JS) implementerer det minimale for at appen skal telle som
installerbar og faktisk fungere frakoblet på selve app-skallet **i denne
bølgen**, uten å late som om pakke-fetch-fallback (§2: ikke bygget ennå) alt
finnes:

- **Opportunistisk runtime-cache, ikke en forhåndsbygget precache-liste.**
  Statiske, hash-navngitte bygg-assets (`/assets/*.js`, `/assets/*.css` —
  Vites standard output-mønster, trygt cache-first siden innholdsendring
  alltid gir nytt filnavn) caches ved første treff og serveres deretter
  cache-først. Navigasjons-forespørsler (`index.html`) er nettverk-først
  med cache-fallback, slik at appen laster frakoblet etter første besøk
  online uten at service workeren må kjenne den nøyaktige, hash-navngitte
  fillisten på forhånd (unngår en build-tids precache-manifest-mekanisme
  denne bølgen ikke trenger).
- **Ingen spesialbehandling av `/pointer/`, `/blob/`, `/proxy/`-kall ennå**
  — appen gjør ingen slike kall før bølge 2/3 kobler på ekte pakke-fetch
  (§2). Når den koden skrives, er F6.4-kontrakten den MÅ oppfylle: et
  mislykket/blokkert API-kall (manglende nett, eller en fremtidig auth-vegg
  som svarer med noe som ikke er JSON, §7) skal falle tilbake til sist
  cachede/lagrede svar og gi et eksplisitt, synlig «ingen data» — aldri en
  krasjende `JSON.parse` på en HTML-innloggingsside. Dette skrives ned her
  som en **kontrakt for bølge 2**, ikke som kode som finnes ennå.
- **Ingen periodic background sync** — bevisst utelatt (upålitelig på tvers
  av Android/Chrome, `plattform-android-cloudflare.md` §1); synk skjer når
  appen er åpen.

## 6. `apps/worker`

### 6.1 Ansvar (ADR-0002)

`apps/worker` er **ren proxy/cache og pakke-peker** — ingen NetCDF-dekoding,
ingen kvantisering, ingen ruteberegning. Dette er identisk med
`vaerpakker.md` §14s prinsipp, generalisert til å dekke både vær- og
kartpakker under samme rutenavn (se §6.3).

### 6.2 Ruter

| Rute | Ansvar |
|---|---|
| `GET /healthz` | Selvsjekk (`{status:"ok", now}`) — **ikke** det samme som `vaerpakker.md` §13s batch-healthcheck (den er `tools/weather-pack` som pinger en ekstern `HEALTHCHECK_URL`); dette er Workerens egen liveness-rute. |
| `GET /pointer/:name` | Proxy for R2-objektet `pointer/<name>.json`. Kort levetid (`max-age=60`) — pekeren endres ved hver batch-kjøring. 404 er en gyldig, synlig tilstand (N2), ikke en feil som skjules. |
| `GET /blob/:key` | Proxy for et innholdsadressert R2-objekt. `:key` er hele nøkkelen slik pekeren oppgir den (f.eks. `weather/1/ab12….bin`), ikke bare hashen. Nøkkelen må ligge under et av de tillatte prefiksene (`weather/`, `charts/`) — Workeren er ikke en åpen R2-utforsker. Immutable cache (`max-age=31536000, immutable`) siden innholdsadressert data aldri endres under samme hash. |
| `GET /proxy/metalerts` | Proxy mot `api.met.no/weatherapi/metalerts/2.0/current.json` (F2.6) med riktig `User-Agent` (§6.5) og Workerens Cache API foran (§16 i `vaerpakker.md`). Kun `bbox`-parameteren videreføres — ingen generell query-passthrough mot et skjema vi ikke eier. |

### 6.3 Hvorfor `/pointer/:name`, ikke `/api/weather/pointer`

`docs/specs/vaerpakker.md` §14 spesifiserer `/api/weather/pointer` og
`/api/weather/blob/:contentHash` spesifikt for værpakker. Denne spec-en
velger en **generisk, pakketype-nøytral** rute (`/pointer/:name`,
`/blob/:key`) fordi R2-nøkkelmønsteret allerede er delt på tvers av vær- og
kartpakker (`pointer/vaer-skandinavia.json` og `pointer/skandinavia.json`,
jf. `farbarhetsmaske.md` §»Publiser til R2«) — én rute-familie, ikke en
`/api/weather/`- og en fremtidig `/api/charts/`-gren som må holdes i synk.
`vaerpakker.md`s semantikk (kompatibilitetssjekk, cache-header-regler,
kildestatus i header) er uendret; kun URL-formen er generalisert. **Dette
avviket fra §14s eksakte sti bør noteres i `vaerpakker.md`s endringslogg av
den som kobler på den ekte pakke-fetchen** (bølge 2), slik at spec-en og
koden ikke sier to forskjellige ting.

### 6.4 Testbarhet uten Worker-kjøretid

`router.ts` eksponerer en **ren funksjon** `resolveRoute(pathname: string):
Route` (diskriminert union) som `index.ts`s `fetch`-handler kaller inn i en
switch. Dette gjør rutingslogikken enhetstestbar med vanlig Vitest — uten
`miniflare`/`wrangler unstable_dev` som testavhengighet. Samme mønster for
`isAllowedBlobKey` (§6.2s prefiks-sjekk) og `userAgentFor` (§6.5). **Ikke
testet i denne bølgen:** faktisk R2-oppslag og faktisk MET-kall (krever
ekte/mocket Worker-runtime) — dokumentert som gap, ikke stille utelatt;
revurderes når `wrangler`s Vitest-integrasjon (`@cloudflare/vitest-pool-workers`)
er tatt i bruk et sted i prosjektet og mønsteret finnes å kopiere.

### 6.5 User-Agent og MET-vilkår (N3)

`user-agent.ts` har en **committet fallback-konstant**
(`morild-routeplanner/0.1.0 maasao@gmail.com`, formatet låst av
`docs/legal/met-norway-api.md`), med valgfri overstyring via
`env.MET_USER_AGENT` (satt som en ikke-hemmelig `[vars]`-verdi i
`wrangler.toml`, ikke en secret — selve UA-strengen skal jo være offentlig
identifiserende, ikke skjult). Dette er CLAUDE.md-prinsippet «alle
klient-miljøvariabler har committet fallback i kode» ført videre til
Worker-siden: mister `wrangler.toml`s `[vars]`-verdi seg ved en fremtidig
redeploy (BeatTheBingo-lærdommen), fungerer proxyen fortsatt korrekt med
fallback-konstanten — den blokkeres aldri av en tom/generisk UA-streng.

### 6.6 R2-binding — navn foreløpig antatt

`wrangler.toml` binder én delt bucket, `DATA_BUCKET`, mot en bucket navngitt
`morild-data` **[FORESLÅTT — ikke opprettet på Cloudflare-kontoen ennå]**.
`.dev.vars.example`s `R2_BUCKET_NAME` (brukt av `tools/weather-pack` sitt
API-baserte opplastingsskript) **må referere samme fysiske bucket** som
denne bindingen — se §8 Åpne spørsmål: dette bygges parallelt av en annen
agent-bølge (1C) og navnet er ikke koordinert på tvers ennå.

## 7. Cloudflare Access-fellen (F6.4) — foreslått løsning

**[FORESLÅTT, reversibel default; F6.4 ber eksplisitt om en formell ADR før
noe sensitivt legges bak dette Worker-et.]**

**Valg: ingen Cloudflare Access (eller annen interaktiv innloggingsvegg) på
`GET /pointer/*`, `GET /blob/*`, `GET /proxy/metalerts`, `GET /healthz`.**
Disse dataene er ikke sensitive — de er speil av allerede-offentlige
værdata (MET, CC BY 4.0) og av kartdata Magnus selv har all rett til å
publisere (Kartverket CC BY 4.0, egen prosessering). Kostnaden ved å la dem
være helt åpne (Cloudflare-egress på gratis-/lavtrafikk-nivå for én bruker)
er neglisjerbar, og gevinsten er at F6.4s kjente felle blir **strukturelt
umulig**, ikke bare unngått ved forsiktig implementasjon: en
service-worker-drevet bakgrunnsoppdatering eller en cache-refresh mens
appen er lukket kan aldri blokkeres av en utløpt interaktiv økt, fordi det
ikke finnes noen økt å utløpe.

**Hvis misbruk/kostnad noensinne blir reelt:** riktig verktøy er
Cloudflares **rate-limiting-regler** (WAF), ikke Access — en rate-limit
svarer med en normal HTTP 429 som appens `fetch`-feilhåndtering (§5.5) alt
er bygget for å tolke som «prøv cache», mens Access svarer med en
HTML-omdirigering til en innloggingsside som ville brutt `JSON.parse`/
binærparsing utenom en spesialtilpasset feilbane. Dette er selve
begrunnelsen for at «ingen Access på lese-rutene» er en trygg default, ikke
en snarvei: den unngår en hel klasse feilmodus, ikke bare denne
implementasjonens variant av den.

**Skrive-/administrasjonsruter (fremtidig, ikke bygget i denne bølgen)** —
f.eks. en fremtidig admin-rute for å trigge en re-publisering manuelt — er
IKKE brukervendte og kan trygt ligge bak Access eller en enkel delt
API-nøkkel uten å røre F6.4s garanti, siden appen (og dermed offline-
brukeren) aldri kaller dem.

## 8. Secrets og deploy

`.dev.vars.example` er uendret i denne bølgen (ingen nye hemmeligheter —
`MET_USER_AGENT` er en `[vars]`-verdi i `wrangler.toml`, ikke en secret, jf.
§6.5). Deploy-flyt:

- `apps/pwa`: `vite build` → statiske filer i `apps/pwa/dist/` → Cloudflare
  Pages (koblet mot repoet, bygg-kommando `pnpm --filter @morild/pwa build`,
  output-mappe `apps/pwa/dist`). **[FORESLÅTT]** Pages-prosjektnavn og
  custom-domain er ikke satt opp i denne bølgen — første deploy bruker
  Pages' genererte `*.pages.dev`-URL.
- `apps/worker`: `wrangler deploy` fra `apps/worker/`. R2-bucketen (§6.6) må
  opprettes manuelt (`wrangler r2 bucket create morild-data`) før første
  deploy — `wrangler dev` bruker en lokal R2-simulering og trenger den ikke.
- Rot: `pnpm dev` starter **begge** samtidig (`concurrently` — se §9 for
  hvorfor dette er det ene stedet en ny, liten dev-avhengighet faktisk er
  begrunnet: uten den må Magnus åpne to terminaler manuelt hver gang, og
  det er nøyaktig den typen friksjon som får en soloutvikler til å slutte å
  kjøre `pnpm dev` i det hele tatt).

I dev peker `apps/pwa`s Vite-server `/pointer`, `/blob`, `/proxy`, `/healthz`
til `http://127.0.0.1:8787` (wrangler dev) via Vites `server.proxy` — dette
unngår CORS i utvikling helt uten å måtte resonnere om det. I produksjon
(ulike opphav: Pages-domene vs. Workers-domene) setter Workeren
`access-control-allow-origin: *` på alle disse (offentlige, ikke-sensitive)
rutene (§7).

## 9. Ny rot-avhengighet: `concurrently`

**[FORESLÅTT]** Eneste nye avhengighet denne bølgen legger til utover det
hver app selvsagt trenger (Vite, MapLibre, Wrangler, `@cloudflare/workers-types`):
`concurrently` som rot-devDependency, brukt kun av `pnpm dev` til å starte
`apps/pwa`s Vite-server og `apps/worker`s `wrangler dev` side om side med
lesbar, fargekodet, prefikset output. Vurdert og vraket: et hånd-skrevet
bash/PowerShell-script som backgrounder to prosesser — mer kode å
vedlikeholde på tvers av to shell-dialekter (prosjektet kjører på Windows,
jf. miljøet) for noe en 400 kB, null-avhengighets npm-pakke løser robust.

## 10. Testkrav (denne bølgen)

1. `apps/worker/src/router.test.ts` — `resolveRoute` for alle fem rute-
   formene + en ukjent sti.
2. `apps/worker/src/routes/blob.test.ts` — `isAllowedBlobKey`: tillatte
   prefikser slipper gjennom, `..`-forsøk og andre prefikser avvises.
3. `apps/worker/src/user-agent.test.ts` — fallback brukes når `env` mangler
   verdien; `env`-verdien brukes (trimmet) når den finnes.
4. `pnpm check` (typesjekk strict + eslint) grønt på tvers av `apps/pwa` og
   `apps/worker`, inkl. project-reference-oppsettet for
   `tsconfig.worker.json` (§4).
5. **Manuell verifikasjon** (dokumentert i sesjonsrapporten, ikke
   automatisert i denne bølgen): `pnpm dev` starter begge prosessene, kartet
   viser Kartverket-sjøkart over Skjæløy/Skagerrak med attribusjon og
   disclaimer synlig, og «hello route»-linjen tegnes etter at
   `routing.worker.ts` har svart.

## 11. Åpne spørsmål (til Magnus / til bølge 2-agenten)

1. **R2-bucketnavn** (§6.6) — `morild-data` er en antagelse, ikke
   koordinert med bølge 1C (`tools/weather-pack`s `.dev.vars.example`-bruk
   av `R2_BUCKET_NAME`). Må rettes til samme streng begge steder før første
   ekte deploy.
2. **F6.4s formelle ADR** — §7s «ingen Access på lese-ruter» er en
   anbefaling bygget som reversibel default, ikke den beslutningen F6.4
   ber om. Bør formaliseres (kort ADR, siden begrunnelsen alt er skrevet
   ut her) før noe skrivende/sensitivt API legges til samme Worker.
3. **`vaerpakker.md` §14s sti-avvik** (§6.3) — spec-en sier `/api/weather/…`,
   koden sier `/pointer/…`/`/blob/…`. Bør rettes i `vaerpakker.md`s
   endringslogg av den som bygger bølge 2, ikke la de to dokumentene si
   ulike ting stille.
4. **PWA-ikonsett** (§5.5) — kun SVG i denne bølgen; PNG-rastere (192/512,
   maskable) legges til når TWA-emballasje blir aktuelt eller når Magnus
   faktisk installerer appen på et Android-nettbrett og opplever
   ikon-fallback som et reelt problem.

## 12. Endringslogg

- 2026-09-03: Første versjon (plattform-agenten, fase 3 bølge 1D).
