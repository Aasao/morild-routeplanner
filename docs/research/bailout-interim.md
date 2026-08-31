# Interim nødhavnliste — R2-fasiten i E1′

- Dato: 2026-08-31. Status: **INTERIM, kun for måling.**
- Hjemmel: `docs/research/maaleplan-e1-2026-08-31.md` §6.1 — «Bail-out-settet
  er en interim havneliste (skrives før kjøring, erstattes av F4.6-boken i
  fase 4)».
- Kode: `packages/routing/test-fixtures/bailout-harbours.ts`. Semantikken
  (anløpbarhet under medlemmets vær) ligger i
  `packages/routing/src/bailout.ts`.

## Hva listen er — og hva den ikke er

Listen finnes **kun for at R2-fasiten skal ha et definert bail-out-sett** når
måleplanens felle-definisjon kjøres. Den er ikke en navigasjonsanbefaling, den
er ikke kvalitetssikret mot havnedata, og ingen av tallene under skal brukes
til å planlegge et anløp.

Når F4.6-havneboken lander (fase 4), **erstattes** denne filen av den, og
E1′-tallene som er regnet på interim-listen mister gyldighet for
felle-identitet — de må da kjøres på nytt hvis felle-settet skal brukes til
noe annet enn å sammenligne varianter mot hverandre.

## Havnene

Åtte havner langs Skjæløy → Skagen, i rekkefølge fra nord. Koordinatene er
havnebassengets omtrentlige posisjon (± noen hundre meter), hentet fra
allment kjent geografi.

| # | Havn | Lat | Lon | Eksponert FRA | ± | Maks pålandsvind | Maks Hs |
|---|---|---|---|---|---|---|---|
| 1 | Skjæløy (Hvaler) | 59,1032 | 10,9327 | 200° | 60° | 30 kn | 2,5 m |
| 2 | Fredrikstad | 59,2100 | 10,9500 | 190° | 45° | 35 kn | 2,0 m |
| 3 | Strömstad | 58,9350 | 11,1730 | 250° | 55° | 30 kn | 2,5 m |
| 4 | Fjällbacka | 58,5990 | 11,2870 | 250° | 55° | 28 kn | 2,5 m |
| 5 | Smögen | 58,3550 | 11,2280 | 260° | 60° | 26 kn | 3,0 m |
| 6 | Lysekil | 58,2740 | 11,4350 | 200° | 50° | 30 kn | 2,5 m |
| 7 | Marstrand | 57,8870 | 11,5860 | 250° | 60° | 26 kn | 3,0 m |
| 8 | Skagen | 57,7211 | 10,5836 | 60° | 55° | 28 kn | 3,0 m |

**Eksponeringstallene er anslag, ikke målinger.** «Eksponert FRA» er den
retningen innseilingen ligger åpen mot; en havn diskvalifiseres i et medlem når
vinden står fra den sektoren med mer enn grensen, eller når Hs ved havnen er
over grensen — uansett retning. Sektorbredder og grenser er satt slik at de
skiller mellom rolige og harde medlemmer i fiksturene, ikke ut fra
havnestatistikk.

De svenske havnene ligger i skjærgården og er i virkeligheten godt skjermet;
verdiene over er derfor **konservative** (de diskvalifiserer havnen oftere enn
virkeligheten ville gjort). Det er den riktige retningen for en fasit som skal
avgjøre om et medlem er en felle: heller kalle en tvilsom havn utilgjengelig
enn å hvile på en havn båten ikke kunne løpt inn i.

## Kjente svakheter (skal ikke pyntes på)

1. **Innseilingene er ikke modellert.** Fiksturmasken er rektangler; å nå
   havnens posisjon i modellen er ikke det samme som å komme inn i havnen. R2
   måler «kom fram til havnens posisjon innen 6 t under medlemmets vær», ikke
   «gjorde et forsvarlig anløp».
2. **Åpningstid, dybde, plass og landfeste** er ikke med i det hele tatt.
3. **Rekkefølgen i listen er avgjørende for rapporteringen**, ikke for
   dommen: R2 stopper ved første havn som lykkes, så `attempts` viser hvilke
   havner som ble forsøkt. Dommen (felle eller ikke) er uavhengig av
   rekkefølgen.
4. Fredrikstad ligger **nord for** Skjæløy og er derfor sjelden relevant for
   en sørgående rute; den er med fordi en nødhavn bak seg er en reell mulighet
   når fronten kommer forfra.
