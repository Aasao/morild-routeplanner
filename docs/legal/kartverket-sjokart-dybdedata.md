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

## Gjenstår / uverifisert

- Eksakt lisenstekst for **dette spesifikke datasettet** (kartkatalogsiden
  er JS-rendret og ga ikke ut lisensfeltet ved automatisert henting under
  research-arbeidet) — bør bekreftes manuelt av Magnus eller ved en direkte
  API-kall mot Geonorge-registerets metadata-endepunkt før produksjonsbruk.
- Om datakvalitets-laget finnes som vektor (ikke bare WMS-raster) — se
  `docs/specs/farbarhetsmaske.md` §8, punkt 2.
