/**
 * Bølge-taket på trafikklyset (`docs/specs/punktbolge.md` §4.1, §5 «Cap»):
 * grønt ⇒ gult når maxHs > 1,0 m og Tp ukjent; gult/rødt uendret; rødt
 * aldri mildnet; anvendt etter D10.4-skrankene; maxHs over kontrollens
 * steg og gjennomførbare medlemmer; stempelet bærer «foreløpig».
 */
import { describe, expect, it } from "vitest";
import type { MemberOutcome, MemberSummary, OutcomeKind } from "./outcome.js";
import { buildFirstPage } from "./presentation.js";
import { summarizeDeparture, WAVE_GREEN_CAP_STAMP, type RobustnessStamp } from "./summary.js";
import {
  capForUnknownPeriod,
  WAVE_GREEN_CAP_HS_M,
  WAVE_GREEN_CAP_STATUS,
  type TrafficLight,
} from "./traffic-light.js";

function light(color: TrafficLight["color"], reason: TrafficLight["reason"] = null): TrafficLight {
  return { color, reason, kOfN: { k: 30, n: 30 }, provisionalThresholds: true };
}

const CAP = { capHsM: WAVE_GREEN_CAP_HS_M, periodKnown: false };

describe("capForUnknownPeriod", () => {
  it("grønt ⇒ gult når maxHs > 1,0 m og perioden er ukjent", () => {
    const out = capForUnknownPeriod(light("gronn"), { ...CAP, maxHsM: 1.01 });
    expect(out.color).toBe("gul");
    expect(out.reason).toBe("bolgeperiode-ukjent");
    expect(out.kOfN).toEqual({ k: 30, n: 30 });
  });

  it("nøyaktig på taket, under taket, eller kjent periode ⇒ uendret grønt", () => {
    expect(capForUnknownPeriod(light("gronn"), { ...CAP, maxHsM: 1.0 }).color).toBe("gronn");
    expect(capForUnknownPeriod(light("gronn"), { ...CAP, maxHsM: 0.4 }).color).toBe("gronn");
    expect(capForUnknownPeriod(light("gronn"), { ...CAP, maxHsM: 3, periodKnown: true }).color).toBe("gronn");
  });

  it("gult og rødt returneres uendret — rødt mildnes aldri, gult beholder sin grunn", () => {
    const gul = light("gul", "andel");
    const rod = light("rod", "tynt-grunnlag");
    expect(capForUnknownPeriod(gul, { ...CAP, maxHsM: 5 })).toBe(gul);
    expect(capForUnknownPeriod(rod, { ...CAP, maxHsM: 5 })).toBe(rod);
    expect(capForUnknownPeriod(light("beregner"), { ...CAP, maxHsM: 5 }).color).toBe("beregner");
  });

  it("uleselig maxHs gir aldri grønt", () => {
    expect(capForUnknownPeriod(light("gronn"), { ...CAP, maxHsM: Number.NaN }).color).toBe("gul");
  });

  it("taket er 1,0 m og stemplet foreløpig", () => {
    expect(WAVE_GREEN_CAP_HS_M).toBe(1.0);
    expect(WAVE_GREEN_CAP_STATUS).toBe("foreløpig, ikke verifisert mot NORA3");
    expect(WAVE_GREEN_CAP_STAMP).toEqual({ hsM: 1.0, status: "foreløpig, ikke verifisert mot NORA3" });
  });
});

function summary(overrides: Partial<MemberSummary> = {}): MemberSummary {
  return {
    durationS: 36_000,
    distanceNm: 60,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    beatAtNightS: 0,
    fuelL: 0,
    arrivalEpochS: 1_700_036_000,
    daylightArrival: true,
    flags: 0,
    safetyVerdict: "trygt",
    coverageWeather: "full",
    prunedBound: 0,
    maxHsM: 0,
    tubBoundS: null,
    departEpochS: 1_700_000_000,
    hourlyTrack: [],
    ...overrides,
  };
}

function outcome(memberIndex: number, kind: OutcomeKind, maxHsM = 0): MemberOutcome {
  return { memberIndex, kind, summary: summary({ maxHsM }) };
}

const STAMP: RobustnessStamp = {
  maskVersion: "m",
  packageId: "p",
  packageInitEpochS: 1_700_000_000,
  memberAgesS: [],
  optionsHash: "o",
  estimator: "naermeste-rang-v1",
  thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
  waveGreenCap: WAVE_GREEN_CAP_STAMP,
  wavePeriodKnown: false,
  wavePoints: { hash: "h", fetchedAtEpochS: 1_700_000_000 },
};

function depart(members: readonly MemberOutcome[], control: MemberOutcome = outcome(0, "feasible")) {
  return summarizeDeparture({
    departEpochS: 1_700_000_000,
    control,
    members,
    expectedMembers: 30,
    thresholds: [],
    stamp: STAMP,
  });
}

const allFeasible = (hs: (i: number) => number): MemberOutcome[] =>
  Array.from({ length: 30 }, (_, i) => outcome(i + 1, "feasible", hs(i + 1)));

describe("summarizeDeparture med bølge-taket", () => {
  it("lavt Hs overalt ⇒ grønt; stempelet bærer taket og «foreløpig»", () => {
    const d = depart(allFeasible(() => 0.8));
    expect(d.light.color).toBe("gronn");
    expect(d.maxHsM).toBeCloseTo(0.8);
    expect(d.stamp.waveGreenCap.status).toContain("foreløpig");
  });

  it("ett gjennomførbart medlem over 1,0 m ⇒ gult (bolgeperiode-ukjent)", () => {
    const d = depart(allFeasible((i) => (i === 17 ? 1.4 : 0.6)));
    expect(d.light.color).toBe("gul");
    expect(d.light.reason).toBe("bolgeperiode-ukjent");
    expect(d.maxHsM).toBeCloseTo(1.4);
  });

  it("kontrollens steg teller, selv om alle medlemmer er lave", () => {
    const d = depart(allFeasible(() => 0.5), outcome(0, "feasible", 1.3));
    expect(d.light.reason).toBe("bolgeperiode-ukjent");
  });

  it("ugjennomførbare medlemmer teller ikke i maxHs", () => {
    const members = [
      ...Array.from({ length: 29 }, (_, i) => outcome(i + 1, "feasible", 0.5)),
      outcome(30, "infeasible", 4.0),
    ];
    const d = depart(members);
    expect(d.maxHsM).toBeCloseTo(0.5);
    expect(d.light.color).toBe("gronn");
  });

  it("rødt forblir rødt uansett Hs (aldri mildnet)", () => {
    const members = [
      ...Array.from({ length: 15 }, (_, i) => outcome(i + 1, "feasible", 2.5)),
      ...Array.from({ length: 15 }, (_, i) => outcome(i + 16, "infeasible", 2.5)),
    ];
    expect(depart(members).light.color).toBe("rod");
  });

  it("etter D10.4: et rødt sertifikat før komplett står; «beregner» uten sertifikat står", () => {
    const early = [
      ...Array.from({ length: 10 }, (_, i) => outcome(i + 1, "infeasible", 3)),
      outcome(11, "feasible", 3),
    ];
    const d = depart(early);
    expect(d.complete).toBe(false);
    expect(d.light.color).toBe("rod");
    expect(d.certificate?.color).toBe("rod");
    expect(depart([outcome(1, "feasible", 3)]).light.color).toBe("beregner");
  });

  it("førstesiden sier hvorfor, med tall og «foreløpig»", () => {
    const d = depart(allFeasible((i) => (i === 3 ? 1.6 : 0.6)));
    const page = buildFirstPage({
      summary: d,
      advice: null,
      sensitivity: "ikke-beregnet",
      bailout: null,
      packageAgeS: 0,
      staleAfterS: 6 * 3600,
      thresholds: [],
    });
    const lys = page.lines.find((l) => l.kind === "lys")!;
    expect(lys.text).toContain("Gult lys");
    expect(lys.text).toContain("bølgeperioden er ukjent");
    expect(lys.text).toContain("1,6 m");
    expect(lys.text).toContain("foreløpig");
    const bolge = page.behindTap.find((e) => e.label === "Bølge")!;
    expect(bolge.text).toContain("Punktbølge h hentet");
    expect(bolge.text).toContain("periode ukjent");
  });
});
