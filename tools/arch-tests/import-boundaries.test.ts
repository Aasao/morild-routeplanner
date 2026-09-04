import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPackageBoundary,
  extractImportSpecifiers,
  violatingReason,
} from "./import-boundaries.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("arkitekturgrense: packages/geo importerer aldri I/O eller andre pakker", () => {
  it("finner ingen brudd i packages/geo/src", () => {
    const violations = checkPackageBoundary(join(REPO_ROOT, "packages/geo/src"));
    expect(violations).toEqual([]);
  });
});

describe("arkitekturgrense: packages/routing importerer aldri I/O eller andre pakker", () => {
  it("finner ingen brudd i packages/routing/src", () => {
    const violations = checkPackageBoundary(
      join(REPO_ROOT, "packages/routing/src"),
    );
    expect(violations).toEqual([]);
  });
});

describe("arkitekturgrense: packages/weather importerer aldri I/O, routing eller andre pakker", () => {
  // packages/weather skal bestå samme grense som geo/routing (kravet i
  // denne bølgens oppdrag): ren, deterministisk, ingen fetch/fs/node:, og
  // — like viktig — ALDRI `@morild/routing`, selv om `weather-field-
  // adapter.ts` produserer et objekt strukturelt kompatibelt med routing sin
  // `WeatherField`. Adapteren speiler kontrakten, den importerer den ikke
  // (se `weather-field-adapter.ts`s toppkommentar). Testfiler er unntatt
  // (samme regel som for routing over) — `golden-bridge.test.ts` importerer
  // bevisst `@morild/routing` for å bevise broen ende-til-ende.
  it("finner ingen brudd i packages/weather/src", () => {
    const violations = checkPackageBoundary(join(REPO_ROOT, "packages/weather/src"));
    expect(violations).toEqual([]);
  });
});

describe("arkitekturgrense: test-fixtures følger samme grense som src", () => {
  // Fiksturene mater golden-/E1'-målinger og må være like rene som
  // motoren: deterministiske, uten I/O (review-funn 2026-08-31, lav).
  it("finner ingen brudd i packages/routing/test-fixtures", () => {
    const violations = checkPackageBoundary(
      join(REPO_ROOT, "packages/routing/test-fixtures"),
    );
    expect(violations).toEqual([]);
  });
});

/** Sti-fragmenter D8.8 forbyr overalt utenfor selve søkemekanikken:
 * robusthetstall skal komme fra fulle søk, aldri fra en skalarvariant
 * (`variants.js`) eller korridorgeometri (`corridor.js`) hentet direkte. */
const FORBIDDEN_SEARCH_INTERNALS: readonly string[] = ["variants.js", "corridor.js"];

describe("arkitekturgrense: packages/robustness importerer kun routing/geo/protocol, aldri søkeinternaler", () => {
  it("finner ingen brudd i packages/robustness/src", () => {
    const violations = checkPackageBoundary(join(REPO_ROOT, "packages/robustness/src"), {
      allowedPackages: new Set(["@morild/routing", "@morild/geo", "@morild/protocol"]),
      forbiddenPathFragments: FORBIDDEN_SEARCH_INTERNALS,
    });
    expect(violations).toEqual([]);
  });
});

describe("arkitekturgrense: apps/pwa importerer aldri variants.js/corridor.js direkte", () => {
  it("finner ingen brudd i apps/pwa/src", () => {
    const violations = checkPackageBoundary(join(REPO_ROOT, "apps/pwa/src"), {
      allowedPackages: "any",
      forbiddenPathFragments: FORBIDDEN_SEARCH_INTERNALS,
    });
    expect(violations).toEqual([]);
  });
});

describe("sjekken beviselig fanger faktiske brudd", () => {
  it("flagger node:fs og en pakke utenfor grensen i fixture-pakken", () => {
    const violations = checkPackageBoundary(
      join(import.meta.dirname, "fixtures/violating-package/src"),
    );
    expect(violations.length).toBe(2);
    expect(violations.some((v) => v.includes('"node:fs"'))).toBe(true);
    expect(violations.some((v) => v.includes('"@morild/charts"'))).toBe(true);
  });

  it("flagger en dypimport av corridor.js via forbiddenPathFragments", () => {
    const violations = checkPackageBoundary(
      join(import.meta.dirname, "fixtures/corridor-importing-package/src"),
      {
        allowedPackages: new Set(["@morild/routing", "@morild/geo", "@morild/protocol"]),
        forbiddenPathFragments: FORBIDDEN_SEARCH_INTERNALS,
      },
    );
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("corridor.js");
  });

  it("violatingReason skiller tillatte og forbudte spesifikatorer", () => {
    expect(violatingReason("./geo.js")).toBeUndefined();
    expect(violatingReason("@morild/geo")).toBeUndefined();
    expect(violatingReason("@morild/protocol")).toBeUndefined();
    expect(violatingReason("@morild/weather")).toBeDefined();
    expect(violatingReason("node:fs")).toBeDefined();
    expect(violatingReason("fs")).toBeDefined();
    expect(violatingReason("fetch")).toBeDefined();
  });

  it("extractImportSpecifiers finner både import og require", () => {
    const source = `
      import { foo } from "./local.js";
      import bar from "node:fs";
      const baz = require("path");
    `;
    expect(extractImportSpecifiers(source)).toEqual([
      "./local.js",
      "node:fs",
      "path",
    ]);
  });
});
