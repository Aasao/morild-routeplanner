/**
 * packages/charts — farbarhetsmaske og kartdata-abstraksjon.
 *
 * Skal etter hvert eie: ChartSource-abstraksjonen (med datum-felt per
 * kilde — Kartverket vs. EMODnet/DDM/OSM), farbarhetsoppslag mot
 * sikkerhetskontur + tørrfall + skjær/grunner, seilingshøyde (bruer/
 * luftspenn), TSS/skipsled-geometri og verne-/forbudssoner.
 *
 * Se docs/00-kravspek.md F1 og docs/01-prosjektplan.md fase 1
 * (spec kommer: docs/specs/farbarhetsmaske.md).
 *
 * Placeholder i fase 0 — ingen ekte logikk enda.
 */
export const CHARTS_PACKAGE_PLACEHOLDER = "charts" as const;
