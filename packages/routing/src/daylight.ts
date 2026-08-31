/**
 * Dagslys-ankomst (docs/specs/rutemotor.md §3 og §5.3 steg 16).
 *
 * Definisjon: ankomst i vinduet `[soloppgang + 1 t, solnedgang − 1 t]` i
 * målets posisjon på ankomstdøgnet (UTC). Marginen på én time er der for at
 * «i dagslys» skal bety «med lys nok til å finne inn», ikke «akkurat i det
 * sola bryter horisonten».
 *
 * Kravet gjelder **kun sluttankomsten** (besluttet 2026-08-30): v2.0 har
 * ingen mellomhavner i rutemodellen, så det finnes ikke andre anløp å
 * håndheve det på.
 */
import { sunEventsUtc } from "@morild/geo";

/** Standardmargin inn fra soloppgang/solnedgang. */
export const DAYLIGHT_MARGIN_S = 3600;

export interface DaylightVerdict {
  readonly isDaylight: boolean;
  /** "polar-day" og "polar-night" er egne, ærlige utfall — ikke gjetning. */
  readonly kind: "window" | "polar-day" | "polar-night";
}

export function daylightArrival(
  lat: number,
  lon: number,
  epochS: number,
  marginS: number = DAYLIGHT_MARGIN_S,
): DaylightVerdict {
  const events = sunEventsUtc(lat, lon, epochS);
  if (events.polar === "day") return { isDaylight: true, kind: "polar-day" };
  if (events.polar === "night") {
    return { isDaylight: false, kind: "polar-night" };
  }
  const rise = events.sunriseEpochS;
  const set = events.sunsetEpochS;
  if (rise === undefined || set === undefined) {
    // Kan ikke skje når polar === "none", men vi gjetter aldri.
    return { isDaylight: false, kind: "window" };
  }
  return {
    isDaylight: epochS >= rise + marginS && epochS <= set - marginS,
    kind: "window",
  };
}
