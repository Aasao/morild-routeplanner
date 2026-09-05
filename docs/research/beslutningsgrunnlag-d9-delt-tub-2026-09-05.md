# Beslutningsgrunnlag D9.1–D9.2 — delt Tub etter skademålingen, og ventilens rekkevidde

- Dato: 2026-09-05
- Status: grunnlag for fagagent-panelet (`/panel`) før D9.1/D9.2 legges
  frem for Magnus. Simulerte fagperspektiver, ikke reelle personer.
- Kilder: `docs/specs/robusthet.md` §3.1–3.2, §4.1, §5.3, §6.3 (status
  bølge 1), §7 (D8.2 vedtatt, D9.1/D9.2 åpne); `docs/specs/rutemotor.md`
  §5.5 og endringslogg 2026-09-04; `docs/decisions/ADR-0004-*.md`
  (motorens egen Tub-bound), `docs/decisions/ADR-0005-ensemble-mekanisme.md`;
  `packages/routing/src/shared-tub.damage.test.ts` (forhåndsregistrert
  skademåling, §5.3), `packages/routing/src/search.ts` (`computeTubBound`,
  `tubMarginFrac`, `pruned.bound`), `packages/robustness/src/outcome.ts`
  (`classifyMember`), `docs/research/ekspertpanel-4a-robusthet-2026-09-04.md`
  (panelets vedtak D8.2: «felt ja; Tub (b) soft med redningsvei og
  skademåling; aldri i R2»).

## 1. Hva som ble vedtatt (D8.2, 2026-09-04)

Delt A\*-felt fra kontrollen til alle medlemmer: ja. Delt Tub-bound
(kontrollens `tubBoundS` gitt som `RouteInput.tubBoundS` til medlemmene):
kun som *soft* bound med redningsvei — et medlem som terminerer uten
`reachesDestination` med `diagnostics.pruned.bound > 0` er ikke bevist
ugjennomførbart og kjøres om uten bound. Slås ikke på i produksjon før
skademålingen i §5.3 er grønn. Tub gis aldri til R2.

## 2. Skademålingen (bølge 1, `shared-tub.damage.test.ts`)

S-3 (front, 30 medlemmer + kontroll) og S-7 (to regimer, 30 + kontroll),
(a) uten delt Tub, (b) soft delt Tub + redningsvei:

| | S-3 | S-7 |
|---|---|---|
| kontrollens `tubBoundS` | 14,0 t | 22,1 t |
| klassifisering (a) | feasible 26, error 4 | inconclusive 22, feasible 8 |
| klassifiseringsflipp (a)→(b) | 0 | 0 |
| `MemberSummary` bit-identisk | ja | ja |
| redningsveier utløst | 1 (m24) | 14 (m15–m28) |
| iterasjoner spart i 1. pass m/Tub | 0,0 % (389 vs 389) | 0,0 % (571 vs 571) |
| etiketter spart i 1. pass | 0,2 % | −0,0 % |
| totalt arbeid inkl. redning | +2,6 % / +0,4 % | +59 % / +56 % |

Tolkning fra rutemotor-agenten: motorens *egen* Tub (ADR-0004: grådig
forhåndsrute mot feltets gradient gir et bound per medlem, med
`tubMarginFrac`) prunes allerede alt den delte bounden ville tatt. Delt
bound sparer null i første pass og utløser redningsveier som koster.
Sikkerhetskriteriet (null flipp, bit-identisk) holdt — delt Tub er *trygg*
med redningsvei, bare ikke nyttig.

Funn 2: i S-7 hadde 8 av 30 medlemmer `pruned.bound > 0 && !reachesDestination`
også **uten** delt Tub — altså fra motorens egen Tub. Spec-ens ventil
(§3.2/§4.1) er formulert generisk («pruned.bound > 0») og ville krevd
omkjøring også der. Motoren har i dag ingen «ingen Tub»-bryter utenom
`exactMode` (som også slår av etikett-tak og stagnasjonsvakt). De 8
medlemmene er klassifisert `inconclusive` (partial værdekning) — så i
S-7 treffer ventilen etter inconclusive-raden uansett.

Funn 3 (rekkefølge): en for stram bound kan beskjære hele fronten så
søket dør av `noExpandableLabels` — tabellen bokstavelig lest (error
først) ville stemplet det «beregningen feilet». Bølge 1 la ventilen før
`error` (inconclusive → ventil → error → feasible → infeasible).

## 3. Kostnadsbildet ellers

Fullt ensemble på PC, full oppløsning: 67–99 s (maaling-e1 §7.4).
Nettbrett-faktor 2–4× antatt, umålt (bølge 2). Spak 1 (once) og 2 (delt
felt) er inne. Spak 3 var delt Tub. Deretter: profilsøk, alloc-fri
hot-loop, delte read-only-cacher, sektornøkling — alle etter tallet.

## 4. Alternativene

**D9.1 Delt Tub.**
- (a) Forkast helt: ingen `tubBoundS` i worker-meldingen; `RouteInput.tubBoundS`
  beholdes i API-et (måling/tester); ventilen i §3.2 beholdes som
  strukturell garanti (død kode i produksjon).
- (b) Behold bak flagg, av i produksjon, til nettbrett-tallet foreligger.
- (c) Slå på (soft + redningsvei) — målingen sier netto tap.

**D9.2 Ventilens rekkevidde.**
- (a) Kun når en *delt* bound ble gitt (`RouteInput.tubBoundS !== undefined`);
  motorens egen Tub er del av det fulle søket (ADR-0004) og klassifiseres
  som i dag (en for stram egen Tub kan gi `noExpandableLabels` → `error`,
  synlig som feil, aldri som «ugjennomførbar»).
- (b) Generisk som skrevet — krever «ingen Tub»-bryter i motoren og
  omkjøring av alle medlemmer med `pruned.bound > 0` uten mål (8/30 i S-7).
- (c) Generisk, men omkjøringen bruker `exactMode` (slår av mer enn Tub).

**Rekkefølgen** inconclusive → ventil → error → feasible → infeasible:
GODKJENN/ENDRE?

## 5. Spørsmål til panelet

1. Er målingen tilstrekkelig grunnlag for å forkaste delt Tub, eller er
   S-3/S-7 for snille (kontrollens bound nær medlemmenes egne)? Hva ville
   dere målt i tillegg?
2. Er det en sikkerhetsrisiko i (a) for D9.2 — kan motorens egen Tub
   produsere en falsk «infeasible»? (Ventilen gjelder kun uten mål; er
   `pruned.bound > 0` uten mål *uten* delt Tub en tilstand som i dag ender
   som error/inconclusive, eller kan den ende som infeasible?)
3. Rekkefølgen i §3.2.
