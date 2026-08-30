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

## Gjenstår / uverifisert

- Eksakt lisenstekst og attribusjonsordlyd fra Kystverket direkte.
- Om `TSS områder`-laget bærer lane-akseretning som eget attributt, eller
  om aksen må avledes geometrisk fra polygonets lengderetning i pipelinen
  (§4 steg 4/5) — avklares i fase 1-implementasjon, ikke kritisk for denne
  spec-en.
