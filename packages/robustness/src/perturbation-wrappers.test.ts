import { describe, expect, it } from "vitest";
import type { BoatModel, WeatherField } from "@morild/routing";
import { withCruisingFactor, withCurrentScale } from "./perturbation-wrappers.js";

const boat: BoatModel = {
  boatSpeedKn: (tws, twa) => tws * 0.5 + twa * 0,
  waveFactor: (hs) => (hs > 2 ? 0.5 : 1),
  maxTwsKn: 35,
  maxHsM: 3,
  motorThresholdKn: 3,
  motorSpeedKn: 6,
  motorFuelLPerH: 2.5,
  draughtM: 2.1,
  depthClearanceM: 0.5,
};

function field(): WeatherField {
  return {
    wind: () => ({ speedKn: 10, fromDeg: 200 }),
    waves: () => undefined,
    current: (lat) => (lat > 60 ? undefined : { u: 1, v: -0.5 }),
    maxTwsKn: 20,
    maxCurrentKn: 2,
    maxDecodeErrorKn: 0.1,
    validFromS: 0,
    validToS: 3600,
    header: { formatVersion: "1.1.0" } as unknown as WeatherField["header"],
  };
}

describe("withCruisingFactor (§4.4)", () => {
  it("skalerer seilfarten, ikke motoren eller grensene", () => {
    const slow = withCruisingFactor(boat, 0.85);
    expect(slow.boatSpeedKn(10, 90)).toBeCloseTo(5 * 0.85, 9);
    expect(slow.motorSpeedKn).toBe(6);
    expect(slow.maxTwsKn).toBe(35);
    expect(slow.waveFactor(3, undefined, 0)).toBe(0.5);
  });
  it("avviser ugyldig faktor", () => {
    expect(() => withCruisingFactor(boat, 0)).toThrow();
    expect(() => withCruisingFactor(boat, Number.NaN)).toThrow();
  });
});

describe("withCurrentScale (§4.4)", () => {
  it("skalerer u/v og bevarer dekning (undefined forblir undefined)", () => {
    const w = withCurrentScale(field(), 1.2);
    expect(w.current(58, 10, 0)).toEqual({ u: 1.2, v: -0.6 });
    expect(w.current(61, 10, 0)).toBeUndefined();
    expect(w.wind(58, 10, 0)).toEqual({ speedKn: 10, fromDeg: 200 });
  });
  it("maxCurrentKn er aldri mindre enn før (øvre skranke), og større ved oppskalering", () => {
    expect(withCurrentScale(field(), 0.8).maxCurrentKn).toBe(2);
    expect(withCurrentScale(field(), 1.2).maxCurrentKn).toBeCloseTo(2.4, 9);
  });
  it("delegerer maxDecodeErrorKnAt når den finnes", () => {
    const f: WeatherField = { ...field(), maxDecodeErrorKnAt: () => 0.07 };
    const w = withCurrentScale(f, 1);
    expect(w.maxDecodeErrorKnAt?.(58, 10, 0)).toBe(0.07);
    expect(withCurrentScale(field(), 1).maxDecodeErrorKnAt).toBeUndefined();
  });
  it("punktbølgen (samme fryste sett) og dens avstand går uendret gjennom (punktbolge.md §3)", () => {
    const f: WeatherField = {
      ...field(),
      waves: () => ({ hsM: 1.3, fromDeg: 240 }),
      wavePointDistanceNm: () => 4.2,
      currentCoastal: () => true,
    };
    const w = withCurrentScale(f, 0.8);
    expect(w.waves(58, 10, 0)).toEqual({ hsM: 1.3, fromDeg: 240 });
    expect(w.wavePointDistanceNm?.(58, 10)).toBe(4.2);
    expect(w.currentCoastal?.(58, 10, 0)).toBe(true);
    expect(withCurrentScale(field(), 1).wavePointDistanceNm).toBeUndefined();
  });
});
