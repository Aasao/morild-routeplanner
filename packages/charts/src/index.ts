/**
 * packages/charts — farbarhetsmaske og kartdata-abstraksjon.
 *
 * `ChartSource` (spec `docs/specs/farbarhetsmaske.md` §3.6): rene oppslag
 * mot en allerede innlest, ferdig bygget kartpakke. All polygonalgebra
 * (union/differanse/buffer) skjer i byggetid i `tools/chart-pack` — denne
 * pakken gjør kun punkt-/segmenttester (F1.0).
 */
export * from "./pack-format.js";
export * from "./point-in-polygon.js";
export * from "./catzoc.js";
export * from "./chart-source.js";
