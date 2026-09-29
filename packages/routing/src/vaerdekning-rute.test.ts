/**
 * **Værdekning over rutens steg** (ADR-0008, D17.1, vedtatt 2026-09-29 —
 * `docs/decisions/ADR-0008-vaerdekning-over-rutens-steg.md`).
 *
 * Låser:
 *  1. `coverage.weather` gjelder den leverte ruten: `"partial"` hviss et
 *     rutesteg — med start-sampling, altså miljøet i stegets startnode —
 *     manglet strøm eller bølge. Hull i søket utenfor ruten gir
 *     `coverage.searchWeather = "partial"`, men ikke `weather`.
 *  2. `STROM_DATA_MANGLER` / `SJOEGANG_DATA_MANGLER` står på NØYAKTIG de
 *     stegene som startet i et punkt uten feltet — ikke bare sluttetappen.
 *  3. Målet slås opp for seg: strøm mangler bare i målet ⇒ rute-flagget
 *     `STROM_UKJENT_VED_ANKOMST`, dekningen er fortsatt full.
 *  4. Flaggene er ren rapportering: ruten er identisk med og uten dem
 *     (golden-regresjonen i `golden.test.ts` dekker det samme på alle
 *     golden-scenarioene).
 */
import { describe, expect, it } from "vitest";
import type { LatLon } from "@morild/geo";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import {
  constantWeather,
  type MissingTileBox,
  withMissingEnvFields,
} from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import {
  FLAG_SJOEGANG_DATA_MANGLER,
  FLAG_STROM_DATA_MANGLER,
  FLAG_STROM_UKJENT_VED_ANKOMST,
} from "./cost.js";
import type { RouteResult } from "./result.js";
import { planRoute, type RouteInput } from "./search.js";

/** 2026-06-15 06:00 UTC — lyst hele etappen på disse breddegradene. */
const DEPART_S = Date.UTC(2026, 5, 15, 6, 0, 0) / 1000;
const START = { lat: 58.6, lon: 10.6 };
const DEST = { lat: 58.0, lon: 10.6 };

/** Fullt felt: vind, bølge og strøm overalt. */
const FULL_WEATHER = constantWeather({
  speedKn: 12,
  fromDeg: 270,
  hsM: 0.5,
  currentU: 0.2,
  currentV: 0,
  validFromS: DEPART_S - 3600,
  validToS: DEPART_S + 4 * 24 * 3600,
});

function input(weather = FULL_WEATHER): RouteInput {
  return {
    start: START,
    dest: DEST,
    departEpochS: DEPART_S,
    weather,
    mask: rectMask(),
    boat: testBoat(),
    options: { headingStepDeg: 10, timeStepS: 1800 },
  };
}

function inBox(p: LatLon, box: MissingTileBox): boolean {
  return (
    p.lat >= box.latMin &&
    p.lat <= box.latMax &&
    p.lon >= box.lonMin &&
    p.lon <= box.lonMax
  );
}

/** Rutens geometri, tid og totaler — alt unntatt flagg og dekning. */
function routeShape(r: RouteResult): unknown {
  return {
    steps: r.steps.map((s) => [s.lat, s.lon, s.tS, s.headingDeg, s.hsM, s.bspKn]),
    legs: r.legs,
    totals: r.totals,
    verdict: r.safety.verdict,
    finalLeg: r.finalLeg,
  };
}

/** Nord for start: søket utforsker hit i første iterasjoner, ruten går sørover. */
const NORTH_OF_START: MissingTileBox = {
  latMin: 58.62,
  latMax: 60,
  lonMin: 9,
  lonMax: 12,
};

/** Et belte tvers over ruten midtveis. */
const BAND_ACROSS_ROUTE: MissingTileBox = {
  latMin: 58.25,
  latMax: 58.4,
  lonMin: 9,
  lonMax: 12,
};

describe("ADR-0008: coverage.weather over rutens steg, searchWeather over søket", () => {
  it("fullt felt: begge dekningsfeltene er full og ingen steg bærer datamangelflagg", () => {
    const r = planRoute(input());
    expect(r.safety.reachesDestination).toBe(true);
    expect(r.coverage.weather).toBe("full");
    expect(r.coverage.searchWeather).toBe("full");
    for (const s of r.steps) {
      expect(s.flags & (FLAG_STROM_DATA_MANGLER | FLAG_SJOEGANG_DATA_MANGLER)).toBe(0);
    }
    expect(r.flags & FLAG_STROM_UKJENT_VED_ANKOMST).toBe(0);
  });

  it("hull KUN utenfor ruten: weather = full, searchWeather = partial", () => {
    const weather = withMissingEnvFields(FULL_WEATHER, NORTH_OF_START, {
      current: true,
      waves: true,
    });
    const r = planRoute(input(weather));
    expect(r.safety.reachesDestination).toBe(true);
    // Forutsetningen: ingen av rutens startnoder ligger i hullet.
    for (const s of r.steps) expect(inBox(s, NORTH_OF_START)).toBe(false);
    expect(r.coverage.searchWeather, "søket må faktisk ha truffet hullet").toBe("partial");
    expect(r.coverage.weather).toBe("full");
    for (const s of r.steps) {
      expect(s.flags & (FLAG_STROM_DATA_MANGLER | FLAG_SJOEGANG_DATA_MANGLER)).toBe(0);
    }
  });

  it("strøm mangler i et belte over ruten: STROM_DATA_MANGLER på nøyaktig stegene som startet i beltet", () => {
    const weather = withMissingEnvFields(FULL_WEATHER, BAND_ACROSS_ROUTE, { current: true });
    const r = planRoute(input(weather));
    expect(r.safety.reachesDestination).toBe(true);
    expect(r.coverage.weather).toBe("partial");
    expect(r.coverage.searchWeather).toBe("partial");

    let flagged = 0;
    expect(r.steps[0]!.flags & FLAG_STROM_DATA_MANGLER, "startsteget har ikke noe eget oppslag").toBe(0);
    for (let i = 1; i < r.steps.length; i++) {
      const startedInBand = inBox(r.steps[i - 1]!, BAND_ACROSS_ROUTE);
      const has = (r.steps[i]!.flags & FLAG_STROM_DATA_MANGLER) !== 0;
      expect(has, `steg ${i}: start i beltet = ${startedInBand}`).toBe(startedInBand);
      // Bølge fantes overalt — bare strømmen skal flagges.
      expect(r.steps[i]!.flags & FLAG_SJOEGANG_DATA_MANGLER).toBe(0);
      if (has) flagged++;
    }
    expect(flagged, "flere steg enn sluttetappen skal bære flagget").toBeGreaterThan(0);
    expect(r.steps[r.steps.length - 1]!.flags & FLAG_STROM_DATA_MANGLER).toBe(0);
  });

  it("bølge mangler i beltet: SJOEGANG_DATA_MANGLER på de samme stegene (uavhengig av kystbufferen)", () => {
    const weather = withMissingEnvFields(FULL_WEATHER, BAND_ACROSS_ROUTE, { waves: true });
    const r = planRoute(input(weather));
    expect(r.coverage.weather).toBe("partial");
    for (let i = 1; i < r.steps.length; i++) {
      const startedInBand = inBox(r.steps[i - 1]!, BAND_ACROSS_ROUTE);
      expect((r.steps[i]!.flags & FLAG_SJOEGANG_DATA_MANGLER) !== 0).toBe(startedInBand);
      expect(r.steps[i]!.flags & FLAG_STROM_DATA_MANGLER).toBe(0);
    }
  });

  it("strøm mangler bare i målet: STROM_UKJENT_VED_ANKOMST, men dekningen er full — målet teller ikke", () => {
    const aroundDest: MissingTileBox = {
      latMin: DEST.lat - 0.004,
      latMax: DEST.lat + 0.004,
      lonMin: DEST.lon - 0.008,
      lonMax: DEST.lon + 0.008,
    };
    const weather = withMissingEnvFields(FULL_WEATHER, aroundDest, { current: true });
    const r = planRoute(input(weather));
    expect(r.finalLeg.status).toBe("lagt-til");
    // Forutsetningen: sluttetappens startnode ligger utenfor hullet.
    expect(inBox(r.steps[r.steps.length - 2]!, aroundDest)).toBe(false);
    expect(r.coverage.weather).toBe("full");
    expect(r.flagNames).toContain("STROM_UKJENT_VED_ANKOMST");
    for (const s of r.steps) {
      expect(s.flagNames).not.toContain("STROM_UKJENT_VED_ANKOMST");
      expect(s.flags & FLAG_STROM_DATA_MANGLER).toBe(0);
    }
  });

  it("ruten kommer ikke fram: ingen ankomst-flagg (det finnes ingen ankomst å varsle om)", () => {
    const weather = withMissingEnvFields(
      constantWeather({
        speedKn: 12,
        fromDeg: 270,
        hsM: 0.5,
        currentU: 0.2,
        currentV: 0,
        validFromS: DEPART_S - 3600,
        validToS: DEPART_S + 2 * 3600,
      }),
      { latMin: 57, latMax: 58.1, lonMin: 9, lonMax: 12 },
      { current: true },
    );
    const r = planRoute(input(weather));
    expect(r.safety.reachesDestination).toBe(false);
    expect(r.flags & FLAG_STROM_UKJENT_VED_ANKOMST).toBe(0);
    // Horisont-slutt er søksnivå: ruten selv manglet ikke felt.
    expect(r.coverage.searchWeather).toBe("partial");
    expect(r.coverage.weather).toBe("full");
  });

  it("flaggene er ren rapportering: hull utenfor ruten endrer ikke ruten", () => {
    const withHole = planRoute(
      input(withMissingEnvFields(FULL_WEATHER, NORTH_OF_START, { current: true, waves: true })),
    );
    // Uten hull nord for start er etikettene der regnet MED strøm/bølge, så
    // søkene er ikke like etikett for etikett — men ruten sørover skal være
    // den samme. (Bit-identitet før/etter selve kodeendringen er målt på
    // golden-scenarioene, se rutemotor.md endringslogg 2026-09-29.)
    expect(routeShape(withHole)).toEqual(routeShape(planRoute(input())));
  });
});
