/**
 * **Havnebokens gates** (`docs/specs/robusthet.md` §3.5/§4.5 pkt. 2, §5.6).
 *
 * Gatene er billige, rene funksjoner, og de er de eneste stedene i
 * bail-out-kjeden der «vet ikke» skilles fra «nei». Testene under holder
 * begge skillene fast:
 *
 *  - manglende dybde er `mangler-dybde` (ekskludert, og dekningen faller til
 *    `partial`), ikke `dybde` (målt for grunt) og aldri stilltiende «ok»;
 *  - `nightApproachSafe: false` er en avvisning ved mørk ankomst, og
 *    før-gaten avviser kun når HELE ankomstvinduet er mørkt.
 */
import { describe, expect, it } from "vitest";
import { INTERIM_HARBOUR_BOOK } from "../test-fixtures/harbour-book.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import type { HarbourBookEntry } from "./harbour-book.js";
import {
  darknessGate,
  darknessPreGate,
  depthGate,
  hasDaylightWithin,
  MORILD_DRAUGHT_M,
  requiredHarbourDepthM,
  STATIC_DEPTH_MARGIN_M,
} from "./harbour-book.js";

const SKAGEN = INTERIM_HARBOUR_BOOK.find((h) => h.id === "skagen")!;

/** 2026-06-17 04:00 UTC. Dagslys ved Skagen er 03:16–19:21 UTC dette døgnet. */
const SUMMER_DAY_S = 1781668800;
const SUMMER_NIGHT_S = SUMMER_DAY_S + 18 * 3600; // 22:00 UTC
/** 2026-11-16 16:00 UTC. Dagslys 08:04–13:59 UTC — altså mørkt. */
const WINTER_NIGHT_S = 1794844800;

function withDepths(
  entry: HarbourBookEntry,
  quayM: number | null,
  anchorageM: number | null,
): HarbourBookEntry {
  return {
    ...entry,
    minDepthAtQuayM:
      quayM === null
        ? null
        : { valueM: quayM, source: "test", date: "2026-09-05" },
    minDepthAtAnchorageM:
      anchorageM === null
        ? null
        : { valueM: anchorageM, source: "test", date: "2026-09-05" },
  };
}

describe("requiredHarbourDepthM", () => {
  it("faller tilbake på kravspekens B1-tall når båtmodellen tier", () => {
    expect(requiredHarbourDepthM(testBoat())).toBeCloseTo(
      MORILD_DRAUGHT_M + STATIC_DEPTH_MARGIN_M,
      10,
    );
    expect(requiredHarbourDepthM(testBoat())).toBeCloseTo(2.6, 10);
  });

  it("bruker båtmodellens egne tall når de finnes", () => {
    const deep = { ...testBoat(), draughtM: 3.0, depthClearanceM: 0.8 };
    expect(requiredHarbourDepthM(deep)).toBeCloseTo(3.8, 10);
  });
});

describe("depthGate", () => {
  it("slipper gjennom når begge liggedybdene klarer kravet", () => {
    const verdict = depthGate(withDepths(SKAGEN, 4.0, 6.0), 2.6);
    expect(verdict.passed).toBe(true);
  });

  it("avviser med «dybde» når den grunneste liggedybden er for lav", () => {
    const verdict = depthGate(withDepths(SKAGEN, 2.0, 6.0), 2.6);
    expect(verdict.passed).toBe(false);
    if (verdict.passed) return;
    expect(verdict.gate).toBe("dybde");
    expect(verdict.reason).toContain("2.0");
  });

  it("avviser med «mangler-dybde» når ETT av tallene mangler", () => {
    for (const entry of [
      withDepths(SKAGEN, null, 6.0),
      withDepths(SKAGEN, 4.0, null),
      withDepths(SKAGEN, null, null),
    ]) {
      const verdict = depthGate(entry, 2.6);
      expect(verdict.passed).toBe(false);
      if (verdict.passed) continue;
      // Ikke «dybde»: forskjellen på «målt for grunt» og «ikke målt» er
      // hele poenget (N2, ærlig degradering).
      expect(verdict.gate).toBe("mangler-dybde");
    }
  });

  it("er skjerpet mot kravet, ikke mot gjennomsnittet", () => {
    // Nøyaktig på kravet slipper gjennom; ett hundredels meter under gjør ikke.
    expect(depthGate(withDepths(SKAGEN, 2.6, 2.6), 2.6).passed).toBe(true);
    expect(depthGate(withDepths(SKAGEN, 2.59, 9.0), 2.6).passed).toBe(false);
  });
});

describe("darknessGate", () => {
  it("godtar ankomst i dagslys", () => {
    expect(darknessGate(SKAGEN, SUMMER_DAY_S).passed).toBe(true);
  });

  it("avviser ankomst utenfor dagslys når havnen ikke er mørketrygg", () => {
    const verdict = darknessGate(SKAGEN, SUMMER_NIGHT_S);
    expect(verdict.passed).toBe(false);
    if (verdict.passed) return;
    expect(verdict.gate).toBe("moerke");
  });

  it("godtar mørk ankomst kun når Magnus har merket havnen mørketrygg", () => {
    const nightSafe = { ...SKAGEN, nightApproachSafe: true };
    expect(darknessGate(nightSafe, SUMMER_NIGHT_S).passed).toBe(true);
    expect(darknessGate(nightSafe, WINTER_NIGHT_S).passed).toBe(true);
  });
});

describe("hasDaylightWithin og darknessPreGate", () => {
  it("finner dagslyset i et vindu som strekker seg til neste morgen", () => {
    const lat = SKAGEN.position.lat;
    const lon = SKAGEN.position.lon;
    // 22:00 → 02:00: hele vinduet ligger før soloppgang + margin (03:16).
    expect(hasDaylightWithin(lat, lon, SUMMER_NIGHT_S, SUMMER_NIGHT_S + 4 * 3600)).toBe(
      false,
    );
    // 22:00 → 06:00: rekker inn i morgendagens vindu.
    expect(hasDaylightWithin(lat, lon, SUMMER_NIGHT_S, SUMMER_NIGHT_S + 8 * 3600)).toBe(
      true,
    );
  });

  it("avviser før søket kun når hele ankomstvinduet er mørkt", () => {
    const dark = darknessPreGate(
      SKAGEN,
      WINTER_NIGHT_S,
      WINTER_NIGHT_S + 6 * 3600,
    );
    expect(dark.passed).toBe(false);
    if (!dark.passed) expect(dark.gate).toBe("moerke");

    // Samme vindulengde, men det treffer morgenen: da skal søket kjøres, og
    // den endelige dommen tas på faktisk ankomsttid.
    const maybe = darknessPreGate(
      SKAGEN,
      WINTER_NIGHT_S + 15 * 3600,
      WINTER_NIGHT_S + 21 * 3600,
    );
    expect(maybe.passed).toBe(true);
  });

  it("slipper alltid gjennom en mørketrygg havn", () => {
    const nightSafe = { ...SKAGEN, nightApproachSafe: true };
    expect(
      darknessPreGate(nightSafe, WINTER_NIGHT_S, WINTER_NIGHT_S + 6 * 3600)
        .passed,
    ).toBe(true);
  });
});

describe("interim-havneboken (fikstur)", () => {
  it("har id, dybder og sikkerhetsdefault for alle åtte havnene", () => {
    expect(INTERIM_HARBOUR_BOOK.length).toBe(8);
    for (const entry of INTERIM_HARBOUR_BOOK) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.minDepthAtQuayM).not.toBeNull();
      expect(entry.minDepthAtAnchorageM).not.toBeNull();
      // Sikkerhetsdefaulten (§3.5): ingen havn er mørketrygg før noen sier det.
      expect(entry.nightApproachSafe).toBe(false);
      expect(depthGate(entry, 2.6).passed).toBe(true);
    }
  });
});
