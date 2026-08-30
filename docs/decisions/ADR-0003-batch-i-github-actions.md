# ADR-0003: Batch-jobbens hjem — GitHub Actions cron

- Status: vedtatt
- Dato: 2026-08-30
- Besluttet av: Magnus

## Kontekst

Værpakke- og kartpakke-pipelinen (henting fra THREDDS/MET/Kartverket,
kvantisering, publisering til R2) må kjøre pålitelig uten at Morilds
seilingsplaner avhenger av at Magnus' lokale PC er på. Kravspekens
beslutningspunkt B2 (`docs/00-kravspek.md` §7) stiller spørsmålet om
batch-jobbens hjem; risikotabellen i prosjektplanen
(`docs/01-prosjektplan.md`) peker på "batch-pipelinen dør mens båten er på
tur" som en reell risiko, med mottiltak "GitHub Actions-cron (uavhengig av
lokal PC) + healthcheck-varsling + kildestatus i pakke-peker".

## Beslutning

Værpipelinen (`tools/weather-pack`, senere også `tools/chart-pack`) kjører
som en cron-schedulert GitHub Actions-jobb i et offentlig repo, og skriver
til R2 via et Cloudflare API-token lagret som GitHub Actions-secret. Jobben
pinger en healthcheck-URL ved hver kjøring (varsling ved pipeline død
> 12 t, jf. kravspek F2.4). Lokal kjøring fra Magnus' PC beholdes som
fallback når GitHub Actions er nede eller ved feilsøking.

Besluttet av Magnus 2026-08-30 (kravspek §7, beslutningspunkt B2).

## Alternativer vurdert

- **Kun lokal PC (cron/Oppgaveplanlegger):** vraket som eneste vei —
  pipelinen dør hvis PC-en er av eller Magnus er på sjøen uten den; dette
  er nettopp risikoen mottiltaket adresserer.
- **Cloudflare Cron Trigger (Worker) som eneste hjem:** vurdert og lagt til
  side for v2.0 — mulig fremtidig migrering, men GitHub Actions gir gratis
  cron-kjøring uten separat Workers-utrulling for en batch-jobb som ikke
  trenger å være en Worker, og gir enklere kjørelogg (Actions-UI) for én
  utvikler å overvåke.
- **Durable Object alarm:** vraket — riktig verktøy for finkornet,
  per-jobb-isolert retry ved høyere skala (flere brukere/områder), men
  unødig kompleksitet for én daglig/timelig batch-kjøring med én bruker.

## Konsekvenser

- Positivt: pipelinen er uavhengig av at noen bestemt enhet er på; gratis
  innenfor GitHub Actions' gratisnivå for et offentlig repo; healthcheck
  gir tidlig varsel før Magnus oppdager det ved kaiplanlegging.
- Negativt og viktig: **repoet må være offentlig**, som betyr at ingen
  hemmeligheter (API-nøkler, tokens) noensinne skal ligge i repoet — kun i
  GitHub Actions-secrets og Cloudflare-secrets (`.dev.vars.example`
  dokumenterer navnene, aldri verdiene). Dette er allerede prinsipp i
  CLAUDE.md/kravspek N3/N4, men får skjerpet konsekvens av at repoet er
  offentlig, ikke privat.
- Blir vanskeligere senere hvis vi må gjøre repoet privat (f.eks. ved
  fremtidig kommersialisering): GitHub Actions cron fungerer også i
  private repo på betalte GitHub-planer, så en migrering er en
  synlighets-endring, ikke en arkitekturendring — men gratisnivået for
  cron-minutter i private repo er mer begrenset og må vurderes da.

## Bekreftelse

`.github/workflows/ci.yml` viser mønsteret (checkout + corepack + pnpm);
selve batch-cron-workflowen legges til `.github/workflows/` når
`tools/weather-pack` bygges (fase 3). `.dev.vars.example` dokumenterer
`CLOUDFLARE_API_TOKEN`, `R2_BUCKET_NAME` og `HEALTHCHECK_URL` som
miljøvariabler/secrets jobben trenger. Fase 0 leverer kun denne ADR-en og
malen for secrets — selve pipelinen kommer i fase 3.
