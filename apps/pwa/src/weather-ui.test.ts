import { describe, expect, it } from "vitest";
import { summarizeDeparture, WAVE_GREEN_CAP_STAMP, type RobustnessStamp } from "@morild/robustness";
import { formatElapsed, renderControlResult, renderDepartureText, renderEnsembleSummary } from "./weather-ui.js";
import { summarizeEnsemble, type MemberOutcome } from "./weather/ensemble.js";

/** Minimal element-attrapp — render-funksjonene setter bare `textContent`. */
function el(): HTMLElement {
  return { textContent: "" } as unknown as HTMLElement;
}

describe("formatElapsed (nettbrett-måling, ADR-0005 port 1)", () => {
  it("under ett minutt: sekunder med én desimal", () => {
    expect(formatElapsed(4237)).toBe("4.2 s");
  });
  it("over ett minutt: minutter og hele sekunder", () => {
    expect(formatElapsed(72_400)).toBe("1 min 12 s");
  });
});

describe("renderEnsembleSummary med tidsmåling", () => {
  const outcomes: MemberOutcome[] = [
    { memberIndex: 0, isControl: true, classification: "error", errorMessage: "x" },
    { memberIndex: 1, isControl: false, classification: "error", errorMessage: "x" },
  ];
  const summary = summarizeEnsemble(outcomes);

  it("viser fremdrift mens medlemmer gjenstår", () => {
    const target = el();
    renderEnsembleSummary(target, summary, {
      wallMs: 5000,
      membersDone: 1,
      membersTotal: 30,
      poolSize: 8,
    });
    expect(target.textContent).toContain("Fremdrift: 1/30 medlemmer på 5.0 s (8 Workere)");
  });

  it("viser total veggklokke når alle er ferdige", () => {
    const target = el();
    renderEnsembleSummary(target, summary, {
      wallMs: 90_000,
      membersDone: 30,
      membersTotal: 30,
      poolSize: 8,
    });
    expect(target.textContent).toContain("Ensemblet tok 1 min 30 s for 30 medlemmer (8 Workere)");
  });

  it("uten tidsmåling: uendret tekst (ingen tomme «Beregnet på»)", () => {
    const target = el();
    renderEnsembleSummary(target, summary);
    expect(target.textContent).not.toContain("Fremdrift");
    const control = el();
    renderControlResult(control, outcomes[0]!);
    expect(control.textContent).not.toContain("Beregnet på");
  });
});

describe("renderDepartureText — utelatte vindmedlemmer (vaerpakker.md §19 2026-09-29)", () => {
  const stamp: RobustnessStamp = {
    maskVersion: "m",
    packageId: "p",
    packageInitEpochS: 0,
    memberAgesS: [],
    optionsHash: "o",
    estimator: "naermeste-rang-v1",
    thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
    waveGreenCap: WAVE_GREEN_CAP_STAMP,
    wavePeriodKnown: false,
    wavePoints: null,
  };
  function departure(s: RobustnessStamp) {
    return summarizeDeparture({
      departEpochS: 0,
      control: { memberIndex: 0, kind: "error", summary: null, error: "x" },
      members: [],
      expectedMembers: 23,
      thresholds: [],
      stamp: s,
    });
  }

  it("sier «n av N» og hvilke medlemmer som mangler", () => {
    const text = renderDepartureText(
      departure({ ...stamp, windMembers: { withData: 24, nominal: 30, missing: [9, 10, 11, 24, 25, 26] } }),
    );
    expect(text).toContain("Vinddata: 24 av 30 medlemmer — utelatt uten brukbare data: 9, 10, 11, 24, 25, 26.");
  });

  it("ingen tekst når alle har data", () => {
    expect(renderDepartureText(departure(stamp))).not.toContain("Vinddata:");
  });
});
