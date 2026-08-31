import { describe, expect, it } from "vitest";
import {
  HORIZON_ALT_DEG,
  isNightAt,
  sunAltitudeDeg,
  sunEventsUtc,
  utcDayStartS,
} from "./sun.js";

/**
 * Referansepunkter fra rutemotor-spec-ens golden-strekk.
 * Skjæløy (Hvaler) og Skagen (Danmark).
 */
const SKJAELOY = { lat: 59.1032, lon: 10.9327 };
const SKAGEN = { lat: 57.7211, lon: 10.5836 };

/** Epoke-sekunder for et UTC-tidspunkt, regnet ut uten `Date` i selve geo. */
function utc(
  y: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
): number {
  return Date.UTC(y, m - 1, d, h, min, 0) / 1000;
}

describe("sunAltitudeDeg", () => {
  it("gir høyest sol rundt sann middag og lavest rundt midnatt", () => {
    const day = utc(2026, 6, 21);
    let bestAlt = -Infinity;
    let bestHour = -1;
    let worstAlt = Infinity;
    let worstHour = -1;
    for (let hour = 0; hour < 24; hour++) {
      const alt = sunAltitudeDeg(SKJAELOY.lat, SKJAELOY.lon, day + hour * 3600);
      if (alt > bestAlt) {
        bestAlt = alt;
        bestHour = hour;
      }
      if (alt < worstAlt) {
        worstAlt = alt;
        worstHour = hour;
      }
    }
    // Sann middag i Skjæløy (10,93°Ø) er ca. 10:56 UTC.
    expect(bestHour).toBe(11);
    expect(worstHour).toBe(23);
  });

  it("gir middagshøyde ≈ 90 − breddegrad + deklinasjon ved solverv", () => {
    // Ved sommersolverv er deklinasjonen ≈ +23,44°.
    const solarNoonS = utc(2026, 6, 21, 10, 56);
    const alt = sunAltitudeDeg(SKJAELOY.lat, SKJAELOY.lon, solarNoonS);
    const expected = 90 - SKJAELOY.lat + 23.44;
    expect(Math.abs(alt - expected)).toBeLessThan(0.3);
  });

  it("er periodisk over døgnet uten diskontinuitet ved midnatt UTC", () => {
    const t = utc(2026, 3, 15, 23, 59);
    const a = sunAltitudeDeg(SKAGEN.lat, SKAGEN.lon, t);
    const b = sunAltitudeDeg(SKAGEN.lat, SKAGEN.lon, t + 120);
    expect(Math.abs(a - b)).toBeLessThan(0.2);
  });

  it("er ren: samme argumenter gir bit-identisk svar", () => {
    const t = utc(2026, 8, 1, 3, 17);
    expect(sunAltitudeDeg(59, 10, t)).toBe(sunAltitudeDeg(59, 10, t));
  });
});

describe("sunEventsUtc", () => {
  it("gir soloppgang og solnedgang der solhøyden faktisk er horisonten", () => {
    for (const p of [SKJAELOY, SKAGEN]) {
      for (const day of [
        utc(2026, 3, 20),
        utc(2026, 6, 21),
        utc(2026, 9, 23),
        utc(2026, 12, 21),
      ]) {
        const ev = sunEventsUtc(p.lat, p.lon, day);
        expect(ev.polar).toBe("none");
        const rise = ev.sunriseEpochS;
        const set = ev.sunsetEpochS;
        expect(rise).toBeDefined();
        expect(set).toBeDefined();
        if (rise === undefined || set === undefined) return;
        // Kravet i spec-en er ±2 min på tidspunktet. 0,05° solhøyde
        // svarer til ca. 15 s ved våre breddegrader, altså strengere.
        expect(
          Math.abs(sunAltitudeDeg(p.lat, p.lon, rise) - HORIZON_ALT_DEG),
        ).toBeLessThan(0.05);
        expect(
          Math.abs(sunAltitudeDeg(p.lat, p.lon, set) - HORIZON_ALT_DEG),
        ).toBeLessThan(0.05);
        expect(set).toBeGreaterThan(rise);
      }
    }
  });

  it("gir ca. 12 timers dag ved jevndøgn (kjent fysisk fasit)", () => {
    const ev = sunEventsUtc(SKAGEN.lat, SKAGEN.lon, utc(2026, 3, 20, 12));
    const rise = ev.sunriseEpochS;
    const set = ev.sunsetEpochS;
    if (rise === undefined || set === undefined) throw new Error("mangler sol");
    const dayLengthH = (set - rise) / 3600;
    // Refraksjon + solrand gjør jevndøgnsdøgnet litt lengre enn 12 t.
    expect(dayLengthH).toBeGreaterThan(12.0);
    expect(dayLengthH).toBeLessThan(12.4);
  });

  it("melder midnattssol nord for polarsirkelen ved sommersolverv", () => {
    const ev = sunEventsUtc(71.17, 25.78, utc(2026, 6, 21));
    expect(ev.polar).toBe("day");
    expect(ev.sunriseEpochS).toBeUndefined();
    expect(ev.sunsetEpochS).toBeUndefined();
  });

  it("melder mørketid nord for polarsirkelen ved vintersolverv", () => {
    const ev = sunEventsUtc(71.17, 25.78, utc(2026, 12, 21));
    expect(ev.polar).toBe("night");
  });

  it("bruker UTC-døgnet som inneholder tidspunktet", () => {
    const t = utc(2026, 6, 21, 18, 30);
    expect(utcDayStartS(t)).toBe(utc(2026, 6, 21));
    const ev = sunEventsUtc(SKAGEN.lat, SKAGEN.lon, t);
    const rise = ev.sunriseEpochS;
    if (rise === undefined) throw new Error("mangler soloppgang");
    expect(rise).toBeGreaterThanOrEqual(utc(2026, 6, 21));
    expect(rise).toBeLessThan(utc(2026, 6, 22));
  });
});

describe("isNightAt", () => {
  it("er natt ved lokal midnatt og dag ved lokal middag i juni", () => {
    expect(isNightAt(SKAGEN.lat, SKAGEN.lon, utc(2026, 6, 21, 23, 30))).toBe(
      true,
    );
    expect(isNightAt(SKAGEN.lat, SKAGEN.lon, utc(2026, 6, 21, 11, 0))).toBe(
      false,
    );
  });

  it("er aldri natt ved midnattssol", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(isNightAt(71.17, 25.78, utc(2026, 6, 21, hour))).toBe(false);
    }
  });
});
