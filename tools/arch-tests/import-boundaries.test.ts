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

describe("sjekken beviselig fanger faktiske brudd", () => {
  it("flagger node:fs og en pakke utenfor grensen i fixture-pakken", () => {
    const violations = checkPackageBoundary(
      join(import.meta.dirname, "fixtures/violating-package/src"),
    );
    expect(violations.length).toBe(2);
    expect(violations.some((v) => v.includes('"node:fs"'))).toBe(true);
    expect(violations.some((v) => v.includes('"@morild/charts"'))).toBe(true);
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
