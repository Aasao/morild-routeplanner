---
name: wrangler-r2-opplasting
description: Praktiske feller ved bulkopplasting av mange filer til R2 via wrangler CLI fra denne sandboxen
metadata:
  type: project
---

- **`pnpm --filter @morild/worker exec wrangler ...` kjører med CWD =
  `apps/worker`, ikke shellets CWD.** Relative `--file`-stier (f.eks.
  `out/weather/1/<hash>.bin`) løses feil og gir "The file ... does not
  exist" — bruk ALLTID absolutte stier for `--file` i denne wrapper-
  konteksten.
- **`bash while IFS= read -r line; do ...; done < fil` DROPPER SISTE
  LINJE hvis filen ikke slutter med newline.** `Array.from(set).join("\n")`
  i Node gir aldri en avsluttende newline — bygg alltid en løkke som
  bekrefter antall behandlede linjer mot forventet antall (`wc -l` vs.
  faktisk telling), eller legg til en avsluttende newline eksplisitt.
  Dette kostet én mistet R2-opplasting (oppdaget ved stikkprøve, ikke ved
  loggen — scriptet rapporterte "uploaded=179" og jeg leste forbi
  avviket fra forventet 180 første gang).
- **`--remote` er PÅKREVD** for `wrangler r2 object put/get` for å faktisk
  treffe den ekte bøtta (uten det bruker wrangler en lokal/simulert
  ressurs stille).
- **Én `pnpm --filter ... exec wrangler`-prosess per fil er tregt men
  stabilt** (~1-1,5 s/fil inkl. pnpm-oppstart) — 180 filer tar ca.
  3-4 minutter i bakgrunnen. Kjør slike løkker med `run_in_background`
  og poll med korte `sleep`-intervaller i en `while`-løkke (IKKE
  standalone `sleep 60`, blokkert av verktøyet).
- **Verifiser opplasting med stikkprøver** (`wrangler r2 object get` mot
  et par tilfeldige nøkler fra pekeren + ALLTID den siste nøkkelen i
  listen, siden nettopp den er utsatt for newline-bugen over) —
  `wrangler r2 object` har ingen `list`-underkommando i denne versjonen
  (4.128.0); kun `get`/`put`/`delete`.
- Se også [[thredds-kilde-egenskaper]] for selve datainnholdet som lastes
  opp.
