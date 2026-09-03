/**
 * Retningsbudsjett utledet fra en kjent fart-dekodefeil — brukt av
 * `build-live-package.ts::verifyRoundTrip` (review-funn fase 3 bølge 2:
 * rundturen sammenlignet tidligere KUN fart; `fromDeg`-avviket ble logget,
 * men avgjorde aldri om bygget besto). Ren, nettverksfri matematikk —
 * skilt ut i egen fil for å være enhetstestbar uten å måtte konstruere hele
 * `FetchedWindComponents`/serialiserte lag-payloads.
 */

/**
 * Minste vinkeldifferanse (grader, alltid i [0,180]) mellom to retninger —
 * korrekt over 0°/360°-wraparound (359° og 1° er 2° fra hverandre, ikke
 * 358°).
 */
export function angularDiffDeg(aDeg: number, bDeg: number): number {
  const diff = Math.abs(aDeg - bDeg) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Maks mulig retningsavvik (grader) for en sann vindvektor med fart
 * `speedKn`, gitt en kjent maks fartsdekodefeil `maxDecodeErrorKn`.
 *
 * Modell: kvantiseringen kan i verste fall legge til en feilkomponent av
 * størrelse `maxDecodeErrorKn` i EN HVILKEN SOM HELST retning i u/v-
 * vektorrommet (den er ikke garantert langs den sanne vektoren). For en
 * sann vektor med lengde `speedKn`, gir en ORTOGONAL feilkomponent av
 * denne størrelsen det STØRST mulige retningsavviket, `asin(e/speedKn)` —
 * standard liten-vinkel-fri feilanalyse for vektorer (eksakt, ikke en
 * linearisering: for `e <= speedKn` er `asin(e/speedKn)` nøyaktig den
 * vinkelen der feilvektoren står vinkelrett på den opprinnelige, som er
 * verste fall).
 *
 * **Terskel/udefinert-tilfellet:** for `speedKn <= maxDecodeErrorKn` er
 * `e/speedKn >= 1` — `asin` er ikke lenger en meningsfull skranke (en
 * nær-null-vektor kan i prinsippet ende opp med å "peke" hvor som helst
 * når en feil på samme størrelsesorden som selve vektoren legges til).
 * Retningen er DÅRLIG DEFINERT ved så lav fart, ikke en budsjett-
 * overskridelse — funksjonen returnerer `undefined` i det tilfellet, og
 * kalleren skal ALDRI telle `undefined` som et brudd.
 */
export function maxDirectionErrorDeg(speedKn: number, maxDecodeErrorKn: number): number | undefined {
  if (maxDecodeErrorKn <= 0) return 0;
  if (speedKn <= maxDecodeErrorKn) return undefined;
  return (Math.asin(maxDecodeErrorKn / speedKn) * 180) / Math.PI;
}
