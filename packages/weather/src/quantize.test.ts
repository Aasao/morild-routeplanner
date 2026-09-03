import { describe, expect, it } from "vitest";
import {
  compactToRaw,
  computeAngleParams,
  computeLinearParams,
  decodeAngleDeg,
  decodeLinear,
  encodeAngleDeg,
  encodeLinear,
  maxCompactIndex,
  rawToCompact,
  SENTINEL_RAW_VALUE,
} from "./quantize.js";

describe("kompakt-indeks / sentinel-hull (§9.6, §9.9)", () => {
  it("8-bit: hullet faller sammen med toppkoden — ingen renummerering under 255", () => {
    for (let ci = 0; ci <= maxCompactIndex(8); ci++) {
      expect(compactToRaw(ci)).toBe(ci);
    }
    expect(maxCompactIndex(8)).toBe(254);
  });

  it("10-bit: koder hopper over 255, men bruker hele resten av rommet", () => {
    expect(compactToRaw(254)).toBe(254);
    expect(compactToRaw(255)).toBe(256);
    expect(maxCompactIndex(10)).toBe(1022);
    expect(compactToRaw(1022)).toBe(1023);
  });

  it("rawToCompact er den eksakte inversen av compactToRaw for begge bit-bredder", () => {
    for (const bits of [8, 10] as const) {
      for (let ci = 0; ci <= maxCompactIndex(bits); ci++) {
        const raw = compactToRaw(ci);
        expect(raw).not.toBe(SENTINEL_RAW_VALUE);
        expect(rawToCompact(raw)).toBe(ci);
      }
    }
  });

  /**
   * Bevis (§9.6, §17 pkt. 10, §19 "sentinel-hull, forent"): rå byteverdi
   * 255 kan ALDRI produseres av `encodeLinear` for en gyldig kildeverdi,
   * verken 8-bit eller 10-bit — uansett hvor i det gyldige verdiområdet
   * kilden ligger. Dette er selve garantien `tools/weather-pack`s tidligere,
   * ureconsilierte `computeScaleOffset` (toppkode `2^bits-2` uavhengig av
   * bit-bredde) IKKE ga for 10-bit (§19-notatet 2026-09-03) — testen sveiper
   * HELE det representerbare området (alle kompakte indekser, ikke bare et
   * fåtall stikkprøver) for begge bit-bredder, og feiler høyt hvis noen
   * fremtidig endring i `computeLinearParams`/`encodeLinear` gjeninnfører
   * kollisjonen.
   */
  it("encodeLinear produserer aldri rå 255 for NOEN gyldig verdi i [lo,hi], for både 8- og 10-bit", () => {
    for (const bits of [8, 10] as const) {
      const params = computeLinearParams(0, 100, bits, "nearest");
      const steps = maxCompactIndex(bits) + 1; // antall gyldige kompakte indekser
      for (let ci = 0; ci < steps; ci++) {
        const value = params.offset + ci * (params.scale === 0 ? 0 : params.scale);
        expect(encodeLinear(value, params)).not.toBe(SENTINEL_RAW_VALUE);
      }
      // Endepunktene eksplisitt, i tillegg til sveipet over.
      expect(encodeLinear(0, params)).not.toBe(SENTINEL_RAW_VALUE);
      expect(encodeLinear(100, params)).not.toBe(SENTINEL_RAW_VALUE);
    }
  });
});

describe("lineær kanal — rundtur", () => {
  it("encode(255-verdien) produserer aldri rå 255 for en gyldig verdi (§9.6, §17 pkt. 10)", () => {
    const params = computeLinearParams(0, 20, 8, "nearest");
    for (let v = 0; v <= 20; v += 0.01) {
      expect(encodeLinear(v, params)).not.toBe(SENTINEL_RAW_VALUE);
    }
  });

  it("undefined/NaN koder til sentinel, sentinel dekoder til undefined", () => {
    const params = computeLinearParams(-10, 10, 8, "nearest");
    expect(encodeLinear(undefined, params)).toBe(SENTINEL_RAW_VALUE);
    expect(encodeLinear(Number.NaN, params)).toBe(SENTINEL_RAW_VALUE);
    expect(decodeLinear(SENTINEL_RAW_VALUE, params)).toBeUndefined();
  });

  it("nearest: rundtur ligger innenfor et halvt trinn", () => {
    const params = computeLinearParams(0, 30, 8, "nearest");
    for (const v of [0, 3.3, 7.77, 15, 22.1, 29.99, 30]) {
      const decoded = decodeLinear(encodeLinear(v, params), params)!;
      expect(Math.abs(decoded - v)).toBeLessThanOrEqual(params.scale / 2 + 1e-9);
    }
  });

  it("degenerert område (lo === hi) gir eksakt, feilfri dekoding", () => {
    const params = computeLinearParams(4.2, 4.2, 8, "nearest");
    expect(params.scale).toBe(0);
    for (const v of [4.2, 4.1999, 4.2001]) {
      expect(decodeLinear(encodeLinear(v, params), params)).toBe(4.2);
    }
  });

  it("verdier utenfor [lo,hi] klippes til nærmeste ende, kastes ikke", () => {
    const params = computeLinearParams(0, 10, 8, "nearest");
    expect(decodeLinear(encodeLinear(-5, params), params)).toBeCloseTo(0, 6);
    expect(decodeLinear(encodeLinear(50, params), params)).toBeCloseTo(10, 6);
  });
});

describe("Hs — §9.3, konservativ retning (opp), aldri mildere enn sannheten", () => {
  it("decode(encode(hs)) >= hs for et representativt utvalg, inkl. grenseverdier", () => {
    const params = computeLinearParams(0, 12, 8, "up");
    const maxHsM = 3.5; // typisk boat.maxHsM-grenseverdi i tester
    const values = [
      0, 0.01, 0.5, 1.0, 1.234, 2.999, maxHsM, maxHsM - 1e-9, maxHsM + 1e-9,
      3.5, 7.777, 11.999, 12,
    ];
    for (const hs of values) {
      const decoded = decodeLinear(encodeLinear(hs, params), params)!;
      expect(decoded).toBeGreaterThanOrEqual(hs - 1e-12);
    }
  });

  it("property: for 500 tilfeldige verdier i [0,12] holder decode(encode(hs)) >= hs, uansett bit-bredde", () => {
    for (const bits of [8, 10] as const) {
      const params = computeLinearParams(0, 12, bits, "up");
      let seed = 12345;
      const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 0; i < 500; i++) {
        const hs = rnd() * 12;
        const decoded = decodeLinear(encodeLinear(hs, params), params)!;
        expect(decoded).toBeGreaterThanOrEqual(hs - 1e-12);
      }
    }
  });
});

describe("Tp — §9.5, konservativ retning ned (låst logikk, umålt terskel, §9.8)", () => {
  it("decode(encode(tp)) <= tp for et representativt utvalg", () => {
    const params = computeLinearParams(0, 25, 8, "down");
    for (const tp of [0, 3.3, 6.0, 6.001, 12.5, 24.999, 25]) {
      const decoded = decodeLinear(encodeLinear(tp, params), params)!;
      expect(decoded).toBeLessThanOrEqual(tp + 1e-12);
    }
  });
});

describe("vinkelkanal (bølgeretning) — wraparound, sentinel for manglende retning", () => {
  it("kjente vinkler rundtur uten drift ved 0/360-grensen", () => {
    const params = computeAngleParams(8);
    for (const deg of [0, 359.9, 180, 90, 270, 0.05]) {
      const decoded = decodeAngleDeg(encodeAngleDeg(deg, params), params)!;
      const diff = Math.min(Math.abs(decoded - deg), 360 - Math.abs(decoded - deg));
      expect(diff).toBeLessThanOrEqual(params.scale / 2 + 1e-9);
    }
  });

  it("manglende retning (undefined) koder til sentinel og dekoder til undefined", () => {
    const params = computeAngleParams(8);
    expect(encodeAngleDeg(undefined, params)).toBe(SENTINEL_RAW_VALUE);
    expect(decodeAngleDeg(SENTINEL_RAW_VALUE, params)).toBeUndefined();
  });

  it("negative og >360-vinkler normaliseres før koding", () => {
    const params = computeAngleParams(8);
    const a = decodeAngleDeg(encodeAngleDeg(-10, params), params)!;
    const b = decodeAngleDeg(encodeAngleDeg(350, params), params)!;
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });
});
