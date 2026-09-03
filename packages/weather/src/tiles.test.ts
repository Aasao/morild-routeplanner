import { describe, expect, it } from "vitest";
import {
  classifyCoastalZone,
  KYSTSONE_THRESHOLD_NM,
  lonStepDegForKm,
  latStepDegForKm,
  MAX_SUBTILE_NODES,
  subtileCountPerAxis,
  TILE_DEG,
  tileOrigin,
} from "./tiles.js";

describe("flisorigo — heltallsgrader, delt med kartflisene (§7)", () => {
  it("snapper til nærmeste 2°-multiplum, ikke til posisjonen selv", () => {
    expect(tileOrigin(58.7, 11.3)).toEqual({ latMin: 58, lonMin: 10 });
    expect(tileOrigin(59.9999, 9.0001)).toEqual({ latMin: 58, lonMin: 8 });
    expect(tileOrigin(60, 10)).toEqual({ latMin: 60, lonMin: 10 });
    expect(tileOrigin(-1.5, -0.5)).toEqual({ latMin: -2, lonMin: -2 });
  });

  it("TILE_DEG er 2 (§18 pkt. 3)", () => {
    expect(TILE_DEG).toBe(2);
  });
});

describe("kystsone-klassifisering (§9.4, §17 pkt. 8) — kjent strekning, kjent grid", () => {
  // Fast, kjent "kystlinje": ett punkt ved Skjæløy (Hvaler). Forventet
  // klassifisering notert FØR testen skrives (§17 pkt. 8): et subflis-
  // senter 5 nm unna er kystsone, ett 40 nm unna er utaskjærs, ett uten
  // dekning i det hele tatt er (konservativt) kystsone.
  const COAST_LAT = 59.0;
  const COAST_LON = 10.9;

  function distanceToCoastNm(lat: number, lon: number): number | undefined {
    // Grovt: 1° ≈ 60 nm, brukt bare for en deterministisk fikstur.
    const dLat = (lat - COAST_LAT) * 60;
    const dLon = (lon - COAST_LON) * 60 * Math.cos((COAST_LAT * Math.PI) / 180);
    if (lat > 65) return undefined; // simulerer manglende dekning nord for domenet
    return Math.hypot(dLat, dLon);
  }

  it("subflis nær kysten (5 nm) klassifiseres kystsone", () => {
    expect(classifyCoastalZone(59.0 + 5 / 60, 10.9, distanceToCoastNm)).toBe(
      "kystsone",
    );
  });

  it("subflis langt til havs (40 nm) klassifiseres utaskjærs", () => {
    expect(classifyCoastalZone(59.0 + 40 / 60, 10.9, distanceToCoastNm)).toBe(
      "utaskjaers",
    );
  });

  it("nøyaktig på terskelen (20 nm) er inklusiv — kystsone, ikke utaskjærs", () => {
    const exactlyAtThreshold = (): number => KYSTSONE_THRESHOLD_NM;
    expect(classifyCoastalZone(59.0, 10.9, exactlyAtThreshold)).toBe("kystsone");
  });

  it("manglende kystlinjedekning defaulter til kystsone, ikke utaskjærs (§9.4 pkt. 4)", () => {
    expect(classifyCoastalZone(70, 10.9, distanceToCoastNm)).toBe("kystsone");
  });
});

describe("subtileCountPerAxis — ≤32 noder per subflis (§7)", () => {
  it("2,5 km vindoppløsning over en 2°-flis krever flere subfliser enn 1", () => {
    const stepDeg = latStepDegForKm(2.5);
    const n = subtileCountPerAxis(stepDeg);
    expect(n).toBeGreaterThan(1);
    // 2° / 2,5 km-steg ≈ 89 noder; 89/32 → 3 subfliser per akse.
    expect(n).toBe(3);
  });

  it("grov nok oppløsning (hele flisen < 32 noder) gir én subflis", () => {
    const stepDeg = TILE_DEG / (MAX_SUBTILE_NODES - 1);
    expect(subtileCountPerAxis(stepDeg)).toBe(1);
  });

  it("lonStepDegForKm er bredere ved høyere breddegrad (kortere lengdegrader)", () => {
    const at60 = lonStepDegForKm(10, 60);
    const at0 = lonStepDegForKm(10, 0);
    expect(at60).toBeGreaterThan(at0);
  });
});
