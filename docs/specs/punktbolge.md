# Spec: Punktbølge fra Oceanforecast via Worker-proxy

- Status: **vedtatt** — D16.1–D16.3 besluttet av Magnus 2026-09-29 som anbefalt
  (panel `docs/research/ekspertpanel-d16-punktbolge-2026-09-28.md`).
- Dato: 2026-09-28
- Bolk 2, steg 3 (D13.5, D14.1, D14.2). Grunnlag: ADR-0007,
  `docs/specs/vaerpakker.md` §18b pkt. 1–2,
  `docs/research/strom-bolge-forarbeid-2026-09-27.md` §3.2,
  `docs/research/ekspertpanel-d14-strom-bolge-2026-09-27.md`.

## 1. Formål og kravsporing

Gi motorens `WeatherField.waves()` data, slik at ensemble-medlemmer kan
bli gjennomførbare/ugjennomførbare i stedet for inkonklusive (D11.1,
`environmentAt` krever både strøm og bølge).

- F2.1 (bølger — **periode-kravet står**, D14.1: periode mangler i
  kilden og vises som ukjent), F2.2 som presisert i ADR-0007 (punkt-API via
  proxy), F2.4 (kildestatus), N2 (ærlig degradering), prinsipp 4
  (frakoblet med sist synkede data).
- Konsumentsiden finnes: `packages/weather` `WaveSample {hsM, tpS?,
  fromDeg?}`, `decodeWavesAt`-semantikken (Hs mangler ⇒ `undefined`),
  motorens `boat.waveFactor(hsM, tpS, relDirDeg)` (uten Tp: v1-
  heuristikken, gulv 45 %).

## 2. Avgrensning

Ikke dekket: WAM800/gridded bølge (egen spike, exit-kriterium i §7);
Tp avledet fra MEPS-vind (eget ADR-spor, D14.1 d); Tp-nedre-grense som
produksjonskonstant (D14.1: ikke før etterprøvd mot NORA3/WAM); endring
av `waveFactor`/derating; Oceanforecast-punktstrøm (kun kryssjekk,
ikke kilde).

## 3. Datamodell og kontrakter

**Kilde.** `https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=&lon=`
(verifisert 2026-09-27): per tidssteg `sea_surface_wave_height` (m),
`sea_surface_wave_from_direction` (grader, FRA), ingen periode. Vilkår:
`docs/legal/met-norway-api.md` (User-Agent, ≤ 20 req/s, respekter
`Expires`/`If-Modified-Since`, 4 desimaler i koordinater).

**Proxy (`apps/worker`, ny rute `/proxy/oceanforecast`).** Tar en liste
punkter (maks `WAVE_POINTS_MAX`), henter hvert punkt fra MET med samme
mønster som `metalerts.ts` (rate-limiter, `caches.default`,
revalidering, `User-Agent`), og svarer med én samlet payload:

```
WavePointSet {
  schema: "morild-punktbolge/1",
  fetchedAtEpochS: number,         // når proxyen hentet/revaliderte
  points: [{ lat, lon, times: [{ epochS, hsM | null, fromDeg | null }] }],
  sourceStatus: "ok" | "degraded" | "failed" (+ årsak),
  hash: string                     // over kanonisk JSON av points
}
```

Punkt som feiler hos MET står med tom `times` og teller i `sourceStatus`
— aldri utelatt i stillhet.

**Punktvalg (klient, før ensemblet).** Punkter legges i et fast gitter
over korridoren mellom start og mål (samme korridor som flisvalget),
med avstand `WAVE_POINT_SPACING_NM` (D16.1). Punktene er de samme for
alle medlemmer og alle avganger i kjøringen.

**Fryseregel (ADR-0007).** `WavePointSet` hentes én gang før kontrollen
starter, og samme objekt (samme `hash`) går til kontrollen, alle
medlemmer og perturbasjonsfasen. Ingen nye kall under kjøringen. `hash`
og `fetchedAtEpochS` inngår i `RobustnessStamp` og målings-JSON.

**Oppslag i motoren.** `WeatherField.waves(lat, lon, epochS)`:
nærmeste punkt (haversine) innenfor `WAVE_POINT_MAX_DISTANCE_NM`
(D16.2); lineær i tid mellom punktets to nærmeste tidssteg; Hs `null`
eller utenfor tid ⇒ `undefined`. `tpS` settes aldri (kilden har ikke
periode). Retning lineært på sirkelen. Nytt valgfritt oppslag
`wavePointDistanceNm(lat, lon): number | undefined` til merking.

**Klientbuffer.** Siste vellykkede `WavePointSet` per korridor lagres i
Cache Storage/IndexedDB. Uten nett brukes bufferet (med sitt tidsstempel);
finnes ikke det: bølger mangler.

## 4. Adferd og ærlig degradering

| Situasjon | Motor | UI (alltid synlig der ruten leses) |
|---|---|---|
| Normal | `waves()` med Hs, uten Tp | «Bølger fra punktvarsel kl. HH:MM (nærmeste punkt < 5 / 5–20 / > 20 nm) — bølgeperiode ukjent, konservativt anslag» (D14.1, D14.2, én tekst) |
| Punkt lenger unna enn grensen | `undefined` ⇒ partial | «Bølgedata mangler her (ingen varselpunkt i nærheten)» |
| Uten nett, buffer finnes | som normal, med bufferets tid | tekst som over + «(frakoblet, fra kl. HH:MM)» |
| Uten nett, ingen buffer | `undefined` | «Bølgedata krever nett» |
| Proxy/MET feiler | `undefined` for berørte punkter | kildestatus i diagnostikk + rute-flagg |
| Hs over terskel og Tp ukjent (D16.3) | uendret | trafikklyset kan ikke bli grønt (cap, §4.1) |
| Punkt i kystmasken fra strøm-sporet | uendret | bølgeteksten får «nær land, mulig skjermet — punktvarselet fanger ikke le, refleksjon eller krysssjø» |

Per-steg-flagg `BOLGE_PUNKT_KATEGORI_*` (avstandskategori) og rute-flagg
som OR, samme mønster som `STROM_KYSTSONE`.

## 4.1 Bølge-tak på trafikklyset (D16.3, D14.1)

Ren cap-funksjon i `packages/robustness` (`capForUnknownPeriod`),
anvendt **etter** §4.2.3-reglene og D10.4-skrankene i robusthet.md:
`farge = strengeste(farge fra §4.2.3/D10.4, tak)`, der taket er «gul»
når `maxHs > WAVE_GREEN_CAP_HS_M` og periode er ukjent, ellers ingen
begrensning. Kan bare hindre grønt — rødt mykes aldri. `maxHs` = maks
Hs over alle steg i kontrollen og alle gjennomførbare medlemmer.
`WAVE_GREEN_CAP_HS_M = 1,0` stemples i `RobustnessStamp` som
«foreløpig, ikke verifisert mot NORA3», samme status som 0,9/0,7/0,2.
Aldri en ny rad i terskeltabellen (D11.4-lærdommen).

**Diagnostikk:** `wavePointDistanceNm` vises alltid under «Datakilder og
diagnostikk» for rutens steg (maks og median), ikke bare ved brudd.

## 5. Testkrav

- Proxy: rate-limit, cache/revalidering, én payload, feilet punkt står
  med tom `times` og degradert status; koordinater avrundet til 4 desimaler.
- Fryseregel: én proxy-henting per kjøring; alle medlemmer ser samme
  `hash` (orkestreringstest); ingen henting i perturbasjonsfasen.
- Oppslag: nærmeste punkt, avstandsgrense, lineær tid, sirkelinterpolasjon
  av retning, `tpS` aldri satt, `null` ⇒ `undefined`.
- Klientbuffer: frakoblet bruker buffer og merker det; uten buffer
  «krever nett».
- Determinisme: samme `WavePointSet` ⇒ bit-identisk `RouteResult`.
- Cap: grønt ⇒ gult når maxHs > 1,0 m og Tp ukjent; gult/rødt uendret;
  rødt aldri mildnet; anvendt etter D10.4-skrankene; maxHs over steg og
  gjennomførbare medlemmer; stempelet bærer «foreløpig».
- Kystmaske-tekst: steg i kystmasken gir «nær land, mulig skjermet».
- Integrasjon mot ekte pakke + ekte proxy: andel medlemmer som fortsatt
  er partial (målet for bolk 2 — rapporteres, avgjør om full (d) blir
  neste blokkerende steg).

## 6. Budsjett

Punktantall ≈ korridorareal / spacing². Skjæløy–Skagen (~85 × 20 nm):
10 nm ⇒ ~20 punkter, 5 nm ⇒ ~70. Payload < 100 KB. MET-kall per ny
plan = antall punkter (cache ~30 min hos proxyen); godt under 20 req/s
med sekvensiell/lavparallell henting.

## 7. Beslutninger

**Vedtatt 2026-09-29:** D16.1 (a) 10 nm punktavstand (kun Oceanforecast);
D16.2 (a) 10 nm maksavstand, avstand alltid i diagnostikk; D16.3 (t1) tak
nå per D14.1 som cap-funksjon (§4.1), 1,0 m foreløpig; (n2) kystmasken som
tekst, ingen nær-land-regel på trafikklyset; WAM800-exit med fem vilkår
(under); MEPS-vind som «kort, bratt vindsjø»-diagnostikk = egen senere spec.

Historikk — spørsmålene slik de ble stilt:

**D16.1 Punktavstand.** (a) 10 nm (~20 punkter), (b) 5 nm (~70), (c)
tettere nær kysten, glissent ute. **Anbefaling: (a) nå** — Oceanforecast
er selv et grovt produkt (WAM-basert, ikke 800 m), så tettere punkter gir
lite ny informasjon; kategoriene i UI dekker avstanden.

**D16.2 Største avstand til punkt før bølge regnes som manglende.**
(a) 10 nm, (b) 20 nm, (c) ingen grense (alltid nærmeste). **Anbefaling:
(a) 10 nm** med 10 nm-spacing betyr at et punkt i korridoren alltid har
et varselpunkt innen ~7 nm; utenfor korridoren (en omvei) blir bølge
manglende og ærlig merket. (c) avvist: gir falsk dekningsfølelse
(marinkartolog, D14).

**D16.3 «Aldri rent grønt» ved ukjent periode (D14.1).** Terskel for Hs
der trafikklyset maks blir gult når Tp mangler: (a) 1,0 m, (b) 0,5 m,
(c) alltid maks gult så lenge periode mangler. **Anbefaling: (a) 1,0 m**
— under 1 m i Skagerrak gir v1-heuristikken lite tap og bratthet er
sjelden avgjørende for en 41-fots; over 1 m kan kort vindsjø være
avgjørende. (b) gjør grønt nesten umulig i Skagerrak; (c) likeså. Endrer
trafikklysets semantikk ⇒ Magnus avgjør.

**WAM800 exit-kriterium (D14.1).** Forslag: WAM800-spiken kjøres etter
første nettbrett-remåling med strøm og bølge; lykkes den (subsetting <
2 min i cron, periode tilgjengelig, pakke < 40 MB, lokalisering verifisert
mot kildens egne koordinater, periodefeltet validert mot NORA3/WAM på
minst én kjent hendelse — **vedtatt som fem vilkår**), erstatter gridded
WAM800 Oceanforecast som primær bølgekilde og Hs-only-grenen fjernes.

## 8. Endringslogg

- 2026-09-28: utkast (hovedsesjonen).
- 2026-09-29: D16.1–D16.3 vedtatt; §4.1 bølge-tak, kystmaske-tekst, WAM800-exit med fem vilkår.
- 2026-09-29: implementert (se leveranserapporten). Presiseringer der spec-en var åpen:
  proxyen er `GET /proxy/oceanforecast?points=lat,lon;…` (Workeren tar kun GET);
  `WAVE_POINTS_MAX = 48` styrt av Cloudflare-gratisplanens 50 delforespørsler
  (Cache API teller med) — én bokføringsoppføring for hele punktlisten, ikke to
  per punkt som i `metalerts.ts`; hvert punkt bærer `status` (`ok`/`ingen-data`/
  `feilet`) og METs faktiske modellposisjon (`sourceLat/sourceLon`, oppslaget
  måler dit); `sourceReason` ved siden av `sourceStatus`. Korridoren gir 34
  punkter på Skjæløy–Skagen (A*-feltets boks 13 × 3 noder, bare nåbart vann). Payload er
  ~10 kB per punkt med data (208 timesteg) ⇒ ~0,35 MB for 34 punkter, over
  §6-anslaget på < 100 kB (gzip over nettet).
- 2026-09-29: **Vedtak A (Magnus):** manglende bølgedata på et steg (kontroll eller
  medlem) teller som «ukjent Hs», ikke 0 — taket i §4.1 slår inn (aldri grønt).
  Innstramming av D16.3 etter code-reviewer-funn (kontrollens `maxHsM` telte hull
  i punktvarselet som 0 m).
