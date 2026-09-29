# Ekspertpanel D16 — punktbølge fra Oceanforecast

- Dato: 2026-09-28
- Status: ferdig. **Vedtatt av Magnus 2026-09-29 som anbefalt** (punktbolge.md §7).
- Grunnlag: `docs/specs/punktbolge.md` §7 (D16.1–D16.3, WAM800-exit).
- Metode: tre fageksperter (marin meteorolog, marinkartolog,
  værruting-produksjonsutvikler — sonnet), deretter djevelens advokat,
  lateral tenker og pragmatiker, tilsvar og votering. **Simulerte
  fagperspektiver, ikke reelle personer.** Panelet godkjenner ikke —
  Magnus vedtar.

## 1. Runde 1

### 1.1 Marin meteorolog

**D16.1 (a) 10 nm** — kilden oppløser ikke variasjon under ~10 nm i åpent
Skagerrak; tettere gir falsk presisjon. Nær kyst (le, fetch-skjerming) hjelper
ikke finere punkter heller — det krever gridded WAM800. **D16.2 (a) 10 nm**
er ytre grense for et enkeltpunkt; ikke 20. **D16.3:** 1,0 m er akseptabel
praktisk grense, men bratt kort sjø kan bli avgjørende fra 0,8–1,0 m når Tp
er kort — terskelen skal merkes **foreløpig, ikke verifisert mot NORA3**,
ikke fryses. **WAM800-exit:** legg til et fjerde vilkår — lokalisering
verifisert mot kildens egne koordinater (samme disiplin som D14.3).
**Avviser:** 1,0 m som permanent konstant; Hs-only vist som «OK» uten
«periode ukjent». **Trenger målt:** Tp gitt Hs i Skagerrak (NORA3/WAM);
Oceanforecasts reelle oppløsning i korridoren; andel av korridoren i
«> 10 nm, mangler».

### 1.2 Marinkartolog

**D16.1 (a)**, men ikke fordi finere hjelper nær land — modellen fanger
ikke le, refraksjon og refleksjon i det hele tatt. **D16.2:** 10 nm måler
tetthet av punkter, ikke representativitet; i skjærgården sier et punkt
6 nm ute lite om le-siden 2 nm unna. Krav: UI-teksten må skille nært,
åpent farvann fra nært men skjermet/kupert; «< 5 nm» må ikke gi falsk
trygghet i sund. **D16.3:** 1,0 m er en åpent-farvann-terskel; i trangt
farvann er faren krysssjø og refleksjon, som Oceanforecast aldri fanger —
foreslår at trafikklyset også begrenses når ruten går nærmere land enn en
fastsatt avstand, uavhengig av Hs. **Avviser:** (c) ingen grense; en
forenklet tekst som «bølger er kjent her». **Trenger målt:** Oceanforecast-
Hs mot observert sjøtilstand i et trangt sund vs åpen kryssing.

### 1.3 Værruting-produksjonsutvikler

**D16.1 (a)**, gjelder kun Oceanforecast (binder ikke WAM800). **D16.2
(a)**, og `wavePointDistanceNm` vises alltid i diagnostikk. **D16.3 (a)
med tre krav:** (1) en eksplisitt cap-funksjon i §4.2.3 — farge =
strengeste av trafikklys-reglene og bølge-taket; rødt skal aldri mykes til
gult; ikke en ny tabellrad (D11.4-lærdommen); (2) taket anvendes etter
D10.4-skrankene, aldri før; (3) Hs = maks over alle steg og alle
gjennomførbare medlemmer. 1,0 m har ingen kommersiell presedens (PredictWind
viser bølge som eget lag) — merk den provisorisk i `RobustnessStamp` som de
andre tersklene. **WAM800-exit:** legg til at periodefeltet er validert mot
NORA3/WAM på minst én kjent hendelse. **Avviser:** (c) alltid gult — et
system som aldri er grønt blir ignorert; bølge-tak som ny tabellrad.
**Trenger målt:** fordelingen av maks-Hs langs Morild-strekk over en sesong
(krysses 1,0 m sjelden eller ofte?); partial-andel etter punktbølge brutt
ned på årsak.

## 2. Runde 2 — utfordrere

### 2.1 Djevelens advokat

1,0 m-taket er magefølelse med strukturell autoritet — kodet inn blir det
usynlig og varig. Er det en sikkerhetsgrense eller en UI-forsikring? Da
hører det i teksten, ikke i fargen. Kartologens nær-land-tak er riktig i
sak, men ukalibrert og endrer sikkerhetssemantikk uten ADR og måling; to
ukalibrerte tak oppå hverandre er vanskeligere å resonnere om. Og: er
punktbølge verdt maskineriet når den i skjærgården er dokumentert
misvisende?

### 2.2 Lateral tenker

- Bølge som eget informasjonslag, ikke koblet til trafikklyset
  (STROM_KYSTSONE-mønsteret: tekst, ikke farge).
- **Gjenbruk kystmasken fra strøm-sporet** som kilde for «nær land, mulig
  skjermet» i bølgeteksten — ingen ny konstant.
- MEPS-vind som ren diagnostikktekst («kort, bratt vindsjø sannsynlig
  her») uten å røre derating.

### 2.3 Pragmatiker

**Nå:** D16.1/D16.2 (a); provisorisk merking; `wavePointDistanceNm` i
diagnostikk; degraderingstekstene. **Vent:** bølge-taket på trafikklyset
til egen ADR med NORA3/sesongfordeling; nær-land-taket (kystmasken som
tekst i stedet); WAM800-vilkårene skrives ned nå.

**Hovedsesjonens merknad til voteringen:** «et strekk med Hs over terskel
vises aldri rent grønt» er allerede **vedtatt av Magnus i D14.1**
(vaerpakker.md §18b pkt. 1). Å utsette taket betyr å gjenåpne D14.1, ikke
bare å velge alternativ i D16.3.

## 3. Tilsvar

- **Meteorolog:** 1,0 m er en foreløpig sikkerhetsheuristikk fra fysisk
  resonnement (fetch-begrenset bratthet), ukalibrert. Å utsette taket
  gjenåpner D14.1 — trekker enhver antydning om at det bør vente. Støtter
  kystmasken som tekst, ikke et nytt tak.
- **Marinkartolog:** trekker sitt nær-land-tak som trafikklysregel
  (ukalibrert, sikkerhetssemantikk uten måling). Poenget står: «< 5 nm»
  må ikke leses som trygt i et sund — kystmaske-teksten løser det. Punkt-
  bølgens verdi i skjærgården er å gjøre fravær av presisjon synlig.
- **Værruting-utvikler:** det er bare *tallet* som er magefølelse; taket
  følger av D14.1. Håndteres som 0,9/0,7/0,2 i §4.2.3: kodet, stemplet
  foreløpig, remåles. Ren tekst holder ikke — trafikklyset er det brukeren
  skanner uten å lese begrunnelsen.

## 4. Votering

| | Meteorolog | Marinkartolog | Værruting |
|---|---|---|---|
| **D16.1 (a) 10 nm** | GODKJENN | GODKJENN | GODKJENN |
| **D16.2 (a) 10 nm + avstand i diagnostikk** | GODKJENN | GODKJENN | GODKJENN |
| **D16.3 (t1) tak nå per D14.1** | GODKJENN | GODKJENN | GODKJENN |
| D16.3 (t2) utsett taket | AVVIS (gjenåpner D14.1) | — (gjenåpning, ikke D16) | AVVIS |
| D16.3 (n1) nær-land-tak | AVVIS | trukket | AVVIS |
| **D16.3 (n2) kystmasken som tekst** | GODKJENN | GODKJENN | GODKJENN |
| D16.3 (n3) ingen skille | AVVIS | AVVIS | AVVIS |
| (v) MEPS-vind som diagnostikktekst, egen spec | GODKJENN | GODKJENN | GODKJENN |
| **WAM800-exit, fem vilkår** | GODKJENN | GODKJENN | GODKJENN |

Enstemmig på alle punkter etter tilsvar.

## 5. Hovedsesjonens syntese

D16.1 og D16.2 (a); D16.3 (t1) — taket implementeres som cap-funksjon i
§4.2.3 anvendt etter trafikklys-reglene og D10.4-skrankene, kan bare
hindre grønt, Hs = maks over rutens steg og gjennomførbare medlemmer,
1,0 m stemplet foreløpig; (n2) kystmasken gir «nær land, mulig skjermet»
i bølgeteksten; WAM800-exit med fem vilkår; MEPS-vind-diagnostikk som
egen senere spec. Utfordrerne endret utfallet på ett punkt:
kartologens nær-land-tak ble tekst i stedet for en ny trafikklysregel.
