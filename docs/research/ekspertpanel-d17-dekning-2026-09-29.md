# Ekspertpanel D17 — værdekning langs ruten og strøm i havn

- Dato: 2026-09-29
- Status: ferdig. **Vedtatt av Magnus 2026-09-29 som anbefalt** (implementasjon: ADR for D17.1, deretter egen D17.2-runde).
- Grunnlag: `docs/research/beslutningsgrunnlag-d17-dekning-2026-09-29.md`.
- Metode: fire fageksperter (matematiker — opus; marinkartolog, marin
  meteorolog, værruting-produksjonsutvikler — sonnet), deretter djevelens
  advokat, lateral tenker og pragmatiker, tilsvar og votering. **Simulerte
  fagperspektiver, ikke reelle personer.** Panelet godkjenner ikke —
  Magnus vedtar.

## 1. Runde 1

### 1.1 Matematiker

**D17.1 GODKJENN (d) med presis definisjon:** motoren bruker kun miljøet i
**startnoden** per steg (stykkevis konstant). Dekning skal gjelde dataene
motoren brukte ⇒ start-sampling per steg inkl. sluttetappens start. «Start +
ende» skiller seg bare i **ett punkt: målet**, som motoren aldri slår opp —
hele 16/24 vs 0/24 er Skagen-punktet. Målet slås opp separat og flagges
(«strøm ukjent ved ankomst»), teller ikke som dekning. Midtpunkt avvist.
Reviderer eget D15-tilsvar. **Skjevhet:** node uten strøm regnes c = 0 ⇒
komfort systematisk optimistisk, tid feil med ukjent fortegn; lommeetiketter
kan dominere ekte motstrøm (optimizer's curse). **Asymmetri:** nådd mål —
ruten er et vitne; alle steg dekket ⇒ gjennomførbarhet bevist ⇒ rutenivå-
dekning. Ikke nådd — et infeasible-sertifikat krever at ingen beskjæring var
feil ⇒ behold søkets globale bit. To felt: `coverage.weather` (rute) og
`coverage.searchWeather` (søk); `classifyMember` leser søket for infeasible,
ruten for feasible. ADR.
**D17.2 (d) intervallsjekk:** D11.1 («øvre skranke») er monotont for bølge
men **ikke for strøm** — c = 0 er verken øvre eller nedre skranke. (b)/(c)
kan ikke begrunnes med D11.1. Konsistent bare med begrenset forstyrrelse:
Δt ≤ Σ dᵢ·c_max / (Vᵢ·(Vᵢ − c_max)) over steg uten strøm (c_max fra
nabocellene eller konservativ tabell); klassifiser normalt med synlig flagg
kun hvis klassifiseringen er invariant over [t − Δt, t + Δt] (horisont,
dagslys, harde sjekker) og Vᵢ > c_max; ellers inkonklusiv. Budsjett = sum nm
uten strøm, ikke en fast sone. **D17.3:** fyll-feilen → Kartverket-masken
(16/24 og 8/24 er forurenset av testmasken) → (d) + intervallsjekk
(regresjon: identiske ruter) → nettbrett-remåling. **Avviser:** (a); (c)
uten lengdebudsjett; ende-/målsampling som dekning; å begrunne (b)/(c) med
D11.1; prosentterskler; c = 0 uten flagg; (d) for ikke-nådd.
**Trenger målt:** nm uten strøm per rute og c_max med Kartverket-masken;
dominans fra lommeetiketter i rutens forfedrekjede; sensitivitet med
lommestrøm ±c_max i fire retninger; hvor mange av 24 består intervallsjekken.

### 1.2 Marinkartolog

**D17.1:** start **og ende** — kun start skjuler ankomsten, der båten går
sakte nær grunt vann. `STROM_DATA_MANGLER` på alle steg. **D17.2:** Skagen er
et konvergenspunkt; ukjent 1–2 kn tverrstrøm i en trang innseiling er en
styrbarhetsfaktor, ikke komfort. **Avviser (b) havnesone igjen** (leses som
fravær av krav; fast N nm er vilkårlig). Går for (c) + eksplisitt tekst:
«Strøm ukjent i havneinnseiling — krysssjø/tverrstrøm mot molo kan
forekomme, vurder motorseiling og alternativ ankomsttid», helst utløst av
masken (trang korridor nær kai), ikke en ny avstandskonstant. **D17.3:**
Kartverket-masken før remåling. **Avviser:** havnesone uten krav; kun
start-sampling som endelig svar; generisk «strøm ukjent» uten hvorfor det
haster. **Trenger målt:** reell strøm i Skagen-innløpet; andel Morild-havner
med tilsvarende innseiling; om masken eksponerer «trang korridor».

### 1.3 Marin meteorolog

**D17.1:** start + ende, synlig `STROM_DATA_MANGLER`; tomt trafikklys skal
ikke presse frem løsningen. **D17.2 (b) smal havnesone 2–3 nm** + (c)
kystmerket sentinel alltid vist/telt som ukjent. Avviser (a) og sone > 3 nm.
**Skagen:** NorKyst er en norsk modell — dansk farvann er trolig svakt eller
udekket; derfor er målet sentinel i alle 24. Dokumenteres som permanent,
ærlig degradering, ikke noe som «fikses». **D17.3:** Kartverket-masken og
måling av NorKysts faktiske dekningsgrense mot dansk farvann før flere
semantikkrunder. **Trenger målt:** nodedekning 1/2/3/5 nm fra Skagen;
kystmerket andel i Hvaler/Drøbaksund/Skagen; hvor NorKyst slutter å levere.

### 1.4 Værruting-produksjonsutvikler

**D17.1:** start + ende per steg; `STROM_DATA_MANGLER` på alle steg;
utenfor-rute teller aldri. **D17.2 (b) + (c):** kommersielle produkter
leverer estimat for åpent vann og overlater første/siste nm til skipperens
lokalkunnskap — uten å late som de dekker det. Havnesone gir synlig «strøm
ukjent i havneinnseilingen», resten klassifiseres normalt. Avviser (a) (en
indikator som aldri blir ferdig undergraver tilliten). **Minste regel uten å
lyve:** trafikklyset svarer på «hvordan ser den åpne overfarten ut under
prognoseusikkerhet», ikke «er innseilingen trygg» — skillet må stå i UI.
**D17.3:** Kartverket-masken først. **Trenger målt:** andel Morild-strekk der
start/mål er i sentinel-sonen; andel avgjorte trafikklys under (b)+(c).

### 1.5 Uenighet etter runde 1

- Start vs start+ende: matematikeren viser at forskjellen er ett punkt
  (målet), som motoren ikke bruker — foreslår separat flagg.
- D17.2: kartolog (c)+tekst, meteorolog (b) 2–3 nm + (c), værruting (b)+(c),
  matematiker intervallsjekk med lengdebudsjett (og: D11.1-argumentet holder
  ikke for strøm).
- Enighet: (a) avvist; Kartverket-masken før remåling; full (d) i en eller
  annen form.

## 2. Runde 2 — utfordrere

### 2.1 Djevelens advokat

Intervallsjekken er elegant men kanskje ikke testbar: c_max «fra
nabocellene» er ad hoc — hva om alle naboene også er sentinel (hele
Skagen-klyngen)? Bytter ett ukjent mot en skjønnsmessig konstant. «Trafik-
klyset gjelder åpent vann» kan være en definisjon konstruert bakover fra at
0/24 er uakseptabelt — skal stå eksplisitt i ADR at (a) ble valgt bort
delvis fordi den er ubrukelig i praksis. Og: å vedta D17.2-semantikk før
Kartverket-masken er byttet kalibrerer mot en fiktiv kystlinje.

### 2.2 Lateral tenker

- **Dansk strømkilde (DMI) for Skagen** før «permanent sentinel» godtas —
  «vår ene kilde dekker det ikke» er ikke det samme som «ingen kilde».
- **Oceanforecast-punktstrøm som c_max-kilde** der NorKyst er sentinel.
- **Avslutt den vurderte ruten utenfor innseilingen** (der masken åpner
  seg) og presenter siste etappe som egen seksjon uten trafikklys —
  strukturelt skille i stedet for flagg; grensen fra masken, ikke fast N nm.

### 2.3 Pragmatiker

Nå: Kartverket-masken; (d) med matematikerens definisjon (start-sampling
inkl. sluttetappens start, to dekningsfelt, regresjon identiske ruter);
`STROM_DATA_MANGLER` på alle steg; målflagg «strøm ukjent ved ankomst»;
kystmerket sentinel synlig og talt diagnostisk **uten** å endre
klassifiseringen. Vent: D17.2-semantikken (havnesone, intervallsjekk,
c_max-kilde) til egen runde med ADR etter maske og målinger.

## 3. Tilsvar

- **Matematiker:** trekker intervallsjekken for nå — c_max fra nabocellene
  er udefinert når hele Skagen-klyngen er sentinel; en selvvalgt konstant er
  en modellantakelse, ikke en skranke. Riktig form, men først med en
  etterprøvbar c_max-kilde (Oceanforecast, DMI, dokumentert tabell); ellers
  streng. (s) er matematisk renere enn havnesone, forutsatt stabil grense
  på tvers av medlemmene. Presisering til pragmatikeren: «uten å endre
  klassifiseringen» gjelder bare noder UTENFOR ruten — på rutens egne steg
  gjør manglende strøm fortsatt medlemmet inkonklusivt under (u). Bortvalg
  av (a) er et bruksvalg, ikke et matematisk argument — skal stå slik.
- **Marinkartolog:** trekker start+ende — et eget synlig målflagg er
  sterkere enn å drukne ankomsten i dekningen. (s) hører i D17.2-runden,
  vurdert mot Kartverket-masken.
- **Meteorolog:** trekker «permanent sentinel ved Skagen» til DMI/Copernicus
  er undersøkt. Oceanforecast som c_max kun som konservativ øvre grense nær
  riktig kystsone. Egen (b)+(c)-begrunnelse var styrbarhet, ikke D11.1 —
  skal stå separat i ADR.
- **Værruting-utvikler:** «trafikklyset måler åpent vann» kom etter 0/24,
  men presiserer det motoren alltid har målt; skal stå eksplisitt i ADR
  nettopp fordi timingen er mistenkelig. Går fra (d2) til (d1); trekker (b).

## 4. Votering

| | Matematiker | Marinkartolog | Meteorolog | Værruting |
|---|---|---|---|---|
| **D17.1 (d1)** start-sampling, målflagg, to dekningsfelt, ADR | GODKJENN | GODKJENN | GODKJENN | GODKJENN |
| D17.1 (d2) start + ende | AVVIS | AVVIS | AVVIS | AVVIS (trukket) |
| **D17.2 (u)** utsett; strengt på rutens steg til da | GODKJENN | GODKJENN | GODKJENN | GODKJENN (kun til maske + DMI) |
| D17.2 (b) havnesone nå | AVVIS | AVVIS | ENDRE (vent på DMI) | AVVIS (trukket) |
| D17.2 (i) intervallsjekk nå | ENDRE (egen runde, etterprøvbar c_max) | AVVIS nå | ENDRE (validert c_max først) | ENDRE (etter maske) |
| D17.2 (s) strukturelt skille | kandidat (stabil grense) | ENDRE: til egen runde | egen runde | ledende idé, egen runde |
| **D17.3 rekkefølge** | GODKJENN | GODKJENN | GODKJENN | GODKJENN |
| **ADR-tekst om (a)** | GODKJENN (bruksvalg) | GODKJENN | GODKJENN (ordrett) | GODKJENN (obligatorisk) |

Enstemmig etter tilsvar.

## 5. Hovedsesjonens syntese

1. **D17.1 (d1):** dekning over rutens steg med start-sampling (det
   motoren faktisk bruker), inkl. sluttetappens start; målet slås opp for
   seg og flagges «strøm ukjent ved ankomst» uten å telle som dekning;
   `coverage.weather` (rute, for gjennomførbar) og `coverage.searchWeather`
   (søk, beholdes for ugjennomførbar-sertifikat); `STROM_DATA_MANGLER` på
   alle steg; regresjon med identiske ruter. Krever ADR (endrer hva
   ADR-0005/D11.1 leser).
2. **D17.2 (u):** semantikken for manglende strøm på rutens egne steg
   utsettes; til da gjør den medlemmet inkonklusivt (strengt), med synlig
   flagg. Egen runde etter Kartverket-masken med: DMI/Copernicus for
   Skagen, Oceanforecast som c_max-kilde, intervallsjekk og strukturelt
   skille (s) som kandidater.
3. **Forventet effekt (fra diagnosen, testmaske):** 16/24 fullt dekket,
   8/24 inkonklusive — trafikklyset kan få innhold, men tallene må remåles
   med Kartverket-masken.
4. **ADR-teksten** sier eksplisitt at (a) ble valgt bort også fordi den i
   praksis gir et trafikklys som aldri avgjør havn-til-havn (bruksvalg),
   og at trafikklyset måler den åpne overfarten.
