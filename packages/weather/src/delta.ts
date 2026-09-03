/**
 * Delta-koding langs tidsaksen — den delen av budsjettregnskapet
 * (`docs/specs/vaerpakker.md` §8: «~20–28 MB etter delta+gzip, faktor
 * 1,5–2,5×») som gjør de kvantiserte byteserien gzip-vennlige.
 *
 * **Presisering (dokumentert her, ikke i selve §9.9-kontrakten — se
 * spec-ens endringslogg 2026-09-03):** `QuantizationParams` (§9.9) nevner
 * ingen delta-modus, og det er bevisst — delta-koding er en transportlags-
 * transform på RÅ BYTEVERDIER, ikke en del av selve kvantiseringsskjemaet.
 * Den er fysisk agnostisk (opererer på byte, ikke på fysisk verdi) og
 * derfor korrekt uansett om skala/offset endrer seg mellom tidsskiver
 * (§7: hver subflis bærer sin egen skala/offset **per tidssteg**) — en
 * byte-differanse mod 256 er reversibel akkurat like eksakt enten skalaen
 * er lik nabotidsskiven eller ikke.
 *
 * Denne modulen leverer transformen som en delt, testet primitiv, klar for
 * `tools/weather-pack` (batch-encoder, kommer i en senere bølge) å bruke
 * når den bestemmer per-subflis-lagringen. Verifisering av at delta+gzip
 * faktisk oppnår 1,5–2,5× i praksis skjer der, mot ekte kvantiserte
 * fliser — ikke her.
 */

/**
 * Koder en tidsserie av like lange byte-grid (ett `Uint8Array` per
 * tidssteg, én verdi per node) til deltaer: første skive uendret, hver
 * påfølgende skive er `(nå − forrige) mod 256` per node.
 *
 * Mod-256-differansen er reversibel uavhengig av hva byteverdiene betyr —
 * `decodeTemporalDeltaU8` er den eksakte inversen, alltid, for enhver
 * gyldig byteserie (inkl. sentinelverdien 255, som bare er en byte som
 * enhver annen i dette laget).
 */
export function encodeTemporalDeltaU8(
  series: readonly Uint8Array[],
): Uint8Array[] {
  if (series.length === 0) return [];
  const len = series[0]!.length;
  for (const slice of series) {
    if (slice.length !== len) {
      throw new Error("encodeTemporalDeltaU8: alle tidsskiver må ha samme lengde");
    }
  }
  const out: Uint8Array[] = [Uint8Array.from(series[0]!)];
  for (let k = 1; k < series.length; k++) {
    const prev = series[k - 1]!;
    const curr = series[k]!;
    const delta = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      delta[i] = (curr[i]! - prev[i]! + 256) & 0xff;
    }
    out.push(delta);
  }
  return out;
}

/** Den eksakte inversen av `encodeTemporalDeltaU8`. */
export function decodeTemporalDeltaU8(
  deltas: readonly Uint8Array[],
): Uint8Array[] {
  if (deltas.length === 0) return [];
  const len = deltas[0]!.length;
  const out: Uint8Array[] = [Uint8Array.from(deltas[0]!)];
  for (let k = 1; k < deltas.length; k++) {
    const prev = out[k - 1]!;
    const d = deltas[k]!;
    const curr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      curr[i] = (prev[i]! + d[i]!) & 0xff;
    }
    out.push(curr);
  }
  return out;
}
