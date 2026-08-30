/**
 * packages/routing — isokron rutemotor (v1s celle-pruning/bautstraff
 * portert til testet TypeScript), kjørt alltid på klienten
 * (ADR-0002: "klienten beregner, skyen forbereder").
 *
 * Ren og deterministisk kjerne: samme input → samme rute. All I/O
 * (fetch, cache, fil) lever utenfor motoren — dette er forutsetningen
 * for ensemble-kjøring og regresjonstester, og håndheves strukturelt:
 * denne pakken importerer aldri fetch/fs/node:-moduler, og kun
 * @morild/geo og @morild/protocol fra resten av monorepoet
 * (håndhevet av tools/arch-tests → `pnpm test:arch`).
 *
 * Se docs/00-kravspek.md F3 og docs/01-prosjektplan.md fase 2
 * (spec kommer: docs/specs/rutemotor.md).
 *
 * Placeholder i fase 0 — ingen ekte logikk enda.
 */
export const ROUTING_PACKAGE_PLACEHOLDER = "routing" as const;
