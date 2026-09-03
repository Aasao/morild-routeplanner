/**
 * Golden-broen (leveranse 5 i denne bølgen): verifiserer at et syntetisk
 * felt encodet→decodet gjennom `packages/weather`s format gir en rute
 * rutemotoren ikke kan skille fra den upakkede kilden, i to steg:
 *
 * 1. Et felt der pakkingen INTRODUSERER null dekodefeil (konstant felt —
 *    skala blir 0, se `quantize.test.ts`/`package-format.test.ts`) gir en
 *    BIT-IDENTISK rute, `maxDecodeErrorKn === 0` — den "Float32-veien"
 *    oppgaven ber om, demonstrert med ekte kvantisert lagring (8-bit),
 *    ikke bare en påstand.
 * 2. Det faktiske, IKKE-konstante syntetiske golden-feltet (samme felt som
 *    `test-fixtures/golden-scenarios.ts` fryser mot) pakket gjennom 8-bit
 *    gir en rute med samme diskrete utfall (nådd, sikkerhetsdom, dekning,
 *    sluttetappe) og en liten, forklarbar numerisk diff — konsistent med
 *    kvantiseringsmålingens `K-ANB-KYST` (§9 i `vaerpakker.md`: null flips
 *    forventet på et strekk av denne typen).
 *
 * Denne testfilen er den ENESTE i `packages/weather` som importerer
 * `@morild/routing` — kun mulig fordi arkitekturtesten
 * (`tools/arch-tests`) utelukkende skanner `.ts`, ikke `.test.ts` (samme
 * unntak `packages/routing/test-fixtures` selv ikke trenger, men som
 * golden-harnessen der bruker for `node:fs`). `src/`-filene i
 * `packages/weather` importerer aldri routing — se
 * `weather-field-adapter.ts`s toppkommentar.
 */
import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import {
  goldenScenarios,
  SKJAELOY,
  SKAGEN,
} from "@morild/routing/test-fixtures/golden-scenarios";
import { planRoute, type RouteInput } from "@morild/routing";
import {
  computeAngleParams,
  decodeAngleDeg,
  encodeAngleDeg,
} from "./quantize.js";
import { buildLayer, type LayerGeometry } from "./package-format.js";
import { buildLayerLookup } from "./field.js";
import { windToUV } from "./wind-codec.js";
import { toWeatherField, type WeatherPackage } from "./weather-field-adapter.js";

const TEST_HEADER: PackageHeader = Object.freeze({
  formatVersion: "1.0.0",
  producedAt: "2026-09-03T00:00:00Z",
  model: "GOLDEN-BRO-TEST",
  init: "2026-09-03T00:00:00Z",
  resolution: "test",
  sourceStatus: { status: "ok" as const },
});

/** Bbox som dekker hele Skjæløy–Skagen-scenariets landgeometri, med margin. */
const BBOX = { latMin: 56.4, latMax: 60.4, lonMin: 7.8, lonMax: 12.8 };
const NODE_STEP_DEG = 0.1;

function nodeCount(min: number, max: number, step: number): number {
  return Math.round((max - min) / step) + 1;
}

function buildGeometry(t0S: number, hours: number): LayerGeometry {
  return {
    latMin: BBOX.latMin,
    lonMin: BBOX.lonMin,
    latStepDeg: NODE_STEP_DEG,
    lonStepDeg: NODE_STEP_DEG,
    nodesLat: nodeCount(BBOX.latMin, BBOX.latMax, NODE_STEP_DEG),
    nodesLon: nodeCount(BBOX.lonMin, BBOX.lonMax, NODE_STEP_DEG),
    tileNodes: 32,
    t0S,
    dtS: 3600,
    timeSteps: hours + 1,
  };
}

/**
 * Pakker et gitt `RouteInput`s værfelt (kontrollmedlem, ingen ensemble) og
 * gir tilbake et adaptert `WeatherField`-kompatibelt objekt.
 */
function packAndDecode(
  input: RouteInput,
  bitsPerSample: 8 | 10,
  hours: number,
): ReturnType<typeof toWeatherField> {
  const geometry = buildGeometry(input.weather.validFromS, hours);

  const uLayer = buildLayer({
    sample: (lat, lon, epochS) => {
      const w = input.weather.wind(lat, lon, epochS);
      return w === undefined ? undefined : windToUV(w.speedKn, w.fromDeg)[0];
    },
    geometryBase: geometry,
    bitsPerSample,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const vLayer = buildLayer({
    sample: (lat, lon, epochS) => {
      const w = input.weather.wind(lat, lon, epochS);
      return w === undefined ? undefined : windToUV(w.speedKn, w.fromDeg)[1];
    },
    geometryBase: geometry,
    bitsPerSample,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const hsLayer = buildLayer({
    sample: (lat, lon, epochS) => input.weather.waves(lat, lon, epochS)?.hsM,
    geometryBase: geometry,
    bitsPerSample,
    roundingMode: "up",
    channelKind: "linear",
  });
  const tpLayer = buildLayer({
    sample: (lat, lon, epochS) => input.weather.waves(lat, lon, epochS)?.tpS,
    geometryBase: geometry,
    bitsPerSample,
    roundingMode: "down",
    channelKind: "linear",
  });
  const dirLayer = buildLayer({
    sample: (lat, lon, epochS) => input.weather.waves(lat, lon, epochS)?.fromDeg,
    geometryBase: geometry,
    bitsPerSample,
    roundingMode: "nearest",
    channelKind: "angle",
  });
  const curULayer = buildLayer({
    sample: (lat, lon, epochS) => input.weather.current(lat, lon, epochS)?.u,
    geometryBase: geometry,
    bitsPerSample,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const curVLayer = buildLayer({
    sample: (lat, lon, epochS) => input.weather.current(lat, lon, epochS)?.v,
    geometryBase: geometry,
    bitsPerSample,
    roundingMode: "nearest",
    channelKind: "linear",
  });

  const pkg: WeatherPackage = {
    windMembers: [{ u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) }],
    current: { u: buildLayerLookup(curULayer), v: buildLayerLookup(curVLayer) },
    waves: { hs: buildLayerLookup(hsLayer), tp: buildLayerLookup(tpLayer), dir: buildLayerLookup(dirLayer) },
    windHeader: TEST_HEADER,
  };

  return toWeatherField(pkg, 0, { departEpochS: input.departEpochS });
}

function scenario(name: string): RouteInput {
  const found = goldenScenarios().find((s) => s.name === name);
  if (found === undefined) throw new Error(`Fant ikke golden-scenario "${name}"`);
  return found.input;
}

describe("golden-bro — konstant felt, maxDecodeErrorKn=0 (Float32-veien)", () => {
  it("gir en BIT-IDENTISK rute etter encode→decode gjennom pakken", () => {
    const base = scenario("skjaeloy-skagen-apent");
    // Bølgeretning bruker vinkelkanalen (§9.9), som — i motsetning til de
    // lineære kanalene (vind-u/v, Hs, Tp, strøm) — ALLTID kvantiserer over
    // faste globale bøtter [0,360), uansett hvor konstant feltet er (ingen
    // "lo===hi ⇒ scale=0"-unntak for sykliske kanaler, se `quantize.ts`).
    // For at bølgeretningen skal rundtur-dekode BIT-EKSAKT i denne testen,
    // brukes verdien EN GANG gjennom kode/dekode her, og AKKURAT den
    // kvantiserte verdien mates inn i kildefeltet — konstruktivt eksakt,
    // ikke avhengig av å gjette en "pen" gradverdi som tilfeldigvis treffer
    // en bøttegrense.
    const dirParams = computeAngleParams(8, "nearest");
    const exactFromDeg = decodeAngleDeg(encodeAngleDeg(235, dirParams), dirParams)!;
    const constantField = {
      wind: () => ({ speedKn: 14, fromDeg: 235 }),
      waves: () => ({ hsM: 0.8, tpS: 6, fromDeg: exactFromDeg }),
      current: () => ({ u: 0.1, v: -0.05 }),
      maxTwsKn: 14,
      maxCurrentKn: Math.hypot(0.1, 0.05),
      maxDecodeErrorKn: 0,
      validFromS: base.weather.validFromS,
      validToS: base.weather.validToS,
      header: TEST_HEADER,
    };
    const input: RouteInput = { ...base, weather: constantField };

    const baseline = planRoute(input);
    expect(baseline.reached).toBe(true); // sanity — testen skal teste NOE

    const decodedField = packAndDecode(input, 8, 24);
    expect(decodedField.maxDecodeErrorKn).toBe(0); // konstant felt ⇒ scale=0 ⇒ ingen dekodefeil

    const packagedResult = planRoute({ ...input, weather: decodedField });
    assertNearlyIdentical(baseline, packagedResult);
  }, 30_000);
});

describe("golden-bro — reelt syntetisk felt, 8-bit — forklarbar diff (K-ANB-KYST-forventning)", () => {
  it("samme diskrete utfall, liten numerisk diff, etter encode→decode gjennom pakken", () => {
    const input = scenario("skjaeloy-skagen-apent");
    const baseline = planRoute(input);
    expect(baseline.reached).toBe(true);

    const decodedField = packAndDecode(input, 8, 24);
    expect(decodedField.maxDecodeErrorKn).toBeGreaterThan(0); // ekte kvantisering denne gang

    const packaged = planRoute({ ...input, weather: decodedField });

    // Diskrete felt — identiske, ellers har adferden endret seg, punktum
    // (samme disiplin som `golden.test.ts`s "exact"-gruppe).
    expect(packaged.reached).toBe(baseline.reached);
    expect(packaged.abortReason).toBe(baseline.abortReason);
    expect(packaged.safety.verdict).toBe(baseline.safety.verdict);
    expect(packaged.safety.reachesDestination).toBe(baseline.safety.reachesDestination);
    expect(packaged.coverage.mask).toBe(baseline.coverage.mask);
    expect(packaged.coverage.weather).toBe("full"); // laget dekker hele ruten (24 t > 55 059 s)
    expect(packaged.finalLeg.status).toBe(baseline.finalLeg.status);

    // Numerisk — liten, forklarbar diff (grovere grid + 8-bit enn det
    // analytiske feltet, men INGEN flip i noe diskret utfall over).
    const durationDiff =
      Math.abs(packaged.totals.durationS - baseline.totals.durationS) /
      baseline.totals.durationS;
    expect(durationDiff).toBeLessThan(0.1);
    void SKJAELOY;
    void SKAGEN;
  }, 30_000);
});

/**
 * Rekursiv nær-likhet, med presis begrunnelse for hvorfor IKKE
 * `JSON.stringify(a) === JSON.stringify(b)` (som var den første, naive
 * forsøksversjonen av denne testen):
 *
 * Selv med `maxDecodeErrorKn = 0` (skala = 0, ingen kvantiseringsfeil i
 * det hele tatt) går vindfarten gjennom `hypot(u,v)` i den pakkede veien,
 * mens basisfeltet her returnerer `speedKn` direkte som en literal — de to
 * er matematisk identiske (`hypot(-14·sin θ, -14·cos θ) = 14`), men IKKE
 * bit-identiske i flyttall (`13.999999999999998` vs `14`), fordi
 * `sin²+cos²=1` bare holder eksakt i reell aritmetikk, ikke i IEEE 754.
 * Dette er nøyaktig den samme klassen støy `docs/specs/rutemotor.md` §5.1
 * og `golden.test.ts` (±2 % toleranse) dokumenterer for `Math.sin`/`cos`/
 * `atan2` — en konsekvens av selve u/v-lagringsformen (§3, §9.1), ikke av
 * kvantisering. Toleransen her (relativ 1e-9) er ti størrelsesordener
 * strammere enn 8-bit-kvantiseringens egen feil (~0,1 kn-skala) — stram
 * nok til å bevise «ingen kvantiseringsfeil», løs nok til å tåle
 * flyttallsstøyen fra selve trigonometrien.
 */
function assertNearlyIdentical(a: unknown, b: unknown, path = "$"): void {
  if (typeof a === "number" && typeof b === "number") {
    if (Object.is(a, b)) return;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    const relDiff = Math.abs(a - b) / scale;
    if (relDiff > 1e-9) {
      throw new Error(`${path}: ${a} vs ${b} (relativ diff ${relDiff})`);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      throw new Error(`${path}.length: ${a.length} vs ${b.length}`);
    }
    for (let i = 0; i < a.length; i++) {
      assertNearlyIdentical(a[i], b[i], `${path}[${i}]`);
    }
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      assertNearlyIdentical(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
    }
    return;
  }
  if (!Object.is(a, b)) {
    throw new Error(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
}
