---
name: norkyst-oceanforecast-kilde-egenskaper
description: NorKyst v3 (THREDDS) og Oceanforecast 2.0 (api.met.no) kildeegenskaper — enheter, fill-value, buet domene/aliasing-felle, målt gridrotasjon, D14.3-geometrispikens tall, manglende Tp-felt
metadata:
  type: project
---

Arbeidsnotater om strøm-/bølgekildene, verifisert 2026-09-27 (research-bølge,
`docs/research/strom-bolge-forarbeid-2026-09-27.md` er hovedleveransen —
dette er huskeliste for neste gang noen bygger produsentsiden i
`tools/weather-pack`).

- **NorKyst `u_eastward`/`v_northward` er m/s** (`units "meter second-1"` i
  `.das`), samme felle-klasse som MEPS-vind. Konverter til knop eksplisitt.
- **NorKyst trenger INGEN vektor-rotasjon** — `standard_name` er
  `eastward_sea_water_velocity`/`northward_sea_water_velocity`, altså SANN
  øst/nord, til forskjell fra MEPS' griddrelative x/y-vind. Risikoen ligger
  i grid-INDEKSOPPSLAG (polar stereografisk, `grid_mapping "projection_stere"`,
  egne 2D `lat`/`lon`-arrays samme shape som `u_eastward`), ikke i retning.
- **Kilden er selv Int16-pakket**: `_FillValue -32767`, `scale_factor 0.001`,
  `add_offset 0.0`. MÅ sjekke rå Int16 `== -32767` FØR avskalering — ellers
  blir land/no-data til en falsk `-32.767 m/s`-strømverdi (katastrofalt for
  `maxCurrentKn`, som ikke har noen konservativ retning å falle tilbake på).
- **Depth-dimensjon finnes** (`depth[depth=15]`) — overflatelaget er ANTATT
  indeks 0, IKKE bekreftet eksakt i denne bølgen. Verifiser før bruk.
- **Tidsaksen er en løpende aggregering** (`time = 23999` over hele
  2024-01-01→nå+5d), IKKE én ny fil per kjøring som MEPS. En NorKyst-
  indekscache kan ikke nøkles på kjøringsnavn slik `.grid-index-cache.json`
  gjør for MEPS — trenger egen cache-nøkkel-strategi (bbox+dato-vindu).
- **Domenestørrelse:** 1148×2747 noder (Y×X), polar stereografisk (`straight_
  vertical_longitude_from_pole 70`, `latitude_of_projection_origin 90`,
  `standard_parallel 60`).
- **Ingen ensemble** — bekreftet, kun `_m00_be` («member 00, best estimate»).
- **Oceanforecast 2.0 (api.met.no) har INGEN periode-felt (Tp) i den
  faktiske JSON-responsen** — verifisert med rått `curl` mot
  `.../oceanforecast/2.0/complete?lat=..&lon=..`. `details` har nøyaktig
  fem nøkler: `sea_surface_wave_from_direction`, `sea_surface_wave_height`,
  `sea_water_speed`, `sea_water_temperature`, `sea_water_to_direction`.
  Dette strider mot kravspekens F2.1 («bølger med periode!») og
  `docs/specs/vaerpakker.md` §4.3 — se D14.1 i research-dokumentet, ikke
  løst ennå. IKKE anta at "av og til mangler Tp"-degraderingsveien
  (allerede designet i §12) er riktig ramme her — for Oceanparcels er det
  STRUKTURELT ALLTID fraværende, ikke leilighetsvis.
- **Oceanforecast gir gratis punkt-strøm også** (`sea_water_speed`/
  `sea_water_to_direction`) — nyttig kryssjekk mot NorKyst, ikke en
  erstatning (punkt, ikke gridded).
- **Retningskonvensjoner bekreftet konsistente med spec:** bølge FRA
  (`sea_surface_wave_from_direction`), strøm MOT (`sea_water_to_direction`)
  — samme par som NorKyst/MEPS.
- **Horisont:** ~8,5 døgn, time-oppløsning gjennomgående (205 tidssteg i
  stikkprøven) — god margin utover MEPS/NorKyst.
- **Punktbølge passer strukturelt IKKE inn i `WaveLayers`/`LayerLookup`**
  (bygget for grid). Anbefalt (ikke besluttet): behandle som tidevann —
  egen worker-proxy-vei, ikke R2-batch-pipelinen (D14.2 i research-dokumentet).
- **`depth[0] = 0.0`** — overflate-indeksen ER 0, bekreftet direkte (ikke
  lenger antatt). Verifisert med en firehjørne-`.ascii`-probe av `depth`.
- **NorKyst-domenet er en LANG, BUET STRIPE langs hele norskekysten**
  (54–76°N, 8,7°Ø til 37,5°Ø/-4,6°Ø ved de fire hjørnene), ikke en enkel
  rektangulær utsnitt-projeksjon. `y` OG `x` øker begge langs kystens
  krumme forløp. **Konsekvens: bbox-containment-søk over en grovt striden
  prøve av domenet ALIASER** — kan plukke opp et koordinatpar fra et helt
  annet kyststrekk med tilfeldig overlappende lat/lon-rekkevidde (fant
  dette konkret for Drøbaksund 2026-09-27, spike 05: første forsøk traff
  et sørligere strekk, ~1° feil i bredde). **Fiks: nærmeste-punkt-søk
  (min haversine-avstand) for grov lokalisering, deretter et lokalt,
  geografisk sammenhengende finoppslag** (±130 native celler var nok til
  å romme en hel 1°-flis i Skagerrak/Oslofjord-området). Se
  `docs/research/spike-norkyst-geometri-2026-09-27.md`.
- **Målt lokal gridrotasjon: konsekvent ~59–60°** (grid-x mot sann øst) i
  Drøbaksund, Hvaler og åpent Skagerrak — bekrefter spec-antakelsen
  tallfestet, stabil over hele korridoren.
- **D14.3 tallfestet**: vindens indeksvindu-forenkling
  (`windLayerGeometry`/`sampleFromFetchedGrid` i `pipeline.ts`) gir for
  NorKyst 15–62 km posisjonsfeil, opptil 147° retningsfeil, og treffer
  land (`_FillValue`) i de fleste forsøk i trange sund (Drøbaksund 87 %,
  Hvaler 63 % fylt i en 1°-flis) — ALDRI samme node som NN i 9/9
  testpunkter. NN traff konsekvent 280–450 m fra testpunktet (riktig
  størrelsesorden for 800 m-grid). Ikke gjenbruk vind-geometrien for strøm
  i noen form — egen NN-basert funksjon fra bunnen av.
