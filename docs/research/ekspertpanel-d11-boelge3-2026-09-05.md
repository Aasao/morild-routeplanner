# Ekspertpanel D11.1–D11.4 — funn fra fase 4a bølge 3

- Dato: 2026-09-05
- Status: ferdig — runde 1 + utfordrere; tilsvar ikke kjørt fordi
  utfordrerne sluttet seg til runde 1 med to presiseringer som allerede
  er implementert. Venter Magnus' vedtak (`docs/specs/robusthet.md` §7).
- Grunnlag: `docs/research/beslutningsgrunnlag-d11-boelge3-2026-09-05.md`.
- Metode: tre fageksperter (matematiker — opus; værruting-produksjons-
  utvikler og operativ marin meteorolog/kartolog — sonnet), deretter
  djevelens advokat + pragmatiker (én agent, to roller). **Simulerte
  fagperspektiver, ikke reelle personer.** Panelet godkjenner ikke —
  Magnus vedtar.

## 1. Runde 1

### 1.1 Matematiker

**D11.4 — sertifikatet er sunt (bevis):** tellerne er monotone og
`nF_final + nInf_final ≤ N`, så `s_final ≤ (N − nInf)/N = 1 − nInf/N
< 0,7` når `nInf > 0,3N` (skarpt; `>` er riktig, ved likhet er s ≤ 0,7 =
gul). Forutsetning som må stå i spec: ingen omklassifisering fra
`infeasible` — omkjøringen må være ferdig før tellingen. Sunnheten
gjelder predikatet `s < 0,7`, ikke lyset — den gjelder lyset kun fordi
rød står før de gule radene; de to er én pakke. **Mindre ærlig?** Ja, i
`reason`: nF=1, nInf=1, nInc=28 gir s = 0,5 men D10.4-skrankene er
[0,03; 0,97] — «rød/andel» påstår en andel materialet ikke bærer (N1),
gul ville myknet et varsel (N2). Løsning: skill farge fra begrunnelse —
ny reason `rod/tynt-grunnlag` når `nF + nInf < 12` eller `nInc + nErr >
N/3`. Rad `s < 0,7` etter gul-radene er død kode — fjernes.

**To nevnere:** `s = nF/(nF+nInf)` er en *betinget* andel med informativ
bortfallsmekanisme (inkonklusiv korrelerer med kort horisont/beskjæring)
⇒ systematisk optimistisk; `j/N` er ubetinget og intervallverdig.
Seileren skal se skrankene og råtellingene med én nevner (N); `s` styrer
kun lyset og vises aldri som tall; identiteten `s = (j/N)/(1 − u/N)` gjør
den avledet.

**D11.1:** andelen er et estimat av «andel medlemmer der en vind-only-
modell når fram»; bølger kan bare fjerne gjennomførbare ⇒ en øvre
skranke presentert som estimat — verste feilretning; skjevheten er
størst i sterkvindsmedlemmene, så også rangeringen (F4.5) forvrenges.
(a) nå, (c) når bølge/strøm er i pakken; billig nå: skill `dekning-felt`
fra `dekning-horisont` i `inconclusiveReason`.

**D11.3:** 1,036 = målekonvensjon (reachRadius-sluttetappe ≈ 2,4 %) +
grådighetsrest ≈ 1,2 %; 2,4 % er absolutt tid og skalerer 1/T — 0,10
brytes av enhver etappe under ~3,3 t. Behold 0,25 med port: sluttetappe
inn i bounden, gap målt mot `noTubBound`-referanse, maks ratio < 1,05
med korteste etappe ≤ 3 t i settet.

Votering: D11.1 (a) GODKJENN + dekning-felt-skille; D11.2 (a) GODKJENN
(bail-out er et eksistensspørsmål, bound et optimalitetsverktøy); D11.3
(a) GODKJENN m/port; D11.4 (a) ENDRE (reason-splitt, død rad bort).

### 1.2 Værruting-utvikler

Produksjonsprodukter skiller *hvorfor* et felt mangler fra *at* det
mangler: manglende lag er et flagget hull, ikke et bevisproblem som
horisont. Verken (a) eller (b) alene er ærlig: (a) sløser et reelt
vindsignal, (b) later som feasibleShare er robusthet når F3.2s bølge-
bratthet er variabelen som oftest snur vind-only-feasible. Tekst til
Magnus: «26 av 30 kom fram på vind alene — bølger og strøm mangler i
denne pakken, tallet kan endre seg når de kommer inn.» D11.4: teksten må
alltid si hvor mange som var avgjort da fargen ble satt. Votering: D11.1
(c); D11.2 (a); D11.3 (a); D11.4 (a) + avgjort-telling i teksten.

### 1.3 Meteorolog/kartolog

I Skagerrak er det sjelden ren vind som stopper en Dufour 41 — det er
bratt, kort sjø når vind møter strøm ved Skagens rev, og krysssjø. En
vindmodell kan gi «gjennomførbar» på en rute som ville gitt slamming.
CATZOC-presedensen (farbarhetsmaske §3.4.1): manglende datakvalitet
oversettes aldri til et tillatende tall — til en gate eller et flagg.
Nødhavnsøk: et anslag skal aldri kutte kandidater; kostnaden er
triviell mot konsekvensen. Margin: stram ikke mot data som snart blir
en annen fordeling (bølger kommer). Rødt er en hendelse, gult en
tilstand av manglende informasjon — en hendelse undertrykkes ikke av
senere mangel. Votering: alle (a).

## 2. Utfordrere

**Djevelens advokat:** et instrument som alltid viser «vet ikke» slutter
å være et instrument — (a) uten (c)-presisering er ufullstendig
forsiktighet; støtt matematikerens dekning-felt/horisont-skille.
«Rødt dominerer» er aritmetikk, ikke framing — men falsk rød har også
kostnad (seileren venter i havn i vær som også er usikkert);
reason-splitten er riktig motsvar. D11.2: «alltid uten bound» er i
praksis «bail-out kjøres sjelden» til havnefeltet (D8.10) finnes —
(a) er en midlertidig sikkerhetsdefault, ikke en ferdig løsning.
**Pragmatiker:** dekning-felt-skillet og reason-splitten er ett
enum-medlem + én visningsgren hver — gjør nå; D11.3-porten skrives som
kriterier i spec, bygges ikke før ekte fliser; D11.2 noteres avhengig av
D8.10. Votering begge: D11.1 (a)+skille; D11.2 (a) m/merknad; D11.3 (a);
D11.4 ENDRE (reason-splitt, død rad).

## 3. Votering

| | Mat. | Værruting | Met./kart. | Djevel | Pragm. |
|---|---|---|---|---|---|
| D11.1 (a) all partial ⇒ inkonklusiv, m/«dekning-felt»-skille | GODKJENN | (c) | GODKJENN | GODKJENN | GODKJENN |
| D11.2 (a) bail-out uten Tub-bound | GODKJENN | GODKJENN | GODKJENN | GODKJENN (midl. til D8.10) | GODKJENN |
| D11.3 (a) behold 0,25, port før stramming | GODKJENN | GODKJENN | GODKJENN | GODKJENN | GODKJENN |
| D11.4 (a) rød før gul + `rod/tynt-grunnlag` + død rad bort | ENDRE→ | GODKJENN | GODKJENN | ENDRE→ | ENDRE→ |

## 4. Hovedsesjonens syntese

Implementert i bølge 3-committen (konservativ retning, venter Magnus):
`rod/tynt-grunnlag` (reason-splitt), død rad fjernet, sertifikat =
`nInf > 0,3·N`, `gul/tid`-tak trekker fra nErr, `inconclusiveReason`
`dekning-felt` for «partial + nådd mål», og UI-tekst «k kom fram på vind
alene — bølger og strøm mangler i pakken, telles ikke som
gjennomførbare». Ikke implementert (Magnus' vedtak): D11.2 (én linje i
`r2SearchInput`, kostnad til D8.10 finnes), D11.3 (ingen kode; kriterier
i spec). Værruting-utviklerens (c) er dekket i praksis av (a) + skillet:
tallet vises som telling med årsak, uten å gå inn i nevneren.
