# Kartverket — Sjøkart raster (WMTS)

- Brukes til: kartvisning (F1.8), visuelt bakteppe i MapLibre — **ikke**
  farbarhetsberegning (raster er visning, vektordata er sannhet, jf.
  CLAUDE.md prinsipp 2)
- Status: verifisert via kartdata-research; lisenstekst ikke hentet direkte

## Kilde

- WMTS: `https://cache.kartverket.no/v1/service?service=WMTS&request=GetCapabilities`
- Dekning: overseilings-, hoved-, kyst- og havnekart, EPSG:25832/33/35 +
  3857 (Web Mercator)
- Gammel `opencache.statkart.no` fases ut — sjekk status:
  https://status.geonorge.no/cache.html før driftsatt bruk

## Lisens og vilkår

CC BY 4.0, attribusjon **«© Kartverket»**. Sjøkart raster er eksplisitt
merket **«ikke beregnet for navigasjon»** — denne ansvarsfraskrivelsen skal
videreføres i appens UI (dekker N1 sammen med appens egen disclaimer).

## Attribusjonskrav i UI

«© Kartverket» + «ikke for navigasjon»-disclaimer synlig på/nær kartflaten
til enhver tid raster-laget vises (F1.8).

## Rate limits / caching

**Uavklart, se `docs/01-prosjektplan.md` risikotabell:** «Kartverket-vilkår
for tile-caching» er notert som en åpen risiko med mottiltak «e-post-
avklaring; fallback: direkte WMTS uten mellomlagring». Ingen mellomlagring
av WMTS-fliser i Cloudflare-siden skal implementeres før dette er avklart
skriftlig med Kartverket — inntil da: direkte WMTS-kall fra klienten (innen
normal offline-synk av valgte områder, F1.9), ingen server-side re-cache/
redistribusjon.

## Gjenstår / uverifisert

- Skriftlig avklaring av cache-/redistribusjonsvilkår for WMTS-fliser
  (se prosjektplanens risikotabell).
- Eksakt lisenstekst hentet direkte fra Kartverkets vilkårsside
  (`https://www.kartverket.no/en/api-and-data/terms-of-use`) — bør leses i
  sin helhet av Magnus før `apps/pwa` går i produksjon med dette laget.
