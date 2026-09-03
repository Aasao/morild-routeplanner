/**
 * Generiske romlige/tidslige interpolasjonsprimitiver (§3 punkt 4-5) —
 * bilineær i rom, lineær i tid, brukt på u/v HVER FOR SEG, aldri på
 * `fromDeg`/`speed` direkte (§3s advarsel mot vinkel-gjennomsnitt over
 * 350°/10°-grensen).
 *
 * `field.ts::decodeLayerAt` gjør den kombinerte rom+tid(+vinkelkanal)-
 * interpolasjonen i én sveip, av ytelseshensyn (§9.7). Disse to funksjonene
 * er de separate, elementære byggeklossene bak nøyaktig samme matematikk —
 * brukt av produsent-siden (`tools/weather-pack`) til å verifisere egne
 * interpolasjonsvalg FØR kvantisering (byggetids-QA), uavhengig av
 * klientens dekodingssti.
 */

/** Bilineær interpolasjon av ÉN skalarkomponent (kall separat på u og v). */
export function bilinearInterpolateComponent(
  v00: number,
  v10: number,
  v01: number,
  v11: number,
  fx: number,
  fy: number,
): number {
  const top = v00 * (1 - fx) + v10 * fx;
  const bottom = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Lineær tids-interpolasjon av ÉN komponent mellom to tidssteg (§3 punkt 5). */
export function linearInterpolateComponentInTime(v1: number, v2: number, frac: number): number {
  return v1 * (1 - frac) + v2 * frac;
}
