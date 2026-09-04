---
name: thredds-kilde-egenskaper
description: MEPS/THREDDS kildeegenskaper — enheter, projeksjon, katalog, DDS/DAS-oppslag, feller funnet ved ekte data
metadata:
  type: project
---

Arbeidsnotater om selve datakilden (`thredds.met.no`), ikke om
kodearkitekturen — `docs/specs/vaerpakker.md` er sannheten for formatet,
dette er huskeliste for kilde-spesifikke feller.

- **Katalog:** `https://thredds.met.no/thredds/catalog/mepslatest/catalog.xml`
  lister `meps_lagged_6_h_latest_2_5km_<YYYYMMDD>T<HH>Z.nc`-kjøringer,
  nyest først. Dataset-URL for OPeNDAP: samme navn under
  `.../dodsC/mepslatest/<navn>`.
- **Enhet-felle (funnet 2026-09-03, IKKE fantasi):** `x_wind_10m`/
  `y_wind_10m` er **m/s**, ikke knop. `docs/specs/vaerpakker.md` §3 krever
  knop for lagringsformatet. Konverter med `3600/1852` FØR kvantisering.
  Ingen kode konverterte dette automatisk før bølge 2A — sjekk enhet
  eksplisitt for ethvert NYTT felt (strøm/bølge er sannsynligvis også
  m/s, ikke verifisert ennå).
- **Rotasjon-felle (funnet 2026-09-03):** MEPS' u/v-vind er
  griddrelative (Lambert-projeksjonens egne x/y-akser,
  `grid_mapping "projection_lambert"`), IKKE sann øst/nord. Må roteres
  via `lambert-rotation.ts` FØR kvantisering, ellers stille, voksende
  retningsskjevhet. LCC-parametre verifiseres per bygg mot `.das`
  (`das-verification.ts`) — hard-feil ved avvik, IKKE stol på at
  parametrene forblir like for alltid.
- **Ensemble:** `ensemble_member`-dimensjonen har 30 verdier (kontroll +
  29). Hent ALLE medlemmer i ETT OPeNDAP-kall per variabel per flis
  (`buildAllMembersDodsUrl`) — 30 separate kall er samme byte-volum, men
  mye tregere og bryter §16s sekvensielt-krav i praksis.
- **Domenestørrelse:** full MEPS-grid er ~1069×949 (y×x) noder, sett
  2026-09-04. Kan endre seg mellom MET-oppdateringer — ikke hardkod.
- **Fetch-tid varierer VILT per flis** (samme kjøring, samme dag): 0,4 s
  til 34,6 s for identisk volum (46×27×49×30). Trolig THREDDS-server-side
  cache-varme for nylig spurte indeksvinduer. Ikke en bug i klientkoden —
  ikke invester i å "fikse" en enkelt treg flis uten å måle flere ganger.
- **Live-bygg tar variabel tid**: init-kjøringen kan skifte MIDT i en
  test-økt (MET publiserer ny kjøring hver time) — et rebuild kort tid
  etter et tidligere kan hente en NYERE init enn forrige kjøring, med
  ANDRE payload-hash-er (selv om koden ikke endret seg). Ikke anta
  identisk output mellom to `build-live`-kjøringer samme dag.
- **`.grid-index-cache.json`** (permanent, git-ignorert) er nøkkel-basert
  på `tileIdToString` — bytte `WEATHER_TILE_DEG` gir nye nøkler
  automatisk (ingen kollisjon med gamle 2°-oppføringer), men gamle
  oppføringer blir værende som ubrukt cruft. Ikke et problem, bare synlig
  hvis man inspiserer filen.
