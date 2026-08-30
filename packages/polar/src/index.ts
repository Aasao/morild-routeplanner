/**
 * packages/polar — Dufour 41-polarer (PTE/GTE), cruising-faktor,
 * motorseiling (standard 7,0 kn / 4,0 l/t, alltid justerbart i UI — B7),
 * bølgederating som funksjon av bratthet (Hs/Tp²-klasse, ikke Hs alene)
 * og vind-mot-strøm-flagg.
 *
 * Skal etter hvert eie polar-kalibreringen mot v1-loggene (SOG minus
 * historisk NorKyst-strøm), flyttet til egen bølge etter fase 3-spiken.
 *
 * Se docs/00-kravspek.md F3.2–F3.3 og docs/01-prosjektplan.md fase 2.
 *
 * Placeholder i fase 0 — ingen ekte logikk enda.
 */
export const POLAR_PACKAGE_PLACEHOLDER = "polar" as const;
