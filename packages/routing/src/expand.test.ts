import { describe, expect, it } from "vitest";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import type { NodeEnvironment } from "./expand.js";
import {
  accumulateSoft,
  checkHardNode,
  checkSegment,
  isWindAgainstCurrent,
  softContribution,
  stepKinematics,
} from "./expand.js";
import {
  FLAG_KRYSS,
  FLAG_MOTOR,
  FLAG_NATT,
  FLAG_VIND_MOT_STROM,
} from "./cost.js";

const BOAT = testBoat();

function env(overrides: Partial<NodeEnvironment> = {}): NodeEnvironment {
  const base = {
    wind: { speedKn: 12, fromDeg: 0 },
    waves: undefined,
    current: undefined,
    isNight: false,
    epochS: 1_800_000_000,
    ...overrides,
  };
  return {
    ...base,
    windAgainstCurrent:
      overrides.windAgainstCurrent ??
      isWindAgainstCurrent(base.wind, base.current),
  };
}

describe("checkHardNode — harde ytelsesgrenser (F3.2)", () => {
  it("godtar vind og sjø innenfor grensene", () => {
    expect(checkHardNode(env(), BOAT).ok).toBe(true);
  });

  it("avviser noden når TWS er over båtens grense", () => {
    const result = checkHardNode(
      env({ wind: { speedKn: 40, fromDeg: 0 } }),
      BOAT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/TWS/);
  });

  it("avviser noden når Hs er over båtens grense", () => {
    const result = checkHardNode(env({ waves: { hsM: 5 } }), BOAT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Hs/);
  });

  it("returnerer aldri et tall — harde sjekker er ja/nei", () => {
    const result = checkHardNode(env(), BOAT);
    expect(typeof result.ok).toBe("boolean");
    expect(Object.keys(result)).toEqual(["ok"]);
  });
});

describe("stepKinematics — konvensjoner og fart", () => {
  const from = { lat: 59, lon: 10 };

  it("regner TWA fra vind-FRA og flytter båten i kursretningen", () => {
    // Vind fra nord, kurs sør = lens.
    const kin = stepKinematics(from, 180, env(), BOAT, 3600);
    expect(kin).toBeDefined();
    if (kin === undefined) return;
    expect(kin.twaDeg).toBe(180);
    expect(kin.next.lat).toBeLessThan(from.lat);
    expect(Math.abs(kin.next.lon - from.lon)).toBeLessThan(1e-9);
  });

  it("forkaster kurser i avviklingssonen når motoren er av", () => {
    const noMotor = testBoat({ motorThresholdKn: 0 });
    expect(stepKinematics(from, 0, env(), noMotor, 3600)).toBeUndefined();
    expect(stepKinematics(from, 20, env(), noMotor, 3600)).toBeUndefined();
    expect(stepKinematics(from, 45, env(), noMotor, 3600)).toBeDefined();
  });

  it("motorseiler rett mot vinden når motoren er på (v1-adferd)", () => {
    // v1 kobler inn motoren under STW-terskelen uansett kurs, også i
    // avviklingssonen. Det er bevisst arv: en motorbåt-etappe mot vinden er
    // et gyldig valg, og kostnaden bæres av `motorS`, ikke av et forbud.
    const kin = stepKinematics(from, 0, env(), BOAT, 3600);
    expect(kin).toBeDefined();
    if (kin === undefined) return;
    expect(kin.motorOn).toBe(true);
    expect(kin.bspKn).toBeCloseTo(BOAT.motorSpeedKn, 6);
  });

  it("legger strømmen til som MOT-vektor (u = øst, v = nord)", () => {
    // Kurs nord, 2 knop strøm mot øst: SOG-retningen skal dreie mot øst.
    const kin = stepKinematics(
      from,
      90,
      env({ current: { u: 0, v: 2 } }),
      BOAT,
      3600,
    );
    if (kin === undefined) throw new Error("forventet fart");
    expect(kin.sogDirDeg).toBeLessThan(90);
    expect(kin.next.lat).toBeGreaterThan(from.lat);
  });

  it("kobler inn motoren under terskelen og markerer det", () => {
    const light = env({ wind: { speedKn: 1, fromDeg: 0 } });
    const kin = stepKinematics(from, 90, light, BOAT, 3600);
    if (kin === undefined) throw new Error("forventet fart");
    expect(kin.motorOn).toBe(true);
    expect(kin.bspKn).toBeCloseTo(BOAT.motorSpeedKn, 6);
  });

  it("bruker bølgeretningen når den er kjent, ellers vinden som proxy", () => {
    const withDir = stepKinematics(
      from,
      90,
      env({ waves: { hsM: 2, fromDeg: 90 } }),
      BOAT,
      3600,
    );
    const withoutDir = stepKinematics(
      from,
      90,
      env({ waves: { hsM: 2 } }),
      BOAT,
      3600,
    );
    if (withDir === undefined || withoutDir === undefined) {
      throw new Error("forventet fart");
    }
    // Motsjø (bølger rett forfra) skal koste mer fart enn tverrsjø-proxyen.
    expect(withDir.bspKn).toBeLessThan(withoutDir.bspKn);
  });
});

describe("accumulateSoft — myke kostnader kan aldri avvise", () => {
  const zero = { tS: 0, beatS: 0, motorS: 0, nightS: 0 };

  it("legger straffen på tiden, men ikke på kryss/motor/natt", () => {
    const cost = accumulateSoft(zero, {
      dtS: 1800 + 90,
      beatS: 1800,
      motorS: 0,
      nightS: 0,
      flags: 0,
    });
    expect(cost.tS).toBe(1890);
    expect(cost.beatS).toBe(1800);
  });

  it("runder hvert bidrag, ikke summen", () => {
    let cost = zero;
    for (let i = 0; i < 3; i++) {
      cost = accumulateSoft(cost, {
        dtS: 100.4,
        beatS: 0,
        motorS: 0,
        nightS: 0,
        flags: 0,
      });
    }
    // 3 × round(100,4) = 300, ikke round(301,2) = 301.
    expect(cost.tS).toBe(300);
  });

  it("gir aldri negative bidrag — grunnlaget for label-setting", () => {
    const cost = accumulateSoft(
      { tS: 100, beatS: 5, motorS: 5, nightS: 5 },
      {
        dtS: 1800,
        beatS: 1800,
        motorS: 0,
        nightS: 1800,
        flags: 0,
      },
    );
    expect(cost.tS).toBeGreaterThanOrEqual(100);
    expect(cost.beatS).toBeGreaterThanOrEqual(5);
    expect(cost.motorS).toBeGreaterThanOrEqual(5);
    expect(cost.nightS).toBeGreaterThanOrEqual(5);
  });
});

describe("softContribution — flagging og klassifisering", () => {
  const from = { lat: 59, lon: 10 };

  it("markerer kryss når TWA er under grensen", () => {
    const kin = stepKinematics(from, 45, env(), BOAT, 1800);
    if (kin === undefined) throw new Error("forventet fart");
    const soft = softContribution(kin, env(), 1800, 0, 60);
    expect(soft.flags & FLAG_KRYSS).toBeTruthy();
    expect(soft.beatS).toBe(1800);
  });

  it("markerer natt og motor", () => {
    const nightEnv = env({ wind: { speedKn: 1, fromDeg: 0 }, isNight: true });
    const kin = stepKinematics(from, 90, nightEnv, BOAT, 1800);
    if (kin === undefined) throw new Error("forventet fart");
    const soft = softContribution(kin, nightEnv, 1800, 0, 60);
    expect(soft.flags & FLAG_NATT).toBeTruthy();
    expect(soft.flags & FLAG_MOTOR).toBeTruthy();
    expect(soft.nightS).toBe(1800);
    expect(soft.motorS).toBe(1800);
  });
});

describe("isWindAgainstCurrent", () => {
  const northerly = { speedKn: 12, fromDeg: 0 };

  it("er sant når strømmen setter mot vinden", () => {
    // Vind fra nord (blåser mot sør), strøm setter mot nord.
    expect(isWindAgainstCurrent(northerly, { u: 0, v: 1.5 })).toBe(true);
  });

  it("er usant når strømmen følger vinden", () => {
    expect(isWindAgainstCurrent(northerly, { u: 0, v: -1.5 })).toBe(false);
  });

  it("ignorerer ubetydelig strøm og manglende data", () => {
    expect(isWindAgainstCurrent(northerly, { u: 0, v: 0.2 })).toBe(false);
    expect(isWindAgainstCurrent(northerly, undefined)).toBe(false);
  });

  it("flagges i softContribution", () => {
    const e = env({ current: { u: 0, v: 1.5 } });
    const kin = stepKinematics({ lat: 59, lon: 10 }, 90, e, BOAT, 1800);
    if (kin === undefined) throw new Error("forventet fart");
    expect(
      softContribution(kin, e, 1800, 0, 60).flags & FLAG_VIND_MOT_STROM,
    ).toBeTruthy();
  });
});

describe("checkSegment", () => {
  const mask = rectMask({
    noGo: [
      { latMin: 58.9, latMax: 59.1, lonMin: 10.2, lonMax: 10.4, reason: "øy" },
    ],
  });

  it("avviser et segment tvers gjennom land, med begrunnelse", () => {
    const result = checkSegment(
      mask,
      { lat: 59, lon: 10.0 },
      { lat: 59, lon: 10.6 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("øy");
  });

  it("godtar et segment som går utenom", () => {
    expect(
      checkSegment(mask, { lat: 58.5, lon: 10.0 }, { lat: 58.5, lon: 10.6 }).ok,
    ).toBe(true);
  });

  it("er symmetrisk i farbarhet", () => {
    const a = { lat: 59, lon: 10.0 };
    const b = { lat: 59, lon: 10.6 };
    expect(checkSegment(mask, a, b).ok).toBe(checkSegment(mask, b, a).ok);
  });

  it("gjør ingenting uten maske — degradert modus er søkets ansvar", () => {
    expect(
      checkSegment(undefined, { lat: 59, lon: 10.0 }, { lat: 59, lon: 10.6 })
        .ok,
    ).toBe(true);
  });
});
