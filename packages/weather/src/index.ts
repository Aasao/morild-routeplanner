/**
 * packages/weather — værfeltmodell, interpolasjon og pakkeformat-lesing
 * (MEPS-vind, NorKyst-800-strøm, MET Oceanforecast/WAM800-bølger,
 * Kartverket tideapi/vannstand).
 *
 * Skal etter hvert eie: feltdekoding (kvantisert → Float32), retnings-
 * konvensjoner (vind FRA, strøm MOT — enhetstestes eksplisitt), og lesing
 * av PackageHeader (packages/protocol) for kildestatus/alder i UI.
 *
 * Se docs/00-kravspek.md F2 og docs/01-prosjektplan.md fase 3
 * (spec kommer: docs/specs/vaerpakker.md).
 *
 * Placeholder i fase 0 — ingen ekte logikk enda.
 */
export const WEATHER_PACKAGE_PLACEHOLDER = "weather" as const;
