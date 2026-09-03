---
name: commit
description: Commit i RoutePlanner v2 etter husstil. Kun på Magnus' ordre («commit» / «commit og kjør videre»). Kjører /qa først og nekter å committe rødt.
disable-model-invocation: true
argument-hint: [valgfritt: bølgenavn eller tittel]
allowed-tools: Bash(git add:*) Bash(git commit:*) Bash(git status:*) Bash(git diff:*) Bash(git log:*) Bash(pnpm:*)
---

# Commit-prosedyre

Hovedsesjonen eier git. Subagenter committer aldri (hooken
`.claude/hooks/vern.mjs` blokkerer dem). Én commit per bølge/leveranse.

1. **Verifiser først.** Kjør `/qa`. Rødt → ingen commit; rapporter feilene
   og stopp. Tallene (antall grønne, «check rent») går inn i meldingen.
2. **Se hva som skal med.** `git status --short` og `git diff --stat`.
   Stage eksplisitt med filnavn/kataloger — aldri `git add -A` eller
   `git add .`. Ikke stage:
   - logger, kjørelogger, rådata og binærfiler som ikke er frosne
     testfixtures (sjekk `.gitignore`-kommentarene for mønsteret);
   - filer over ~1 MB uten at Magnus har bedt om det;
   - `.dev.vars`, secrets, `.wrangler/`, `node_modules/`.
   Er noe ukommittert som ikke hører til denne bølgen, la det ligge og nevn
   det i rapporten.
3. **Implementer-arbeid i worktree:** review diffen der, commit i worktreet
   med `git -C <sti> commit`, flett inn i main, fjern worktreet
   (`git worktree remove`). Se docs/03-modellruting.md §Verktøy.
4. **Melding etter husstil** (norsk, se `git log --oneline -10`):
   - Første linje: `<Fase/bølge/tema>: <hva som ble levert>` — deretter
     semikolon-separerte funn med *hvorfor*, ikke bare *hva* («fant og
     fikset X — årsak Y»), og til slutt ` — N grønt, check rent`.
   - Beslutninger: `Beslutninger Dx–Dy (Magnus <dato>): ...`.
   - Ærlig: feilende eller hoppet-over tester nevnes i meldingen.
   - Avslutt med tom linje og trailer:
     `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
   - Bruk `$ARGUMENTS` som tittel/bølgenavn hvis gitt.
5. **Aldri** `--amend`, `--no-verify`, force-push eller push uten ordre.
   Commit på main er normalen i dette prosjektet (énbruker).
6. Rapporter: SHA, første linje, antall filer — og hva som ble bevisst
   holdt utenfor. Ved «commit og kjør videre»: fortsett planen.
