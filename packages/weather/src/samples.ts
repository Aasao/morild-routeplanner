/**
 * De dekodede sample-typene klienten (og til slutt rutemotoren) ser.
 *
 * **`docs/specs/vaerpakker.md` §3, avsnittet "Hvor typeskillet vind/strøm
 * lever":** `WindSample` (FRA) og `CurrentSample` (MOT) er distinkte typer
 * uten en felles `VectorSample`. Det er bevisst — å bytte dem om skal være
 * en kompileringsfeil, ikke en kjøretidsfeil. Strukturelt er de identiske
 * ({u,v} vs. {speedKn,fromDeg} — faktisk ikke engang strukturelt like),
 * men selv om de hadde vært det, ville en felles overtype gjort ombyttingen
 * TS-lovlig igjen. Derfor: to separate `interface`, ingen union, ingen
 * gjenbrukt felt-navngiving som kunne friste noen til å slå dem sammen.
 *
 * Disse typene er en bevisst, strukturelt kompatibel *speiling* av
 * `WeatherField`-kontrakten i `packages/routing/src/contracts.ts` — de er
 * IKKE importert derfra. `packages/weather` importerer aldri
 * `@morild/routing` (arkitekturgrensen, `tools/arch-tests`, håndhever dette
 * likt for begge pakker: verken routing eller weather skal avhenge av den
 * andre). TypeScripts strukturelle typing gjør at et objekt formet som
 * disse typene er tildelbart til routing sin `WeatherField` uten import —
 * se `weather-field-adapter.ts`.
 */

export interface WindSample {
  readonly speedKn: number;
  /** FRA-retning: vinden kommer fra denne retningen (§3). */
  readonly fromDeg: number;
}

export interface WaveSample {
  readonly hsM: number;
  /** Kan mangle selv når `hsM` finnes (§4.3, §12). */
  readonly tpS?: number;
  /** FRA-retning (MET-konvensjon). Kan mangle uavhengig av `tpS`. */
  readonly fromDeg?: number;
}

export interface CurrentSample {
  /** MOT-retning, komponent mot øst, knop. */
  readonly u: number;
  /** MOT-retning, komponent mot nord, knop. */
  readonly v: number;
}
