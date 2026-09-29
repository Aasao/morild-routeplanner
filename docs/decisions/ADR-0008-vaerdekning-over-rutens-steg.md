# ADR-0008: Værdekning vurderes over rutens steg, ikke over søket

- Status: vedtatt
- Dato: 2026-09-29
- Besluttet av: Magnus (D17.1, etter /panel — `docs/research/ekspertpanel-d17-dekning-2026-09-29.md`)
- Endrer: hva ADR-0005s inkonklusiv-regel og D11.1 (`docs/specs/robusthet.md` §7) leser.

## Kontekst

ADR-0005/D11.1: et medlem som når målet med `coverage.weather = "partial"`
er inkonklusivt («dekning-felt»), fordi tiden da er regnet uten fullt felt.
I dag settes `partial` av én global bit i søket (`search.ts::environmentAt`)
så snart **en hvilken som helst** ekspandert node mangler strøm eller bølge
— også dominerte etiketter og noder langt fra den leverte ruten.
Klassifiseringen blir da en funksjon av hva søket utforsket, ikke av ruten:
to medlemmer med identisk rute kan klassifiseres ulikt. Målt med ekte data
2026-09-29: 16 av 24 medlemmer var `partial` utelukkende på grunn av noder
utenfor ruten (~16 % av alle feltoppslag).

## Beslutning

To dekningsfelt. `coverage.weather` gjelder den leverte ruten: den er
`partial` hvis ett av rutens steg — inkludert sluttetappens start — manglet
strøm eller bølge i det oppslaget motoren faktisk brukte (startnoden per
steg). `coverage.searchWeather` beholder dagens søksbrede bit.
Klassifiseringen leser `coverage.weather` for et medlem som nådde målet, og
`coverage.searchWeather` for et medlem som ikke nådde målet. Målet slås opp
for seg og flagges («strøm ukjent ved ankomst») uten å telle som dekning.
Hvert steg som manglet strøm får `STROM_DATA_MANGLER`.

## Alternativer vurdert

- **Start + ende per steg:** skiller seg fra start-sampling i ett punkt —
  målet — som motoren aldri slår opp. Å telle det måler noe motoren ikke
  brukte, og gir 0/24 dekket fordi Skagen mangler strøm. Avvist enstemmig;
  målet flagges i stedet.
- **Gjøre medlemmet inkonklusivt ved all manglende strøm nær land (streng, «a»):**
  valgt bort. Faglig er den konsistent, men den gir **i praksis et
  trafikklys som aldri avgjør en rute fra havn til havn**, fordi
  havnene ligger ved kysten der strømmodellen mangler verdier. Dette er et
  **bruksvalg, ikke et matematisk argument**, og står her fordi forklaringen
  kom etter at 0 av 24 ble målt. Trafikklyset vurderer den åpne overfarten
  under prognoseusikkerhet; innseilingen er skipperens egen vurdering og
  skal merkes synlig.
- **Behold den globale biten:** klassifiseringen avhenger av søkets
  utforskning; avvist.

## Konsekvenser

- Et medlem som når målet med alle rutesteg dekket, er gjennomførbart selv
  om søket møtte hull andre steder. Ruten er et vitne: hvert steg er regnet
  med full fysikk.
- **Kjent skjevhet som står igjen:** noder uten strøm regnes med strøm 0;
  slike etiketter kan dominere etiketter med ekte motstrøm, så *valget* av
  rute kan være optimistisk. Tidsestimatet for den leverte ruten er likevel
  ærlig når alle dens steg er dekket. Søksnivået beholdes for ugjennomførbar-
  sertifikater nettopp fordi en beskjæring gjort av en slik etikett bryter
  sertifikatet.
- **Manglende strøm på rutens egne steg** gjør fortsatt medlemmet
  inkonklusivt (D17.2 u) til en egen runde har avgjort semantikken for strøm
  nær land (DMI for Skagen, Oceanforecast som c_max-kilde, intervallsjekk,
  strukturelt skille) mot Kartverket-masken.
- D11.1s begrunnelse («tiden er en øvre skranke») holder for bølge, men
  **ikke for strøm** (strøm 0 er verken øvre eller nedre skranke) — en
  fremtidig lempning for strøm kan ikke lene seg på D11.1.

## Bekreftelse

- Regresjonstest: identiske ruter (steg, tid, etapper, totaler) før og
  etter på golden-scenarioene; bare `coverage`-felt og flagg endres.
- Test: et medlem med hull kun utenfor ruten får `coverage.weather = "full"`
  og `searchWeather = "partial"`, og klassifiseres som gjennomførbart.
- Test: et medlem som ikke nådde målet med hull i søket forblir inkonklusivt
  (søksnivået styrer).
- Test: rutesteg uten strøm ⇒ `STROM_DATA_MANGLER` og inkonklusiv.
