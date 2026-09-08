# Måling på ekte pakke, PC — fase 4a bølge 3–5 ende-til-ende

- Dato: 2026-09-07
- Oppsett: `wrangler dev --remote` (R2 `morild-mirror`, pakke init
  2026-09-03T21Z, 82 t gammel) + Vite på PC (8 kjerner, pool 6),
  Skjæløy→Skagen, full oppløsning, delt felt, verste-først-orakel,
  bail-out (interim-havnebok), perturbasjon (6 søk). Én kjøring; veggklokke
  ikke reproduserbar (maaling-e1 §7.4). JSON fra panelet (D10.2 b).

| | verdi |
|---|---|
| kontroll: dekode / felt / søk | 129 ms / 62 ms / 5,3 s (131 k etiketter) |
| kontroll, rundtur før bail-out ble egen fase | 27,8 s |
| kontroll, rundtur etter at bail-out ble egen fase | 7,7 s |
| bail-out-profil på kontrollen (ekte vær, 40 R2-søk) | ≈ 20 s (27,8 − 7,7) |
| medlem: median søk / median dekode / maks rundtur | 7,8 s / 151 ms / 9,2 s |
| ensemble 29 medlemmer, 6 workere | 40,8 s |
| JS-heap brukt | 49 MB |
| klassifisering | 29/29 inkonklusive «dekning-felt» (vind-only-pakke, D11.1) |

## Funn

1. **Ekte vær er ~2,5× dyrere per medlem enn syntetisk** (7,8 s vs 2,9 s
   median på S-1 — kompositt flisoppslag i kvantiserte felt). Pool-anslaget
   fra spak 7 (16–23 s) blir 41 s målt på PC. Nettbrett med 3–5 workere og
   2–4× faktor: **80–330 s** for topp-avgangen. F3.5s «< 60 s» er dermed
   ikke realistisk på nettbrett uten spak 4–6 — D10.1 (a) står (progressiv
   semantikk er kontrakten), men spak 4–6 rykker opp på listen etter
   nettbrett-tallet.
2. **Bail-out på ekte vær koster ~20 s, ikke 3,3 s** (golden-målingen i
   bølge 4 brukte syntetisk konstantvær). Med profilen inne i kontroll-
   jobben tok kontrollruten 28 s å nå skjermen — brudd på progressiv
   semantikk. Rettet 2026-09-07: profilen er egen fase på kontroll-workeren
   *etter* at kontrollresultatet er levert (kontroll på 7,7 s igjen).
   Konsekvens for **D12.1 (bølge 6)**: tre profiler ≈ 60 s på PC, det
   dobbelte+ på nettbrett — kostnadsmålingen må gjentas på ekte vær før
   bølge 6 startes (ytelsesingeniørens forbehold i D12-panelet bekreftet).
3. Perturbasjonene ga «mest følsom: båtfart» selv om alle seks kjøringer
   var inkonklusive — `mostSensitive` regnes nå kun over gjennomførbare
   kjøringer.
4. Heap 49 MB på PC — N6 (< 500 MB) har god margin; nettbrett måles.
5. Førstesidens rad 1 (§4.7) virket som spesifisert: 82 t gammel pakke ⇒
   «ingen robusthetstall vises», kontrollrute og flagg fortsatt synlige.
   Cron-jobben (GitHub Actions, Magnus' secrets) er forutsetningen for at
   førstesiden noen gang viser tall.

## Tillegg 2026-09-08 — fersk pakke (init 2026-09-08T14Z, alder 3,0 t)

Pakken ble bygget lokalt (`build-live`, 180 blober, 20,1 MB) og lastet
til `morild-mirror` (180/180 OK, peker, 4 stikkprøver byte-identiske).
Samme oppsett som over; blobene hentet ferskt fra R2 (ikke cache).

| | verdi |
|---|---|
| kontroll: dekode / felt / søk / rundtur | 130 ms / 65 ms / 5,0 s / 5,4 s |
| bail-out-profil (egen fase, 21 R2-søk) | 21,2 s |
| medlem: median søk | 9,6 s |
| ensemble 29 medlemmer, 6 workere | 73 s |
| JS-heap | 55 MB |
| førstesiden | alle seksjoner (§4.7 pkt. 1–6) rendret; lys «Beregner (k av 29)» underveis, GULT/inkonklusiv ved slutt |
| nødhavn | 3 av 26 punkter når havn innen 6 t ⇒ «≥ 6 t» (vær-gate i dette været) |

Ensemblet var 73 s mot 41 s dagen før på samme PC — 6 wrangler-/Vite-
prosesser konkurrerte om kjernene, og medlemsmedianen steg fra 7,8 til
9,6 s. Bekrefter at veggklokke på PC ikke er reproduserbar; nettbrett-
tallet må måles der (D10.2). UI-feil funnet og rettet: «Ingen
kontrollrute å tegne» ble vist for en inkonklusiv (dekning-felt) kontroll
som faktisk har rute — betingelsen er nå «ingen rutegeometri».
