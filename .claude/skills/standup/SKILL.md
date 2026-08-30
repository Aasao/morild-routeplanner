---
name: standup
description: Statusrapport på RoutePlanner v2-prosjektet. Bruk når Magnus spør hvor vi står, eller ved start av en økt etter opphold.
---

# Standup for RoutePlanner v2

Lag en kompakt statusrapport (norsk) fra repoets faktiske tilstand — ikke
fra hukommelse:

1. `git -C C:\Utvikling\routeplanner-v2 log --oneline -10` og `git status`
   — hva er levert og hva ligger ukommittert.
2. `docs/01-prosjektplan.md` — hvilken fase er aktiv; sjekk exit-kriteriene
   mot virkeligheten (kjør `pnpm check`/`pnpm test` via qa-runner-mønster
   hvis kode finnes).
3. `docs/specs/` og `docs/decisions/` — hva er skrevet siden sist, hva har
   status Foreslått og venter på Magnus.
4. Åpne spørsmål/beslutningspunkter fra kravspekens §7 og spec-enes
   «Åpne spørsmål».

Rapportform: «Ferdig siden sist / Pågår / Blokkert på Magnus / Neste».
Maks ~15 linjer. Feilende tester rapporteres med feilmelding, aldri pyntes.
