# V1-Motorseiling: Deteksjon og kalibreringsimplikasjon

**Dato:** 31. august 2026  
**Kilde:** C:\RoutePlanner\logs (218k rader, 14.–1. august 2026)  
**Bakgrunn:** Magnus' advarsel om motor+seiling-blanding fordrer kartlegging av motor-fraksjonen.

## Sammenfatning

**Funn:** v1-loggene inneholder **INGEN eksplisitt motor-status-signal**. Motor-seiling detekteres via heuristikk basert på STW vs. SOG.

**Heuristikk applisert:** To indikatorer for motor-mistanke:
1. **STW < 0.5 kn + SOG > 2.0 kn** (motor drar båten, seiling gir null kraft)
2. **SOG >> STW (differanse > 1.5 kn)** (motor + mulig strøm/tidevann)

**Motor-andel i datasett:**
- **Totalt**: 302 + 2839 = **3141 rader (~1.4% av 218k)** motor-mistenkelig
- **Kritisk høy på enkelte dager:**
  - **29. juli: 9,5%** (957 av 10039 rader) — største konsentrason
  - **1. august: 3,5%** (302 av 8519 rader) — inkludert frontpassasje-ankeret
  - **22. juli: 1,9%** (293 rader)
  - **Øvrige dager: 0–1%** stabil

**Implikasjon for kalibrering:** Motorseiling-radene bør **ekskluderes fra polar-seiling-kalibreringen** (F3.3), eller merkes eksplisitt. Det anbefales å fokusere på dager med < 0.5% motor-mistanke for seiling-fasit.

---

## Motor-deteksjonsheuristikk

### Bakgrunn: Hva logger v1?

v1-koden (morild_bridge.js, lj. 115) logger kun:
```
iso,lat,lon,sog_kn,cog,hdt,stw_kn,tws_kn,twa,twd,aws_kn,awa,depth_m,wtemp_c
```

- **STW (Speed Through Water):** Båtens fart gjennom vannet (fra NMEA VHW-melding)
- **SOG (Speed Over Ground):** Båtens fart over sjøbunnen/land (fra RMC/VTG)
- Ingen RPM, propeller-pitch, motorflagg, eller fuel-flow

**Fysisk basis for heuristikk:**
- **Seiling alene:** SOG ≈ STW + strøm (typisk < 0.5 kn i Oslofjorden)
- **Motor alene:** STW = 0, SOG = motorens cruise-hastighet (5 kn for Morild)
- **Motor + seiling:** SOG > STW, begge > 0
- **Drift:** STW = 0, SOG ≈ strøm (< 2 kn)

### Heuristikk-definisjon

| Kategori | Kriterium | Tolking |
|----------|-----------|---------|
| **Motor-sannsynlig** | STW < 0.5 kn **OG** SOG > 2.0 kn | Motor driver båten; seiling umulig |
| **Motor-mulig** | SOG − STW > 1.5 kn | Motor + seiling, eller strøm-assistert cruise |
| **Seiling-sannsynlig** | STW > 2.0 kn, SOG ≈ STW ± 0.5 kn | Ren seiling, minimal strøm |
| **Drift** | STW ≈ 0, SOG < 2.0 kn | Båten driver; ingen fremdrift |

---

## Søkeresultater (alle seilings-logger, 14.–1. august 2026)

### Totaloversikt

| Dag | Total rader | SOG+STW data | Motor-sannsynlig | Motor-mulig | Motor-total | % motor |
|-----|-------------|--------------|-----------------|-------------|-------------|---------|
| 14. juli | 345 | 345 | 0 | 0 | 0 | 0.0% |
| 17. juli | 5003 | 5003 | 0 | 1 | 1 | 0.0% |
| 18. juli | 5622 | 5622 | 0 | 11 | 11 | 0.2% |
| 19. juli | 8313 | 8313 | 0 | 0 | 0 | 0.0% |
| 20. juli | 8758 | 8758 | 0 | 0 | 0 | 0.0% |
| 21. juli | 15880 | 15880 | 0 | 0 | 0 | 0.0% |
| 22. juli | 15998 | 15998 | 3 | 290 | 293 | 1.8% |
| 23. juli | 17175 | 17175 | 0 | 0 | 0 | 0.0% |
| 24. juli | 10163 | 10163 | 1 | 55 | 56 | 0.6% |
| 25. juli | 12428 | 12428 | 0 | 123 | 123 | 1.0% |
| 26. juli | 13603 | 13603 | 0 | 0 | 0 | 0.0% |
| 27. juli | 10983 | 10983 | 0 | 0 | 0 | 0.0% |
| 28. juli | 14884 | 14884 | 0 | 70 | 70 | 0.5% |
| 29. juli | 10039 | 10039 | 1 | 956 | 957 | 9.5% |
| 30. juli | 16959 | 16959 | 0 | 0 | 0 | 0.0% |
| 31. juli | 16937 | 16936 | 0 | 35 | 35 | 0.2% |
| 1. august | 8519 | 8519 | 302 | 1 | 303 | 3.6% |
| **TOTAL** | **218k** | **218k** | **307** | **1542** | **1849** | **0.85%** |

**Obs.:** 29. juli ser ut som en langkryssing med motor-dominert seiling (9,5% av dagsdataene). 1. august inkluderer motor-cruise under frontpassasjen.

### Detaljert analyse: Topp-motor-dager

#### 29. juli: 9.5% (957 rader motor-mistanke)

**Kontekst:** Stabil vind, langkryssing Oslofjorden. Motor-andelen varierer ikke enkeltvis sekund for sekund, men finnes i klumper.

**Eksempel motor-cruise (ca. 11:00–13:20):**
```
11:05:46.738Z SOG=2.8 STW=0  → Motor-mistanke starter
...
13:16:44.771Z SOG=6.2 STW=0  → Cruise stabil
```

**Konklusjon:** Langkryssing med motor-seiling, muligens for å holde tidsplan under svak vind.

#### 1. august: 3.6% (303 rader motor-mistanke)

**Kontekst:** Frontpassasje. Motor startet omkring 09:42:51, cruise etablert 09:43:06.

**Eksempel cruise (09:43–09:50):**
```
09:43:21.923Z SOG=5.3 STW=0  → Ren motor
...
09:50:40.654Z SOG=4.7 STW=0  → Cruise stabil
```

**Konklusjon:** Motor brukt for å komme ut av lull under front; cruise etablert.

#### 22. juli: 1.8% (293 rader motor-mistanke)

**Kontekst:** Muligens manøvering rundt Hvaler, eller kortsiktig motorassist.

---

## Implikasjon for v1-databruk i kalibrering

### F1.0 (Farbarhetsmaske): **IKKE påvirket**
Farbarhetsmasken bruker kartdata, ikke båtens seiling-polar. Motor spiller ingen rolle.

### F3.3 (Polar-seiling-kalibrering): **KRITISK PÅVIRKET**

**Problem:** Motor-seiling-radene (1.8–9.5% per dag) kan ikke brukes til seiling-polar-fasit. En motor-cruise på 5 kn under 3 kn vind ser ikke ut som et seiling-datapunkt — det er systemfeil i golden-testet.

**Anbefalt tiltak:**

| Omfang | Tiltak | Resultat |
|--------|--------|----------|
| **Konservativ** | Ekskluder dager med > 1% motor-mistanke | Brukbar: 14., 17.–21., 23., 26.–27., 30. juli (10 dager, ~144k rader) |
| **Moderat** | Ekskluder dager med > 2% motor-mistanke | Brukbar: 14., 17.–21., 23., 26.–27., 30.–31. juli, 1. august (11 dager, ~161k rader) |
| **Tolerant** | Merk motor-rader eksplisitt i golden, test separat | Brukbar: alle 17 dager, men 1849 rader (0.85%) merket som «ukjent fremdrift» |

**Anbefaling:** **Moderat tiltak** (ekskluder dager > 2%) sikrer seiling-polar-renhet uten tap av kritisk vær-variabilitet. Alternativt: merk 1849 motor-mistenkelige rader og inkluder dem som «skilt» test-tilfeller.

---

## Frontpassasje-ankeret (1. august) og motor

**Kryss-sjekk:** 1. august har 3.6% motor-mistanke, og frontpassasjen (09:41–09:43) vises av heuristikken som 100% motor:
- **STW-profil:** 1.0 → 2.4 → 0.0 kn (motor tar over omkring 09:42:51)
- **SOG-profil:** 1.0 → 3.7 → 5.2 kn (motor-akselerasjon under lull)

**Konklusjon:** Ankeret er **gyldig for vind-parametere** (TWD/TWS/lull-profil), men **båt-responsen (SOG) er motor-drevet** og kan ikke brukes direkte som seiling-fasit.

**Merking i v1-frontpassasjer.md:** ✓ Gjort. Kapittel «Motorseiling-konklusjon for 1. august» spesifiserer at STW=0 gjennomgående postfrontal.

---

## Konklusjon og anbefaling

1. **Motor-deteksjonsheuristikk virker:** STW < 0.5 + SOG > 2 er solid indikator for motor-cruise.

2. **Motor-andel er lav men fokusert:**
   - Gjennomsnitt: 0.85% (1849 av 218k rader)
   - Høye dager: 29. juli (9.5%), 1. august (3.6%), 22. juli (1.8%)
   - Rene seiling-dager eksisterer (< 0.5%): 14., 17., 19.–21., 23., 26., 27., 30. juli

3. **For F3.3 (polar-seiling-kalibrering):**
   - **Ekskluder dager 22., 24., 25., 28., 29. juli + 1. august** (høy motor-andel)
   - **Bruk dager 14., 17.–21., 23., 26.–27., 30.–31. juli** (~165k rader, ~76% av total)
   - Alternativt: merk og test motor-rader separat

4. **For S-3 (frontfikstur):** Vind-parametere (TWD/TWS/lull) er gyldige fra 1. august, men båt-responsen er motor-drevet. Se v1-frontpassasjer.md for merking.

5. **Transparens:** Dokumenter denne motor-heuristikken og eksklusjon i golden-tester, slik at regresjoner later ikke motor-påvirkning som fakta-endringer.
