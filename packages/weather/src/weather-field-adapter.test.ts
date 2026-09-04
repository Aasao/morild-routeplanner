/**
 * `toWeatherField`s `isControl`-overstyring (fase 3 bølge 2C,
 * `docs/specs/vaerpakker.md` §9.1 pkt. 4 / ADR-0005). Se
 * `weather-field-adapter.ts::ToWeatherFieldOptions.isControl`s
 * toppkommentar for hvorfor dette trengs: en progressiv worker-pool
 * dekoder ETT medlem per kall og bygger da en ett-elements
 * `windMembers`-array PER kall — uten overstyringen ville ethvert medlem
 * blitt tolket som kontrollen fordi det alltid står på indeks 0 i sin egen
 * array.
 */
import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import { buildLayer, type LayerGeometry } from "./package-format.js";
import { buildLayerLookup } from "./field.js";
import {
  MEMBER_HORIZON_S,
  compositeWeatherField,
  toWeatherField,
  type WeatherPackage,
} from "./weather-field-adapter.js";

const HEADER: PackageHeader = Object.freeze({
  formatVersion: "1.0.0",
  producedAt: "2026-09-03T00:00:00Z",
  model: "TEST",
  init: "2026-09-03T00:00:00Z",
  resolution: "test",
  sourceStatus: { status: "ok" as const },
});

function geometry(overrides: Partial<LayerGeometry> = {}): LayerGeometry {
  return {
    latMin: 58,
    lonMin: 10,
    latStepDeg: 0.1,
    lonStepDeg: 0.1,
    nodesLat: 4,
    nodesLon: 4,
    tileNodes: 32,
    t0S: 0,
    dtS: 3600,
    timeSteps: 73, // t = 0..72 t
    ...overrides,
  };
}

function buildUV(g: LayerGeometry) {
  const u = buildLayer({
    sample: () => 5,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const v = buildLayer({
    sample: () => 0,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  return { u: buildLayerLookup(u), v: buildLayerLookup(v) };
}

describe("toWeatherField — isControl-overstyring", () => {
  it("uten overstyring: memberIndex 0 får full horisont (uendret standardoppførsel)", () => {
    const g = geometry();
    const pkg: WeatherPackage = { windMembers: [buildUV(g)], windHeader: HEADER };
    const field = toWeatherField(pkg, 0, { departEpochS: 0 });
    expect(field.validToS).toBe(72 * 3600);
  });

  it("isControl:false trunkerer til 48 t-medlemsgrensen SELV på indeks 0 (ett-elements worker-pakke)", () => {
    const g = geometry();
    const pkg: WeatherPackage = { windMembers: [buildUV(g)], windHeader: HEADER };
    const field = toWeatherField(pkg, 0, { departEpochS: 0, isControl: false });
    expect(field.validToS).toBe(MEMBER_HORIZON_S);
    expect(field.validToS).toBeLessThan(72 * 3600);
  });

  it("isControl:true gir full horisont selv om memberIndex ikke er 0 (symmetri-sjekk)", () => {
    const g = geometry();
    const pkg: WeatherPackage = {
      windMembers: [buildUV(g), buildUV(g)],
      windHeader: HEADER,
    };
    const field = toWeatherField(pkg, 1, { departEpochS: 0, isControl: true });
    expect(field.validToS).toBe(72 * 3600);
  });
});

/**
 * `compositeWeatherField` — review-funn fase 3 bølge 2, funn 2: to
 * ikke-overlappende 2°-fliser (delt kant ved lat 58, akkurat som den ekte
 * Skjæløy→Skagen-pakkens 5_28/5_29-fliser ved 58°N) skal sys sammen til ETT
 * felt der posisjonen avgjør hvilken flis som svarer.
 */
function buildUVWithSpeed(g: LayerGeometry, uConst: number, vConst: number) {
  const u = buildLayer({
    sample: () => uConst,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const v = buildLayer({
    sample: () => vConst,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  return { u: buildLayerLookup(u), v: buildLayerLookup(v) };
}

describe("compositeWeatherField", () => {
  // Sørflis: 56–58°N. Nordflis: 58–60°N. Delt kant på 58°N (nodesLat regnet
  // slik at 58 er nøyaktig siste/første node i hver flis, som i den ekte
  // 2°-rutenettoppløsningen).
  const southGeometry = geometry({ latMin: 56, nodesLat: 21, timeSteps: 25 }); // 24 t
  const northGeometry = geometry({ latMin: 58, nodesLat: 21, timeSteps: 49 }); // 48 t

  function buildFields() {
    const southPkg: WeatherPackage = {
      windMembers: [buildUVWithSpeed(southGeometry, 3, 0)],
      windHeader: HEADER,
    };
    const northPkg: WeatherPackage = {
      windMembers: [buildUVWithSpeed(northGeometry, 8, 0)],
      windHeader: { ...HEADER, model: "TEST-NORTH" },
    };
    const south = toWeatherField(southPkg, 0, { departEpochS: 0 });
    const north = toWeatherField(northPkg, 0, { departEpochS: 0 });
    return { south, north };
  }

  it("svarer med sørflisens felt for et punkt kun sørflisen dekker", () => {
    const { south, north } = buildFields();
    const composite = compositeWeatherField([south, north]);
    const sample = composite.wind(57, 10, 0);
    expect(sample).toEqual(south.wind(57, 10, 0));
    expect(sample?.speedKn).toBeCloseTo(3, 0);
  });

  it("svarer med nordflisens felt for et punkt kun nordflisen dekker", () => {
    const { south, north } = buildFields();
    const composite = compositeWeatherField([south, north]);
    const sample = composite.wind(59, 10, 0);
    expect(sample).toEqual(north.wind(59, 10, 0));
    expect(sample?.speedKn).toBeCloseTo(8, 0);
  });

  it("gir undefined for et punkt UTENFOR begge fliser — ærlig degradering, aldri stille stopp", () => {
    const { south, north } = buildFields();
    const composite = compositeWeatherField([south, north]);
    expect(composite.wind(61, 10, 0)).toBeUndefined();
  });

  it("dekker den delte kanten (58°N) — begge fliser har noden, komposittfeltet svarer der", () => {
    const { south, north } = buildFields();
    const composite = compositeWeatherField([south, north]);
    expect(composite.wind(58, 10, 0)).toBeDefined();
  });

  it("maxTwsKn/maxCurrentKn/maxDecodeErrorKn er maksimum over fliser (konservativ skranke uansett hvor et punkt havner)", () => {
    const { south, north } = buildFields();
    const composite = compositeWeatherField([south, north]);
    expect(composite.maxTwsKn).toBe(Math.max(south.maxTwsKn, north.maxTwsKn));
    expect(composite.maxCurrentKn).toBe(Math.max(south.maxCurrentKn, north.maxCurrentKn));
    expect(composite.maxDecodeErrorKn).toBe(Math.max(south.maxDecodeErrorKn, north.maxDecodeErrorKn));
  });

  it("validFromS/validToS er unionen av flisenes tidsvinduer", () => {
    const { south, north } = buildFields();
    const composite = compositeWeatherField([south, north]);
    expect(composite.validFromS).toBe(Math.min(south.validFromS, north.validFromS));
    expect(composite.validToS).toBe(Math.max(south.validToS, north.validToS));
    expect(composite.validToS).toBe(north.validToS); // nordflisen har lengst horisont her
  });

  it("header er den representative (første) flisens header", () => {
    const { south, north } = buildFields();
    const composite = compositeWeatherField([south, north]);
    expect(composite.header).toBe(south.header);
    expect(composite.header).not.toBe(north.header);
  });

  it("ett enkelt felt gis tilbake uendret (ingen sammensying nødvendig)", () => {
    const { south } = buildFields();
    expect(compositeWeatherField([south])).toBe(south);
  });

  it("kaster på tom liste — programmeringsfeil hos kalleren, ikke en gyldig 'ingen dekning'-tilstand", () => {
    expect(() => compositeWeatherField([])).toThrow();
  });
});

describe("maxDecodeErrorKnAt (D7.3/D7.4, koordinering fase 3 bølge 3B)", () => {
  const CERTIFIED_HEADER = Object.freeze({
    ...HEADER,
    certificate: {
      maxDecodeErrorKn: 999, // bevisst mye høyere enn det beregnede — beviser at sertifikatet ALDRI kan senke båndet, kun heve det
      referenceInit: HEADER.init,
      verifiedAt: HEADER.producedAt,
      clippedSamples: 0,
    },
  });

  it("er undefined nøyaktig der wind() er undefined (samme dekningslogikk)", () => {
    const g = geometry();
    const pkg: WeatherPackage = { windMembers: [buildUV(g)], windHeader: HEADER };
    const field = toWeatherField(pkg, 0, { departEpochS: 0 });
    expect(field.wind(58, 10, 0)).toBeDefined();
    expect(field.maxDecodeErrorKnAt?.(58, 10, 0)).toBeDefined();
    expect(field.wind(58, 10, 1_000_000)).toBeUndefined(); // utenfor tidsvinduet
    expect(field.maxDecodeErrorKnAt?.(58, 10, 1_000_000)).toBeUndefined();
  });

  it("uten sertifikat: lik det beregnede maxDecodeErrorKn", () => {
    const g = geometry();
    const pkg: WeatherPackage = { windMembers: [buildUV(g)], windHeader: HEADER };
    const field = toWeatherField(pkg, 0, { departEpochS: 0 });
    expect(field.maxDecodeErrorKnAt?.(58, 10, 0)).toBe(field.maxDecodeErrorKn);
  });

  it("med sertifikat: maks(beregnet, sertifisert) — sertifikatet kan ALDRI undergrave det beregnede", () => {
    const g = geometry();
    const pkg: WeatherPackage = { windMembers: [buildUV(g)], windHeader: CERTIFIED_HEADER };
    const field = toWeatherField(pkg, 0, { departEpochS: 0 });
    expect(field.maxDecodeErrorKnAt?.(58, 10, 0)).toBe(
      Math.max(field.maxDecodeErrorKn, CERTIFIED_HEADER.certificate.maxDecodeErrorKn),
    );
    expect(field.maxDecodeErrorKnAt?.(58, 10, 0)).toBe(999);
  });

  it("compositeWeatherField: båndet kommer fra SAMME flis som vindsvaret, ikke en uavhengig skanning", () => {
    const southGeometry = geometry({ latMin: 56, nodesLat: 21, timeSteps: 25 });
    const northGeometry = geometry({ latMin: 58, nodesLat: 21, timeSteps: 49 });
    const southPkg: WeatherPackage = {
      windMembers: [buildUVWithSpeed(southGeometry, 3, 0)],
      windHeader: HEADER, // ubeskyttet — beregnet bånd
    };
    const northPkg: WeatherPackage = {
      windMembers: [buildUVWithSpeed(northGeometry, 8, 0)],
      windHeader: CERTIFIED_HEADER, // sertifisert — 999
    };
    const south = toWeatherField(southPkg, 0, { departEpochS: 0 });
    const north = toWeatherField(northPkg, 0, { departEpochS: 0 });
    const composite = compositeWeatherField([south, north]);

    // Et punkt kun sørflisen dekker: båndet skal være sørflisens (ikke 999).
    expect(composite.wind(57, 10, 0)).toBeDefined();
    expect(composite.maxDecodeErrorKnAt?.(57, 10, 0)).toBe(south.maxDecodeErrorKnAt?.(57, 10, 0));
    expect(composite.maxDecodeErrorKnAt?.(57, 10, 0)).not.toBe(999);

    // Et punkt KUN nordflisen dekker (utenfor sørflisens tidsvindu på t=48h, innenfor nordflisens): sertifisert bånd.
    expect(composite.wind(59, 10, 48 * 3600)).toBeDefined();
    expect(composite.maxDecodeErrorKnAt?.(59, 10, 48 * 3600)).toBe(999);
  });
});
