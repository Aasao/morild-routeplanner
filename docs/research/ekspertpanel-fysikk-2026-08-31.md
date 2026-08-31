# Ekspertpanel runde 3 — fysikk-perspektiver på beregningskjernen

- Dato: 2026-08-31
- Status: ferdig — mater inn i målepakken før ADR-0005 (jf.
  `ekspertpanel-runde2-2026-08-31.md` §6)
- Metode: to agenter (beregningsastrofysiker, kvantefysiker) vurderte om
  metodene fra deres felt kan bidra i rutemotoren, med eksplisitt
  feasibility-filter (TypeScript/WASM på Android-nettbrett,
  énpersonsprosjekt, determinisme). Simulerte fagperspektiver.

## Hovedfunn: uavhengig konvergens på baklengs-feltet

Begge landet — fra hver sin kant — på samme toppanbefaling: et **baklengs
verdifunksjons-felt** beregnet med én DP-feiing bakover i tid per medlem.
Kvantefysikeren kom dit via reachability/viability («belief propagation
kollapser til eksakt énpass bakover-DP på en DAG»), astrofysikeren via
Hamilton-Jacobi-Bellman («time-to-go-feltet τ(x,t)»). Det er samme objekt,
og det svarer direkte på runde 2s åpne punkter:

- **R2/fellefrihet eksakt for ALLE punkter:** en felle er per definisjon
  et punkt der τ eksploderer i dårlige medlemmer. Erstatter re-søk per
  feilpunkt (matematikerens R2-design) med felt-oppslag; konservativ
  variant («trygghetsfelt» fra alle bail-out-havner, konservativ fart)
  gir soundness-garanti: sier feltet trygt ⇒ trygt.
- **Avgangsvindu-profilen gratis:** τ(start, t₀) for alle avganger kommer
  fra samme feiing — 5–7×-multiplikatoren i S1 kollapser for screening.
- **Anisotrop admissibel heuristikk for Pareto-søket:** dagens
  Dn·3600/(boundSlack·Vmax)-bound er løsest der etikettene eksploderer
  (kryss, reell fart 2–3× under Vmax). τ-feltet (beregnet uten myke
  kostnader → nedre grense per konstruksjon) strammer bounden og angriper
  170k-etikettproblemet tilnærmet tapsfritt.

Kostnadsanslag (astro): ~300–600 linjer TS, rene løkker over typede
arrays, ~0,2 s/medlem på PC ved 0,05°/96 tidsskiver/24 kurser, ~10 MB.
Feller flagget: interpolasjon kan lekke gjennom no-go (masker naboceller
+∞, upwind-fallback); grov diskretisering kan bryte admissibilitet rundt
hindringer (dilatert farbar mengde + slakk, av i exactMode); Float64;
feltet er vær- og tidsavhengig (full DP per medlem, i motsetning til det
delte A*-feltet).

## Øvrige anbefalinger (rangert, med falsifiserende eksperiment)

2. **Karakteristikker gjennom τ-feltet** (astro): lagre argmin-kurs per
   celle/skive (Uint8, +1–2 MB) → «revider herfra»- og bail-out-ruter
   fra ethvert punkt uten nye søk. Kun screening/diagnostikk — endelige
   ruter kommer fortsatt fra Pareto-søket. *Eksperiment:* korridoravvik
   < 0,5 nm mot golden offshore.
3. **Konveksifisert polar (VMG-hull) i alle skalar-/grov-beregninger**
   (astro): bauting ER konveksifisering av hastighetsmengden; fjerner
   no-go-kjeglen mot vind og gjør amortisert kryssfart riktig i τ-felt,
   Tub og grådigrute. Aldri i Pareto-kjernen (visker ut halseside/beatS).
   Én forhåndsberegning i packages/polar. *Eksperiment:* strammere Tub
   uten rutediff på kryss-golden.
4. **Adjungert-inspirert triage** (astro): δT_lineær = Σ
   polar-gradient·(medlem−kontroll) langs kontrollruten — én løsning +
   30 prikkprodukter. Gyldig kun uten kontrollbytte (polar-knekk/
   halsebytte bryter linearisering — nøyaktig topologibrudd-tilfellene).
   Bruk som tillitsregion: u-flaggede medlemmer → billig evaluering,
   resten → fullt søk. Også bedre klyngemetrikk for regime-klynging enn
   rå feltavstand. *Eksperiment (½ dag):* rangkorrelasjon mot faktiske
   per-medlem-resultater på spike-ensemblet.
5. **EOF/PCA-kompresjon av værpakken** (kvante): 30 korrelerte medlemmer
   ≈ basis × koeffisienter — ren batch-side båndbredde-/lagringsgevinst,
   ikke ruting. *Eksperiment (½ dag):* golden-rute på rekonstruert felt
   (k ≤ 8 moder) innenfor N5.
6. **Adaptiv front-resampling** (astro): riktig AMR for Lagrangesk front
   er ikke gitteret men frontpunktene (buelengde-/krumningskriterium —
   fin i skjærgård, grov offshore); oppgradering av kurskonsolideringen.
   Kausalitetsregel: beskjæringsgrid-størrelse må være ren funksjon av
   posisjon (statisk flislegging), aldri av frontens tilstand.
7. **Soft-min korridorfelt** (kvante, marginal): forward–backward over
   e^(-kost/T) gir korridor-/entropifelt per medlem — kun
   PC-diagnostikk/visualisering. Viktig prinsippavklaring: temperatur-
   spredning i ÉN prognose er IKKE ensemble-spredning (kategorifeil å
   blande dem).

## Eksplisitt avvist (begge, med begrunnelse)

- **QUBO/annealing/QAOA/simulated bifurcation:** kaster bort monoton
  tidsorden + Pareto-delorden som gjør grafsøk raskt; stokastikk vraket
  alt i ADR-0004; harde constraints som straffeledd bryter prinsipp 1
  strukturelt. Ingen kvantefordel for strukturert korteste-vei på noen
  maskinvare Magnus kommer til å eie.
- **Full Sethian–Vladimirsky OUM/anisotrop FMM som motorerstatning:**
  skalar HJ kan ikke bære 4-dim Pareto-vektor/halseside; stencil-bredde
  skalerer med anisotropiforholdet (ubegrenset uten konveksifisering,
  som ødelegger beat-regnskapet). Kontinuerlige kurser fås billigere via
  finere headingStep.
- **Level-set** (løser ikke-monotone fronter — finnes ikke her, motor
  gir fart > 0), **formell adjungert AD** (ikke-glatthet nettopp i de
  interessante tilfellene), **emulatorer/GP/NN over ensemblet**
  (ikke-deterministisk, vedlikehold, 30 medlemmer for få),
  **lavrang-interpolasjon av UTDATA-felt** (feiler på outlier-/
  felle-medlemmene som robusthetslaget finnes for), **grid-AMR med
  hengende noder** (front-lekkasje), **iterativ BP** (DAG gjør
  énpass-DP eksakt).

## Konsekvens for målepakken og ADR-0005

Astrofysikerens syntese, tiltrådt av hovedsesjonen: **τ-feltet er ikke et
tredje alternativ i E1′-divergensen (skalart søk vs.
korridor-evaluering) — det er infrastrukturen begge trenger.**
Korridor-evaluatoren får fellefrihets-svaret fra feltet; skalarsøket får
bounden sin fra det. Baklengs-felt-eksperimentet (1–2 dager: (i)
τ(start) vs. forward-ankomsttid innenfor N5; (ii) som bound: identisk
golden-rute + målt labelsCreated-reduksjon; (iii) flagger feltet
direkteruten som felle i frontscenarioets 2 dårlige medlemmer?) legges
inn i den vedtatte ~1-ukes målepakken før ADR-0005. VMG-hull-forberegning
(pkt. 3) og EOF-eksperimentet (pkt. 5) er billige nok til å tas i samme
pakke; resten venter på resultatene.
