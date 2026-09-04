# V1 Morild-ruter: innsikter for Fase 4a robust-design

**Dato**: 2026-09-04  
**Kilde**: C:\RoutePlanner (lesekun analyse); 218k logg-rader (juli–august 2026)  
**Mål**: Destillere erfaringer for Fase 4a ensemble-ruting, perturbas-jon, og robusthet-presentasjon

---

## 1. Hva v1 gjorde (og ikke gjorde) med usikkerhet

### Gjøremål
- **Avgangsvinduer** (analyzeDepartures, linje 927–1014): Testet diskrete avganger +0/+6/+12/+18/+24/+36/+48 timer med identiske innstillinger, samme A*-felt (delt heuristikk for effektivitet, linje 968–988). Output: varighet, snitt/maks TWS, maks Hs, upwind-prosent, motortimer, drivstoff per avgang.
- **Kalibreringsfaktorer som user-input**: Cruising-faktor («reef», område 0.70–1.00, default 0.90), motor-terskler (STW < 4 kn → motor), bølge-derating (koeffisienter per bølgeretning; gulv 45 %).
- **Presentasjon av usikkerhet**: «Raskeste avgang» markert i grønt; «mål ikke nådd»-advarsel hvis ruten stoppet mer enn 0.3 nm fra mål (linje 1233: blokkering av varslingsvindu, maks-TWS, eller land).

### Ble ikke gjort
- **Ikke ensemble** i moderne forstand (ikke MEPS-medlemmer eller stokastisk perturbasjon).
- **Ikke P50/P90** eller gjennomførbarhet-prosent innenfor én avgang.
- **Ikke perturbasjon av cruising-faktor** eller avgangstid rundt ein valgt punkt.
- **Ikke eksplisitt bail-out-analyse** (motor-utgang, nødhavn-valg, brensle-buffer).

---

## 2. Kalibreringsdata: spredning og avvik

### Rådata fra CSV-logger (78.8 % ankring, 14.5 % motor, 5.7 % seil)

| Målevar | Min | Maks | Gj.snitt | Std | Merknad |
|---------|-----|------|----------|-----|---------|
| **TWS (kn)** | 0.0 | 34.1 | 10.02 | 5.90 | Vindstyrke; 28.8 % av tid ≥ 15 kn |
| **STW (kn)** | 0.0 | 9.8 | 1.34 | 2.66 | Global gjennomsnitt (sterkt anker-skjevt) |
| **STW når seil** | – | – | 6.35 | – | Under aktiv seiling (5.7 % av tid) |
| **SOG når seil** | – | – | 5.62 | – | STW − 0.73 kn drift fra strøm/sjø |

### Cruising-faktor-variasjon (STW / polar-estimat)

Grovt estimat fra polar-tabellene (v1 POLARS PTE, linje 294–305):

| Vind-regime | Cruise-faktor | N obs. | Merknad |
|-------------|---------------|--------|---------|
| **Lett (< 10 kn)** | 1.21 | 6,953 | Over 0.90-default; optimal trim/rolig sjø |
| **Medium (10–15 kn)** | 0.86 | 11,939 | Under default; degradering eller økt ankring |
| **Sterk (15+ kn)** | 0.87 | 22,276 | Konsistent degradering; 28.8 % av tid |

**Tolking**: v1s default 0.90 er «gjennomsnittlig kurering»-estimat. Spredning 0.86–1.21 (ca ±40 % fra gj.snitt) indikerer at en single cruising-faktor ikke fanger variabilitet i trim, sjøtilstand, eller målsetning (race vs komfort).

### Avvik mellom prognoser og observert vind

**Ikke direkte sammenlignet** i v1-koden (værdata hentes fra Open-Meteo/MET, ikke sammenholdt med målt TWS). Kalibreringsloggene viser observert TWS, men v1 lagrer ikke prognose fra hver ruting. **Implikasjon for v2**: hvis Fase 4a kjører perturbasjon, må vi definere usikkerhet-spektrum for:
- Twin-vind (±15–20 % typisk ved 12–24 h forecast; MEPS-spredning i MET-data)
- Forsinkelses-bias (prognose gjerne 1–2 timer sen på fronter)
- Romlig usikkerhet (±30–50 km typisk for turbulente områder)

---

## 3. Avgangstid-følsomhet

### Strategi i v1
- Sju diskrete offsets [0, 6, 12, 18, 24, 36, 48] timer fra bruker-valgt baseline (linje 931).
- Parallell kjøring med delt A*-distansefelt (fase 1 bygger, fase 2+ gjenbruker; inntil 4 workers).
- **Ingen optimering** av offset-valg; bruker tester manuelt.

### Observert mønster fra logger
- **28.8 % av tiden sterkt vind (≥ 15 kn)** → anbefal tidsvindu før/etter kaldfront (typisk 12–24 h).
- **Stabil kraft-forhold** på andre siden av front (varighet 6–12 timer typisk).

### Implikasjon for v2-ensemble
- **Offset-perturbasjon** bør favne ±3–6 timer omkring bruker-valgt tid (ikke bare +0/+6/+12…; finere aufløsning ved interessante tider).
- **Front-deteksjon** kunne gi «raskeste avgang»-hint automatisk (hvis TWS-variabilitet stor, varsle om timing).

---

## 4. Motor-bruk og bail-out-signaler

### Størrelses-estimat
- **14.5 % av tid**: aktivt motor (STW ≥ 6 kn, estimert 6.5 kn marsjfart).
- **0.0 % av tid**: grensesonen 0.5–4 kn (hvor motor *kunne* ha vært brukt, men rådata viser diskontinuitet: 78.8 % ankring → 14.5 % motor, lite mellomrom).
- **Drivstoff (logging-gjennomsnitt)**: 3.0 l/t × motortimer (estimat D2-60F marsjfart, ikke dokumentert).

### Bail-out-kriterier i v1 (linje 1233)
Rute feiler hvis:
1. **Varslingsvinduet oppbrukt** (værdata slutter før mål nådd).
2. **Maks-TWS-grense aktivert** og innlukker området (brukerkontrollert, typisk 0 = av).
3. **Land-blokkering** (ruten kan ikke komme forbi kysten; A*-felt stenges).

**Ikke eksplisitt motorstans-logikk** eller dybde-grenser. Dyp logges (linje 1514 fra Signal K) men brukes ikke for rutebeslutningen.

### Implikasjon for Fase 4a
- **Motorfart/-forbruk**-usikkerhet: bruk 6.5 ±0.8 kn (margin for økende forbruk ved sjø/alderdom).
- **Brensle-buffer**: standard 40–50 l reserve; flagg P90-scenario hvis motor > 50 % av ruten (HIGH RISK).
- **Dybde-buffer**: hvis søkeområde har kjente grunner, legg 2 m under kartert dybde; v1 neglisjerer dybde (hittil sikker på Skandinavia-kystene).

---

## 5. Kjente feller og ytelsesgrenser

### Hva v1 prøvde som ikke virket (eller hadde begrensninger)
- **Bølge-derating som heuristikk** (fast koeffisient per retning, gulv 45 %). Bedre ville være CFD-modell, men dataene finnes ikke. Kalibrer ved sammenligning med logg.
- **Motorfart som konstant** (6.5 kn, 3.0 l/t). Varierer faktisk med forhold (oppsjø/lav temp reduserer effekt). v1 dokumenterer dette som «estimat», bruker håndstilt reef-justering.
- **A*-feltet vender fra mål** (underestimerer praktisk avstand nær land). Mitigert ved at feltet kjøres 2× hvis første forsøk mislykkes (ikke i koden, men hinted i notat linje 1158).

### Ytelsesgrenser
- **Søkeområde**: A*-grid celles fra 0.02–0.06 grader (1–3 nm) avhengig av søkeomfang. Over ~140k celler → adaptive forenklings-gulp (linje 624–627). Første run (landmasken) kan ta 2–5 sekunder på treg maskin; gjenbruk-fase ~500 ms.
- **Kystlinje-lastet**: Overpass-fliser lagres lokalt (IndexedDB); kun første søk i område er tregt. Opptil 50k coastline-segmenter i gridd; adaptive simplifikasjon hvis over 60k (linje 608–616).
- **Værdata**: Open-Meteo gratis API, inntil 60–100 gitterpunkter per kall. Hentes på forespørsel, caches ikke mellom sesj oner.

### Ikke implementert
- **Stokastisk vindmodell** (bølge-like spredt feltspektrum). Bare deterministisk interpolasjon.
- **Driftmodell** (strøm over grunn inkludert bank-effekter). Copernicus 8 km brukt direkte.

---

## 6. Konkrete kodesteder for v2-påheng

| Fenomen | Kodested i v1 | Bruk for Fase 4a |
|---------|---------------|------------------|
| Cruising-faktor | HTML linje 130, JS linje 696 (`polar*reef*waveFactor`) | Perturbasjon ±0.1–0.15 rundt default 0.90 |
| Bølge-derating | JS linje 594–598 (waveFactor) | Bruk samme formel; perturber k±20 % |
| Motor-logikk | JS linje 697 (`if bsp < motorThr, use motorSpd*f`) | Gjennomfør P50/P90 motorforbruk-scenarios |
| Avgangsvinduer | JS linje 927–1014 (analyzeDepartures) | Refaktor til delt-A*-felt-pool; legg til ±3h offset rundt hver MEPS-tid |
| Polardata | JS linje 294–315 (POLARS.PTE / GTE) | Holder seg; bruk derating-margin ved P90-request |
| Avstandsfelt | JS linje 619–658 (buildDistField) | Delt som i v1; køes av ensemble-jobs |

---

## 7. Foreslåtte innganger til Fase 4a-spec

1. **Ensemble-strategi**: Bruk +MEPS kontroll (deterministisk best) + 30 medlemmer. Delt A*-felt fra kontroll; hver medlem kjører A* med eget værfelt.
2. **Perturbasjon-dimensjoner**:
   - Avgangstid: ±3 timer omkring bruker-valgt (eller auto-detect "raskeste" fra MEPS-spread)
   - Cruising-faktor: 0.75, 0.90, 1.00 (P25/P50/P75)
   - Motor: nominal 6.5 kn og +5 % forbruk (degradering)
   - Maks-TWS: ev brukerkontroll foreslått +0/+5/+10 %

3. **Robust-output**:
   - Per avgang (kontroll + +1st percentil medlem): P50 tid, P90 tid, gjennomføring-prosent
   - Trafikklys: grønt (P90 < budsjett), gult (P50 OK, P90 utelukkende), rødt (P50 fail)
   - Plantid-anbefaling: "Anbefal avgang X hvis du trenger sikkerhet; avgang Y hvis optimalt"

4. **Kalibreringsløkke**: Lagre MEPS-medlem-prestasjons data fra Fase 3E gjennom hele Fase 4; bruk til å kalibrere cruise-faktor og bølge-derating.

---

## Kalibreringsspørsmål for Magnus

1. Hvordan var forholdet mellom CSS-rated polar (race-profil) og faktisk cruising? Var 0.90 «realistisk» fra egen erfaring?
2. Så du at motorfarten (6.5 kn) varierte med sjø, temperatur eller algeutslag? Eller var det konsistent?
3. Hadde du dager der A*-feltet blokkerte en nærliggende passasje (dybde/grunne), eller var land alltid årsaken?

---

## Referanser

- morild_weather_router.html: polarer (linje 294–315), computeRoute (linje 673+), bølge (594–598), avgang (927–1014)
- morild_bridge.js: CSV-format (linje 115), snapshot-vind (linje 75–94)
- logs/morild_YYYYMMDD.csv: 217.9k rader, hele juli–august 2026
