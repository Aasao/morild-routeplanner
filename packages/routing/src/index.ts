/**
 * packages/routing — isokron rutemotor med Pareto-etiketter (ADR-0004),
 * kjørt alltid på klienten (ADR-0002: «klienten beregner, skyen forbereder»).
 *
 * Ren og deterministisk kjerne: samme input → samme rute. All I/O lever
 * utenfor motoren — det er forutsetningen for ensemble-kjøring og for
 * golden-route-regresjon, og det håndheves strukturelt: denne pakken
 * importerer aldri fetch/fs/node:-moduler, bruker aldri klokka eller
 * `Math.random`, og venter aldri (`await`). Se `tools/arch-tests`
 * (`pnpm test:arch`) og `src/determinism-source.test.ts`.
 *
 * Spec: docs/specs/rutemotor.md. Beslutning: ADR-0004.
 */
export * from "./contracts.js";
export * from "./cost.js";
export * from "./domain.js";
export * from "./arena.js";
export * from "./label-store.js";
export * from "./heap.js";
export * from "./distance-field.js";
export * from "./tack.js";
export * from "./tss.js";
export * from "./daylight.js";
export * from "./expand.js";
export * from "./clearance.js";
export * from "./evaluate.js";
export * from "./options.js";
export * from "./result.js";
export * from "./reconstruct.js";
export * from "./search.js";
