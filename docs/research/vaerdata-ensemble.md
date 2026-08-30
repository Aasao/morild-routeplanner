# Vær-, bølge-, strøm- og tidevannsdata + ensemble/robusthet — Skandinavia

- Dato: 2026-08-30. Sammenstilt fra tre parallelle researchspor (MET Norway; ECMWF/DMI/SMHI/CMEMS; Open-Meteo/robusthetsmetodikk). Grunnlag for datainnhentings-spec og robusthets-ADR.

> **KORRIGERT AV SPIKE 2026-08-30 — se `spike-thredds.md` (fasit ved konflikt):**
> (1) MEPS er ÉN fil per kjøring med `ensemble_member=30`-dimensjon
> (`meps_lagged_6_h_latest_2_5km_{run}.nc`), IKKE én fil per medlem som §1
> antar. (2) NCSS var nede (503 overalt) — subsetting går via OPeNDAP
> index-ranges, som fungerer godt (30 medlemmer × u/v × 61 t for rutebbox:
> 43 s / ~159 MB rått i ett batch-kall). (3) MEPS-arkivets ensembleprodukt
> forsvant ~nov/des 2024 — kun deterministisk arkiveres siden (påvirker ikke
> polar-kalibrering, men begrenser historisk ensemble-backtesting).
> (4) `fou-hi/norkyst800m-1h` er død siden okt 2025 — riktig kilde er
> **`fou-hi/norkystv3_800m_m00_be`** (rullerende 2024-01→ca. i dag+5 d).
> (5) WAM800 Skagerrak bekreftet: `fou-hi/mywavewam800s_curr` (domene c4),
> subsetting ennå ikke målt (oppfølgingsspike).

## 1. MET Norway (api.met.no + THREDDS)

### Punkt-API-er (JSON, ferdig prosessert)
- **Locationforecast 2.0** — `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=..&lon=..` (JSON), 9 dagers horisont, maks 4 desimaler på koordinater.
- **Oceanforecast 2.0** — `.../oceanforecast/2.0/complete` — signifikant bølgehøyde/-retning, strøm (fart/retning), sjøtemperatur. Underliggende: WAVEWATCHIII 4 km regional, WAM800 800 m kystnært, WAM3 3 km pan-arktisk (fra datamodell-doc; verifiser mot ocean.met.no). Snapper til nærmeste sjøpunkt. **Ikke** vannstand.
- **Nowcast 2.0** — 2,5 km (MEPS-basert), oppdatert hvert 5. min, 2 t horisont, dekker N/S/FI/DK.
- **Tidalwater 1.1** — vannstandsprognose ~30 norske havner: TIDE (astronomisk, Kartverket) + SURGE + TOTAL.

### Vilkår (kritisk for arkitektur)
- Maks **20 req/s per applikasjon totalt** (alle installasjoner samlet). 429/403 ved brudd.
- **Obligatorisk identifiserende User-Agent** m/kontaktinfo — forfalsket UA gir permanent blokkering.
- Caching-krav: respekter `Expires`, bruk `If-Modified-Since`; mobilapper skal gå via egen backend/caching-proxy → **Cloudflare Worker-proxy er ikke bare pent, det er påkrevd mønster.**
- Lisens CC BY 4.0.

### MEPS-ensemble (THREDDS) — KJERNEN I ROBUSTHETSANALYSEN
- MetCoOp Ensemble Prediction System: **2,5 km, 30 medlemmer** (5 nye per time, lagged opp til 6 t), horisont 61 t (66 t for kontroll), dekker Skandinavia + Finland.
- Katalog: `https://thredds.met.no/thredds/catalog/mepslatest/catalog.html` (+ `meps25epsarchive`).
- **Hvert medlem er egen fil**: `meps_mbr###_{pl|sfc}_YYYYMMDDTHHZ.ncml` — hentes direkte via OPeNDAP (`dodsC/...`) eller NCSS per fil; ensemble-akse-selektor i NCSS er ubekreftet men unødvendig.
- Dok: https://github.com/metno/NWPdocs/wiki/MEPS-dataset
- NB: NetCDF-prosessering hører hjemme i en batch-jobb (lokal/CI), ikke i Workers-runtime.

### NorKyst-800 (strøm — løsningen på v1s 8 km-problem)
- ROMS-basert, **800 m**, hele norskekysten inkl. Skagerrak; strøm, temp, salt. HI + MET.
- THREDDS: `https://thredds.met.no/thredds/catalog/fou-hi/norkyst800m-1h/catalog.html` (~3,2–3,5 GB per døgnfil, timesoppløsning; OPeNDAP-subsetting per område er obligatorisk — aldri hele filer). Nyere v2/v3 under utvikling (`norkyst800v2.html`, GMD-artikkel 2026) — verifiser gjeldende katalog ved implementasjon.
- Unngå parallelle OPeNDAP-sesjoner (drift-krav). Lisens NLOD/CC BY 4.0.

### Bølger kystnært
- Kystnær WAM 800 m i 5 domener, inkl. **Skagerrak (c4)**; eksakt THREDDS-sti ubekreftet — finn via ocean.met.no/models ved implementasjon.

### Kartverket vannstand/tidevann
- **`api.sehavniva.no` er avviklet** → `https://vannstand.kartverket.no/tideapi_en.html`. XML, ~20 req/s delt, CC BY 4.0. Parametre: lat/lon, fromtime/totime, datatype (obs/prediksjon/high-low), refcode (sjøkartnull/middel/NN2000), interval 10/60 min.
- **Ingen offentlig Kartverket-API for tidevannsSTRØM funnet** — strøm hentes fra NorKyst-800/CMEMS i stedet.

## 2. ECMWF Open Data (bakgrunnsensemble)

- **IFS ENS**: 0,25° (~25 km), **51 medlemmer**, 4×/døgn, 15 døgn, inkl. bølgeparametre. GRIB2 via `https://data.ecmwf.int/forecasts/` + AWS/Azure/GCP-speil; Python `ecmwf-opendata`. CC BY 4.0.
- **AIFS ENS** (AI-modell): 50 medlemmer, operativ siden 07.2025, samme distribusjon.
- Vurdering: for grovt for fjorder/sund (< 5 km-skala), men riktig som **spredningssignal utover MEPS' 61 t-horisont** og konsistenssjekk. AIFS er billig å oppdatere ofte.

## 3. DMI (danske farvann)

- **Forecast Data API** (Gravitee-nøkkel, gratis, ingen registrering lenger): HARMONIE DINI (vær), **WAM** (bølger — dekker danske stred/Kattegat/Skagerrak, ~5,5 døgn), **DKSS** (vannstand + strøm, 6 delområder inkl. indre danske farvann).
- STAC-API (GRIB, siste 48 t) + EDR-API (JSON/CoverageJSON, siste 24 t). Rate: 500 req/5 s.
- Vilkår: fri bruk, men hentet data «kan ikke endres» (avledede produkter må merkes tydelig som deriverte).

## 4. SMHI (svenske farvann)

- **metfcst**: JSON-punktprognose ~10 døgn, MEPS-basert 2,5 km. `https://opendata.smhi.se/apidocs/metfcst/`. CC BY 4.0.
- **Ingen åpen bølge-/strømprognose-API funnet** — HIROMB/NEMO-Nordic uten fritt sanntids-API (ubekreftet; WebFetch ga 404, dobbeltsjekk manuelt). For svenske farvann: bruk **Copernicus Marine** for hav/bølger.

## 5. Copernicus Marine (CMEMS) — Østersjøen/Kattegat-komplement

- **BALTICSEA_ANALYSISFORECAST_PHY_003_006**: NEMO 4.2.1, ~1 nm (2 km), 2×/døgn, 10 døgns prognose; strøm, temp, salt, vannstand, is. Dekker 53–66°N, 9–30°Ø (inkl. Kattegat/Skagerrak-overgang).
- **BALTICSEA_ANALYSISFORECAST_WAV_003_010**: WAM 4.7, 1 nm, times; total/vindsjø/dønning + Stokes-drift.
- **NWSHELF_ANALYSISFORECAST_PHY_004_013**: Nordsjøen ~1,5 km, koblet fysikk-bølge m/tidevann, 7 døgn, kvartimes-frekvens tilgjengelig.
- Tilgang: gratis konto, `copernicusmarine` Python-toolbox (`subset` gir NetCDF/Zarr-uttrekk). **Ensemble-variant finnes ikke** for disse — deterministiske.
- Rollefordeling: NorKyst-800 best for norskekysten; CMEMS for dansk/svensk farvann og kontinuitet.

## 6. Open-Meteo (v1s kilde — fortsatt nyttig?)

- Forecast API proxyer MET Norway Nordic 1 km m.fl.; Marine API: DWD EWAM ~5 km best for Nordsjø/Østersjø-bølger; havstrøm fortsatt grovt.
- **Ensemble-API finnes**: `https://ensemble-api.open-meteo.com/v1/ensemble` — ECMWF IFS 0,25°/9 km (51 medl.), GFS (31), ICON-EPS-familien; JSON per medlem. **Men: ingen MEPS** — for skandinavisk kystvind er MEPS via THREDDS uerstattelig.
- Gratis ikke-kommersiell: 600 kall/min, 10k/dag. CC BY 4.0.
- Rolle i v2: rask fallback + ensemble-supplement (ECMWF via JSON uten GRIB-dekoding), ikke primærkilde.

## 7. Robusthetsmetodikk — state of the art

- **PredictWind**: dag 1–10 deterministisk beste modell; dag 10–30 velger ett ECMWF-ensemble-medlem som best matcher determistisk kjøring («AI-matching») — altså IKKE per-medlem-ruting.
- **Expedition** (racing): ekte ensemble-ruting — ruter per lastet GRIB-modell + polar-/vindperturbasjon, alt vist samtidig.
- **Akademisk** (verifiserte): Hinnenthal & Clauss 2010 «Robust Pareto-optimum routing … ensemble weather forecasts» (doi 10.1080/17445300903210988); JMSE 2021 «A Comprehensive Approach to Account for Weather Uncertainties in Ship Route Optimization» (10.3390/jmse9121434); JMSE 2025 (10.3390/jmse13061185, bruker 3–30 medlemmer); JMSE 2026 MPC-basert (10.3390/jmse14020118). Metodefamilier: per-medlem-ruting + aggregering, robuste isokroner, stokastisk DP/MDP, scenariobasert optimering.
- **Praktisk konsekvens for v2** (se kravspek): kjør isokron-søk per ensemble-medlem (30 MEPS-medlemmer innen 61 t; ECMWF utover), aggreger til robusthetsmål per rutekandidat og avgangsvindu; perturber i tillegg polar (cruising-faktor ±) og avgangstid. v1s deterministiske motor er allerede rask nok til at 30 kjøringer er realistisk klientside med delt A*-felt.

## 8. Arkitekturkonsekvenser

- **GRIB/NetCDF-dekoding hører IKKE hjemme i Workers-runtime** (CPU-kost, JPEG2000; ubenchmarket). MEPS/NorKyst-prosessering → batch-jobb (lokal maskin/CI/cron-container) som skriver kompakte JSON/binærfelt (Float16/kvantisert) til R2.
- Punkt-API-er (Locationforecast, Oceanforecast, DMI EDR, Open-Meteo) er ferdig JSON → Worker-proxy m/cache + korrekt User-Agent holder.
- Klienten pinner én «værpakke» (deterministisk felt + ensemble-medlemmer for ruteområdet) per planleggingsøkt — samme innholdsadresserte mønster som kartpakker.

## Anbefalt datastack (oppsummert)

| Behov | Primær | Sekundær/fallback |
|---|---|---|
| Vind Skandinavia ≤ 61 t | **MEPS 2,5 km, 30 medl.** (THREDDS) | Open-Meteo (MET Nordic), Locationforecast |
| Vind > 61 t | ECMWF IFS/AIFS ENS 0,25° (51 medl.) | Open-Meteo ensemble-API |
| Bølger norskekyst/Skagerrak | MET WAM800/WW3 (Oceanforecast/THREDDS) | DWD EWAM via Open-Meteo Marine |
| Bølger danske/svenske farvann | DMI WAM / CMEMS Baltic WAV | Open-Meteo Marine |
| Strøm norskekyst | **NorKyst-800** | Oceanforecast punkt-API |
| Strøm Kattegat/Østersjøen | CMEMS Baltic PHY / DMI DKSS | — |
| Vannstand/tidevann Norge | Kartverket tideapi + MET Tidalwater | — |
| Nowcast (underveis) | MET Nowcast 2.0 | — |

## Ubekreftet / følges opp ved implementasjon

1. NCSS-subsetting-detaljer for MEPS-filer (medlem-filer bekreftet; subset-ytelse måles).
2. Eksakt THREDDS-sti for WAM800 Skagerrak (c4).
3. NorKyst v2/v3-status og gjeldende katalog.
4. SMHI HIROMB/NEMO-tilgang (manuell sjekk i nettleser).
5. DMI HARMONIE/WAM eksakt oppløsning i km.
6. Faktisk størrelse/lastetid for MEPS-subset per ruteområde (styrer pakkeformat).
