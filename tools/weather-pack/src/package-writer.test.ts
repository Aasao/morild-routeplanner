import { describe, expect, it } from "vitest";
import {
  ARCHIVE_WINDOW_DAYS,
  buildPointer,
  contentHash,
  objectsOlderThanArchiveWindow,
  r2Key,
} from "./package-writer.js";
import type { PackageHeader } from "@morild/protocol";

describe("contentHash (§5 — innholdsadressering)", () => {
  it("er deterministisk: samme payload gir samme hash", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    expect(contentHash(payload)).toBe(contentHash(new Uint8Array([1, 2, 3, 4, 5])));
  });

  it("ulik payload gir ulik hash", () => {
    expect(contentHash(new Uint8Array([1]))).not.toBe(contentHash(new Uint8Array([2])));
  });

  it("gir en 64-tegns hex-streng (SHA-256)", () => {
    expect(contentHash(new Uint8Array([0]))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("r2Key (§5)", () => {
  it("bygger weather/<major>/<hash>.bin", () => {
    expect(r2Key("1.2.0", "abc123")).toBe("weather/1/abc123.bin");
  });

  it("to kjøringer med byte-identisk kvantisert felt deler R2-objekt (samme major+hash)", () => {
    const payload = new Uint8Array([9, 9, 9]);
    const hash1 = contentHash(payload);
    const hash2 = contentHash(payload);
    expect(r2Key("1.0.0", hash1)).toBe(r2Key("1.0.0", hash2));
  });

  it("kaster på ugyldig formatVersion", () => {
    expect(() => r2Key("ikke-semver", "abc")).toThrow();
  });
});

describe("buildPointer", () => {
  it("bygger pekerdokumentet fra flis/felt-oppføringer", () => {
    const header: PackageHeader = {
      formatVersion: "1.0.0",
      producedAt: "2026-09-02T00:00:00Z",
      model: "MEPS",
      init: "2026-09-02T00:00:00Z",
      resolution: "2.5km",
      sourceStatus: { status: "ok" },
    };
    const pointer = buildPointer("1.0.0", [
      {
        tileId: "5_29",
        bbox: [10, 58, 12, 60],
        fields: [{ field: "wind", member: 0, key: "weather/1/hash.bin", hash: "hash", header }],
      },
    ]);
    expect(pointer.formatVersion).toBe("1.0.0");
    expect(pointer.tiles).toHaveLength(1);
    expect(pointer.tiles[0]?.fields[0]?.field).toBe("wind");
  });

  it("bærer eksplisitte missingFields for felt som bevisst ikke er inkludert (§12/N2)", () => {
    const pointer = buildPointer("1.0.0", [
      {
        tileId: "5_29",
        bbox: [10, 58, 12, 60],
        fields: [],
        missingFields: [
          { field: "current", sourceStatus: { status: "degraded", reason: "NorKyst ikke hentet denne bølgen" } },
          { field: "waves", sourceStatus: { status: "degraded", reason: "Oceanforecast ikke hentet denne bølgen" } },
        ],
      },
    ]);
    expect(pointer.tiles[0]?.missingFields).toHaveLength(2);
    expect(pointer.tiles[0]?.missingFields?.[0]?.field).toBe("current");
  });
});

describe("objectsOlderThanArchiveWindow (§5, §18 pkt. 4 — 7 døgns rullerende arkiv)", () => {
  const now = Date.parse("2026-09-10T00:00:00Z");

  it("standardvinduet er 7 døgn", () => {
    expect(ARCHIVE_WINDOW_DAYS).toBe(7);
  });

  it("markerer objekter eldre enn 7 døgn som kandidater for opprydding", () => {
    const objects = [
      { key: "a", producedAt: "2026-09-01T00:00:00Z" }, // 9 døgn gammel
      { key: "b", producedAt: "2026-09-08T00:00:00Z" }, // 2 døgn gammel
    ];
    const result = objectsOlderThanArchiveWindow(objects, now);
    expect(result.map((o) => o.key)).toEqual(["a"]);
  });

  it("et objekt nøyaktig på vindugrensen beholdes (streng ulikhet)", () => {
    const objects = [{ key: "boundary", producedAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString() }];
    expect(objectsOlderThanArchiveWindow(objects, now)).toHaveLength(0);
  });
});
