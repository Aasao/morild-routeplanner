# Kartverket — Sjøkart – Maritim infrastruktur

- Brukes til: farbarhetsmaskens luftspenn-lag (bruer, kraftspenn,
  fortøyningskabler) — F1.4, spec `docs/specs/farbarhetsmaske.md` §3.5
- Status: **DELVIS UBEKREFTET** — se «Gjenstår» nederst. Ikke ta dette
  laget i bruk i kode før datum-spørsmålet er avklart (§8, punkt 1 i
  spec-en) — feil vannstandsreferanse på oppgitt klaring er en direkte
  mastehøyde-sikkerhetsfeil.

## Kilde

- Kartkatalog: https://kartkatalog.geonorge.no/metadata/a894ea02-d2dc-4550-ac3e-49230ceed42a
- Omtale: https://www.geonorge.no/aktuelt/Se-siste-nyheter/sjokart---maritim-infrastruktur/
- Produsent: Kartverket

## Innhold

Høyoppløselig kartinformasjon om bl.a. ledningsdata, vrak, hindringer,
flytedokker, ankringsområder og dumpefelt i norske hav- og kystområder.
Inkluderer **klaringshøyder for bruer, luftspenn og fortøyningskabler på
blåskjellanlegg** — nøyaktig det laget farbarhetsmaskens seilingshøyde-
regel (F1.4) trenger.

Tilbys ifølge omtalesiden også som WMS og WFS, men eksakt tjeneste-URL ble
ikke hentet ut ved automatisert henting (siden er JavaScript-rendret).

## Datum for oppgitt klaring — UBEKREFTET, HØY PRIORITET

Hvilken vannstandsreferanse (sjøkartnull? middels høyvann? middels
høyvann springflo?) klaringshøyden er oppgitt mot, er **ikke bekreftet**.
Dette skal avklares før laget brukes til noe annet enn manuell
kryssjekking mot faktiske sjøkartsymboler. Se
`docs/specs/farbarhetsmaske.md` §8, punkt 1.

## Lisens og vilkår

Antatt CC BY 4.0 i tråd med Kartverkets generelle åpne data-praksis, men
**ikke bekreftet for dette spesifikke datasettet** — kartkatalogsiden ga
ikke ut lisensfelt ved automatisert henting. Attribusjon foreløpig antatt
«© Kartverket», samme som øvrige Kartverket-lag, men skal bekreftes.

## Attribusjonskrav i UI

Som `kartverket-sjokart-dybdedata.md` — «© Kartverket» — forutsatt lisensen
bekreftes lik.

## Gjenstår / uverifisert

1. **Datum for klaringshøyde** (sikkerhetskritisk, se over).
2. Eksakt WFS/WMS-tjeneste-URL (kun kartkatalog-lenke verifisert, ikke
   selve endepunktet).
3. Lisenstekst for dette spesifikke datasettet.

Dette laget skal **ikke** bygges inn i `tools/chart-pack` før punkt 1 er
avklart med Magnus, uavhengig av om punkt 2/3 løses raskere.
