---
name: qa
description: Kjør full verifisering av RoutePlanner v2 (pnpm check, pnpm test, pnpm test:arch) i qa-runner og rapporter kun avvik. Bruk før du melder noe ferdig, før /commit og etter hver implementasjonsbølge.
when_to_use: «kjør testene», «er alt grønt», før ferdigmelding, før commit, etter at implementer/rutemotor har levert.
argument-hint: [valgfritt: vitest-filter, f.eks. packages/routing]
context: fork
agent: qa-runner
background: false
---

# Verifisering av RoutePlanner v2

Kjør fra repo-roten (C:/Utvikling/routeplanner-v2), i denne rekkefølgen, og
stopp ikke ved første feil — alle tre skal rapporteres:

1. `pnpm check` (tsc -b strict + eslint)
2. `pnpm test` — eller `pnpm vitest run $ARGUMENTS` hvis et filter er gitt
3. `pnpm test:arch` (arkitekturgrensene for packages/geo og packages/routing)

Rapportformat (norsk, kompakt):

- Én linje per steg: `check: rent` / `test: 788 grønt` / `arch: grønt`,
  eller ved feil: fil:linje, feilmelding og testnavn. Ta med nok kontekst
  (forventet vs. faktisk) til at hovedsesjonen kan fikse uten å kjøre selv.
- Antall grønne tester og «check rent/ikke rent» skal stå eksplisitt —
  /commit bruker tallene i commit-meldingen.
- Du endrer aldri kode. Du pynter aldri på resultatet.
