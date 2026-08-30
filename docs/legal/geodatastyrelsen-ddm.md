# Geodatastyrelsen (Danmark) — Danmarks Dybdemodel (DDM) v2.0

- Brukes til: dansk farvann, fallback-kontekstlag — **aldri** som
  autoritativ sikkerhetskontur-kilde. Maks tillitsnivå `usikkert`, jf.
  `docs/specs/farbarhetsmaske.md` §3.3/§3.7 (middelverdi-datum)
- Status: verifisert (kartdata-research)

## Kilde

- Nedlasting (GeoTIFF): https://dataforsyningen.dk/data/4817
- WMS: tilgjengelig (URL ikke re-verifisert i denne omgangen, se
  research-rapporten `docs/research/kartdata-skandinavia.md` §2)
- Produsent: Geodatastyrelsen (dansk statlig geodatamyndighet)

## Innhold

50×50 m raster, fritt nedlastbar. **Eksplisitt merket «ikke egnet til
navigasjon»** av produsenten selv — dette er et gjennomsnittsraster
(middelverdi-modell), ikke en sjøkart-sikkerhetskontur.

## Datum

**Middelverdi-modell, IKKE sjøkartnull.** Dette er den viktigste
enkeltdetaljen ved denne kilden (arkitekt-review M4): et DDM-avledet
dybdebånd skal aldri kunne gi `trygt` i farbarhetsmasken, uansett målt
verdi — kun `usikkert` i beste fall. Merkes `datum: "DDM-middelverdi"` per
`docs/specs/farbarhetsmaske.md` §3.3.

## Lisens og vilkår

Fritt nedlastbar («fritt nedlastbar (GeoTIFF)» jf. research-rapporten) —
dansk offentlig geodata er normalt under en åpen lisens
(tilsvarende NLOD/CC BY). **Eksakt lisenstekst ikke hentet direkte** i
denne omgangen — bekreft på dataforsyningen.dk før produksjonsbruk.

## Attribusjonskrav i UI

Foreløpig antatt «© Geodatastyrelsen» — bekreft ordlyd. Kravspek N3 krever
eksplisitt at **DMI-/dansk-avledede data merkes** i UI — dette gjelder
tilsvarende for DDM: ethvert `usikkert`-nivå avledet fra DDM bør i
detaljvisning si «basert på dansk dybdemodell (DDM), ikke sjøkartnull»
fremfor bare «usikkert», for å være ærlig om *hvorfor* (N2).

## Vektor-ekvivalent

Forsøkt undersøkt om det finnes en dansk vektor-ekvivalent til norske
dybdekurver/tørrfall/skjær — **ikke funnet** i research-arbeidet.
Følges opp videre via gst.dk hvis dansk farvann blir mer prioritert
(kravspek F2.1 nevner DMI/CMEMS faset inn «ved Østersjø-tur» — samme
tidshorisont er naturlig for en eventuell dansk vektorleting).

## Gjenstår / uverifisert

- Eksakt lisenstekst.
- WMS-URL re-verifisert direkte (kun oppgitt i research-rapporten, ikke
  hentet på nytt i denne omgangen).
- Om en vektor-ekvivalent til dybdekurver/tørrfall/skjær finnes et sted
  hos Geodatastyrelsen.
