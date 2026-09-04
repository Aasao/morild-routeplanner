/**
 * **R2/bail-out — strukturelle krav** (`docs/specs/robusthet.md` §5.1 siste
 * kulepunkt, §4.1, §5.6 siste kulepunkt; ADR-0005).
 *
 * To ting skal være umulige, ikke bare usannsynlige:
 *
 *  1. **Et bail-out-søk med delt Tub.** Tub-bounden er utledet fra reisen
 *     «kom du fram til målet i tide». Brukt til å beskjære spørsmålet «kan du
 *     komme deg i havn» ville den kuttet nettopp de lange, ikke-opplagte
 *     utveiene R2 finnes for å finne — og gjort en felle av et medlem som i
 *     virkeligheten hadde en vei ut. Retningen er den farlige.
 *  2. **Et bail-out-søk i en annen mekanikk enn `pareto` uten at kalleren ba
 *     om det.** Skalar- og korridorvariantene er E1′-måleinnganger; fasiten
 *     og produksjonen er Pareto på udelt maske.
 *
 * Beviset er strukturelt: `r2SearchInput` er den **eneste** konstruksjonen av
 * re-søkets `RouteInput`, og testene under leser den direkte. En senere
 * endring som la til en Tub-kanal ville måtte gå gjennom nettopp den
 * funksjonen, og bli rød her.
 *
 * I tillegg fastholdes `backoffS`-semantikken (§3.1 pkt. 2): backoff i
 * **fysisk tid**, `min(Δt, 1800 s)`, uavhengig av tidssteg.
 */
import { describe, expect, it } from "vitest";
import { INTERIM_BAILOUT_HARBOURS } from "../test-fixtures/bailout-harbours.js";
import { constantWeather } from "../test-fixtures/synthetic-weather.js";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import {
  backoffStartIndex,
  defaultBackoffS,
  R2_BACKOFF_CAP_S,
  r2SearchInput,
  type R2Config,
} from "./bailout.js";
import { withDefaults } from "./options.js";
import type { RouteStep } from "./result.js";

const WEATHER = constantWeather({
  speedKn: 14,
  fromDeg: 270,
  validFromS: 0,
  validToS: 10 * 86400,
});

/** Ett `RouteStep` med kun `tS` som betyr noe for backoff-regnestykket. */
function stepAt(tS: number): RouteStep {
  return {
    lat: 58 + tS / 1e6,
    lon: 10.6,
    tS,
    epochS: tS,
    headingDeg: 0,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    twsKn: 10,
    twdDeg: 270,
    bspKn: 6,
    hsM: 0.5,
    flags: 0,
    flagNames: [],
  };
}

describe("R2-re-søket får aldri delt Tub eller delt felt (§5.1)", () => {
  const base = {
    from: { lat: 58.0, lon: 10.6 },
    harbour: { lat: 58.3, lon: 10.9 },
    departEpochS: 1781668800,
    weather: WEATHER,
    mask: rectMask(),
    boat: testBoat(),
    maxIterations: 7,
    scalarSearchMode: false,
  } as const;

  it("setter verken tubBoundS eller field — heller ikke som undefined-nøkkel", () => {
    const input = r2SearchInput({
      ...base,
      options: undefined,
      searchOptions: undefined,
    });
    expect(Object.hasOwn(input, "tubBoundS")).toBe(false);
    expect(Object.hasOwn(input, "field")).toBe(false);
    expect(input.tubBoundS).toBeUndefined();
    expect(input.field).toBeUndefined();
  });

  /**
   * Den strukturelle delen: kalleren *kan ikke* smugle en Tub inn, fordi
   * begge kanalene er `Partial<RouteOptions>` og `tubBoundS` bor på
   * `RouteInput`. Testen kjører kanalene fulle av alt de har lov til å bære
   * og sjekker at ingenting av det havner utenfor `options`.
   */
  it("lar ingen av opsjonskanalene bære en Tub eller et felt", () => {
    const input = r2SearchInput({
      ...base,
      options: { headingStepDeg: 12, timeStepS: 1800, tubMarginFrac: 0.9 },
      searchOptions: { headingStepDeg: 15, maxLabelsPerCell: 3 },
    });
    expect(Object.hasOwn(input, "tubBoundS")).toBe(false);
    expect(Object.hasOwn(input, "field")).toBe(false);
    // `searchOptions` vinner over `options`, og begge over rutens vekter.
    const opts = withDefaults(input.options);
    expect(opts.headingStepDeg).toBe(15);
    expect(opts.timeStepS).toBe(1800);
    expect(opts.maxLabelsPerCell).toBe(3);
  });

  it("nuller dagslyskravet og setter skalarmodus eksplisitt begge veier", () => {
    const pareto = withDefaults(
      r2SearchInput({
        ...base,
        options: { requireDaylightArrival: true, scalarSearchMode: true },
        searchOptions: undefined,
      }).options,
    );
    expect(pareto.requireDaylightArrival).toBe(false);
    expect(
      pareto.scalarSearchMode,
      "fasitens re-søk skal aldri arve kallerens skalarmodus",
    ).toBe(false);

    const skalar = withDefaults(
      r2SearchInput({
        ...base,
        options: undefined,
        searchOptions: undefined,
        scalarSearchMode: true,
      }).options,
    );
    expect(skalar.scalarSearchMode).toBe(true);
  });

  it("bruker pareto som modus når kalleren ikke ber om noe annet", () => {
    const cfg: R2Config = { harbours: INTERIM_BAILOUT_HARBOURS };
    expect(cfg.mode ?? "pareto").toBe("pareto");
    // Og bail-out-oppsettet i robusthet.md §4.5 sier den eksplisitt.
    const eksplisitt: R2Config = {
      harbours: INTERIM_BAILOUT_HARBOURS,
      mode: "pareto",
    };
    expect(eksplisitt.mode).toBe("pareto");
  });
});

describe("backoffS — backoff i fysisk tid (§3.1 pkt. 2, §5.6)", () => {
  it("er min(Δt, 1800 s) uavhengig av tidssteg", () => {
    expect(R2_BACKOFF_CAP_S).toBe(1800);
    expect(defaultBackoffS(900)).toBe(900);
    expect(defaultBackoffS(1800)).toBe(1800);
    expect(defaultBackoffS(3600)).toBe(1800);
    expect(defaultBackoffS(7200)).toBe(1800);
  });

  /**
   * Med uniforme steg som er minst så lange som backoffen, lander regelen
   * på nøyaktig ett steg tilbake — det er derfor E1-fasitene bygget med
   * `backoffSteps: 1` er uendret av overgangen (målt 2026-09-04).
   */
  it("lander ett steg tilbake når stegene er uniforme og >= backoffen", () => {
    const steps = [0, 3600, 7200, 10800].map(stepAt);
    expect(backoffStartIndex(steps, 3, 1800)).toBe(2);
    expect(backoffStartIndex(steps, 3, 3600)).toBe(2);
    expect(backoffStartIndex(steps, 2, 1800)).toBe(1);
  });

  /**
   * Og her er hele poenget med endringen: når evaluatoren tar et **delsteg**
   * inn mot et veipunkt, er «ett steg» ikke lenger en fast fysisk tid.
   * Steg-regelen ville gitt 26 sekunders backoff; tidsregelen gir de 1800
   * sekundene den lover.
   */
  it("hopper over delsteg som er kortere enn backoffen", () => {
    const steps = [0, 1800, 3600, 3626].map(stepAt);
    // Steg-regelen ville landet på indeks 2 (t = 3600), 26 s tilbake.
    expect(backoffStartIndex(steps, 3, 1800)).toBe(1);
    expect(steps[1]!.tS).toBe(1800);
  });

  it("går aldri før avgang", () => {
    const steps = [0, 1800, 3600].map(stepAt);
    expect(backoffStartIndex(steps, 0, 1800)).toBe(0);
    expect(backoffStartIndex(steps, 1, 999_999)).toBe(0);
  });

  it("melder fra med -1 når det ikke finnes noe steg å gå tilbake til", () => {
    expect(backoffStartIndex([], 5, 1800)).toBe(-1);
    expect(backoffStartIndex([stepAt(0)], -1, 1800)).toBe(-1);
  });

  it("klemmer en failureIndex utenfor listen til siste steg", () => {
    const steps = [0, 1800, 3600].map(stepAt);
    expect(backoffStartIndex(steps, 99, 1800)).toBe(1);
  });
});
