# Nettbrett-målingen (ADR-0005 port 1) — oppskrift

- Dato: 2026-09-05
- Vedtak: D10.2 (b). Verktøyet er panelet i PWA-en; JSON-en bygges av
  `apps/pwa/src/weather/measurement.ts` (skjema
  `morild-nettbrett-maaling/1`) og forlater aldri enheten av seg selv.

## Slik kjører du

1. På PC-en, to terminaler fra repo-roten:
   - `pnpm --filter @morild/worker exec wrangler dev --remote`
   - `pnpm --filter @morild/pwa exec vite --host`
2. På nettbrettet: åpne `http://<PC-ens LAN-IP>:5173` i Chrome. Vent til
   panelet viser «Ensemblet tok X s for 30 medlemmer (N Workere)».
3. Nederst i panelet: **«Kopier måling»** → lim inn i chatten (eller
   marker tekstfeltet og kopier manuelt hvis knappen sier det).
4. Gjenta to ganger til (last siden på nytt mellom hver). Tre kjøringer
   fordi veggklokke ikke er reproduserbar (maaling-e1 §7.4).
5. Skriv i tillegg: nettbrettets modell, om det sto i lading, og om
   skjermen var på hele tiden (Chrome struper bakgrunnsfaner).

## Hva JSON-en inneholder

`hardwareConcurrency`, brukt pool, JS-heap (kun Chromium), Periodic
Background Sync-støtte (input til D10.6), kontrollens tider, ensemblets
veggklokke, og per medlem: `memberIndex`, ankomstrekkefølge, rundtur
(`elapsedMs`), tid i workeren delt i dekode/felt/søk, etiketter,
iterasjoner, realisert seilingstid, nådd mål. Det er nok til å skille
«for få kjerner», «små kjerner» og «dyrere etiketter på ARM» (panelet
D10, §1.2/§1.3), og til å regne orakel-treffsikkerhet når D10.5 kommer.

## Hva tallet avgjør

- Ensemble-veggklokke ≤ 60 s: F3.5-hypotesen holder på denne enheten;
  spak 4–6 utsettes til etter bølge 5 (D10.1).
- > 60 s: vise-versa-porten (D10.3) utløses *etter* at spak 4–6 er
  vurdert — utfallsmengden er F3.5-semantikk / medlemshorisont /
  avgangsvindu, ikke 12°.
- `searchMs`-median × 30 / pool vs faktisk veggklokke: gapet er
  worker-overhead/small-cores — det profilsøket (spak 4) skal se på.

## Måleprogrammet (økt 2, robusthet.md §6.4 — lagt til 2026-09-27)

Automatisk program som erstatter den manuelle prosedyren over for D13.5
bolk 1: én knapp, ~45 min uten tilsyn, én JSON (skjema
`morild-maaleprogram/1`) til slutt. Programmet gjør 75 kjøringer på
samme pakke (hentet én gang, pakke-hash i JSON-en):

1. **Poolsveip** — pool 4, 5, 6, 7 × 5, vekselvis rekkefølge (4, 5, 6, 7,
   5, 6, 7, 4, …), fullt ensemble uten perturbasjon og nødhavnprofil.
2. **Solo** — kontrollmedlemmet (medlem 0) alene på én Worker, 10 ganger.
3. **Solo + dummy-last** — samme søk mens k = 1…5 dummy-Workere går, i
   variantene `spin` (ren regning), `stream` (64 MB `Float64Array`) og
   `alloc` (små objekter), 3 ganger hver.
4. 15 s termisk pause mellom kjøringer (ikke medregnet).

Konstantene står i `apps/pwa/src/maaleprogram/constants.ts` og kopieres
inn i JSON-en (`constants`).

### Engangssteg på nettbrettet: sikker kontekst for PC-ens adresse

Skjermlås (Wake Lock) og offline-lageret (Cache Storage) finnes bare i
sikker kontekst — `http://<LAN-IP>` er det ikke. Uten dette steget sier
programmet «Skjermlås: ikke tilgjengelig: krever sikker kontekst», og
skjermen kan slukke midt i. Én gang per nettbrett:

1. Finn PC-ens LAN-IP (`ipconfig` → «IPv4 Address», f.eks. `192.168.x.y`).
2. På nettbrettet i Chrome: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
3. Sett flagget til **Enabled** og skriv i tekstfeltet
   `http://<PC-ens LAN-IP>:5173` (nøyaktig opphav: skjema, IP og port).
4. Trykk **Relaunch** (Chrome starter på nytt; flagget gjelder først da).

Bytter PC-en IP (annen ruter/DHCP), må feltet oppdateres. Flagget gjelder
bare dette opphavet.

### Slik kjører du

1. På PC-en, to terminaler fra repo-roten (som over):
   - `pnpm --filter @morild/worker exec wrangler dev --remote`
   - `pnpm --filter @morild/pwa exec vite --host`

   Det må være **`vite` (dev)** — «Lagre på PC» bruker en mellomvare som
   bare finnes i dev-serveren.
2. Sett nettbrettet **på lader** (programmet holder skjermen på i ~45
   min). Lukk andre apper og faner.
3. Åpne `http://<PC-ens LAN-IP>:5173/?maaleprogram=1`. Sjekk at siden sier
   «Sikker kontekst: ja». Trykk **«Start måleprogrammet»** — skjermlås-
   linjen skal si «holdt». Gå fra nettbrettet.
4. Lastes siden på nytt underveis (fanen forkastet, Chrome-omstart),
   fortsetter programmet selv fra neste ukjørte kjøring på samme pakke;
   avbruddet telles i `interruptions` og står i hendelsesloggen. Sier
   siden «pakken ved gjenopptak er ikke den programmet startet med»,
   lagre det som finnes og nullstill.
5. Når siden sier «Ferdig»: trykk **«Lagre på PC»**. Filen havner i
   `docs/research/maaleprogram-raadata/<tidsstempel>.json` på PC-en (stien
   vises på nettbrettet). Virker ikke lagringen: **«Kopier»** og lim inn
   i chatten.
6. «Nullstill fremdrift» sletter lagret fremdrift og peker på nettbrettet
   (ikke filer på PC-en) — bruk den før en ny, uavhengig økt.

### Hva JSON-en inneholder

Enhet (UA, `hardwareConcurrency`, `deviceMemory`), pakke-identitet
(FNV-1a-64 over de sorterte blob-SHA-256-ene + init), konstantene,
`interruptions`, `workerMemoryApi`/`maxWorkerHeapMB` (D13.2 a), alle
kjøringer og hendelsesloggen (skjermlås tatt/sluppet/avslått,
`visibilitychange`, avbrudd, feil). Per kjøring: konfigurasjon, veggklokke,
kontrollens rundtur, ensemblets veggklokke (poolsveip), `hiddenDuringRun`,
og per medlem tuppelen `[memberIndex, workerSlot, searchMs, labelsCreated,
decodeMs, workerHeapMB]` (feltnavnene står i `memberTupleFields`).
`workerSlot` er `null` for kontroll-Workeren (den går alene før poolen).

**Obs. Worker-heap:** på PC (Chrome 152, Windows) leverte
`performance.memory` ingenting i Workerne under røyktesten 2026-09-27 —
`workerHeapMB` var `null` for alle medlemmer. Gjelder det samme på
nettbrettet, står `workerMemoryApi: false` i JSON-en og panelet; da
gjelder den analytiske grensen (robusthet.md §6.2) og en manuell kontroll
(`chrome://inspect` → Memory), ikke et tall.

Tolkningsreglene for analysen er forhåndsregistrert i robusthet.md §6.4
(«Analyse»); analysen gjøres i hovedsesjonen, ikke i appen.
