# Spec: app-skjelett (`apps/pwa`, `apps/worker`)

> **Status: foreslått av plattform-agenten 2026-09-03, bygget på anbefalingen
> (CLAUDE.md: «fortsett autonomt», reversible valg).** Punkter merket
> **[BESLUTTET 2026-09-03, se ADR-0006 og kravspek-endringslogg]** er arkitekturvalg med varig konsekvens innenfor rammen
> ADR-0001/ADR-0002 allerede har satt (monorepo, TS strict, MapLibre +
> PMTiles, Cloudflare Pages + Workers + R2, klienten beregner). De er ikke
> nye ADR-er i seg selv — de er implementasjonsvalg *innenfor* de vedtatte
> ADR-ene — men flagges fordi de er dyre å reversere i praksis. Magnus kan
> overstyre hvert enkelt uten at resten av skjelettet må bygges om.

- Dato: 2026-09-03
- Fase: 3, bølge 1D (`docs/research/fase3-plan-2026-09-02.md`)
- Pakker: `apps/pwa`, `apps/worker`

> **Oppdatering 2026-09-03 (fase 3 bølge 2B, plattform-agenten):**
> `docs/decisions/ADR-0006-tilgangsmodell.md` er vedtatt og implementert i
> `apps/worker` — §6.2/§6.3/§6.6/§7 under er oppdatert til å reflektere
> dette (to bindinger, MetAlerts D2, interim CORS-flagg, rate-limit-regel).
> Se §12 for detaljer og `docs/specs/vaerpakker.md` §19s tilsvarende
> oppføring (D4 spec-drift lukket samtidig).

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

**[BESLUTTET 2026-09-03, se ADR-0006 og kravspek-endringslogg] `apps/pwa`: Vite + vanilla TypeScript, ingen UI-rammeverk.**

| Alternativ | Vurdering |
|---|---|
| **Vite + vanilla TS (valgt)** | Én utvikler, appen er kart + skjemaer + tabeller — ikke en komponent-tung SPA med dyp tilstand. Vite gir rask dev-server, native ESM Web Worker-import (`new Worker(new URL(...), { type: "module" })`, ingen ekstra config), og null ekstra kjøretids-avhengighet utover det appen faktisk trenger (MapLibre). Minimum overflate å holde oppdatert i et solo-prosjekt. |
| React/Vue/Svelte | Vraket for nå — ingen av dem løser et reelt problem her ennå (ingen komponent-gjenbruk av betydning, ingen store reaktive tilstandstrær). Kart-tunge apper (MapLibre) drar sjelden nytte av virtual-DOM-lag rundt selve kartcanvaset uansett. Revurderes hvis UI-kompleksiteten i fase 4 (robusthetsvisning, avgangstabell) faktisk krever komponentgjenbruk — det er en `apps/pwa`-intern refaktorering, ikke en re-arkitektur, siden domenelogikken allerede ligger i `packages/`. |
| Create-React-App/annet | Ikke vurdert — Vite er de-facto standard nå, ingen grunn til eldre verktøy. |

**[BESLUTTET 2026-09-03, se ADR-0006 og kravspek-endringslogg] `apps/worker`: Cloudflare Workers via `wrangler`, hånd-rullet
ruting (ingen `itty-router`/`hono`).** Tre-fire ruter er for lite til å
begrunne en ny avhengighet (N4-ånden: minimer overflate); en `resolveRoute`-
switch er lett å enhetsteste uten en ruter-avhengighet i det hele tatt
(§6.4). Revurderes hvis rutetallet vokser vesentlig (batch-admin-ruter,
D1-CRUD for F6.1) — da er `hono` et rimelig, lett valg.

**Offline-lagring — [BESLUTTET 2026-09-03, se ADR-0006 og kravspek-endringslogg] hånd-rullet, ikke `idb-keyval`/`localForage`
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
| `GET /healthz` | Selvsjekk (`{status:"ok", now, bindings: {mirrorBucket, personalDb, metalertsRateLimiter}}`) — **ikke** det samme som `vaerpakker.md` §13s batch-healthcheck (den er `tools/weather-pack` som pinger en ekstern `HEALTHCHECK_URL`); dette er Workerens egen liveness-rute. `bindings`-feltet er lagt til i bølge 2B (ADR-0006 Bekreftelse): rapporterer KUN tilstedeværelse (`true`/`false`) for begge bindinger, aldri innhold. |
| `GET /pointer/:name` | Proxy for R2-objektet `pointer/<name>.json` fra det **offentlige speilet** (`MIRROR_BUCKET`, §6.6). Kort levetid (`max-age=60`) — pekeren endres ved hver batch-kjøring. 404 er en gyldig, synlig tilstand (N2), ikke en feil som skjules. |
| `GET /blob/:key` | Proxy for et innholdsadressert R2-objekt fra `MIRROR_BUCKET`. `:key` er hele nøkkelen slik pekeren oppgir den (f.eks. `weather/1/ab12….bin`), ikke bare hashen. Nøkkelen må ligge under et av de tillatte prefiksene (`weather/`, `charts/`) — Workeren er ikke en åpen R2-utforsker. Nøkler utenfor disse prefiksene (bl.a. en fremtidig `routes/`-personlig-prefiks) gir **404**, identisk med et ekte R2-miss — ikke en 400 som avslører at et filtrert lag finnes (ADR-0006 Bekreftelse, bølge 2B). Immutable cache (`max-age=31536000, immutable`) pluss en Workers edge-cache (`caches.default`, bølge 2B review-funn) siden innholdsadressert data aldri endres under samme hash. |
| `GET /proxy/metalerts` | Proxy mot `api.met.no/weatherapi/metalerts/2.0/current.json` (F2.6) med riktig `User-Agent` (§6.5) og Workerens Cache API foran (§16 i `vaerpakker.md`). **D2 (ADR-0006 pkt. 4, bølge 2B):** ingen query-parametre videreføres lenger (den tidligere `bbox`-passthroughen var reelt en klientstyrt cache-buster) — henter alltid hele Skandinavia-settet, filtrering skjer i klienten. Svarer med to ekstra headere: `fetched-at` (ISO 8601, når innholdet sist ble bekreftet mot MET) og `source-status` (`"ok"`/reservert `"degraded"`). Beskyttet av én Cloudflare rate-limit-regel (`METALERTS_RATE_LIMITER`, misbruksvern). Se `vaerpakker.md` §14 for full kontrakt. |

### 6.3 Hvorfor `/pointer/:name`, ikke `/api/weather/pointer`

`docs/specs/vaerpakker.md` §14 spesifiserte tidligere `/api/weather/pointer`
og `/api/weather/blob/:contentHash` for værpakker spesifikt. Denne spec-en
valgte en **generisk, pakketype-nøytral** rute (`/pointer/:name`,
`/blob/:key`) fordi R2-nøkkelmønsteret allerede er delt på tvers av vær- og
kartpakker (`pointer/vaer-skandinavia.json` og `pointer/skandinavia.json`,
jf. `farbarhetsmaske.md` §»Publiser til R2«) — én rute-familie, ikke en
`/api/weather/`- og en fremtidig `/api/charts/`-gren som må holdes i synk.
`vaerpakker.md`s semantikk (kompatibilitetssjekk, cache-header-regler,
kildestatus i header) er uendret; kun URL-formen er generalisert.
**Rettet 2026-09-03 (D4, bølge 2B):** avviket er nå lukket —
`vaerpakker.md` §14 er oppdatert til å bruke de samme stiene som koden,
slik at de to dokumentene ikke lenger sier to forskjellige ting.

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

### 6.6 To bindinger (ADR-0006, oppdatert bølge 2B)

**Rettet 2026-09-03:** denne seksjonen beskrev tidligere én delt bucket
(`DATA_BUCKET`/`morild-data`) foreslått, ikke besluttet. ADR-0006 (vedtatt)
krever to STRUKTURELT atskilte bindinger, satt opp i `wrangler.toml` i
bølge 2B:

1. **`MIRROR_BUCKET`** (R2, bucket `morild-mirror`, `**IKKE opprettet på
   Cloudflare-kontoen ennå**`) — det offentlige speilet: `pointer/*`,
   `weather/*`, `charts/*`. Dette er bindingen `/pointer/` og `/blob/`
   faktisk leser fra. Omdøpt fra `morild-data`/`DATA_BUCKET` i denne bølgen
   for å gjøre skillet mot punkt 2 tydelig i selve navnet — ingen ekte
   bucket eksisterte fra før, så omdøpingen koster ingenting.
   `.dev.vars.example`s `R2_BUCKET_NAME` (brukt av `tools/weather-pack` sitt
   opplastingsskript) **må peke på samme fysiske bucket-navn**
   (`morild-mirror`) — se §11 punkt 1, fortsatt ikke koordinert på tvers av
   agent-bølgene i kode/verdi (kun i denne dokumentasjonen).
2. **`PERSONAL_DB`** (D1, database `morild-personal`, **ikke opprettet
   ennå**) — ruter, analyser, innstillinger, havnebok, F6.1-synk. Tom i
   denne fasen. **Valgt D1, ikke enda en R2-bøtte:** en D1-binding er en
   helt annen kodesti (SQL-spørringer over `D1Database`) enn
   `R2Bucket.get()`, så det finnes strukturelt ingen "legg til én prefiks
   til"-snarvei fra `/blob/`s `ALLOWED_BLOB_PREFIXES` inn til personlige
   data — nøyaktig vane-risikoen ADR-0006s «Alternativer vurdert» advarer
   mot for «én binding + prefiksliste». En sekundær R2-bøtte ville vært en
   svakere grense: samme API-form (`.get()`/`.put()`) gjør det trivielt å
   ved et uhell wire’e en fremtidig admin-rute til feil bøtte uten at
   typesystemet sier ifra. D1s relasjonelle form passer også bedre til
   havnebokens planlagte-avgang-poster og innstillinger enn frittstående
   blobber. `apps/worker/src/env.ts` typer `PERSONAL_DB` som `D1Database`,
   men INGEN offentlig rute (`/pointer/`, `/blob/`, `/proxy/metalerts`,
   `/healthz`) importerer eller kaller den — kun `/healthz` sjekker at
   bindingen finnes (`Boolean(env.PERSONAL_DB)`), uten å lese fra den.

`wrangler.toml`s `database_id` for `PERSONAL_DB` er en plassholder-UUID
inntil databasen er opprettet manuelt — se rapporten til Magnus for det
konkrete `wrangler d1 create`-steget.

## 7. Cloudflare Access-fellen (F6.4) — løsning

**[BESLUTTET 2026-09-03, se `docs/decisions/ADR-0006-tilgangsmodell.md`
(vedtatt) og kravspek-endringslogg.]** Det som fulgte var opprinnelig
skrevet som «foreslått, reversibel default»; ADR-0006 formaliserte nettopp
DENNE begrunnelsen, med én skjerpelse: «ingen Access på lese-rutene» gjelder
kun så lenge de rutene KUN server det offentlige speilet (§6.6 punkt 1).
Personlige data (§6.6 punkt 2, `PERSONAL_DB`) ligger på en strukturelt
atskilt binding ingen av disse rutene kan nå, nettopp for at denne
argumentasjonen skal fortsette å holde når F6.1-synk kommer i fase 5 — se
ADR-0006s «Kontekst» for hvorfor «én binding + prefiksliste» ble vraket som
varig modell.

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
Cloudflares **rate-limiting-regler**, ikke Access — en rate-limit svarer med
en normal HTTP 429 som appens `fetch`-feilhåndtering (§5.5) alt er bygget
for å tolke som «prøv cache», mens Access svarer med en HTML-omdirigering
til en innloggingsside som ville brutt `JSON.parse`/binærparsing utenom en
spesialtilpasset feilbane. Dette er selve begrunnelsen for at «ingen Access
på lese-rutene» er en trygg default, ikke en snarvei: den unngår en hel
klasse feilmodus, ikke bare denne implementasjonens variant av den.
**Implementert i bølge 2B (ADR-0006 pkt. 4):** `/proxy/metalerts` har fått
nøyaktig denne rate-limit-regelen (`METALERTS_RATE_LIMITER`,
`apps/worker/wrangler.toml` `[[ratelimits]]`) — ikke som svar på reelt
misbruk ennå, men fordi MetAlerts er den ene ruten som videreformidler mot
en tredjepart (MET) under Morilds identitet, og D2 identifiserte den som
utsatt (§14 i `vaerpakker.md`). `/pointer/`, `/blob/` og `/healthz` har
ingen tilsvarende regel — de treffer bare R2/ingen ekstern part og er derfor
lavere risiko for selv-DoS av Workers-kvoten enn en gjentatt MET-fetch.

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
  output-mappe `apps/pwa/dist`). **[BESLUTTET 2026-09-03, se ADR-0006 og kravspek-endringslogg]** Pages-prosjektnavn og
  custom-domain er ikke satt opp i denne bølgen — første deploy bruker
  Pages' genererte `*.pages.dev`-URL.
- `apps/worker`: `wrangler deploy` fra `apps/worker/`. Før første ekte
  deploy må Magnus manuelt (§6.6, ADR-0006):
  1. `wrangler r2 bucket create morild-mirror` (det offentlige speilet).
  2. `wrangler d1 create morild-personal`, og lime den utskrevne
     `database_id`-en inn i `apps/worker/wrangler.toml`s `[[d1_databases]]`
     i stedet for plassholder-UUID-en.
  3. Bekrefte at Rate Limiting-bindingen (`[[ratelimits]]`) faktisk
     aksepteres på kontoens plannivå ved `wrangler deploy` — den er antatt
     gratisplan-kompatibel (Workers Runtime API, ikke et eget betalt
     produkt), men ikke verifisert mot en ekte konto i denne bølgen (kun
     lokal `wrangler dev`-simulering, se sesjonsrapporten).
  `wrangler dev` bruker lokale simuleringer av alle tre og trenger ingen av
  dem opprettet på forhånd.
- **`/api/*` under Pages-domenet (ADR-0006 pkt. 3, ikke aktivert ennå):**
  krever at Magnus legger et ekte domene til Cloudflare som DNS-sone (Pages'
  genererte `*.pages.dev` støtter ikke Workers Routes). Når det domenet
  finnes, fyll inn `wrangler.toml`s utkommenterte `[[routes]]`-blokk (§6.6)
  og sett `INTERIM_CORS_ANY_ORIGIN = "false"` i samme commit.
- Rot: `pnpm dev` starter **begge** samtidig (`concurrently` — se §9 for
  hvorfor dette er det ene stedet en ny, liten dev-avhengighet faktisk er
  begrunnet: uten den må Magnus åpne to terminaler manuelt hver gang, og
  det er nøyaktig den typen friksjon som får en soloutvikler til å slutte å
  kjøre `pnpm dev` i det hele tatt).

I dev peker `apps/pwa`s Vite-server `/pointer`, `/blob`, `/proxy`, `/healthz`
til `http://127.0.0.1:8787` (wrangler dev) via Vites `server.proxy` — dette
unngår CORS i utvikling helt uten å måtte resonnere om det. **Oppdatert
bølge 2B:** i produksjon (inntil `/api/*`-monteringen over er på plass) er
`access-control-allow-origin: *` på disse (offentlige, ikke-sensitive)
rutene styrt av `env.INTERIM_CORS_ANY_ORIGIN` (satt til `"true"` i
`wrangler.toml` som en eksplisitt, daterbar interim-tilstand — ikke
lenger en ubetinget statisk header, §7/`cors.ts`).

## 9. Ny rot-avhengighet: `concurrently`

**[BESLUTTET 2026-09-03, se ADR-0006 og kravspek-endringslogg]** Eneste nye avhengighet denne bølgen legger til utover det
hver app selvsagt trenger (Vite, MapLibre, Wrangler, `@cloudflare/workers-types`):
`concurrently` som rot-devDependency, brukt kun av `pnpm dev` til å starte
`apps/pwa`s Vite-server og `apps/worker`s `wrangler dev` side om side med
lesbar, fargekodet, prefikset output. Vurdert og vraket: et hånd-skrevet
bash/PowerShell-script som backgrounder to prosesser — mer kode å
vedlikeholde på tvers av to shell-dialekter (prosjektet kjører på Windows,
jf. miljøet) for noe en 400 kB, null-avhengighets npm-pakke løser robust.

## 10. Testkrav

**Bølge 1D:**

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

**Bølge 2B (ADR-0006/D2/D4) lagt til:**

6. `apps/worker/src/routes/blob.test.ts` — `handleBlob` (ikke bare den rene
   `isAllowedBlobKey`): en nøkkel utenfor tillatte prefikser gir 404 med tom
   kropp (identisk med et ekte miss, ADR-0006 Bekreftelse), og edge-cachen
   (`caches.default`) betjener et andre, likt kall uten nytt R2-oppslag.
7. `apps/worker/src/routes/metalerts.test.ts` — en `bbox`-parameter på
   klientforespørselen videreføres IKKE mot MET (D2); `fetched-at`/
   `source-status`-headerne er satt; rate-limit-bindingen gir 429 uten å
   kalle `fetch` når den sier nei, og proxyen fungerer identisk (ærlig
   fallback) når bindingen mangler helt.
8. **Manuell verifikasjon** (dokumentert i sesjonsrapporten): `wrangler dev`
   simulerer alle tre nye/endrede bindinger (`MIRROR_BUCKET`, `PERSONAL_DB`,
   `METALERTS_RATE_LIMITER`) lokalt; `/healthz` rapporterer alle tre som
   `true`; `curl` mot `/blob/routes/...` gir 404; 21+ raske kall mot
   `/proxy/metalerts` trigger faktisk 429 lokalt.

## 11. Åpne spørsmål (til Magnus / til bølge 3-agenten)

1. **R2-bucketnavn koordinering** (§6.6) — bucketen er omdøpt til
   `morild-mirror` i denne dokumentasjonen og i `apps/worker/wrangler.toml`,
   men `tools/weather-pack`s `.dev.vars.example`-bruk av `R2_BUCKET_NAME`
   er IKKE rørt i denne bølgen (utenfor mandatet — `tools/` eies av en
   annen agent-bølge). Verdien Magnus setter i sin lokale `.dev.vars` for
   `R2_BUCKET_NAME` må være `morild-mirror`, ikke `morild-data`, før noen
   ekte opplasting kjøres.
2. ~~F6.4s formelle ADR~~ — **Lukket 2026-09-03:** `ADR-0006-tilgangsmodell.md`
   vedtatt og implementert (§7, §6.6).
3. ~~`vaerpakker.md` §14s sti-avvik~~ — **Lukket 2026-09-03 (D4):** rettet i
   `vaerpakker.md` §14/§19 og denne spec-ens §6.3.
4. **PWA-ikonsett** (§5.5) — kun SVG i denne bølgen; PNG-rastere (192/512,
   maskable) legges til når TWA-emballasje blir aktuelt eller når Magnus
   faktisk installerer appen på et Android-nettbrett og opplever
   ikon-fallback som et reelt problem.
5. **Rate Limiting-bindingens plannivå** (§8) — antatt gratisplan-
   kompatibel (Workers Runtime API-binding), men ikke bekreftet mot en ekte
   Cloudflare-konto; kun lokal `wrangler dev`-simulering er verifisert i
   denne bølgen. Bekreftes ved første `wrangler deploy`.
6. **`/api/*`-montering under Pages-domenet** (ADR-0006 pkt. 3, §6.6/§8) —
   krever et ekte domene lagt til Cloudflare som DNS-sone. Ikke gjort i
   denne bølgen; `wrangler.toml` har en utkommentert `[[routes]]`-blokk
   klar til å fylles inn.
7. **MetAlerts-fallback ved MET-utilgjengelighet** (`source-status:
   "degraded"`, `vaerpakker.md` §14) — reservert verdi, ikke implementert.
   I dag propagerer en MET-feil (nettverksfeil, 5xx) rett til klienten i
   stedet for å falle tilbake til `record`-oppføringen. Dokumentert gap,
   ikke stille utelatt; naturlig neste steg for MetAlerts-ruten.

## 12. Endringslogg

- 2026-09-03: Første versjon (plattform-agenten, fase 3 bølge 1D).
- 2026-09-03 (2) — fase 3 bølge 2B (plattform-agenten): ADR-0006
  implementert. `apps/worker` fikk to bindinger (`MIRROR_BUCKET` R2,
  `PERSONAL_DB` D1 — se §6.6), MetAlerts-proxyen mistet `bbox`-passthrough
  og fikk `fetched-at`/`source-status`-headere + én rate-limit-regel (D2,
  §6.2/§7), CORS `*` ble gjort betinget av `INTERIM_CORS_ANY_ORIGIN` med
  `[[routes]]`-forberedelse for `/api/*` under Pages-domenet (§8),
  `/blob/` fikk edge-cache og svarer 404 (ikke 400) for strukturelt
  avviste nøkler (§6.2). `vaerpakker.md` §14s sti-avvik lukket (D4). Se
  `docs/decisions/ADR-0006-tilgangsmodell.md` og `vaerpakker.md` §19.
