# THREDDS spike (Fase 0, Spike 1)

Formål og funn: se `docs/research/spike-thredds.md`. Dette er kildekoden og
bevismaterialet — tenkt som kimen til `tools/weather-pack`, ikke som
produksjonskode ennå (ingen retry/backoff, ingen ekte NetCDF/DAP2-binærdekoding,
ingen caching av grid-indekser mellom kjøringer).

## Kjøre rekkefølge

```
node 01-catalog-check.mjs              # katalogverifisering (MEPS, NorKyst, fou-hi)
node 02-find-bbox-indices.mjs          # finn y/x-indeksvindu for MEPS-grid -> out-bbox-indices.json
node 03-meps-member-subset.mjs         # NCSS/OPeNDAP-subset-test, MEPS-vind, 1 og 3 medlemmer
node 04-norkyst-bbox-and-subset.mjs    # finn y/x-indeksvindu for NorKyst-grid + strømsubset
```

`lib.mjs` er delt hjelpekode (timedFetch, formattering). Ingen npm-avhengigheter —
kun Node 18+ sin innebygde `fetch`.

## Viktigste funn (se rapporten for detaljer)

- **NCSS er nede** (`thredds/ncss/...` -> 503 på alt, hele tjenesten) på
  undersøkelsestidspunktet. Alle subset-tester bruker i stedet OPeNDAP
  index-range-subsetting (`dodsC/....nc.ascii?var[a:b:c][...]` eller `.dods`
  for binær).
- MEPS-ensemblet er **én fil med `ensemble_member`-dimensjon** (`meps_lagged_6_h_latest_2_5km_*.nc`),
  ikke `meps_mbr###`-filer per medlem — verken i dagens katalog eller i arkivet
  tilbake til 2020.
- MEPS-arkivets ensemble-produkt (`meps_lagged_6_h_subset`) **finnes ikke lenger
  etter ca. nov/des 2024** — kun deterministisk kjøring i arkivet siden da.
- NorKyst: bruk `fou-hi/norkystv3_800m_m00_be` (live, rullerende 2024-01-01 til
  ~i dag+5d). `fou-hi/norkyst800m-1h` er dødt (stanset okt. 2025).
  `romshindcast/norkyst_v3` er en frossen hindcast 2012-01 til 2025-08.
- WAM800 Skagerrak: `fou-hi/mywavewam800s_curr/MyWave_wam800_curr_c4WAVE{00,06,12,18}.nc`
  (og `c4SPC*.nc` for spektra) — bekreftet, men **ikke subset-testet** (bytebudsjett brukt opp).

## Gjenbrukbare artefakter

- `out-bbox-indices.json` — MEPS y/x-indeksvindu for Skjæløy–Skagen-bbox (2,5 km-grid).
- `out-norkyst-bbox-indices.json` — samme for NorKyst v3 (800 m-grid).

Disse indeksene er statiske for et gitt projeksjon+grid og bør caches i
weather-pack fremfor å regnes ut på nytt hver kjøring (kostet ~18 MB å regne ut
NorKyst-vinduet her — gjør det én gang, lagre resultatet).
