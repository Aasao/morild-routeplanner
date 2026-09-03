import { describe, expect, it } from "vitest";
import { userAgentFor } from "./user-agent.js";

describe("userAgentFor", () => {
  it("bruker committet fallback når env-verdien mangler", () => {
    expect(userAgentFor({})).toBe("morild-routeplanner/0.1.0 maasao@gmail.com");
  });

  it("bruker committet fallback når env-verdien er tom/whitespace", () => {
    expect(userAgentFor({ MET_USER_AGENT: "" })).toBe(
      "morild-routeplanner/0.1.0 maasao@gmail.com",
    );
    expect(userAgentFor({ MET_USER_AGENT: "   " })).toBe(
      "morild-routeplanner/0.1.0 maasao@gmail.com",
    );
  });

  it("bruker (trimmet) env-verdi når den finnes", () => {
    expect(userAgentFor({ MET_USER_AGENT: " morild-routeplanner/0.2.0 maasao@gmail.com " })).toBe(
      "morild-routeplanner/0.2.0 maasao@gmail.com",
    );
  });
});
