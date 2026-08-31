# Steg 2-status 2026-08-31 — evaluator, kartbeslutninger, code-review

- Dato: 2026-08-31. Oppfølging av beslutningene i
  `ekspertpanel-runde2-2026-08-31.md` §7. Alt under er bygget men IKKE
  committet enda (venter på fikse-bølgen).

## Levert (270/270 tester grønt, check 0 feil)

1. **Evaluator-kjernen** (`packages/routing/src/evaluate.ts` + spec
   §5.11): tynn løkke over søkets egne funksjoner, styr-mot-veipunkt,
   én-sannhet-egenskapstest = 0 s avvik på alle 4 kostkomponenter i alle
   7 golden-fiksturer. +21 tester. Hot-loopen urørt.
2. **VALSOU-regelen** (E4) i packages/charts m/fasit-tester begge
   retninger. **Fixture-funn:** 3913/3913 Grunne-objekter har
   dybdeattributt (median 4,7 m; 694 < 1 m); 578/578 Skjær har ALDRI
   dybde — bekrefter at Skjær beholder ubetinget no-go.
3. **QA-validatoren** (byggetids dybdepunkt-sjekk) i chart-pack:
   rapporterer + flagger `sourceStatus: "degraded"`, feiler ikke bygget.
   **Reelt funn ved første kjøring: 503/3913 (12,9 %) Grunne-sonderinger
   er grunnere enn nedre grense i båndet de ligger i** (f.eks. 39 m-
   sondering i «40–50 m»-bånd) — trolig nedstrøms symptom av
   åpne-kurver-hullet (bånd kunstig store).
4. **Kjent-svakhet-golden** for åpne-kurver-hullet (ekte Kartverket-kurve
   dybdekurve.728354, åpen ring, 5 m): asserter dagens uønskede
   `usikkert`-svar eksplisitt til stitching lukker hullet.
5. **Spec-oppdateringer:** rutemotor.md (E2-beslutning, §5.11 evaluator),
   farbarhetsmaske.md (VALSOU §3.4, forenklings-forbud §4.1, QA-validator
   §4/4a, kart-først-lite §6.3, kjent-svakhet §6.3.1, endringslogg).
   Kravspek-endringslogg 2026-08-31.

## Code-review-funn (HEAD 6d4d3a7) — fikseplan

| # | Funn | Alvor | Status |
|---|---|---|---|
| R1 | `segmentTest` er 20-punkts sampling, ikke eksakt geometritest (spec §6.4 krever eksakt); smale farer kan passere uoppdaget mellom prøvepunkter; konsolidering forverrer (fast antall samples uansett lengde) | KRITISK | **Fikset** (kartdata-agent 2026-08-31): eksakt kord-mot-polygon-test i alle fliser korden krysser, se `docs/specs/farbarhetsmaske.md` §9-endringslogg |
| R2 | Flisoppdeling (`touchedTiles`) bruker kun polygon-hjørner — mellomflis uten hjørne mister polygonen stille | Viktig | **Fikset** (kartdata-agent 2026-08-31): bbox-basert flisoppdagelse + tomflis-filter, fixture regenerert (innhold uendret for Oslofjord/Hvaler-testområdet, se endringslogg) |
| R3 | Kystbuffer (`minOffingNm`/sjøgang) sjekkes kun i veipunkter, aldri langs korden — heller ikke i ettersjekken. SPEC-SAMSVARENDE, men restrisiko av typen prinsipp 1 vil unngå | Viktig | **Beslutning Magnus** (sikkerhetssemantikk) |
| R4 | Hardt dagslyskrav sjekkes før direkte sluttetappe legger til reell seilingstid — rute kan passere kravet men ankomme etter mørket | Viktig | **FIKSET** (spec §5.8 «Reell dagslysankomst») |
| R5 | Hardkodet 60° i stedet for `beatTwaDeg` på sluttetappen | Mindre | **FIKSET** (`softContribution` brukes nå) |
| E-funn | Direkte sluttetappe kan være useilbar og tidsfri (egen kinematikk uten strøm/fartssjekk; bspKn≈0 → extraS=0 — avstand uten tid i totals). Funnet av evaluatoren, pinnet av test | Viktig | **FIKSET** (golden regenerert, diff attributert i spec §10 «2026-08-31 (2)») |

Rent ved review: Pareto-/dominanslogikk (inkl. cap-eviction),
determinisme, enheter, geo-kjernen, begge bugfiksene fra forrige sesjon.

## Code-review runde 2 — fikset 2026-08-31

| # | Funn | Alvor | Status |
|---|---|---|---|
| Funn 1 | R4-omvalgsløkken krevde dagslys, men ikke at kandidaten *nådde målet* — en rute med avvist sluttetappe kunne vinne dagslyskravet ved å gi opp tidsnok, og bli presentert som `reached: true` / `trygt` / kravet oppfylt, 1,5+ nm fra havn | KRITISK | **Fikset**: (a) omvalget krever `finalLeg.status ∈ {lagt-til, ikke-nodvendig}` i tillegg til dagslys; (b) nytt `safety.reachesDestination` + `verdict` gulvet til `usikkert` ved `avvist-*`; `violatesDaylightRequirement` settes også når ruten ikke ender i målet. Spec `rutemotor.md` §4.8/§5.8 + §10 «2026-08-31 (3)» |
| Funn 2 | `evaluatePoint` testet skjær/grunne mot den *innskrevne* bufferpolygonen mens `segmentTest` brukte eksakt sirkel — punkt i sliveren slapp gjennom | Viktig | **Fikset**: felles `pointWithinHazardBuffer` (eksakt punkt-i-sirkel når `centerLat`/`centerLon` finnes, polygon-fallback ellers). Spec `farbarhetsmaske.md` §3.6/§4.1/§6.1 + §9 |
| Funn 3 | De nye geometriprimitivene manglet direkte enhetstester | Mindre | **Fikset**: `packages/charts/src/point-in-polygon.test.ts`, 43 tester på grensetilfellene |

Verifisert 2026-08-31: `pnpm test` 337/337, `pnpm check` 0 feil,
`pnpm test:golden` 13/13, `pnpm test:arch` 5/5.

## Åpne beslutninger til Magnus (oppdatert)

1. **R3 kystbuffer-korridor:** godta som dokumentert restrisiko i spec,
   eller kreve korridor-/samplesjekk av klaring analogt §6.4? (Berører
   også sjøgangstillegget som ble besluttet «hard avvisning».)
2. **QA-funnet (12,9 % sonderinger i for grunt bånd):** bekrefter trolig
   at åpne-kurver-hullet har målbar effekt allerede i fixture-bboxen —
   styrker prioriteten på stitching, men endrer ikke rekkefølgen
   (screening/flagging er på plass). Til orientering.
3. E1′ (ensemble-mekanisme): fortsatt utsatt til målepakken, som besluttet.

## Neste

Fikse-bølge (R1, R2, R4, R5, E-funn) → re-review av endringene →
samlet verifisering → klart for commit når Magnus sier fra → steg 3
(målepakken).
