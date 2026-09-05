import { describe, expect, it } from "vitest";
import {
  computeFeasibleShareBounds,
  computeTrafficLight,
  type ThresholdRate,
  type TrafficLightInput,
} from "./traffic-light.js";

function base(overrides: Partial<TrafficLightInput> = {}): TrafficLightInput {
  return {
    complete: true,
    expectedMembers: 30,
    nF: 27,
    nInf: 3,
    nInc: 0,
    nErr: 0,
    feasibleShare: 0.9,
    inconclusiveShare: 0,
    thresholdRates: [],
    ...overrides,
  };
}

describe("computeFeasibleShareBounds — D10.4", () => {
  it("min = j/expectedMembers, max = (j + expectedMembers - k)/expectedMembers", () => {
    // k = 22 klassifisert, j = 2 gjennomførbare.
    const bounds = computeFeasibleShareBounds({ nF: 2, nInf: 20, nInc: 0, nErr: 0, expectedMembers: 30 });
    expect(bounds.min).toBeCloseTo(2 / 30);
    expect(bounds.max).toBeCloseTo((2 + 30 - 22) / 30);
  });

  it("min === max === feasibleShare-lik andel når alt er klassifisert", () => {
    const bounds = computeFeasibleShareBounds({ nF: 27, nInf: 3, nInc: 0, nErr: 0, expectedMembers: 30 });
    expect(bounds.min).toBeCloseTo(27 / 30);
    expect(bounds.max).toBeCloseTo(27 / 30);
  });
});

describe("computeTrafficLight — §4.2.3-tabellen, første treff vinner", () => {
  it("rad 1: nF+nInf===0 (bare inkonklusiv/feil) -> gul/inkonklusiv", () => {
    const result = computeTrafficLight(
      base({ nF: 0, nInf: 0, nInc: 25, nErr: 5, feasibleShare: null, inconclusiveShare: 25 / 30 }),
    );
    expect(result.light.color).toBe("gul");
    expect(result.light.reason).toBe("inkonklusiv");
  });

  it("rad 2: inconclusiveShare > 0,2 -> gul/inkonklusiv", () => {
    const result = computeTrafficLight(
      base({ nF: 20, nInf: 3, nInc: 7, nErr: 0, feasibleShare: 20 / 23, inconclusiveShare: 7 / 30 }),
    );
    expect(result.light.color).toBe("gul");
    expect(result.light.reason).toBe("inkonklusiv");
  });

  it("rad 3: nF < 12 -> gul/tynt-utvalg", () => {
    const result = computeTrafficLight(
      base({ nF: 10, nInf: 1, nInc: 0, nErr: 0, feasibleShare: 10 / 11, inconclusiveShare: 0 }),
    );
    expect(result.light.color).toBe("gul");
    expect(result.light.reason).toBe("tynt-utvalg");
  });

  it("rad 4 (§3.2-nevnerregelen): nInc + nErr > expectedMembers/3 -> gul/usikkert-grunnlag", () => {
    // nF=14, nInf=5 (>=12, ok), nInc=6, nErr=5 -> nInc+nErr=11 > 10; inconclusiveShare=6/30=0.2 (ikke >0.2).
    const result = computeTrafficLight(
      base({ nF: 14, nInf: 5, nInc: 6, nErr: 5, feasibleShare: 14 / 19, inconclusiveShare: 0.2 }),
    );
    expect(result.light.color).toBe("gul");
    expect(result.light.reason).toBe("usikkert-grunnlag");
  });

  it("rad 5: s >= 0,9 og t >= 0,9 -> gronn", () => {
    const thresholdRates: readonly ThresholdRate[] = [{ id: "moerke", k: 27, n: 27 }];
    const result = computeTrafficLight(base({ nF: 27, nInf: 3, feasibleShare: 0.9, thresholdRates }));
    expect(result.light.color).toBe("gronn");
    expect(result.light.reason).toBeNull();
  });

  it("rad 6: s < 0,7 -> rod/andel", () => {
    const result = computeTrafficLight(
      base({ nF: 12, nInf: 10, nInc: 0, nErr: 8, feasibleShare: 12 / 22, inconclusiveShare: 0 }),
    );
    expect(result.light.color).toBe("rod");
    expect(result.light.reason).toBe("andel");
  });

  it("rad 7: 0,7 <= s < 0,9 -> gul/andel", () => {
    const result = computeTrafficLight(base({ nF: 20, nInf: 5, feasibleShare: 20 / 25 }));
    expect(result.light.color).toBe("gul");
    expect(result.light.reason).toBe("andel");
  });

  it("rad 8: s >= 0,9 og t < 0,9 -> gul/tid", () => {
    const thresholdRates: readonly ThresholdRate[] = [{ id: "moerke", k: 15, n: 20 }];
    const result = computeTrafficLight(base({ nF: 20, nInf: 2, feasibleShare: 20 / 22, thresholdRates }));
    expect(result.light.color).toBe("gul");
    expect(result.light.reason).toBe("tid");
  });

  it("aldri grønn før complete", () => {
    const result = computeTrafficLight(
      base({ complete: false, nF: 27, nInf: 3, feasibleShare: 0.9, thresholdRates: [{ id: "x", k: 27, n: 27 }] }),
    );
    expect(result.light.color).not.toBe("gronn");
  });

  it("beregner når ufullstendig og ingen sertifikat foreligger", () => {
    const result = computeTrafficLight(base({ complete: false, nF: 5, nInf: 1, nInc: 0, nErr: 0 }));
    expect(result.light.color).toBe("beregner");
    expect(result.light.kOfN).toEqual({ k: 6, n: 30 });
    expect(result.certificate).toBeNull();
  });
});

describe("sertifikater — kun i advarselsretning, deterministiske (D10.4)", () => {
  it("rod/andel sertifiseres IKKE av bounds.max alene når nInf er lite (nevneren til s er en annen — review-funn bølge 3)", () => {
    // nF=5, nInf=1, nInc=24: bounds.max = 5/30 < 0,7, men s ender ≥ 5/6.
    const r = computeTrafficLight({
      complete: false,
      expectedMembers: 30,
      nF: 5,
      nInf: 1,
      nInc: 24,
      nErr: 0,
      feasibleShare: 5 / 6,
      inconclusiveShare: 0.8,
      thresholdRates: [],
    });
    expect(r.certificate).toBeNull();
    expect(r.light.color).toBe("beregner");
  });

  it("rødt sertifikat motsies aldri av det endelige lyset (rødt dominerer gule rader — D11.4)", () => {
    // nF=5, nInf=22, nInc=2, nErr=1 (review-funn 1): underveis sertifisert rødt, endelig må også være rødt.
    const final = computeTrafficLight({
      complete: true,
      expectedMembers: 30,
      nF: 5,
      nInf: 22,
      nInc: 2,
      nErr: 1,
      feasibleShare: 5 / 27,
      inconclusiveShare: 2 / 30,
      thresholdRates: [{ id: "moerke", k: 2, n: 5 }],
    });
    expect(final.light).toMatchObject({ color: "rod", reason: "andel" });
  });

  it("rod/andel sertifiseres når nInf > 0,3·N (spec-formelen)", () => {
    const result = computeTrafficLight(base({ complete: false, nF: 2, nInf: 20, nInc: 0, nErr: 0 }));
    expect(result.light.color).toBe("rod");
    expect(result.light.reason).toBe("andel");
    expect(result.certificate).toEqual({ color: "rod", reason: "andel" });
  });

  it("gul/tid sertifiseres når terskelbrudd allerede garanterer t < 0,9 for enhver mulig nF_max", () => {
    const thresholdRates: readonly ThresholdRate[] = [{ id: "moerke", k: 5, n: 10 }];
    const result = computeTrafficLight(
      base({ complete: false, nF: 10, nInf: 0, nInc: 0, nErr: 0, thresholdRates }),
    );
    expect(result.certificate).toEqual({ color: "gul", reason: "tid" });
    expect(result.light.color).toBe("gul");
    expect(result.light.reason).toBe("tid");
  });

  it("intet sertifikat er noensinne grønt", () => {
    // Prøv å tvinge en gunstig situasjon før complete — skal likevel ikke gi certificate.
    const result = computeTrafficLight(
      base({ complete: false, nF: 27, nInf: 0, nInc: 0, nErr: 0, thresholdRates: [{ id: "x", k: 27, n: 27 }] }),
    );
    expect(result.certificate).toBeNull();
    expect(result.light.color).not.toBe("gronn");
  });
});

describe("sertifikat monotont — property-test over prefikser av en permutasjon", () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle<T>(items: readonly T[], rng: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const a = copy[i];
      const b = copy[j];
      if (a === undefined || b === undefined) continue;
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  }

  type Kind = "feasible-pass" | "feasible-fail" | "infeasible" | "inconclusive" | "error";

  // 30 medlemmer: 5 gjennomførbare (2 består terskelen, 3 ikke), 22 ugjennomførbare (garanterer rad 6/sertifikat rod),
  // 2 inkonklusive, 1 feil. bounds.max ved fullt sett = (5+30-30)/30 = 5/30 ≈ 0,167 < 0,7 — sertifiseres garantert
  // underveis siden bounds.max er ikke-økende i antall klassifiserte (se traffic-light.ts's toppkommentar).
  const FINAL: readonly Kind[] = [
    ...Array.from({ length: 2 }, () => "feasible-pass" as const),
    ...Array.from({ length: 3 }, () => "feasible-fail" as const),
    ...Array.from({ length: 22 }, () => "infeasible" as const),
    ...Array.from({ length: 2 }, () => "inconclusive" as const),
    ...Array.from({ length: 1 }, () => "error" as const),
  ];

  function tally(prefix: readonly Kind[]): TrafficLightInput {
    const nF = prefix.filter((k) => k === "feasible-pass" || k === "feasible-fail").length;
    const nInf = prefix.filter((k) => k === "infeasible").length;
    const nInc = prefix.filter((k) => k === "inconclusive").length;
    const nErr = prefix.filter((k) => k === "error").length;
    const passing = prefix.filter((k) => k === "feasible-pass").length;
    return {
      complete: prefix.length === FINAL.length,
      expectedMembers: FINAL.length,
      nF,
      nInf,
      nInc,
      nErr,
      feasibleShare: nF + nInf === 0 ? null : nF / (nF + nInf),
      inconclusiveShare: nInc / FINAL.length,
      thresholdRates: nF === 0 ? [] : [{ id: "moerke", k: passing, n: nF }],
    };
  }

  for (let seed = 1; seed <= 10; seed++) {
    it(`seed ${seed}: sertifikatet tilbakekalles aldri, aldri grønt før complete`, () => {
      const order = shuffle(FINAL, mulberry32(seed));
      let certifiedOnce = false;
      let lastMaxBound = 1;
      for (let len = 1; len <= order.length; len++) {
        const prefix = order.slice(0, len);
        const input = tally(prefix);
        const bounds = computeFeasibleShareBounds(input);
        // bounds.max er ikke-økende etter hvert som flere klassifiseres.
        expect(bounds.max).toBeLessThanOrEqual(lastMaxBound + 1e-9);
        lastMaxBound = bounds.max;

        const result = computeTrafficLight(input);
        if (!input.complete) {
          expect(result.light.color).not.toBe("gronn");
          if (result.certificate !== null) {
            certifiedOnce = true;
          } else if (certifiedOnce) {
            throw new Error(`seed ${seed}, len ${len}: sertifikat tilbakekalt (beregner igjen)`);
          }
        }
      }
      // Med 22 av 30 ugjennomførbare skal sertifikatet faktisk utløses en gang før slutt.
      expect(certifiedOnce).toBe(true);
      // …og det endelige lyset skal ha samme farge som sertifikatet (aldri mykes).
      const finalResult = computeTrafficLight(tally(order));
      expect(finalResult.light.color).toBe("rod");
    });
  }
});
