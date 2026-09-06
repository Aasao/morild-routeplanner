# Ekspertpanel D12.1–D12.5 — funn fra fase 4a bølge 4

- Dato: 2026-09-05
- Status: ferdig (runde 1 + utfordrere; syntese i §4). Venter Magnus' vedtak
  (`docs/specs/robusthet.md` §7).
- Grunnlag: `docs/research/beslutningsgrunnlag-d12-boelge4-2026-09-05.md`.
- Metode: tre fageksperter (marinkartolog/ECDIS, ytelsesingeniør,
  værruting-produksjonsutvikler — sonnet), deretter djevelens advokat +
  pragmatiker. **Simulerte fagperspektiver, ikke reelle personer.**
  Panelet godkjenner ikke — Magnus vedtar.

## 1. Runde 1

### 1.1 Marinkartolog

**D12.3:** `min(kai, ankring)` beviser at én oppgitt liggeplass holder,
men premisset «valget mellom de to tas ikke av ruteren» er for
pessimistisk i nød: en navigatør ankrer på svai uten å nærme seg kaia.
`min` stryker ekte nødhavner (grunn kai, dyp skjermet ankring). Riktig
modell er gate per anløpstype med `nightApproachSafe` per type — en
åpen ankringsbukt i mørket er ofte tryggere enn en trang kai med
moloer. (c), subsidiært (a). **D12.2:** `null`-dybde behandles riktig
(kategori U); valgfrie dypgangsfelt med stille fallback er en annen
feilklasse — en antatt kjent verdi som kan være feil for båten, som å
presentere CATZOC A1 når dataene er D. (a). **D12.1:** maks over 30
medlemmer er et outlier-tall i ensemblets hale, lite robust i seg selv;
prosjektets linje («verste gjennomførbare + typisk», P90 bak trykk)
gjelder også her. (c). **Fikstur-merkingen** er tilstrekkelig som
advarsel, ikke som sperre: minimum per havn før boken er brukbar er
`DepthRef` med reell kilde/dato, bevisst satt `nightApproachSafe`, og et
`verified`-felt som kan *blokkere* uverifiserte havner i skarp modus.
Votering: D12.1 (c), D12.2 (a), D12.3 (c), D12.4 (a), D12.5 (a).

### 1.2 Ytelsesingeniør

**D12.1:** ensemblet er 16–23 s PC *estimert* med umålt 2–4× på
nettbrett; full bail-out over 30 medlemmer (20 s PC / 40–80 s nettbrett)
dobler en uverifisert kostnad før tallet som skal avgjøre det finnes —
rekkefølgefeilen §6.3 spak 7→8 ble innført mot. (c). Havnefelt
transferable: 1,4 MB ≈ 1–2 ms per worker; bygg én gang i kontroll-
workeren og overfør. **D12.4:** seks søk sekvensielt er tapt
parallellisme — (b), gjenbruk pool-mønsteret (~3–7 s spart PC). **Funn:**
`weather-routing.worker.ts` kjører bail-out på *enhver* kontroll-jobb,
ikke bare valgt avgang — 3,3 s × 5–8 avganger ubudsjettert når
avgangsvinduet (F4.5) kommer; gate til topp-avgangen. **Minne:** 1,4 +
0,3 MB × 6 workere = 10 MB, neglisjerbart mot N6. Votering: D12.1 (c),
D12.4 (b), D12.5 (a); D12.2/D12.3 utenfor fagfeltet. Trenger målt:
nettbrett-tall for ensemblet, deretter egen nettbrett-måling av
bail-out-profilen (annen R2-karakteristikk).

### 1.3 Værruting-utvikler

**D12.1:** ett tall på førstesiden + bånd bak; «maks over medlemmer» er
forståelig kun oversatt til værspråk («i verste værutfall inntil 4 t fra
havn; kontrollvær 2 t»); kostnaden er kun målt på PC. (c). **D12.3:**
seileren vil vite kai OG/ELLER ankring og om nattanløp er trygt for
*den* metoden. (c). **D12.4:** følsomhet koker ned til ett bit
(konflikt/ikke); §4.7 legger allerede tallrekken bak trykk — men
beregningen må kjøres; (b) over poolen. Én setning: «Ruten tåler testet
variasjon i fart og strøm» / «En testet værvariant får deg ikke fram —
se detaljer». **D12.2** (a), **D12.5** (a). **Tekster:** `renderBailout`
for teknisk (søkeantall/silte punkter bak trykk); `renderSensitivity`
led med verdi-setning, tallrekke bak trykk; `renderDecision`: lokal tid
og kartfestet punkt/peiling i stedet for UTC og desimalgrader,
«provisoriske terskler» bak trykk.

## 2. Utfordrere

**Djevelens advokat:** (1) «Verste gjennomførbare + P90» rangerer
seilingstid, ikke bail-out-eksponering — `longestGapS` avhenger av hvor
og når medlemmet er langs ruten når været slår om; et middels raskt
medlem kan ha lengst gap. Skal (c) bety noe, må «verste» og «P90»
defineres på `longestGapS` (billig forsortering på feltets nedre skranke
før de dyre profilene). (2) D12.3 (c) gjenåpner 4a-kuttet «havnebok-
felter utover dybde/mørke/LWW» — må tas eksplisitt, ikke som biteffekt.
(3) D12.2: `packages/polar` er placeholder uten fabrikk som setter
dypgang — obligatoriske felt flytter bare 2,6 m-fallbacken dit; vedtaket
må si hvor polar-fabrikken henter tallet fra.
**Pragmatiker:** D12.1 spec-presisering nå, implementasjon bølge 6;
D12.2 nå med eksplisitt fabrikkverdi ett sted; D12.3 ikke nå (én båt, få
havner — dokumenter som kjent begrensning, 4b); D12.4/D12.5 nå.
Votering: DA: D12.1 justert (c), D12.2 (a) betinget, D12.3 (c) betinget
eksplisitt gjenåpning, D12.4 (b), D12.5 (a). Pragm.: D12.1 justert (c),
D12.2 (a), D12.3 (b/utsett), D12.4 (b), D12.5 (a).

## 3. Votering

| | Kartolog | Ytelse | Værruting | Djevel | Pragm. |
|---|---|---|---|---|---|
| D12.1 (c) tre profiler | (c) | (c) | (c) | (c) justert: rang på gap | (c) justert, bølge 6 |
| D12.2 (a) obligatoriske dypgangsfelt | (a) | – | (a) | (a) m/polar-plan | (a) m/fabrikkverdi |
| D12.3 gate per anløpstype | (c) | – | (c) | (c) kun som eksplisitt gjenåpning | utsett (a nå) |
| D12.4 perturbasjon over poolen | (a) | (b) | (b) | (b) | (b) |
| D12.5 departEpochS i MemberSummary | (a) | (a) | (a) | (a) | (a) |

## 4. Hovedsesjonens syntese

1. **D12.1:** (c) med utfordrerens presisering — de to medlemsprofilene
   velges på *gap*, ikke seilingstid: billig forsortering på feltets
   nedre skranke langs hvert medlems `hourlyTrack` (ingen R2-søk), så
   fulle profiler for de to med størst feltgap + kontrollen. Spec nå,
   implementasjon i bølge 6 etter nettbrett-tallet (ytelsesingeniøren).
2. **D12.2:** (a), med fabrikkverdien eksplisitt ett sted:
   `test-boat.ts` (Morild 2,6 m + klaring) — og `packages/polar`s
   kommende fabrikk arver kravet fra typen, ikke fra en fallback.
3. **D12.3:** kartolog og værruting vil ha (c); pragmatiker og djevelens
   advokat peker på 4a-kuttet. `min` er den konservative retningen
   (færre havner godtas ⇒ lengre strekk vises, aldri kortere).
   Anbefaling: (a) nå, dokumentert som kjent begrensning; (c) som
   eksplisitt gjenåpning i fase 4b sammen med LWW-synk av havneboken.
4. **D12.4:** (b) over poolen. I tillegg ytelsesingeniørens funn: gate
   bail-out-profilen til valgt avgang når avgangsvinduet kommer (bølge 5).
5. **D12.5:** (a). Værruting-utviklerens tekstforslag (slanke
   frontlinjer, lokal tid, kartfestet punkt) hører til bølge 5
   (presentasjon).
