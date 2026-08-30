# EMODnet Bathymetry

- Brukes til: fallback/kontekstlag utenfor norsk/dansk detaljdekning,
  særlig svenske farvann der Sjöfartsverkets dybdedata ikke er åpne —
  F1.7, spec `docs/specs/farbarhetsmaske.md` §3.7. **Erstatter aldri**
  Kartverkets vektordata der den finnes.
- Status: verifisert (kartdata-research), lisens hentet fra offisiell kilde

## Kilde

- https://emodnet.ec.europa.eu/en/bathymetry
- Produkt: EMODnet DTM 2024
- Produsent: EMODnet (EU-finansiert, flernasjonalt samarbeid)

## Innhold

~115 m basisoppløsning, finere i enkelte kystfliser. Ujevn kvalitet, ikke
garantert per fjordarm — for grovt for sund/enkeltskjær i skjærgård.

## Datum

Ikke et sjøkartnull-referert produkt i vanlig forstand — behandles som
`datum: "ukjent"` i `docs/specs/farbarhetsmaske.md` §3.3, med samme
`trygt`-forbud som DDM og andre ikke-K0-kilder.

## Lisens og vilkår

**CC BY 4.0.** Attribusjon: «EMODnet Bathymetry Consortium» (bekreft
eksakt navngivelsesstreng i EMODnet Bathymetry sine egne bruksvilkår før
publisering — flagget under «Gjenstår»).

## Attribusjonskrav i UI

«EMODnet Bathymetry» skal vises der laget bidrar til visning eller
tillitsnivåberegning i svenske/utenfor-Norge-områder.

## Rate limits

Ikke dokumentert i research-grunnlaget. Lav risiko gitt sjelden
byggekadens.

## Gjenstår / uverifisert

- Eksakt navngivelsesstreng EMODnet selv krever i attribusjon (vanlig
  praksis er «EMODnet Bathymetry Consortium (2024): EMODnet Digital
  Bathymetry (DTM 2024)» — bekreft mot EMODnets egne retningslinjer før
  bruk i UI).
