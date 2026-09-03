import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import { fieldPresenceStatuses } from "./field-status.js";
import type { PointerTileEntry } from "./pointer-types.js";

const NOW_S = Date.parse("2026-09-03T06:00:00Z") / 1000;

function header(overrides: Partial<PackageHeader> = {}): PackageHeader {
  return {
    formatVersion: "1.0.0",
    producedAt: "2026-09-03T03:10:00Z",
    model: "MEPS",
    init: "2026-09-03T00:00:00Z",
    resolution: "2.5km",
    sourceStatus: { status: "ok" },
    ...overrides,
  };
}

describe("fieldPresenceStatuses — vind-only-pakken skal gi synlig strøm/bølge-mangel", () => {
  it("markerer strøm og bølger som MANGLER når tilen kun har vind (dagens dry-run-pakke)", () => {
    const tile: PointerTileEntry = {
      tileId: "t0",
      bbox: [10, 57, 12, 60],
      fields: [{ field: "wind", member: 0, key: "k", hash: "h", header: header() }],
    };
    const statuses = fieldPresenceStatuses([tile], NOW_S);
    const byField = Object.fromEntries(statuses.map((s) => [s.field, s]));
    expect(byField["wind"]?.present).toBe(true);
    expect(byField["current"]?.present).toBe(false);
    expect(byField["waves"]?.present).toBe(false);
  });

  it("regner alder fra kontrollmedlemmets header.init, ikke fra et medlem", () => {
    const tile: PointerTileEntry = {
      tileId: "t0",
      bbox: [10, 57, 12, 60],
      fields: [
        { field: "wind", member: 0, key: "k0", hash: "h0", header: header({ init: "2026-09-03T00:00:00Z" }) },
        { field: "wind", member: 1, key: "k1", hash: "h1", header: header({ init: "2020-01-01T00:00:00Z" }) },
      ],
    };
    const statuses = fieldPresenceStatuses([tile], NOW_S);
    const wind = statuses.find((s) => s.field === "wind")!;
    expect(wind.present).toBe(true);
    expect(wind.ageS).toBeCloseTo(6 * 3600, 0);
  });

  it("viser degradert kildestatus-grunn ordrett (F2.4 «06Z manglet»-klassen)", () => {
    const tile: PointerTileEntry = {
      tileId: "t0",
      bbox: [10, 57, 12, 60],
      fields: [
        {
          field: "wind",
          member: 0,
          key: "k0",
          hash: "h0",
          header: header({ sourceStatus: { status: "degraded", reason: "06Z manglet — dette er 00Z" } }),
        },
      ],
    };
    const statuses = fieldPresenceStatuses([tile], NOW_S);
    expect(statuses.find((s) => s.field === "wind")?.sourceStatus).toBe("06Z manglet — dette er 00Z");
  });

  it("uten noen flis (ingen dekning) markerer ALLE felt som manglende", () => {
    const statuses = fieldPresenceStatuses([], NOW_S);
    expect(statuses.every((s) => !s.present)).toBe(true);
  });

  it("finner feltet selv om det bare finnes i den ANDRE av rutens fliser (flisgrense-scenario, review-funn funn 2)", () => {
    const tileWithoutWaves: PointerTileEntry = {
      tileId: "5_28",
      bbox: [10, 56, 12, 58],
      fields: [{ field: "wind", member: 0, key: "k-sor", hash: "h-sor", header: header() }],
    };
    const tileWithWaves: PointerTileEntry = {
      tileId: "5_29",
      bbox: [10, 58, 12, 60],
      fields: [
        { field: "wind", member: 0, key: "k-nord", hash: "h-nord", header: header() },
        { field: "waves", member: 0, key: "k-nord-waves", hash: "h-nord-waves", header: header() },
      ],
    };
    const statuses = fieldPresenceStatuses([tileWithoutWaves, tileWithWaves], NOW_S);
    expect(statuses.find((s) => s.field === "waves")?.present).toBe(true);
  });
});
