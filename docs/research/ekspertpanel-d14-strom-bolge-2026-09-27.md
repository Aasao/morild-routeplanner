# Ekspertpanel D14 — strøm og bølger i værpakken

- Dato: 2026-09-27
- Status: ferdig. **Vedtatt av Magnus 2026-09-27 som anbefalt** (vaerpakker.md §18b, ADR-0007).
- Grunnlag: `docs/research/strom-bolge-forarbeid-2026-09-27.md` §7 (D14.1–D14.3).
- Metode: fire fageksperter (marin meteorolog, marinkartolog,
  værruting-produksjonsutvikler, ytelsesingeniør — sonnet), deretter
  djevelens advokat, lateral tenker og pragmatiker, tilsvar og votering.
  **Simulerte fagperspektiver, ikke reelle personer.** Panelet godkjenner
  ikke — Magnus vedtar.

## 1. Runde 1

### 1.1 Marin meteorolog

**D14.1 (a) + hev WAM800.** Oceanforecast er en kystnær punkt-API, aldri
en spektral bølgeflate; periode-kravet i F2.1/§4.3 er en kravspekfeil.
Skagerrak er fetch-begrenset: vindsjø Tp ≈ 3,5–4·√Hs (3–4,5 s ved Hs
1–2 m). **Fellen er et fast snitt-Tp:** Tp = 6 s gir bratthet 0,042 mot
reelle 0,122 ved Tp = 3,5 s og Hs = 1,5 m — ≈ 3× undervurdering. Hs-only-
fallback skal bruke en vindsjø-nedre-grense for Tp (kortest plausible
for gitt Hs), ikke et snitt. Dønning i vestre munning gir motsatt feil
(for streng) — brukervennlighetstap, ikke sikkerhetstap. **D14.2 (b)**
live proxy; plattformspørsmål. **D14.3: skeptisk til (a).** NorKysts
`straight_vertical_longitude_from_pole = 70°`; ved 8–11°Ø er lokal
gridrotasjon ≈ 59–62°, en annen størrelsesorden enn MEPS. Behandles
indeksvinduet som et jevnt lat/lon-rutenett, blir posisjonene grovt
feil. Trygt bare om hvert oppslag bruker de leverte 2D lat/lon-arrayene
per node (nearest-neighbour): da er feilen ≤ halv celle (~400 m kyst,
~1,2 km ute). Må være et krav i spec-en, ikke «mål senere». **Avviser:**
fast snitt-Tp; (a) uten kodesjekk av lat/lon per node; Oceanforecast-
punktstrøm som kilde (kun kryssjekk). **Trenger målt:** Tp-fordeling
gitt Hs i Skagerrak (NORA3/WAM-reanalyse); om oppslaget bruker lat/lon
per node; kystsone-andel av korridoren.

### 1.2 Marinkartolog

**D14.1:** Hs-only er en annen fareklasse, ikke «litt mindre presis».
Mangelen er strukturell ⇒ alltid «periode ukjent, konservativ grense
brukt», aldri «0,6 m, OK» uten kvalifikator. Fjern kravspekens påstand om
periode; WAM800 til reell prioritet. **D14.2 (b)**, men hvert bølgesample
skal bære avstand til nærmeste punkt; UI degraderer «bølgedekning:
punktbasert, X nm unna». **D14.3 — hovedbekymring:** strøm i trange sund
(Drøbaksundet, Hvaler) kan snu og doble fart over noen hundre meter; en
posisjonsfeil kan gjøre motstrøm til medstrøm. **Fill-verdier:** en
`_FillValue`-celle skal ALDRI dekodes som {0,0} (stillestående vann ser
trygt ut) — den skal bli `undefined`, og nedtynning/midling må maskere
fill før midling (ellers dempet, plausibel feilverdi ved en molo). Bevis
i enhetstest. **Kystnære celler:** innenfor 2–3 celler (1,6–2,4 km) fra
kystlinjen et eksplisitt usikkerhetspåslag (strøm-analog til
`maxDecodeErrorKn`). **UI:** i trange sund synlig «strømdata: 800 m-grid,
posisjonsnøyaktighet i denne sonen ikke verifisert» der ruten leses.
**Avviser:** «leilighetsvis» i spec-språket; fill som tall; forenklingen i
kystsonen uten dokumentert feilmargin; punktbølge uten avstand i UI.
**Trenger målt:** posisjonsfeil indeks→sann lat/lon i sund-geometri;
fill-andel i kystutsnitt; hvilken `depth`-indeks som er overflaten
(«antatt 0, ikke verifisert» — feil lag gir systematisk feil strøm);
om WAM800 faktisk gir periode.

### 1.3 Værruting-produksjonsutvikler

**D14.1 (a), men strengere UI:** kommersielle produkter viser aldri Hs
alene som fullverdig derating; uten periode skjuler de bølgederating
eller henter periode fra et annet produkt. Strukturelt Hs-only skal ha
egen visuell tilstand («bølgeperiode ukjent, viser konservativt
anslag»), og et strekk med Hs > 0,5–1 m skal aldri vises rent grønt.
Sett utløpsbetingelse for WAM800-spiken, ellers blir «midlertidig»
permanent. **D14.2 (b)**, med tidsstempel på bølgepunktene i UI.
**D14.3 (a)**, men posisjonsavviket måles i minst ett trangt sund FØR
strøm påvirker robusthetsscoren. **Avviser:** at vind-alene fortsetter å
gi gjennomførbarhetsandel i UI mens dekning er «partial»; punktbølge som
R2-flis. **Trenger målt:** reprojeksjonsavvik i sund; kystsone-andel;
byggetid; integrasjonstest på ekte pakke at `coverage.weather` går fra
«partial» for minst ett ekte medlem; A/B av Hs-only mot fasit med
periode på v1-logger.

### 1.4 Ytelsesingeniør

**D14.1 (a)**, og tell `tpS = undefined` i healthcheck (tall til
WAM800-prioriteringen); avvis (c). **D14.2 (b)**, med to krav: (1)
frakoblet: bufre siste vellykkede punktsvar per korridor i klienten
(IndexedDB/Cache), og si «bølgedata krever nett» når det mangler; (2)
**determinisme:** proxyen returnerer én tidsstemplet, hash-bar payload
som fryses før ensemblet og gjenbrukes av alle 30 medlemmer — aldri
nytt kall midt i et ensemble (ellers ser medlem 3 og 27 ulik bølge).
Punktbølge utenfor batchbudsjettet; strøm (13–16 MB) står da alene mot
30/50 MB-taket — 40 MB-revisjonen må trolig effektueres. **Avviser:**
punktbølge i `WaveLayers`; punktbølge i batchbudsjettet; cache-vinduet
som erstatning for fryseregel. **Trenger målt:** ekte NorKyst-størrelse
på kystflis-geometrien; byggetid; punktantall per korridor; proxy-
latens under ensemble mot 20 req/s.

## 2. Runde 2 — utfordrere

### 2.1 Djevelens advokat

1. «Kravspekfeil» (meteorolog) er en beslutning forkledd som fakta:
   F2.1 sier «(med periode!)» — et bevisst krav. Å senke det er Magnus'
   valg.
2. Vindsjø-formelen Tp ≈ 3,5–4·√Hs er selv et umålt anslag; panelet
   anbefaler en konkret nedre grense ingen har hentet data for
   (NORA3/WAM).
3. «Punktbølge er som tidevann» er en analogi: tidevann er ~30 faste
   havner, bølge langs ruten er rute-drevet. Om D14.2 (b) bryter F2.2
   (ingen on-demand-per-rute for felt) er ikke avklart.
4. Fryseregelen (ytelsesingeniør) og «tidsstempel i UI» (værruting)
   kolliderer ikke egentlig, men ingen har koblet dem: ett fryst
   øyeblikksbilde må vises som det.
5. Ingen regner alternativkostnaden: proxy-vei og Hs-only-formel kan
   kastes når WAM800 leverer periode.
Krav: Tp-fordeling fra data, frist/exit-kriterium for WAM800, skriftlig
avklaring av F2.2 før arkitekturen bygges.

### 2.2 Lateral tenker

1. **Derivér Tp fra MEPS-vinden** vi allerede har (fetch-begrenset
   vindsjø), per medlem, deterministisk, kalibrert mot v1-loggene — null
   ny kilde, men endrer derating-semantikk ⇒ ADR.
2. **Punkt eller flate for strøm i fase 1?** Oceanforecast-punktstrøm
   via proxy ville unngå projeksjonsproblemet nå — men er grovere
   nettopp i sundene (meteorologen: «kun kryssjekk»).
3. **Mål reprojeksjonsfeilen FØR pipelinen bygges:** isolert spike som
   slår opp Drøbaksundet mot NorKysts 2D lat/lon-arrays vs naivt
   indeksvindu.
4. **DMI/SMHI** regionale bølgemodeller med periode — ny kilde, krever
   vilkårsdokument.
Feilstilt: D14.1 mangler «derivér selv»; D14.3 forutsetter gridded
strøm før «punkt eller flate» er spurt.

### 2.3 Pragmatiker

`environmentAt` krever både strøm og bølge definert for full dekning ⇒
begge må inn før trafikklyset får innhold. **Strøm først (gridded, R2),
så punktbølge (proxy)** som to separate, verifiserbare steg. **Må med
nå:** fill ⇒ `undefined` før avskalering; nearest-neighbour mot kildens
lat/lon per node (ikke vindens forenkling); Hs-only synlig i UI; fryst
bølgesvar per ensemble. **Kan vente:** WAM800-spike (prioritet opp, ikke
blokkerende), full kystflis-geometri (§9.6 — hele korridoren som
kystsone nå), avstand-til-punkt i UI, depth-indeks-sjekk parallelt.
**For dyrt:** punktgrid-hybrid, ekte stereografisk reprojeksjon (NN mot
lat/lon-arrays er billigere), punktbølge i `WaveLayers`.

## 3. Tilsvar

- **Meteorolog:** trekker «kravspekfeil» — F2.1s periode-krav er Magnus'
  bevisste krav; å senke det er en anbefaling, ikke en konklusjon.
  Nedgraderer Tp ≈ 3,5–4·√Hs fra «nedre grense» til «foreløpig
  plassholder, merket usikker» til NORA3/WAM-fordelingen er hentet;
  ingen hardkodet konstant i produksjon før det. Tp-fra-vind (lateral):
  godt tillegg, eget ADR-spor, ikke blokkerende.
- **Marinkartolog:** analogien punktbølge/tidevann er svakere enn
  fremstilt, men avstand-til-punkt i UI kreves uansett arkitektur — en
  grov kategori («< 5 / 5–20 / > 20 nm») godtas som minimum, fravær ikke.
  Avviser punktstrøm som primærkilde: grovest nettopp i sundene.
- **Værruting-utvikler:** kobler tidsstempel og fryseregel til ett krav:
  ett fryst, tidsstemplet svar for hele ensemblet, vist som «bølgedata fra
  kl. NN:NN, gjelder hele ensemblet». Exit-kriterium for WAM800 nå, ellers
  blir midlertidig kode permanent.
- **Ytelsesingeniør:** F2.2 er skrevet for gridded batch; et punkt-API kan
  ikke forhåndsbygges — men unntaket må skrives i spec før bygging.
  Proxy-infrastrukturen er ikke bortkastet ved WAM800 (flate vs
  rute-punkt); kun Hs-only-grenen kastes. Kontrakt:
  `{payload, fetchedAtEpochS, hash}`.

## 4. Votering

| | Meteorolog | Marinkartolog | Værruting | Ytelsesing. |
|---|---|---|---|---|
| **D14.1 (a)** Hs nå, Tp-nedre-grense, egen UI-tilstand, WAM800 m/exit | ENDRE: Tp-grense foreløpig/merket usikker til NORA3; ikke «kravspekfeil» | GODKJENN | ENDRE: Tp-grense etterprøves mot NORA3/WAM før «konservativ»; exit-kriterium skrevet nå | GODKJENN (+ telle `tpS=undefined` i healthcheck) |
| D14.1 (b) vent på WAM800 | AVVIS | — | — | — |
| D14.1 (c) revider F2.1 | AVVIS nå | AVVIS | — | — |
| D14.1 (d) Tp fra MEPS-vind | GODKJENN som parallelt ADR-spor | — | — | — |
| **D14.2 (b)** proxy m/fryst svar, buffer, avstand, F2.2 i spec | GODKJENN | ENDRE: avstand-til-punkt kan ikke utsettes (grov kategori OK) | ENDRE: tidsstempel + avstand som én degraderingstekst; F2.2 før kode | GODKJENN (F2.2 før bygging) |
| D14.2 (a)/(c) | AVVIS | AVVIS | AVVIS (a) | — |
| D14.3 (a) naiv forenkling | AVVIS | AVVIS | — | — |
| **D14.3 (a′)** NN mot lat/lon per node, fill ⇒ undefined, kystpåslag, UI-merking, depth verifisert, spike først | GODKJENN | GODKJENN | GODKJENN | GODKJENN |
| D14.3 (b) ekte reprojeksjon | ENDRE: utsett, mål om (a′) holder | — | — | — |
| D14.3 (c) punktstrøm | reserve hvis gridded forsinkes | AVVIS som primær | — | — |
| **Rekkefølge (R)** spike → strøm → punktbølge → remåling | GODKJENN | GODKJENN | GODKJENN (AVVIS R′) | GODKJENN |

Uenighet som står: ingen om retningen. Kartologen krever avstand-til-
punkt fra første versjon (pragmatikeren ville utsette); tatt inn.

## 5. Hovedsesjonens syntese

1. **D14.3 er skjerpet av panelet:** meteorologens funn (NorKysts
   polarstereografiske grid er dreid ~60° i Skagerrak) gjør vindens
   indeksvindu-forenkling uakseptabel for strøm. Enstemmig: nearest-
   neighbour mot kildens egne lat/lon per node, fill ⇒ `undefined`, og en
   isolert Drøbaksund-spike før pipelinen bygges.
2. **D14.1:** Hs nå, med en Tp-nedre-grense som er eksplisitt foreløpig
   til den er etterprøvd mot NORA3/WAM-data, synlig Hs-only-tilstand, og
   et exit-kriterium for WAM800. F2.1 endres ikke uten Magnus. Tp fra
   MEPS-vind er et parallelt ADR-spor.
3. **D14.2:** proxy med én kontrakt `{payload, fetchedAtEpochS, hash}`
   fryst per ensemble; tidsstempel og avstand-til-punkt som én synlig
   degraderingstekst; F2.2-unntaket skrives i spec før kode.
4. Strøm alene gir ikke trafikklyset innhold (`environmentAt` krever
   både strøm og bølge) — rekkefølgen er spike → strøm → punktbølge →
   remåling, og trafikklyset får innhold først etter punktbølgen.
