# Ekspertpanel D7 — værpakkeformat (fast LSB, Paeth, 1°-fliser, budsjett)

- Dato: 2026-09-04. Status: votering ferdig — venter på Magnus.
- Metode: `/panel`-prosedyren. Runde 1: matematiker, værruting-utvikler,
  ytelsesingeniør (samme agenter som runde 1–3 tidligere, full historikk).
  Runde 2: djevelens advokat, lateral tenker, pragmatiker. Tilsvar +
  votering fra runde 1. **Simulerte fagperspektiver, ikke reelle personer.**
- Grunnlag: `kompresjonsmaaling-2026-09-03.md` (§1–§9, ekte MEPS-pakke
  04Z 3. sept, fliser 5_28/5_29), `kvantiseringsmaaling-2026-09-01.md`
  §9.2 (harness-remåling fast LSB), D6-C (interim tak 50 MB).

## Alternativene (vind alene; «korridor» = 1°-fliser, 3 celler = 36,4 %)

| | Format | Per to 2°-fliser | Korridor | Harness |
|---|---|---|---|---|
| A | fast LSB 0,1 kn, 10-bit, Paeth | 17,53 MB | 6,38 MB | bestått (ΔP50 0,44 %) |
| B | fast LSB 0,125 kn, 10-bit, Paeth | 16,06 | 5,85 | ikke kjørt |
| C | fast LSB 0,25 kn, 8-bit, Paeth | 11,1 | 4,04 | sikkerhet OK; rangeringsflipp 3,41 % |
| D | fast LSB 0,5 kn, 8-bit, Paeth | 7,56 | 2,75 | rangeringsflipp 3,40 % |
| E | dagens adaptiv 8-bit + tidsdelta, kun 1°-fliser | 27,4 | ≈10,0 | bestått per konstruksjon (golden) |
| E′ | E + tapsfri Paeth | 18,96 | ≈6,9 | bit-identisk dekodet felt |

## Runde 1 (råd)

- **Værruting:** E′ nå; A til 4b. «0,1 kn er modellstøy (MEPS RMSE
  3–5 kn); 0,25-flippen er en knivsegg i fiksturen under søkets 6 %-gulv
  — dødbånd i F4.4, ikke i byteformatet.»
- **Matematiker:** A som arbeidsstandard, B harness-testes først (0,125 =
  2⁻³ er binært eksakt; 0,1 er ikke). Flippene er én bifurkasjon i søket
  (S-5 +4 t: 13,83 ↔ 14,31 t) — «bestått ved 0,1 er ett trekk i samme
  lotteri». Avgjørbart kriterium: flipp-frekvens under dithering, eller
  nedgrader rangering til deskriptivt. E avvist (vaktbånd flisavhengig).
  17,53 MB er målt med u16 — bit-pakket 10 kan komprimere dårligere.
- **Ytelse:** A med u16 + byte-shuffle (Paeth krever subflis-dekoding
  uansett, 10-bit-varskuet faller); minne 1,9 MB/medlem — trivielt; E
  avvist som «pause før en migrasjon som uansett kommer».

## Runde 2 (utfordring)

- **Djevelens advokat (viktigst):** harnessen har aldri kjørt på en ekte
  flis for noen variant — golden-spenn 21,7 kn (trinn 0,085) vs ekte
  55–65 kn ⇒ adaptiv 8-bit = 0,21–0,26 kn = C-klasse. «E′ ≈ C på ekte
  data.» Vaktbåndet kan gjøres verifiserbart for adaptiv skala også
  (√2·skala/2 per flis fra header + klippe-immunitet). 1°-fliser med
  adaptiv skala er ikke bit-identiske; ekstrapoleringen er optimistisk
  for E′. **Sikkerhet:** flisvalg fra endepunkt-bbox er utrygt —
  medlemsruter 9,6–17,6 nm utenfor luftlinjen, 1° ≈ 33 nm; manglende
  flis ⇒ hard avvisning ⇒ søket styres stille av flisdekning. D7 må
  ikke tas nå; cron gir 3–5 init gratis under bølge 3.
- **Pragmatiker:** E i dag (½ d + dekningssjekk). A = 4–6 agentdager +
  forhåndsregistrert harness (0,1-punktet var ikke forhåndsregistrert) +
  semantikkgodkjenning → 4b. «Migrasjon uansett» er ikke reelt uten
  brukere/lagrede pakker. Strøm/bølger/tide (umålt) avgjør budsjettet.
  Rangering → deskriptivt (10 min).
- **Lateral tenker:** (1) polar-vektet companding (kode = round(32·√TWS):
  fin der dV/dTWS er størst, vaktbånd som funksjon av kode, intet
  anker-lotteri, retning egen kanal); (2) medlemmer som 3 t-anomali oppå
  timevis kontroll (30/31 av bytene → ×0,35–0,5); (3) byggeren
  sertifiserer maks feil per flis i header — klienten nekter fliser uten
  sertifikat (løser A-vs-E′ generelt); (4) korridor-Range-henting av
  32×32-subfliser fra A*-feltets rekkevidde (6,4 → ~2 MB); (5)
  kontekstmodellert koder for 26,6 %-gapet.

## Tilsvar (runde 1-agentene korrigerer)

- **Værruting:** «Djevelen har rett — C/E/E′ er samme presisjonsklasse på
  ekte data; harness må kjøres på én ekte flis før noe kalles trygt.»
  Flisvalg fra kontrollrute + ≥ 30 nm buffer med ærlig manglende-flis-
  flagg er et fase 3-krav. Companding er «formatet jeg egentlig ville
  hatt» — men må slå u/v på nytt (W-SD10 tapte). Anomali-3t avvises:
  fronttiming skiller på timer (T-3H-fella).
- **Matematiker:** «Min E-avvisning var ingeniørpreferanse forkledd som
  matematikk.» Per-flis-bånd fra header er likeverdig — **men
  `expand.ts` bruker i dag globalt bånd; compositeWeatherField må bruke
  aktuell flis' bånd (eller maks).** Companding avvist for v2.0 (fart+
  retning interpolerer ikke ekvivalent over fronter/nullvind).
  Sertifisert feltfeil i header: sunt, innhold spesifisert (maks per felt/
  flis mot timevis råfelt, låst interpolasjonsskjema, énsidighet Hs).
- **Ytelse:** «Jeg trekker rekkefølge-innvendingen» — E for bølge 3;
  nettbrett-dekodekost er tallet jeg selv ba om. Vilkår: subflis-
  adresserbar layout med offset-tabell nå (gratis, forutsetning for
  korridor-subfliser). Manglende flis ⇒ `pruned.noWeather > 0` innenfor
  pakkens vindu ⇒ «rute begrenset av værdekning»-flagg, obligatorisk.
  Flissett fra A*-feltets rekkevidde: ~1,5× korridoren (E ≈ 15 MB).

## Votering

| | Værruting | Matematiker | Ytelse | Djevel | Pragmatiker |
|---|---|---|---|---|---|
| A (0,1 kn) | UTSETT 4b | UTSETT (B foran) | UTSETT 4b, primær | UTSETT | UTSETT 4b |
| B (0,125) | AVVIS (del av A-sveip) | UTSETT, foran A | UTSETT (harness avgjør) | foran A | — |
| C (0,25) | AVVIS | AVVIS | AVVIS (medlemsvariant ved behov) | AVVIS | — |
| D (0,5) | AVVIS | AVVIS | AVVIS | AVVIS | — |
| **E (bølge 3)** | **GODKJENN m/vilkår** | (E′ = E + per-flis-bånd) **nå** | **GODKJENN m/vilkår** | **GODKJENN** | **GODKJENN** |
| E′ (Paeth) | betinget > 25 MB | nå (som bånd-fiks) | betinget > 25 MB | ENDRE (dekoder i packages/weather) | betinget > 25 MB |
| Lat. 1 companding | 4b-kandidat nr. 1 | AVVIS v2.0 | mål, ikke sats | — | — |
| Lat. 2 anomali-3t | AVVIS (T-3H) | 4b m/sertifikat | 4b, største spak | — | — |
| Lat. 3 sertifikat i header | GODKJENN NÅ | sunt, 4b m/spec | — | — | — |
| Lat. 4 korridor-subfliser | 4b | — | 4b (feltets rekkevidde, ikke rør) | — | — |

## Syntese (hovedsesjonen)

Enstemmig: **E for bølge 3** (ingen kvantiseringsendring, 1°-fliser),
med vilkår som er samstemte på tvers: (1) **flisvalg-sikkerhetsregel**
(fliser = A*-feltets rekkevidde eller kontrollrute + ≥ 30 nm; manglende
flis ⇒ ærlig flagg, aldri stille avvisning) — sikkerhetssemantikk;
(2) **per-flis vaktbånd fra header i expand.ts** + klippe-assert (kodefunn:
globalt bånd i dag); (3) rangeringskriteriet i harnessen → deskriptivt
m/uavgjort-bånd = støygulv; (4) harness på ≥ 1 ekte flis i bølge 3;
(5) subflis-adresserbar layout nå; (6) sertifisert maks feil per flis i
header — billig (verifyRoundTrip måler alt allerede). A/B → 4b som
primære formatkandidater etter 3–5 init + harness på ekte fliser;
C/D avvist; E′ betinget (> 25 MB totalpakke). 4b-kandidater med reell
uenighet (bevart): companding (værruting for, matematiker mot),
anomali-3t (ytelse for, værruting mot). Strøm/bølger/tide er fortsatt
umålt og avgjør budsjettet — interim 50 MB består.
