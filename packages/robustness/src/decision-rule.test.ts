import { describe, expect, it } from "vitest";
import type { LatLon } from "@morild/geo";
import { deriveDecisionRule } from "./decision-rule.js";
import type { MemberOutcome, MemberSummary } from "./outcome.js";

const DEPART_EPOCH_S = 1_700_000_000;
const HOUR_S = 3600;
/** 1 nm ≈ 1/60° breddegrad — grov, men god nok for et synteisk øst-gående spor. */
const NM_TO_DEG_LAT = 1 / 60;

function makeSummary(hourlyTrack: readonly LatLon[], overrides: Partial<MemberSummary> = {}): MemberSummary {
  const durationS = (hourlyTrack.length - 1) * HOUR_S;
  return {
    durationS,
    distanceNm: 60,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    beatAtNightS: 0,
    fuelL: 0,
    arrivalEpochS: DEPART_EPOCH_S + durationS,
    departEpochS: DEPART_EPOCH_S,
    daylightArrival: true,
    flags: 0,
    safetyVerdict: "trygt",
    coverageWeather: "full",
    prunedBound: 0,
    tubBoundS: null,
    hourlyTrack,
    ...overrides,
  };
}

function makeOutcome(memberIndex: number, kind: "feasible" | "infeasible", summary: MemberSummary): MemberOutcome {
  return { memberIndex, kind, summary };
}

/** Kontrollspor: rett øst langs 60° N, 0,2°/t — 10 punkter (h = 0..9). */
function controlTrack(hours: number): LatLon[] {
  return Array.from({ length: hours + 1 }, (_, h) => ({ lat: 60, lon: 10 + h * 0.2 }));
}

describe("deriveDecisionRule — konstruert frontscenario (§5.5 (i))", () => {
  // 20 gjennomførbare drar nord for kontrollsporet fra og med time 4, 10
  // ugjennomførbare drar sør — før time 4 ligger alle på kontrollsporet
  // (ingen splitt mulig der: medianene er like).
  const HOURS = 9;
  const FRONT_HOUR = 4;
  const OFFSET_DEG = 0.5; // ~30 nm — godt over 2 nm-marginen.

  function trackFor(sign: 1 | -1): LatLon[] {
    return Array.from({ length: HOURS + 1 }, (_, h) => ({
      lat: 60 + (h >= FRONT_HOUR ? sign * OFFSET_DEG : 0),
      lon: 10 + h * 0.2,
    }));
  }

  function buildMembers(): { readonly control: MemberOutcome; readonly members: readonly MemberOutcome[] } {
    const control = makeOutcome(0, "feasible", makeSummary(controlTrack(HOURS)));
    const members: MemberOutcome[] = [];
    for (let i = 1; i <= 20; i++) {
      members.push(makeOutcome(i, "feasible", makeSummary(trackFor(1)))); // nord
    }
    for (let i = 21; i <= 30; i++) {
      members.push(makeOutcome(i, "infeasible", makeSummary(trackFor(-1)))); // sør
    }
    return { control, members };
  }

  it("finner t* ved frontpassasjen med konkordans ≥ 0,75 og side nord — LOO holder", () => {
    const { control, members } = buildMembers();
    const advice = deriveDecisionRule({ control, members, complete: true, nF: 20, nInf: 10 });

    expect(advice.kind).toBe("regel");
    if (advice.kind !== "regel") return;
    expect(advice.rule.checkEpochS).toBe(DEPART_EPOCH_S + FRONT_HOUR * HOUR_S);
    expect(advice.rule.position).toEqual({ lat: 60, lon: 10 + FRONT_HOUR * 0.2 });
    expect(advice.rule.test).toBe("nord");
    expect(advice.rule.concordance).toBeGreaterThanOrEqual(0.75);
    expect(advice.rule.hitRate).toEqual({ k: 30, n: 30 });
    expect(advice.rule.explanation).toBe(""); // §4.6 pkt. 4 / valg 5.
    expect(advice.rule.action.length).toBeGreaterThan(0);
  });

  it("respekterer options.marginNm/concordance", () => {
    const { control, members } = buildMembers();
    const advice = deriveDecisionRule({
      control,
      members,
      complete: true,
      nF: 20,
      nInf: 10,
      options: { marginNm: 1000, concordance: 0.75 }, // umulig margin ⇒ fallback
    });
    expect(advice.kind).toBe("fallback");
  });
});

describe("deriveDecisionRule — forutsetninger (§4.6)", () => {
  const control = makeOutcome(0, "feasible", makeSummary(controlTrack(9)));
  const members: MemberOutcome[] = [];

  it("complete: false ⇒ fallback", () => {
    const advice = deriveDecisionRule({ control, members, complete: false, nF: 20, nInf: 10 });
    expect(advice.kind).toBe("fallback");
  });

  it("nF < 12 ⇒ fallback", () => {
    const advice = deriveDecisionRule({ control, members, complete: true, nF: 11, nInf: 10 });
    expect(advice.kind).toBe("fallback");
  });

  it("nInf < 3 ⇒ fallback", () => {
    const advice = deriveDecisionRule({ control, members, complete: true, nF: 20, nInf: 2 });
    expect(advice.kind).toBe("fallback");
  });

  it("fallback-teksten er alltid den samme kodede teksten", () => {
    const advice = deriveDecisionRule({ control, members, complete: false, nF: 0, nInf: 0 });
    expect(advice.kind).toBe("fallback");
    if (advice.kind !== "fallback") return;
    expect(advice.text).toMatch(/vindviften/);
  });

  it("kontroll uten summary (error) ⇒ fallback selv om terskler er nådd", () => {
    const errorControl: MemberOutcome = { memberIndex: 0, kind: "error", summary: null, error: "boom" };
    const advice = deriveDecisionRule({ control: errorControl, members, complete: true, nF: 20, nInf: 10 });
    expect(advice.kind).toBe("fallback");
  });
});

describe("deriveDecisionRule — determinisme (§5.2-prinsippet anvendt her)", () => {
  const HOURS = 9;
  const FRONT_HOUR = 3;
  const OFFSET_DEG = 0.4;

  function trackFor(sign: 1 | -1): LatLon[] {
    return Array.from({ length: HOURS + 1 }, (_, h) => ({
      lat: 60 + (h >= FRONT_HOUR ? sign * OFFSET_DEG : 0),
      lon: 10 + h * 0.2,
    }));
  }

  it("samme input i vilkårlig medlemsrekkefølge ⇒ identisk regel", () => {
    const control = makeOutcome(0, "feasible", makeSummary(controlTrack(HOURS)));
    const feasibleMembers = Array.from({ length: 15 }, (_, i) => makeOutcome(i + 1, "feasible", makeSummary(trackFor(1))));
    const infeasibleMembers = Array.from({ length: 6 }, (_, i) =>
      makeOutcome(i + 16, "infeasible", makeSummary(trackFor(-1))),
    );
    const inOrder = [...feasibleMembers, ...infeasibleMembers];
    const reversed = [...inOrder].reverse();
    const interleaved = [...inOrder].sort((a, b) => (a.memberIndex * 7) % 21 - (b.memberIndex * 7) % 21);

    const base = deriveDecisionRule({ control, members: inOrder, complete: true, nF: 15, nInf: 6 });
    const r1 = deriveDecisionRule({ control, members: reversed, complete: true, nF: 15, nInf: 6 });
    const r2 = deriveDecisionRule({ control, members: interleaved, complete: true, nF: 15, nInf: 6 });

    expect(base.kind).toBe("regel");
    expect(r1).toEqual(base);
    expect(r2).toEqual(base);
  });
});

describe("deriveDecisionRule — støyfikstur (§5.5)", () => {
  // mulberry32, duplisert lokalt (samme algoritme som
  // packages/routing/test-fixtures/seeded-random.ts) for å unngå en
  // testavhengighet på tvers av pakkegrensen — se den filens toppkommentar.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const HOURS = 9;
  const MEMBER_COUNT = 30;
  const MAX_OFFSET_NM = 60; // stor nok til at noen falske positiver FORSØKES uten LOO (empirisk ~0,5 %) — se leveranserapporten.

  // Posisjonene er FASTE (uavhengige av klasseetiketten under) — en
  // personlig lateral koeffisient per medlem, trukket én gang med en fast
  // seed. Spredningen vokser lineært fra 0 ved avgang (felles startpunkt)
  // til ± MAX_OFFSET_NM ved siste time, som en grov modell av hvordan et
  // ensemble faktisk divergerer fra et delt utgangspunkt.
  const positionRng = mulberry32(20260906);
  const lateralCoeffNm: readonly number[] = Array.from({ length: MEMBER_COUNT }, () => (positionRng() * 2 - 1) * MAX_OFFSET_NM);

  function trackForMember(m: number): LatLon[] {
    const coeff = lateralCoeffNm[m];
    return Array.from({ length: HOURS + 1 }, (_, h) => ({
      lat: 60 + ((coeff ?? 0) * (h / HOURS)) * NM_TO_DEG_LAT,
      lon: 10 + h * 0.2,
    }));
  }

  const control = makeOutcome(0, "feasible", makeSummary(controlTrack(HOURS)));
  const memberSummaries: readonly MemberSummary[] = Array.from({ length: MEMBER_COUNT }, (_, i) =>
    makeSummary(trackForMember(i)),
  );

  it("gir fallback i minst 95 % av 100 seedede, tilfeldige klassetildelinger", () => {
    const SEED_COUNT = 100; // §5.5: «100 seedede kjøringer».
    let fallbackCount = 0;
    let preconditionSkipped = 0;

    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const labelRng = mulberry32(seed * 1_000_003);
      const members: MemberOutcome[] = memberSummaries.map((summary, i) => {
        const isFeasible = labelRng() < 0.5;
        return makeOutcome(i + 1, isFeasible ? "feasible" : "infeasible", summary);
      });
      const nF = members.filter((m) => m.kind === "feasible").length;
      const nInf = members.filter((m) => m.kind === "infeasible").length;
      if (nF < 12 || nInf < 3) {
        // Ekstremt usannsynlig ved p=0,5/30, men hvis det skjer sier
        // forutsetningen selv fallback uten at det sier noe om
        // støyfiksturens egentlige spørsmål — telles ikke med.
        preconditionSkipped++;
        continue;
      }
      const advice = deriveDecisionRule({ control, members, complete: true, nF, nInf });
      if (advice.kind === "fallback") fallbackCount++;
    }

    const evaluated = SEED_COUNT - preconditionSkipped;
    expect(evaluated).toBeGreaterThan(90); // sanity: p=0,5/30 gjør nF<12/nInf<3 forsvinnende sjeldent.
    // Empirisk (5000 seeds, samme oppsett, se leveranserapporten): ratio ≈ 99,9 %
    // — LOO gir noen ekstra fallback utover selve margin-/konkordanskravet, men
    // sjelden nok til at ≥ 95 % holder komfortabelt, ikke marginalt.
    expect(fallbackCount / evaluated).toBeGreaterThanOrEqual(0.95);
  });
});
