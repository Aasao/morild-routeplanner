import { describe, expect, it } from "vitest";
import {
  checkCompatibility,
  parseSemver,
  type PackageHeader,
} from "./package-header.js";

describe("parseSemver", () => {
  it("parser gyldig semver", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it("kaster på ugyldig semver", () => {
    expect(() => parseSemver("1.2")).toThrow();
    expect(() => parseSemver("v1.2.3")).toThrow();
    expect(() => parseSemver("ikke-en-versjon")).toThrow();
  });
});

describe("checkCompatibility", () => {
  it("aksepterer ulik minor/patch innenfor samme major", () => {
    expect(checkCompatibility("1.0.0", "1.5.2")).toEqual({ compatible: true });
    expect(checkCompatibility("1.9.0", "1.0.0")).toEqual({ compatible: true });
    expect(checkCompatibility("1.0.0", "1.0.0")).toEqual({ compatible: true });
  });

  it("avviser høyere major", () => {
    const result = checkCompatibility("1.0.0", "2.0.0");
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toMatch(/major/i);
    }
  });

  it("avviser lavere major", () => {
    const result = checkCompatibility("2.0.0", "1.9.9");
    expect(result.compatible).toBe(false);
  });
});

describe("PackageHeader (kompilerer og bærer forventede felt)", () => {
  it("godtar en fullstendig header med sourceStatus ok", () => {
    const header: PackageHeader = {
      formatVersion: "1.0.0",
      producedAt: "2026-08-30T06:00:00Z",
      model: "MEPS",
      init: "2026-08-30T00:00:00Z",
      resolution: "2.5km",
      sourceStatus: { status: "ok" },
    };
    expect(header.model).toBe("MEPS");
  });

  it("godtar degradert kildestatus med årsak (ærlig degradering, N2)", () => {
    const header: PackageHeader = {
      formatVersion: "1.0.0",
      producedAt: "2026-08-30T06:00:00Z",
      model: "MEPS",
      init: "2026-08-30T00:00:00Z",
      resolution: "2.5km",
      sourceStatus: { status: "degraded", reason: "06Z manglet — dette er 00Z" },
    };
    expect(header.sourceStatus.status).toBe("degraded");
  });
});
