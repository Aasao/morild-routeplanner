# ADR-0001: Monorepo og teknologivalg for RoutePlanner v2

- Status: godkjent 2026-08-30 (dekket av kravspek v1.0-godkjenningen, §5 og F1.8/F6.3)
- Dato: 2026-08-30
- Besluttet av: agent-forslag som venter (Magnus bekrefter)

## Kontekst

V2 skal bli en Android-app (PWA/TWA) hostet på Cloudflare, bygget av én
utvikler med hjelp av Claude Code-agenter, som porterer og utvider v1
(`C:\RoutePlanner`, skrivebeskyttet fasit). Behovet er: rask iterasjon for én
person, sterk typesikkerhet siden domenet (geometri, vær, farbarhet) er lett
å få subtilt feil, testbarhet fra dag én (golden-route-regresjon, 50+
farbarhets-fasit-punkter, N5), og en kartløsning som takler både
offline-bruk og store vektorkartdata på Android-nettbrett. Grunnlag:
`docs/research/plattform-android-cloudflare.md` (§1, §5, "Anbefalt
arkitektur") og `docs/research/v1-funksjonsanalyse.md`.

## Beslutning

Vi bygger et pnpm-monorepo (`apps/`, `packages/`, `tools/`) med TypeScript i
strict-modus overalt, Vitest for alle tester (enhet, golden-route,
integrasjon), MapLibre GL JS + PMTiles for kartrendering, og Cloudflare
Pages (frontend/PWA) + Workers (API-proxy) + R2 (uforanderlige data-pakker)
som hostingplattform.

## Alternativer vurdert

- **Flerrepo (ett repo per pakke):** vraket — for tung koordineringskost for
  én utvikler; monorepo med pnpm workspaces gir delt tooling og atomiske
  commits på tvers av `packages/` og `apps/` uten publiseringssteg.
- **npm/yarn workspaces i stedet for pnpm:** vraket — pnpm gir strengere
  node_modules-isolasjon (unngår phantom dependencies i en flerpakkers
  domenemodell) og raskere installasjon; ingen ulempe identifisert i
  researchen.
- **Leaflet (v1s kartbibliotek) videreført:** vraket — v1 brukte Leaflet med
  enkle raster-tiles; v2 trenger vektorlag for farbarhetsmaske og
  offline-PMTiles i stor skala, som MapLibre GL støtter nativt
  (plattform-researchen §5).
- **Native Android (Kotlin) i stedet for PWA:** vraket — bryter den
  webbaserte kjernen i eskaleringsstigen PWA → TWA → Capacitor anbefalt i
  researchen; ingen Play Store-krav gjør PWA/TWA tilstrekkelig, og
  native ville krevd dobbel implementasjon av all domenelogikk.
- **Annen skyplattform enn Cloudflare:** ikke vurdert i dybden — Magnus har
  allerede en Cloudflare-konto (kravspek §5: "hostet på Magnus'
  Cloudflare-konto"), og v1 kjørte allerede der.

## Konsekvenser

- Positivt: delt TypeScript-konfigurasjon og lint-regler på tvers av hele
  domenet; `pnpm -r` og TS project references gir rask, inkrementell
  bygging; Vitest gjenbrukes fra enhetstest til golden-route-regresjon uten
  verktøybytte.
- Negativt: pnpm workspace-oppsett og TS project references har en viss
  oppstartskost (tatt i fase 0); MapLibre GL er tyngre enn Leaflet og må
  måles på eldre Android-nettbrett (åpent punkt i researchen).
- Blir vanskeligere senere hvis vi bytter bort fra Cloudflare:
  R2/Workers-spesifikk kode skal holdes bak `apps/worker` og
  `tools/*-pack`, ikke lekke inn i `packages/`, slik at et bytte er en
  ombygging av skallet, ikke av domenet.

## Bekreftelse

`pnpm-workspace.yaml` lister `packages/*`, `apps/*`, `tools/*`; `pnpm check`
kjører `tsc -b` (strict, project references) + eslint fra rot; `pnpm test`
kjører Vitest på tvers av alle pakker. Kartbiblioteket blir synlig i
`apps/pwa`s package.json når den appen opprettes (fase 1).
