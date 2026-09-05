# Spak 7 — PC-remåling av én avgang, full oppløsning, med bølge 1-rigg

- Dato: 2026-09-05
- Status: målt (én kjøring, én prosess, Node v24.18.0; veggklokke er
  ikke reproduserbar på tvers av kjøringer — maaling-e1 §7.4).
- Oppsett: kontroll + 30 medlemmer sekvensielt per fikstur, første avgang;
  `headingStepDeg: 6`, `timeStepS: 1800` (full oppløsning); delt A\*-felt fra
  kontrollen i `RouteInput.field`; ingen delt Tub (D9.1). Verktøy:
  `tools/spak7-maaling/maaling.mjs`.
- Pool-anslag = felt + kontroll + ⌈30/p⌉ × median medlemstid — en nedre
  grense (antar perfekt fordeling og ingen worker-overhead/strukturert
  kloning). PC: kjerner−1 = 6 workere.

| Fikstur | Felt | Kontroll | 30 medl. sekv. | Median/medlem | Maks/medlem | Iterasjoner | Etiketter | Klasser | 3 w | 5 w | 6 w |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S-1 | 29 ms | 3.7 s (feasible) | 81.7 s | 2.81 s | 3.57 s | 845 | 5728573 | feasible 30 | 32 s | 21 s | 18 s |
| S-3 | 19 ms | 3.3 s (feasible) | 83.9 s | 3.24 s | 3.78 s | 773 | 5250554 | feasible 26, inconclusive 4 | 36 s | 23 s | 20 s |
| S-7 | 24 ms | 3.5 s (feasible) | 76.4 s | 2.27 s | 4.82 s | 1131 | 4390582 | feasible 15, inconclusive 15 | 26 s | 17 s | 15 s |

## Tolkning mot portene

- ADR-0005 port 2 / robusthet.md §6.3 spak 7: «viser PC-remålingen > 40–50 s
  per avgang (sekvensielt), er nettbrett-tallet i praksis avgjort».
  Sekvensielt-kolonnen er det tallet; pool-kolonnene er hva progressiv
  UX faktisk får med 3–6 workere før nettbrett-faktoren (2–4×, umålt).
- F3.5s «< 60 s for topp-avgang» er hypotesen som testes: pool-anslag ×
  nettbrett-faktor mot 60 s.

## Rå logg

```
[spak7] S-1: felt 29 ms, kontroll 3745 ms (feasible), 30 medl. sekvensielt 81.7 s (median 2.81 s, maks 3.57 s), iter 845, etiketter 5728573, klasser feasible:30; pool-anslag 3w=32 s, 5w=21 s, 6w=18 s
[spak7] S-3: felt 19 ms, kontroll 3315 ms (feasible), 30 medl. sekvensielt 83.9 s (median 3.24 s, maks 3.78 s), iter 773, etiketter 5250554, klasser feasible:26 inconclusive:4; pool-anslag 3w=36 s, 5w=23 s, 6w=20 s
[spak7] S-7: felt 24 ms, kontroll 3550 ms (feasible), 30 medl. sekvensielt 76.4 s (median 2.27 s, maks 4.82 s), iter 1131, etiketter 4390582, klasser feasible:15 inconclusive:15; pool-anslag 3w=26 s, 5w=17 s, 6w=15 s
```

## Konklusjon (hovedsesjonen, 2026-09-05)

1. **Sekvensielt 76–84 s per avgang på PC (8 kjerner).** Det er samme
   nivå som E1-riggen (67–99 s, `maaling-e1` §7.4) — bølge 1-riggen
   (delt A*-felt, `{ once: true }`, provenance) gir som ventet ingen
   målbar gevinst per søk: feltbygging koster 19–29 ms, altså under
   0,05 % av en avgang. Kostnaden bor i søket selv (4,4–5,7 mill.
   etiketter per avgang).
2. **Port-terskelen i robusthet.md §6.3 er passert:** > 40–50 s
   sekvensielt ⇒ «< 60 s for topp-avgang» kan ikke nås sekvensielt på
   nettbrett uansett faktor. Det eneste som kan nå 60 s er worker-poolen.
3. **Pool-anslag (nedre grense) × nettbrett-faktor 2–4× (umålt):**

   | Workere på nettbrett | PC-anslag | × 2 | × 3 | × 4 |
   |---|---|---|---|---|
   | 3 | 26–36 s | 52–72 s | 78–108 s | 104–144 s |
   | 5 | 17–23 s | 34–46 s | 51–69 s | 68–92 s |
   | 6 | 15–20 s | 30–40 s | 45–60 s | 60–80 s |

   Hypotesen «< 60 s» overlever bare med ≥ 5 effektive workere og faktor
   ≤ 2–3. Med 3 effektive kjerner (typisk for nettbrett med
   effektivitetskjerner, jf. panelet §1.1) faller den. **Spak 8
   (nettbrett-målingen, ADR-0005 port 1) avgjør nå alene** — den må måle
   både faktor og reell poolgjennomstrømning (`hardwareConcurrency` lyver
   på big.LITTLE), ikke bare én av dem.
4. **Klasser:** S-1 30/30 gjennomførbare; S-3 26 + 4 inkonklusive
   (partial dekning); S-7 15 + 15 inkonklusive. Skriptets `kind()` er
   grov (partial ⇒ inconclusive uansett årsak) og er ikke
   `classifyMember`; at S-3s fire «dødelige» medlemmer og S-7s
   «stopper»-medlemmer nå ender som inkonklusive er en observasjon som
   hører hjemme i bølge 3s nevner-arbeid (D9.2 b-full), ikke en
   konklusjon her.
5. **Kontrollen alene tar 3,3–3,7 s** — «kontrolltabell på sekunder» for
   5–8 avganger er 17–30 s sekvensielt på PC, altså også avhengig av
   poolen for å holde F3.5s første løfte.

**Bølge 2 PC-del: levert.** Gjenstår: nettbrett-tallet (Magnus). Deretter
vedtak om F3.5 (D8.13-hypotesen) og eventuelt vise-versa-porten
(F12-remåling) — begge Magnus'.
