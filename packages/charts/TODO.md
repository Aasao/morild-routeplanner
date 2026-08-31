# TODO — packages/charts

Denne filen er en beskjed til den agenten som eier `tools/arch-tests`
(oppgaveavgrensningen for fase 1-bølge 1 av farbarhetsmasken tillot ikke at
jeg rørte den pakken selv). Ikke noe her er kode — bare et dokumentert behov.

## 1. Legg `@morild/charts` til `ALLOWED_PACKAGE_IMPORTS`-grensen

`docs/specs/farbarhetsmaske.md` §3.6 og §8 punkt 7 spesifiserer at
`packages/charts` skal ha samme importgrense som `packages/geo` og
`packages/routing` håndhever i `tools/arch-tests/import-boundaries.ts`:

- Aldri `fetch`/`fs`/`node:`-moduler eller andre I/O-kilder.
- Aldri `@morild/weather` (lagdelingsregelen: kartlaget kjenner ikke vær —
  se spec §2 avgrensning).
- Kun `@morild/geo` og `@morild/protocol` som pakkeavhengigheter.

I dag (fase 1-bølge 1) importerer `packages/charts/src/*` faktisk **kun**
`@morild/geo` og `@morild/protocol` (se `chart-source.ts`,
`point-in-polygon.ts`) — grensen er allerede reelt overholdt, den er bare
ikke *håndhevet* av `checkPackageBoundary`/`ALLOWED_PACKAGE_IMPORTS` ennå.

Foreslått endring i `tools/arch-tests/import-boundaries.ts`:

```ts
export const ALLOWED_PACKAGE_IMPORTS: ReadonlySet<string> = new Set([
  "@morild/geo",
  "@morild/protocol",
]);
```

er allerede riktig verdi (charts trenger ingen nye oppføringer der) — det
som mangler er å kalle `checkPackageBoundary(join(REPO_ROOT,
"packages/charts/src"))` i `import-boundaries.test.ts`, parallelt med de to
eksisterende `describe`-blokkene for `packages/geo` og `packages/routing`.

**NB, viktig presisering for arch-test-agenten:** `tools/chart-pack`
(byggepipelinen) importerer derimot fritt `@turf/turf`, `node:fs`, `node:zlib`
og `@morild/charts` (for pakke-typene) — det er *med vilje* og skal **ikke**
underlegges samme grense. Grensen gjelder kun kjøretids-oppslagspakken
`packages/charts`, ikke byggetidsverktøyet. Se
`docs/specs/farbarhetsmaske.md` §4 vs. §3.6 for skillet (F1.0).

## 2. Årsskifte-spennende vernesoner (mindre presserende, egen sak)

`chart-source.ts`s `isDateInSeason` håndterer sesonger som ikke krysser
årsskiftet korrekt, og har en enkel (ikke skuddårs-nøyaktig) "MM-DD →
dagnummer"-approksimasjon som fungerer for sammenligning innenfor ett år,
men er ikke testet grundig for kant-tilfeller nær 31. desember/1. januar.
Ingen kjente Bohuslän-vernesoner krysser årsskiftet per research-grunnlaget
(vår/sommer hekketid), så dette er lav prioritet — men bør fikses før et
faktisk datasett med en slik sesong dukker opp.
