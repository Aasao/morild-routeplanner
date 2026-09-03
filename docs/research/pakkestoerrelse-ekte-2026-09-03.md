# Pakkestørrelse — FØRSTE EKTE MEPS-måling (bølge 2A, 2026-09-03)

- Dato: 2026-09-03
- Fase: 3, bølge 2A (`docs/research/fase3-plan-2026-09-02.md`)
- Grunnlag: `docs/specs/vaerpakker.md` §8 (budsjettregnskapet), §9 (låst
  kvantisering), §16 (API-vilkår/backoff); `docs/legal/met-norway-thredds.md`;
  kode: `tools/weather-pack/src/build-live-package.ts`,
  `live-source.ts`, `lambert-rotation.ts`, `pipeline.ts`.
- Formål: D4-beslutningen (vind-only første ende-til-ende) — bygg en EKTE
  vindpakke mot THREDDS, mål den mot §8s 30 MB-budsjettregel, og verifiser
  dekodingen (retningskonvensjon, rundtur-feil) mot faktiske kildeverdier.

**Dette er den første målingen på EKTE MEPS-data** — forrige måling
(`docs/specs/vaerpakker.md` §8, 2026-09-03 tidligere samme dag) brukte et
syntetisk, glatt felt (`tools/weather-pack/src/dry-run-fixtures.ts`) og
advarte eksplisitt om at et ekte felt trolig komprimerer dårligere. Den
advarselen var korrekt — se §3 under, tallet er dramatisk verre enn antatt.

---

## 1. Sammendrag (for Magnus — beslutningspunktet fase3-planen varslet)

**To reelle funn under bygging krevde kodefiks FØR tallene under er til å
stole på** (§4/§5) — begge var usett fordi hele test-suiten kjørte mot
enhetsløse syntetiske fixtures. Begge er nå rettet, testet og verifisert
mot ekte data (rundtur-feil ≤ dekodefeilbudsjettet på alle stikkprøver).

**Budsjett-tallet er dårlig nyhet:** vind alene for de to 2°-flisene ruten
faktisk krysser (5_28, 5_29 — se §2) er **27,4 MB etter delta+gzip**, fordi
ekte MEPS-vind **nesten ikke komprimerer** med delta+gzip-skjemaet
(faktor **1,06×**, mot det syntetiske feltets 7,29× og spec-ens eget
opprinnelige anslag på 1,5–2,5×). Legger man til strøm, bølge, tidevann og
metadata (estimert, ikke målt — §6), er en pakke **godt over 30 MB**
sannsynlig, kanskje allerede rundt eller over 40 MB. **Dette er nøyaktig
beslutningspunktet `fase3-plan-2026-09-02.md` varslet** («pakkestørrelse
vs. 40 MB, bølge 2»): anbefaling og alternativer i §7.

## 2. Oppsett

| Parameter | Verdi |
|---|---|
| Kjøring (init) | `meps_lagged_6_h_latest_2_5km_20260903T04Z.nc`, init **2026-09-03T04:00:00Z** — valgt av §11s ekte `selectEnsembleRun` etter å faktisk ha sjekket `ensemble_member`-dimensjonen for de 3 nyeste kjøringene i den ekte `mepslatest`-katalogen (alle 3 hadde `ensemble_member=30` — ingen fallback trengtes, men koden for det ble faktisk kjørt mot ekte kandidater, ikke bare enhetstestet) |
| Fliser (§7, 2°×2°) | `5_28` (10–12°Ø, 56–58°N — dekker Skagen-enden av ruten) og `5_29` (10–12°Ø, 58–60°N — dekker Skjæløy-enden). **Ingen enkelt 2°-flis dekker begge endepunktene** (grensen ved 58°N går midt i ruten) — et forventet, korrekt utslag av det faste flisrutenettet, ikke en feil |
| Indeksvindu 5_28 | y=[210,301], x=[299,353] → 92×55 = 5060 noder |
| Indeksvindu 5_29 | y=[299,390], x=[306,357] → 92×52 = 4784 noder |
| Oppløsning | 2,5 km (§9.1 — kontroll+alle 30 medlemmer, ikke bare kontroll) |
| Horisont/tidssteg | 48 t, 1 t (49 tidssteg, §9.1/§9.2) |
| Medlemmer | 30 (kontroll = medlem 0 + 29 øvrige, ensemble_member-dimensjonen hentet i ETT kall per variabel, §7 punkt 2) |
| Bit-bredde | 8-bit u/v (§9.1) |
| Henting | Sekvensielt (§16) — 4 kall totalt (x_wind_10m/y_wind_10m × 2 fliser), ingen parallelle sesjoner |

## 3. Målte tall (EKTE data)

| Flis | Noder | Rått (30 medl., u+v) | Delta+gzip | Faktor |
|---|---|---|---|---|
| 5_28 | 5060 | 14,88 MB | 14,29 MB | 1,04× |
| 5_29 | 4784 | 14,06 MB | 13,13 MB | 1,07× |
| **Sum (begge fliser — det ruten faktisk trenger)** | 9844 | **28,94 MB** | **27,41 MB** | **1,06×** |

Hentetid: 29,3 s (5_28) og 28,8 s (5_29) for x_wind_10m+y_wind_10m til
sammen, alle 30 medlemmer, 49 tidssteg — sekvensielt, godt innenfor
THREDDS' «unngå parallelle sesjoner»-krav uten at ytelsen ble et problem.

### Sammenligning mot syntetisk måling (samme dag, tidligere)

| | Syntetisk (`dry-run-fixtures.ts`) | EKTE MEPS (denne målingen) |
|---|---|---|
| Bbox/fliser | Én bbox, 8,0–12,6°Ø/57,4–59,7°N (104×108=11 232 noder) | To 2°-fliser, 10–12°Ø/56–60°N (9844 noder) |
| Rått | 31,49 MB | 28,94 MB (færre noder — proporsjonalt konsistent: 31,49×9844/11232=27,6 MB, stemmer godt) |
| Etter delta+gzip | **4,32 MB** | **27,41 MB** |
| Kompresjonsfaktor | **7,29×** | **1,06×** |

**Konklusjonen fra den syntetiske målingen var riktig i retning, men
UNDERVURDERTE effekten kraftig.** Teksten i `docs/specs/vaerpakker.md` §8
advarte om at et ekte felt «trolig komprimerer dårligere, kanskje i
nærheten av eller svakere enn» spec-ens opprinnelige 1,5–2,5×-anslag — det
faktiske tallet (1,06×) er svakere enn selv det pessimistiske alternativet.
Årsak (konsistent med advarselen): et glatt, analytisk syntetisk felt har
lite høyfrekvent struktur og komprimerer nesten vilkårlig godt; et ekte
MEPS-vindfelt har turbulent, lite korrelert rom-/tidsstruktur som
delta-kodingen (naboverdi-differanse) og gzip (byte-mønster-repetisjon)
begge biter dårlig i.

## 4. Reelt funn 1 (kritisk, RETTET): m/s→knop-konvertering manglet fullstendig

**Alvorlighetsgrad: høy — dette var en reell enhetsfeil i hele
vindrørledningen, ikke en kvantiseringsdetalj.** MEPS' `x_wind_10m`/
`y_wind_10m` leveres i **m/s** (bekreftet via ekte `.das`-oppslag:
`String units "m/s"`), mens `docs/specs/vaerpakker.md` §3s tabell krever
**knop** for det lagrede u/v-formatet. **Ingen kode noe sted i
`tools/weather-pack` eller `packages/weather` konverterte m/s→knop** — hele
test-suiten (før denne bølgen) kjørte utelukkende mot enhetsløse
syntetiske fixtures (`windToUV(10, 0)` osv., der «10» aldri ble forankret
i en fysisk kilde), så mangelen var usynlig helt til første rundtur mot
ekte data.

**Oppdaget ved:** første kjøring av `build-live-package.ts` ga et
KONSISTENT avvik mellom kildeverdi og dekodet verdi på nøyaktig faktoren
1,9438 (m/s→knop-konstanten) på alle 8 stikkprøvepunkter, med IDENTISK
retning (`fromDeg`) — et retningsriktig, men faktor-4-feil-i-fart resultat
er den klassiske signaturen på en manglende enhetskonvertering, ikke en
kvantiseringsfeil (som ville gitt liten, symmetrisk feil, ikke en
konsistent 2× faktor).

**Retting:** `pipeline.ts::convertWindComponentsToKnots` (ny, testet
funksjon) skalerer `u`/`v` med `3600/1852 ≈ 1,9438` FØR
`applyLccRotationToWindComponents`/`buildWindMemberLayers`. Kalt
eksplisitt i `build-live-package.ts` rett etter henting. **Bevisst IKKE**
lagt inn i den delte `fetchWindComponents` (brukt av både live og
dry-run) — dry-run-fixturene er allerede definert i knop-skala og har
aldri representert en fysisk m/s-kilde; å tvinge konvertering der ville
krevd å endre alle eksisterende testforventninger uten å faktisk teste noe
nytt. `fetchWindComponents`s dokumentasjonskommentar er oppdatert til å
gjøre denne enhetskontrakten eksplisitt for fremtidige kallere (spesielt
NorKyst/WAM800 — se §8 under, samme fellen gjelder trolig der).

**Verifisering etter retting:** rundtur-feil (kildeverdi → kvantisert →
dekodet) på 8 stikkprøvepunkter (4 per flis: hjørne t=0, midtpunkt t=24t,
motsatt hjørne t=48t, et vilkårlig punkt t=5t) er nå **0,0001–0,0286 kn**,
godt innenfor `maxDecodeErrorKn`-budsjettet (0,069–0,081 kn) §9.5s
TWS-vaktbånd garanterer. Se full tabell i `tools/weather-pack/out/
build-report.json` (git-ignorert, lokalt).

## 5. Reelt funn 2 (moderat, RETTET): griddrelativt vind, ikke sann nord

MEPS' native grid er Lambert Conformal Conic (`grid_mapping_name
"lambert_conformal_conic"`, `standard_parallel 63.3`,
`longitude_of_central_meridian 15.0` — verifisert via ekte `.das`-oppslag).
`x_wind_10m`/`y_wind_10m` har CF `standard_name "x_wind"`/`"y_wind"` —
komponenter langs GRIDDENS EGNE x/y-akser, IKKE nødvendigvis sann øst/nord
(det ville krevd `eastward_wind`/`northward_wind`). `packages/weather`s
`uvToWind` (§3) forutsetter sann øst/nord.

**Rettet** med `tools/weather-pack/src/lambert-rotation.ts`
(`rotateGridRelativeWindToTrueNorth`, standard meridiankonvergens-formel,
samme som WRF-python `uvmet`) — anvendt node for node (rotasjonsvinkelen
avhenger kun av lengdegrad) FØR kvantisering. Bevarer alltid fart eksakt,
endrer kun retning.

**Effektens størrelse, satt i kontekst:** ved bboxens vestkant (8,0°Ø) er
konvergensvinkelen ca. **6,3°**; ved østkanten av flisene brukt her
(12°Ø) ca. **2,7°**. Et empirisk sammenligningsforsøk mot api.met.no
Locationforecast ved Skagen-tilnærmingen (57,7178°N, 10,5854°Ø, samme
gyldighetstidspunkt) viste et MYE STØRRE avvik (ca. 39°, 215,6° rå mot
255° Locationforecast) enn rotasjonen alene forklarer (rotasjonen flytter
bare 215,6°→211,7° ved akkurat det punktet — bort fra, ikke mot,
Locationforecast-tallet). **Konklusjon: rotasjonsfeilen er reell og nå
rettet, men er IKKE hovedkilden til avvik mot Yr/Locationforecast** — den
sistnevnte er et etterbehandlet/blandet produkt (nedskalert, mulig annen
modellblanding), ikke rå MEPS-kontrollmedlem-verdi, og de to bør ikke
forventes å stemme eksakt overens uansett rotasjon. Se
`tools/weather-pack/src/lambert-rotation.ts`s doc-kommentar og
`lambert-rotation.test.ts` for full utledning og tallene.

## 6. Estimat: strøm, bølge, tidevann/MetAlerts, metadata (IKKE målt denne bølgen)

D4-beslutningen var uttrykkelig **vind-only** for denne bølgen — NorKyst
(strøm) og Oceanforecast/WAM800 (bølge) er **ikke hentet**. Pekeren
(`out/pointer-vaer-skandinavia.json`) markerer dette eksplisitt per flis
via det nye `missingFields`-feltet (§12/N2 — se §8 under), IKKE stille
utelatt:

```json
"missingFields": [
  { "field": "current", "sourceStatus": { "status": "degraded", "reason": "NorKyst-strøm mangler helt for denne pakken/flisen — ingen verdi gjettet" } },
  { "field": "waves", "sourceStatus": { "status": "degraded", "reason": "Oceanforecast/WAM800-bølge mangler helt for denne pakken/flisen — ingen verdi gjettet" } }
]
```

Estimat for totalen, basert på spec §8s placeholder-rekkevidde (IKKE målt
mot ekte NorKyst/Oceanforecast-data — samme forbehold spec-en selv gjorde):

| Post | Kilde for anslaget | Estimat for våre to fliser |
|---|---|---|
| Strøm (NorKyst, 800 m kyst/1,6 km utaskjærs) | §8s placeholder (2–4 MB for én bredere bbox) — **IKKE justert ned for at ekte data trolig komprimerer dårligere, av samme grunn som §3 over** | 2–5 MB (usikkert, ekstrapolert oppover pga. §3s lærdom) |
| Bølge | §7 punkt 5: første leveranse bruker Oceanforecast **punkt-API**, ikke gridded WAM800 — samme størrelsesorden som tidevann, ikke §8s gridded-placeholder | < 0,1 MB (punktbasert, ikke gridded ennå) |
| Tidevann/MetAlerts | punkt-JSON | < 0,1 MB |
| Metadata (per-felt header, per-subflis skala/offset) | §8 | < 0,3 MB for 2 fliser |
| **Sum, vind (MÅLT) + estimat for resten** | | **≈ 30,7–33,5 MB** |

**Dette estimatet er i seg selv sannsynligvis for optimistisk** — §3s
lærdom (ekte data komprimerer dramatisk dårligere enn syntetisk/antatt)
gjelder trolig NorKyst-strøm like mye som MEPS-vind, siden begge er ekte
atmosfærisk/oseanografisk felt med tilsvarende høyfrekvent struktur. En
ekte NorKyst-måling (neste bølge) kan fint lande nærmere 4–6 MB enn 2 MB.

## 7. Beslutningspunktet (fase3-planen varslet dette — til Magnus)

**Budsjettregelen (§8):** lander en ekte, målt rutepakke over 30 MB, skal
en budsjettrevisjon til ~40 MB legges fram for Magnus med det målte
tallet — IKKE ofre 2,5 km-oppløsningen. Vind alene (MÅLT, ekte data) er
**27,4 MB** for nøyaktig de to flisene Skjæløy–Skagen-ruten krysser. Legg
til selv et konservativt strøm-/bølge-/metadata-anslag, og totalen er
**over 30 MB nesten uansett** — sannsynligvis i 30–35 MB-området, med reell
risiko for å nærme seg 40 MB når strøm faktisk måles på ekte data (§6).

**Alternativer (ingen valgt her — dette er spec-eierens/Magnus' kall, ikke
en teknisk detalj):**

1. **Akseptér ~40 MB-budsjettet** (som spec-en selv foreslo som
   konsekvens, ikke som plan B). Fordel: ingen kvalitetstap, 2,5 km-
   oppløsningen (som §9s kvantiseringsmåling viste er avgjørende for
   avgangsrangeringen) beholdes fullt ut. Ulempe: dobler
   nedlastingskostnaden per rutepakke sammenlignet med det opprinnelige
   30 MB-målet; øker Cloudflare-egress/cache-fotavtrykk.
2. **Aktiver §8s hard degraderingsregel nå:** drop ensemble-halen med
   lavest forventet informasjonsverdi (f.eks. medlem 25–29), grovne
   tidsoppløsningen for medlemmenes hale, eller strengere NorKyst-
   nedtynning. Fordel: holder seg innenfor 30 MB uten arkitekturendring.
   Ulempe: reduserer ensemble-spredningen robusthetslaget (fase 4) skal
   bruke — direkte spenning mot CLAUDE.md-prinsipp 3 («ensemble er
   førsteklasses»).
3. **Undersøk om delta+gzip er feil kompresjonsstrategi for ekte MEPS-
   felt** (kompresjonsfaktor 1,06× er nær ingenting) — f.eks. en
   spatial DCT/wavelet-transform, eller en annen delta-retning
   (tidssteg-til-tidssteg ER allerede forsøkt via `deltaCoded`; kanskje
   medlem-til-medlem-delta, siden ensemble-medlemmer trolig korrelerer
   sterkere med hverandre enn naboceller gjør med hverandre tidsmessig,
   er en uutforsket retning). Fordel: kan gjenvinne mye av budsjettet
   uten kvalitetstap. Ulempe: uprøvd, krever egen liten spike før noen
   tallfestet gevinst kan loves — ikke en løsning som er klar i dag.

**Anbefaling (vær-analytikerens, ikke bindende):** mål NorKyst på ekte data
FØR en 40 MB-beslutning tas endelig — dagens estimat i §6 er for grovt til
å låse et tall på. Men gitt at vind ALENE allerede spiser 27,4 av et 30
MB-budsjett, er det verdt å undersøke alternativ 3 (medlem-til-medlem-
delta) parallelt, siden gevinstpotensialet der er stort nok (opp mot
7× i beste fall, jf. det syntetiske feltets tall, men trolig mindre for
ekte medlemsspredning) til at det er en billig ting å spike før man
aksepterer alternativ 1 eller 2.

## 8. Kildestatus/degradering (N2) — verifisert riktig satt

- `PackageHeader.sourceStatus` for alle 60 vind-medlemspakker (30×2
  fliser): `{status:"ok"}` — kjøringen var komplett (30/30 medlemmer),
  ingen fallback trengtes (§11).
- `pointer-vaer-skandinavia.json`s nye `missingFields`-liste per flis
  markerer strøm og bølge som `degraded`/manglende, ALDRI stille utelatt
  (§12/N2 — se §6). `PointerTileEntry.missingFields` er en ny, valgfri
  utvidelse av pekerformatet (`tools/weather-pack/src/package-writer.ts`),
  ikke-brytende for eksisterende `PointerFieldEntry`-forbrukere.

## 9. R2-opplasting — IKKE gjennomført (mangler bøtte)

`npx wrangler whoami` bekrefter innlogget konto (`maasao@gmail.com`,
konto-ID `bad55acd2b8...`), og `wrangler r2 bucket list` fungerer (token
har R2-tilgang) — men **ingen av kandidatbøttene finnes på kontoen ennå**
(kun en urelatert bøtte `beatthebingo-packs` fra et annet prosjekt).
`apps/worker/wrangler.toml` ble omdøpt til `morild-mirror`
(ADR-0006 pkt. 1, `MIRROR_BUCKET`-binding) av en parallell bølge (2B) samme
dag som denne målingen — testet begge navn for å dokumentere den faktiske
tilstanden uansett hvilket som gjaldt idet dette ble skrevet:

```
$ npx wrangler r2 object put "morild-data/weather/1/<hash>.bin" --file out/weather/1/<hash>.bin --remote
✘ [ERROR] The specified bucket does not exist.

$ npx wrangler r2 object put "morild-mirror/weather/1/<hash>.bin" --file out/weather/1/<hash>.bin --remote
✘ [ERROR] The specified bucket does not exist.
```

**Ingen ressurser opprettet** (per oppgavens regel). Gjeldende sannhet
(`apps/worker/wrangler.toml`, ADR-0006 pkt. 1) er `morild-mirror` — Magnus
må selv kjøre, når speil-bindingen er klar til første publisering:

```
npx wrangler r2 bucket create morild-mirror
# deretter, for HVER blob i tools/weather-pack/out/weather/1/:
npx wrangler r2 object put "morild-mirror/weather/1/<hash>.bin" --file "tools/weather-pack/out/weather/1/<hash>.bin" --remote
npx wrangler r2 object put "morild-mirror/pointer/vaer-skandinavia.json" --file "tools/weather-pack/out/pointer-vaer-skandinavia.json" --remote
```

Værpakker hører hjemme på **speil**-bindingen (åpne MET-avledede data),
ikke den personlige D1-bindingen — se ADR-0006 pkt. 1. Denne bølgen endrer
ikke `wrangler.toml` selv (det gjorde 2B, parallelt).

## 10. Testing og verifisering

- `pnpm test` (weather-pack + weather): se §11 for full liste — inkluderer
  nå `lambert-rotation.test.ts` (kjeglekonstant, konvergensvinkel, kjent
  verdi fra denne målingen), `convertWindComponentsToKnots`-testen i
  `pipeline.test.ts`, `applyLccRotationToWindComponents`-testen, og
  `live-source.test.ts` (katalog-/DDS-parsing, bbox-vindu-utledning — alle
  rene funksjoner, ingen nettverk i testene selv).
- Rundtur-verifisering mot EKTE data (ikke en enhetstest, en engangs-
  verifisering i `build-live-package.ts`s kjøring): se §4.

## 11. Avvik fra spec (§19-kandidater)

1. **§8s budsjettestimat (1,5–2,5× delta+gzip) er for optimistisk for ekte
   MEPS-vind** — målt faktor er 1,06×. Estimatet bør oppdateres eller
   eksplisitt merkes «kun gyldig for NorKyst inntil egen måling foreligger».
2. **`fetchWindComponents` mangler enhetskonvertering** (nå dokumentert som
   kallers ansvar, §4) — bør vurderes om dette er riktig kontrakt permanent,
   eller om fremtidig strøm/bølge-kode bør ha en delt, tvunget
   enhetskonverteringssteg i stedet for et dokumentert, men
   glemmbart, ansvar per kallsted.
3. **Griddrelativ vind-rotasjon var udokumentert i spec-en** før denne
   bølgen — `docs/specs/vaerpakker.md` §3/§4.1 bør få en setning om at
   MEPS' u/v er griddrelative og krever `lambert-rotation.ts`-steget, slik
   at ingen fremtidig re-implementasjon (f.eks. om pipelinen flyttes/
   skrives om) mister denne korreksjonen slik den opprinnelig manglet her.
4. **Pekerformatet fikk et nytt, ikke-spec-eid felt** (`missingFields`,
   §6/§8) — bør vurderes tatt inn i `docs/specs/vaerpakker.md` §5/§14 som
   en formell del av kontrakten, ikke bare en implementasjonsdetalj.
