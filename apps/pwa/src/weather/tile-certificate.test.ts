/**
 * Klippe- og sertifikat-asserten (D7.2 vilkår (iv)) — se
 * `tile-certificate.ts` for hvorfor en flis uten verifisert dekodefeil ikke
 * kan brukes: det er `maxDecodeErrorKn` som bærer TWS-vaktbåndet i motoren.
 */
import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import {
  acceptTileHeader,
  parseCertificate,
  reportsClipping,
} from "./tile-certificate.js";

const BASE: PackageHeader = {
  formatVersion: "1.0.0",
  producedAt: "2026-09-03T00:00:00Z",
  model: "MEPS",
  init: "2026-09-03T00:00:00Z",
  resolution: "2.5km",
  sourceStatus: { status: "ok" },
};

const CERT = {
  maxDecodeErrorKn: 0.09,
  maxDirectionErrorDeg: 0.6,
  referenceInit: "2026-09-03T00:00:00Z",
  verifiedAt: "2026-09-03T01:00:00Z",
};

function withCert(cert: unknown): PackageHeader {
  return { ...BASE, certificate: cert } as PackageHeader;
}

describe("parseCertificate", () => {
  it("leser et fullstendig sertifikat", () => {
    expect(parseCertificate(withCert(CERT))).toEqual(CERT);
  });

  it("tar med Hs-feilen når den finnes (bølgefelt)", () => {
    const cert = parseCertificate(withCert({ ...CERT, maxHsErrorM: 0.05 }));
    expect(cert?.maxHsErrorM).toBe(0.05);
  });

  it("mangler feltet helt ⇒ undefined", () => {
    expect(parseCertificate(BASE)).toBeUndefined();
  });

  it("et HALVT sertifikat er ikke et sertifikat", () => {
    for (const broken of [
      { ...CERT, maxDecodeErrorKn: undefined },
      { ...CERT, maxDecodeErrorKn: -1 },
      { ...CERT, maxDecodeErrorKn: Number.NaN },
      { ...CERT, maxDirectionErrorDeg: undefined },
      { ...CERT, referenceInit: "" },
      { ...CERT, verifiedAt: undefined },
      "et-sertifikat-som-streng",
      null,
    ]) {
      expect(parseCertificate(withCert(broken))).toBeUndefined();
    }
  });
});

describe("reportsClipping", () => {
  it("boolsk flagg og telleverk teller begge som klipping", () => {
    expect(reportsClipping({ ...CERT, clipped: true })).toBe(true);
    expect(reportsClipping({ ...CERT, clippedSamples: 1 })).toBe(true);
    expect(reportsClipping({ ...CERT, clipped: false, clippedSamples: 0 })).toBe(false);
    expect(reportsClipping(CERT)).toBe(false);
  });
});

describe("acceptTileHeader", () => {
  it("godtar en sertifisert, uklippet flis", () => {
    const verdict = acceptTileHeader(withCert(CERT));
    expect(verdict.accepted).toBe(true);
    if (verdict.accepted) expect(verdict.certificate.maxDecodeErrorKn).toBe(0.09);
  });

  it("avviser flis uten sertifikat — med lesbar årsak, ikke bare `false`", () => {
    const verdict = acceptTileHeader(BASE);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) {
      expect(verdict.reason).toMatch(/uten sertifikat/);
      expect(verdict.reason).toMatch(/vaktbånd/);
    }
  });

  it("avviser flis med rapportert klipping", () => {
    const verdict = acceptTileHeader(withCert({ ...CERT, clipped: true }));
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) expect(verdict.reason).toMatch(/klipping/);
  });
});
