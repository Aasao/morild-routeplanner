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
  /**
   * Deratingen regnes fra **bølgebratthet** (F3.2, `Hs/Tp²`) i stedet for fra
   * Hs alene. Av som standard: alle eksisterende fiksturer og golden-ruter
   * bruker v1-heuristikken, og den skal ikke endres av at S-8 finnes.
   *
   * Kreves av S-8 (vind mot strøm): der er hele fellemekanismen at den samme
   * bølgehøyden er ufarlig på 7 s og alvorlig på 5 s. Hs alene lyver — se
   * `docs/research/review-seiler.md` punkt 3.
   */
  readonly steepnessDerating?: boolean;
}

/**
 * Bølgebratthet S = 2πHs/(g·Tp²) — dimensjonsløs. Typiske verdier: ~0,03 i
 * vanlig vindsjø, ~0,06 i kort sjø, ~0,10 der bølgene begynner å bryte.
 */
export function waveSteepness(hsM: number, tpS: number): number {
  return (2 * Math.PI * hsM) / (9.81 * tpS * tpS);
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
    waveFactor(hsM, tpS, relDirDeg) {
      if (ignoreWaves || hsM <= 0) return 1;
      if (options.steepnessDerating === true && tpS !== undefined && tpS > 0) {
        // Bratthetsderating (F3.2). Tapet starter først over S ≈ 0,025 —
        // en lang dønning bremser ikke — og er retningsavhengig: motsjø
        // verst, medsjø nesten gratis. Faktoren skaleres også med Hs, slik
        // at bratt småkrapp sjø på 0,3 m ikke deraterer noe særlig.
        const excess = Math.max(0, waveSteepness(hsM, tpS) - 0.025);
        const dir = relDirDeg < 60 ? 1 : relDirDeg <= 120 ? 0.6 : 0.25;
        const size = Math.min(1, hsM / 1.5);
        return Math.max(0.35, 1 - 9 * excess * dir * size);
      }
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
