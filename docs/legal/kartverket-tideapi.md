# Kartverket — Tidevanns-/vannstands-API (vannstand.kartverket.no)

- Brukes til: tidevanns- og vannstandsprognoser i værpakken (F2.1
  kildestack: «Kartverket tideapi + vannstand»), punkt-/områdeoppslag
  proxyet av `apps/worker` (samme proxy-mønster som MET-punktoppslag, jf.
  `docs/specs/vaerpakker.md` §14).
- Status: **verifisert** for lisens/attribusjon/generelle vilkår (hentet
  fra offisielle sider 2026-09-03). **Ikke** verifisert: eksakt XML-
  responsskjema og feltnavn (bare parameterlisten er hentet, ikke et
  fullstendig eksempeloppslag) — bør gjøres når `apps/worker`-proxyen
  faktisk skrives.

## Kilde

- API-dokumentasjon (norsk): `https://vannstand.kartverket.no/tideapi_no.html`
- API-dokumentasjon (engelsk): `https://vannstand.kartverket.no/tideapi_en.html`
- Protokollbeskrivelse (PDF): `https://vannstand.kartverket.no/tideapi_protocol.pdf`
- Enklere variant: `https://vannstand.kartverket.no/tidepos_no.html`
- Oversiktsside: `https://www.kartverket.no/en/api-and-data/tidal-and-water-level-data`
- **Historisk, avviklet:** `api.sehavniva.no` — erstattet av
  `vannstand.kartverket.no`. Ikke bruk den gamle domenenavnet i ny kode.

## Innhold / parametre

Punktoppslag mot lat/lon, med:

- **Tidsintervall:** fra-/til-tidspunkt
- **Datatype:** observasjon, prediksjon (astronomisk), flo/fjære
  (høy/lav-tabell), eller alle
- **Referansenivå (`refcode`):** sjøkartnull, middelvann, eller NN2000 —
  **valg av referansenivå er sikkerhetsrelevant** hvis vannstand noen gang
  kombineres med dybdedata i farbarhetsmasken (jf. CLAUDE.md prinsipp 2);
  denne filen dekker kun API-vilkårene, ikke hvilket refcode ruteren skal
  velge — det avgjøres i `docs/specs/farbarhetsmaske.md`/rutemotor-spec,
  ikke her.
- **Intervall:** 10 eller 60 minutter
- **Returformat:** XML, PDF eller tekst
- **Språk:** nynorsk, bokmål, engelsk
- **Tidssone:** UTC, UTC+1, med/uten sommertid

## Lisens og vilkår

**Creative Commons Attribution 4.0 International (CC BY 4.0)** —
bekreftet både på `tideapi_no.html`/`tideapi_en.html` og på Kartverkets
oversiktsside (hentet 2026-09-03). Attribusjonsplikt: **kreditere
Kartverkets sjødivisjon (den norske hydrografiske tjeneste)** ved bruk av
dataene. Generelle Kartverket-vilkår (`kartverket.no/api-og-data/
vilkar-for-bruk`, hentet 2026-09-03) gjelder i tillegg: data distribueres
«som de er», ingen ansvar for bruk/gjenbruk, og standard
attribusjonsformat for Kartverkets gratisprodukter er **«© Kartverket»**
med lenke der praktisk mulig.

**Ingen registrering kreves** — APIet er åpent og kostnadsfritt for alle
(bekreftet på oversiktssiden).

## Attribusjonskrav i UI

**«© Kartverket»** (samme mønster som `kartverket-sjokart-raster-wmts.md`
og de øvrige Kartverket-filene i denne mappen), synlig der
tidevanns-/vannstandsdata vises eller inngår i en rutebeslutning.
Kartverkets sjødivisjon/hydrografiske tjeneste kan nevnes eksplisitt hvis
attribusjonspanelet skiller mellom Kartverkets ulike avdelinger —
foreløpig antatt unødvendig, samme «© Kartverket» holder i tråd med
resten av attribusjonspanelet.

## Rate limits / caching

- Dokumentert kapasitet: **«bortimot 20 spørjingar i sekundet»**, delt
  ressurs med alle andre brukere av tjenesten (`tideapi_no.html`, hentet
  2026-09-03) — samme størrelsesorden som api.met.nos 20 req/s, men
  **udelt mellom applikasjoner** snarere enn «per applikasjon» slik
  MET-vilkåret er formulert. Tolkning: vær like forsiktig som mot
  api.met.no, ikke mer aggressiv bare fordi ordlyden er svakere.
- Anbefaling fra Kartverket selv: **lagre statiske data lokalt, minimer
  antall spørringer** — samme caching-disiplin som `met-norway-api.md`
  krever, selv om Kartverket ikke stiller et eksplisitt
  If-Modified-Since-krav i dokumentasjonen.
- **Driftsmerknad (ikke et vilkår, men operasjonelt relevant):**
  dokumentasjonen advarer selv om at «APIet ikke er helt stabilt — det kan
  oppstå responspauser på flere minutter». `apps/worker`s proxy skal derfor
  ha samme backoff-/degraderingslogikk som mot MET (§16 i
  `docs/specs/vaerpakker.md`), ikke anta at manglende svar er en
  forbigående nettverksfeil som løses av umiddelbar retry.
- **Ingen eksplisitt User-Agent-plikt dokumentert** for tideapi (til
  forskjell fra api.met.no) — prosjektets policy er likevel å sende samme
  identifiserende UA (`morild-routeplanner/<versjon> maasao@gmail.com`)
  konsekvent mot alle tredjeparts-API-er, jf. `met-norway-api.md`.

## Gjenstår / uverifisert

1. **Fullstendig XML-responsskjema** — kun parameterlisten er hentet, ikke
   et faktisk eksempeloppslag med feltnavn. Bør gjøres når
   `apps/worker`s tidevanns-proxy skrives (samme mønster som
   MET-punktoppslag).
2. **Eksakt attribusjonsformulering for hydrografisk sjødata** — er
   «© Kartverket» tilstrekkelig, eller ønsker sjødivisjonen en egen
   kredittlinje («Den norske hydrografiske tjeneste» e.l.)? Sidene som
   ble hentet nevner «Norwegian Mapping Authority's Hydrographic
   Service» som den som skal krediteres, uten å gi en eksakt norsk
   standardfrase — «© Kartverket» er valgt her som konsistent med resten
   av attribusjonspanelet, men bør dobbeltsjekkes mot
   `kundesenter@kartverket.no` før lansering hvis Magnus vil ha presis
   ordlyd.
3. **Om vilkårssiden (`kartverket-og-data/vilkar-for-bruk`) inneholder
   en tideapi-spesifikk klausul utover de generelle Kartverket-vilkårene**
   — kun de generelle vilkårene ble hentet og oppsummert; siden er lang og
   dekker mange produkter, ikke lest i sin helhet.
4. **Rate-grensens faktiske håndhevingsmekanisme** (kastes 429? stille
   throttling? forbindelsesavbrudd?) — ikke dokumentert eller testet.
