# MET Norway — THREDDS (thredds.met.no)

- Brukes til: rå NetCDF-grid hentet av `tools/weather-pack` via OPeNDAP —
  MEPS (kontroll + 30 ensemble-medlemmer), NorKyst v3 (strøm), WAM800/
  Oceanforecast-grid (bølge). Dette er **ikke** api.met.no
  (punkt-JSON-API-ene) — se `met-norway-api.md` for de.
- Status: **delvis verifisert.** Lisens- og generelle bruksvilkår hentet
  fra offisiell kilde 2026-09-03. Arkivpolitikken under er verifisert
  **empirisk** (faktiske katalogoppslag i `docs/research/spike-thredds.md`,
  2026-08-30), ikke fra en skriftlig retensjonspolicy MET selv publiserer —
  det finnes ingen slik policy-side å sitere. THREDDS-spesifikk rate-grense
  (tall i req/s) er **ikke funnet** — se «Gjenstår».

## Kilde

- Tjenesterot: `https://thredds.met.no/thredds/catalog.html`
- MEPS operativ (rullerende, kort vindu): `mepslatest/catalog.html`
- MEPS arkiv: `meps25epsarchive/{år}/{måned}/{dag}/catalog.html`
- NorKyst v3 (levende «best estimate»): `fou-hi/norkystv3_800m_m00_be`
- NorKyst frossen hindcast (eldre kalibrering): `romshindcast/norkyst_v3`
- WAM800 Skagerrak: `fou-hi/mywavewam800s_curr` (domenekode `c4`)
- **Utgått, skal ikke brukes:** `fou-hi/norkyst800m-1h` (død siden okt.
  2025 — siste fil `...fc.2025100500.nc`, katalogen svarer 200 men
  oppdateres ikke)
- Kontakt/drift: `thredds@met.no`, driftsstatus `status.met.no`

## Lisens og vilkår

**Norwegian Licence for Open Government Data (NLOD)** og
**Creative Commons Attribution 4.0 International (CC BY 4.0)** —
bekreftet på `thredds.met.no/thredds/catalog.html` (hentet 2026-09-03) og
samstemt med MET Norways generelle
[«Licensing and crediting»-side](https://www.met.no/en/free-meteorological-data/Licensing-and-crediting).
Enkeltdatasett kan ha avvikende lisens eksplisitt angitt i filens metadata
— ikke sjekket per datasett i denne runden (MEPS/NorKyst/WAM800 antas
dekket av standardlisensen, ingen avvikstekst observert i de kataloger som
ble besøkt).

## Attribusjonskrav i UI

Samme institusjon og lisens som `met-norway-api.md` — bruk én felles
kredittlinje for alle MET Norway-data i appen (THREDDS-hentet grid og
api.met.no-punktoppslag skal **ikke** ha separate attribusjonstekster).
Anbefalt tekst fra MET selv: **«Data from MET Norway»** eller
**«Based on data from MET Norway»**, gjerne med lenke til kildekatalogen.
Se `met-norway-api.md` for eksakt plassering i UI.

## Bruksvilkår for OPeNDAP-subsetting

- **Ingen publisert numerisk rate-grense for THREDDS** (i motsetning til
  api.met.nos eksplisitte 20 req/s — se `met-norway-api.md`). I stedet:
  MET forbeholder seg retten til å **blokkere IP-adresser** som forårsaker
  overdreven trafikklast, og ber eksplisitt: **«Please avoid spawning
  multiple parallel sessions for OPeNDAP access or file downloads, as this
  can impact service availability for all users.»** (thredds.met.no/
  thredds/catalog.html, hentet 2026-09-03).
- **Konsekvens for `tools/weather-pack`:** alle OPeNDAP-kall skal være
  **sekvensielle**, aldri parallelle sesjoner mot samme eller ulike
  datasett. Dette var allerede praksis i spiken (`spike-thredds.md`, funn
  9 og «Avvik fra bytebudsjettet»: ~232 MB nedlastet, alt sekvensielt) —
  kravet er nå dokumentert som et **vilkår**, ikke bare en
  ytelsesobservasjon.
- **Ingen eksplisitt User-Agent-plikt dokumentert for THREDDS** (til
  forskjell fra api.met.no, se der). Prosjektets policy: bruk samme
  identifiserende User-Agent-mønster likevel
  (`morild-routeplanner/<versjon> maasao@gmail.com`, samme som spiken
  brukte: `morild-routeplanner-spike/0.1 maasao@gmail.com`) — defensiv
  praksis, ikke et dokumentert krav, men kostnadsfritt og i tråd med
  «vær identifiserbar» som gjennomgående MET-forventning.
- **NCSS var nede (503 på alt) under hele spiken 2026-08-30.** Ikke et
  formelt vilkår, men et driftsfunn med arkitekturkonsekvens: bygg
  subsetting på **OPeNDAP index-range**, ikke NCSS, og ikke anta NCSS som
  fallback. Status bør resjekkes periodisk (`status.met.no`), ikke antas
  permanent nede.
- **Backoff:** ingen tallfestet backoff-policy fra MET selv, men samme
  disiplin som `met-norway-api.md` (eksponentiell backoff med tak ved
  429/503/blokkering, ikke umiddelbar retry) gjelder — se
  `docs/specs/vaerpakker.md` §16 for kravet som stilles i kode.

## Arkivpolitikk (F3.3-kalibrering, §18 pkt. 4)

Relevant fordi §18 pkt. 4 i `docs/specs/vaerpakker.md` bestemte at
**F3.3-kalibrering bruker METs eget arkiv, ikke vårt eget 7-døgns
R2-vindu.** Faktisk dekning, verifisert i `docs/research/spike-thredds.md`
(2026-08-30):

| Datasett | Dekning | Merknad |
|---|---|---|
| MEPS operativ ensemble (`mepslatest`) | rullerende, kort vindu (observert ~2 døgn ved stikkprøve 2026-09-03) | ikke egnet til historisk kalibrering, kun til drift |
| MEPS arkiv, **deterministisk** (`meps25epsarchive`, `meps_det_*`) | 2020 → i dag, alle dager bekreftet for 2026-07 | eneste MEPS-arkivkilde for eldre datoer nå |
| MEPS arkiv, **ensemble** (`meps_lagged_6_h_subset_2_5km_*`) | **kun 2020 → et sted mellom 2024-11-15 og 2024-12-15** — deretter forsvunnet, ikke lenger arkivert | historisk ensemble-backtesting lenger enn ~1,9 år tilbake (fra spiketidspunktet) er **ikke mulig** med denne kilden. Rammer ikke F3.3 direkte (den kalibrerer SOG mot faktiske forhold, ikke ensemble-spredning), men er en reell begrensning hvis ensemble-kalibrering noen gang blir aktuelt |
| NorKyst v3, levende («best estimate», `fou-hi/norkystv3_800m_m00_be`) | 2024-01-01 → nå+5 døgn, kontinuerlig oppdatert | ingen ensemble-variant, kun «reference member 00» |
| NorKyst v3, frossen hindcast (`romshindcast/norkyst_v3`) | 2012-01-05 → 2025-08-02 | for kalibrering eldre enn 2024-01-01 |
| WAM800 Skagerrak (`fou-hi/mywavewam800s_curr`) | oppdatert 4×/døgn, historisk dybde **ikke målt** i spiken | se «Gjenstår» |

**Praktisk regel for F3.3:** bruk `meps25epsarchive` (deterministisk) +
`romshindcast/norkyst_v3` for kalibreringsvinduer eldre enn dagens rullerende
NorKyst-vindu; bruk `norkystv3_800m_m00_be` direkte for alt fra 2024-01-01
og fremover. Ikke bygg noen kalibreringslogikk som forutsetter et
arkivert MEPS-**ensemble** lenger tilbake enn ~ultimo 2024.

## Gjenstår / uverifisert

1. **Eksakt numerisk rate-grense for THREDDS** — ingen publisert,
   bekreftet kun «unngå parallelle sesjoner» + rett til IP-blokkering.
   Ingen handling påkrevd utover å faktisk følge sekvensiell-kall-regelen.
2. **Eksakt dato ensemble-arkivet forsvant** — bundet til intervallet
   2024-11-15–2024-12-15 i spiken, ikke pinnet nærmere. Irrelevant for
   igangsetting, men bør nevnes hvis noen senere spør «hvorfor akkurat
   denne datoen» i en kalibreringsrapport.
3. **WAM800 historisk dybde** — ikke undersøkt i spiken (bytebudsjett
   brukt opp før bølgedata ble nådd, jf. `spike-thredds.md` «Det vi ikke
   fant ut»). Egen liten spike anbefalt før WAM800-arkiv brukes til noe
   annet enn sanntidsdrift.
4. **Er User-Agent-kravet på api.met.no formelt bindende også for
   thredds.met.no** (samme organisasjon, ulik dokumentasjonsside)? Antatt
   ja i praksis (prosjektet sender identifiserende UA uansett), men ikke
   bekreftet som et separat, skrevet THREDDS-krav.
5. **NCSS-status** — nede under hele spiken 2026-08-30. Ikke resjekket
   siden. Skal verifiseres på nytt før noen kode legger NCSS inn som
   primærvei (planen er uansett OPeNDAP-only, så dette blokkerer ikke
   implementasjon).

## Kilder

- https://thredds.met.no/thredds/catalog.html — hentet 2026-09-03
  (bruksvilkår, «be nice»-tekst, lisens, kontaktinfo)
- https://www.met.no/en/free-meteorological-data/Licensing-and-crediting —
  hentet 2026-09-03 (generell lisens- og krediteringspolicy)
- `docs/research/spike-thredds.md` — 2026-08-30 (empirisk arkivdekning,
  katalogstier, NCSS-status, faktiske OPeNDAP-målinger)
- `docs/research/vaerdata-ensemble.md` §1 — 2026-08-30 (opprinnelig
  research, delvis korrigert av spiken over)
