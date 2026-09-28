# Ekspertpanel D15 — kystkanten i strømfeltet

- Dato: 2026-09-27
- Status: ferdig (runde 1, utfordrere, tilsvar, votering; syntese i §5). Venter Magnus.
- Grunnlag: `docs/specs/strom-produsent.md` §7 (D15.1, D15.2).
- Metode: tre fageksperter (marin meteorolog, marinkartolog — sonnet;
  matematiker — opus), deretter djevelens advokat, lateral tenker og
  pragmatiker, tilsvar og votering. **Simulerte fagperspektiver, ikke
  reelle personer.** Panelet godkjenner ikke — Magnus vedtar.

## 1. Runde 1

### 1.1 Marin meteorolog

**D15.1 (a), men ikke med ren avstand.** Drøbaksund/Hvaler er 63–87 %
fyll — hovedtilstanden, ikke en randsak. I et sund smalere enn én celle
er «nærmeste sjønode innenfor 800 m» ofte på **motsatt side** av land.
Krav: sjekk at kildenoden er på samme side av land (landmaske, f.eks.
farbarhetsmasken), ikke bare avstand. Nærmeste sjønode representerer åpent
vann; i sund/ved odder er strømmen dominert av lokal topografi et 800 m-
grid ikke oppløser — skala-mismatch, ikke avstandsfeil. **D15.2 (a)**,
gjerne med informasjon om hvilken landmasse/side verdien er lånt fra;
minimum at merkingen faktisk utløses i Drøbaksund/Hvaler. **Avviser:**
avstandsgrense uten landmaske-bevissthet; UI-tekst som antyder
«nøyaktighet innenfor X m» — riktig er «retning kan være upålitelig i
trange sund». **Trenger målt:** andel av golden-ruten og havneinnseilinger
som blir kystmerket; om forlengelsen henter fra feil side i praksis;
NorKyst-node mot Oceanforecast-punkt i Drøbaksund/Hvaler.

### 1.2 Marinkartolog

**D15.1 (a)** — forenlig med kravet fra D14: kystnære celler skulle ha
usikkerhetspåslag, ikke være uten verdi; forlengelsen flytter en målt
verdi innenfor den sonen. Men 800 m er øvre grense; ingen stille
utvidelse til 1,5–2 celler senere uten ny runde. **D15.2 (a).** Ærlig
merking må si (1) at verdien er en flyttet nabocelle, (2) at den kan
tilhøre feil side av en smal landtunge, (3) gjelder både havn og
underveis. Rute-flagget må kunne kobles til hvilke steg som er berørt.
**Avviser:** utvidelse utover én celle uten måling; vag «ikke verifisert»-
tekst; at forlengelsen fjerner «lavere robusthet» i trange sund
(trafikklys-innhold ja, fullverdig grønt nei); depth-indeks uten
testkrav. **Trenger målt:** feil-side-frekvens for forlengelsen i
Drøbaksund/Hvaler; kystmerket andel av korridoren; depth-indeks 0 mot
uavhengig kilde.

### 1.3 Matematiker

**Dekningssemantikken er feil.** `weatherPartial` (`search.ts:609`)
settes når hvilken som helst ekspandert node mangler strøm/bølge —
også dominerte etiketter, blindlommer og den grådige forhåndsruten.
Klassifiseringen blir en funksjon av hva søket utforsket, ikke av ruten:
to medlemmer med identisk rute kan få ulik klassifisering (kurser,
`exactMode`, Tub-beskjæring). Deterministisk, men ikke stabil —
korrekthetsproblem for ensemble-nevneren. Tre ting blandes: (1)
horisontslutt og vindhull (riktig på søksnivå); (2) manglende felt på
rutens egne steg (D11.1s begrunnelse — riktig å være inkonklusiv); (3)
manglende felt utenfor ruten (ruten er fortsatt et fullgodt bevis — bare
diagnostikk). **Nytt hull:** sluttetappen (`reconstruct.ts:810`) bruker
`environmentAt` uten å markere delvis dekning — manglende strøm inn til
havna oppdages ikke i dag. **Anbefaling: (d) + (a):** (d) partial utledes
over rutens steg inkl. sluttetappen med per-steg-flagg
(`STROM_DATA_MANGLER`), horisont/vindhull på søksnivå, utenfor-rute bare
telt — motorendring ⇒ ADR. (d) alene løser ikke Skjæløy/Skagen (rutens
eget første/siste steg treffer sentinel) ⇒ (a) trengs. Grensen i (a):
én celle er for stram mot diagonale hjørner i det regulære gitteret —
√2 celler foreslått, som testet parameter. **D15.2 (a)**, merking per
steg, rute-flagg = OR; et punkt er kystsone hvis ett av fire bilineære
hjørner er merket. **Avviser:** (b) (skjult ekstrapolasjon i delt
dekoder); prosentterskel for partial; stille null på rutens steg; (c);
(d) uten (a). **Trenger målt:** andel farbare punkter med `current()`
udefinert etter (a) med 1 og √2 celler; partial-medlemmer under dagens
semantikk vs (d); regresjonstest at (d) ikke endrer ruter, bare
klassifisering; antall etiketter uten strøm som dominerer etiketter med.

### 1.4 Uenighet etter runde 1

Grensen i (a): meteorolog og kartolog vil ha ≤ 1 celle og landmaske-sjekk
(samme side av land); matematikeren vil ha √2 celler for å dekke
diagonale hjørner. Matematikerens (d) er nytt og krever ADR.

## 2. Runde 2 — utfordrere

### 2.1 Djevelens advokat

«Trafikklyset må få innhold» er bolk 2s exit-kriterium, ikke en
sikkerhetsvurdering; det skal ikke presse frem (a). Matematikerens (d) er
en konsumentendring i `search.ts`/`reconstruct.ts` som ikke hører hjemme
som vedlegg til en produsent-spec — egen spec og panel; og per-steg-flagg
har egne hull (steg som aldri evalueres). Landmaske-sjekken er ikke
bevist gjennomførbar: farbarhetsmasken er bygget for dypgang/klaring, ikke
for «hvilken side av land» en strømverdi hører til — en ny geometrikobling
mot en polarprojisert kilde kan bli en ny feilkilde.

### 2.2 Lateral tenker

- **Havnesone uten strømkrav:** første/siste N meter evalueres uten krav
  om strøm — en egen tredje tilstand (ikke sentinel, ikke ekstrapolert).
- **Vannveisavstand i farbarhetsmasken** i stedet for luftlinje (samme
  sammenhengende farbare komponent innen R meter).
- **Egen regel for sluttetappen** i `reconstruct.ts` uten å røre søkets
  `weatherPartial`.
- **Intervall [min, maks]** fra nærmeste sjønoder i kystsonen.
- **Kystnoder som «lav tillit»** gjennom robusthetsscoren i stedet for
  manglende data.

### 2.3 Pragmatiker

**Nå:** (a) med √2-celle-grense; kystmerking D15.2 (a) samtidig (samme
datastruktur); sluttetappens stille manglende dekning rettes eller telles
nå (N2-brudd i dag). **Vent:** landmaske-sjekken til feil-side-frekvensen
er målt i Drøbaksund/Hvaler; full (d) som egen spec, ADR og panel.
**For dyrt nå:** vannveisavstand og intervallrepresentasjon. Rekkefølge:
(a) + merking → sluttetappen → mål → vurder landmaske og (d).

## 3. Tilsvar

- **Meteorolog:** trekker «sidesjekk nå» — farbarhetsmasken er ikke
  validert for sideidentitet mot et polarprojisert gitter; det er en ny
  geometrikobling med samme feilklasse som bbox-aliasingen. Mål
  feil-side-frekvensen først; kystmerkingen er sikkerhetsnettet.
- **Marinkartolog:** går fra 1 til √2 celler (regridding-geometri, ikke
  kvalitetsheving — lengre avstand betyr mer usikker retning). Havnesone
  kun som tredje synlig UI-tilstand, aldri som fjernet strømkrav: ved en
  trang innseiling er det nettopp der føreren trenger strømmen.
- **Matematiker:** trekker (d) ut av produsent-spec-en (egen spec, ADR,
  panel). Per-steg-hullet taler for full (d): et steg sampler i dag bare
  startnoden; full (d) må sample start og ende per steg. **Ærlighet:**
  med bare (d-min) står søkets globale bit urørt — kystlommer utenfor
  ruten kan fortsatt gjøre medlemmer partial. Om trafikklyset får innhold
  er et måletall; viser målingen at de fleste medlemmer er partial,
  blokkerer full (d) bolk 2s exit.

## 4. Votering

| | Meteorolog | Marinkartolog | Matematiker |
|---|---|---|---|
| g1 (≤ 1 celle) | — | (trukket) | AVVIS |
| **g√2 (≤ √2 celler)** | GODKJENN | GODKJENN | GODKJENN (test av udefinert-andel g1/g√2) |
| s-nå (sidesjekk nå) | (trukket) | AVVIS | AVVIS |
| **s-mål (mål først)** | GODKJENN | GODKJENN | GODKJENN |
| **d-min (sluttetappen)** | GODKJENN | GODKJENN | ENDRE: sluttetappens mangel OR-es inn i `coverage.weather`, ikke bare telles |
| d-full | egen runde | egen runde | GODKJENN som egen runde (start + ende per steg) |
| havn | til utforskning | kun som tredje UI-tilstand | AVVIS nå |
| **D15.2 (a)** | GODKJENN | GODKJENN (+ sporbar til berørte steg) | GODKJENN |

## 5. Hovedsesjonens syntese

1. **Enstemmig:** kystkant-forlengelse ≤ √2 native celler (testet
   parameter, ingen stille utvidelse); sidesjekken venter på målt
   feil-side-frekvens; kystmaske i pakken med per-steg-merking og
   UI-tekst uten nøyaktighetspåstand.
2. **d-min med matematikerens skjerping:** sluttetappens manglende
   strøm/bølge gjør `coverage.weather` partial (kan bare gjøre
   klassifiseringen strengere). Dette er en liten motorendring i
   `reconstruct.ts` — den lukker et stille N2-brudd og endrer ingen ruter.
3. **Full (d)** (dekning over rutens steg i stedet for over søket) er en
   egen runde. **Risiko som skal stå åpent:** uten den kan trafikklyset
   forbli tomt selv etter strøm og bølge. Målingen etter første
   `build-live` avgjør om full (d) blir neste blokkerende steg.
