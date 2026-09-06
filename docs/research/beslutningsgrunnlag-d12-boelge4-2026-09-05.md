# Beslutningsgrunnlag D12 — funn fra fase 4a bølge 4 (bail-out, perturbasjon, beslutningsregel)

- Dato: 2026-09-05
- Status: grunnlag for fagagent-panelet (`/panel`). Simulerte
  fagperspektiver, ikke reelle personer.
- Kilder: `docs/specs/robusthet.md` §3.5, §4.4–4.6, §5.5–5.6, §6.3, §7
  D8.4–D8.6, D8.10; `docs/specs/rutemotor.md` §5.14 (havnebok/havnefelt/
  bail-out-profil) og §9 pkt. 14–15 (åpne spørsmål); kode:
  `packages/routing/src/{harbour-book,harbour-field,bailout-profile}.ts`,
  `bailout-cost.damage.test.ts`; `packages/robustness/src/{decision-rule,
  perturbation,perturbation-wrappers}.ts`; `apps/pwa/src/weather/ensemble.ts`
  (perturbasjonsfasen), `apps/pwa/src/workers/weather-routing.worker.ts`.

## 1. Kostnadsmålingen (D8.6 c-betingelsen)

Golden `skjaeloy-skagen-apent` (85 nm), full oppløsning, interim-havnebok
(8 havner, fiksturdybder), PC:

| | |
|---|---|
| samples langs ruten | 32 (30 min + segmentskifter) |
| fulle R2-søk | 33 (95 ms per søk) |
| silt av havnefeltet | 128 kandidatpar (0 hele punkter) |
| havnefeltbygging | 0,12 s (8 havner, 368 k celler, 1,4 MB) |
| profil totalt | **3,3 s** (rutesøket i tillegg: 4,4 s) |
| status | naadd 28, ikke-anloepbar 4, `longestGapS` 0,25 t, coverage full |

Admissibilitet: 200 seedede punkter, 0 brudd (minste margin 1,52–1,56).
Panelets anslag (< 40 søk, < 2 min) holdt med god margin. D8.6 (c) «maks
over medlemmer for valgt avgang» ville koste ~30 × 3,3 s ≈ 100 s
sekvensielt på PC (parallelliserbart over poolen: ~20–35 s), i tillegg
til ensemblet.

## 2. Alternativene

**D12.1 Bail-out over medlemmer (bølge 6, betinget i D8.6).** (a) Kjør
bail-out-profilen for alle gjennomførbare medlemmer på valgt avgang
etter ensemblet, vis «maks over medlemmer» (`longestGapS` = maks), og
behold kontrollvær-profilen som første svar (progressivt). (b) Kun
kontrollvær (som nå), merket «ikke ensemble-sjekket». (c) (a) men bare
for verste gjennomførbare + P90-medlemmet (3 profiler).

**D12.2 `BoatModel.draughtM`/`depthClearanceM` valgfrie med fallback
2,6 m.** (a) Gjør feltene obligatoriske i `BoatModel` (typefeil å utelate
— én båt i dag, men kravet skal ikke arves stille). (b) Behold valgfrie.

**D12.3 Dybdegaten `min(kai, ankring) ≥ krav`.** (a) Behold `min`
(begge må holde). (b) `max` når kaia er `verified: true`. (c) Gate per
anløpstype: kai OG/ELLER ankring, med `nightApproachSafe` per type.

**D12.4 Perturbasjonsfasen — omfang.** Seks fulle søk (cruising ×3,
strøm ×2, verste medlem ×1) etter ensemblet, sekvensielt. (a) Behold.
(b) Kjør over poolen parallelt. (c) Kun cruising 0,85 + strøm 1,2 (3
søk) til nettbrett-tallet foreligger.

**D12.5 Beslutningsregelens `checkEpochS`** utledes fra
`arrivalEpochS − durationS + h·3600` fordi `hourlyTrack` ikke bærer
epoketid. (a) Legg `departEpochS` i `MemberSummary` (ren bokføring).
(b) Behold utledningen.

## 3. Spørsmål til panelet

1. D12.1: er «maks over medlemmer» det riktige aggregatet for
   bail-out, eller P90/verste gjennomførbare? Hva er kostnaden på
   nettbrett?
2. D12.3: er `min` for konservativt i praksis (stryker havner med
   grunn kai men god ankring)?
3. D12.4: hører perturbasjon hjemme før eller etter bail-out i
   rekkefølgen §4.1?
