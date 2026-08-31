# Rå-uttrekk — Skjæløy/Hvaler-testområde

Alle filer i denne mappen er **ekte** data hentet direkte fra kildenes WFS-er
(ikke syntetisk/generert), komprimert med gzip. Hentet 2026-08-30/31 under
fase 1-bygging av farbarhetsmasken.

## Bbox

`59.05° N, 10.60° Ø` – `59.30° N, 11.00° Ø` (oppgitt i oppdraget — dekker
Hvaler/ytre Fredrikstad-skjærgården, hjemfarvannet til Skjæløy).

## Kilder, spørringer og lisens

| Fil | Kilde | Lag | Spørring (WFS GetFeature) | Dato hentet |
|---|---|---|---|---|
| `Dybdekurve.gml.gz` | Kartverket Sjøkart–Dybdedata | `app:Dybdekurve` | `wfs.geonorge.no/skwms1/wfs.dybdedata`, WFS 2.0.0, `bbox=59.05,10.60,59.30,11.00,urn:ogc:def:crs:EPSG::4326` | 2026-08-30 |
| `Tørrfall.gml.gz` | samme | `app:Tørrfall` | samme mønster | 2026-08-30 |
| `Skjær.gml.gz` | samme | `app:Skjær` | samme mønster | 2026-08-30 |
| `Grunne.gml.gz` | samme | `app:Grunne` | samme mønster | 2026-08-30 |
| `Datakvalitet.gml.gz` | samme | `app:Datakvalitet` (CATZOC — se funn under) | samme mønster | 2026-08-30 |
| `kystverket-hovedled.gml.gz` | Kystverket WFS | `ms:layer_552` (Hovedled og biled, senterlinje) | `services.kystverket.no/wfs.ashx`, WFS 1.1.0, `bbox=10.60,59.05,11.00,59.30` (MERK: lon,lat-rekkefølge her, se "Akse-rekkefølge" under) | 2026-08-30 |
| `kystverket-farledsareal.gml.gz` | Kystverket WFS | `ms:layer_554` (Farledsareal, polygon) | samme mønster | 2026-08-30 |

Lisens/vilkår: se `docs/legal/kartverket-sjokart-dybdedata.md` og
`docs/legal/kystverket-farled-wfs.md` (skrevet før disse kildene ble brukt i
kode, jf. oppdragets krav). Attribusjon: «© Kartverket» / «© Kystverket».

## Viktig teknisk funn: akse-rekkefølge og WFS-kvirker

- **Kartverkets WFS (wfs.dybdedata)**: `bbox`-parameteren virker KUN med CRS
  skrevet som `urn:ogc:def:crs:EPSG::4326` (dobbelt kolon) og koordinater i
  **lat,lon**-rekkefølge — `bbox=<lat_min>,<lon_min>,<lat_max>,<lon_max>,urn:ogc:def:crs:EPSG::4326`.
  Både bar `EPSG:4326`-streng og lon/lat-bytte ga et (stille!) tomt/feil
  resultat uten feilmelding — dette kostet en del av spike-tiden å oppdage,
  se commit-historikk. `cql_filter=BBOX(...)` ble PRØVD og så ut til å bli
  ignorert av tjenesten (returnerte data uavhengig av bboks) — unngå.
- Selve **koordinatene i `gml:posList`/`gml:pos`** fra denne tjenesten er
  derimot alltid **lat lon** per par, uavhengig av hvilken srsName som er
  brukt i responsen — `gml.ts`s parser konverterer eksplisitt til GeoJSON
  `[lon, lat]`.
- **Kystverkets WFS (services.kystverket.no)**: kun WFS 1.0.0/1.1.0 (ikke
  2.0.0). `bbox`-parameteren virker med **lon,lat**-rekkefølge (motsatt av
  Kartverket!). Returnerte features er IKKE klippet til spørrings-bboksen —
  hele featuren returneres så snart NOEN del av den overlapper bboksen
  (`kystverket-farledsareal.gml.gz` inneholder to polygoner, hvorav ett
  strekker seg over store deler av Oslofjorden). Håndtert i
  `build.ts` (`TARGET_BBOX`-filteret) — se README.md.

## Viktig faglig funn: Datakvalitet-laget ER maskinlesbart CATZOC

Spec `docs/specs/farbarhetsmaske.md` §8 punkt 2 spurte om Kartverkets
datakvalitetslag finnes som vektor/attributt eller kun WMS-raster. **Svar:
det er et ekte WFS-vektorlag (`app:Datakvalitet`) med et `catzoc`-attributt**
(S-57 CATZOC-aktig klassifisering: `A1`, `A2`, `B`, `C` observert i
testområdet — trolig også `D`/`U` andre steder). Dette avgjør §8 punkt 2 til
fordel for den byggbare, spesifiserte varianten av §3.4 steg 4 — ingen
fallback til «kun farled» nødvendig. Se `packages/charts/src/pack-format.ts`
(`CatzocClass`) og `docs/legal/kartverket-sjokart-dybdedata.md`.

## Volum

Alle filer til sammen (gzip): ca. 2,6 MB. Godt innenfor oppdragets
< 100 MB-grense for testfixturen.
