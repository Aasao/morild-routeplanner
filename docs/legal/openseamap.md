# OpenSeaMap / OSM seamarks

- Brukes til: supplerende visningslag (bøyer, lys, vrak) og eventuell
  svak farled-bias i områder der Kystverket-ekvivalent mangler (svensk
  skjærgård) — **aldri primærkilde for farbarhet**, jf.
  `docs/research/kartdata-skandinavia.md` §3 og
  `docs/specs/farbarhetsmaske.md` §8, punkt 9
- Status: verifisert (kartdata-research), fair-use for tile-henting
  ikke re-sjekket i denne omgangen

## Kilde

- Tiles: `t1/t2.openseamap.org`
- Data: `seamark:*`-tagging i OpenStreetMap
- https://map.openseamap.org/ · https://wiki.openstreetmap.org/wiki/OpenSeaMap

## Innhold

Bøyer, lys (med attributter), vrak, enkelte dybder. Kvalitet varierer med
frivillig-aktivitet — **ingen kvalitetsgaranti**.

## Lisens og vilkår

OpenStreetMap-avledet data er lisensiert **ODbL** (Open Database License).
Attribusjon: **«© OpenStreetMap contributors»** (standard OSM-attribusjon,
gjelder også seamark-avledet data). Share-alike-klausulen i ODbL er
relevant hvis avledede databaser publiseres — ren visning (tiles/overlay)
utløser normalt kun attribusjonskravet, ikke share-alike, men dette bør
bekreftes hvis `tools/chart-pack` noen gang trekker seamark-data inn i den
publiserte farled-bias-vurderingen (ikke bare visning).

## Attribusjonskrav i UI

«© OpenStreetMap contributors» der OpenSeaMap-laget vises, i tillegg til
en eventuell «OpenSeaMap»-kreditering for selve sjømerke-stilen/-tjenesten.

## Rate limits / fair-use

Research-rapporten flagger eksplisitt: **«sjekk fair-use; vurder egen
henting fra OSM-ekstrakt»** for `t1/t2.openseamap.org`-flisene — dette er
en gratis, frivillig-drevet tjeneste uten kjent SLA. **Ikke re-verifisert
i denne omgangen.** Anbefaling: enten (a) les OpenSeaMaps offisielle
fair-use-retningslinjer før appen gjør direkte tile-kall i produksjon, eller
(b) hent et periodisk OSM-ekstrakt (Geofabrik e.l.) og bygg egne fliser —
sistnevnte unngår avhengighet av en tredjeparts gratistjeneste for en
kommersielt viktig funksjon, i tråd med hvordan Kartverket-vektordata
allerede bygges til egne PMTiles.

## Gjenstår / uverifisert

- OpenSeaMaps fair-use-vilkår for direkte tile-henting (t1/t2-serverne) —
  må sjekkes før `apps/pwa` gjør direkte kall i produksjon.
- Om seamark-avledet farled-informasjon i svensk skjærgård har god nok
  dekning til å faktisk gi farled-bias (§8, punkt 9 i spec-en) — kvalitet
  er ikke garantert per definisjon av kilden.
