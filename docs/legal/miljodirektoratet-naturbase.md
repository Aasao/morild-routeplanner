# Miljødirektoratet — Naturbase (norske verneområder)

- Brukes til: eventuelle norske kystnære vernesoner (f.eks. Ytre
  Hvaler nasjonalpark-området) som supplement til det svenske
  Bohuslän-laget — F1.6, spec `docs/specs/farbarhetsmaske.md` §3.5
- Status: datasettets eksistens og generelle lisens verifisert;
  **API-tilgangen krever trolig forhåndsavtale** — ikke klar til bruk

## Kilde

- Naturbase felles API: https://felles.naturbase.no/
- API-dokumentasjon: https://felles.naturbase.no/Help
- Kartkatalog (Naturvernområder-produktark):
  https://register.geonorge.no/data/documents/Produktark_naturvernomrade_v1_naturvernomrader_.pdf
- Kartkatalog-oppføring: https://kartkatalog.miljodirektoratet.no/mapservice

## Innhold

Offisiell oversikt over verneområder (naturreservater, nasjonalparker,
landskapsvernområder m.m.). Format: SOSI, FGDB, GeoJSON.

## Lisens

Naturvernområder-datasettet er lisensiert **NLOD 2.0** (Norsk lisens for
offentlige data), jf. produktarket. NLOD 2.0 er sammenlignbar med CC BY —
navngivelse kreves, ingen ytterligere restriksjoner på viderebruk.

## API-tilgang — viktig forbehold

Naturbase felles API sin dokumentasjon oppgir at **all bruk av API-et skal
avtales med Miljødataseksjonen på forhånd**. Dette er ikke en ren
lisensbetingelse på selve dataene (NLOD 2.0 tillater fri bruk), men en
driftsmessig føring for selve API-tilgangen — trolig for kapasitetsstyring.
`tools/chart-pack` skal **ikke** sette opp automatisert henting mot dette
API-et før en slik avtale/e-postavklaring er gjort, jf. samme prinsipp som
Kartverket-WMTS-cachingen i `docs/01-prosjektplan.md`s risikotabell.

## Attribusjonskrav i UI

«© Miljødirektoratet» (NLOD 2.0-navngivelseskrav) — gjelder først når
laget faktisk tas i bruk.

## Rate limits

Ikke dokumentert utover forhåndsavtale-kravet over.

## Gjenstår / uverifisert

1. **Avtale/avklaring med Miljødataseksjonen** før noen automatisert
   henting — dette er en prosess, ikke bare et dokumentasjonspunkt, og bør
   avklares med Magnus som et eget steg (se
   `docs/specs/farbarhetsmaske.md` §8, punkt 4: skal dette gjøres nå eller
   utsettes til svenske Bohuslän-soner er på plass?).
2. Om norske kystnære verneområder (Ytre Hvaler m.fl.) har samme type
   sesongbaserte ferdselsforbudsdata som de svenske sälskydds-/
   fågelskyddsområdene, eller om de er permanente vernesoner uten
   sesongvariasjon (i så fall enklere å modellere — ingen
   `gyldigFra`/`gyldigTil` nødvendig for disse spesifikt).
