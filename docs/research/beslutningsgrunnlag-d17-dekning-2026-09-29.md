# Beslutningsgrunnlag D17 — værdekning langs ruten og strøm i havn

Felles grunnlag for panelet (`ekspertpanel-d17-dekning-2026-09-29.md`).

## Målt med ekte data 2026-09-29 (diagnose, rutemotor-agent)

Skjæløy–Skagen, MEPS 03Z, NorKyst 00Z, 34 Oceanforecast-punkter (alle ok),
avgang = nåtid (etter avgangsrettelsen). 24 kjøringer uten datafeil
(kontroll + 23 medlemmer; 6 medlemmer hadde bare fyllverdier — egen feil,
rettes separat):

- `pruned.noWeather` = 0 overalt; ingen horisont-/tidsproblemer.
- **16/24** er `coverage.weather = "partial"` KUN fordi søket slo opp noder
  utenfor den endelige ruten uten strøm (kystmerket sentinel, ~3 400–3 800
  oppslag) eller bølge (punkt 10–13 nm unna, ~1 700–2 100 oppslag); ~16 % av
  alle oppslag. `search.ts::environmentAt` setter en global bit.
- **8/24** har selv et rutesteg uten strøm: ett steg ved 58,875N 10,99E
  (Hvaler-ytre) og/eller sluttetappens startpunkt ved ~57,74N 10,60E (inn mot
  Skagen).
- **Målet Skagen (57,721N 10,584E) er strøm-sentinel ved ankomst for alle.**
  Motoren slår det ikke opp i dag (sluttetappen samples ved start).
- Konsekvens: «full (d)» (dekning over rutens steg, D15-panelets forslag)
  med start-sampling ⇒ 16/24 fullt dekket; med start + ende-sampling ⇒ 0/24
  (Skagen). Full (d) alene fyller altså ikke trafikklyset for havn-til-havn.
- Søkesteg uten strøm får i dag intet per-steg-flagg (kun sluttetappen får
  `STROM_DATA_MANGLER`).
- Ruten beregnes mot `SYNTETISK-TESTMASKE` (golden-scenarioet), ikke
  Kartverket-masken — noen kysttreff skyldes at testmasken ikke følger ekte
  kystlinje.

## Gjeldende vedtak som rammer inn

- ADR-0005 og D11.1 (`docs/specs/robusthet.md` §7): partial + nådd mål ⇒
  inkonklusiv «dekning-felt».
- D15 (`docs/research/ekspertpanel-d15-kystkant-2026-09-27.md`,
  `docs/specs/strom-produsent.md`): kystkant-forlengelse ≤ √2 celler,
  kystmaske, d-min for sluttetappen; full (d) som egen runde; lateral foreslo
  en «havnesone» (første/siste N nm) — avvist *for da* (matematiker: krever
  samme prosess som (d)).
- Vedtak A 2026-09-29: manglende bølge teller som ukjent Hs (aldri grønt).

## Spørsmål

- **D17.1 Full (d).** Dekning (`coverage.weather`) beregnes over rutens
  egne steg (inkl. sluttetappen); søksnivået beholder bare horisont og
  vindhull; mangler utenfor ruten blir diagnostikk (teller). Sample start
  og/eller ende per steg? Per-steg-flagg `STROM_DATA_MANGLER` på alle steg.
  Krever ADR (endrer hva ADR-0005/D11.1 leser).
- **D17.2 Strøm som mangler nær land på ruten / i havn.** (a) Streng: gjør
  medlemmet inkonklusivt (⇒ havn-til-havn blir aldri avgjort). (b)
  Havnesone: innenfor N nm fra start og mål kreves ikke strøm; steget
  flagges synlig «strøm ukjent i havneinnseilingen», medlemmet klassifiseres
  ellers normalt. (c) Kystmerket sentinel (innenfor kystmasken) flagges per
  steg men teller ikke som manglende dekning, uansett posisjon. (d) Annet.
- **D17.3 Rekkefølge** mot Kartverket-masken (i stedet for testmasken) og
  nettbrett-remålingen.
