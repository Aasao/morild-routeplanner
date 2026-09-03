/**
 * **Ikke lenger en lokal implementasjon — tester nå den delte sannheten**
 * (`docs/specs/vaerpakker.md` §19, endringslogg 2026-09-03: "weather-pack
 * bytter til @morild/weather"). Denne fila var opprinnelig skrevet mot
 * `tools/weather-pack`s egen midlertidige `quantize.ts`/`format-contract.ts`
 * (`TODO: erstattes av @morild/weather`, se README). De to filene er nå
 * slettet — testene under er beholdt UENDRET i sak (samme navn, samme
 * scenarioer), kun importen er byttet, slik at denne fila nå er weather-
 * packs egen regresjonsdekning av `@morild/weather`s produsent-side-API
 * (encode/vaktbånd/sentinel/Hs/retningskonvensjoner), ikke en test av en
 * duplikatimplementasjon.
 */
import { describe, expect, it } from "vitest";
import {
  bilinearInterpolateComponent,
  buildHsParams,
  computeMaxDecodeErrorKn,
  computeScaleOffset,
  currentComponentsToSample,
  decodeValue,
  encodeValue,
  linearInterpolateComponentInTime,
  twsExceedsHardLimitWithGuardBand,
  verifiesSentinelNeverCollides,
  windComponentsToSample,
  windSampleToComponents,
  type QuantizationParams,
} from "@morild/weather";

// --- §3 punkt 1-3: kjente retningskonvensjonsverdier ------------------------

describe("§3 — vind FRA: u/v <-> (speedKn, fromDeg)", () => {
  it("1. Nordavind 10 kn (fromDeg=0) gir (u,v)=(0,-10) og vice versa", () => {
    const { u, v } = windSampleToComponents(10, 0);
    expect(u).toBeCloseTo(0);
    expect(v).toBeCloseTo(-10);
    const sample = windComponentsToSample(0, -10);
    expect(sample.speedKn).toBeCloseTo(10);
    expect(sample.fromDeg).toBeCloseTo(0);
  });

  it("2. Østavind 10 kn (fromDeg=90) gir (u,v)=(-10,0)", () => {
    const { u, v } = windSampleToComponents(10, 90);
    expect(u).toBeCloseTo(-10);
    expect(v).toBeCloseTo(0, 10);
    const sample = windComponentsToSample(-10, 0);
    expect(sample.speedKn).toBeCloseTo(10);
    expect(sample.fromDeg).toBeCloseTo(90);
  });

  it("dekker alle fire himmelretninger rundtur (rundtripp-konsistens)", () => {
    for (const fromDeg of [0, 90, 180, 270, 45, 315]) {
      const { u, v } = windSampleToComponents(12, fromDeg);
      const back = windComponentsToSample(u, v);
      expect(back.speedKn).toBeCloseTo(12);
      expect(back.fromDeg).toBeCloseTo(fromDeg);
    }
  });

  it("3. Nordgående strøm 2 kn (v=2,u=0) er MOT nord — ingen FRA-konvertering brukes på strøm", () => {
    const sample = currentComponentsToSample(0, 2);
    expect(sample).toEqual({ u: 0, v: 2 });
    // Hadde noen ved en feil brukt vind-formelen på dette (den klassiske
    // ombyttingsbuggen §3 advarer mot), ville den gitt fromDeg=180 (FRA
    // nord) — men CurrentSample har ikke noe fromDeg-felt i det hele tatt,
    // så det er en kompileringsfeil å prøve. Vi verifiserer likevel at
    // formelen ville gitt et ANNET tall enn den rene komponenten, for å
    // dokumentere hvorfor skillet finnes:
    const wouldBeIfMisused = windComponentsToSample(0, 2).fromDeg;
    expect(wouldBeIfMisused).toBe(180);
    expect(sample.v).not.toBe(wouldBeIfMisused);
  });
});

describe("§3 punkt 4-5 — interpolasjon skjer i komponentrom, aldri på fromDeg/speed direkte", () => {
  it("4. bilineær rom-interpolasjon av vind interpolerer komponenter", () => {
    // Fire hjørner: alle nordavind men ulik styrke -> komponentinterpolasjon
    // av (u,v)=(0,-speed) gir korrekt midtverdi uten vinkelproblemer.
    const u = bilinearInterpolateComponent(0, 0, 0, 0, 0.5, 0.5);
    const v = bilinearInterpolateComponent(-10, -20, -10, -20, 0.5, 0.5);
    expect(u).toBeCloseTo(0);
    expect(v).toBeCloseTo(-15);
  });

  it("4b. interpolasjon nær 360/0-grensen gir korrekt svar via komponenter (der vinkel-lineær ville feilet)", () => {
    // To hjørner: fromDeg=350 og fromDeg=10, begge 10 kn. Naiv vinkel-
    // gjennomsnitt ((350+10)/2=180) ville gitt SØRAVIND — helt feil retning.
    // Komponentveien gir riktig svar: nær nord (fromDeg ~ 0).
    const a = windSampleToComponents(10, 350);
    const b = windSampleToComponents(10, 10);
    const u = bilinearInterpolateComponent(a.u, b.u, a.u, b.u, 0.5, 0.5);
    const v = bilinearInterpolateComponent(a.v, b.v, a.v, b.v, 0.5, 0.5);
    const result = windComponentsToSample(u, v);
    // Nær 0/360-grensen kan avrunding gi enten en liten positiv vinkel
    // (f.eks. 0,0001) eller en vinkel like under 360 (f.eks. 359,9999) —
    // begge er "riktig nord", bare på hver sin side av wrap-around-punktet.
    // Assertet mot avstanden til 0 (mod 360), ikke mot en ensidig grense.
    const distanceFromNorth = Math.min(result.fromDeg, 360 - result.fromDeg);
    expect(distanceFromNorth).toBeLessThan(10);
  });

  it("5. tidsinterpolasjon skjer i komponentrom; konvertering til WindSample skjer etter", () => {
    const t1 = windSampleToComponents(10, 0); // nord
    const t2 = windSampleToComponents(10, 90); // øst, samme styrke
    const u = linearInterpolateComponentInTime(t1.u, t2.u, 0.5);
    const v = linearInterpolateComponentInTime(t1.v, t2.v, 0.5);
    const mid = windComponentsToSample(u, v);
    expect(mid.speedKn).toBeGreaterThan(0);
    // fasit: u=(0-10)/2=-5, v=(-10+0)/2=-5 -> speed=hypot(5,5)=7.07, fromDeg=45
    expect(mid.speedKn).toBeCloseTo(Math.hypot(5, 5), 3);
    expect(mid.fromDeg).toBeCloseTo(45, 3);
  });
});

// --- §9.1/§9.9: skala/offset og encode/decode -------------------------------

describe("computeScaleOffset / encodeValue / decodeValue", () => {
  it("koder min til 0 og max til maxRaw (254 for 8-bit), aldri til 255 (sentinel)", () => {
    const { scale, offset } = computeScaleOffset({ min: 0, max: 25.4, bitsPerSample: 8 });
    const params: QuantizationParams = { bitsPerSample: 8, scale, offset, roundingMode: "nearest", sentinelRawValue: 255 };
    expect(encodeValue(0, params)).toBe(0);
    expect(encodeValue(25.4, params)).toBe(254);
  });

  it("degenererer trygt til scale=0 når min===max (flat subflis) — reconsiliert 2026-09-03 (§19)", () => {
    // Weather-packs opprinnelige, nå slettede lokale `computeScaleOffset`
    // ga `scale=1` her (vilkårlig ikke-null-skritt for et felt uten
    // spenn). `@morild/weather`s `computeLinearParams` gir bevisst
    // `scale=0`: dekoding blir da EKSAKT `offset` for enhver gyldig
    // kompakt indeks — null kvantiseringsfeil, ikke bare et lite ett-trinns
    // avvik (`package-format.ts`s docstring, golden-bro-testens krav om
    // `maxDecodeErrorKn=0` for konstante felt). Dette er den ene sannheten
    // nå — testen er oppdatert til å bevise DEN, ikke den forkastede.
    const { scale, offset } = computeScaleOffset({ min: 5, max: 5, bitsPerSample: 8 });
    expect(scale).toBe(0);
    expect(offset).toBe(5);
  });

  it("kaster hvis max < min", () => {
    expect(() => computeScaleOffset({ min: 5, max: 1, bitsPerSample: 8 })).toThrow();
  });

  it("decode(encode(x)) er nær x for 'nearest' innenfor ett halvt trinn", () => {
    const { scale, offset } = computeScaleOffset({ min: 0, max: 30, bitsPerSample: 8 });
    const params: QuantizationParams = { bitsPerSample: 8, scale, offset, roundingMode: "nearest", sentinelRawValue: 255 };
    for (const x of [0, 3.3, 15, 29.9, 30]) {
      const decoded = decodeValue(encodeValue(x, params), params);
      expect(Math.abs((decoded ?? NaN) - x)).toBeLessThanOrEqual(scale / 2 + 1e-9);
    }
  });

  it("dekoder rå sentinelverdi 255 som undefined for et hvilket som helst 8-bit felt (§17 pkt. 10)", () => {
    const params: QuantizationParams = { bitsPerSample: 8, scale: 1, offset: 0, roundingMode: "nearest", sentinelRawValue: 255 };
    expect(decodeValue(255, params)).toBeUndefined();
  });
});

// --- §9.3: Hs skal ALDRI dekodes mildere enn kilden -------------------------

describe("§9.3 — Hs: decode(encode(hs)) >= hs, alltid", () => {
  it("holder for et representativt utvalg, inkl. grenseverdier", () => {
    const min = 0;
    const max = 4.0; // f.eks. boat.maxHsM
    const params = buildHsParams(min, max, 8);
    const testValues = [0, 0.01, 1.2345, 2.0, 3.9999, 4.0, max - 1e-6];
    for (const hs of testValues) {
      const decoded = decodeValue(encodeValue(hs, params), params);
      expect(decoded).toBeDefined();
      expect(decoded as number).toBeGreaterThanOrEqual(hs - 1e-9);
    }
  });

  it("holder også for verdier like under en kvantiseringsterskel (fine trinn)", () => {
    const params = buildHsParams(0, 1.0, 8); // fint trinn ~1/254
    const step = params.scale;
    const justBelowThreshold = step * 10.0001; // like over et rå-trinn
    const decoded = decodeValue(encodeValue(justBelowThreshold, params), params);
    expect(decoded as number).toBeGreaterThanOrEqual(justBelowThreshold - 1e-9);
  });

  it("roundingMode er alltid 'up', uansett hva som sendes inn som argument", () => {
    const params = buildHsParams(0, 10, 10);
    expect(params.roundingMode).toBe("up");
    expect(params.bitsPerSample).toBe(10);
  });
});

// --- §9.5: TWS-vaktbånd ------------------------------------------------------

describe("§9.5 — TWS-vaktbånd", () => {
  it("computeMaxDecodeErrorKn = hypot(uScale/2, vScale/2) (§9.5 punkt 2, review-funn 3: konsolidert til hypot-varianten 2026-09-03, samme utledning som field.ts::windLayerMaxDecodeErrorKn)", () => {
    expect(computeMaxDecodeErrorKn(0.2, 0.2)).toBeCloseTo(Math.hypot(0.1, 0.1), 10);
    expect(computeMaxDecodeErrorKn(0.2, 0.4)).toBeCloseTo(Math.hypot(0.1, 0.2), 10); // uavhengige per-kanal-feil, ikke lenger maks av kanalene
  });

  it("forkaster en node der dekodet TWS er INNENFOR vaktbåndet under selve maxTwsKn, ikke bare over den", () => {
    const maxTwsKn = 30;
    const maxDecodeErrorKn = 1.5;
    // 29 kn er UNDER den nakne grensen (30), men innenfor vaktbåndet (30-1.5=28.5).
    expect(twsExceedsHardLimitWithGuardBand(29, maxTwsKn, maxDecodeErrorKn)).toBe(true);
    // 28 kn er trygt under vaktbåndet.
    expect(twsExceedsHardLimitWithGuardBand(28, maxTwsKn, maxDecodeErrorKn)).toBe(false);
  });

  it("maxDecodeErrorKn=0 gir bit-identisk adferd med den nakne sammenligningen", () => {
    expect(twsExceedsHardLimitWithGuardBand(30.01, 30, 0)).toBe(true);
    expect(twsExceedsHardLimitWithGuardBand(30, 30, 0)).toBe(false);
    expect(twsExceedsHardLimitWithGuardBand(29.99, 30, 0)).toBe(false);
  });
});

// --- §9.6: sentinelverdi 255 -------------------------------------------------

describe("§9.6 — sentinelverdi 255 kolliderer aldri med en gyldig kildeverdi", () => {
  it("verifiserer at hele subflisens verdiområde koder til <=254", () => {
    const { scale, offset } = computeScaleOffset({ min: 0, max: 25, bitsPerSample: 8 });
    const params: QuantizationParams = { bitsPerSample: 8, scale, offset, roundingMode: "nearest", sentinelRawValue: 255 };
    const values = Array.from({ length: 100 }, (_, i) => (i / 99) * 25);
    expect(verifiesSentinelNeverCollides(values, params)).toBe(true);
  });
});
