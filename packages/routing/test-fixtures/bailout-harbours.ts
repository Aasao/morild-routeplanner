/**
 * Interim nødhavnliste for R2-fasiten (måleplanens §6.1).
 *
 * **Dokumentasjonen med forbehold og kjente svakheter er
 * `docs/research/bailout-interim.md` — les den før tallene brukes til noe.**
 * Listen er data for en måling, ikke en navigasjonsanbefaling, og erstattes
 * av F4.6-havneboken i fase 4.
 *
 * Den ligger i `test-fixtures/` med vilje: motoren skal ikke eie en havneliste.
 * `bailout.ts` tar havnene inn som parameter.
 */
import type { BailoutHarbour } from "../src/index.js";

/**
 * Åtte havner langs Skjæløy → Skagen, i rekkefølge fra nord. Rekkefølgen
 * påvirker bare rapporteringen (R2 stopper ved første havn som lykkes), ikke
 * dommen.
 */
export const INTERIM_BAILOUT_HARBOURS: readonly BailoutHarbour[] = Object.freeze(
  [
    {
      name: "Skjæløy",
      position: { lat: 59.1032, lon: 10.9327 },
      exposedFromDeg: 200,
      exposedHalfWidthDeg: 60,
      maxOnshoreTwsKn: 30,
      maxHsM: 2.5,
    },
    {
      name: "Fredrikstad",
      position: { lat: 59.21, lon: 10.95 },
      exposedFromDeg: 190,
      exposedHalfWidthDeg: 45,
      maxOnshoreTwsKn: 35,
      maxHsM: 2.0,
    },
    {
      name: "Strömstad",
      position: { lat: 58.935, lon: 11.173 },
      exposedFromDeg: 250,
      exposedHalfWidthDeg: 55,
      maxOnshoreTwsKn: 30,
      maxHsM: 2.5,
    },
    {
      name: "Fjällbacka",
      position: { lat: 58.599, lon: 11.287 },
      exposedFromDeg: 250,
      exposedHalfWidthDeg: 55,
      maxOnshoreTwsKn: 28,
      maxHsM: 2.5,
    },
    {
      name: "Smögen",
      position: { lat: 58.355, lon: 11.228 },
      exposedFromDeg: 260,
      exposedHalfWidthDeg: 60,
      maxOnshoreTwsKn: 26,
      maxHsM: 3.0,
    },
    {
      name: "Lysekil",
      position: { lat: 58.274, lon: 11.435 },
      exposedFromDeg: 200,
      exposedHalfWidthDeg: 50,
      maxOnshoreTwsKn: 30,
      maxHsM: 2.5,
    },
    {
      name: "Marstrand",
      position: { lat: 57.887, lon: 11.586 },
      exposedFromDeg: 250,
      exposedHalfWidthDeg: 60,
      maxOnshoreTwsKn: 26,
      maxHsM: 3.0,
    },
    {
      name: "Skagen",
      position: { lat: 57.7211, lon: 10.5836 },
      exposedFromDeg: 60,
      exposedHalfWidthDeg: 55,
      maxOnshoreTwsKn: 28,
      maxHsM: 3.0,
    },
  ].map((h) => Object.freeze(h)),
);
