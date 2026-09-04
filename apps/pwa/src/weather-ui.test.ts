import { describe, expect, it } from "vitest";
import { formatElapsed, renderControlResult, renderEnsembleSummary } from "./weather-ui.js";
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
