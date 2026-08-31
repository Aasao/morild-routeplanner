# Kartverket — Sjøkart – Dybdedata

- Brukes til: farbarhetsmaskens dybdebånd, tørrfall, grunne, skjær (spec:
  `docs/specs/farbarhetsmaske.md` §3.4, §4 steg 1)
- Status: verifisert (kartkatalog + Geonorge-registeret), lisens ikke
  hentet som juridisk tekst i denne omgangen — se «Gjenstår» nederst

## Kilde

- Datasett: «Sjøkart – Dybdedata», Geonorge UUID
  `2751aacf-5472-4850-a208-3532a51c529a`
- Kartkatalog: https://kartkatalog.geonorge.no/metadata/uuid/2751aacf-5472-4850-a208-3532a51c529a
- Produsent: Kartverkets maritime primærdatabase

## Innhold

Dybdepunkt, dybdekurver (2, 5, 10, 15, 20, 30, 40, 50, 100, 150 m …),
tørrfall/-grense, grunne, skjær. **Gradert til minimum 50 m mellom
dybdepunkter** (skjermingsregime) — finere data er bestillingsvare, ikke
åpen API.

## Datum

Dybder mot sjøkartnull (K0). Kystlinje/tørrfall/skjær mot middels
høyvann (MHW). **Ulikt datum innad i samme kilde** — se
`docs/specs/farbarhetsmaske.md` §3.3. Dette er ikke bare en juridisk
detalj, men en sikkerhetskritisk modelleringsdetalj.

## Tjenester

- WFS: `https://wfs.geonorge.no/skwms1/wfs.dybdedata`
- WMS datakvalitet: `https://wms.geonorge.no/skwms1/wms.sjokart_datakvalitet`
- OGC API Features (GeoJSON): `https://hybasapi.atgcp1-prod.kartverket.cloud/`
- Nedlasting: GML/SOSI/GDB via Atom-feed

## Lisens og vilkår

Kartverkets åpne data er generelt lisensiert **CC BY 4.0** (norsk
standardpraksis for offentlige geodata siden 2013, jf.
https://www.kartverket.no/en/api-and-data/terms-of-use). Attribusjon:
**«© Kartverket»**.

**Rate limits:** ikke dokumentert eksplisitt i research-grunnlaget — ingen
kjent hard grense for WFS/OGC API-bruk, men batch-jobben (`tools/chart-pack`)
bør bruke en identifiserende User-Agent og unngå unødig gjentatt
fullnedlasting (kystlinje endres sakte — se spec §4 om kadensevalg).

## Attribusjonskrav i UI

«© Kartverket» skal vises der kartdata fra dette datasettet ligger til
grunn for visning eller rutebeslutning (kartvisning + evt. metadatapanel
for tillitsnivå). Følger F1.8s attribusjonskrav.

## Fase 1-bygging (2026-08-30/31): datakvalitetslaget er bekreftet vektor+CATZOC

Under bygging av `tools/chart-pack` mot et ekte uttrekk for Hvaler-området
(bbox 59,05–59,30° N, 10,60–11,00° Ø) ble WFS-laget `app:Datakvalitet`
faktisk hentet og parset: det er et ordinært GML-polygonlag, IKKE bare
WMS-raster, med et attributt `catzoc` (S-57 CATZOC-aktig kvalitetsklasse).
Observerte verdier i testområdet: `A1`, `A2`, `B`, `C` (112 soner totalt).
Dette besvarer `docs/specs/farbarhetsmaske.md` §8 punkt 2 til fordel for den
fullt spesifiserte varianten av §3.4 steg 4 (ingen fallback til
"kun farled" nødvendig). Se `tools/chart-pack/testdata/raw/METADATA.md` for
spørringsdetaljer og `packages/charts/src/pack-format.ts` (`CatzocClass`)
for hvordan dette brukes i oppslaget.

Samtidig ble en praktisk WFS-kvirk oppdaget: `bbox`-filteret på denne
tjenesten svarer stille (200 OK, men feil/tomt resultat, ingen feilmelding)
med mindre CRS skrives nøyaktig `urn:ogc:def:crs:EPSG::4326` og koordinatene
oppgis i lat,lon-rekkefølge — se METADATA.md for full oppskrift til neste
agent som skal hente mer data herfra.

## Gjenstår / uverifisert

- Eksakt lisenstekst for **dette spesifikke datasettet** (kartkatalogsiden
  er JS-rendret og ga ikke ut lisensfeltet ved automatisert henting under
  research-arbeidet) — bør bekreftes manuelt av Magnus eller ved en direkte
  API-kall mot Geonorge-registerets metadata-endepunkt før produksjonsbruk.
- Datum og eksakt tolkning av `førsteDatafangstdato` vs. `oppdateringsdato`
  vs. `datauttaksdato` for pakkens `vintage`-felt — denne bølgen brukte
  uttaksdatoen som en konservativ forenkling (se `tools/chart-pack/README.md`).
