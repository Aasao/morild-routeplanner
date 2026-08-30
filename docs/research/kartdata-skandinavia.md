# Sjøkart- og dybdedata for Skandinavia — maskinell tolkning for trygg ruting

- Dato: 2026-08-30. Grunnlag for farbarhetsmaske-spec og ADR om kartdatakilder.

## 1. Norge / Kartverket

### Raster sjøkart (visning)
- **WMTS**: `https://cache.kartverket.no/v1/service?service=WMTS&request=GetCapabilities` — sjøkartraster (overseilings-, hoved-, kyst-, havnekart). EPSG:25832/33/35 + 3857 (Web Mercator).
- **Lisens**: CC BY 4.0 («© Kartverket»). Gammel `opencache.statkart.no` fases ut. Status: https://status.geonorge.no/cache.html
- Sjøkart raster er merket **«ikke beregnet for navigasjon»** — ansvarsfraskrivelse må videreføres i UI.

### Vektor dybdedata (det maskinlesbare laget) — NØKKELDATASETT
**«Sjøkart – Dybdedata»** (Geonorge UUID `2751aacf-5472-4850-a208-3532a51c529a`), fra Kartverkets maritime primærdatabase:

| Lag | Innhold |
|---|---|
| Dybdepunkt | Enkeltdybder, sømløst vektorisert |
| Dybdekurver | 2, 5, 10, 15, 20, 30, 40, 50, 100, 150… m; enkelte havner metervis 0–30 m |
| Tørrfall/-grense | Areal tørrlagt mellom middels høyvann og 0,5 m under sjøkartnull |
| Grunne | Grunnpolygoner/-punkter |
| Skjær | Skjærpunkter |

- Datum: dybder mot sjøkartnull (K0); kystlinje/skjær mot middels høyvann.
- **Gradert til min. 50 m mellom dybdepunkter** (skjermingsregime) — finere data finnes men er gradert/bestillingsvare.
- Lisens: CC BY 4.0.
- Tjenester: WFS `https://wfs.geonorge.no/skwms1/wfs.dybdedata` · WMS datakvalitet `https://wms.geonorge.no/skwms1/wms.sjokart_datakvalitet` · OGC API Features (GeoJSON) `https://hybasapi.atgcp1-prod.kartverket.cloud/` · nedlasting GML/SOSI/GDB via Atom-feed.
- Kartkatalog: https://kartkatalog.geonorge.no/metadata/uuid/2751aacf-5472-4850-a208-3532a51c529a
- Høyoppløselig batymetri: bestillingsprosess, ikke åpen API (https://www.kartverket.no/en/api-and-data/order-high-resolution-bathymetry).

### S-57/S-101 ENC (PRIMAR)
- Offisielle ENC-er distribueres via PRIMAR (Kartverkets sjødivisjon + Electronic Chart Centre AS) som **kommersiell B2B-avtale** med S-63-kryptering — «restricted access», ingen offentlig prisliste. Ikke en vei for v2 nå; mulig senere partnerskap.

## 2. Sverige og Danmark

- **Sverige (Sjöfartsverket): dybdedata er IKKE åpne.** Sikkerhetsgradert; hver forespørsel krever Försvarsmakten-konsultasjon, leveres mot betaling (`sma@sjofartsverket.se`). Sverige er i praksis lukket for et åpent maskinlesbart dybdelag → EMODnet/OpenSeaMap eller kommersiell avtale.
- **Danmark (Geodatastyrelsen): Danmarks Dybdemodel (DDM) v2.0** — 50×50 m raster, fritt nedlastbar (GeoTIFF, https://dataforsyningen.dk/data/4817) + WMS. Eksplisitt «ikke egnet til navigasjon» (gjennomsnittsraster). Vektor-ekvivalent til norske dybdekurver/tørrfall/skjær ikke funnet — undersøkes videre via gst.dk.

## 3. OpenSeaMap / OSM seamarks

- `seamark:*`-tagging (bøyer, lys m/attributter, vrak, enkelte dybder). Tiles: `t1/t2.openseamap.org` (sjekk fair-use; vurder egen henting fra OSM-ekstrakt).
- Kvalitet varierer med frivillig-aktivitet, ingen garanti. **Bruk: supplerende visningslag og krysssjekk — aldri primærkilde for farbarhet.**

## 4. EMODnet Bathymetry og GEBCO

| | EMODnet DTM 2024 | GEBCO |
|---|---|---|
| Oppløsning | ~115 m basis, finere i enkelte kystfliser | ~450 m |
| Lisens | CC BY 4.0 | Public domain |
| Skjærgård-egnethet | Ujevn, ikke garantert per fjordarm | For grovt for sund/enkeltskjær |

Fallback/kontekst utenfor norsk detaljdekning (særlig svenske farvann) — erstatter aldri Kartverkets vektordata.

## 5. Farbarhetsmaske — anbefalt pipeline

ECDIS-analog «safety contour»-logikk på åpne lag:

1. **Landmaske**: kystlinje (N50/FKB, middels høyvann) → basispolygon sjø/land.
2. **Trekk fra kjente hindre**: tørrfall-polygoner, skjærpunkter (buffret med posisjonsusikkerhet), grunne-polygoner.
3. **Dybdeoverflate**: interpoler dybdepunkt med dybdekurver som harde bruddlinjer (TIN/IDW med kontur-constraints).
4. **Sikkerhetskontur**: terskle ved `dypgang + sikkerhetsmargin`; velg nærmeste kartlagte kurve ≥ terskel — alt grunnere er no-go.
5. **Føre-var-regel**: punkttetthet ned til 50 m — **areal mellom sonderinger antas aldri trygt**. Kystverkets **farled/seilingsled-datasett** = «høy tillit»-lag; utenfor farled + tynn punktdekning → ukjent/potensielt grunt.
6. **Kvalitetslag**: Kartverkets datakvalitets-WMS/metadata eksponeres i UI («tynne/gamle data her»).
7. Tydelig navigasjonsdisclaimer i appen.

Autoritativt nok i Norge: Sjøkart–Dybdedata + Kystverket farled + N50/FKB-kystlinje.

## 6. Tiles/vektorkart for MapLibre

- Kartverkets vektorfliser dekker i dag **kun landtopografi** — marine vektorfliser er på roadmap, ikke levert (https://github.com/kartverket/kartverket.vectortiles).
- Anbefalt: (a) sjøkartraster-WMTS som visuelt bakteppe; (b) **bygg egne vektorfliser** fra åpne GML/SOSI-nedlastinger (dybdekurver, tørrfall, skjær, grunne) med tippecanoe → **PMTiles** — lovlig under CC BY 4.0 med attribusjon, og eneste vei til stilbart offline-vektorlag. Samme datasett gir både visning og farbarhetsmaske — én kilde, to bruk; (c) OpenSeaMap som valgfritt overlay.
- Sverige: tilsvarende lag kan ikke bygges lovlig av nasjonale data → EMODnet/OpenSeaMap.
- Danmark: DDM til dybdeskygge, ikke safety contour.

## Anbefalt datastack

| Lag | Norge | Sverige | Danmark |
|---|---|---|---|
| Visning (raster) | Kartverket sjøkartraster WMTS | EMODnet/OpenSeaMap | DDM WMS + OpenSeaMap |
| Maskinlesbar farbarhet | Sjøkart–Dybdedata + Kystverket farled (CC BY 4.0) | **Ikke åpent** — EMODnet grovt | DDM (grovt) — vektoralternativ avklares |
| Sjømerker | OpenSeaMap | OpenSeaMap | OpenSeaMap |
| Gullstandard (senere) | S-57/S-101 via PRIMAR (B2B) | Gradert | Egen ENC-produsent |

**Kjernefunn:** Norge er klart mest åpent (CC BY 4.0 helt ned til dybdekurver/tørrfall/skjær) men gradert til 50 m punkttetthet; Sverige er lukket; Danmark har grov åpen rastermodell. Kartdatalaget bygges **provider-abstrahert** (ChartSource-grensesnitt) slik at svenske/danske hull kan tettes med andre kilder eller fremtidig ENC-avtale uten arkitekturendring.

## Ubekreftet / følges opp

1. Kartverkets åpne datasett for fyr/navigasjonsinstallasjoner (utover PDF) — sjekk «Kystverket Navigasjonsinstallasjoner» på Geonorge.
2. Dansk vektor-ekvivalent til dybdekurver/tørrfall/skjær.
3. PRIMAR pris-/avtalevilkår for liten app.

## Kilder

- https://www.kartverket.no/en/api-and-data · https://www.kartverket.no/en/api-and-data/terms-of-use
- https://kartkatalog.geonorge.no/metadata/uuid/2751aacf-5472-4850-a208-3532a51c529a
- https://data.norge.no/en/datasets/946d865a-e9ac-439e-8cbf-15de7ada9a3f/sjokart-dybdedata
- https://www.primar.org/ · https://data.norge.no/en/datasets/72444236-fc92-4a20-9c12-5a665c9fb9fc/sjokart-elektroniske-enc
- https://github.com/kartverket/kartverket.vectortiles
- https://www.sjofartsverket.se/sv/tjanster/havsgranser/djupdata/
- https://gst.dk/data-og-kort/soekort-og-marine-data · https://dataforsyningen.dk/data/4817
- https://map.openseamap.org/ · https://wiki.openstreetmap.org/wiki/OpenSeaMap
- https://emodnet.ec.europa.eu/en/bathymetry · https://www.gebco.net/data-products/gridded-bathymetry-data
