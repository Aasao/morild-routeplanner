# Beslutningsgrunnlag D13 — etter nettbrett-målingen (2026-09-27)

Felles grunnlag for panelet (`ekspertpanel-d13-nettbrett-2026-09-27.md`).

## Hva som er målt

Fullt i `maaling-nettbrett-2026-09-27.md` (rådata i
`nettbrett-maaling-raadata-2026-09-27/`). Kort:

- Enhet: Samsung Galaxy Tab S7 FE 5G, Snapdragon 750G (2 × A77 + 6 × A55),
  Chrome 153, pool 6 Workere. Første cron-bygde pakke (MEPS 07Z, kun vind).
- Kontroll rundtur 5,2–6,4 s (søk 4,6–5,8 s, nødhavnprofil 2,2 s).
- **Ensemble 29 medlemmer: 58,5 / 60,6 / 60,2 s.** Median søk per medlem
  10,5 s (PC 2026-09-07: 7,8 s, ensemble 40,8 s på rolig PC).
- Pool: Σ rundtur/6 = 53–54 s ⇒ ~90 % utnyttelse; resten er hale (29/6 =
  4,8 runder). Dekoding ~0,2 s av ~10,5 s. Felt delt (0 ms per medlem).
- Deterministisk: identiske etiketter/iterasjoner/durationS per medlem på
  tvers av tre kjøringer. Etiketter per medlem 104–138 k.
- Orakel (D10.5): Spearman ankomst ↔ orakelrang 0,975–0,986.
- Heap 54 MB = kun hovedtrådens `performance.memory` (bøttet, identisk i
  alle tre). **Worker-heaper umålt ⇒ 4a-exit «heap < 500 MB målt på
  nettbrettet» ikke bevist.**
- Alle 29 medlemmer inkonklusive (D11.1 «dekning-felt», vind alene).
- **Skjerm-av:** når Magnus ikke holdt vinduet aktivt slo nettbrettet av
  skjermen; ved retur lastet siden på nytt og alt startet fra null.
  5 forsøk for 3 komplette kjøringer.
- «Kjører hello-route …» (syntetisk golden-bevis i egen Worker,
  `apps/pwa/src/hello-route.ts`) henger fortsatt permanent på nettbrettet,
  mens værflytens Workere fullfører.

## Gjeldende vedtak som rammer inn (les dem)

- `docs/specs/robusthet.md` §7 D10.1–D10.6 (linje ~806): D10.1 (a) —
  progressiv semantikk er kontrakten, «< 60 s» er strøket som løfte, målt
  tid vises; spak 4–6 (profilsøk → alloc-fri hot-loop → read-only-
  felt/…) «etter bølge 3–5 og betinget av tallet». D10.3 (a) vise-versa-
  port: utløses når nettbrett-tallet foreligger **og > 60 s etter tiltak**;
  utfallsmengde «gjenåpne F3.5-semantikk / medlemshorisont /
  avgangsvindu».
- `docs/research/nettbrett-maaling-oppskrift-2026-09-05.md` «Hva tallet
  avgjør»: ≤ 60 s ⇒ spak 4–6 utsettes; > 60 s ⇒ port D10.3 etter at spak
  4–6 er vurdert.
- `docs/decisions/ADR-0005-ensemble-mekanisme.md` falsifiseringsporter 1–5.
- `docs/research/fase4a-plan-2026-09-04.md` — bølge 6 (D12.1, bail-out
  maks over medlemmer) venter på dette tallet; 4a-exit.
- `docs/research/ekspertpanel-d10-f35-etter-spak7-2026-09-05.md` og
  `ekspertpanel-d12-boelge4-2026-09-05.md` — rollenes egen historikk.
- `docs/01-prosjektplan.md` fase 3-rest: strøm/bølge i pakken er ikke
  bygget; uten dem blir alle medlemmer inkonklusive og trafikklys/vifte er
  tomme.

## Spørsmål

- **D13.1 Tolkning av 60 s-grensen.** (a) Godta «på grensen»: bølge 6
  neste, spak 4–6 fortsatt utsatt. (b) Over grensen: spak 4–6 vurderes
  med vekt på søket (worker-overhead er lite), så port D10.3. (c) Ta det
  mest sannsynlige søketiltaket først og remål.
- **D13.2 Worker-heap for 4a-exit.** Hvordan måles det ærlig på Android
  Chrome (per-Worker `performance.memory`? `measureUserAgentSpecificMemory`
  krever COOP/COEP; manuelt via Android/Chrome-verktøy; estimat fra
  datastrukturer)?
- **D13.3 Skjerm-av/omlasting.** Screen Wake Lock API under beregning,
  gjenopptakbar beregning (persistere ferdige medlemmer), begge, eller
  utsett til fase 5 (app-opplevelse)?
- **D13.4 hello-route-hengen.** Prioritet og tilnærming.
- **D13.5 Rekkefølge** mellom bølge 6, ytelse, D13.2–D13.4 og strøm/bølge i
  pakken (fase 3-rest) — det siste er det som gir trafikklyset innhold.
