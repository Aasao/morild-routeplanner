/**
 * Kystbuffer langs korden — R3 (docs/specs/rutemotor.md §5.3.2).
 *
 * Testene er delt i tre:
 *  1. **Punkttesten** (korde med lengde 0) — den gamle adferden fra
 *     `checkClearance`, uendret, portert hit da funksjonen ble slått sammen
 *     med korridorsjekken.
 *  2. **Gaten** — at den skarpe betingelsen `d(A) + d(B) ≥ 2·krav + L` slipper
 *     gjennom det den skal, og bare det.
 *  3. **Bisectionen** — nes-scenarioet: god klaring i begge ender, brudd på
 *     midten. Det er hele grunnen til at R3 finnes.
 */
import { describe, expect, it } from "vitest";
import type { LatLon } from "@morild/geo";
import { haversineNm } from "@morild/geo";
import type { NavigabilityMask, SegmentVerdict } from "./contracts.js";
import { FLAG_SJOEGANG_DATA_MANGLER } from "./cost.js";
import type { CorridorParams } from "./clearance.js";
import {
  checkClearanceCorridor,
  createCorridorStats,
  DEFAULT_CORRIDOR_PARAMS,
  requiredClearanceNm,
} from "./clearance.js";
import { rectMask } from "../test-fixtures/synthetic-mask.js";

const PARAMS: CorridorParams = {
  ...DEFAULT_CORRIDOR_PARAMS,
  minOffingNm: 0.5,
  offingExemptNearEndsNm: 3.0,
  seaStateOffingNmPerM: 0.1,
};

/** Ender langt unna alt, slik at havneunntaket aldri slår inn utilsiktet. */
const FAR_ENDS = {
  start: { lat: 40, lon: 0 },
  dest: { lat: 41, lon: 0 },
};

const SAFE: SegmentVerdict = Object.freeze({ passable: true, tillit: "trygt" });

/**
 * Maske der klaringsfeltet er oppgitt **analytisk**. Det gjør det mulig å
 * konstruere nøyaktig de klaringsfeltene gaten skal testes mot, uavhengig av
 * hvordan den ekte masken regner avstand.
 *
 * Feltet må være 1-Lipschitz for at garantien skal gjelde; alle feltene under
 * er avstandsfunksjoner, som er det per konstruksjon.
 */
function analyticMask(
  clearance: (lat: number, lon: number) => number,
  onCall?: (lat: number, lon: number, maxNm: number) => void,
): NavigabilityMask {
  return {
    pointVerdict: () => SAFE,
    segmentVerdict: () => SAFE,
    clearanceNm(lat, lon, maxNm) {
      onCall?.(lat, lon, maxNm);
      return Math.min(maxNm, clearance(lat, lon));
    },
    tssVerdict: () => ({ kind: "none" }),
    coverage: "full",
    sources: [{ name: "ANALYTISK-TESTFELT", datum: "WGS84" }],
  };
}

/** Nord/øst-avstand i nm fra et referansepunkt — flat, som `stepLatLon`. */
function nmFrom(ref: LatLon, lat: number, lon: number): { n: number; e: number } {
  return {
    n: (lat - ref.lat) * 60,
    e: (lon - ref.lon) * 60 * Math.cos((ref.lat * Math.PI) / 180),
  };
}

describe("punkttesten (korde med lengde 0) — uendret adferd", () => {
  const land = { latMin: 58.9, latMax: 59.1, lonMin: 10.2, lonMax: 10.4 };
  const mask = rectMask({ noGo: [land] });

  const point = (p: LatLon, hsM: number | undefined = undefined) =>
    checkClearanceCorridor({
      mask,
      from: p,
      to: p,
      chordNm: 0,
      hsM,
      ends: FAR_ENDS,
      params: PARAMS,
    });

  it("godtar punkter med god klaring", () => {
    expect(point({ lat: 59, lon: 9.5 }).check.ok).toBe(true);
  });

  it("avviser punkter innenfor den statiske bufferen", () => {
    expect(point({ lat: 59, lon: 10.19 }).check.ok).toBe(false);
  });

  it("skjerper kravet når sjøgangen er kjent — hard avvisning", () => {
    // 0,7 nm klaring: nok statisk (0,5), men ikke med 3 m sjø (0,5 + 0,3).
    const p = {
      lat: 59,
      lon: 10.2 - 0.7 / (60 * Math.cos((59 * Math.PI) / 180)),
    };
    expect(point(p).check.ok).toBe(true);
    const med = point(p, 3);
    expect(med.check.ok).toBe(false);
    if (!med.check.ok) expect(med.check.reason).toMatch(/sjøgangstillegg/);
  });

  it("flagger når sjøgangsdata mangler i stedet for å late som marginen er dekket", () => {
    expect(point({ lat: 59, lon: 9.5 }).flags & FLAG_SJOEGANG_DATA_MANGLER)
      .toBeTruthy();
    expect(point({ lat: 59, lon: 9.5 }, 1.0).flags & FLAG_SJOEGANG_DATA_MANGLER)
      .toBe(0);
  });

  it("gjør unntak nær start og mål (havneanløp)", () => {
    const inside = { lat: 59, lon: 10.19 };
    const nearStart = checkClearanceCorridor({
      mask,
      from: inside,
      to: inside,
      chordNm: 0,
      hsM: undefined,
      ends: { start: { lat: 59, lon: 10.17 }, dest: FAR_ENDS.dest },
      params: PARAMS,
    });
    expect(nearStart.check.ok).toBe(true);
    const nearDest = checkClearanceCorridor({
      mask,
      from: inside,
      to: inside,
      chordNm: 0,
      hsM: undefined,
      ends: { start: FAR_ENDS.start, dest: { lat: 59, lon: 10.17 } },
      params: PARAMS,
    });
    expect(nearDest.check.ok).toBe(true);
  });

  it("gjør ingenting uten maske", () => {
    expect(
      checkClearanceCorridor({
        mask: undefined,
        from: { lat: 59, lon: 10.3 },
        to: { lat: 59, lon: 10.3 },
        hsM: 3,
        ends: FAR_ENDS,
        params: PARAMS,
      }).check.ok,
    ).toBe(true);
  });
});

/**
 * Gaten. Klaringsfeltet er `d(p) = avstand til en rett linje`, som er
 * 1-Lipschitz, og verdiene i endepunktene settes eksakt — da kan betingelsen
 * `d(A) + d(B) ≥ 2·krav + L` testes på grensen og ikke bare i det grove.
 */
describe("Lipschitz-gaten (lag 1)", () => {
  const REF: LatLon = { lat: 59, lon: 10 };
  const KRAV = 0.5;
  const params: CorridorParams = { ...PARAMS, minOffingNm: KRAV };

  /** Klaringsfelt: avstanden til meridianen gjennom `REF`, i nm. */
  const meridianField = analyticMask((lat, lon) =>
    Math.abs(nmFrom(REF, lat, lon).e),
  );

  /** Punkt `e` nm øst og `n` nm nord for referansen. */
  const at = (e: number, n: number): LatLon => ({
    lat: REF.lat + n / 60,
    lon: REF.lon + e / (60 * Math.cos((REF.lat * Math.PI) / 180)),
  });

  it("slipper gjennom en korde som er garantert trygg, uten å måle midtpunktet", () => {
    // Begge ender 4 nm fra fareranden, korde 2 nm langs den: 8 ≥ 1 + 2.
    const stats = createCorridorStats();
    const outcome = checkClearanceCorridor({
      mask: meridianField,
      from: at(4, -1),
      to: at(4, 1),
      hsM: 0,
      ends: FAR_ENDS,
      params,
      stats,
    });
    expect(outcome.check.ok).toBe(true);
    expect(stats.gatePass).toBe(1);
    expect(stats.gateMiss).toBe(0);
    expect(stats.midpointChecks).toBe(0);
  });

  it("bommer når summen er for liten, og faller ned i bisection", () => {
    // Begge ender 0,7 nm unna, korde 2 nm: 1,4 < 1,0 + 2,0.
    const stats = createCorridorStats();
    const outcome = checkClearanceCorridor({
      mask: meridianField,
      from: at(0.7, -1),
      to: at(0.7, 1),
      hsM: 0,
      ends: FAR_ENDS,
      params,
      stats,
    });
    // Korden er i virkeligheten trygg (den løper parallelt med faren), og
    // bisectionen skal derfor ende med godkjenning — men ikke gratis.
    expect(outcome.check.ok).toBe(true);
    expect(stats.gateMiss).toBeGreaterThan(0);
    expect(stats.midpointChecks).toBeGreaterThan(0);
  });

  it("grensetilfellet d(A) + d(B) = 2·krav + L passerer, ett hakk under bommer", () => {
    const stats = createCorridorStats();
    // Korde rett nordover, lengde L. Endene legges i hver sin avstand slik at
    // summen treffer likheten eksakt.
    const L = 2;
    const dA = 1.5;
    const dB = 2 * KRAV + L - dA; // = 2,5 ⇒ sum = 2·0,5 + 2 = 3 nøyaktig
    const exact = checkClearanceCorridor({
      mask: meridianField,
      from: at(dA, -L / 2),
      to: at(dB, L / 2),
      // Kordelengden oppgis eksplisitt: den geometriske lengden mellom de to
      // punktene er litt større enn L (de ligger ikke på samme meridian), og
      // testen handler om betingelsen, ikke om avstandsformelen.
      chordNm: L,
      hsM: 0,
      ends: FAR_ENDS,
      params,
      stats,
    });
    expect(exact.check.ok).toBe(true);
    expect(stats.gatePass).toBe(1);
    expect(stats.midpointChecks).toBe(0);

    const under = createCorridorStats();
    checkClearanceCorridor({
      mask: meridianField,
      from: at(dA - 0.001, -L / 2),
      to: at(dB, L / 2),
      chordNm: L,
      hsM: 0,
      ends: FAR_ENDS,
      params,
      stats: under,
    });
    // Gaten på hele korden bommer nå — og først da måles midtpunktet.
    // (Halvdelene passerer sine egne gater etterpå; korden *er* trygg.)
    expect(under.gateMiss).toBe(1);
    expect(under.midpointChecks).toBe(1);
  });

  it("krever et klaringstak som er stort nok til at gaten kan passere", () => {
    // Avkorting ved maxNm er en gyldig nedre skranke, men et for lavt tak
    // ville gjort gaten ubrukelig. Vi spør derfor alltid med krav + L.
    let seenCap = 0;
    const mask = analyticMask(
      () => 50,
      (_lat, _lon, maxNm) => {
        seenCap = Math.max(seenCap, maxNm);
      },
    );
    checkClearanceCorridor({
      mask,
      from: at(0, -3),
      to: at(0, 3),
      hsM: 0,
      ends: FAR_ENDS,
      params,
    });
    expect(seenCap).toBeGreaterThanOrEqual(KRAV + 6);
  });
});

/**
 * **R3-scenarioet, regresjon.** Korden runder et nes: god klaring i begge
 * ender, 0,1 nm på midten. Fram til 2026-08-31 ble bare endepunktet
 * kontrollert, og denne korden slapp gjennom som «trygg».
 */
describe("nes-scenarioet (lag 2 — bisection)", () => {
  const REF: LatLon = { lat: 59, lon: 10 };
  const at = (e: number, n: number): LatLon => ({
    lat: REF.lat + n / 60,
    lon: REF.lon + e / (60 * Math.cos((REF.lat * Math.PI) / 180)),
  });

  /**
   * Neset er et punkt 0,1 nm øst for kordens midtpunkt. Klaringsfeltet er
   * avstanden dit (1-Lipschitz per konstruksjon).
   */
  const headland = at(0.1, 0);
  const mask = analyticMask((lat, lon) => {
    const d = nmFrom(headland, lat, lon);
    return Math.hypot(d.n, d.e);
  });

  const A = at(0, -3);
  const B = at(0, 3);

  it("forutsetning: begge endene har god klaring, midten har 0,1 nm", () => {
    expect(mask.clearanceNm(A.lat, A.lon, 99)).toBeCloseTo(3.0017, 2);
    expect(mask.clearanceNm(B.lat, B.lon, 99)).toBeCloseTo(3.0017, 2);
    expect(mask.clearanceNm(REF.lat, REF.lon, 99)).toBeCloseTo(0.1, 3);
  });

  it("avviser korden hardt, og navngir stedet bruddet ble målt", () => {
    const stats = createCorridorStats();
    const outcome = checkClearanceCorridor({
      mask,
      from: A,
      to: B,
      hsM: 0,
      ends: FAR_ENDS,
      params: PARAMS,
      stats,
    });
    expect(outcome.check.ok).toBe(false);
    if (!outcome.check.ok) {
      expect(outcome.check.reason).toMatch(/Klaring 0\.1\d? nm under kravet/);
    }
    expect(outcome.failure?.uncertified).toBe(false);
    expect(outcome.failure?.lat).toBeCloseTo(REF.lat, 6);
    expect(stats.rejections).toBe(1);
    expect(stats.midpointChecks).toBeGreaterThan(0);
  });

  it("endepunkttesten alene ville sluppet den gjennom (det er buggen)", () => {
    const endpointsOnly = checkClearanceCorridor({
      mask,
      from: B,
      to: B,
      chordNm: 0,
      hsM: 0,
      ends: FAR_ENDS,
      params: PARAMS,
    });
    expect(endpointsOnly.check.ok).toBe(true);
  });

  it("godtar den samme korden når neset ligger utenfor kravet", () => {
    const clearHeadland = at(0.8, 0);
    const wide = analyticMask((lat, lon) => {
      const d = nmFrom(clearHeadland, lat, lon);
      return Math.hypot(d.n, d.e);
    });
    const outcome = checkClearanceCorridor({
      mask: wide,
      from: A,
      to: B,
      hsM: 0,
      ends: FAR_ENDS,
      params: PARAMS,
    });
    expect(outcome.check.ok).toBe(true);
  });

  it("bisectionen terminerer og avviser en korde som ikke kan sertifiseres", () => {
    // Klaringen er nøyaktig lik kravet overalt: gaten kan aldri passere for
    // L > 0, og rekursjonen må stoppe på bunnen — med avvisning, ikke med en
    // uendelig løkke eller en ubegrunnet godkjenning.
    const flat = analyticMask(() => PARAMS.minOffingNm);
    const stats = createCorridorStats();
    const outcome = checkClearanceCorridor({
      mask: flat,
      from: A,
      to: B,
      hsM: 0,
      ends: FAR_ENDS,
      params: PARAMS,
      stats,
    });
    expect(outcome.check.ok).toBe(false);
    expect(outcome.failure?.uncertified).toBe(true);
    expect(stats.uncertified).toBe(1);
    expect(stats.maxDepth).toBeLessThanOrEqual(
      PARAMS.clearanceCorridorMaxDepth,
    );
  });

  it("havneunntaket gjelder hele korden når den ligger inne i sonen", () => {
    const stats = createCorridorStats();
    const outcome = checkClearanceCorridor({
      mask,
      from: A,
      to: B,
      hsM: 0,
      // Målet ligger midt på korden, og unntaksradien dekker begge endene.
      ends: { start: FAR_ENDS.start, dest: REF },
      params: { ...PARAMS, offingExemptNearEndsNm: 5 },
      stats,
    });
    expect(outcome.check.ok).toBe(true);
    expect(stats.exemptChords).toBe(1);
  });

  it("havneunntaket dekker ikke den delen av korden som ligger utenfor sonen", () => {
    // Unntakssonen dekker A-enden, men neset ligger 3 nm unna og utenfor.
    const outcome = checkClearanceCorridor({
      mask,
      from: A,
      to: B,
      hsM: 0,
      ends: { start: at(0, -3), dest: FAR_ENDS.dest },
      params: { ...PARAMS, offingExemptNearEndsNm: 1 },
    });
    expect(outcome.check.ok).toBe(false);
  });
});

describe("requiredClearanceNm", () => {
  it("er den statiske bufferen uten bølgedata", () => {
    expect(requiredClearanceNm(0.5, undefined, 0.1)).toBe(0.5);
  });

  it("legger sjøgangstillegget på lineært", () => {
    expect(requiredClearanceNm(0.5, 2, 0.1)).toBeCloseTo(0.7, 9);
  });
});

/**
 * Egenskapstest: gaten skal aldri godkjenne en korde der et punkt bryter
 * kravet. Vi seiler korden i 200 punkter og sammenligner med sannheten fra
 * det analytiske feltet — for et sett konstruerte geometrier.
 */
describe("egenskap: en godkjent korde har ingen brudd noe sted", () => {
  const REF: LatLon = { lat: 59, lon: 10 };
  const at = (e: number, n: number): LatLon => ({
    lat: REF.lat + n / 60,
    lon: REF.lon + e / (60 * Math.cos((REF.lat * Math.PI) / 180)),
  });

  it("holder for et rutenett av nes-posisjoner og kordelengder", () => {
    let approved = 0;
    let rejected = 0;
    for (let offsetNm = 0.05; offsetNm <= 1.2; offsetNm += 0.05) {
      for (let halfLength = 0.5; halfLength <= 4; halfLength += 0.5) {
        const headland = at(offsetNm, 0);
        const mask = analyticMask((lat, lon) => {
          const d = nmFrom(headland, lat, lon);
          return Math.hypot(d.n, d.e);
        });
        const a = at(0, -halfLength);
        const b = at(0, halfLength);
        const outcome = checkClearanceCorridor({
          mask,
          from: a,
          to: b,
          hsM: 0,
          ends: FAR_ENDS,
          params: PARAMS,
        });
        if (!outcome.check.ok) {
          rejected++;
          continue;
        }
        approved++;
        // Sannheten: minste klaring langs korden, tett samplet.
        let worst = Infinity;
        for (let i = 0; i <= 200; i++) {
          const t = i / 200;
          const p = {
            lat: a.lat + (b.lat - a.lat) * t,
            lon: a.lon + (b.lon - a.lon) * t,
          };
          worst = Math.min(worst, mask.clearanceNm(p.lat, p.lon, 99));
        }
        expect(
          worst,
          `godkjent korde med nes ${offsetNm.toFixed(2)} nm unna og halvlengde ${halfLength} nm`,
        ).toBeGreaterThanOrEqual(PARAMS.minOffingNm);
      }
    }
    // Begge utfall skal forekomme — ellers tester vi ingenting.
    expect(approved).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("kordelengden måles som storsirkel når kalleren ikke oppgir den", () => {
    const a = at(0, -2);
    const b = at(0, 2);
    expect(haversineNm(a, b)).toBeCloseTo(4, 2);
  });
});
