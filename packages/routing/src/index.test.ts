import { describe, expect, it } from "vitest";
import { ROUTING_PACKAGE_PLACEHOLDER } from "./index.js";

describe("packages/routing (fase 0-skjelett)", () => {
  it("eksporterer placeholderen inntil fase 2 fyller pakken", () => {
    expect(ROUTING_PACKAGE_PLACEHOLDER).toBe("routing");
  });
});
