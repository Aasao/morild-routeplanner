/**
 * Egenskapstester (docs/specs/rutemotor.md §8.3).
 *
 * Disse tester ikke enkeltverdier, men egenskaper motoren skal ha uansett
 * input: determinisme, monotonitet under strengere constraints, at
 * kostnadene aldri krymper langs en sti, og at ruten på åpent hav faktisk
 * blir en rett linje.
 */
import { crossTrackNm, haversineNm } from "@morild/geo";
import { describe, expect, it } from "vitest";
import { rectMask, type Rect } from "../test-fixtures/synthetic-mask.js";
import {
  constantWeather,
  syntheticField,
} from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import type { RouteOptions } from "./options.js";
import type { RouteResult } from "./result.js";
import { createSearchForTesting, planRoute, type RouteInput } from "./search.js";

const DEPART_S = Date.UTC(2026, 5, 15, 6, 0, 0) / 1000;

const VARIABLE_WEATHER = syntheticField({
  seed: 20260830,
  baseSpeedKn: 13,
  baseFromDeg: 225,
  speedVariationKn: 5,
  dirVariationDeg: 50,
  baseHsM: 1.2,
  validFromS: DEPART_S - 3600,
  validToS: DEPART_S + 10 * 24 * 3600,
});

function baseInput(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    start: { lat: 58.6, lon: 10.6 },
    dest: { lat: 58.0, lon: 10.6 },
    departEpochS: DEPART_S,
    weather: VARIABLE_WEATHER,
    mask: rectMask(),
    boat: testBoat(),
    options: { timeStepS: 1800, headingStepDeg: 12 },
    ...overrides,
  };
}

/**
 * Byte-sammenligning uten `expect().toEqual()`: arenaen er på flere MB, og
 * vitests dype likhetssjekk bygger diff-strukturer som sprenger heapen på
 * typede arrays i den størrelsesorden. Vi sammenligner selv og asserterer
 * bare på oppsummeringen.
 */
function firstByteDifference(
  a: Uint8Array,
  b: Uint8Array,
): { index: number; a: number; b: number } | null {
  if (a.byteLength !== b.byteLength) {
    return { index: -1, a: a.byteLength, b: b.byteLength };
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return { index: i, a: a[i]!, b: b[i]! };
  }
  return null;
}

describe("determinisme (ufravikelig)", () => {
  it("gir byte-identisk resultat i tre kjøringer i samme prosess", () => {
    const first = JSON.stringify(planRoute(baseInput()));
    expect(JSON.stringify(planRoute(baseInput()))).toBe(first);
    expect(JSON.stringify(planRoute(baseInput()))).toBe(first);
  });

  it("gir byte-identisk etikett-arena i to kjøringer", () => {
    const a = createSearchForTesting(baseInput());
    a.finish();
    const b = createSearchForTesting(baseInput());
    b.finish();
    expect(firstByteDifference(a.arenaBytes(), b.arenaBytes())).toBeNull();
    expect(a.arenaBytes().byteLength).toBeGreaterThan(0);
  });

  it("er upåvirket av hvordan kalleren deler opp advance()", () => {
    const whole = createSearchForTesting(baseInput());
    whole.finish();

    const chopped = createSearchForTesting(baseInput());
    let progress = chopped.advance(1);
    while (!progress.done) progress = chopped.advance(1);
    chopped.finish();

    expect(firstByteDifference(chopped.arenaBytes(), whole.arenaBytes())).toBeNull();
  });

  it("er upåvirket av brukervektene i søket — bare rangeringen endres", () => {
    const nøytral = createSearchForTesting(baseInput());
    nøytral.finish();
    const skjev = createSearchForTesting(
      baseInput({
        options: {
          timeStepS: 1800,
          headingStepDeg: 12,
          rankingWeights: { beat: 50, motor: 0.1, night: 0.1 },
        },
      }),
    );
    skjev.finish();
    // Samme kandidatmengde: brukervekten flytter aldri søket (beslutning
    // 2026-08-30). Det er denne likheten som gjør motoren forklarlig.
    expect(firstByteDifference(skjev.arenaBytes(), nøytral.arenaBytes())).toBeNull();
  });
});

describe("antikjede-invarianten holder gjennom hele søket", () => {
  it("ingen tilstand får et dominert par, iterasjon for iterasjon", () => {
    const search = createSearchForTesting(baseInput());
    let progress = search.advance(1);
    search.assertInvariants();
    let guard = 0;
    while (!progress.done && guard++ < 200) {
      progress = search.advance(1);
      search.assertInvariants();
    }
    expect(guard).toBeGreaterThan(1);
  });
});

describe("ingen negative kostnadsbidrag (grunnlaget for label-setting)", () => {
  it("alle fire komponentene vokser monotont langs ruten", () => {
    const result = planRoute(baseInput());
    for (let i = 1; i < result.steps.length; i++) {
      const prev = result.steps[i - 1]!;
      const cur = result.steps[i]!;
      expect(cur.tS).toBeGreaterThanOrEqual(prev.tS);
      expect(cur.beatS).toBeGreaterThanOrEqual(prev.beatS);
      expect(cur.motorS).toBeGreaterThanOrEqual(prev.motorS);
      expect(cur.nightS).toBeGreaterThanOrEqual(prev.nightS);
    }
  });
});

/**
 * Monotonitet i **referansemodus**: med alle tapsgivende beskjæringer av kan
 * en strengere hard constraint aldri gi en raskere rute — den kan bare gjøre
 * kandidatmengden mindre.
 *
 * Problemet holdes lite med vilje: uten etikett-tak og uten Tub-bound
 * vokser tilstandsrommet fritt, og referansemodus er bare meningsfull der
 * den faktisk kan kjøres til bunns.
 */
describe("monotonitet under strengere constraints (exactMode)", () => {
  const SMALL_START = { lat: 58.35, lon: 10.6 };
  const SMALL_DEST = { lat: 58.1, lon: 10.6 };

  function smallInput(
    optionOverrides: Partial<RouteOptions> = {},
    inputOverrides: Partial<RouteInput> = {},
  ): RouteInput {
    return baseInput({
      start: SMALL_START,
      dest: SMALL_DEST,
      weather: constantWeather({
        speedKn: 12,
        fromDeg: 315,
        hsM: 1.5,
        validFromS: DEPART_S - 3600,
        validToS: DEPART_S + 5 * 24 * 3600,
      }),
      options: {
        timeStepS: 3600,
        headingStepDeg: 30,
        exactMode: true,
        ...optionOverrides,
      },
      ...inputOverrides,
    });
  }

  function assertNotFaster(looser: RouteResult, stricter: RouteResult): void {
    if (!stricter.reached) {
      // Tom løsningsmengde er et gyldig utfall av en strengere constraint.
      expect(stricter.abortReason).not.toBeNull();
      return;
    }
    expect(looser.reached).toBe(true);
    expect(stricter.totals.durationS).toBeGreaterThanOrEqual(
      looser.totals.durationS,
    );
  }

  it("strengere kystbuffer gir aldri raskere rute", () => {
    const land: Rect = {
      latMin: 58.15,
      latMax: 58.25,
      lonMin: 10.55,
      lonMax: 10.62,
    };
    const mask = rectMask({ noGo: [land] });
    const looser = planRoute(
      smallInput({ minOffingNm: 0.2, offingExemptNearEndsNm: 0.5 }, { mask }),
    );
    const stricter = planRoute(
      smallInput({ minOffingNm: 1.5, offingExemptNearEndsNm: 0.5 }, { mask }),
    );
    assertNotFaster(looser, stricter);
  });

  it("lavere maks-TWS gir aldri raskere rute", () => {
    const looser = planRoute(smallInput({}, { boat: testBoat({ maxTwsKn: 30 }) }));
    const stricter = planRoute(
      smallInput({}, { boat: testBoat({ maxTwsKn: 11.9 }) }),
    );
    assertNotFaster(looser, stricter);
  });

  it("lavere maks-Hs gir aldri raskere rute", () => {
    const looser = planRoute(smallInput({}, { boat: testBoat({ maxHsM: 4 }) }));
    const stricter = planRoute(smallInput({}, { boat: testBoat({ maxHsM: 1.4 }) }));
    assertNotFaster(looser, stricter);
  });

  it("krav om dagslys-ankomst gir aldri raskere rute", () => {
    const looser = planRoute(smallInput({ requireDaylightArrival: false }));
    const stricter = planRoute(smallInput({ requireDaylightArrival: true }));
    assertNotFaster(looser, stricter);
  });

  it("en ekstra no-go-polygon gir aldri raskere rute", () => {
    const looser = planRoute(smallInput());
    const stricter = planRoute(
      smallInput(
        {},
        {
          mask: rectMask({
            noGo: [
              { latMin: 58.18, latMax: 58.24, lonMin: 10.52, lonMax: 10.66 },
            ],
          }),
        },
      ),
    );
    assertNotFaster(looser, stricter);
  });
});

describe("rett linje på åpent hav", () => {
  const START_OPEN = { lat: 58.8, lon: 10.4 };
  const DEST_OPEN = { lat: 58.0, lon: 10.4 };

  function openSeaRoute(boat: ReturnType<typeof testBoat>): RouteResult {
    return planRoute({
      start: START_OPEN,
      dest: DEST_OPEN,
      departEpochS: DEPART_S,
      // Konstant tverrvind, ingen strøm, ingen sjø, ingen hindringer.
      weather: constantWeather({
        speedKn: 14,
        fromDeg: 270,
        validFromS: DEPART_S - 3600,
        validToS: DEPART_S + 5 * 24 * 3600,
      }),
      mask: rectMask(),
      boat,
      options: { timeStepS: 1800, headingStepDeg: 5 },
    });
  }

  function maxCrossTrack(result: RouteResult): number {
    let worst = 0;
    for (const step of result.steps) {
      const xte = Math.abs(crossTrackNm(START_OPEN, DEST_OPEN, step));
      if (xte > worst) worst = xte;
    }
    return worst;
  }

  /**
   * Teoretisk beste tid på en rett etappe i konstant vind.
   *
   * Merk at «maks VMG over enkeltkurser» *ikke* er en oppnåelig grense: en
   * kurs med høy VMG driver båten av kursen, og den må hentes inn igjen.
   * Den oppnåelige grensen er støttefunksjonen til den **konvekse
   * innhyllingen** av fartsvektorene, i retning målkursen med null netto
   * tverrkomponent — altså den beste blandingen av to kurser. Det er den
   * klassiske krysse-/lensevinkelteorien, og den er en ekte nedre grense
   * fordi enhver rute er en blanding av kurser.
   */
  function theoreticalBestS(boat: ReturnType<typeof testBoat>): number {
    const courseDeg = 180;
    const windFromDeg = 270;
    const velocities: { x: number; y: number }[] = [];
    for (let h = 0; h < 360; h += 1) {
      const twa = Math.abs(((windFromDeg - h + 540) % 360) - 180);
      const speed = boat.boatSpeedKn(14, twa);
      const rel = ((h - courseDeg) * Math.PI) / 180;
      // x = tverrkomponent, y = komponent langs målkursen.
      velocities.push({ x: speed * Math.sin(rel), y: speed * Math.cos(rel) });
    }
    let best = 0;
    for (const v of velocities) {
      if (v.x === 0 && v.y > best) best = v.y;
    }
    for (let i = 0; i < velocities.length; i++) {
      for (let j = i + 1; j < velocities.length; j++) {
        const a = velocities[i]!;
        const b = velocities[j]!;
        if (a.x === b.x) continue;
        const t = -a.x / (b.x - a.x);
        if (t < 0 || t > 1) continue;
        const y = a.y + t * (b.y - a.y);
        if (y > best) best = y;
      }
    }
    return (haversineNm(START_OPEN, DEST_OPEN) / best) * 3600;
  }

  it("er storsirkelen når polaren ikke belønner å seile av kursen", () => {
    // Flat polar: farten er uavhengig av TWA, så det finnes ingen
    // VMG-gevinst ved å avvike. Alt som er igjen er diskretiseringsfeil.
    const boat = testBoat({ ignoreWaves: true, flatPolar: true });
    const result = openSeaRoute(boat);
    expect(result.reached).toBe(true);

    const direct = haversineNm(START_OPEN, DEST_OPEN);
    expect(result.totals.distanceNm).toBeLessThan(direct * 1.03);
    expect(result.totals.distanceNm).toBeGreaterThan(direct * 0.98);

    // Tiden skal ligge tett på den teoretiske nedre grensen.
    const best = theoreticalBestS(boat);
    expect(result.totals.durationS).toBeGreaterThanOrEqual(best * 0.98);
    expect(result.totals.durationS).toBeLessThan(best * 1.03);

    // Tverravviket er løsere enn distansen, og det er en reell egenskap ved
    // isokronformuleringen, ikke slark i testen: `tS` avhenger bare av
    // tidssteget, så alle geometrier som lander innenfor samme antall steg
    // er nøyaktig like optimale. Slakken er ca. ett tidssteg pluss
    // reachRadius; over 48 nm gir det et par nautiske mil.
    expect(maxCrossTrack(result)).toBeLessThan(2.5);
  }, 20_000);

  it("holder seg nær storsirkelen med ekte polar", () => {
    // Med en realistisk polar ligger fartsoptimum på ca. TWA 100°, ikke på
    // tvers, så et lite tverravvik er en reell VMG-gevinst og ikke en
    // avsporing. Korridoren er likevel stram.
    const boat = testBoat({ ignoreWaves: true });
    const result = openSeaRoute(boat);
    expect(result.reached).toBe(true);

    const direct = haversineNm(START_OPEN, DEST_OPEN);
    expect(result.totals.distanceNm).toBeLessThan(direct * 1.03);
    expect(maxCrossTrack(result)).toBeLessThan(3.5);

    const best = theoreticalBestS(boat);
    expect(result.totals.durationS).toBeGreaterThanOrEqual(best * 0.98);
    expect(result.totals.durationS).toBeLessThan(best * 1.05);
  }, 20_000);
});
