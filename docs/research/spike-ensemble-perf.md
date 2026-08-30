# Spike 2 — ensemble-ytelse (v1-motoren, 30 medlemmer i Web Workers)

- Dato: 2026-08-30
- Utført av: rutemotor-spike (fase 0, K4)
- Status: ferdig på PC — **venter på Magnus' kjøring på Android-nettbrett**

## Spørsmålet

F3.5 og N6 (`docs/00-kravspek.md`) setter et ytelsesbudsjett for ensemble-ruting:
progressiv beregning, < 60 s for et ensemble, < 500 MB JS-heap på nettbrett. K4
(`docs/research/review-arkitekt.md`) ba om ekte tall for v1-motoren kjørt 30× i
Web Workers, med syntetisk perturberte vindfelt, før porten designes. Uten dette
er kursoppløsning, pool-størrelse og delt-felt-gevinst rene antakelser.

## Kort svar

v1-motoren er raskere enn fryktet på denne PC-en: et 30-medlems ensemble for
**én avgang** kjører på 1,3–2,1 s over en Worker-pool ved 12° kursoppløsning
(med eller uten syntetisk landmaske), og under 9 s selv i verste måling
(sekvensiell i én Worker, 6°, med land). Alle mål er godt innenfor 60 s-budsjettet
selv med 2–4× nettbrett-nedjustering. Minne er ikke en flaskehals ved denne
gitterstørrelsen (hovedtråd-heap holdt seg under 9 MB gjennom hele kjøringen).
Det ubesvarte spørsmålet er skalering til **S1s faktiske 150–210 kjøringer**
(5–7 avganger × 30 medlemmer, jf. M5) — denne spiken måler kun ett avgangs
ensemble, ikke hele settet.

## Oppsett

- Motor: ordrett uttrekk fra `C:\RoutePlanner\morild_weather_router.html`
  (geometri, polar, `makeW`, `buildLandMask`/`segInt`, `buildDistField`/
  `fieldFromData`/`hPush`/`hPop`, `waveFactor`/`consolidate`, `computeRoute`,
  worker-mønsteret). Ligger i
  `tools/spikes/ensemble-perf/index.html`.
- **Eneste bevisste avvik fra v1:** `computeRoute`s kurs-løkke er endret fra
  hardkodet `for(let h=0;h<360;h+=6)` til `for(let h=0;h<360;h+=(opt.headingStep||6))`
  — nødvendig for i det hele tatt å kunne måle F3.5s 10–12°-strategi. Alt annet
  er kopiert uendret, inkludert binærheapen, A*-feltet og worker-oppslaget.
  Worker-responsen i denne spiken strippes for `path`/`pathRaw`/`iso` før
  `postMessage` (vi måler bare tid, ikke ruten) — det betyr at de reelle
  structured-clone-kostnadene ved å sende hele ruten tilbake til hovedtråden
  **ikke** er med i tallene under. Se «Det vi ikke fant ut».
- Rute: Skjæløy (59.182, 10.855) → Skagen (57.72, 10.58), samme margin- og
  gitterformel som v1 (`0,4°`-celler, `min(11,max(3,ceil(range/0,4)+1))` per akse).
  For nettopp denne bboxen gir formelen **7 × 4 = 28 gitterpunkter**, ikke
  7×7–11×11 som antatt i oppdraget — lengdegrad-spennet mellom Skjæløy og
  Skagen (0,275°) er mye mindre enn breddegrad-spennet (1,46°), og
  margin-formelen skalerer bredden med `max(dLat,dLon)`. 61 tidssteg à 1 time.
- 30 medlemmer: deterministisk seed (`mulberry32`) per medlem, ±20 % vindstyrke,
  ±25° retning, faseforskjøvet i tid, oppå et syntetisk SV-bris-grunnfelt
  (8–14 kn, romlig og tidsmessig variasjon). Kontrollmedlem = uperturbert
  grunnfelt.
- Landmaske: syntetisk sikksakk-kystlinje + 4 småøyer, **296 segmenter**, plassert
  slik at ruten delvis må gå rundt den (realistisk kost, ikke geometrisk ekte
  skjærgård).
- Kjørt via `python -m http.server` (file:// ga ikke et fullt interaktivt
  DOM i denne økten — se «Det vi ikke fant ut»), i den innebygde
  Chromium-baserte browser-panen: `hardwareConcurrency=8` → pool-størrelse 6.

## Funn

- **F1 — Alle mål innenfor 60 s-budsjettet med god margin (verifisert, 2 kjøringer på denne PC-en).**
  Tabellen viser kjøring 1; en andre full kjøring ga samme rangordning med
  15–30 % variasjon (miljøstøy, se F5).

  | Scenario | Land | Kurs-oppl. | Delt felt | Kjøringer | Total (ms) | Snitt/kjøring (ms) | Min (ms) | Maks (ms) |
  |---|---|---|---|---|---|---|---|---|
  | Kontroll (6°, 1t steg) | nei | 6° | – | 1 | 251 | 251 | 251 | 251 |
  | Sekvensiell, 1 worker (6°) | nei | 6° | nei | 30 | 7 923 | 264 | 144 | 584 |
  | Pool ×6 (6°) | nei | 6° | nei | 30 | 3 744 | 699 | 371 | 1 432 |
  | Sekvensiell, 1 worker (12°) | nei | 12° | nei | 30 | 5 620 | 187 | 117 | 336 |
  | **Pool ×6 (12°)** | nei | 12° | nei | 30 | **1 987** | 378 | 261 | 554 |
  | Pool ×6 (12°, delt A*-felt) | nei | 12° | ja | 30 | 2 089 | 387 | 243 | 594 |
  | Kontroll (6°, 1t steg) | ja | 6° | – | 1 | 440 | 440 | 440 | 440 |
  | Sekvensiell, 1 worker (6°) | ja | 6° | nei | 30 | 8 546 | 285 | 201 | 499 |
  | Pool ×6 (6°) | ja | 6° | nei | 30 | 3 424 | 626 | 275 | 1 001 |
  | Sekvensiell, 1 worker (12°) | ja | 12° | nei | 30 | 2 742 | 91 | 53 | 164 |
  | **Pool ×6 (12°)** | ja | 12° | nei | 30 | **1 373** | 265 | 156 | 423 |
  | Pool ×6 (12°, delt A*-felt) | ja | 12° | ja | 30 | 1 345 | 256 | 121 | 456 |

  (Andre kjøring, samme maskin: Pool×6/12°/uten land 1 829 ms, Pool×6/12°/med
  land 1 532 ms — samme størrelsesorden.)

- **F2 — Kursoppløsning 12° vs. 6° halverer omtrent tiden** (verifisert).
  Sekvensiell-testen isolerer effekten rent (samme worker, samme feltbygging):
  264 ms → 187 ms snitt/kjøring uten land (−29 %), 285 ms → 91 ms med land
  (−68 %, se F4 for hvorfor land+12° er spesielt gunstig). Dette er F3.5s
  anbefalte medlemsoppløsning, og tallene støtter den.

- **F3 — Worker-pool gir 2–4× wall-clock-gevinst over sekvensiell kjøring i én
  worker** (verifisert). Ved 12°: sekvensiell 5 620/2 742 ms (uten/med land) vs.
  pool 1 987/1 373 ms. Gevinsten er mindre enn poolstørrelsen (6×) fordi hver
  jobb er kort nok at worker-oppstart, structured-clone av `raw`-vindfeltet og
  Promise/event-loop-overhead per jobb blir en synlig andel av totalen —
  forventet ved så små jobber, ikke et paralleliseringsproblem.

- **F4 — Landmaske gjorde ruten** ***raskere*** **å beregne i flere målinger,
  ikke tregere** (rapportert av oss, ikke fullt forklart). Sekvensiell 12°:
  91 ms med land vs. 187 ms uten. Hypotese: A*-feltets Dijkstra og
  `land.crosses`-sjekkene kutter flere grener tidligere (færre gyldige
  retninger overlever iterasjon-for-iterasjon), så frontiet krymper raskere og
  søket stagnerer/når målet i færre iterasjoner enn uten land — netto færre
  totale node-utvidelser trumfer merkostnaden per sjekk. Vi har ikke
  instrumentert `nodes`/`iter`-tallene for å bekrefte dette; se «Det vi ikke
  fant ut». Konsekvens: «med land er dyrere» kan ikke antas ukritisk — det
  avhenger av hvor mye landmasken faktisk beskjærer søkeretningene.

- **F5 — Run-to-run-variasjon på 15–30 % i dette miljøet** (verifisert).
  To fulle kjøringer på samme maskin, rett etter hverandre, ga f.eks.
  «Pool×6, 12°, uten land»: 1 987 ms og 1 829 ms; «Sekvensiell, 6°, uten land»:
  7 923 ms og 5 749 ms. Absolutte tall bør leses som størrelsesorden/intervall,
  ikke enkeltpunkt — konsistent med JIT-oppvarming og bakgrunnsstøy i en
  virtualisert/sandkasse-browser (se «Det vi ikke fant ut» om miljøet selv).

- **F6 — Delt A*-felt ga ingen målbar gevinst ved denne gitterstørrelsen**
  (verifisert, men negativt resultat). Pool×6/12°: 1 987 ms uten delt felt vs.
  2 089 ms med (marginalt tregere — støy, F5); med land: 1 373 ms vs. 1 345 ms
  (marginalt raskere). `buildDistField` på et 7×4-basert felt er i seg selv så
  billig (feltet caper på 120 000 celler, men blir langt mindre her) at å bygge
  det 30 ganger vs. 1 gang ikke er synlig i totalen. Konklusjon: gevinsten fra
  M6/F3.5s delte felt er **strukturelt riktig** (unngår O(medlemmer) redundant
  arbeid) men **ikke bevist med denne spikens tall** — den vil trolig vise seg
  tydeligere med et finere felt eller flere avganger som deler samme felt
  (feltet er væruavhengig, kun avhengig av start/mål/land — jf. kravspekens
  egen begrunnelse for hvorfor det kan deles).

- **F7 — Minne er ikke en flaskehals på denne skalaen** (verifisert, med sterkt
  forbehold). `performance.memory.usedJSHeapSize` på hovedtråden: 4,0 → 4,3 MB
  (kjøring 1), 5,0 → 4,6 MB (kjøring 2), høyeste observerte 5,8/8,5 MB. Dette er
  **milevidt** fra 500 MB-taket. Men: `performance.memory` finnes kun i
  Chrome/Chromium og måler **kun hovedtrådens** heap — selve
  ruteberegningen skjer i Worker-tråder med egne, separate heaper som ikke
  reflekteres i dette tallet i det hele tatt. Gitt datastørrelsene her (28
  gitterpunkter × 61 tidssteg × 30 medlemmer × 2 Float32-arrays ≈ noen hundre
  KB totalt) er det uansett usannsynlig at worker-heapene nærmer seg noe
  bekymringsverdig — men spiken **beviser ikke** dette tallet, den gjør det
  bare plausibelt.

- **F8 — Enhetsgitteret v1 faktisk bruker for denne ruten er 7×4, ikke
  ~7×7–11×11** (verifisert, avvik fra oppdragets antakelse). Se «Oppsett» for
  utregningen. For ruter med større lengdegrad-spenn (f.eks. øst-vest langs
  dansk kyst) vil gitteret bli bredere og nærmere den antatte firkanten —
  verdt å teste som egen variant hvis en øst-vest-rute blir aktuell i porten.

## Vurdering mot F3.5-budsjettene

| Budsjett | Mål på denne PC-en | × 2–4 (nettbrett-antakelse) | Vurdering |
|---|---|---|---|
| < 5 s deterministisk (kontroll, 1 kjøring) | 210–450 ms | 0,4–1,8 s | God margin |
| < 60 s ensemble (30 medlemmer, 1 avgang, pool, 12°, delt felt) | 1,3–2,1 s | 2,7–8,4 s | God margin |
| < 60 s ensemble, verste måling (sekvensiell, 1 worker, 6°, med land) | 8,5 s | 17–34 s | Fortsatt innenfor, men pool-bruk er ikke valgfritt |
| < 500 MB JS-heap | < 9 MB (kun hovedtråd, se F7) | — | Ikke eksponert som risiko av denne spiken |

**Det viktigste forbeholdet:** disse tallene gjelder **én avgang, 30
medlemmer**, slik K4 opprinnelig ba om. M5 (arkitekt-review) redefinerte S1 til
**150–210 kjøringer = 5–7 avganger × 30 medlemmer**, nettopp fordi 30 er for
lite til å representere den reelle ensemble-UX-kontrakten. Ganger man opp beste
konfigurasjon (pool×6, 12°, delt felt) med 6 avganger: PC 8–13 s, nettbrett
(×2–4) **16–52 s** — fortsatt under 60 s, men uten den brede margen
enkelt-avgangs-tallene ovenfor gir inntrykk av. Dette er ikke målt i denne
spiken og bør verifiseres direkte (se anbefaling under).

## Det vi ikke fant ut

- **Skalering til 5–7 avganger (150–210 kjøringer)** er ikke målt — kun
  ekstrapolert lineært over. Progressiv strømming per avgang (F3.5s UX-kontrakt)
  kan gjøre den opplevde ventetiden irrelevant selv om totalsummen nærmer seg
  60 s, men det er en UX-påstand som bør testes, ikke antas.
- **Hvorfor land gjorde søket raskere** (F4) er en hypotese, ikke bekreftet —
  krever instrumentering av `nodes`/`iter`/`prunedDead`/`prunedBound` per
  kjøring, som denne spiken strippet bort for å holde meldingene små.
- **Kostnaden ved å sende hele ruten (`path`/`pathRaw`/`iso`) tilbake fra
  worker til hovedtråd** er ikke målt — denne spiken strippet dem fra
  `postMessage`-svaret. Ved 150–210 kjøringer med isokron-snapshots hver 6.
  time kan structured-clone-kostnaden bli merkbar; bør måles i neste iterasjon.
- **Reell Android-nettbrett-ytelse.** Alle tall over er fra denne PC-en, kjørt
  i agentens innebygde Chromium-browser (ikke nødvendigvis representativ for
  Magnus' vanlige skrivebords-Chrome heller). 2–4×-antakelsen for nettbrett er
  ubekreftet inntil Magnus har kjørt filen — se seksjonen under.
- **file:// åpnet ikke en fullt interaktiv side i browser-panen** brukt til
  denne målingen (den ble behandlet som et statisk øyeblikksbilde utenfor
  prosjektmappen) — løst med en lokal HTTP-server. Ukjent om dette er en
  begrensning i agent-verktøyet spesifikt eller vil gjenta seg i en vanlig
  Chrome-installasjon (der Blob-workers fra `file://` normalt fungerer).
  Magnus bør teste `file://` direkte på nettbrettet først, siden det er den
  enkleste distribusjonsveien.
- **Weather-pack nedlasting/dekoding er ikke del av denne spiken.** M2s reelle
  minne- og tidsrisiko (20–35 MB kvantisert vindpakke) er en separat kostnad
  som ikke er øvet her — denne spiken tester kun selve rutealgoritmen på
  ferdiglastede, syntetiske data i minnet.

## Konsekvens for prosjektet

- **Bruk 10–12° kursoppløsning for ensemble-medlemmer, 6° for kontroll** —
  F3.5s strategi er bekreftet billigere og bør stå i spesifikasjonen som valgt,
  ikke bare foreslått.
- **Worker-pool er ikke valgfritt** — sekvensiell kjøring i én worker er
  2–4× tregere og spiser mer av 60 s-budsjettet enn nødvendig. `hardwareConcurrency-1`
  (cap 6, jf. M6) er en fornuftig standard; nettbrett rapporterer ofte lavere
  `hardwareConcurrency` enn denne PC-ens 8, så forvent pool-størrelse 3–7 i
  praksis — verdt å lese `navigator.hardwareConcurrency` og vise det i en
  eventuell diagnostikkskjerm.
- **Implementer delt A*-felt (fieldData-gjenbruk) i porten uansett** — den
  strukturelle begrunnelsen (feltet er væruavhengig, per M5/M6) holder selv om
  denne spiken ikke viste en stor gevinst ved n=30 på et lite felt. Gevinsten
  forventes å vokse med flere avganger som deler ett felt per rute-par.
  Implementasjonen er triviell (already-existing `opt.fieldData`-vei i v1s
  `computeRoute` — ingen ny kode trengs utover å bygge feltet én gang på
  utsiden).
- **Før portens ytelsesbudsjett låses: mål 150–210-kjøringers-scenarioet
  eksplisitt** (5–7 avganger × 30 medlemmer, progressivt strømmet), ikke bare
  ett avgangs-ensemble. Denne spiken de-risikerte den grunnleggende
  Worker-arkitekturen, men ikke S1s fulle skala.
- **Minnebudsjettet (N6, < 500 MB) er ikke i faresonen fra selve
  rute-beregningen** ved disse datastørrelsene — hvis 500 MB noensinne
  overskrides i porten, er værpakke-håndtering (M2) eller kart/tile-lag et mye
  mer sannsynlig sted å lete enn `computeRoute`/A*-feltet.

## Slik kjører Magnus den på nettbrettet

Filen er én selvstendig HTML-fil (`tools/spikes/ensemble-perf/index.html`),
ingen build, ingen avhengigheter, ingen nettverkstilgang etter at siden er
lastet.

**Alternativ A — rett fra fil (prøv denne først):**
1. Overfør `index.html` til nettbrettet (e-post til deg selv, en delt
   Cloud-mappe, eller USB/adb push).
2. Åpne filen i Chrome på nettbrettet (`chrome://` → åpne lokal fil, eller
   via filbehandleren → «Åpne med Chrome»).
3. Trykk «Kjør alle målinger». Hvis Worker-jobbene aldri starter (statuslinjen
   henger på «Bygger syntetiske vindfelt…»), er `file://`+Blob-workers
   blokkert på den nettleserversjonen — gå til alternativ B.

**Alternativ B — server over LAN (hvis A ikke virker):**
1. På denne PC-en, i repo-roten:
   ```
   cd tools/spikes/ensemble-perf
   python -m http.server 8934 --bind 0.0.0.0
   ```
   (Windows kan be om brannmur-tillatelse første gang — tillat for privat nettverk.)
2. Finn PC-ens LAN-IP: `ipconfig` → se etter IPv4-adressen på Wi-Fi-adapteren
   (typisk `192.168.x.x`).
3. På nettbrettet, samme Wi-Fi: åpne `http://<PC-ens-IP>:8934/index.html` i Chrome.
4. Trykk «Kjør alle målinger».

**Etterpå, uansett alternativ:**
- Vent til statuslinjen viser «Ferdig. 12 scenarier kjørt.» (ta 5–60 s avhengig
  av enhet).
- Les av tabellen, og trykk «Velg JSON-resultat» for å markere hele
  JSON-resultatet i tekstboksen nederst — kopier det (skjermbilde eller
  kopier/lim inn) og send tilbake, så oppdateres denne rapporten med
  nettbrett-tallene og den faktiske treghetsfaktoren erstatter 2–4×-antakelsen.

## Kilder

- `C:\RoutePlanner\morild_weather_router.html` (v1, skrivebeskyttet kilde),
  lest 2026-08-30 — linjeområdene angitt i «Oppsett».
- `docs/00-kravspek.md` v0.2, §F3.5/N6, lest 2026-08-30.
- `docs/research/review-arkitekt.md`, M5/M6/K4, lest 2026-08-30.
- Målinger utført i denne økten, 2026-08-30, i agentens innebygde
  Chromium-baserte browser-pane (UA: Chrome/148.0.7778.280,
  `hardwareConcurrency=8`) — **ikke** verifisert mot en ordinær
  desktop-Chrome-installasjon eller mot Android-nettbrett. Rå JSON fra begge
  PC-kjøringene er ikke lagret som fil (kun lest fra siden i denne økten) —
  kjør spiken på nytt for å reprodusere, den er deterministisk bortsett fra
  wall-clock-timing.
