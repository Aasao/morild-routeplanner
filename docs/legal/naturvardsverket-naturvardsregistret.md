# Naturvårdsverket / Länsstyrelserna (Sverige) — Naturvårdsregistret

- Brukes til: vernesone-laget for Bohuslän — sesongbaserte fugle-/
  sälskyddsområden, F1.6, spec `docs/specs/farbarhetsmaske.md` §3.5
- Status: tjeneste-URL-er verifisert; **lisens EKSPLISITT UKJENT** i
  kildens egne metadata («Villkor okända») — se «Gjenstår»

## Kilde

- WMS: `https://geodata.naturvardsverket.se/naturvardsregistret/wms?`
- WFS: `https://geodata.naturvardsregistret.se/naturvardsregistret/wfs?`
- REST API: `https://geodata.naturvardsverket.se/naturvardsregistret/rest/v3`
- Metadata: https://ext-geodatakatalog-forv.lansstyrelsen.se/PlaneringsKatalogen/GetMetaDataById?id=50FE77C1-43A0-445A-B56C-6B729E21DC67_C
- Tjenesten oppdateres hver natt («Tjänsten uppdateras varje natt»)

## Innhold

Djur- och växtskyddsområden (dyre- og plantevernområder) — inkluderer
fugleskyddsområder og sälskyddsområder med **tidsbegrensede
ferdselsforbud** (sesong, typisk hekke-/kastetid). For Västra Götaland
(Bohuslän) er det registrert 380 områder med ferdselsforbud, hvorav de
fleste er fugleskyddsområder, samt et antall sälskyddsområder — i hovedsak
langs Bohuslän-kysten (jf. Länsstyrelsen Västra Götalands egen omtale).

**Uverifisert i denne omgangen:** om sesongdato-feltene (start/slutt for
ferdselsforbud) er en direkte attributt i WFS/REST-svaret, eller om de kun
finnes i et separat PDF-dokument per fylke. Dette avgjør om §3.5s
`gyldigFra`/`gyldigTil`-felt kan hentes maskinelt eller må legges inn
manuelt per sone ved pipeline-bygging.

## Lisens og vilkår

**Kildens egne metadata oppgir «Villkor okänt» (vilkår ukjent)** for denne
spesifikke tjenesteregistreringen. Dette er ikke godt nok grunnlag til å
publisere avledet data videre uten videre avklaring. Svenske myndigheters
geodata er ofte under en åpen lisens i praksis, men **dette skal bekreftes
skriftlig (e-post til Naturvårdsverket eller aktuell Länsstyrelse) før
`tools/chart-pack` tar i bruk dette laget i en publisert pakke**.

## Attribusjonskrav i UI

Ikke fastsatt før lisens er bekreftet. Foreløpig forslag: «© Naturvårdsverket
/ Länsstyrelsen Västra Götaland» — bekreft eksakt ordlyd sammen med
lisensavklaringen.

## Rate limits

Ikke dokumentert. Lav risiko gitt sjelden byggekadens (spec §4).

## Gjenstår / uverifisert — MÅ AVKLARES FØR BRUK

1. **Lisens/vilkår** — kildens egen metadata sier eksplisitt «ukjent».
   Dette er det klareste eksempelet i hele kildelisten på et sted
   `CLAUDE.md`s prinsipp 5 («Datakilders lisens og vilkår dokumenteres …
   FØR de tas i bruk») direkte forhindrer bruk før avklaring.
2. Om sesongdato-attributter er maskinlesbare eller krever manuell
   innlegging per sone.
3. Attribusjonsordlyd.
