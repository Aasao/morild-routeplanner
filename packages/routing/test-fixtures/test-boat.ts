/**
 * Analytisk båtmodell for tester.
 *
 * Bevisst *ikke* Dufour 41-polaren: den hører hjemme i `packages/polar` og
 * skal kunne endres uten at rutemotorens tester ryker. Denne modellen er
 * glatt, monoton i TWS og har en realistisk avviklingssone mot vinden, slik
 * at kryssoppførselen faktisk testes.
 */
import type { BoatModel } from "../src/index.js";

export interface TestBoatOptions {
  readonly maxTwsKn?: number;
  readonly maxHsM?: number;
  readonly motorThresholdKn?: number;
  readonly motorSpeedKn?: number;
  readonly motorFuelLPerH?: number;
  /** Cruising-faktor: skalerer hele polaren. */
  readonly cruisingFactor?: number;
  /** Slår av bølgederating (nyttig i golden-fiksturer uten sjø). */
  readonly ignoreWaves?: boolean;
  /**
   * Farten uavhengig av TWA. Da finnes ingen VMG-gevinst ved å seile av
   * kursen, og den raskeste ruten *er* storsirkelen — det gjør det mulig å
   * måle ren diskretiseringsfeil, uten seilfysikk blandet inn.
   */
  readonly flatPolar?: boolean;
}

/** Vinkelfaktor: 0 i avviklingssonen, maks på romskjøts, litt lavere på lens. */
export function angleFactor(twaDeg: number): number {
  if (twaDeg < 32) return 0;
  if (twaDeg <= 100) return 0.55 + (0.45 * (twaDeg - 32)) / 68;
  return 1.0 - (0.25 * (twaDeg - 100)) / 80;
}

export function testBoat(options: TestBoatOptions = {}): BoatModel {
  const cruising = options.cruisingFactor ?? 1;
  const ignoreWaves = options.ignoreWaves ?? false;
  return {
    boatSpeedKn(twsKn, twaDeg) {
      const tws = Math.max(0, Math.min(twsKn, 25));
      const hullKn = 8.5 * (1 - Math.exp(-tws / 9));
      const shape = options.flatPolar === true ? 1 : angleFactor(twaDeg);
      return hullKn * shape * cruising;
    },
    waveFactor(hsM, _tpS, relDirDeg) {
      if (ignoreWaves || hsM <= 0) return 1;
      // v1s heuristikk: motsjø / tverrsjø / medsjø, gulv 45 %.
      const k = relDirDeg < 60 ? 0.09 : relDirDeg <= 120 ? 0.045 : 0.02;
      return Math.max(0.45, 1 - k * hsM);
    },
    maxTwsKn: options.maxTwsKn ?? 35,
    maxHsM: options.maxHsM ?? 4,
    motorThresholdKn: options.motorThresholdKn ?? 4,
    motorSpeedKn: options.motorSpeedKn ?? 7,
    motorFuelLPerH: options.motorFuelLPerH ?? 4,
  };
}
