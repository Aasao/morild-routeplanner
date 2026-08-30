# Review av kravspek-utkast v0.1 — marin systemarkitekt/utvikler

- Dato: 2026-08-30. Persona-review (maritime datasystemer + Cloudflare/PWA).
  Innarbeidet i kravspek v0.2 og prosjektplan.

## Hovedbudskap

Godt forarbeid; kritikken gjelder det som er *underspesifisert der det er
dyrt å ta feil*, og for stort scope for én bruker. Kritisk vei: værpipelinens
**hjem og størrelsesbudsjett** — tar man feil der, designes pakkeformat,
offline-lager og ensemble-UX om igjen.

## MÅ endres

- **M1 Batch-jobben har ingen adresse** — og må virke mens båten er på tur
  (lokal PC er av). Alternativer: GitHub Actions cron (gratis, offentlig repo
  = ubegrensede minutter; cron kan forsinkes 15–60 min), Cloudflare
  Containers (betalt, ungt), VPS (bryter N4). Anbefaling: **GitHub Actions
  cron → R2 via API-token, lokal PC som manuell fallback.** ADR i fase 0.
  Volum-sjekk: ~120 MB nedlasting + 10–20 min per syklus, 2–4/døgn — innenfor
  Actions-rammene.
- **M2 Værpakke-størrelse må budsjetteres.** Skjæløy→Skagen-bbox naivt:
  MEPS 30 medl. Float32 ≈ 117 MB + NorKyst + WAM ≈ 130–170 MB — dreper
  mobilnett-modellen. Grep: 8-bit kvantisering m/per-flis skala/offset;
  **medlemmer på 5 km (¼ punkter), kontroll på 2,5 km**; tidstynning (1 t
  0–24, deretter 3 t: 61→~36 steg); delta-koding. Realistisk **20–35 MB**;
  sett hardt tak (≤ 30 MB) i spec. Faste fliser over Skandinavia per kjøring
  (ikke on-demand per rute — batch kan ikke trigges fra båten).
- **M3 Farbarhetsmaske v1 = ren polygonalgebra.** Kontur-constrained
  interpolasjon er prosjektets mest risikofylte enkeltstykke, og gevinsten
  er båndet 2,6–5 m som man sjelden vil rute gjennom. ECDIS-logikk: nærmeste
  kurve ≥ terskel → **5 m-kurven som safety contour**; maske = sjøareal ∖
  (grunnere enn 5 m-kurve ∪ tørrfall ∪ buffrede skjær/grunner); farled som
  tillitsløft; kvalitetslag som usikkert-flagg. Interpolasjon = senere
  forbedring hvis 5 m-kurven måles for restriktiv.
- **M4 Datum-semantikk:** statisk maske ved sjøkartnull (K0, null vannstand
  = konservativt); IKKE tidevanns-åpning av grunne områder i v2.0
  (tidsavhengig maske = kompleksitetseksplosjon + feil risikonivå). Men:
  (1) negativ meteorologisk vannstand i Kattegat/Østersjøen (0,5–1 m under
  referanse) må inn som flagget risiko; (2) datum per kilde er felt i
  ChartSource-kontrakten (DDM er middelverdi-modell!).
- **M5 S1 er 150–210 kjøringer, ikke 30** (5–7 avganger × 30 medlemmer +
  perturbasjoner). Omdefiner budsjettet: **progressiv beregning som
  UX-kontrakt** (kontrollmedlem for alle avganger på sekunder; ensemble
  strømmes inn per avgang); medlemmer på 10–12° kursoppløsning som standard
  (kontroll 6°); A*-felt væruavhengig og delt; Tub fra kontroll gjenbrukes
  som bound.
- **M6 Minnearkitektur velges nå:** (a) SharedArrayBuffer krever COOP/COEP
  (påvirker WMTS/tile-CORP — felle) vs. (b) **per-medlem transferable
  ArrayBuffers** (~1–3 MB kvantisert per medlem, overføres ikke kopieres;
  deterministiske felt kopieres én gang per worker). Anbefaler (b). Dekod
  kvantisert→Float32 i workeren on demand.
- **M7 Kalibreringen (fase 2) avhenger av fase 3-tooling:** SOG − strøm
  krever historisk NorKyst-800 fra THREDDS-arkivet. Flytt ut av fase 2-exit
  eller kjør som frittstående mini-pipeline (= de facto fase 3-spike). Sjekk
  at arkivet dekker juli 2026 og Kattegat-delen av tracket (kan mangle →
  SOG-basert kalibrering m/flagg for de binnene).

## BØR vurderes

- **B1 THREDDS-spike helt frem** (fase 0/1): NCSS-ytelse, WAM800-sti,
  NorKyst-katalog, subset-størrelse — prosjektets farligste antagelse, én
  dags frittstående skript.
- **B2 Kutt kildelisten i v2.0-kjernen:** MEPS + NorKyst-800 + MET bølger +
  tideapi (+ Nowcast). ECMWF ENS ut av kjernen (GRIB2/JPEG2000-stack for en
  >61 t-horisont som knapt trengs før S4) — Open-Meteo ensemble-API gir
  ECMWF som JSON den dagen det trengs. DMI/CMEMS fases inn ved Østersjø-tur.
  Halverer pipeline-flaten i fase 3.
- **B3 Pakkeformat-versjonering:** semver i header; app avviser høyere major
  forståelig; forrige generasjon beholdes i R2 (innholdsadressering = gratis).
- **B4 Cron-overvåking:** pakke-peker bærer `produced_at` + kildestatus per
  lag («06Z manglet, dette er 00Z»); healthcheck-ping (healthchecks.io) fra
  batch → e-post når pipelinen har vært død 12 t.
- **B5 Synk-konfliktmodell:** last-write-wins per rute (`updated_at` +
  enhets-ID) er nok for én bruker — men si det. Vurder R2/KV JSON-blobber i
  stedet for D1-skjema.
- **B6 Cloudflare Access × PWA-felle:** utløpt Access-sesjon → alle fetch
  redirecter → service worker ser opake feil → «død» app offline; Access i
  TWA er eget kapittel. ADR: Access kun foran Worker-API (app offentlig men
  obskur) eller enkel API-nøkkel (lav trusselmodell).
- **B7 A*-felt dekobles fra maskeoppløsning:** heuristikkfelt på 500 m–1 km
  (farbarhet som kant-stenging); fin maske kun i segmentvis ettersjekk.
  Ellers arves v1s stengte sund eller minneeksplosjon (kystbånd på 50 m =
  titalls millioner celler).
- **B8 MEPS lagged-ensemble:** «siste komplette 30, aldersspenn i metadata»
  — må stå i spec-en (medlemmer har ulik alder, filer fra flere kjøringer).

## KJEKT

- K1: 50+ fasit-punkter inkl. danske/svenske som *skal* gi «usikkert».
- K2: golden-tester med toleranse (Math.sin/cos er impl.-definert per
  V8-versjon), ikke bit-eksakt.
- K3: frossen ekte MEPS-testpakke i repoet (konvensjonsfeil finnes kun mot
  ekte data).
- K4: ensemble-ytelses-spike med v1-motoren (30× i workers på nettbrettet,
  syntetisk perturberte felt) — én ettermiddag, ekte tall før porten.
- K5: fase 4a = P-tider + gjennomførbarhets-%; korridor-stabilitet og
  følsomste-faktor-attribusjon = fase 4b.
- K6: minnebudsjett som tall i N6 (< 500 MB JS-heap under ensemble).

## Faserekkefølge

Fase 1 ∥ 2 → 3 → 4 riktig. Endringer: THREDDS/batch-spike frem til fase 0–1;
kalibrering ut av fase 2-exit.
