# Bohuslän alternatives 2→1 etter R3 — undersøkt og forklart

- Dato: 2026-08-31. Lukker oppfølgingspunkt 1 fra
  `beslutningsgrunnlag-r3-e1-2026-08-31.md` (grad 3 fra review): hvorfor falt
  golden-fiksturen `bohuslan-trange-sund` fra 2 til 1 rutealternativ da R3
  (lagdelt kystbuffer-korridorsjekk) ble slått på?
- Metode: pre-R3-koden (c828ce2) kjørt i egen worktree med probe som dumper
  hele Pareto-fronten ved målet; de bortfalte sporene deretter kjørt gjennom
  dagens `checkClearanceCorridor` og en uavhengig tettsampling (2000 punkter
  per korde), pluss et moteksperiment mot uncertified-konservatismen.

## Konklusjon

**Bortfallet er korrekt: begge pre-R3-alternativene passerte samme skjær som
den gamle primærruten, med målt minimumsklaring 0,088 nm mot kravet 0,15 nm.
Avvisningen er et målt brudd (`uncertified: false`), ikke
bisection-konservatisme.** Konservatismen ved rekursjonsbunnen er i tillegg
motbevist som årsak ved eksperiment (under). Ingen endring i motoren trengs;
en regresjonstest er lagt til.

## Funn 1: de bortfalte kandidatene var aldri lovlige ruter

Pre-R3 hadde fiksturen primærrute (15 538 s) + to alternativer (begge
14 410 s til nærpunktet, 20,8–20,9 nm, 6 hhv. 7 etapper). De to alternativene
deler spor fram til 58,331°N 10,987°E og skiller lag først på de siste
etappene.

Den delte korden **58,1742 11,0755 → 58,2104 11,0352** (etappe 2 i begge)
har målt minimumsklaring **0,0876 nm ved 58,199°N 11,048°E** — samme skjær
og samme lekkasje som R3-commiten dokumenterte for primærruten (0,088 < 0,15).
Endepunktene har god klaring; bruddet ligger midt på korden, som er nøyaktig
feilmoden R3 ble bygget for å fange. Dagens korridorsjekk avviser korden med
et *målt* brudd i et konkret punkt, ikke via rekursjonsbunnen.

Etter R3 må hele rutefamilien runde skjæret lengre vest/øst; i det omlagte
tilstandsrommet bærer målet en Pareto-front på 2 etiketter (primær + 1
alternativ på 14 413 s / 21,1 nm) i stedet for 3. Det gjenværende
alternativet er topologisk den omlagte varianten av de gamle.

## Funn 2: uncertified-konservatismen har null innvirkning på fiksturen

Standardkjøringen har 1 392 klaringsavvisninger i søket, hvorav **22 fra
rekursjonsbunnen** (`uncertified`, konservatismevindu ~18 m med
`clearanceCorridorMinChordNm` 0,02). Moteksperiment: samme søk med bunnen
senket til 1e-6 nm (~1 mm) og `clearanceCorridorMaxDepth` 40:

- `uncertified` går til **0** — alle 22 blir *sertifisert trygge* ved dypere
  bisection (avvisninger 1 392 → 1 370, differansen er nøyaktig de 22).
- Resultatet er **bit-identisk relevant**: samme varighet (15 584 s), samme
  ene alternativ (14 413 s, 21,091 nm), samme spor.

De 22 konservative avvisningene traff altså kanter som uansett ikke inngår i
noen ikke-dominert rute til målet. Konservatismen kostet ingenting her — og
kan dermed heller ikke forklare 2→1.

## Regresjonstest

R3-invarianten i `golden.test.ts` samplet bare `result.steps` (primærruten).
Alternativene vises i UI på lik linje, men ingen test garanterte kystbufferen
langs dem — pre-R3-lekkasjen i alternativene ville vært usynlig selv med
invarianten på plass. Ny test i `golden.test.ts`:

> **«kystbufferen holder også langs alle alternativruter»** — sampler
> klaringen (400 punkter per etappe) langs hver alternativ-etappe i alle
> golden-scenarioer mot `minOffingNm` (nedre skranke; `RouteLeg` bærer ikke
> bølgehøyde).

Verifisert begge veier: testen **feiler på c828ce2** (bohuslän alternativ 0,
etappe 1, klaring 0,149 → synkende til 0,088) og **passerer på HEAD**.
Suite: 214/214 grønt i `@morild/routing`, `pnpm check` 0 feil.

## Merknader

- Tallene 14 410/14 413 s for alternativene er tid til søkets nærpunkt
  (innenfor `reachRadius`), uten sluttetappen — derfor lavere enn primærens
  totalvarighet. Ikke en anomali.
- Fiksturens `alternatives: 1` i golden-filen er altså riktig fasit, ikke et
  tap som skal «repareres». Skulle antallet senere endre seg igjen, gi denne
  undersøkelsen som mal: dump fronten, kjør bortfalte spor gjennom
  `checkClearanceCorridor`, og skill målt brudd fra `uncertified` før noe
  annet konkluderes.
