/**
 * **«Rute begrenset av værdekning»** (D7.2, vedtatt 2026-09-04 —
 * `docs/research/ekspertpanel-d7-vaerpakkeformat-2026-09-04.md`, syntesens
 * punkt 1; ytelsesingeniørens obligatoriske vilkår i tilsvarsrunden).
 *
 * Regelen som låses her: forkaster søket etiketter fordi vinden mangler i
 * posisjonen **innenfor pakkens gyldige tidsvindu**, er ruten formet av
 * flisdekningen og ikke av været. Da skal
 *
 *  1. `RouteResult.flagNames` inneholde `VAERDEKNING_BEGRENSET`, og
 *  2. `safety.verdict` gulves til minst `"usikkert"` — aldri et stille
 *     `"trygt"` (CLAUDE.md §1, N2).
 *
 * Horisont-slutt (`epochS > validToS`) skal derimot **ikke** utløse flagget:
 * at prognosen tar slutt er forventet, og dekkes av `coverage.weather =
 * "partial"` + ADR-0005s inkonklusiv-regel.
 */
import { describe, expect, it } from "vitest";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import {
  constantWeather,
  withMissingTile,
} from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import { planRoute, type RouteInput } from "./search.js";

/** 2026-06-15 06:00 UTC — lyst hele etappen på disse breddegradene. */
const DEPART_S = Date.UTC(2026, 5, 15, 6, 0, 0) / 1000;
const START = { lat: 58.6, lon: 10.6 };
const DEST = { lat: 58.0, lon: 10.6 };

function baseInput(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    start: START,
    dest: DEST,
    departEpochS: DEPART_S,
    weather: constantWeather({
      speedKn: 12,
      fromDeg: 270,
      validFromS: DEPART_S - 3600,
      validToS: DEPART_S + 4 * 24 * 3600,
    }),
    mask: rectMask(),
    boat: testBoat(),
    options: { headingStepDeg: 10, timeStepS: 1800 },
    ...overrides,
  };
}

describe("flagget «rute begrenset av værdekning» (D7.2)", () => {
  it("full dekning: ingen flagg, verdikten står som den er", () => {
    const result = planRoute(baseInput());
    expect(result.diagnostics.pruned.noWeatherInWindow).toBe(0);
    expect(result.flagNames).toEqual([]);
    expect(result.flags).toBe(0);
    expect(result.safety.verdict).toBe("trygt");
  });

  it("én flis mangler MIDT i ruten: flagg + usikkert, aldri stille trygt", () => {
    // Hullet dekker østsiden av korridoren i et breddebånd midtveis —
    // ruten kan fortsatt komme fram vest for det, og nettopp derfor er
    // dette den harde varianten av testen: resultatet ser vellykket ut.
    const weather = withMissingTile(baseInput().weather, {
      latMin: 58.2,
      latMax: 58.4,
      lonMin: 10.6,
      lonMax: 12.0,
    });
    const result = planRoute(baseInput({ weather }));

    expect(
      result.diagnostics.pruned.noWeatherInWindow,
      "hullet må faktisk treffes av søket",
    ).toBeGreaterThan(0);
    expect(result.flagNames).toContain("VAERDEKNING_BEGRENSET");
    expect(result.safety.verdict).not.toBe("trygt");
    expect(result.coverage.weather).toBe("partial");
    // Masken er full og ingen segmenter feiler — uten D7.2-gulvet hadde
    // dette vært et «trygt».
    expect(result.safety.failingSegments).toEqual([]);
    expect(result.safety.recheckPassed).toBe(true);
  });

  it("horisont-slutt teller IKKE som manglende flisdekning", () => {
    // Feltet slutter i tid, ikke i rom: `noWeather` vokser, men
    // `noWeatherInWindow` skal forbli 0 og flagget skal ikke settes.
    const weather = constantWeather({
      speedKn: 12,
      fromDeg: 270,
      validFromS: DEPART_S - 3600,
      validToS: DEPART_S + 2 * 3600,
    });
    const result = planRoute(baseInput({ weather }));

    expect(result.diagnostics.pruned.noWeather).toBeGreaterThan(0);
    expect(result.diagnostics.pruned.noWeatherInWindow).toBe(0);
    expect(result.flagNames).not.toContain("VAERDEKNING_BEGRENSET");
    expect(result.coverage.weather).toBe("partial");
  });

  it("flagget er rute-nivå: det dukker ikke opp på noe enkeltsteg", () => {
    // Etiketten som ble forkastet finnes per definisjon ikke i `steps` —
    // derfor bor flagget på resultatet, ikke på et punkt langs linjen.
    const weather = withMissingTile(baseInput().weather, {
      latMin: 58.2,
      latMax: 58.4,
      lonMin: 10.6,
      lonMax: 12.0,
    });
    const result = planRoute(baseInput({ weather }));
    expect(result.flagNames).toContain("VAERDEKNING_BEGRENSET");
    for (const step of result.steps) {
      expect(step.flagNames).not.toContain("VAERDEKNING_BEGRENSET");
    }
  });
});
