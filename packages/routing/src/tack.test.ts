import { describe, expect, it } from "vitest";
import { DEFAULT_TACK_PARAMS, tackOf, tackPenaltyS } from "./tack.js";

const TWS = 12;

describe("tackOf", () => {
  it("gir 0 utenfor bidevind", () => {
    // Vind fra nord, kurs rett sør = lens (TWA 180).
    expect(tackOf(180, 0, 60)).toBe(0);
    // TWA nøyaktig på grensen regnes ikke som kryss.
    expect(tackOf(60, 0, 60)).toBe(0);
  });

  it("skiller babord og styrbord halse i bidevind", () => {
    // Vind fra nord (0°). Kurs 45° = vinden inn fra babord side.
    const styrbord = tackOf(45, 0, 60);
    const babord = tackOf(315, 0, 60);
    expect(styrbord).not.toBe(0);
    expect(babord).not.toBe(0);
    expect(styrbord).toBe(-babord);
  });

  it("er konsistent når vindretningen dreier", () => {
    // Samme geometri, vind fra 90° i stedet for 0°: halsen skal følge med.
    expect(tackOf(135, 90, 60)).toBe(tackOf(45, 0, 60));
    expect(tackOf(45, 90, 60)).toBe(tackOf(315, 0, 60));
  });
});

describe("tackPenaltyS", () => {
  it("koster ingenting under 15° kursendring", () => {
    expect(tackPenaltyS(90, 90, 0, 0, TWS)).toBe(0);
    expect(tackPenaltyS(90, 104, 0, 0, TWS)).toBe(0);
    expect(tackPenaltyS(90, 105, 0, 0, TWS)).toBe(0);
    expect(tackPenaltyS(90, 106, 0, 0, TWS)).toBeGreaterThan(0);
  });

  it("gir v1s 90 sekunder for en typisk 90°-bautt", () => {
    expect(tackPenaltyS(45, 315, 1, -1, TWS)).toBe(90);
  });

  it("er symmetrisk i |Δkurs|", () => {
    for (const delta of [20, 45, 90, 135, 179]) {
      const forward = tackPenaltyS(100, 100 + delta, 0, 0, TWS);
      const backward = tackPenaltyS(100, 100 - delta, 0, 0, TWS);
      expect(forward).toBe(backward);
    }
  });

  it("er monoton i |Δkurs| på samme hals", () => {
    let previous = -1;
    for (let delta = 16; delta <= 180; delta += 4) {
      const penalty = tackPenaltyS(0, delta, 1, 1, TWS);
      expect(penalty).toBeGreaterThanOrEqual(previous);
      previous = penalty;
    }
  });

  it("koster strengt mer ved halsbytte enn ved samme kursendring på én hals", () => {
    for (const delta of [30, 60, 90, 120]) {
      const sameTack = tackPenaltyS(0, delta, 1, 1, TWS);
      const tackChange = tackPenaltyS(0, delta, 1, -1, TWS);
      expect(tackChange).toBeGreaterThan(sameTack);
      expect(tackChange - sameTack).toBe(DEFAULT_TACK_PARAMS.tackBaseS);
    }
  });

  it("gipp (begge halser 0) koster bare manøverleddet", () => {
    expect(tackPenaltyS(150, 210, 0, 0, TWS)).toBe(
      Math.round(DEFAULT_TACK_PARAMS.manoeuvreBaseS * (60 / 90)),
    );
  });

  it("avkorter formfaktoren ved 180° — dobbel kost av 90°, ikke mer", () => {
    const at90 = tackPenaltyS(0, 90, 0, 0, TWS);
    const at180 = tackPenaltyS(0, 180, 0, 0, TWS);
    expect(at180).toBe(2 * at90);
  });

  it("er uavhengig av TWS i v2.0 — koblingen er ikke aktivert", () => {
    const light = tackPenaltyS(45, 315, 1, -1, 3);
    const fresh = tackPenaltyS(45, 315, 1, -1, 28);
    expect(light).toBe(fresh);
  });

  it("returnerer alltid hele, ikke-negative sekunder", () => {
    for (let delta = 0; delta <= 180; delta += 3) {
      const penalty = tackPenaltyS(0, delta, 1, -1, TWS);
      expect(Number.isInteger(penalty)).toBe(true);
      expect(penalty).toBeGreaterThanOrEqual(0);
    }
  });
});
