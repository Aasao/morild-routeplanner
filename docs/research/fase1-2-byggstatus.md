# Byggstatus fase 1 (bølge 1) + fase 2 (motorkjerne) — overlevering

- Dato: 2026-08-31. Skrevet ved overlevering fra oppstartssesjonen (som lå i
  BTB-mappen) til prosjektets egne sesjoner. Alt under er levert, grønt og
  pushet; punktene i «Neste sesjon» er backloggen.

## Levert

### Fase 1 bølge 1 — farbarhetsmaske (tools/chart-pack + packages/charts)
- Turf-spike konkludert (@turf/turf v7 valgt; 140 s → <1 s med per-polygon
  bbox-filtrering — tall i tools/chart-pack/README.md §1).
- Ekte Kartverket-/Kystverket-data for Skjæløy-bbox (59,05–59,30 N,
  10,60–11,00 E) som fixture m/METADATA.md; to WFS-akse-kvirker dokumentert.
- **Funn: Kartverkets datakvalitetslag er maskinlesbart CATZOC-vektorlag**
  (lukker farbarhetsmaske-spec §8 pkt. 2) — se docs/legal/.
- Pipeline (gml/geometry/pipeline/build) + ChartSource
  (farbar/segmentTest/nermesteFareAvstandNm) per spec §3.4–3.6; 42 tester
  inkl. 11 golden mot ekte geometri (merket «MÅ VERIFISERES AV MAGNUS»).
- **Målt avvik: 2,25 MB gzip for 2 fliser — over spec-ens 500 KB/flis-mål.**

### Fase 2 — rutemotor-kjerne (packages/routing, ~7 600 linjer)
- Alle 7 steg per specs/rutemotor.md: tilstandsmodell (heltallskost,
  kollisjonsfri cellenøkkel, Pareto-antikjede), A*-felt, ekspansjon m/
  strukturelt hard/myk-skille, Search-API m/exactMode, egenskapstester
  (determinisme, monotonitet), golden-harness (7 fiksturer, syntetiske),
  perf-test. 162 tester i pakken; 237 grønt i hele repoet.
- **To ekte bugs funnet m/regresjonstest:** (1) spec §4.6s «først funnet
  vinner» ga geometrisk skjeve ruter (8,5 % på ankomsttid) — erstattet med
  geometrisk uavgjort-bryter (remainingNm); (2) konsolidering + direkte
  sluttetappe kunne innføre TSS-brudd søket hadde avvist — begge testes nå.
- Determinisme-skanner i packages/routing/src/determinism-source.test.ts
  (klokke/random/timer/await) — kandidat for promotering til tools/arch-tests.

## Målte avvik fra spec (trenger spec-/ADR-notat i neste sesjon)

1. `maxLabelsPerCell` 12 → **6** (12 når ikke fram på Skjæløy→Skagen;
   6 og 4 gir identisk rute — måling i agentrapport/spec §7).
2. Geometrisk uavgjort-bryter ved lik kostnadsvektor (bug 1 over).
3. TSS-sjekk også i konsolidering og sluttetappe (bug 2 over).
4. capRejected før arena-allokering (ren ytelse, identisk semantikk).
5. Nytt flagg FLAG_SJOEGANG_DATA_MANGLER (fallback til statisk minOffing
   når Hs mangler — flagges i stedet for å late som dekket).
6. Kjegle-målingen bekreftet ADR-0004 avvik 2 empirisk (<4 % forskjell).

## ÅPEN BESLUTNING TIL MAGNUS — ytelse vs. Pareto-ambisjon

Kontrollkjøring Skjæløy→Skagen: **3,7–4,0 s på PC (mål: < 1 s)**; ensemble
~50–60 s for 30 medlemmer på PC — F3.5-budsjettet (< 60 s på NETTBRETT,
2–4× tregere) er ikke nådd. Årsaken er strukturell og målt: Pareto-etiketter
× 8 sektorer gir ~170k etiketter mot v1s ~15k; ingen enkelt flaskehals
(profil: 31 % ekspansjon, 12 % kinematikk, 9 % innsetting).

Spaker (målt der angitt): maxLabelsPerCell 6→4 gir 2,7 s med identisk rute
i 5 av 7 scenarioer (men ikke-monotont på ren kryssetappe); sektorantall
8→færre og grovere cellDeg er uprøvd; grovere kursoppløsning for medlemmer
er allerede planlagt. Alternativ: senke ambisjonen (Pareto kun på
kontrollkjøringen, skalar for medlemmer). **Beslutningen er en reell
avveining mellom ADR-0004 og F3.5 — tas i egen sesjon med Magnus.**

## Neste sesjon (bruk /standup, deretter denne lista)

1. Ytelses-beslutningen over (Magnus).
2. Spec-/ADR-notater for de seks avvikene (dokumentoppgave).
3. Code-review av packages/routing og packages/charts (ikke gjort —
   landet på grønne tester + egenskapstester; review er første kvalitetsport).
4. Flis-budsjettet i farbarhetsmasken (2,25 MB vs. 500 KB — komprimering/
   forenkling/flisstørrelse).
5. Golden-punktene «MÅ VERIFISERES AV MAGNUS» mot sjøkart.
6. ChartSource-adapter routing↔charts (kontrakt i routing/src/contracts.ts).
7. Promoter determinisme-skanneren til tools/arch-tests; charts inn i
   importgrensen (packages/charts/TODO.md).
8. Nettbrett-måling av tools/spikes/ensemble-perf/index.html.
9. uoppnaelig-mal-semantikk: reached:false + verdict "trygt" må ikke leses
   som «ruten er god» i UI (dokumentert i result-modellen).
