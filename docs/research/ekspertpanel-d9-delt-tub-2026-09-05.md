# Ekspertpanel D9.1–D9.2 — delt Tub etter skademålingen, ventilens rekkevidde

- Dato: 2026-09-05
- Status: ferdig — to runder + tilsvar + votering; syntese i §6. Venter
  Magnus' vedtak (`docs/specs/robusthet.md` §7, D9.1–D9.5).
- Grunnlag: `docs/research/beslutningsgrunnlag-d9-delt-tub-2026-09-05.md`
  (samme tekst til alle roller).
- Metode: tre fageksperter (matematiker/multiobjektiv stioptimering —
  opus; ytelsesingeniør storskala ruting og værruting-produksjonsutvikler
  — sonnet) leste grunnlaget uavhengig og voterte per D9.x. Deretter tre
  utfordrere (djevelens advokat, lateral tenker, pragmatiker), så tilsvar.
  **Simulerte fagperspektiver, ikke reelle personer.** Verdien er
  uavhengig lesning av samme grunnlag; panelet godkjenner ikke — Magnus
  vedtar.

## 1. Runde 1 — råd

### 1.1 Matematiker (multiobjektiv stioptimering)

**Er S-3/S-7 for snille? Ja — men konklusjonen står, av en sterkere
grunn.** S-7: regimer ~14 t/~24 t, kontrollbound 22,1 t ⇒ terskel
22,1·1,25 = 27,6 t > 24 t: ingen medlemsoptimum over terskelen, så
falsk ugjennomførbarhet *kunne* ikke oppstå. S-3: spredning 12,6–15,7 t
mot 14,0 t ⇒ maks-forhold ~1,12. Nøkkeltallet **maxₘ T\*ₘ / T_kontroll**
er ikke rapportert i testen; null flipp er et svakt orakel (tester at
ventilen ikke skader, ikke at bounden er trygg).

Men «egen Tub prunes alt» er **strukturelt, med fortegn**: begge bounder
er samme grådige forhåndsrute; effektiv terskel er min(T_egen,
T_delt)·1,25. T_delt ≥ T_egen ⇒ null ekstra beskjæring (målt 0,0 %).
T_delt < T_egen ⇒ ekstra beskjæring — nøyaktig regionen der falsk
ugjennomførbarhet lever, og redningsveien betaler hele førstepasset om
igjen (målt +59 %). Gevinstregionen er kilen T\*ₘ/1,25 < T_delt <
T_egen. Forventet netto ≤ 0 for enhver fikstur med reell spredning.
Trenger ingen flere fiksturer for å forkaste.

**Falsk «infeasible» er nåbar, og problemet er større enn Tub.**
`stagnation` (search.ts ~551–555) terminerer med `pruned.bound > 0`,
full værdekning, uten mål — og er ikke i `ERROR_ABORT_REASONS`. Med D9.2
(a) faller den til `infeasible`. Mekanismen er reell: bounden beskjærer
den forbedrende grenen, `lastImprovementIter` fryser, vakten dreper
søket. Grunnlagets (a)-formulering («synlig som feil, aldri som
ugjennomførbar») er usann slik koden står. Videre: settet som i dag kan
ende som `infeasible` er {stagnation, callerStopped, noWeatherAtStart,
outsideDomain} — **ingen er bevis på ugjennomførbarhet**.
`noWeatherAtStart` settes før `environmentAt` kalles ⇒ `coverage.weather
=== "full"` ⇒ et medlem uten værflis i avgangspunktet telles som «været
sier nei» i nevneren til `feasibleShare`. Samme feilklasse som delt Tub
ble avvist for, uten Tub.

**Rekkefølgen: GODKJENN.** Krav: `infeasible` skal være det eneste
utfallet som krever et *positivt* sertifikat — i dag har det ingen.

Votering: D9.1 (a) GODKJENN (behold `shared-tub.damage.test.ts` som
regresjonsvakt); (b) AVVIS; (c) AVVIS. D9.2 (a) **AVVIS** (stagnation ⇒
falsk infeasible); (b) **GODKJENN, ENDRET**: ingen ny bryter trengs —
`tubBoundS: +∞` gir null bound-pruning i dag; innfør eksplisitt opsjon
`noTubBound: true` (ikke Infinity over JSON-grense). Omkjøring skjer bare
der svaret ellers ble infeasible/error (inconclusive-raden tar S-7s
8/30 først). (c) AVVIS (exactMode = annet søk, kan treffe labelCap ⇒
error, fri i tid). Rekkefølgen GODKJENN.

Trenger målt: (i) uttømmende test per `abortReason` → hvilke gir
`infeasible`; `noWeatherAtStart`/`outsideDomain` ut av infeasible
(inconclusive hhv. error); (ii) `stagnation` med `pruned.bound > 0`
utløser ventilen (konstruert fikstur); (iii) maxₘ T\*ₘ/T_kontroll
rapportert i skademålingen; (iv) assertion i aggregeringen: intet
medlem telles `infeasible` med `pruned.bound > 0`.

### 1.2 Ytelsesingeniør (storskala ruting)

**0 % er strukturelt forventet.** `computeTubBound` er grådig
forhåndsrute mot feltets gradient; med delt felt (spak 2) kjører alle
mot samme gradient og hvert medlems egen bound konvergerer mot
kontrollens. Delt Tub deler noe som allerede er implisitt delt via
feltet. Sier lite om resten av spak-listen: Tub er en «hopp over
arbeid»-spak; alloc-fri hot-loop, delte read-only-cacher (polar,
landmaske) er «gjør samme arbeid raskere» — nesten garanterte gevinster
med 1–6 workere som dupliserer kopier. Sektornøkling er samme
risikoklasse som Tub (tilstandsrom) — mål separat. Profilsøk skal
*styre* hvilke av de tre neste som er verdt tiden, ikke stå i fast kø.

**Hull i målingen:** skademålingen teller iterasjoner/etiketter, ikke
kostnaden ved å *beregne* egen Tub (opptil 600×24 miljøoppslag +
segment-/TSS-sjekk per medlem). `input.tubBoundS !== undefined` hopper
over hele forhåndsruten. Vil ha isolert veggklokke for
`computeTubBound()` (delt vs egen) før D9.1 låses: < 2 % av medlemstid
⇒ (a); ellers rent kostnadsargument for deling.

**(b) bak flagg koster:** redningsstien må holdes korrekt for alltid for
en funksjon ingen slår på; 170 s på suiten er løpende skatt — egen
langsom tier eller fjern. «Vent på nettbrett-tallet» er svakt: CPU
skalerer begge bounds proporsjonalt, ikke redundans-forholdet.

Votering: D9.1 (a) GODKJENN; (b) AVVIS begrunnelsen, ENDRE til «bak
flagg kun til veggklokke-isolasjonen er målt; < 2 % ⇒ (a) umiddelbart»;
(c) AVVIS. D9.2 (a) GODKJENN (billigst, ingen ny bryter i hot-path); (b)
AVVIS med mindre D9.1 reverseres; (c) AVVIS (exactMode = sikkerhetsventil
uten tidsbudsjett). Rekkefølgen GODKJENN. Trenger målt: (1) veggklokke
`computeTubBound` isolert; (2) sektornøkling på ekte fliser; (3) spak 7
før noe annet prioriteres.

### 1.3 Værruting-utvikler (produksjon)

I cockpit: feasible/infeasible er et **værsvar**, inconclusive et
**datasvar**, error et **verktøysvar** — tre ulike reaksjoner (revurder
rute / vent på ny pakke / stol mindre på tallet nå). **Farligst er falsk
`infeasible`** — ikke falsk feasible (tabellen kan aldri gi det). Faren
er at en intern søkeoptimalisering dreper et medlem som var gjennomførbart
og det stille havner i nevneren som «beviselig ugjennomførbart». Samme
spøkelse for motorens egen Tub, uadressert i D9.2.

Rekkefølgen GODKJENN. `prunedBound` skal alltid inn i kvitteringsloggen,
også når 0 — ellers kan ingen etterprøve om en «infeasible» var
beviselig. Produksjonsprodukter (PredictWind/Expedition/qtVlm-klassen)
kjører hvert medlem uavhengig uten kryss-medlem-bounding; delte
skranker brukes som UI-visning, aldri som pruning-parameter. D9.1(a) er
bransjenormen.

Avvist: (c) flatt; (b) som varig tilstand — nødvei bak flagg som tester
seg selv i «av»-modus for alltid er mønsteret der nødveier viser seg
ødelagt når de trengs; om (b), krev periodisk CI i «på»-tilstand.

Votering: D9.1 (a) GODKJENN. D9.2 **ENDRE (a)**: prinsippet støttes, men
(a) alene lukker ikke risikoen — egen Tub kan gi `pruned.bound > 0 &&
!reachesDestination` med full dekning og abortReason utenfor error-
settet (eller null) ⇒ rått `infeasible` uten bevis. Krav: property-/
golden-test som viser at kombinasjonen (i) aldri forekommer i
fikstursettet, eller (ii) alltid bærer `prunedBound > 0` synlig i
kvitteringen. Rekkefølgen GODKJENN. Trenger målt: andel medlemmer med
full dekning, ikke nådd, `pruned.bound > 0`, abortReason utenfor
error-settet — over alle S-1…S-8. 0 ⇒ D9.2(a) trygt; > 0 ⇒ nyanser
UI-teksten («ikke funnet innenfor søkets grenser» vs «bevist
ugjennomførbart») eller D9.2(b) avgrenset til undergruppen.

### 1.4 Hovedsesjonens tilleggsmåling (bestilt av 1.2 og 1.3)

Se §3.

## 2. Runde 2 — utfordringer

### 2.1 Djevelens advokat

1. **«Delt Tub er død» er bevist gitt delt felt, ikke for hele
   tilstandsrommet.** Strukturargumentet min(T_egen, T_delt)·1,25 hviler
   på at spak 2 allerede har presset alle medlemmers grådige forhåndsrute
   mot samme gradient. I fallback uten delt felt (feltbygging feiler,
   degradert modus) kan T_egen spre seg, og gevinstkilen åpne seg reelt.
   Ingen har målt den kombinasjonen.
2. **Funnet om stagnation/noWeatherAtStart/outsideDomain er strukturelt,
   ikke fikstur-artefakt.** `computeTubBound` kjører alltid i produksjon
   når `tubBoundS` mangler; `pruned.bound` er én teller uten kilde.
   Dagens `classifyMember` er generisk og implementerer de facto D9.2(b)
   — (a) er en regresjon, ikke en videreføring. Kostnaden ved å lukke
   hullet nå er en assertion og en konstruert fikstur.
3. **«Infeasible krever positivt sertifikat» kan tømme nevneren.** Tatt
   bokstavelig kan `infeasible` bli et tomt sett; trafikklyset kollapser
   til «beregner»/feasible for alt som ikke krasjer hardt — en stille
   endring av produktets semantikk. Krever rerun-tak og en eksplisitt
   fallback-kategori («ikke avgjort innenfor budsjett») som *ikke* er
   feasible.
4. **Ventildiskusjonen er et designsymptom:** motoren bør eksponere ett
   strukturert «hvorfor stoppet du»-felt (f.eks. `{ provenInfeasible,
   boundSource: "shared"|"own"|null }`) i stedet for at robusthetslaget
   tolker abortReason+pruned+coverage.

Anbefaling: ikke lås D9.2(a) som skrevet; krev matematikerens (i)–(iv)
og et rerun-tak før noe D9.2-alternativ vedtas.

### 2.2 Lateral tenker

Kodefunn: `diagnostics.tubBoundS` settes bare når den grådige
forhåndsruten faktisk *når* `reachRadiusNm` innen 600 steg, med
hard-node- og TSS-sjekk per segment — et gratis **feasibility-sertifikat
i motsatt retning**. «tubBoundS satt» + «medlem klassifisert
infeasible/error» er en selvmotsigelse i motoren, oppdagbar uten
fikstur-jakt. Forslag: (1) motsigelses-assert: intet medlem med
`diagnostics.tubBoundS !== null` klassifiseres `infeasible`; (2)
`tubBoundS` inn i `MemberSummary` for UI-tekst ved infeasible/error
(«grådig forhåndsrute nådde målet på ~X t, fullt søk beviste det ikke»)
— ren rapportering, null pruning-risiko; (3) progressiv `advance()` er
*ikke* en billigere ventil — pruning er destruktiv (beskårne etiketter
opprettes aldri), omkjøring er strukturelt billigste korrekte ventil.
48 t-horisont (`partial`) og egen Tub (`pruned.bound`) er samme
fenomen: «vi så ikke langt/lenge nok», ikke «vi beviste nei» — bør inn
i §3.2 som ett prinsipp. Votering: D9.1 (a) GODKJENN; D9.2 (a) ENDRE med
forslag 1 som lukking; rekkefølgen GODKJENN.

### 2.3 Pragmatiker

D9.1(a) er minutter — gjør nå. D9.2 har delt seg: klassifiseringshullet
(stagnation/noWeatherAtStart/outsideDomain → infeasible) er en
*eksisterende* bug uavhengig av delt Tub, nøyaktig feilklassen prinsipp 1
handler om — fiks nå (timer): flytt dem ut av infeasible-settet,
`prunedBound` alltid i kvitteringen. Matematikerens fulle (b) —
`noTubBound`-opsjon + uttømmende abortReason-matrise — hører til bølge 3
når robustness faktisk kobles til appen. Skademålingen: egen
`test:damage` i qa-runner før commit av bølger som rører `search.ts`/
robustness, ikke i standard `pnpm test`. Over-engineering: veggklokke-
målingen av `computeTubBound` — konklusjonen (a) står uansett tallet.
Votering: D9.1 (a) GODKJENN; D9.2 minimal (b) nå, matrise i bølge 3;
rekkefølgen GODKJENN. Aldri: D9.1(b)/(c), D9.2(c).

## 3. Hovedsesjonens tilleggsmålinger

Midlertidig test `packages/routing/src/tub-cost.tmp.test.ts` (slettet
etter kjøring), med delt felt i begge grener:

**(1) Kostnaden ved å beregne egen Tub** (ytelsesingeniørens
forutsetning for D9.1): 10 medlemmer per fikstur, `planRoute` uten
`tubBoundS` (egen grådig forhåndsrute) vs med kontrollens verdi (hopper
over beregningen):

| | egen Tub | delt | differanse |
|---|---|---|---|
| S-3 | 20,6 s | 21,9 s | −6 % (støy) |
| S-7 | 20,1 s | 21,0 s | −4 % (støy) |

Tub-beregningen er ikke målbar mot søkets kostnad. Ytelsesingeniørens
< 2 %-vilkår ⇒ (a).

**(2) Falsk-infeasible-risikoen** (værruting-utviklerens bestilling):
alle 30 medlemmer i S-1, S-2, S-3, S-4, S-5, S-7, S-8 (210 fulle søk,
delt felt, egen Tub):

| Fikstur | `pruned.bound > 0` og ikke nådd | derav dekning/abortReason | ville blitt `infeasible` |
|---|---|---|---|
| S-1 | 0 | – | 0 |
| S-2 | 22 | partial / null: 22 | 0 |
| S-3 | 0 | – | 0 |
| S-4 | 0 | – | 0 |
| S-5 | 0 | – | 0 |
| S-7 | 8 | partial / null: 8 | 0 |
| S-8 | 0 | – | 0 |

Alle 30 tilfellene av «bound beskar noe og målet ble ikke nådd» er
værhorisont (`partial`) — de tas av inconclusive-raden. **Null
medlemmer ville blitt stemplet `infeasible` med bound-beskjæring i
dagens fikstursuite.** Matematikerens `stagnation`-vei er dermed
empirisk tom i dag, men strukturelt åpen (ingen fikstur konstruerer
den); asserten «`pruned.bound > 0` ⇒ aldri infeasible» er derfor en
regresjonsvakt uten kostnad.

## 4. Tilsvar (rollene re-etablert med eget runde 1-svar + utfordringene)

### 4.1 Matematiker

**Den grådige forhåndsruten er et *nesten*-sertifikat — og hullet
peker feil vei.** `computeTubBound` sjekker per steg værdekning, harde
båtgrenser med vaktbånd (`checkHardNode`), farbarhetsmasken
(`checkSegment`) og TSS — men **ikke** (1) kystbuffer/klaring
(`checkClearanceCorridor`, `minOffingNm` + sjøgangstillegg), (2)
dagslyskravet (`requireDaylightArrival`), (3) mellomliggende veipunkter
(går start→mål direkte). Sertifikatmengden er en ekte delmengde av
søkets skranker ⇒ `tubBoundS` kan ligge **under** det skrankede
optimum (grådig rute som kutter kystbufferen eller ankommer i mørke);
da er motorens egen Tub ingen gyldig øvre grense, og 1,25-marginen er
det eneste som skjuler det. Selvstendig korrekthetsfunn som støtter
generisk ventil uavhengig av deling. Rettelse billig og i trygg retning:
legg klaring + dagslysankomst + veipunkt-etapper inn i den grådige
ruten — flere avbrudd ⇒ oftere `tubBoundS = null` ⇒ mindre beskjæring,
aldri mer. Først da blir motsigelses-asserten sann.

**Rerun-tak og fallback:** tak per medlem = 1 (omkjøring uten bound er
maksimalsøket; idempotent). Globalt budsjett: samlet omkjøringstid ≤
50 % av førstepassets veggklokke (S-7 målte +59 %). Ingen femte
`OutcomeKind` — `inconclusive` med diskriminant `reason: "coverage" |
"budget" | "bound"`. Mot nevnerkollaps: inconclusive-andel > 1/3 ⇒
trafikklyset viser «usikkert grunnlag» + antall avklarte, ikke prosent.

**Fallback uten delt felt endrer ikke D9.1:** gevinstkilen er per
definisjon T_delt < T_egen — beskjæring i nøyaktig risikoregionen, i
den mest degraderte modusen. Gjenåpningsutløser: forlates delt felt i
produksjon, revurderes D9.1. Måling (2) 0 vs > 0 endrer ikke votumet
(argumentet er strukturelt); > 0 flytter matrisen fra bølge 3 til 2.

Votering: D9.1 (a) GODKJENN (vakt beholdes; gjenåpning ved tap av delt
felt), (b)/(c) AVVIS. D9.2 (a) AVVIS (regresjon fra dagens generiske
ventil); **minimal (b) GODKJENN nå**; full matrise + `noTubBound` +
skrankekomplett grådigrute i bølge 3; (c) AVVIS. Rekkefølgen GODKJENN.
Motsigelses-assert ENDRE (usann til skrankene er komplette; test-assert
kun med opsjonene av, i produksjon advarsel, aldri kast). `tubBoundS` i
`MemberSummary` GODKJENN som «horisont», ikke «sertifikat». Strukturert
stoppårsak GODKJENN i endret form: `diagnostics.termination = { kind:
"reached"|"exhausted"|"capped"|"guard", boundSource: "shared"|"own"|
null, prunedBound }`; positivt sertifikat = exhausted ∧ boundSource
null ∧ ingen tak ∧ full dekning. Bølge 3.

### 4.2 Ytelsesingeniør

Målingen lukker runde 1-forbeholdet: egen Tub-beregning er støy, ikke
kostnad; flagget beskytter mot ingenting ⇒ **D9.1 (a) umiddelbart, ikke
bak flagg.** Fallback uten delt felt er under (a) ikke en egen kodesti
— hvert medlem beregner alltid egen bound, som målingen dekker.
Rerun-tak: **ensemble-nivå**, ikke per medlem — S-7s 8/30 er korrelert
(samme regimegrense); over ~25–30 % omkjøringer ⇒ stopp og merk resten
eksplisitt usikre. Uten tak: +56–59 % ⇒ 30–100 s ekstra på nettbrett.
`test:damage` egen kommando: enig. Strukturert stoppårsak og `tubBoundS`
i `MemberSummary`: ren bokkopiering, null hot-path-kost — ja. D9.2(a) er
regresjon; generisk ventil koster ingenting (klassifisering, ikke søk).
Votering: D9.1 (a) GODKJENN; D9.2 minimal (b) nå, matrise/`noTubBound`
bølge 3; rekkefølgen GODKJENN; rerun-tak på ensemblenivå inn i
D9.2-scopet nå.

### 4.3 Værruting-utvikler

Fjerde kategori: `ikkeAvgjort` internt, ikke ny trafikklysfarge; i
cockpit samme reaksjon som error (grå/ukjent), egen tooltip («søket
brukte opp budsjettet uten å avgjøre saken»); teller ikke i nevneren —
infeasible mister bare tilfellene den aldri hadde bevis for. UI-tekst
ved infeasible med `tubBoundS` satt: «grådig forhåndsrute» er
motorsjargong — foreslår «Et raskt overslag kom fram til [havn] på ~X t,
men det fulle søket rakk ikke bevise ruten innenfor tidsbudsjettet»;
handlingen er som ved error. Måling (2) = 0 ⇒ (a) empirisk trygt for
fikstursuiten, men lås med motsigelses-asserten som permanent vakt;
> 0 ⇒ minimal (b) påkrevd. Uansett: minimal (b) inn nå — bugen er reell,
uavhengig av Tub, billig, og nøyaktig feilklassen §1.3 advarte mot.
Votering: D9.1 (a) GODKJENN, (b)/(c) AVVIS. D9.2 (a) alene AVVIS;
minimal (b) nå GODKJENN sammen med motsigelses-assert og `tubBoundS` i
`MemberSummary`; full matrise + `noTubBound` bølge 3. Rekkefølgen
GODKJENN. Strukturert stoppårsak-felt: prinsippet GODKJENN, bølge 3
(endrer returtype, designes i én omgang). `ikkeAvgjort` som eget
`OutcomeKind`: bølge 3. Degradert modus uten delt felt: egen målepost,
ikke krav før vedtak.

## 5. Votering — oppsummert

| | Mat. | Ytelse | Værruting | Djevel | Lateral | Pragm. |
|---|---|---|---|---|---|---|
| D9.1 (a) forkast delt Tub | GODKJENN | GODKJENN | GODKJENN | (ikke mot) | GODKJENN | GODKJENN |
| D9.1 (b)/(c) | AVVIS | AVVIS | AVVIS | – | – | AVVIS |
| D9.2 (a) kun delt bound | AVVIS | (r1 GODKJENN →) minimal (b) | AVVIS alene | AVVIS (regresjon) | ENDRE | – |
| D9.2 minimal (b) nå | GODKJENN | GODKJENN | GODKJENN | krever tak | – | GODKJENN |
| D9.2 full (b)/`noTubBound` | bølge 3 | bølge 3 | bølge 3 | nå | – | bølge 3 |
| D9.2 (c) exactMode | AVVIS | AVVIS | – | – | – | AVVIS |
| Rekkefølgen i §3.2 | GODKJENN | GODKJENN | GODKJENN | – | GODKJENN | GODKJENN |
| `tubBoundS` i MemberSummary | GODKJENN («horisont») | GODKJENN | GODKJENN | – | forslag | – |
| Motsigelses-assert | ENDRE (advarsel, ikke kast) | GODKJENN | GODKJENN | – | forslag | – |
| Rerun-tak | per medlem 1 + budsjett 50 % | ensemble ~25–30 % | via `ikkeAvgjort` | krav | – | – |
| Strukturert stoppårsak | GODKJENN (termination-felt), bølge 3 | GODKJENN | bølge 3 | forslag | – | – |
| `test:damage` egen kommando | (vakt beholdes) | GODKJENN | – | – | – | GODKJENN |

## 6. Hovedsesjonens syntese

1. **D9.1 (a) er enstemmig** og lukket av to målinger: delt bound sparer
   0 % beskjæring (skademålingen) og egen Tub-beregning koster ikke
   målbart (§3.1). Ytelsesingeniørens eneste forbehold falt med tallet.
   Djevelens advokats fallback-scenario (uten delt felt) er under (a)
   ikke en egen kodesti; matematikeren fester en gjenåpningsutløser.
2. **D9.2 (a) som skrevet i grunnlaget er avvist** av fire av seks —
   ikke fordi (a) er utrygg i dag (måling (2): null tilfeller), men fordi
   dagens `classifyMember` allerede er generisk, og (a) ville vært en
   regresjon uten ytelsesgevinst (klassifisering, ikke søk). Panelet
   samler seg om **minimal (b) nå**: ventilen forblir generisk;
   `stagnation`/`noWeatherAtStart`/`outsideDomain`/`callerStopped` ut av
   infeasible-settet (til inconclusive med grunn, hhv. error);
   `prunedBound` og `tubBoundS` alltid i `MemberSummary`/kvitteringen;
   motsigelses-vakt som test-assert (aldri kast i produksjon).
   Full abortReason-matrise, `noTubBound`-opsjon og strukturert
   `diagnostics.termination` i bølge 3.
3. **Nytt sikkerhetsfunn (matematikeren, tilsvar):** motorens egen
   grådige Tub-rute sjekker ikke klaringskorridor, dagslysankomst eller
   veipunkter ⇒ bounden kan ligge under det skrankede optimum og
   1,25-marginen er det eneste vernet. Rettelsen går i trygg retning
   (flere avbrudd ⇒ oftere ingen bound ⇒ mindre beskjæring) men er en
   endring i ADR-0004-motoren og kan flytte golden-ruter — **eget
   beslutningspunkt D9.3 til Magnus** (sikkerhetssemantikk).
4. **Rerun-tak:** panelet er uenig om form (per medlem + budsjett vs
   ensemble-andel). Under D9.1 (a) trigges omkjøring kun av motorens egen
   Tub, som i dag aldri skjer i fikstursuiten (måling (2)) — taket er
   derfor ikke akutt. Anbefaling: per medlem = 1 (idempotens) nå;
   ensemble-budsjett vedtas i bølge 3 sammen med `ikkeAvgjort`-grunnen.
5. **`test:damage`:** skademålingen ut av standard `pnpm test`, inn som
   egen kommando som `/qa` kjører når `search.ts`/robustness endres.

Beslutningspunktene D9.1–D9.5 med anbefaling står i
`docs/specs/robusthet.md` §7.
