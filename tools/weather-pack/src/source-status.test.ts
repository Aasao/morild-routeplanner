import { describe, expect, it } from "vitest";
import {
  STATUS_OK,
  combineSourceStatuses,
  ensembleFellBackToOlderRun,
  fieldMissingEntirely,
  offshoreThinningIsNotDegraded,
  runFellBackToOlder,
  tideOnlyIsNotACurrentField,
  wam800UnavailablePointFallback,
} from "./source-status.js";

describe("§12 — kildestatus-konstruktører", () => {
  it("runFellBackToOlder matcher F2.4s eget eksempel ordrett", () => {
    expect(runFellBackToOlder("06Z", "00Z")).toEqual({
      status: "degraded",
      reason: "06Z manglet — dette er 00Z",
    });
  });

  it("ensembleFellBackToOlderRun nevner antall medlemmer og alder", () => {
    const status = ensembleFellBackToOlderRun(22, "2026-09-02T06Z");
    expect(status.status).toBe("degraded");
    if (status.status === "degraded") {
      expect(status.reason).toMatch(/22/);
      expect(status.reason).toMatch(/2026-09-02T06Z/);
    }
  });

  it("wam800UnavailablePointFallback matcher §12-tabellens ordlyd", () => {
    expect(wam800UnavailablePointFallback()).toEqual({
      status: "degraded",
      reason: "WAM800 utilgjengelig — punktbølge brukt",
    });
  });

  it("tideOnlyIsNotACurrentField er degraded, ikke ok (§9.4: dette ER et datahull)", () => {
    expect(tideOnlyIsNotACurrentField().status).toBe("degraded");
  });

  it("offshoreThinningIsNotDegraded er OK — villet kvalitetsreduksjon, ikke datahull (§12 rad 5)", () => {
    expect(offshoreThinningIsNotDegraded()).toEqual(STATUS_OK);
  });

  it("fieldMissingEntirely navngir feltet og sier eksplisitt at ingenting ble gjettet", () => {
    const status = fieldMissingEntirely("Hs");
    expect(status.status).toBe("degraded");
    if (status.status === "degraded") {
      expect(status.reason).toContain("Hs");
      expect(status.reason).toMatch(/ingen verdi gjettet/i);
    }
  });
});

describe("combineSourceStatuses", () => {
  it("gir 'ok' kun hvis alle er 'ok'", () => {
    expect(combineSourceStatuses([STATUS_OK, STATUS_OK])).toEqual(STATUS_OK);
  });

  it("gir 'degraded' hvis minst én er degradert, og samler årsakene", () => {
    const result = combineSourceStatuses([
      STATUS_OK,
      runFellBackToOlder("06Z", "00Z"),
      wam800UnavailablePointFallback(),
    ]);
    expect(result.status).toBe("degraded");
    if (result.status === "degraded") {
      expect(result.reason).toContain("06Z manglet");
      expect(result.reason).toContain("WAM800");
    }
  });

  it("håndterer tom liste (ingen felt = ok, ingenting å rapportere)", () => {
    expect(combineSourceStatuses([])).toEqual(STATUS_OK);
  });
});
