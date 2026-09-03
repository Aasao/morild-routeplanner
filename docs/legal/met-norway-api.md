# MET Norway — api.met.no (Locationforecast, Oceanforecast, MetAlerts)

- Brukes til: ferdigprosesserte JSON-punktoppslag —
  **Locationforecast 2.0** (bakgrunnsvær), **Oceanforecast 2.0** (bølge/
  strøm/sjøtemp punktverdier, brukt som gyldig førsteleveranse for bølge
  m/periode inntil WAM800-grid er verifisert, jf.
  `docs/specs/vaerpakker.md` §18 pkt. 1) og **MetAlerts** (varselpolygoner,
  §4.5/§18 pkt. 5). Dette er **ikke** THREDDS/OPeNDAP-grid — se
  `met-norway-thredds.md` for de.
- Status: **verifisert.** Vilkår og lisens hentet direkte fra
  `api.met.no/doc/TermsOfService`, `api.met.no/doc/License` og
  `api.met.no/doc/FAQ` 2026-09-03.

## Kilde

- Locationforecast: `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=..&lon=..`
- Oceanforecast: `https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=..&lon=..`
- MetAlerts: `https://api.met.no/weatherapi/metalerts/...` (polygonvarsler)
- Dokumentasjon: `https://api.met.no/doc/` (speilet på `docs.api.met.no`)

## Vilkår (kritisk for arkitektur)

Kilde for alle punktene under: `api.met.no/doc/TermsOfService`, hentet
2026-09-03.

1. **Obligatorisk, identifiserende User-Agent.** Sitat: «all requests must
   (if possible) include an identifying User Agent-string (UA) with the
   application/domain name, optionally version number», pluss
   kontakt-e-post eller lenke. Eksempler fra dokumentasjonen:
   `"acmeweathersite.com support@acmeweathersite.com"` eller
   `"AcmeWeatherApp/0.9 github.com/acmeweatherapp"`. **Forfalsket eller
   forsøkt nettleser-imitert UA fører til permanent blokkering.**
   Prosjektets format (allerede besluttet i `docs/specs/vaerpakker.md`
   §16, brukt i THREDDS-spiken også):
   `morild-routeplanner/<versjon> maasao@gmail.com` — samme mønster i
   `tools/weather-pack` og `apps/worker`s proxy, aldri en generisk/tom
   UA-streng.
2. **Rate-grense: >20 req/s per applikasjon totalt** (aggregert over alle
   installasjoner, ikke per klient) krever spesialavtale. Brudd gir
   **429** (throttling), grovt/forsettlig brudd eller forsøk på å omgå
   rate-begrensning gir **permanent blokkering**.
3. **Caching er et krav, ikke en optimalisering.** Sitat: «Cache data
   locally and use the `If-Modified-Since` request header to avoid
   repeatedly downloading the same data», følg `Expires`-header
   (RFC 2616-mønster), og **ikke** gjør HEAD etterfulgt av GET («doubles
   the server processing load»). **`apps/worker`s proxy-rute (spec §14)
   er selve mekanismen kravet peker på**, ikke en frivillig
   implementasjonsdetalj.
4. **Forbud mot overpolling.** Sitat: unngå «repeated requests for data
   which never change». Eksplisitt for mobil: **«Applications on mobile
   devices must not retrieve new data as long as the application is not
   in use.»** — direkte relevant for `apps/pwa`s offline-synk (F1.9):
   bakgrunnspolling utover det brukeren faktisk trenger er et
   vilkårsbrudd, ikke bare unødvendig batteribruk.
5. **Koordinatpresisjon: maks 4 desimaler.** 5+ desimaler gir **403
   Forbidden**. Gjelder alle punktoppslag (Locationforecast, Oceanforecast)
   — avrund koordinater før kall bygges.
6. **Kun HTTPS over tid.** Ukryptert HTTP omdirigeres, men vedvarende bruk
   av HTTP «is not allowed over extended periods» (sikkerhetsrisiko +
   unødvendig trafikk).
7. **Gzip og redirect-støtte er obligatorisk** hos klienten.

## Lisens og attribusjon

**NLOD 2.0** (Norwegian Licence for Open Government Data) og
**Creative Commons Attribution 4.0 International (CC BY 4.0)** —
`api.met.no/doc/License`, hentet 2026-09-03. Anbefalt attribusjonstekst
fra MET selv: **«Data from MET Norway»** eller **«Based on data from MET
Norway»**, med lenke til nedlastingskilden der praktisk mulig.

**Unntak å være obs på:** værikoner (hvis appen noen gang bruker METs
offisielle ikonsett) er **MIT-lisensiert** (© 2015–2017 Yr.no), egen
lisens fra selve værdataene — relevant kun hvis `apps/pwa` importerer
METs ikonsett direkte, ikke for dataene selv.

## Attribusjonskrav i UI

Én felles kredittlinje for **alt** MET Norway-materiale i appen
(Locationforecast + Oceanforecast + MetAlerts + THREDDS-hentet MEPS/
NorKyst/WAM800, se `met-norway-thredds.md`) — samme institusjon, samme
lisens, ingen grunn til å duplisere teksten per datakilde. Foreslått
plassering: samme attribusjonspanel/-footer som Kartverket- og
OpenSeaMap-attribusjonene (jf. `kartverket-sjokart-raster-wmts.md`,
`openseamap.md`), synlig når værlaget/-anbefalingen vises.

## Rate limits / caching / backoff — designkonsekvens

- **Worker-proxy er påkrevd mønster, ikke en preferanse.** Vilkårets krav
  om at «mobilapper skal gå via egen backend/caching-proxy» er allerede
  CLAUDE.md prinsipp 4s begrunnelse for Cloudflare-siden, men her er det
  også et **eksplisitt tredjepartsvilkår** — `apps/worker`s proxy-rute
  (spec §14) skal implementere `If-Modified-Since`/ETag-caching, ikke bare
  hente og videreformidle rått.
- **20 req/s-taket er aggregert per applikasjon**, ikke per bruker.
  For én bruker (Magnus) er dette i praksis uoppnåelig ved normal bruk,
  men prinsipielt riktig å bygge inn rate-begrensning i proxyen hvis
  telefon + nettbrett poller samtidig (allerede notert i
  `docs/specs/vaerpakker.md` §16).
- **Backoff ved 429:** eksponentiell backoff med tak, ikke umiddelbar
  retry-løkke — konkret skjema er en implementasjonsdetalj (§16), men
  skal finnes i kode.
- **Mobil-overpollingsforbudet (punkt 4 over) påvirker PWA-designet
  direkte:** en bakgrunns-service-worker som periodisk henter nye
  værdata «for å være klar» mens appen ikke er i bruk, er et
  vilkårsbrudd. Synk skal trigges av faktisk bruk (app åpnes/
  forgrunnsaktivitet), ikke av en tidsstyrt bakgrunnsjobb på klienten —
  periodisk oppfrisking hører hjemme i Cloudflare-siden (som bygger
  værpakker på cron, ikke som repetert klientpoll mot api.met.no).

## Gjenstår / uverifisert

1. **MetAlerts-spesifikk pollingfrekvens** — samme
   overpollingsforbud gjelder, men ingen anbefalt intervall er
   dokumentert av MET for akkurat dette produktet. Foreløpig antakelse:
   poll i takt med værpakke-bygging (samme cron som MEPS/NorKyst), ikke
   separat, hyppigere polling — bør bekreftes egnet når MetAlerts faktisk
   kobles inn (uverifisert i denne fasen, jf.
   `docs/specs/vaerpakker.md` linje om MetAlerts).
2. **Eksakt oppførsel ved 403 fra koordinat-presisjonsregelen** (punkt 5)
   i kombinasjon med Workerens proxy — bør testes med et bevisst
   5-desimalers kall for å bekrefte 403 og ikke en annen feilkode, før
   proxyen stoler blindt på at avrunding alltid skjer riktig sted i
   kjeden.
3. **Om Locationforecast faktisk brukes i v2** — kildestacken (F2.1)
   nevner ikke eksplisitt Locationforecast som primærkilde (MEPS via
   THREDDS er primær for vind); denne filen dekker det likevel siden det
   er samme api.met.no-vilkårssett, i tilfelle det brukes som
   fallback/bakgrunnsvær.
