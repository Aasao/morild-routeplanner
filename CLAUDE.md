# RoutePlanner v2 («Morild»)

Personlig maritim ruteplanlegger for seilbåten Dufour 41 «Morild». V1
(C:\RoutePlanner, SKRIVEBESKYTTET fasit) er en fungerende isokron-værruter
bygget om bord sommeren 2026. V2 skal bli en Android-app (telefon + nettbrett,
PWA/TWA) hostet på Magnus' Cloudflare-konto, med kartområde Skandinavia.

Språk: dokumentasjon og kommentarer på norsk (énbrukersprosjekt). Samtale med
Magnus på norsk. Kode-identifikatorer på engelsk.

## Ufravikelige prinsipper

1. **Sikkerhet foran optimalitet.** Ruteren er et planleggingsverktøy, ikke en
   navigasjonsautoritet. Enhver rute som ikke kan garanteres fri for kartlagte
   farer (dybde < sikkerhetsmargin, skjær, tørrfall) skal merkes eksplisitt
   usikker i UI. Ærlig degradering er en designfilosofi: manglende data vises,
   aldri skjules.
2. **Kartdata tolkes, ikke bare vises.** Farbarhet beregnes fra autoritative
   dybde-/faredata (farbarhetsmaske med båtens dypgang + klaring som
   parametre). Rasterkart er visning; vektordata er sannhet for ruteren.
3. **Robusthet er førsteklasses.** Hver ruteanbefaling skal bære et
   usikkerhetsmål: hvordan påvirkes tid/komfort/gjennomførbarhet av
   perturbasjoner i vind, bølger, avgangstid og polar-ytelse
   (ensemble-/sensitivitetsanalyse). Anbefal ruter som er gode under
   variasjon, ikke bare optimale i én prognose.
4. **Klienten beregner, skyen forbereder.** Ruteberegning skjer på enheten
   (Web Worker/WASM); Cloudflare-siden henter, transformerer og cacher data
   (vær, ensemble, farbarhetsmaske, tiles). Appen skal virke frakoblet med
   sist synkede data.
5. **Datakilders lisens og vilkår dokumenteres** i `docs/legal/` før de tas i
   bruk (Kartverket, MET, Overpass-etikette, tile-vilkår, attribusjon i UI).
6. **V1-koden og loggene er fasit og skrivebeskyttet.** Algoritmeinnsikt,
   polardata og kalibreringslogger (218k rader) gjenbrukes derfra; ingenting
   skrives tilbake til C:\RoutePlanner.

## Beslutningshierarki

`docs/00-kravspek.md` → `docs/decisions/ADR-*.md` → `docs/specs/*.md` → kode.
Ingen kode uten spec. Ingen arkitekturendring uten ADR. Er du i tvil om en
beslutning er tatt: søk i `docs/decisions/`; finner du ingenting, skriv
ADR-utkast og spør Magnus.

## Arbeidsflyt

- Start hver oppgave med relevant spec; uklar/manglende spec skrives først.
- Små, verifiserbare steg. Kjør tester før du sier deg ferdig.
- Bruk `@agent-<navn>` for spesialistarbeid, se `docs/03-modellruting.md`.
- Store søk/utforsking via subagent, ikke i hovedsesjonen.
- Funn og beslutninger skrives tilbake til `docs/` — kontekstvinduet er
  flyktig, repoet er ikke.

## Skills, hooks og innebygde verktøy

Detaljer i `docs/03-modellruting.md` §Verktøy. Kortversjon:

- `/qa` — `pnpm check` + `pnpm test` + `pnpm test:arch` i qa-runner. Kjør
  før du melder noe ferdig og før commit.
- `/commit` — eneste vei til commit, og bare Magnus kan starte den (skriv
  `/commit [tittel]`; ordet «commit» i chatten er ikke nok, skillen er
  sperret for modellen). Den kjører `/qa` først og nekter rødt.
- `/panel` — hør fagagent-panelet før hvert beslutningspunkt legges frem
  (råd → utfordring → tilsvar → votering GODKJENN/ENDRE/AVVIS).
- `/code-review --fix` og `/simplify` på diffen før commit av en bølge.
  De innebygde tar bugs og forenkling; `@agent-code-reviewer` tar
  sikkerhetssemantikk og prosjektprinsipper. Begge, ikke enten/eller.
- Review-bølger med mange funn: Magnus sier «bruk en workflow» → Workflow-
  verktøyet kjører review-dimensjoner parallelt med verifisering per funn.
  Claude kan ikke starte det på eget initiativ; foreslå det når det passer.
- `/skill-doctor` ved fasestart: viser ubrukte skills og kontekstkost.
- `.claude/hooks/vern.mjs` blokkerer skriving til v1 fra skallet og
  git-skriving fra subagenter. Blokkert → ikke omgå, rapporter.
- `implementer` kjører i eget git-worktree; hovedsesjonen reviewer,
  committer der og fletter (se modellruting).

## Kodekonvensjoner

- TypeScript strict. Ingen `any` uten begrunnende kommentar.
- Domenelogikk i `packages/` (geo, routing, weather, charts, polar, protocol),
  apper er tynne skall (`apps/pwa`, `apps/worker`).
- Rutemotoren er ren og deterministisk: samme input → samme rute; all I/O
  (fetch, cache) lever utenfor motoren. Dette er forutsetningen for
  ensemble-kjøring og regresjonstester.
- Enhetstester for all geometri/fysikk (haversine, polar-interpolasjon,
  landmaske, farbarhet, derating). Golden-route-tester: kjente strekk med
  frosset værfelt → forventet rute innenfor toleranse.
- Ingen hemmeligheter i repoet; Cloudflare-secrets + `.dev.vars.example`.

## Kommandoer

- `pnpm install` — installer avhengigheter (pnpm via corepack, Node 22+).
- `pnpm check` — `tsc -b` (strict, project references på tvers av alle
  `packages/*`) + eslint (flat config) fra rot.
- `pnpm test` — Vitest på tvers av alle pakker (`packages/**/*.test.ts`,
  `apps/**/*.test.ts`, `tools/**/*.test.ts`).
- `pnpm test:arch` — arkitekturgrense-testen i `tools/arch-tests`: beviser
  at `packages/geo` og `packages/routing` aldri importerer fetch/fs/
  node:-moduler eller andre pakker enn `@morild/geo`/`@morild/protocol`.
- `pnpm test:golden` — golden-route-regresjon med frosne værfelt (kommer i
  fase 2, ikke etablert enda).
- `pnpm dev` — starter `apps/worker` (`wrangler dev`) og `apps/pwa`
  (`vite`) side om side (`concurrently`); se `docs/specs/app-skjelett.md`.

## Når du skal stoppe og spørre Magnus

- Alt som endrer sikkerhetssemantikk (farbarhetsmarginer, faretolkninger)
- Valg mellom arkitekturretninger med reell konsekvens
- Nye betalte tjenester, API-nøkler eller avhengigheter med vilkår
- Når en oppgave er vesentlig større enn antatt

Ellers: fortsett autonomt. Magnus er sparringspartner, ikke godkjenner av
hvert steg.
