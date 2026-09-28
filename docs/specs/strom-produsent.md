# Spec: NorKyst-strøm i værpakken (produsentside)

- Status: **vedtatt** — D15.1/D15.2 besluttet av Magnus 2026-09-27 som anbefalt
  (panel `docs/research/ekspertpanel-d15-kystkant-2026-09-27.md`).
- Dato: 2026-09-27
- Bolk 2, steg 2 (D13.5, D14.3). Grunnlag: `docs/specs/vaerpakker.md`
  §4.2, §9.4, §12, §16, §18b; `docs/research/strom-bolge-forarbeid-2026-09-27.md`;
  `docs/research/spike-norkyst-geometri-2026-09-27.md`.

## 1. Formål og kravsporing

Legg overflatestrøm fra NorKyst v3 (800 m) inn i den eksisterende
værpakken, slik at motorens `WeatherField.current()` får data.

- F2.1 (strøm i pakken), F2.2 (cron-batch til R2, innholdsadressert),
  F2.4 (kildestatus), N2 (ærlig degradering).
- vaerpakker.md §4.2 (NorKyst, delt referansemedlem — ingen ensemble),
  §9.4 (800 m urørt i kystsonen), §18b D14.3 (nearest-neighbour mot
  kildens lat/lon, fill ⇒ udefinert, kystpåslag, merking, overflatelag).

Konsumentsiden er ferdig og endres ikke av denne spec-en:
`packages/weather/src/field.ts::CurrentLayers/decodeCurrentAt`,
`weather-field-adapter.ts::WeatherPackage.current`, motorens
`expand.ts::environmentAt`. `CurrentSample` er {u, v} MOT-retning i knop
(`packages/weather/src/samples.ts`).

## 2. Avgrensning

Denne spec-en dekker **ikke**:
- bølge (steg 3, ADR-0007, egen spec);
- kystflis-geometri §9.6 (0,5–1°-fliser): nå brukes pakkens eksisterende
  1°-fliser, og hele flisen bygges med 800 m-oppløsning (behandles som
  kystsone — enklest og konservativt; budsjett remåles etterpå);
- bilineær interpolasjon mot native noder (NN er det verifiserte minimum);
- endringer i motorens bruk av strøm eller i derating.

## 3. Datamodell og kontrakter

**Kilde.** THREDDS `fou-hi/norkystv3_800m_m00_be` (aggregert tidsakse,
~5 døgn frem). Variabler `u_eastward`, `v_northward` (Int16,
`scale_factor 0.001`, `_FillValue -32767`, m/s, sann øst/nord),
`lat`/`lon` (2D, Y×X), `depth` (overflate = indeks 0, verifisert
2026-09-27).

**Konvensjoner.** Strøm er MOT-retning og holdes som komponenter hele
veien (aldri fart/retning, aldri `atan2`). Ingen vektorrotasjon
(komponentene er allerede geografiske). m/s → knop ved `× 3600 / 1852`,
eksplisitt, én gang, testet.

**Pakkelag.** Per flis og tidssteg to lag `u`, `v` i samme `Layer`-format
som vind (`packages/weather` `buildLayer`/`serializeLayer`, 8-bit,
delta-kodet), `channelKind: "linear"`, på et **regulært lat/lon-gitter**
med nodeavstand ~800 m (Δlat = 0,0072°, Δlon = 0,0144° ved 59°N — nøyaktig
verdi fastsettes som konstant). Tidssteg 1 t, horisont lik vindens (48 t)
avskåret til det NorKyst faktisk har. Pekeroppføring `field: "current"`,
`member: 0` (delt av alle medlemmer). Sertifikat i header som for vind
(`maxDecodeErrorKn`, `clippedSamples`; `maxDirectionErrorDeg` udefinert
for strøm).

**Invarianter.**
1. En kilde-`_FillValue` sjekkes på rå Int16 **før** avskalering og blir
   aldri et tall — den blir sentinel i pakken.
2. Ingen midling eller nedtynning tar inn en fill-celle.
3. Hver regulær node får verdien fra **nærmeste native sjønode målt i
   haversine-avstand mot kildens 2D lat/lon** — aldri indeksaritmetikk på
   flisens bbox. Egen modul (`current-geometry.ts`); vindens
   `windLayerGeometry`/`sampleFromFetchedGrid` gjenbrukes ikke.
4. Lokalisering av indeksvinduet: nærmeste-punkt-søk etterfulgt av lokalt
   sammenhengende finoppslag (spike-mønsteret), aldri bbox-containment på
   en grovt striden prøve (aliaserer på det buede domenet).
5. **Kystkant-forlengelse (D15.1, vedtatt):** en regulær node får verdien
   fra nærmeste native sjønode hvis den ligger innenfor
   `COAST_EXTENSION_CELLS = √2` native celler (haversine mot kildens
   lat/lon); ellers sentinel. Parameteren er én navngitt konstant, testet,
   og utvides aldri uten ny beslutning. Ingen «samme side av land»-sjekk
   nå — feil-side-frekvensen måles først (§5).
6. **Kystmaske (D15.2, vedtatt):** per flis et statisk kvalitetslag (1 bit
   per regulær node, egen pekeroppføring `field: "current-coastal"`)
   som er 1 når noden fikk verdi via forlengelsen eller ligger innenfor
   2–3 native celler fra en fill-celle (nøyaktig tall = konstant, logget i
   headeren). Et punkt er kystsone hvis ett av de fire bilineære hjørnene
   er merket (følger `decodeLayerAt`).

## 4. Adferd

**Normalflyt (cron, etter vinden).**
1. Legal-gate (eksisterende).
2. Finn/cach native indeksvindu per 1°-flis (eget cache-nøkkelrom: NorKysts
   tidsakse er rullerende, ikke per kjøring — vinduet i Y/X caches,
   tidsindeksen regnes per bygg).
3. Hent `lat`/`lon` (cachet), `u`/`v` overflate for 48 tidssteg,
   sekvensielt (§16).
4. Masker fill → bygg regulært gitter via NN (invariant 3–5) → m/s → knop.
5. `buildLayer` + sertifikat + rundtur-verifisering (som vind; brudd ⇒
   bygget feiler, ingen halv pakke).
6. Skriv blober og pekeroppføringer; `upload-r2` er uendret (tar alle
   nøkler i pekeren).

**Ærlig degradering.**

| Situasjon | Pakke | Klient/UI |
|---|---|---|
| NorKyst utilgjengelig / legal-gate stengt | ingen strømoppføring, `sourceStatus` for strøm = feil med årsak | rute merkes «strømdata mangler» (eksisterende N2-rad) |
| Node på land / utenfor kystgrensen | sentinel | `current()` ⇒ `undefined` |
| Node i kystsonen (innenfor 2–3 native celler fra fill) | vanlig verdi | synlig «strømdata: 800 m-grid, posisjonsnøyaktighet ikke verifisert her» der ruten leses (D14.3) — mekanisme etter D15.2 |
| NorKyst-horisont kortere enn vindens | tidssteg utover horisonten = sentinel | `undefined` ⇒ delvis dekning, som i dag |

## 4b. Motor og klient (D15.1 d-min, D15.2)

- **Sluttetappen (`packages/routing/src/reconstruct.ts`):** mangler strøm
  eller bølge i sluttetappens miljøoppslag, OR-es det inn i
  `coverage.weather = "partial"` og etappen får per-steg-flagg. Kan bare
  gjøre klassifiseringen strengere; ingen rute endres (regresjonstest).
  Søkets globale `weatherPartial` endres IKKE her (full (d) er egen
  runde, se §7).
- **Kystsone per steg:** `WeatherField` får et valgfritt oppslag
  `currentCoastal(lat, lon, epochS): boolean` (fra kystmasken); motoren
  setter et per-steg-flagg `STROM_KYSTSONE` på steg der det er sant, og
  rute-flagget er OR over stegene. Ingen endring i søk, kost eller
  derating.
- **UI (`apps/pwa`):** når ruten har `STROM_KYSTSONE`, vises synlig der
  ruten leses: «Strøm nær land: verdien er lånt fra nærmeste sjøcelle i
  800 m-modellen — retningen kan være upålitelig eller komme fra feil side
  i trange sund.» Aldri en nøyaktighet i meter.

## 5. Testkrav

- Fill før avskalering: rå `-32767` gir sentinel, aldri `-32,767 m/s`
  eller 0 (enhetstest, også når fill ligger midt i en ellers gyldig blokk).
- Enhet: 1 m/s ⇒ 1,9438 kn; retning uendret (u, v i samme fortegn).
- NN mot 2D lat/lon: syntetisk polarstereografisk gitter dreid 60° —
  NN-oppslaget treffer riktig kildenode, og et naivt indeksvindu-oppslag
  bommer (testen skal kunne feile om noen gjeninnfører forenklingen).
- Lokalisering over buet domene: syntetisk domene der bbox-containment
  aliaserer — nærmeste-punkt-søket finner riktig område.
- Ingen midling over fill (egenskapstest).
- Rundtur: dekodet pakke mot kildeverdi innenfor sertifikatet på en ekte
  flis (byggetid, som vind).
- Integrasjon mot ekte pakke (etter første `build-live`): minst ett ekte
  medlem får `coverage.weather` ≠ partial **på grunn av strøm** — krever
  også bølge (steg 3); til da: `current()` definert langs åpen sjø på
  golden-ruten.
- Fasit-punkter: Drøbaksundet og Hvaler fra spiken — dekodet pakke gir
  samme verdi som NN-oppslaget i spiken (innenfor kvantisering).

- Forlengelse: ingen node lenger enn `COAST_EXTENSION_CELLS` fra en
  native sjønode får verdi; andelen farbare punkter med `current()`
  udefinert rapporteres for grense 1 og √2 (byggerapport).
- Kystmaske: merking ved forlengelse og innenfor fill-avstand; hjørneregelen.
- Sluttetappen: manglende strøm/bølge ⇒ partial; samme rute og tid før og
  etter endringen på golden-rutene (regresjon).
- Måling etter første `build-live` (rapporteres, ikke et pass/fail-krav):
  feil-side-frekvens i Drøbaksund/Hvaler; kystmerket andel av golden-ruten;
  andel ensemble-medlemmer som fortsatt er partial.

## 6. Budsjett

- Anslag (ikke målt): 13–16 MB strøm for seks 1°-fliser i 800 m. Pakken
  er i dag ~19,6 MB vind ⇒ ~33–36 MB totalt, over 30 MB-målet og under
  50 MB-interimtaket (kravspek 2026-09-03 D6-C). Måles ved første
  `build-live`; over 40 MB ⇒ utløs kystflis-geometri §9.6 (1,6 km
  utaskjærs) før noe annet.
- Byggetid: +1–5 min per cron-bygg (anslag). Timeout 30 min uendret.

## 7. Beslutninger og gjenstående

**Vedtatt 2026-09-27:** D15.1 = (a) med grense √2 celler, sidesjekk etter
måling, d-min for sluttetappen; D15.2 = (a) med per-steg-merking. Full (d)
(dekning over rutens steg i stedet for over søket) er egen spec, ADR og
panel. **Åpen risiko:** uten full (d) kan kystlommer utenfor ruten
fortsatt gjøre medlemmer inkonklusive; målingen etter første `build-live`
avgjør om full (d) blir neste blokkerende steg.

Historikk — spørsmålene slik de ble stilt:

**D15.1 Kystkanten gjør alle medlemmer inkonklusive.** Funnet under
spec-skriving (kode lest 2026-09-27): motoren setter `weatherPartial` så
snart **én** ekspandert node mangler strøm (`search.ts::environmentAt`),
og `decodeLayerAt` gir `undefined` når ett av fire hjørner i bilineær
interpolasjon er sentinel. Skjæløy (start) og Skagen-havna ligger
innenfor én celle fra land. Med strenge sentineler langs kysten blir
**alle** medlemmer «partial» ⇒ inkonklusive (D11.1) — bolk 2s mål
(trafikklys med innhold) nås ikke.
- (a) **Kystkant-forlengelse i produsenten:** en regulær node uten
  native sjønode på sitt eget punkt, men med en native sjønode innenfor
  én native celle (~800 m), får den nærmeste sjønodens verdi. Lenger inne
  på land: sentinel. Noden er alltid kystsone (merket, D14.3). Pro: de
  fleste posisjoner i farbart vann får strøm; ingen verdi oppfinnes
  (det er en målt sjøverdi flyttet ≤ 800 m). Contra: i et sund smalere
  enn én celle kan verdien komme fra feil side av en odde — dekkes av
  merkingen og kystpåslaget, ikke fjernet.
- (b) **Renormalisert bilineær i klienten** over de gyldige hjørnene
  (`packages/weather`), kun for strøm. Pro: ingen pakkeendring. Contra:
  endrer dekodingssemantikk for alle som bruker `decodeLayerAt`, og gir
  samme feil-side-risiko uten produsentens kontroll av avstand.
- (c) **Ingen endring:** kystnære posisjoner er uten strøm ⇒
  inkonklusive. Pro: strengest. Contra: trafikklyset forblir tomt for
  alle ruter som starter i en havn — altså alle.
- **Anbefaling: (a)**, med avstandsgrense lik én native celle, merking og
  enhetstest av at ingen node lenger enn grensen får verdi. Dette endrer
  hvordan kystnær strøm tolkes (sikkerhetssemantikk) ⇒ Magnus avgjør;
  kort panel (meteorolog, marinkartolog) anbefales før vedtak.

**D15.2 Mekanismen for kystmerking og -påslag (D14.3).** Hvordan kommer
«kystsone» fra pakken til UI? (a) Egen kvalitetsmaske per flis
(statisk, 1 bit per node) i pakken, lest av klienten; ruten får et
rute-nivå-flagg når den passerer merkede noder. (b) Klienten utleder
kystnærhet selv ved å se etter sentinel innenfor 2–3 noder. (c) Kun
tekst i sertifikatet. **Anbefaling: (a)** — produsenten vet avstanden
til fill i native celler; klienten kan ikke rekonstruere den etter
regridding. Påslaget i tall (usikkerhet i knop) holdes utenfor motoren
nå: merkingen er kravet, en numerisk påslag i robusthetsscoren krever
egen beslutning.

## 8. Endringslogg

- 2026-09-27: utkast (hovedsesjonen) etter D14-vedtak og geometrispiken;
  D15.1 og D15.2 åpne.
- 2026-09-27: D15.1/D15.2 vedtatt etter panel; spec vedtatt (§3 invariant 5–6,
  ny §4b, §5 testkrav, §7).
- 2026-09-27: implementert (produsent `tools/weather-pack/src/{current-geometry,
  norkyst-source,current-package}.ts` + `build-live-package.ts`; klient
  `packages/weather` `currentLayersFromBytes`/`coastalMaskFromBytes`/
  `decodeCoastalMaskAt`, `WeatherField.currentCoastal?`; motor
  `reconstruct.ts`; UI `route-flags.ts`). Valg der spec-en var åpen:
  regulært gitter 1/139° × 1/70° (kanter på noder); kystmaske-avstand 3
  celler (konservativ ende av «2–3»); cellestørrelse målt lokalt i nærmeste
  native node; sjømaske = aldri fill på noen hentet tidssteg; kystmasken
  lagret som 8-bit `Layer` med ett tidssteg og verdier 0/1 (én bit
  informasjon, ikke bit-pakket); strøm uten kystmaske avvises av klienten;
  sluttetappens partial gjelder også når etappen avvises etter
  miljøoppslaget. Byggerapportens «farbar» er en nærming («sjønær»: native
  sjønode innenfor 2 celler) — ekte farbar-andel krever farbarhetsmasken.
  Ikke kjørt mot THREDDS ennå.
