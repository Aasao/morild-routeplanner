import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLegalGate } from "./legal-gate.js";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("checkLegalGate (§16 — --live nektes uten verifisert MET-vilkårsdokument)", () => {
  it("nekter hvis mappen ikke finnes i det hele tatt", () => {
    const result = checkLegalGate(join(tmpdir(), "denne-finnes-ikke-" + Math.random()));
    expect(result.ok).toBe(false);
    expect(result.matchedFile).toBeUndefined();
  });

  it("nekter hvis docs/legal/ finnes men ingen met-norway*.md-fil er der", () => {
    dir = mkdtempSync(join(tmpdir(), "legal-"));
    writeFileSync(join(dir, "kartverket-sjokart-raster-wmts.md"), "Status: verifisert\n");
    const result = checkLegalGate(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/met-norway/i);
  });

  it("nekter hvis filen finnes, men ikke er markert verifisert", () => {
    dir = mkdtempSync(join(tmpdir(), "legal-"));
    writeFileSync(join(dir, "met-norway-thredds.md"), "# MET Norway\n\nStatus: utkast, ikke gjennomgått\n");
    const result = checkLegalGate(dir);
    expect(result.ok).toBe(false);
    expect(result.matchedFile).toBe("met-norway-thredds.md");
  });

  it("tillater --live når filen finnes og er markert verifisert", () => {
    dir = mkdtempSync(join(tmpdir(), "legal-"));
    writeFileSync(join(dir, "met-norway-api-vilkaar.md"), "# MET Norway API-vilkår\n\nStatus: verifisert 2026-09-03\n");
    const result = checkLegalGate(dir);
    expect(result.ok).toBe(true);
    expect(result.matchedFile).toBe("met-norway-api-vilkaar.md");
  });

  it("finner filen uavhengig av eksakt navn (met-norway*.md, case-insensitive)", () => {
    dir = mkdtempSync(join(tmpdir(), "legal-"));
    writeFileSync(join(dir, "MET-Norway-THREDDS.MD"), "Status: verifisert\n");
    const result = checkLegalGate(dir);
    expect(result.ok).toBe(true);
  });
});
