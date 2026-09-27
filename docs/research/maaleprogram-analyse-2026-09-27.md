# Måleprogrammet på nettbrettet — analyse (2026-09-27)

- Rådata: `maaleprogram-raadata/2026-09-27T12-30-30-060Z.json` (skjema
  `morild-maaleprogram/1`). Program og tolkningsregler:
  `docs/specs/robusthet.md` §6.4 (forhåndsregistrert før data).
- Enhet: Galaxy Tab S7 FE (Snapdragon 750G, 2 × A77 + 6 × A55),
  Chrome 153, `deviceMemory` 4 GB. Pakke `0ce49fe6113f1bc7` (MEPS init
  2026-09-27T07Z, 180 blober, 29 medlemmer, kun vind), samme gjennom hele
  programmet.
- Kjøring 11:32–12:26 UTC (54 min), på lader. **75 av 75 kjøringer, 0
  avbrudd, 0 feil, ingen kjøring med skjult side.** Skjermlåsen ble tatt
  ved start og holdt til programmet slapp den (D13.3 bekreftet i praksis
  over én lang økt).

## Tall

**Poolsveip** (ensemble uten nødhavnprofil, s; µs/etikett over alle medlemmer):

| Pool | Veggklokke (5 kjøringer) | Median | µs/etikett median (p10–p90) |
|---|---|---|---|
| 4 | 59,5 · 64,1 · 58,8 · 58,7 · 58,7 | **58,8** | 65 (58–76) |
| 5 | 56,1 · 55,9 · 61,2 · 56,2 · 56,1 | **56,1** | 77 (66–92) |
| 6 | 53,6 · 53,9 · 53,8 · 57,5 · 55,0 | **53,9** | 89 (73–105) |
| 7 | 51,9 · 53,2 · 52,6 · 55,5 · 53,2 | **53,2** | 101 (84–118) |

Kontrollen alene ~4,1–4,2 s i alle. Ingen stigende trend over programmet
(pool 4: 60 → 64 → 59 → 59 → 59 s) — ingen tegn til termisk struping med
skjermlås og lader. Ingen fast treg `workerSlot` (pool 6: 85–93 µs per
slot) — OS-et flytter trådene; det finnes ingen «liten kjerne-slot».

**Solo** (medlem 0 alene, 10 ganger): 34–35 µs/etikett, smal og
unimodal.

**Solo + k dummy-Workere** (median µs/etikett, 3 kjøringer):

| Variant | k=1 | k=2 | k=3 | k=4 | k=5 |
|---|---|---|---|---|---|
| spin | 36 | **138** | 145 | 146 | 146 |
| stream | 45 | **228** | 349 | 403 | 439 |
| alloc | 51 | 53 | 59 | 68 | 68 |

## Tolkning (etter reglene i §6.4)

1. **Solo er unimodal (~34 µs)** ⇒ et søk alene lander stabilt på en stor
   kjerne; OS-et flytter det ikke mellom kjernetyper.
2. **`spin` har et sprang ved k = 2 (36 → 138 µs, ~4×) og flater så ut**
   ⇒ forhåndsregistrert signatur for «store kjerner oppbrukt»: med to
   dummyer på de to A77-kjernene går målesøket på en A55, som er ~4×
   tregere per etikett. Dette er hovedmekanismen bak
   «samtidighetsstraffen» fra 27/9.
3. **`stream` stiger videre etter spranget (228 → 439)** ⇒ i tillegg er
   søket følsomt for minnebåndbredde: seks parallelle søk konkurrerer om
   minnebussen.
4. **`alloc` gir bare en svak økning (51 → 68)** ⇒ GC er ikke
   flaskehalsen. Spak 5 (allokeringsfri hot-loop) har lite å hente.
5. **Flere Workere lønner seg fortsatt, med avtagende gevinst:** 4 → 6
   sparer 4,9 s, 6 → 7 bare 0,7 s (innenfor spredningen). Taket på 6 i
   `defaultPoolSize` er riktig for denne enheten; mer å hente ligger ikke i
   poolstørrelsen.
6. **Ensemblet er 53,9 s (pool 6)** mot 56,3–58,3 s for selve ensemblet
   27/9. Forskjellen er ikke tilskrevet: måleprogrammet kjører uten kart,
   hello-route og værflyt, med skjermlås og lader. Med nødhavnprofilen
   (~2,2 s, sekvensiell før medlemmene) blir appens tall ~56 s.
7. **Heap:** `performance.memory` finnes heller ikke i Workere på
   nettbrettet (`workerMemoryApi: false`). 4a-exit (< 500 MB) må bevises
   med den analytiske grensen + én manuell kontroll (D13.2 a, reserveløpet).

## Konsekvenser

- **D10.3 utløses ikke** på vind-alene-pakken: ~54 s ensemble (~56 s med
  nødhavn) på pool 6. Men D13.1 (c′) sier at porten vurderes mot tallet
  med strøm og bølge i pakken — dette er grunnlinjen den remålingen
  sammenlignes med.
- **Hvis ensemblet må ned**, er de riktige spakene de som reduserer
  arbeid eller minnetrafikk per etikett (datastrukturer med bedre
  cache-lokalitet, færre oppslag i værfeltet), ikke allokeringer (spak 5)
  og ikke flere Workere. Enhver etikettreduksjon er en modellendring med
  E1-protokoll (matematikeren, D13).
- **Observasjon, ikke tiltak:** nødhavnprofilen går sekvensielt før
  medlemmene (egen fase, vedtatt 2026-09-07). Å kjøre den parallelt med
  første medlemsrunde ville spare ~2 s veggklokke; ikke verdt å gjenåpne
  nå.
