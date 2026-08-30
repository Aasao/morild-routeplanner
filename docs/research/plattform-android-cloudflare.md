# Teknisk research: App-plattform for personlig maritim ruteplanlegger (Android, Cloudflare-hosting)

> Research utført 2026-08-30 av plattform-researchagent. Grunnlag for kravspek og ADR-er.

## Kontekst og forutsetninger

Én bruker, Android telefon/nettbrett, ingen krav om Play Store, men skal "føles som en app" (installerbar, ikon, fullskjerm, offline-kapabel). Hosting på egen Cloudflare-konto. Vurderer PWA → TWA → Capacitor som eskaleringsstige, og hvordan Cloudflare-stacken deles mellom værdata, kartdata og ruteberegning.

---

## 1. PWA på Cloudflare Pages

**Styrker:** Cloudflare Pages er en naturlig vert for en installerbar PWA — statisk build, Workers-integrasjon for API-ruter, service worker for offline-cache av kart-tiles og værdata i Cache Storage/IndexedDB. Installasjon på Android Chrome gir egen launcher-ikon og fullskjerm (`display: standalone`), som dekker "føles som en app" for det meste av bruken.

**Reelle begrensninger på Android (bekreftet):**
- **Bakgrunns-GPS:** Ingen vei til geolokasjon fra en *inaktiv* service worker eller lukket faneflik. Dette har vært et lenge etterspurt, men aldri levert, web-API — PWA-er kan ikke konkurrere med native apper på dette punktet ([MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)). Så lenge appen er åpen i forgrunn (skjerm på, fane aktiv) fungerer vanlig `Geolocation.watchPosition` fint — det er *bakgrunnssporing* (skjerm av, app minimert) som ikke er mulig.
- **Wake Lock:** `Screen Wake Lock API` fungerer, men lock'en slippes automatisk så snart fanen minimeres, skjermen låses, eller brukeren bytter app — den kan ikke holde GPS/beregning i live i bakgrunnen, kun holde skjermen våken mens appen er i forgrunn.
- **Periodic Background Sync** finnes som konsept for periodisk databakgrunnsoppdatering, men er begrenset og upålitelig på tvers av Android/Chrome-versjoner i praksis.
- **Filsystem:** Origin Private File System (OPFS) og File System Access API gir god nok lokal lagring for kartpakker/GRIB-avledede felt uten native filsystemtilgang.

**Konklusjon for PWA:** Fullt tilstrekkelig for *planlegging* (se rute, sjekk vær, se kart) mens appen er åpen. Utilstrekkelig for *sanntids track-logging i bakgrunn under seiling* (skjerm av, i lomme) — det er her grensen mot Capacitor går.

Kilder: [MDN – Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation), [Android background location limits](https://developer.android.com/about/versions/oreo/background-location-limits)

---

## 2. TWA / Bubblewrap

TWA pakker PWA-en i en tynn Android-aktivitet (Chrome Custom Tab uten adressefelt) og krever en **live, gyldig HTTPS-URL med Digital Asset Links-verifisering** — ikke en offline/lokal bygg ([Android Developers – TWA guide](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2)). Bubblewrap CLI genererer en signert APK som **kan sideloades direkte via adb eller filoverføring, uten Play Store** ([Bubblewrap npm](https://www.npmjs.com/package/@bubblewrap/cli), [bubblewrap README](https://github.com/GoogleChromeLabs/bubblewrap/blob/main/packages/cli/README.md)).

**Vurdering:** TWA løser *ingenting teknisk* utover ren PWA — samme JS-motor (Chrome), samme API-begrensninger (ingen bakgrunns-GPS). Det den gir er: eget app-ikon uten nettleser-UI, egen prosess i "nylige apper", og mulighet for enkelte kun-Play-Store-plugins (ikke relevant her siden sideloading er greit). For en soloutvikler er gevinsten marginal med mindre man vil ha "ekte app-følelse" i app-switcher uten Capacitor-kompleksiteten. Det er billig å sette opp (én `bubblewrap build` i CI) og kan gjøres senere uten arkitekturendring — ren emballasje rundt den samme PWA-en.

---

## 3. Capacitor — når trengs det?

Capacitor gir tilgang til native plugins via WebView-bro. De konkrete pluginene som løser det PWA ikke kan:

- **Bakgrunns-geolokasjon:** flere aktive Capacitor-plugins finnes (Capawesome, Cap-go, capacitor-community), som kjører en Android **foreground service** med vedvarende notification for å holde GPS-sporing i live med skjerm av — dette er den native mekanismen PWA-standarden bevisst ikke gir tilgang til. Capawesome sin variant har HTTP-sync med SQLite-kø og retry ([capawesome.io](https://capawesome.io/docs/sdks/capacitor/background-geolocation/), [capacitor-community/background-geolocation](https://github.com/capacitor-community/background-geolocation)).
- **Bluetooth mot båtinstrumenter (NMEA 0183/2000 over BLE, AIS-mottakere etc.):** Web Bluetooth finnes i Chrome for Android og kan faktisk dekke mye *mens appen er åpen* — men stabil bakgrunnstilkobling og enkelte lavnivå GATT-mønstre er triveligere og mer robuste via native Bluetooth-plugin i Capacitor.
- **Bedre offline-lagring:** Capacitor gir ekte filsystemtilgang (SD-kort, delt lagring) utover det en sandkassa OPFS/IndexedDB tillater, nyttig for store kartpakker.

**Anbefaling:** Ikke bygg Capacitor-skallet før du faktisk trenger *live sporing under seiling med skjermen av* eller *direkte instrumentkobling*. Start som PWA (raskest å iterere, ingen native buildpipeline), og legg Capacitor rundt samme webapp-kode den dagen bakgrunns-GPS eller BLE-instrumenter blir et reelt behov — det er en emballasje-endring, ikke en omskriving, forutsatt at appen allerede er bygget med et abstraksjonslag mot geolokasjon/BLE (se anbefalt arkitektur).

---

## 4. Cloudflare-stack — ansvarsfordeling

| Behov | Tjeneste | Begrunnelse |
|---|---|---|
| Værdata-proxy m/caching | **Worker + Cache API / KV** | Cache MET Norway-responser (Locationforecast/MEPS) med kort TTL i Workers Cache API foran opphavet; KV for lengre-levde, sjelden-endrede nøkkelverdi-data (f.eks. siste ensemble-metadata). Unngår at klienten treffer met.no direkte og bryter rate-limit/User-Agent-krav. |
| Forhåndsprosessering av kartdata (farbarhetsmaske) | **Cron Trigger → Worker/D1/R2**, tungt arbeid i egen batch (Node/lokalt eller Worker med god tidsmargin) | Farbarhetsmaske fra dybdedata er en engangs/sjelden-jobb per kartutsnitt — egner seg dårlig i en enkelt HTTP-request, men fint som en cron-drevet jobb som skriver ferdig prosesserte GeoJSON/rasterfelt til R2. |
| Ensemble-nedhenting på cron | **Cron Trigger (opptil 3 per Worker) eller Durable Object alarm** | DO alarms er finkornede og isolerer feil per jobb/område, med garantert at-least-once og automatisk retry m/backoff ([Cloudflare blogg – DO alarms](https://blog.cloudflare.com/durable-objects-alarms/)); for én bruker holder trolig ren Cron Trigger. |
| Ruteberegning (isokron-søk) | **Klient (WASM/Web Worker)**, IKKE i Worker | Workers har (etter at Bundled/Unbound ble avviklet) **30 s CPU-tid standard på betalt plan, konfigurerbart opp til 5 min** ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Teknisk nok, men bryter prinsippet «server som ren data-forbereder» unødig — se punkt 6. |
| Lagring av GRIB/NetCDF-avledede JSON-felt | **R2** | Uforanderlige, innholdsadresserte blobber (`pointer/xxx.json` → blob). Billig lagring, ingen egress-kostnad mot Workers. |
| Metadata/indeks over R2-objekter, lagrede ruter/waypoints | **D1** | Relasjonelt nok (ruter, waypoints, favoritter); for én bruker er skriveytelse irrelevant. |
| Sanntidstilstand for én aktiv seilas (telefon+nettbrett samtidig) | **Durable Object** (valgfritt) | Sannsynligvis overkill for soloapp — enklere med D1 + polling/websocket fra Worker. |

**CPU-grense-presisering:** Gamle "Workers Unbound = 15 min CPU"-omtaler er **utdaterte** — Bundled/Unbound er avviklet. Dagens betalte plan: 30 s CPU per request standard, konfigurerbart til maks 5 min (`cpu_ms`). Gratisplan: 10 ms. Rikelig for proxy/cache; nettverksventing teller ikke mot CPU-tid.

**Værdata-etterlevelse:** met.no krever identifiserende User-Agent (domene/app-navn) i alle forespørsler — generisk UA gir permanent utestengelse. Grense 20 req/s per applikasjon totalt. Med én bruker og Worker-cache foran er dette trivielt å overholde, men **Worker-en, ikke klienten, må sette riktig User-Agent**.

Kilder: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO alarms](https://blog.cloudflare.com/durable-objects-alarms/), [MET ToS](https://api.met.no/doc/TermsOfService), [MET FAQ](https://api.met.no/doc/FAQ)

---

## 5. Kartrendering

**MapLibre GL JS på mobil-PWA:** Moden, WebGL-basert, god ytelse på moderne Android-GPUer for vektortiles; fungerer fint i installert PWA.

**PMTiles på R2:** Velprøvd mønster — PMTiles er ett enkelt arkivfilformat som MapLibre leser direkte via HTTP range-requests, uten tile-server. Hele basiskartet blir én statisk fil i R2 ([Protomaps docs](https://docs.protomaps.com/pmtiles/maplibre), [walkthrough m/R2](https://thomasgauvin.com/writing/maps-web-app-with-protomaps-and-cloudflare/)). Dedikert offline-plugin (`maplibre-offline-pmtiles`) laster ned og lagrer PMTiles-uttrekk i OPFS for frakoblet bruk ([makinacorpus/maplibre-offline-pmtiles](https://github.com/makinacorpus/maplibre-offline-pmtiles)).

**Rastertiles fra Kartverket via Worker-cache — lovlighet:** Kartverkets åpne tjenester er frigitt til fri bruk inkl. kommersielt, med krav om `©Kartverket`-kreditering. Vilkårene sier ikke eksplisitt noe om caching på tredjepartsserver; data fra **Geovekst på zoom 12–20** krever særskilt tillatelse hvis de skal "kopieres eller brukes på andre måter" enn ren visning ([Kartverket vilkår](https://www.kartverket.no/en/api-and-data/terms-of-use)). Sjøkart raster-WMS er eksplisitt merket **"ikke beregnet for navigasjon"** — ansvarsfraskrivelsen må videreføres i appens UI ([Geonorge](https://www.geonorge.no/geonetworktest/srv/api/records/3089e311-e933-47f7-bc62-ba42e58fa739)).

**Konkret anbefaling:** Send én kort e-post til `post@kartverket.no` og avklar caching-mønsteret skriftlig før det bygges inn permanent. Vurder også om enkeltbruker-uttrekk med `pmtiles`-verktøyet fra åpne OSM/N50-data dekker basiskartbehovet uten å gå via Kartverkets levende WMS — da er sjøkart-laget det eneste som treffer Kartverket direkte.

---

## 6. Ruteberegning på klient — fortsatt riktig?

Ja — **klientberegning i WebAssembly/Web Worker, server som ren data-forbereder, er fortsatt riktig arkitektur:**

1. **Enkelhet/robusthet:** Ruteplanlegging for én bruker trenger ingen serverrundtur når værfelt/farbarhetsmaske allerede er hentet ned. Unngår hele klassen "server treg / offline om bord"-feilmoduser.
2. **CPU-grensen er ikke lenger avgjørende:** et tungt søk *kunne* kjørt server-side, men det introduserer bare nettverksavhengighet og latens for en app som brukes til sjøs med ustabil dekning.
3. **Ytelse:** WASM er nær-native i moderne mobilnettlesere ([State of WebAssembly 2025-2026](https://platform.uno/blog/the-state-of-webassembly-2025-2026/)). Ingen dedikert benchmark for isokron-ruting funnet — **verifiseres empirisk** ved portering av v1-motoren. Forbehold: minneallokering for store datasett er mindre forutsigbar på mobil; hold isokron-gridets minnefotavtrykk bevisst lite eller flis det.
4. **Server-rollen:** hente/aggregere værensembler (cron), bygge og publisere farbarhetsmaske + strømfelt som uforanderlige blobber i R2; klienten pinner én pakke per økt og kjører søket lokalt.

---

## Anbefalt arkitektur

**Klient:**
- **Start: PWA** på Cloudflare Pages — manifest + service worker, MapLibre GL JS + PMTiles (fra R2), TypeScript/WASM + Web Worker for isokron-beregning, IndexedDB/OPFS for offline værfelt og kartuttrekk.
- **Eskalering ved behov: Capacitor**-skall rundt samme webapp når bakgrunns-GPS-logging (skjerm av) eller BLE-instrumenter blir reelt krav. Bygg fra dag én abstraksjonslag (`LocationProvider`, `InstrumentProvider`) slik at web-implementasjonen kan byttes med Capacitor-plugin uten at resten endres.
- **TWA/Bubblewrap** er billig, valgfri finish (eget ikon/app-switcher) som kan legges til senere — emballasje, ikke arkitektur.

**Cloudflare:** Pages (frontend) · Workers (værproxy m/User-Agent + ev. tile-proxy) · Cron Triggers (ensemble-nedhenting, maskebygging) · R2 (uforanderlige felt + PMTiles) · D1 (ruter, waypoints, indeks) · KV (kortlevd cache).

**Beregning hvor:** Server: hente rå ensembler, derivere felt, bygge farbarhetsmaske, publisere versjonerte R2-blobber. Klient: pinne siste pakke, kjøre isokron-søk lokalt, rendre i MapLibre.

## Fallback-alternativer

- Kartverket-caching juridisk vanskelig → kun åpne OSM/N50-PMTiles som basiskart; sjøkart-lag direkte fra Kartverkets WMS uten mellomlagring.
- Bakgrunns-GPS nødvendig raskere enn ventet → rett til Capacitor med background-geolocation-plugin (foreground service); PWA-veien finnes ikke.
- Isokron-søk for tungt på eldre nettbrett → Worker med 5-min CPU-tak som on-demand-fallback, men klientberegning forblir standardvei.

## Åpne punkter (bevisst ikke gjettet)

- Skriftlig avklaring fra Kartverket om tile-caching i Worker.
- v1-motoren er ren JS — porteres til TypeScript først; WASM kun hvis målinger krever det.
- Faktisk minne-/tidsbudsjett for isokron-grid måles empirisk på representativ Android-enhet før arkitekturen låses.

## Kilder

- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
- https://developer.android.com/about/versions/oreo/background-location-limits
- https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2
- https://www.npmjs.com/package/@bubblewrap/cli · https://github.com/GoogleChromeLabs/bubblewrap
- https://capawesome.io/docs/sdks/capacitor/background-geolocation/ · https://github.com/capacitor-community/background-geolocation
- https://developers.cloudflare.com/workers/platform/limits/
- https://blog.cloudflare.com/durable-objects-alarms/
- https://docs.protomaps.com/pmtiles/maplibre · https://thomasgauvin.com/writing/maps-web-app-with-protomaps-and-cloudflare/
- https://github.com/makinacorpus/maplibre-offline-pmtiles
- https://www.kartverket.no/en/api-and-data/terms-of-use
- https://www.geonorge.no/geonetworktest/srv/api/records/3089e311-e933-47f7-bc62-ba42e58fa739
- https://api.met.no/doc/TermsOfService · https://api.met.no/doc/FAQ
- https://platform.uno/blog/the-state-of-webassembly-2025-2026/
