# Kystverket — WFS (farled, TSS, havner)

- Brukes til: farbarhetsmaskens farled-/tillitsløft-lag og TSS-lag —
  F1.5, spec `docs/specs/farbarhetsmaske.md` §3.5
- Status: tjeneste-URL og lagnavn verifisert via WFS `GetCapabilities`;
  lisenstekst ikke hentet direkte

## Kilde

- WFS: `https://services.kystverket.no/wfs.ashx?service=WFS&request=GetCapabilities`
- Produsent: Kystverket

## Relevante lag (verifisert via GetCapabilities)

| Lag | Bruk i masken |
|---|---|
| `GJELDENDE-Hovedled og biled` (layer_552) | Farled-polygon → tillitsløft (§3.4 steg 4) |
| `GJELDENDE-Farledsareal` (layer_554) | Definert farledsareal |
| `Toveisfarled` (layer_104) | Smale topunkts farleder |
| `TSS områder` (layer_706) | TSS-geometri, F1.5 |
| `Anbefalte ruter 2021` (layer_702) | IMO-anbefalte ruter mellom TSS |
| `Anbefalt rute punkt` (layer_704) | Rutepunkter |
| `Nødhavner` (layer_26) | Relevant for F4.6 bail-out, ikke denne spec-en direkte, men samme kilde |

GML 3.1.1-format, flere koordinatsystemer støttet.

## Lisens og vilkår

Kystverkets WFS-tjeneste er beskrevet som fritt tilgjengelig
(«brukes aktivt internt i Kystverkets eget plan- og utredningsarbeid, og av
eksterne brukere») og inkluderer Kystverkets DOK-data (Det offentlige
kartgrunnlag) — DOK-data er som norm åpne data under CC BY 4.0/NLOD.
**Eksakt lisenstekst er ikke hentet direkte fra Kystverket i denne
omgangen** — bekreft før produksjonsbruk.

## Attribusjonskrav i UI

Foreløpig antatt «© Kystverket» for farled-/TSS-lag i kartvisning og i
tillitsnivå-forklaringer i UI — bekreft ordlyd sammen med lisensteksten.

## Rate limits

Ikke dokumentert. Batch-jobben (`tools/chart-pack`) henter sjelden (se
spec §4, kadensevalg) — lav risiko for å treffe en eventuell grense.

## Fase 1-bygging (2026-08-30/31): praktiske funn om `layer_552`/`layer_554`

- Tjenesten svarer kun på WFS 1.0.0/1.1.0 (ikke 2.0.0).
- `bbox`-parameteren virker i **lon,lat**-rekkefølge — motsatt av Kartverkets
  wfs.dybdedata (se `docs/legal/kartverket-sjokart-dybdedata.md` og
  `tools/chart-pack/testdata/raw/METADATA.md`).
- WFS-en klipper IKKE returnerte features til spørrings-bboksen: hele
  featuren returneres så snart en hvilken som helst del av den overlapper
  bboksen. For `Farledsareal` (layer_554) ga dette én polygon som strakte
  seg over store deler av Oslofjorden — håndtert med et eget etterfølgende
  flisfilter i `tools/chart-pack/src/build.ts`, ikke løst av selve WFS-en.
- `GJELDENDE-Hovedled og biled` (layer_552) er en **senterlinje**
  (`gml:LineString`), ikke et areal — det faktiske tillitsløft-arealet for
  §3.4 steg 4 må hentes fra `GJELDENDE-Farledsareal` (layer_554, faktisk
  `gml:Polygon`/`MultiSurface`). Denne bølgens pipeline bruker kun
  layer_554 som tillitsløft; layer_552 er kun parset som kontekst, ikke
  brukt til geometri i pakken ennå.

## Gjenstår / uverifisert

- Eksakt lisenstekst og attribusjonsordlyd fra Kystverket direkte.
- Om `TSS områder`-laget bærer lane-akseretning som eget attributt, eller
  om aksen må avledes geometrisk fra polygonets lengderetning i pipelinen
  (§4 steg 4/5) — IKKE avklart i denne bølgen (TSS-laget ble ikke hentet,
  kun `TssLane`-typen og oppslagsregelen ble implementert mot syntetiske
  tester — se `packages/charts/TODO.md` og `tools/chart-pack/README.md`).
