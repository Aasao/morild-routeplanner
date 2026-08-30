# Modellruting — kost/nytte per oppgavetype

Formål: bruke dyre modeller kun der de faktisk gir bedre resultat, og billige
modeller overalt ellers. Agentenes standardmodell er satt i frontmatter i
`.claude/agents/*.md`; denne tabellen er fasit ved tvil og ved manuelle valg.

## Nivåer

| Nivå | Modell | Brukes til |
|---|---|---|
| **Tung** | Fable/Opus (hovedsesjon) | Arkitekturbeslutninger og ADR-review; robusthets-spec (fase 4-design); tverrfaglige avveininger; godkjenningsklare kravdokumenter; feilsøking som har slått feil på lavere nivå to ganger |
| **Tung (agent)** | opus — `rutemotor` | Isokron-/A*-algoritmikk, farbarhetsgeometri som viser seg vanskelig, robusthetsaggregering, ytelseskritisk korrekthetsarbeid |
| **Standard** | sonnet — `kartdata`, `vaer-analytiker`, `plattform`, `implementer`, `code-reviewer` | Spec-skriving i eget domene, datapipeline-implementasjon, UI/app-kode, review, kalibreringsanalyse, websøk-research |
| **Lett** | haiku — `qa-runner`, `v1-arkeolog`, `Explore` | Testkjøring/rapportering, kodebase-søk, v1-oppslag, CSV-logganalyse, mekaniske masseendringer |

## Regler

1. **Research og utforsking går alltid via subagent** — aldri brenn
   hovedsesjonens kontekst på råmateriale. Subagenten leverer destillat;
   hovedsesjonen leser destillatet.
2. **Implementasjon mot klar spec = sonnet.** Hvis implementer-agenten
   strever (to mislykkede forsøk på samme problem), eskaler til opus-nivå
   i stedet for tredje forsøk — to feilforsøk er billigere enn fem.
3. **Verifisering = haiku.** qa-runner kjører alt som produserer mye utdata
   og rapporterer kun avvik.
4. **Rutemotor-pakken har opus-gulv.** Korrekthetsfeil der er dyrest i hele
   prosjektet (sikkerhet + all robusthetsanalyse bygger på den).
5. **Batch-størrelse:** grupper småoppgaver (flere filer, samme mønster) i
   én agentkjøring i stedet for én kjøring per fil.
6. **Golden-tester før modellbytte:** ved usikkerhet om en billigere modell
   holder, kjør samme oppgave én gang og la code-reviewer vurdere — ikke
   anta.

## Typiske kostnadsfeller (unngå)

- Å lese THREDDS-/NetCDF-dokumentasjon i hovedsesjonen → alltid subagent.
- Å la implementer «utforske litt først» → utforsking er Explore/haiku.
- Å review-e trivielt (formattering, rene renames) med sonnet → hopp over
  review, lint tar det.
- Å kjøre full testsuite i hovedsesjonen → qa-runner.
