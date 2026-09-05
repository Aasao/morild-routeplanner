# Beslutningsgrunnlag D10 — F3.5 og veien til nettbrett-tallet etter spak 7

- Dato: 2026-09-05
- Status: grunnlag for fagagent-panelet (`/panel`) før D10 legges frem for
  Magnus. Simulerte fagperspektiver, ikke reelle personer.
- Kilder: `docs/research/maaling-spak7-2026-09-05.md` (rådata),
  `docs/research/maaling-e1-2026-08-31.md` §7.4 (forrige PC-tall),
  `docs/specs/robusthet.md` §4.1 (rekkefølge, verste-først, pool), §6.1–6.3
  (budsjett, spaker, porter), §7 D8.13 (F3.5 som hypotese),
  `docs/decisions/ADR-0005-ensemble-mekanisme.md` (port 1 nettbrett-måling,
  port 2 vise-versa > 60 s, pkt. 4 spikens 12° ugyldig),
  `docs/00-kravspek.md` F3.5 (progressiv semantikk; «< 60 s for
  topp-avgang» er hypotese), `apps/pwa/src/weather/ensemble.ts`
  (`defaultPoolSize` = kjerner−1, 1–6; kontroll først, så pool),
  `docs/research/fase4a-plan-2026-09-04.md` (bølge 2: exit = «tallet
  foreligger; progressiv semantikk bekreftet som kontrakt eller F3.5
  gjenåpnes (D8.13); vise-versa-port vurdert»).

## 1. Målingen (spak 7, PC, én kjøring)

Kontroll + 30 medlemmer, første avgang, **full oppløsning 6°/1800 s**,
delt A\*-felt fra kontrollen, ingen delt Tub. Node 22, én prosess,
sekvensielt.

| Fikstur | Felt | Kontroll | 30 medl. sekv. | Median/medlem | Maks/medlem | Etiketter (30) | Klasser | Pool 3 w | Pool 5 w | Pool 6 w |
|---|---|---|---|---|---|---|---|---|---|---|
| S-1 | 29 ms | 3,3 s | 87,3 s | 2,92 s | 4,09 s | 5,73 M | 30 feasible | 33 s | 21 s | 18 s |
| S-3 | 19 ms | 3,5 s | 85,0 s | 3,29 s | 3,76 s | 5,25 M | 26 f / 4 inc | 36 s | 23 s | 20 s |
| S-7 | 23 ms | 3,7 s | 78,8 s | 2,43 s | 4,74 s | 4,39 M | 15 f / 15 inc | 28 s | 18 s | 16 s |

Pool-anslag = felt + kontroll + ⌈30/p⌉ × median — nedre grense (perfekt
fordeling, ingen worker-overhead, ingen strukturert kloning av fliser).

Sammenligning: E1-riggen målte 67–70 s (31.08) og 87–99 s (01.09) for
S-1-avganger sekvensielt. **Bølge 1-riggen endrer ikke sekvensiell
kostnad** — delt felt sparer bare feltbyggingen (20–30 ms), og delt Tub
ble forkastet (D9.1). Det var forventet: spak 1–3 var minne-/riktighets-
spaker, ikke søkekost.

## 2. Portene

- **Spak 7-porten (robusthet.md §6.3):** «viser PC-remålingen > 40–50 s
  per avgang, er nettbrett-tallet i praksis avgjort». Sekvensielt: 79–87 s
  ⇒ porten slår til for *sekvensiell* kjøring. Pool-anslaget (det
  progressiv UX faktisk får) er 16–23 s på PC med 5–6 workere.
- **Nettbrett (ADR-0005 port 1, umålt):** faktor 2–4× antatt; nettbrettet
  har typisk 4–8 kjerner ⇒ pool 3–6 (kjerner−1, tak 6), men
  små kjerner (big.LITTLE) gjør «6 workere» misvisende. Anslag for
  topp-avgang: 3 w × 2–4× ⇒ **56–144 s**; 5 w × 2–4× ⇒ **36–92 s**.
- **F3.5-hypotesen «< 60 s for topp-avgang»:** PC ja (16–23 s); nettbrett
  sannsynligvis nei med 3 workere, kanskje med 5–6 store kjerner.
  D8.13 forutså dette (ytelsesingeniør: P(< 60 s) < 30 %).
- **Vise-versa-porten (ADR-0005 port 2):** > 60 s per avgang *etter
  tiltak* ⇒ F12-remåling (12°-oppløsning som «grov ensemble-modus»
  vurderes på nytt — men ADR-0005 pkt. 4 sier robusthetstall kun fra
  full oppløsning).
- **Avgangsvindu (F4.5):** 1 t oppløsning, 5–8 avganger ⇒ kontroll for
  alle på 5–8 × 3,5 s ≈ 20–30 s sekvensielt *før* noe ensemble (kan
  parallelliseres over poolen: ~5–10 s).

## 3. Hva som er strukturelt kjent

- Per medlem: ~170 000 etiketter, ~2,4–3,3 s ⇒ ~15–20 µs per etikett
  (Node/V8 på PC). Etikettallet er søkets egentlige kostnad; det er
  uendret siden E1.
- Ensemblet er pinlig parallelt (ADR-0005 mekanisme F): pool skalerer
  nær lineært til kjernetallet, bortsett fra minnebåndbredde og
  strukturert kloning av ~20 MB fliser per medlem (måles først på
  nettbrett).
- Spakene som gjenstår (§6.3, etter tallet): profilsøk (styrer resten),
  alloc-fri hot-loop, delte read-only-cacher, betinget sektornøkling.
  Ytelsesingeniøren anslo i D9-panelet at alloc-fri hot-loop og
  read-only-cacher er «nesten garanterte» gevinster, sektornøkling
  usikker. Ingen av dem er målt. WASM er ikke vurdert i fase 4a.
- Verste-først-rekkefølge (§4.1) gir *sertifikater* tidlig (rød/gul kan
  vises før alle 30), men endrer ikke total tid.

## 4. Alternativene (D10)

**D10.1 Hva skjer med F3.5 nå.**
- (a) Behold progressiv semantikk som kontrakt (kontroll for alle
  avganger på sekunder, ensemble strømmet, verste-først-sertifikater);
  «< 60 s» strykes som løfte og erstattes med målt tid vist i UI
  («ensemblet tok X s»). Ingen nye spaker før nettbrett-tallet.
- (b) Som (a), men spak 4–6 (profilsøk → alloc-fri hot-loop → read-only-
  cacher) tas i bølge 2b *før* nettbrett-målingen, siden PC-tallet allerede
  sier at 3-worker-nettbrett ligger over 60 s.
- (c) Reduser arbeidet: topp-avgang kjører 15 av 30 medlemmer først
  (annenhver, verste-først) med sertifikat-semantikk («foreløpig: k av 15»),
  resten strømmes; full oppløsning beholdes (ADR-0005 pkt. 4).
- (d) Grov ensemble-modus (F12) for medlemmene — **avvist av ADR-0005
  pkt. 4** (bifurkasjon under støygulvet); tas med kun for fullstendighet.

**D10.2 Nettbrett-målingen (port 1) — hva måles og hvordan.**
- (a) Som i dag: PWA på nettbrettet med ekte pakke (Skjæløy→Skagen),
  panelet viser kontrolltid + ensemble-veggklokke + pool-størrelse;
  Magnus leser av og rapporterer. Tre kjøringer.
- (b) (a) + `navigator.hardwareConcurrency`, minne (`performance.memory`
  der det finnes) og per-medlem-tider logget til en JSON Magnus kan
  kopiere — gir faktor per medlem, ikke bare vegg.
- (c) Egen målings-side (spike-riggen) på nettbrettet — avvist tidligere
  (12°), og PWA-panelet dekker behovet.

**D10.3 Vise-versa-porten.** (a) Utløses først når nettbrett-tallet
foreligger *og* > 60 s etter spak 4–6. (b) Utløses nå på PC-anslaget.
(c) Slettes — full oppløsning er absolutt (ADR-0005 pkt. 4), så F12 er
uansett ikke et alternativ for robusthetstall.

## 5. Spørsmål til panelet

1. Er pool-anslaget (⌈30/p⌉ × median) en rimelig nedre grense, og hva er
   den realistiske nettbrett-multiplikatoren gitt big.LITTLE og
   strukturert kloning av fliser?
2. Bør spak 4–6 tas før eller etter nettbrett-tallet — og i hvilken
   rekkefølge? Hva forventes de å gi (faktor), og hva er risikoen for
   determinisme/bit-identitet (golden-tester)?
3. Er (c) — 15 medlemmer først med sertifikat — ærlig nok, eller lyver
   «k av 15» for seileren?
4. Hva skal UI-et love? Formuler kontrakten i én setning.
