# Nettbrett-målingen (ADR-0005 port 1) — 2026-09-27

- Oppskrift: `nettbrett-maaling-oppskrift-2026-09-05.md`. Rådata (komprimert
  fra de tre JSON-ene Magnus limte inn, alle felter som varierer):
  `nettbrett-maaling-raadata-2026-09-27/` (`kjoringer.csv`, `medlemmer.csv`).
- Enhet: Android 10, Chrome 153, `hardwareConcurrency` 8, pool 6 Workere,
  heap-grense 905 MB. Modell: **Samsung Galaxy Tab S7 FE 5G (SM-T736B)**,
  Snapdragon 750G (2 × Cortex-A77 + 6 × Cortex-A55) — altså 2 store og 6
  små kjerner bak `hardwareConcurrency` 8. Lading ikke oppgitt.
- **Skjermen slo seg av** når Magnus ikke holdt vinduet aktivt; ved retur
  lastet siden på nytt og beregningen startet fra null. 5 forsøk for 3
  komplette kjøringer. De tre tallene er fra kjøringer med skjermen på.
- «Kjører hello-route …» henger fortsatt permanent (åpent funn fra
  2026-09-12).
- Pakke: MEPS init 2026-09-27T07Z (første cron-bygde pakke), ~3 t gammel
  ved måling. Kun vind i pakken.
- Tre kjøringer 10:11, 10:13, 10:15 UTC med sideoppfrisking mellom.

## Tall

| | Kjøring 1 | Kjøring 2 | Kjøring 3 |
|---|---|---|---|
| Kontroll rundtur | 6,4 s | 5,2 s | 5,4 s |
| Kontroll: felt / søk / nødhavnprofil | 55 ms / 5,8 s / 2,2 s | 67 ms / 4,7 s / 2,3 s | 62 ms / 4,6 s / 2,2 s |
| **Ensemble, 29 medlemmer, 6 Workere** | **58,5 s** | **60,6 s** | **60,2 s** |
| Medlem: median søk / median dekode | 10,4 s / 166 ms | 10,5 s / 190 ms | 10,7 s / 215 ms |
| Medlem: min / maks rundtur | 8,1 / 14,5 s | 8,2 / 15,4 s | 7,6 / 14,9 s |
| Σ rundtur / 6 (ideell pool) | 52,7 s | 54,0 s | 53,9 s |
| Rangkorrelasjon ankomst ↔ orakel (Spearman) | 0,975 | 0,975 | 0,986 |
| JS-heap brukt (hovedtråd) | 54 MB | 54 MB | 54 MB |

Sammenligning PC (`maaling-ekte-pc-2026-09-07.md`): median søk 7,8 s,
ensemble 40,8 s (rolig PC) / 73 s (PC med konkurrerende prosesser).

## Funn

1. **Ensemblet ligger på 60 s-grensen, ikke tydelig under eller over:**
   58,5 / 60,6 / 60,2 s, median 60,2 s. D10.1-regelen (≤ 60 s ⇒ spak 4–6
   utsettes; > 60 s ⇒ vise-versa-port D10.3 etter spak 4–6) får ikke et
   entydig svar av dette tallet — spredningen mellom kjøringer (2 s) er
   større enn avstanden til grensen. Beslutningspunkt til Magnus.
2. **Poolen er godt utnyttet.** Σ rundtur / 6 er 53–54 s mot 58–61 s
   veggklokke: ~90 % utnyttelse; resten er halen (29 medlemmer / 6 = 4,8
   runder, siste runde halvfull). Worker-overhead og dekoding er små
   (dekode ~0,2 s av ~10,5 s). Spak 4 (profilsøk mot worker-overhead) har
   lite å hente; gevinst må komme fra selve søket (etiketter) eller fra
   færre/kortere søk.
3. **Nettbrettet er ~1,35× PC per søk** (median 10,5 s mot 7,8 s) — ikke
   «små kjerner»-kollaps. 8 logiske kjerner, 6 Workere bruker dem.
4. **Deterministisk på ARM:** `labelsCreated`, `iterations` og `durationS`
   er identiske per medlem i alle tre kjøringene.
5. **Orakel-rekkefølgen treffer** (D10.5): ankomstrekkefølgen korrelerer
   0,975–0,986 med orakelrangen.
6. **Heap-exit-kriteriet (< 500 MB) er IKKE bevist av dette tallet.**
   `usedJSHeapSize` er `performance.memory` på hovedtråden — dedikerte
   Workeres heaper er ikke med (`apps/pwa/src/weather/measurement.ts`).
   Verdien er dessuten identisk (54 MB) i alle tre kjøringer, forenlig med
   Chromes grove bøtting av `performance.memory` uten cross-origin
   isolation. Hver Worker har eget felt + søkestate; seks av dem kan
   summere til langt mer. Trenger måling per Worker
   (`performance.measureUserAgentSpecificMemory()` krever COOP/COEP, eller
   `chrome://memory-internals` / Android-minneoversikt manuelt).
7. **Alle 29 medlemmer inkonklusive** (vind alene, D11.1 «dekning-felt»),
   som på PC 2026-09-08. Formelt over 20 %-terskelen i ADR-0005 port 3/4,
   men årsaken er kjent og en annen (strøm/bølge mangler i pakken), ikke
   horisont eller algoritmiske aborter; ingen medlem feilet
   (`reachesDestination` true for alle).
8. `periodicBackgroundSyncSupported: false` over http på LAN — input til
   D10.6, men må remåles fra installert PWA over https før det tolkes.
9. **Ensemble-tallene inkluderer nødhavnprofilen** (funnet i review
   2026-09-27): `ensembleWallMs` regnes fra kontrollen er ferdig, og
   nødhavnprofilen (2,2 s) kjører sekvensielt på kontroll-Workeren før
   medlemmene startes. Selve ensemblet: 56,3 / 58,3 / 58,0 s.
