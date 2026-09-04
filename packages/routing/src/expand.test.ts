import { describe, expect, it } from "vitest";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { constantWeather } from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import type { WeatherField } from "./contracts.js";
import type { NodeEnvironment } from "./expand.js";
import {
  accumulateSoft,
  checkHardNode,
  checkSegment,
  environmentAt,
  isWindAgainstCurrent,
  resolveGuardBandKn,
  softContribution,
  stepKinematics,
  twsExceedsHardLimit,
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
    // Vaktbåndet bor på miljøet etter D7.3 — `environmentAt` henter det i
    // samme oppslag som vinden. 0 = ukvantisert felt.
    maxDecodeErrorKn: 0,
    ...overrides,
  };
  return {
    ...base,
    windAgainstCurrent:
      overrides.windAgainstCurrent ??
      isWindAgainstCurrent(base.wind, base.current),
  };
}

/** Miljø med et vaktbånd påsatt — som om oppslaget traff en kvantisert flis. */
function envWithBand(kn: number, wind: NodeEnvironment["wind"]): NodeEnvironment {
  return env({ wind, maxDecodeErrorKn: kn });
}

describe("checkHardNode — harde ytelsesgrenser (F3.2)", () => {
  it("godtar vind og sjø innenfor grensene", () => {
    expect(checkHardNode(env(), BOAT).ok).toBe(true);
  });

  it("avviser noden når TWS er over båtens grense", () => {
    const result = checkHardNode(env({ wind: { speedKn: 40, fromDeg: 0 } }), BOAT);
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

/**
 * **TWS-vaktbåndet** (`docs/specs/vaerpakker.md` §9.5).
 *
 * Vind lagres som u/v og kan derfor dekodes for *lavt*. Grensen som
 * håndheves er `maxTwsKn − maxDecodeErrorKn`, slik at en sann over-grense-vind
 * ikke kan slippe gjennom fordi kvantiseringen rundet ned. `BOAT.maxTwsKn` er
 * 35 kn.
 */
describe("TWS-vaktbånd mot dekodefeil (vaerpakker §9.5)", () => {
  it("avviser en vind rett under grensen når den ligger innenfor dekodefeilen", () => {
    // 34,8 kn dekodet: under 35, men den sanne vinden kan være 35,3.
    const e = envWithBand(0.5, { speedKn: 34.8, fromDeg: 0 });
    expect(twsExceedsHardLimit(e, BOAT)).toBe(true);
    const result = checkHardNode(e, BOAT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/TWS/);
      expect(result.reason).toMatch(/vaktbånd/);
    }
  });

  it("slipper gjennom en vind som er under grensen med mer enn dekodefeilen", () => {
    const e = envWithBand(0.5, { speedKn: 34.4, fromDeg: 0 });
    expect(twsExceedsHardLimit(e, BOAT)).toBe(false);
    expect(checkHardNode(e, BOAT).ok).toBe(true);
  });

  it("er skarp på grensen: >-test mot maxTws − dekodefeil, ikke ≥", () => {
    // Nøyaktig på det flyttede grensepunktet (34 kn) skal IKKE avvises …
    expect(
      twsExceedsHardLimit(envWithBand(1, { speedKn: 34, fromDeg: 0 }), BOAT),
    ).toBe(false);
    // … ett hakk over skal.
    expect(
      twsExceedsHardLimit(
        envWithBand(1, { speedKn: 34.000001, fromDeg: 0 }),
        BOAT,
      ),
    ).toBe(true);
  });

  it("Float32-/analytiske felt (dekodefeil 0) gir uendret adferd", () => {
    // Dette er regresjonsgarantien for golden-rutene: uten kvantisering er
    // vaktbåndet identisk med den nakne sammenligningen, i begge retninger.
    for (const speedKn of [34.9, 34.999999, 35, 35.000001, 40]) {
      const e = env({ wind: { speedKn, fromDeg: 0 } });
      expect(twsExceedsHardLimit(e, BOAT)).toBe(speedKn > BOAT.maxTwsKn);
      expect(checkHardNode(e, BOAT).ok).toBe(speedKn <= BOAT.maxTwsKn);
    }
    // Og avvisningsteksten er uendret — ingen vaktbånd-parentes å diffe på.
    const rejected = checkHardNode(env({ wind: { speedKn: 40, fromDeg: 0 } }), BOAT);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.reason).toBe("TWS 40.0 kn over båtens grense 35 kn");
    }
  });

  it("vaktbåndet gjelder bare TWS — Hs har sitt eget vern (opp-avrunding, §9.3)", () => {
    const result = checkHardNode(
      env({
        wind: { speedKn: 10, fromDeg: 0 },
        waves: { hsM: 3.9 },
        maxDecodeErrorKn: 2,
      }),
      BOAT,
    );
    expect(result.ok).toBe(true);
  });
});

/**
 * **Per-flis vaktbånd** (D7.3, vedtatt 2026-09-04 — ekspertpanelets
 * matematiker-kodefunn: `expand.ts` brukte ett GLOBALT `maxDecodeErrorKn`,
 * mens et sammensatt fler-flis-felt har ett bånd per flis).
 *
 * Regelen som testes: den harde TWS-grensen bruker **den aktuelle flisens**
 * bånd i oppslagspunktet når feltet kan oppgi det, ellers konservativt maks
 * over flisene — og aldri et bånd hentet fra et annet oppslag enn vinden.
 */
describe("per-flis vaktbånd (D7.3)", () => {
  const NORD = { lat: 59, lon: 10.5 };
  const SOER = { lat: 57, lon: 10.5 };
  const T = 1_800_000_000;

  /**
   * To fliser med ULIKT bånd, delt ved 58°N — geometrien til den ekte
   * Skjæløy–Skagen-pakken (5_28/5_29). Grovt kvantisert flis i sør (0,8 kn),
   * fint kvantisert i nord (0,1 kn). `maxDecodeErrorKn` er maks over flisene,
   * slik `compositeWeatherField` regner den.
   */
  function toTileField(withPerTile: boolean): WeatherField {
    const base = constantWeather({
      speedKn: 34.5,
      fromDeg: 0,
      validFromS: T - 3600,
      validToS: T + 3600,
    });
    const perTile = {
      maxDecodeErrorKnAt(lat: number) {
        return lat >= 58 ? 0.1 : 0.8;
      },
    };
    return {
      ...base,
      maxDecodeErrorKn: 0.8,
      ...(withPerTile ? perTile : {}),
    };
  }

  it("bruker flisens EGET bånd i punktet når feltet kan oppgi det", () => {
    const field = toTileField(true);
    expect(resolveGuardBandKn(field, NORD.lat, NORD.lon, T)).toBe(0.1);
    expect(resolveGuardBandKn(field, SOER.lat, SOER.lon, T)).toBe(0.8);

    // 34,5 kn dekodet mot maxTws 35: den grovt kvantiserte sørflisen
    // forkaster (35 − 0,8 = 34,2), den fine nordflisen slipper gjennom
    // (35 − 0,1 = 34,9). Samme vind, ulik flis, ulikt svar — og det er
    // nøyaktig poenget med per-flis-båndet.
    const nord = environmentAt(field, NORD, T)!;
    const soer = environmentAt(field, SOER, T)!;
    expect(nord.maxDecodeErrorKn).toBe(0.1);
    expect(soer.maxDecodeErrorKn).toBe(0.8);
    expect(checkHardNode(nord, BOAT).ok).toBe(true);
    expect(checkHardNode(soer, BOAT).ok).toBe(false);
  });

  it("faller tilbake på konservativt maks-over-fliser når feltet ikke kan oppgi per-flis-bånd", () => {
    const field = toTileField(false);
    // Uten per-flis-API-et gjelder maks (0,8) overalt — begge posisjonene
    // forkastes. Konservativt, aldri optimistisk.
    for (const pos of [NORD, SOER]) {
      const e = environmentAt(field, pos, T)!;
      expect(e.maxDecodeErrorKn).toBe(0.8);
      expect(checkHardNode(e, BOAT).ok).toBe(false);
    }
  });

  it("forkaster ugyldige per-flis-svar og bruker maks (et bånd kan aldri UTVIDE taket)", () => {
    const base = constantWeather({
      speedKn: 34.5,
      fromDeg: 0,
      validFromS: T - 3600,
      validToS: T + 3600,
    });
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY, undefined]) {
      const field: WeatherField = {
        ...base,
        maxDecodeErrorKn: 0.8,
        maxDecodeErrorKnAt: () => bad,
      };
      expect(resolveGuardBandKn(field, NORD.lat, NORD.lon, T)).toBe(0.8);
      expect(checkHardNode(environmentAt(field, NORD, T)!, BOAT).ok).toBe(false);
    }
  });

  it("sluttetappens og evaluatorens miljø bærer samme bånd som søkets — én sannhet", () => {
    // `environmentAt` er den ENESTE veien inn til et `NodeEnvironment`, og
    // søket (§5.3 + Tub-forhåndsruten), evaluatoren (§5.11) og sluttetappen
    // (§5.8) bruker alle den. Testen låser at båndet følger med derfra.
    const field = toTileField(true);
    const e = environmentAt(field, SOER, T);
    expect(e?.maxDecodeErrorKn).toBe(0.8);
    expect(twsExceedsHardLimit(e!, BOAT)).toBe(true);
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
