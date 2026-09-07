import { describe, expect, it } from "vitest";
import type { BailoutProfile } from "@morild/routing";
import type { DecisionAdvice } from "./decision-rule.js";
import type { MemberOutcome, MemberSummary } from "./outcome.js";
import { createPlanReceipt, realizeReceipt, receiptToJson } from "./receipt.js";
import { summarizeDeparture, type RobustnessStamp } from "./summary.js";

const DEPART_EPOCH_S = 1_700_000_000;
const HOUR_S = 3600;

const STAMP: RobustnessStamp = {
  maskVersion: "test-mask-1",
  packageId: "test-package-1",
  packageInitEpochS: DEPART_EPOCH_S - HOUR_S,
  memberAgesS: [HOUR_S, HOUR_S * 2, HOUR_S * 3],
  optionsHash: "test-hash",
  estimator: "naermeste-rang-v1",
  thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
};

function makeSummary(overrides: Partial<MemberSummary> = {}): MemberSummary {
  const durationS = overrides.durationS ?? HOUR_S * 10;
  return {
    durationS,
    distanceNm: 60,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    beatAtNightS: 0,
    fuelL: 40,
    arrivalEpochS: DEPART_EPOCH_S + durationS,
    departEpochS: DEPART_EPOCH_S,
    daylightArrival: true,
    flags: 0,
    safetyVerdict: "trygt",
    coverageWeather: "full",
    prunedBound: 0,
    tubBoundS: null,
    hourlyTrack: [],
    ...overrides,
  };
}

function outcome(memberIndex: number, kind: MemberOutcome["kind"], overrides: Partial<MemberSummary> = {}): MemberOutcome {
  return { memberIndex, kind, summary: makeSummary(overrides) };
}

const CONTROL = outcome(0, "feasible");
const MEMBERS: MemberOutcome[] = [
  outcome(1, "feasible", { durationS: HOUR_S * 20, arrivalEpochS: DEPART_EPOCH_S + HOUR_S * 20 }),
  outcome(2, "feasible", { durationS: HOUR_S * 22, arrivalEpochS: DEPART_EPOCH_S + HOUR_S * 22 }),
  outcome(3, "infeasible"),
  { memberIndex: 4, kind: "error", summary: null, error: "worker-feil (test)" },
];

const SUMMARY = summarizeDeparture({
  departEpochS: DEPART_EPOCH_S,
  control: CONTROL,
  members: MEMBERS,
  expectedMembers: MEMBERS.length,
  thresholds: [],
  stamp: STAMP,
});

const ADVICE: DecisionAdvice = { kind: "fallback", text: "Fallback-tekst (test)." };

const BAILOUT: BailoutProfile = {
  samples: [],
  longestGapS: HOUR_S * 3,
  coverage: "partial",
  basis: "kontrollvaer",
  label: "kontrollvær — ikke ensemble-sjekket",
  sampleIntervalS: 1800,
  limitS: 21600,
  missingDepthHarbourIds: ["havn-1"],
  missingFieldHarbourIds: [],
  searchCount: 4,
  fieldScreenedSamples: 2,
  fieldScreenedCandidates: 1,
};

describe("createPlanReceipt (§3.6, §5.7)", () => {
  it("fryser summary uten members/control, og bokfører memberKinds/memberArrivalEpochS i rekkefølge", () => {
    const receipt = createPlanReceipt({
      plannedAtEpochS: DEPART_EPOCH_S + 60,
      summary: SUMMARY,
      advice: ADVICE,
      bailout: BAILOUT,
    });

    expect(receipt.plannedAtEpochS).toBe(DEPART_EPOCH_S + 60);
    expect(receipt.departEpochS).toBe(SUMMARY.departEpochS);
    expect(receipt.stamp).toEqual(STAMP);
    expect(receipt.advice).toEqual(ADVICE);
    expect(receipt.bailout).toEqual({ longestGapS: HOUR_S * 3, coverage: "partial", basis: "kontrollvaer" });

    // `summary` skal IKKE bære members/control.
    expect("members" in receipt.summary).toBe(false);
    expect("control" in receipt.summary).toBe(false);
    expect(receipt.summary.nF).toBe(SUMMARY.nF);
    expect(receipt.summary.nInf).toBe(SUMMARY.nInf);

    // memberKinds/memberArrivalEpochS i samme rekkefølge som members (sortert på memberIndex).
    expect(receipt.memberKinds).toEqual(["feasible", "feasible", "infeasible", "error"]);
    expect(receipt.memberArrivalEpochS).toEqual([
      DEPART_EPOCH_S + HOUR_S * 20,
      DEPART_EPOCH_S + HOUR_S * 22,
      DEPART_EPOCH_S + HOUR_S * 10, // infeasible har likevel et summary (default durationS 10 t) i denne fabrikken.
      null, // error uten RouteResult har intet summary.
    ]);
    expect(receipt.realized).toBeUndefined();
  });
});

describe("realizeReceipt (§5.7 — kan kun settes én gang)", () => {
  it("setter realized første gang", () => {
    const receipt = createPlanReceipt({
      plannedAtEpochS: DEPART_EPOCH_S + 60,
      summary: SUMMARY,
      advice: ADVICE,
      bailout: BAILOUT,
    });
    const realized = realizeReceipt(receipt, { arrivalEpochS: DEPART_EPOCH_S + HOUR_S * 21, aborted: false });
    expect(realized.realized).toEqual({ arrivalEpochS: DEPART_EPOCH_S + HOUR_S * 21, aborted: false });
    // Immutabel: originalen er urørt.
    expect(receipt.realized).toBeUndefined();
  });

  it("kaster hvis realized allerede finnes", () => {
    const receipt = createPlanReceipt({
      plannedAtEpochS: DEPART_EPOCH_S + 60,
      summary: SUMMARY,
      advice: ADVICE,
      bailout: BAILOUT,
    });
    const once = realizeReceipt(receipt, { arrivalEpochS: null, aborted: true, note: "snudde ved Skagen" });
    expect(() => realizeReceipt(once, { arrivalEpochS: 1, aborted: false })).toThrow(/kan bare settes én gang/);
  });
});

describe("receiptToJson (§5.7 — JSON-stabil)", () => {
  it("samme kvittering med annen nøkkelrekkefølge (topp-nivå og nøstet) gir identisk streng", () => {
    const receiptA = createPlanReceipt({
      plannedAtEpochS: DEPART_EPOCH_S + 60,
      summary: SUMMARY,
      advice: ADVICE,
      bailout: BAILOUT,
    });

    // Bygg en verdi-lik kvittering med reversert nøkkelrekkefølge på
    // TOPPNIVÅ og i et nøstet objekt (`stamp`) — beviser at sorteringen er
    // rekursiv, ikke bare topp-nivå.
    const reorderedStamp = Object.fromEntries(Object.entries(receiptA.stamp).reverse()) as unknown as typeof receiptA.stamp;
    const reorderedTopLevel = Object.fromEntries(
      Object.entries({ ...receiptA, stamp: reorderedStamp }).reverse(),
    ) as unknown as typeof receiptA;

    // Sanity-sjekk: reorderingen faktisk endret rå nøkkelrekkefølge, så
    // testen beviser noe (uten dette kunne testen bestått av feil grunn).
    expect(JSON.stringify(receiptA)).not.toBe(JSON.stringify(reorderedTopLevel));

    expect(receiptToJson(receiptA)).toBe(receiptToJson(reorderedTopLevel));
  });

  it("realized (når satt) er med i JSON-en", () => {
    const receipt = createPlanReceipt({
      plannedAtEpochS: DEPART_EPOCH_S + 60,
      summary: SUMMARY,
      advice: ADVICE,
      bailout: BAILOUT,
    });
    const realized = realizeReceipt(receipt, { arrivalEpochS: 123, aborted: false });
    expect(receiptToJson(realized)).toContain('"arrivalEpochS":123');
    expect(receiptToJson(receipt)).not.toContain("realized");
  });
});
