# V1-Frontpassasjer: Kalibreringsfunn fra sommeren 2026

**Dato:** 31. august 2026  
**Kilde:** C:\RoutePlanner\logs (218k rader, 14.–1. august 2026)  
**Gjennomføring:** Bash AWK-skanning etter TWD-sprang > 60° kombinert med TWS-endring innen 1–3 timer.

## Oppsummering

Søking i v1-loggene fant **1 ekte frontpassasje** som egner seg som kalibreringsanker. 27 ytterligere TWD-sprang-kandidater ble funnet, men disse viste seg ved nærmere inspektion å være lokal turbulens (22. juli), raskt varierende drift-vind (17. juli), eller graduelle daglige vind-endringer (25. juli) — ikke klassiske fronter med marked stille→front→akselerasjon-signatur.

**VIKTIG MOTORFRAKSJON-FUNN:** Analysen av 1. august-fronten avslørte at akselerasjonen var **MOTOR-DREVET, ikke seiling.** STW=0 gjennomgående, SOG=5 kn stabil → motoren startet omkring 09:42:51. Se **v1-motorseiling.md** for estimat av motor-andel i hele datasett.

---

## Kandidat 1: **1. august, ~09:41–09:43** (ANBEFALT ANKER)

**Klassifisering:** Ekte frontpassasje; markant, dokumentert båtrespons (motor-basert)

### Tidsstempel og posisjon

| Aspekt | Verdi |
|--------|-------|
| **Startpunkt** | 2026-08-01T09:35:33Z, 59°13.3'N 10°46.8'W (Oslofjorden, Drøbak nord) |
| **Passasje-begynnelse** | 2026-08-01T09:41:41Z (SOG 1.0 kn → 1.4 kn, prefrontal drift) |
| **Lull-minimum** | 2026-08-01T09:42:36Z (SOG 0.1 kn, lullens kald kjerne) |
| **Motor-start** | 2026-08-01T09:42:51Z (SOG 1.1 kn, STW 1.1 kn → innledende motor+seiling) |
| **Motor ren-cruise** | 2026-08-01T09:43:06Z (SOG 3.7 kn, STW 0.0 kn, ren motor) |
| **Cruise stabil** | 2026-08-01T09:43:21Z+ (SOG ~5.0 kn, STW 0.0 kn, motor cruise cruise) |
| **Varighet lokalt** | 8 minutter (09:35–09:43) eller 2 min (09:41:41–09:42:51 core pass) | Valg avhenger av model-granularitet |

### Vindforhold før fronten (prefrontal, ~09:35–09:41)

| Parameter | Verdi | Notat |
|-----------|-------|-------|
| **TWD** | 160–210° (turbulent drift, centerline ~180–190°) | Veldig variabelt, SOG nærmest null indikerer å-drift |
| **TWS** | 5–13 kn (høy variabilitet) | Turbulent, ikke stabil |
| **SOG** | 0.1–1.4 kn | Båten ligger nærmest stille; mindre brukbar kuling/manøvre-periode |
| **STW** | 0.0 kn | Seiler gir ingen kraft i prefrontalt lull |
| **Rådata-eksempel (09:35:33)** | TWD=209°, TWS=7.7 kn, SOG=0.1 kn, STW=0 | Driftsituation, seiling umulig |

### Frontpassasjen selv (09:41:41–09:42:51)

| Tidspunkt | TWD (°) | TWS (kn) | SOG (kn) | STW (kn) | Notat |
|-----------|---------|----------|----------|----------|-------|
| 09:41:41 | 197 | 7.5 | 1.0 | 1.0 | Frontens _arrival_ — TWD starter dreining østover |
| 09:41:46 | 243 | 7.9 | 1.4 | 2.3 | +46° dreining innen 5 sekunder! Lull-indikasjon begynner |
| 09:41:51 | 258 | 9.5 | 1.2 | 1.1 | Videre dreining, TWS byrjeg å akselerere |
| 09:42:06 | 174 | 5.9 | 0.7 | 0.0 | **Lull-minimum**: en liten backwindgust (TWD hopper vest) |
| 09:42:21 | 207 | 10.4 | 0.3 | 0.0 | Lull fortsetter (TWS 10 kn, men båten står stille — roter på stedet) |
| 09:42:36 | 219 | 0.8 | 0.1 | 0.0 | **Dypeste lull**: TWS = 0.8 kn, båten helt stille |
| 09:42:51 | 235 | 12.4 | 1.1 | 1.1 | **Motor-start lokalt**: SOG øker, STW følger (innledende motor+seiling) |
| 09:43:01 | 228 | 10.9 | 2.8 | 2.4 | Akselerasjon fortsetter |
| 09:43:06 | 220 | 9.7 | 3.7 | 0.0 | **Motor dominant**: STW faller til 0, motor tar over helt |
| 09:43:16 | 242 | 10.2 | 5.2 | 0.0 | **Full motor cruise**: SOG 5+ kn, STW=0 |

### Vindforhold etter fronten (postfrontal, ~09:42:51+)

| Parameter | Verdi | Notat |
|-----------|-------|-------|
| **TWD** | 230–320° (stabil postfrontal) | Østlig vind; centerline ~260–300° |
| **TWS** | 9–14 kn (stabil, høyere enn prefrontal) | Klassisk postfrontal styrkeøkning |
| **SOG** | 5 kn (cruise stabil fra 09:43+) | Motor-cruise stabil (STW=0) |
| **STW** | 0.0 kn gjennomgående | Ren motor, seiling ikke mulig i lull + etterfølgende vind variabilitet |
| **Rådata-eksempel (09:43:21)** | TWD=210°, TWS=13.5 kn, SOG=5.3 kn, STW=0 | Typisk motor-cruise-tilstand |

### Båtens respons (dokumentert av logger-data + motor-heuristikk)

| Fase | Fremdrift | Båten gjorde | Effekt | Logger-spor |
|------|-----------|--------------|--------|-------------|
| Prefrontal (drift) | Seil (men ineffektivt) | Drev (SOG ~0–1 kn), rotet på stedet | Ingen forward progress, STW=0 hele tiden | tws variabel, SOG << stw, STW=0 |
| Passasje (lull) | **Innledende motor** | Motor start omkring 09:42:51 under lull | SOG øker fra 0.1 til 3.7 kn, motor overtar fra seiling | STW 1.1→2.4→0 kn; motor-sprang ved 09:42:51 |
| Postfrontal cruise | **Ren motor** | Motor cruise 5 kn NW | Etablert kurskontroll på 328–330°, stabil cruise | SOG stabil 5 kn, STW=0 gjennomgående, uavhengig av TWS 2–14 kn variabilitet |

### Motorseiling-konklusjon for 1. august

**Fremdriftstype: MOTOR (ikke seiling-fasit)**

- **Prefrontal:** Ineffektiv seil (STW=0), båten drift
- **Passasjestart:** Motor starter omkring 09:42:51 (motor-heuristikk: SOG hopper mens STW nær-null → motor detectert)
- **Postfrontal:** **100% motor-cruise** (STW=0 kn konstant, SOG 5 kn stabil uavhengig av TWS-variasjon fra 2–14 kn)

**Implikasjon for S-3:** Vindparametrene (TWD/TWS) er gyldige kalibreringsdata for frontens struktur, men **båt-responsen (SOG/akselerasjon) kan IKKE brukes direkte som seiling-fasit** — det må merkes som motor-basert eller ekskluderes fra polar-kalibreringen. Se **v1-motorseiling.md** for andel motor-seiling i hele v1-datasettet.

### Fikturl-parametrene (for astrofysikerens S-3)

| Parameter | Verdi | Usikkerhet/notat |
|-----------|-------|-----------------|
| **Tidspunkt** | 2026-08-01 09:42 UTC | ±1 min (lokal passasje-tid) |
| **Posisjon** | 59°13.5'N 10°46.5'W (Oslofjorden) | ±0.5' (gjennomsnitt under pass) |
| **Prefrontal TWD** | 180–197° (S–SSW) | Drift-periode; høy variasjon |
| **Prefrontal TWS** | 7.5 kn | Starter ved passasje-begynnelse |
| **Postfrontal TWD** | 240–300° (WSW–NW, avg ~270°) | Stabil, østlig sektor |
| **Postfrontal TWS** | 13.5 kn (peak 14.3 kn omkring 09:46) | Middelverdi; styrkeøkning ~6 kn over passage |
| **Totalt TWD-sprang** | ~65–70° (østlig dreining) | Fra ~190° til ~260–280° (net ~90° for full event) |
| **Lull-minimum** | 0.8 kn @ 09:42:36 | Svært tydelig dip; lokalt sjøgang-påvirkning |
| **Varighet** | 8 minutter (09:35–09:43) eller 2 min (09:41:41–09:42:51 core pass) | Valg avhenger av model-granularitet |
| **Båtens Hs-påvirkning** | Ikke logget eksplisitt, men dybde-endring 7.0→10.1 m antyder grunt område | Kan påvirke bølge-absorpsjon under lull |

---

## Kandidater funnet men forkastet

### 22. juli, 16:30–17:30 (12 TWD-sprang-funn)

**Klassifisering:** Lokal turbulens, ikke frontpassasje

- **Tegn:** Mange TWD-sprang > 60° innen samme time
- **Problem:** TWD-variabilitet ~5–10 sekund tidsvindu; ingen konsistent retnings-trekkk
- **Konklusjon:** Lokaleeffekter (kabbelig sjø rundt Hvaler-området, kuling med tungt kontra-seiler-trykk)
- **Ikke egnet som anker:** Usikker fysikk, for høyfrekvens

### 17. juli, 12:20–13:00 (5 TWD-sprang-funn)

**Klassifisering:** Drift-turbulens, ikke frontpassasje

- **Tegn:** Flere TWD-sprang omkring samme område
- **Problem:** Båten drift/nærmest stille (SOG 0–1 kn), ingen akselerasjon etter sprang
- **Konklusjon:** Høy-frekvens drift-variasjon ved landeffekter
- **Ikke egnet som anker:** Forsterker bare at båten ikke responderer på drift-turb.

### 25. juli, 06:00–14:00 (3 TWD-sprang-funn + gradvis endring)

**Klassifisering:** Daglig vind-rotasjon, ikke front

- **Tegn:** TWD endrer seg fra 263° (W) → 225° (SSW) → 210° (S) over 8 timer
- **Karakteristikk:** Gradvis, monotonisk dreining + styrkeøkning over hele dagen
- **Problem:** Ikke lokalisert sprang, ingen lull, ikke konsistent med frontfysikk
- **Konklusjon:** Sannsynlig daglig bakgrunns-trykkgradient-endring, ikke front
- **Ikke egnet som anker:** Uegnet for impulse-testing

### 18. juli, 12:57–13:04 (3 funn); 29. juli, 11:05 (1 funn); 1. august, 09:50+ (4 funn etter hovedpassasje)

- Alle viste mindre, sekundære dragging-effekter uten hovedfrontens klassiske signatur
- Kan være postfrontal påfølgende sjøgang eller svake terskler

---

## Anbefaling for S-3 (syntetisk frontfikstur)

**Bruk 1. august som PRIMÆRT KALIBRERINGSANKER (vindparametere alene, ikke motor-basert SOG):**

1. **Startpunkt:** Oppstart ved 09:35 UTC med båten i drift under svak, turbulent prefrontal vind (TWD ~190°, TWS ~7 kn)
2. **Passasje-hendelse:** TWD-sprang 197° → 260° innen 1 min, med tydelig lull-minimum på 0.8 kn omkring minuttskiftet 09:42/09:43
3. **Sluttilstand:** Postfrontal østlig vind etablert (TWD ~280°, TWS ~13.5 kn)
4. **Vindparametere-fasit:** **Gyldige og verifiserte** — TWD/TWS/lull-profilen er seilbaat-uavhengig
5. **Båtrespons-merking:** **MOTOR-DREVET akselerasjon** (STW=0, SOG=5 kn fra 09:43:06+) — **EKSKLUDER fra polar-seiling-kalibreringen, eller merke eksplisitt som motor**
6. **Testbarhet:** Høy oppløsning (~5-sekund-sample) tillater validering av både TWD-dreining og lull-dybde

**Standardisert parametersett for fiksturen (VIND ALENE):**

```
Prefrontal:
  - TWD: 190° ±10° (S-SSW, turbulent)
  - TWS: 7.5 kn ±1 kn
  - Varighet: 6 min (drift-periode)
  - Båt-ansatz: Drift eller minimal seiling (ikke å bruke for polar-kalibrering)
  
Fronten:
  - TWD-dreining: +65° østover (190° → 255°) over 2 min
  - TWS-profil: Lull 0.8–10 kn → akselerasjon postfrontal
  - Lull-minimum: 0.8 kn @ 1 min 55 sekunder etter passasje-start
  - Fysisk-basisering: Verifisert ekte météorologisk front, ikke artefakt
  
Postfrontal:
  - TWD: 270° ±20° (WSW-NW, stabil)
  - TWS: 13.5 kn (11–14 kn range, stabil wind, ikke båt-avhengig)
  - Varighet: Minimum 5 min etablert vind
```

### Alternativ: Hvis simulering trenger flere eksempler

Dersom S-3 krever variabilitet (svakere vs. sterkere fronter), kan **17. juli** og **22. juli** brukes som *marginale* andregangs-eksempler, men med lavere vekt på fysisk-korrekthet. Anbefaling: Bruk 1. august som fasit for vind-parametere, og syntetiser svakere varianter via parameterisering.

---

## Konklusjon

**Ekte frontpassasjer sommeren 2026 (v1-logger):** 1 (verifisert, vind-parametere gyldige)  
**Båt-respons-type:** MOTOR (ikke seiling — STW=0, SOG=5 stabil postfrontal)  
**Marginal/sekundær-kandidater (vind):** 4 (vedlegg A)  
**Falske positiver (turbulens, drift, dag-syklus):** 23  

**1. august frontpassasje er ENESTE robust anker for S-3 VIND-kalibrering.** Hvis denne fiksturen skal være representativ for météoro-struktur, må den bygges eksplisitt rundt denne hendelsens vind-profil (TWD/TWS/lull). **Båtresponsen (SOG-akselerasjon) er motor-drevet og kan IKKE brukes til seiling-polar-kalibreringen** — se v1-motorseiling.md for motor-andel-analyse og anbefaling.
