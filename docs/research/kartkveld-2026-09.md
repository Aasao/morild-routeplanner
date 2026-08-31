# Kartplotter-kveld — verifiseringstabell (Magnus)

- Dato skrevet: 2026-08-31. Utført: **[fylles av Magnus]**.
- Grunnlag: `docs/research/steg3-plan-2026-08-31.md` §2 pkt. 2 (kartplotter-
  kvelden er en PORT, ikke etterarbeid) og kartologens opplegg i
  `docs/research/ekspertpanel-2026-08-31.md` §4 («Golden-punktene er
  sirkulære i dag») + runde 3-svaret hans (enkleste påstander først, minimal
  tabell fylt FØR testkjøring, skjermbilde per punkt).
- Kobling til spec: `docs/specs/farbarhetsmaske.md` §6.3 (kart-først-
  protokollen, E8-lite) og §6.3.1/§6.3.2 (kjent-svakhet/guardrail-golden).
- Kodebasis denne kvelden verifiseres mot: `packages/charts/src/
  golden-oslofjord-hvaler.test.ts` og `guardrail-golden.test.ts`, fixture
  `packages/charts/testdata/oslofjord-hvaler.json.gz` (bbox
  **59,05–59,30° N, 10,60–11,00° Ø** — ALLE nye punkter MÅ ligge innenfor
  denne bboksen for å kunne testes mot koden i det hele tatt; utenfor gir
  bare `utenfor-pakke`, ikke en fasit-verifisering).

## Instruks (les FØR du åpner en editor eller kjører en eneste test)

**Kart-først, kode etterpå — i denne rekkefølgen, ingen snarveier:**

1. **Velg punktet i et offisielt sjøkart** — Kartverkets «Se sjøkart»/WMTS
   (https://kart.kartverket.no/sjokart) eller papirkart — ALDRI ved å kjøre
   koden mot fikstur-geometrien og se hva den svarer. Noter kartkilde
   (WMTS-utsnitt/kartblad) + dato/versjon du leste av, i kolonnen
   «Kartkilde + dato».
2. **Fyll «Hva kartet viser», «Forventet nivå», «CATZOC» og «Avstand til
   avgjørende grense» FØR du kjører noen test.** Dette er selve poenget
   (E8-lite, spec §6.3): testen skal reprodusere et allerede nedskrevet
   forventet svar, ikke omvendt. Skriv i tabellen med penn/tastatur FØR du
   åpner `packages/charts`.
3. **Ta et skjermbilde per punkt** og lagre det i
   `docs/research/kartkveld-bilder/<punkt-id>.png` (opprett mappen om den
   ikke finnes — den er bevisst IKKE opprettet av denne rapporten, kun
   referert). Filnavn = punkt-ID-kolonnen under, f.eks.
   `skjaer-26807.png`, `nytt-guardrail-grunne-768137.png`.
4. **Kjør testen etterpå.** Avvik mellom forventet (kolonne 8) og faktisk
   testresultat er enten (a) en feil i koden — meld til kartdata-agenten
   med punkt-ID og skjermbilde, eller (b) en feil i din avlesning — noter
   hvilket i «Verifisert»-kolonnen. Ikke endre testens forventning uten å
   forstå hvilket av de to det er.
5. **Avstand til avgjørende grense:** velg punkter som ligger tydelig unna
   (kartologens tommelfingerregel: **≥ 50–100 m** fra grensen som avgjør
   `no-go`/`trygt`) MED MINDRE punktet eksplisitt skal teste selve grensen
   (parene i del 2 — der er nærheten til grensen hele poenget, og avstanden
   skal måles og noteres presist, ikke bare anslås).
6. **Proveniens er bevisst forenklet** (Magnus, ikke et fullt CI-skjema): én
   tabellrad per punkt er nok, ingen egen signaturprosess utover
   «Verifisert»-kolonnen.

## Del 1 — de 11 eksisterende golden-punktene (re-verifisering)

Disse ble plukket med `turf.pointOnFeature`/`turf.centroid` FRA samme
fikstur-geometri som testes (se toppkommentaren i
`golden-oslofjord-hvaler.test.ts`) — de beviser i dag kun intern konsistens,
ikke samsvar med virkeligheten. Rekkefølge etter kartologens prinsipp:
no-go-punkter først (sterkest/enklest påstand — «dette IKKE farbart»), så
farled-trygt (sterkeste positive påstand — «dette ER farbart»), så
kjent-svakhet og intern-konsistens (lavest prioritet — dokumenterer
kodeatferd, ikke uavhengig sjøkart-sannhet, se merknad per rad).

| # | Kategori | Punkt-ID (kilde) | Lat | Lon | Krav (m) | Dagens testforventning | Kartkilde + dato | Hva kartet viser | CATZOC | Avstand til avgjørende grense | Verifisert |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | No-go, skjær | `skjaer.26807` | 59,066006 | 10,998842 | 2,6 | `no-go` (skjaer-buffer, 20 m) | | | | | |
| 2 | No-go, tørrfall | tørrfall v/Hvaler (uten egen ID i fixturen) | 59,1740875 | 10,5996165 | 2,6 | `no-go` (torrfall) | | | | | |
| 3 | No-go, dybdebånd | «intern konsistens»-punkt i 0–2 m-bånd | 59,22026955 | 10,703338 | 2,6 | `no-go` (grunnere-enn-sikkerhetskontur) | | | | | |
| 4 | No-go, dybdebånd (regresjon) | samme punkt, strengere krav | 59,22026955 | 10,703338 | 1,5 | `no-go` (samme bånd — dokumenterer at strengere krav aldri gir bedre resultat) | | | | | |
| 5 | Åpen led, farled | `farledsareal layer_554.21`, flis 236 | 59,129181 | 10,791009 | 2,6 | `trygt` | | | | | |
| 6 | Åpen led, farled | `farledsareal layer_554.19`, flis 236 | 59,125 | 10,58751 | 2,6 | `trygt` | | | | | |
| 7 | Åpen led, farled | `farledsareal layer_554.21`, flis 237 | 59,375 | 10,6395205 | 2,6 | `trygt` | | | | | |
| 8 | KJENT SVAKHET (åpen kurve, §6.3.1) | `dybdekurve.728354` (5 m, åpen ring, droppet) | 59,027085 | 10,992546 | 5,5 | `usikkert` — **uønsket**: kartet dokumenterer 5 m her, koden burde gi `no-go` for et krav på 5,5 m. Bekreft at kartet FAKTISK viser ~5 m-dybde/en avgrenset grunne akkurat her — det er selve påstanden testen dokumenterer som et hull | | | | | |
| 9 | Intern konsistens, CATZOC | CATZOC-C-sone | 59,2030305 | 10,941958 | 2,6 | `usikkert` (lav-datakvalitet) | | | | | |
| 10 | Intern konsistens, CATZOC | CATZOC-A1-sone (uten farled) | 59,25 | 10,716878 | 2,6 | `trygt` | | | | | |
| 11 | Intern konsistens, dekning | punkt langt utenfor pakken | 10 | 10 | 2,6 | `dekning: "utenfor-pakke"` (ikke et trust-nivå — bekreft bare at N1/N2-fallbacken IKKE viser `trygt`) | n/a — utenfor kartlagt område, ingen sjøkart-verifisering mulig eller nødvendig | n/a | n/a | n/a | strukturell, ikke geografisk |

**Merknad rad 4:** samme geografiske punkt som rad 3 — trenger ikke eget
skjermbilde/kartoppslag, kun bekreftelse i «Verifisert» at koden fortsatt
sperrer ved et strengere krav.

**Merknad rad 8 og 9–10:** disse er per spec §6.3/§6.3.1 eksplisitt merket
som ikke fullt uavhengig sjøkart-verifiserbare (rad 8 dokumenterer en KJENT
KODE-SVAKHET, rad 9–10 dokumenterer intern konsistens i CATZOC-håndteringen)
— fyll likevel «Hva kartet viser» der det er mulig (spesielt rad 8: er det
faktisk en grunne/dybdelinje der kartet viser ~5 m?), men ikke bruk avvik her
som bevis på en feil i koden alene.

## Del 2 — fem nye punkter (konkret veiledning per type)

**Alle nye punkter MÅ ligge innenfor fixturens bbox (59,05–59,30° N,
10,60–11,00° Ø)** for å kunne kjøres mot koden. Kolonnene «Punkt A» og
«Punkt B» brukes ulikt per rad — se veiledningsteksten i hver rad for hva de
betyr der.

| # | Type | Veiledning (les før du velger punkt) | Punkt A (lat, lon) | Punkt B (lat, lon) | Dagens/forventet kodeatferd | Kartkilde + dato | Hva kartet viser | CATZOC | Avstand til avgjørende grense | Verifisert |
|---|---|---|---|---|---|---|---|---|---|---|
| 12 | Guardrail (§3.4 «Guardrail for feilklassifiserte bånd») | **Prefylt kandidat, slått opp i fixturen (ikke sirkulært — guardrailen validerer intern QA-konsistens, ikke sjøkart-sannhet, jf. spec §6.3.2):** `grunne.768137`, sondert til **2,62 m**, men ligger geometrisk i det (feilaktig konstruerte) 3–5 m-båndet — en av 503 QA-brudd som ga 273 flaggede bånd-delpolygoner (`tools/chart-pack` build-logg 2026-08-31). Valgt FORDI 2,62 m er **2 cm dypere enn Morilds standardkrav (2,6 m)**: VALSOU-punktregelen alene slipper punktet gjennom uendret (2,62 ≥ 2,6/2,0 — bekreftet empirisk, se kodekommentar under), så resultatet i dag (`usikkert`, årsak `usikker-sondering-i-baand`) kommer UTELUKKENDE fra delpolygon-taket — dette isolerer guardrail-mekanismen renere enn den eksisterende `guardrail-golden.test.ts`-fasiten (`grunne.7257`, 39 m, hvor 39 m er så dypt at poenget med taket lett drukner). **På kartet:** bekreft om Kartverket faktisk har en sondering/grunne nær denne posisjonen med dybde i nærheten av 2,6 m — dette er sikkerhetskritisk for Morilds faktiske dypgang, så avviket er verdt å sjekke uansett testutfall. | 59,062333 / 10,979345 | (ikke i bruk for denne raden) | `farbar` ved krav 2,6 m OG 2,0 m: `usikkert`, årsak `usikker-sondering-i-baand` (verifisert empirisk mot bygget fixture 2026-08-31 — IKKE no-go fra VALSOU alene på noen av de to kravene) | | | | | |
| 13 | Par innenfor/utenfor — skjær, 20 m-buffer | Bruk skjæret fra rad 1 (`skjaer.26807`) som anker — sentrum er allerede kartlagt der (59,066006° N, 10,998842° Ø), buffer er standard **20 m** (§8 pkt. 3). Punkt A og B under er BEREGNEDE forslag (10 m og 30 m rett nord for senteret) — **kun utgangspunkt for kveldens sjøkart-lesning, ikke fasit**: se på det faktiske sjøkartet ved dette skjæret og velg selv om du vil bruke de foreslåtte punktene eller egne, så lenge A er tydelig < 20 m fra det avmerkede skjæret og B er tydelig > 20 m unna (mål avstanden på kartet, ikke bare anslå). Forventning: A `no-go` (skjaer-buffer), B ikke `no-go` FRA DETTE skjæret spesifikt (kan fortsatt bli `usikkert`/`no-go` av andre årsaker — sjekk `aarsaker`-listen for HVORFOR). | 59,066096 / 10,998842 (≈10 m N for senter — innenfor) | 59,066275 / 10,998842 (≈30 m N for senter — utenfor) | A: `no-go` (skjaer-buffer). B: `aarsaker` skal IKKE inneholde `skjaer-buffer` for dette skjæret | | | | | |
| 14 | Par innenfor/utenfor — tørrfallsgrense | Bruk tørrfallspolygonet fra rad 2 som anker (rundt 59,174° N, 10,600° Ø, Hvaler). Punkt B under (≈15 m nord for polygonets nordligste kartlagte kant i fixturen) er beregnet fra SAMME kildepolygon som testes — behandle det som et startpunkt for kveldens sjøkart-lesning, ikke som en uavhengig verifisering i seg selv: se på det faktiske sjøkartet og bekreft/juster til et punkt du selv kan se tydelig ligger i alltid-vått vann rett utenfor den tørrlagte konturen. Mål avstanden fra grensen på kartet og noter den. | 59,1740875 / 10,5996165 (innenfor — samme som rad 2) | 59,175676 / 10,5996165 (beregnet ≈15 m nord for polygonets nordkant — verifiser mot ekte kart) | A: `no-go` (torrfall). B: `aarsaker` skal IKKE inneholde `torrfall` | | | | | |
| 15 | Kjent-svakhet (åpen kurve) — NY, uavhengig av rad 8 | Rad 8 dokumenterer ÉN kjent forekomst av åpne-kurver-hullet (§6.3.1/§4.1). Finn en ANNEN, uavhengig forekomst: se etter et sted i sjøkartet (innenfor bboksen) der en grunne/dybdelinje krysser nær en kartblad-/uttrekksgrense (i denne fixturens tilfelle: nær bbox-kantene 59,05°/59,30°N eller 10,60°/11,00°Ø, ELLER — mer robust — se etter en synlig, navngitt grunne/2–10 m-dybdelinje på kartet som IKKE gir `no-go` når du tester den med et krav dypere enn den kartlagte dybden). Noter kartbladreferansen presist, siden selve poenget er at kurven «forsvinner» ved en kartblad-/uttrekksgrense. Forventet AVVIK (samme retning som rad 8): kartet viser en reell grunne, koden svarer `usikkert`. | **[Magnus velger og fyller]** | (ikke i bruk) | Forventet (uønsket, kjent): `usikkert` der kartet dokumenterer en grunnere dybde enn kravet | | | | | |
| 16 | R3-offing (korde som runder nes) | Finn et nes/en odde i skjærgården (innenfor bboksen — Hvaler/Skjæløy-området er tett nok til at dette bør finnes flere steder) der to punkter A og B **hver for seg** har god klaring fra land (bruk `nermesteFareAvstandNm` eller bare visuell avstand på kartet ≥ 2 × `minOffingNm` = 2 × 0,5 nm = 1,0 nm fra land ved hvert punkt), MEN der den RETTE korden mellom dem passerer nærmere enn `minOffingNm` (0,5 nm ≈ 926 m, `docs/specs/rutemotor.md` §5.3.2/R3) fra selve neset. Dette er kartnivå-analogen til den faktiske R3-lekkasjen funnet i `bohuslan-trange-sund`-golden-ruten (`docs/specs/rutemotor.md` endringslogg 2026-08-31 (4)): endepunktene alene ser trygge ut, midten av korden gjør det ikke. Test BEGGE: `farbar(A)`/`farbar(B)` isolert (forvent `trygt`/`usikkert`, ikke `no-go`) OG `segmentTest(A, B, …)` (forvent at segmenttesten fanger opp det endepunktstesten ikke ville gjort — `no-go` eller `usikkert` fra et lag korden krysser nær neset). Noter presist hvor nært neset korden faktisk passerer. | **[Magnus velger A]** | **[Magnus velger B]** | Forventet: `farbar(A)` og `farbar(B)` OK isolert; `segmentTest(A,B,…)` strengere enn begge endepunktene alene | | | | | |

**Merknad rad 12–14 (guardrail + par):** disse tre er, som rad 8–10, delvis
avledet fra fixturens egen geometri (guardrailen validerer per definisjon
intern QA-konsistens, ikke sjøkart-sannhet — se spec §6.3.2 — og de foreslåtte
par-koordinatene er beregnede startpunkter). Sjøkart-lesningen din er likevel
verdifull her: den bekrefter om det virkelig FINNES en skjær/tørrfallskant på
akkurat dette stedet i virkeligheten (ikke bare i fixturen), og for rad 12
spesifikt om Kartverkets sondering faktisk ligger nær 2,6 m — den delen ER en
uavhengig sjøkart-påstand, selv om selve delpolygon-mekanismen ikke er det.

**Merknad rad 15–16:** disse to skal velges FULLT uavhengig av fixturens
geometri — ingen koordinater er forhåndsutledet fra pakken. Dette er de to
radene som best følger E8-protokollen slik den er tenkt (kart først, kode
aldri sett før valget er gjort).

## Etterarbeid (etter kartkvelden)

- Oppdater `packages/charts/src/golden-oslofjord-hvaler.test.ts` og/eller
  legg til nye filer for rad 12–16 med referanse til denne tabellens rad-ID
  i en kommentar (samme mønster som `guardrail-golden.test.ts`).
- Ethvert avvik mellom «Forventet» og faktisk testresultat rapporteres til
  kartdata-agenten med rad-ID + skjermbilde-filnavn, ikke rettes stille i
  testen.
- Når alle 16 rader er «Verifisert: ja», oppdater §6.3 i
  `docs/specs/farbarhetsmaske.md` til å fjerne «MÅ VERIFISERES AV MAGNUS»-
  merkingen for de radene det gjelder.
