# Ruteplanlegging og værruting for fritidsbåt — konkurrentkartlegging

- Dato: 2026-08-30 (websøk-basert research; enkelte funn er sekundærkilder, se «Det vi ikke fant ut»)

## Kort svar

Markedet er modent på kart, GPS-navigasjon og deterministisk værruting (én modell → én foreslått rute), men nesten fraværende på **robusthetsvurdering av ruten selv**: kun PredictWind (Professional-nivå) og profesjonell racing-programvare som Expedition tilbyr ekte ensemble-basert spredning langs ruten, og bare PredictWind og SailRouting sammenligner flere avgangsdatoer side ved side. Ingen bygger en robusthetsscore rundt et avgangsvindu for en spesifikk båt i skandinaviske farvann. På norske forhold er det et strukturelt hull: Navionics' SonarChart-crowdsourcing er begrenset i Norge/Sverige/Finland (rapportert restriksjon på sonarlogg-opptak), mens Kartverkets autoritative data har kvalitetsmetadata som ingen kommersiell app formidler. Tidevannsstrøm i trange sund håndteres generisk (stasjonsinterpolasjon), ikke som modellert skjærgårdseffekt.

## Produktoversikt

| Produkt | Kjerne | Pris | Robusthet/usikkerhet | Skandinavia-relevans |
|---|---|---|---|---|
| **savvy navvy** | Smart ruting m/tidevann, avgangsplanlegger, dybdekart | ~80–190 USD/år | Deterministisk, én modell | Bred dekning; norsk presisjon udokumentert |
| **Orca** | Full værruting m/kryss, polarer; bruker **nordiske regionale værmodeller** | Gratis basis; ruting 49 €/år; Smart Nav 149 €/år | Beste enkeltmodell velges, ingen spredning | Sterk: eksplisitt nordiske modeller |
| **Navionics (Garmin)** | Auto Guidance+ dokk-til-dokk, SonarChart | 40–100 USD/år | Ingen | SonarChart-crowdsourcing svak i Norden (restriksjon, ikke primærverifisert) |
| **PredictWind** | Værruting, avgangsplanlegging, 3D-bølgemodell | 29–499 USD/år | **Sterkest i markedet:** ECMWF-ensemble dag 10–30 (AI-medlemsmatching, ikke per-medlem-ruting), Departure Planning 4 datoer side om side | Global, offshore-fokus, ikke skjærgård |
| **Windy.app/WindHub** | Værkart, flere modeller; ruting «under utvikling» | ~19–70 USD | Modellbytte manuelt, ingen spredning | God modelldekning, ikke nordisk-spesialisert |
| **qtVlm** | Åpen kildekode, isokron-ruting på GRIB + polar | Gratis + engangskjøp | Ingen ensemble | GRIB-kilde opp til bruker; teknisk krevende |
| **OpenCPN weather_routing** | Isokron fra GRIB/klimatologi | Gratis | Én kjøring per datasett | Desktop, ikke mobil; GRIB selv |
| **SailGrib WR** | Vær, tidevannsstrøm-atlas (europeiske), 400+ polarer | Sprikende kilder (29 €–274 €/år) | Flere kilder manuelt, ingen spredning | Strøm-atlas trolig UK/FR-fokusert |
| **Avalon Offshore** | Værruting m/VPP, 65 modeller, **batymetrisk ruting (dypgang!)** | 45 € engangs + 24 € vær | Modellbredde, ikke ensemble | Batymetrisk ruting relevant, men dybdedata-kvalitet i Norge usikker |
| **TZ iBoat** | Isokron-ruting, AIS, tidevann | Gratis app + kart fra ~20 USD/år | Ingen i mobilapp | Ingen nordisk spesialisering |
| **NV Charts App** | Manuell + autoruting, tidevann | Per kartområde | Ingen | Egne Norge-kart, kjent kvalitetsmerke |
| **Skippo (ex Gule Sider På Sjøen)** | Kart/navigasjon, vind på kartet, havneguide | Gratis | Ingen | Sterk lokalt: offisielle Kartverket-kart; men ingen værruting |
| **SailRouting** | Server-side ruting, enkel | Premium-abo | **Sammenligner avgangstider + modeller side om side** | Enkeltpassasjer ≤ 500 nm, ikke skjærgård |
| **Expedition** (racing, desktop) | Proff navigasjon | Høy | **Ekte ensemble-ruting** (alle GRIB-modeller + polar-/vindvariasjon samtidig) | Proff/racing, ikke fritidsapp |

Akademisk forskning (Hinnenthal & Clauss 2010; JMSE 2021/2025/2026-artikler om forecast uncertainty i ship routing) bekrefter at ensemble-/risikobevisst ruteoptimalisering er aktivt felt — men ikke bygget inn i noen forbrukerapp.

## Tillegg 2026-08-30: norske apper fra Båtens Verden

Magnus avkreftet seilo.no og pekte på Båtens Verdens favorittapp-liste
(https://b-v.no/artikkel/noen-av-vare-favorittapper-til-batturen). Ingen av
appene er ruting-/robusthetskonkurrenter, men tre er relevante:

- **KystVær** (Kystverket, gratis): sanntidsmålinger fra kystværstasjoner —
  relevant datakilde-idé for målt-vs-prognose (F5.2); MET Frost API gir
  samme observasjoner programmatisk. Kandidat for senere fase.
- **Båtfart** (Kystverket, gratis): fartsgrensesoner på sjøen — Kystverkets
  fartsgrense-data er et mulig senere kartlag (5 kn-soner treffer også
  seilbåt under motor i trange farvann). Backlog, ikke v2.0-krav.
- **Havneguiden** (norsk, kommersiell): bekrefter behovet bak F4.6, men
  personlig havnebok forblir v2.0-løsningen (lisens + personlig verdi).
- Øvrige (Skippo, Windy, MarineTraffic, MooringoBreeze) allerede dekket
  eller utenfor scope (AIS).
- Orca er norsk (bekreftet av Magnus), sannsynligvis hardware-knyttet
  forretningsmodell.

## Det vi ikke fant ut

- ~~Om **seilo.no** eksisterer~~ — avkreftet av Magnus 2026-08-30.
- Navionics-restriksjonens eksakte ordlyd (navionics.com ga HTTP 530; funn fra søkeresultat).
- Nøyaktig SailGrib/SailRouting-prising.
- Om Avalons «65 modeller» innebærer spredningsvisning (trolig ikke).
- Hvordan noen app håndterer Saltstraumen-type strøm utover stasjonsinterpolasjon (ingen kilde beskrev dette).

## Konsekvens for prosjektet — funksjonshull v2 kan fylle

1. **Robusthetsvurdering av ruter mangler i forbrukerappene.** «Denne ruten er robust — modellene/medlemmene er enige» vs. «denne er skjør — halvparten sier kryss, halvparten rom vind» for gitt avgang/etappe, presentert enkelt for fritidsseiler. Reelt uutforsket territorium — ikke «PredictWind billigere».
2. **Skandinavisk dybdedata-transparens.** Vise Kartverkets kvalitetsmetadata («her er dybdedata tynne/gamle — vær forsiktig») som ingen konkurrent tilbyr.
3. Sekundært: **trange skjærgårds-/fjordstrømmer** modellert via NorKyst-800-klasse data i stedet for generisk interpolasjon.

Anbefaling: egen spec/ADR som definerer presist hva «robusthetsscore» betyr for etappe/avgangsvindu (spredning i ankomsttid, kryssandel, maks vind/bølge på tvers av ensemble-medlemmer/modeller).

## Kilder

- savvy navvy: https://www.savvy-navvy.com/sailing-navigation-app · https://www.practical-sailor.com/marine-electronics/navigation-app-review-savvy-navvy/
- Orca: https://getorca.com/ · https://www.yacht.de/en/sailing-knowledge/navigation/navigation-orca-navi-app-revises-weather-forecast-model-selection-and-animated-display-even-in-the-free-version/
- Navionics: https://www.garmin.com/en-US/garmin-technology/marine-technology/charts-and-maps/navionics-boating-app/ · https://twoatsea.com/navionics-sonarchart-problem/
- PredictWind: https://www.predictwind.com/features/weather-routing · https://help.predictwind.com/en/articles/4685424-models-used-in-weather-routing-including-ensemble-data · https://www.predictwind.com/features/departure-planning
- Windy/WindHub: https://windy.app/guide/guide-windhub.html
- qtVlm: https://www.meltemus.com/index.php/en/
- OpenCPN: https://opencpn.org/OpenCPN/plugins/weatherroute.html
- SailGrib WR: https://www.sailgrib.com/
- Avalon: https://www.avalon-routing.com/en/ · https://marine.copernicus.eu/services/use-cases/easy-and-complete-weather-routing-and-navigation-application-tablet
- TZ iBoat: https://mytimezero.com/tz-iboat
- NV Charts: https://eu.nvcharts.com/digital-charts/nv-charts-app/
- Skippo: https://www.skippo.no/plan · https://www.batmagasinet.no/gule-sider-med-ny-sjkart-app/110256
- Expedition ensemble routing: https://expedition.boardhost.com/viewtopic.php?id=714
- Kartverket datakvalitet: https://www.kartverket.no/om-kartverket/nyheter/til-sjos/2026/april/dybdedata-og-datakvalitet-i-norske-sjokart
- Akademisk: https://doi.org/10.1080/17445300903210988 · https://doi.org/10.3390/jmse9121434 · https://doi.org/10.3390/jmse14020118
