import { describe, expect, it } from "vitest";
import {
  MEPS_LCC_PARAMS,
  lccConeConstant,
  lccConvergenceAngleRad,
  rotateGridRelativeWindToTrueNorth,
} from "./lambert-rotation.js";

describe("lccConeConstant — tangent-kjegle (MEPS: 63,3/63,3)", () => {
  it("er sin(standardparallellen) når begge standardparalleller er like", () => {
    expect(lccConeConstant(MEPS_LCC_PARAMS)).toBeCloseTo(Math.sin((63.3 * Math.PI) / 180), 10);
  });
});

describe("lccConvergenceAngleRad", () => {
  it("er null på sentralmeridianen (15°Ø for MEPS)", () => {
    expect(lccConvergenceAngleRad(15.0, MEPS_LCC_PARAMS)).toBeCloseTo(0, 10);
  });

  it("er negativ vest for sentralmeridianen, positiv øst for den (nordlig halvkule)", () => {
    expect(lccConvergenceAngleRad(10.0, MEPS_LCC_PARAMS)).toBeLessThan(0);
    expect(lccConvergenceAngleRad(20.0, MEPS_LCC_PARAMS)).toBeGreaterThan(0);
  });

  it("Skjæløy–Skagen-bboxens vestkant (8,0°Ø) gir ca. 6,3° konvergens — dokumentert i §19", () => {
    const deg = (lccConvergenceAngleRad(8.0, MEPS_LCC_PARAMS) * 180) / Math.PI;
    expect(Math.abs(deg)).toBeGreaterThan(6.0);
    expect(Math.abs(deg)).toBeLessThan(6.5);
  });
});

describe("rotateGridRelativeWindToTrueNorth", () => {
  it("er identitet på sentralmeridianen (grid-nord = sann nord der)", () => {
    const [u, v] = rotateGridRelativeWindToTrueNorth(3, 4, 15.0);
    expect(u).toBeCloseTo(3, 9);
    expect(v).toBeCloseTo(4, 9);
  });

  it("bevarer alltid vektorlengden (fart) eksakt — kun retning endres", () => {
    const [u, v] = rotateGridRelativeWindToTrueNorth(2.1468143463134766, 2.996609687805176, 10.594693665235223);
    const speedBefore = Math.hypot(2.1468143463134766, 2.996609687805176);
    const speedAfter = Math.hypot(u, v);
    expect(speedAfter).toBeCloseTo(speedBefore, 9);
  });

  it("kjent verdi (§19, 2026-09-03): ekte MEPS-punkt ved Skagen-tilnærming (lon=10,5947°Ø)", () => {
    // Rå (x_wind_10m, y_wind_10m) hentet live 2026-09-03 for kontrollmedlemmet
    // ved grid-punktet nærmest 57,7178°N/10,5854°Ø (§19 for hele utledningen).
    const [uTrue, vTrue] = rotateGridRelativeWindToTrueNorth(
      2.1468143463134766,
      2.996609687805176,
      10.594693665235223,
    );
    // Analytisk utledet konvergensvinkel her er ca. -3,94°, som dreier den
    // naive FRA-retningen fra 215,6° til ca. 211,7° — en liten, men reell
    // korreksjon, IKKE nok til alene å forklare det større avviket mot
    // Locationforecast (som skyldes produktforskjeller, ikke rotasjon).
    const fromDeg = ((Math.atan2(-uTrue, -vTrue) * 180) / Math.PI + 360) % 360;
    expect(fromDeg).toBeCloseTo(211.7, 0);
  });
});
