import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import { hasCertificate, requireCertificate, type CertifiedPackageHeader } from "./certificate.js";

const BASE_HEADER: PackageHeader = Object.freeze({
  formatVersion: "1.1.0",
  producedAt: "2026-09-04T00:00:00Z",
  model: "MEPS",
  init: "2026-09-04T00:00:00Z",
  resolution: "2.5km",
  sourceStatus: { status: "ok" as const },
});

const CERTIFIED: CertifiedPackageHeader = Object.freeze({
  ...BASE_HEADER,
  certificate: Object.freeze({
    maxDecodeErrorKn: 0.08,
    maxDirectionErrorDeg: 5,
    clippedSamples: 0,
    referenceInit: BASE_HEADER.init,
    verifiedAt: BASE_HEADER.producedAt,
  }),
});

describe("hasCertificate (§9.10)", () => {
  it("sant for en header med et gyldig sertifikat (clippedSamples er et tall)", () => {
    expect(hasCertificate(CERTIFIED)).toBe(true);
  });

  it("usant for en header uten certificate-felt i det hele tatt", () => {
    expect(hasCertificate(BASE_HEADER)).toBe(false);
  });

  it("usant hvis certificate mangler clippedSamples — ALDRI tolket som 'uklippet' (D7.4-koordinering)", () => {
    const missingClipped = {
      ...BASE_HEADER,
      certificate: { referenceInit: BASE_HEADER.init, verifiedAt: BASE_HEADER.producedAt },
    };
    expect(hasCertificate(missingClipped)).toBe(false);
  });

  it("usant hvis certificate er null eller ikke et objekt", () => {
    expect(hasCertificate({ ...BASE_HEADER, certificate: null } as unknown as PackageHeader)).toBe(false);
    expect(hasCertificate({ ...BASE_HEADER, certificate: "nope" } as unknown as PackageHeader)).toBe(false);
  });
});

describe("requireCertificate (§9.10 — klienten skal avvise en usertifisert flis)", () => {
  it("returnerer headeren uendret når sertifikatet finnes", () => {
    expect(requireCertificate(CERTIFIED, "test-flis")).toBe(CERTIFIED);
  });

  it("kaster en beskrivende feil når sertifikatet mangler", () => {
    expect(() => requireCertificate(BASE_HEADER, "flis 10_57 medlem 3")).toThrow(/flis 10_57 medlem 3/);
    expect(() => requireCertificate(BASE_HEADER, "flis 10_57 medlem 3")).toThrow(/certificate/);
  });
});
