# ADR-0007: Punktbølge via Worker-proxy, fryst per ensemble

- Status: vedtatt
- Dato: 2026-09-27
- Besluttet av: Magnus (D14.2, etter /panel — `docs/research/ekspertpanel-d14-strom-bolge-2026-09-27.md`)

## Kontekst

Bølge er den andre halvdelen av det som gjør ensemble-medlemmer
gjennomførbare/ugjennomførbare i stedet for inkonklusive (`environmentAt`
krever både strøm og bølge). Gridded bølge (WAM800) er uspiket. Første
bølgeleveranse er MET Oceanforecast 2.0 — et punkt-API (Hs og retning per
koordinat, ingen periode). F2.2 sier at værpakker lages som cron-batch til
R2, uten on-demand-subsetting per rute. Et punkt-API kan ikke forhåndsbygges
for alle koordinater en rute kan passere, og `WaveLayers`/pakkeformatet er
bygget for rutenett. Tidevann og MetAlerts går allerede via Worker-proxy.

## Beslutning

Punktbølge hentes via Worker-proxyen for punkter langs ruten, som ett
tidsstemplet, hash-bart svar `{payload, fetchedAtEpochS, hash}`. Klienten
henter og fryser svaret før ensemblet starter; alle medlemmer i kjøringen
bruker samme svar. F2.2 presiseres: regelen om ingen on-demand-subsetting
per rute gjelder gridded felt, ikke punkt-API-er.

## Alternativer vurdert

- **Punktbølge i R2-batchen / `WaveLayers`:** tvinger punktdata inn i et
  rutenettformat og skjuler at dekningen er punktbasert. Avvist enstemmig.
- **Hybrid (fast punktgrid i batch + proxy):** to kodeveier for en marginal
  offline-gevinst. Avvist.
- **Vente på WAM800:** blokkerer trafikklyset på ubestemt tid. Avvist.

## Konsekvenser

- Determinisme bevares bare med fryseregelen: aldri nytt proxy-kall midt i
  et ensemble.
- Frakoblet bruk er svakere enn for vind/strøm: klienten bufrer siste svar
  per korridor; mangler det, sier UI «bølgedata krever nett».
- UI viser tidsstempel og avstand til nærmeste punkt som én
  degraderingstekst.
- Når WAM800 leverer gridded bølge med periode, går den i R2-batchen;
  proxy-veien kan leve videre som rute-presist supplement eller fjernes.
  Hs-only-grenen fjernes da.

## Bekreftelse

- Test: ensemble-orkestreringen gjør ett proxy-kall per kjøring, og alle
  medlemmer får samme `hash`.
- Test: bølgesample uten data gir `undefined` og degraderingstekst, aldri 0.
- Pakkebyggeren i `tools/weather-pack` skriver ingen bølgeflis fra
  Oceanforecast.
