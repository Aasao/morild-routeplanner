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

## Verktøy, skills og hooks (innført 2026-09-03 etter Fable 5.1)

### Agent-frontmatter

Feltene `effort`, `memory`, `isolation` og `skills` i `.claude/agents/*.md`
speiler tabellen over:

| Agent | model | effort | memory | annet |
|---|---|---|---|---|
| rutemotor | opus | high | – | opus-gulv; Fable vurderes først når golden-tester kan sammenligne (regel 6) |
| code-reviewer | sonnet | high | – | reviewer skal lese ferskt, derfor uten minne |
| implementer | sonnet | medium | – | `isolation: worktree` |
| kartdata, vaer-analytiker | sonnet | medium | project | |
| plattform | sonnet | medium | – | `skills: [adr]` forhåndslastet |
| v1-arkeolog | haiku | low | project | |
| qa-runner | haiku | low | – | |

**Agentminne** (`memory: project`) gir agenten `.claude/agent-memory/<navn>/`
som overlever sesjoner og sjekkes inn i git. Det er agentens arbeidsnotater
(hvor ting ligger, feller, enheter) — `docs/` er fortsatt sannheten, og
funn/beslutninger skrives dit. Blir en agents minne feil eller foreldet:
rett det eller slett katalogen; det er ikke fasit.

### Implementer i worktree

`isolation: worktree` gir hver implementer-kjøring sitt eget git-worktree.
Bakgrunn: stash-kollisjonen 2026-09-03 der parallelle agenter i samme
arbeidstre nullstilte hverandres endringer. Flyt:

1. Implementer leverer rapport med worktree-sti, endrede filer og
   testresultat. Uendret worktree ryddes automatisk.
2. Hovedsesjonen reviewer diffen i worktreet (`git -C <sti> diff`),
   kjører `/qa` der ved behov, committer der (`git -C <sti> commit`),
   fletter inn i main og fjerner worktreet (`git worktree remove <sti>`).
3. Flere implementere parallelt = flere worktrees; flett én om gangen.

Kostnad: `pnpm install --frozen-lockfile --prefer-offline` per worktree
(pnpm-store gjør det raskt). Rutemotor-agenten kjører fortsatt i
hovedtreet (én om gangen, korrekthetskritisk).

### Hooks

`.claude/settings.json` registrerer én PreToolUse-hook på Bash/PowerShell:
`.claude/hooks/vern.mjs` (Node, fordi jq mangler på maskinen). Den
blokkerer (exit 2) to ting permission-listene ikke kan uttrykke:

- **Skriving til v1** (`C:/RoutePlanner`, alle stavemåter) via
  omdirigering, cp/mv/rm/tee/mkdir, `sed -i`, git-skriving eller
  PowerShell-cmdlets. Lesing er fritt. Prinsipp 6 i CLAUDE.md.
- **Git-skriving fra subagenter** (commit/add/push/stash/checkout/
  reset/…) — hook-input har `agent_id` kun for subagenter, så
  hovedsesjonen er upåvirket. Deny-listen i settings.json dekker fortsatt
  stash/reset --hard/checkout --/restore/clean/force-push for alle.

Hooken er et vern, ikke en sandkasse: et skript som selv åpner filer i v1
fanges ikke. Tester: `node .claude/hooks/vern.test.mjs` (kjøres ikke av
`pnpm test`, ligger utenfor pakke-globene med vilje).

### Skills

| Skill | Hvem utløser | Hva |
|---|---|---|
| `/qa` | Claude eller Magnus | `context: fork` inn i qa-runner, synkron; rapporterer tall som `/commit` bruker |
| `/commit` | kun Magnus (`disable-model-invocation`) | kjører `/qa`, eksplisitt staging, husstil for melding, aldri amend/force |
| `/panel` | Claude eller Magnus | re-etablerer fagagent-panelet fra `docs/research/ekspertpanel-*.md`; råd → utfordring → tilsvar → votering |
| `/spec`, `/adr`, `/standup` | som før | |

### Innebygde verktøy — når de brukes

- **`/code-review --fix` + `/simplify`** på diffen før commit av en
  bølge. Overlapper med `@agent-code-reviewer` på bugs, men ikke på
  sikkerhetssemantikk og prosjektprinsipper — derfor begge. Trivielle
  differ (rename, formattering): hopp over, lint tar det.
- **Workflow-verktøyet** («bruk en workflow»): review-bølger med mange
  funn — én agent per review-dimensjon (korrekthet, sikkerhetsflagg,
  ytelse, spec-samsvar) parallelt, hvert funn verifisert av egen agent før
  det rapporteres. Krever Magnus' eksplisitte ord; Claude foreslår det når
  en bølge har > ~10 funn eller spenner flere pakker. Retningslinje: under
  15 agenter per workflow.
- **`/skill-doctor`** ved fasestart: ubrukte skills fjernes eller slås
  sammen.
- **`/fewer-permission-prompts`** når allow-listen føles for kort — den
  foreslår allow-regler fra faktisk bruk.
- **Ikke i bruk:** agent teams (eksperimentelt, dyrt), ultracode som
  standard (deterministisk motor-kode trenger det ikke — bruk `/effort`
  per oppgave ved behov).
