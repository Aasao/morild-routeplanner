/**
 * **`diagnostics.termination` — uttømmende over `abortReason`** (D9.2
 * b-full, `docs/specs/robusthet.md` §7; `docs/specs/rutemotor.md` §5.13).
 *
 * Robusthetslaget skal kunne skille «søket beviste at det ikke går» fra
 * «søket ga opp» uten å kjenne motorens interne avbruddsnavn. Da må
 * oversettelsen `abortReason → termination.kind` være **total**: hver eneste
 * verdi i unionen skal ha en kjent, testet oversettelse, og en ny verdi skal
 * ikke kunne snike seg inn uten at noen tar stilling til hva den betyr.
 *
 * Uttømmeligheten håndheves to steder:
 *  1. **Kompilatoren:** `CASES` er en `Record<AbortReason, …>`. Legges det
 *     til en `abortReason`, kompilerer ikke denne filen før den har en rad.
 *  2. **Kjøretiden:** hver rad kjører et **ekte søk** som faktisk produserer
 *     nettopp den `abortReason`-en, og sjekker `termination.kind`. En rad som
 *     ikke lenger klarer å framprovosere sin egen abort feiler — vi tester
 *     ikke en tabell mot seg selv.
 *
 * `abortReason === null` dekkes av de to siste testene: nådd mål
 * (`"reached"`) og uferdig `snapshot()` (`"aborted"`).
 */
import { describe, expect, it } from "vitest";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import {
  constantWeather,
  emptyWeather,
} from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import type { RouteOptions } from "./options.js";
import type { AbortReason, RouteResult, TerminationKind } from "./result.js";
import { createSearch, planRoute, type RouteInput } from "./search.js";

/** 2026-06-15 06:00 UTC — lyst hele etappen på disse breddegradene. */
const DEPART_S = Date.UTC(2026, 5, 15, 6, 0, 0) / 1000;
const START = { lat: 58.6, lon: 10.6 };
const DEST = { lat: 58.0, lon: 10.6 };

function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    start: START,
    dest: DEST,
    departEpochS: DEPART_S,
    weather: constantWeather({
      speedKn: 14,
      fromDeg: 270,
      validFromS: DEPART_S - 3600,
      validToS: DEPART_S + 14 * 24 * 3600,
    }),
    mask: rectMask(),
    boat: testBoat(),
    options: { timeStepS: 1800, headingStepDeg: 10 },
    ...overrides,
  };
}

function options(extra: Partial<RouteOptions>): Partial<RouteOptions> {
  return { timeStepS: 1800, headingStepDeg: 10, ...extra };
}

/** Vegg tvers over etappen: målet er uoppnåelig, uansett hvor lenge vi leter. */
const WALL = { latMin: 58.2, latMax: 58.3, lonMin: 9.0, lonMax: 12.0 };

interface Case {
  readonly kind: TerminationKind;
  readonly why: string;
  readonly run: () => RouteResult;
}

/**
 * Én rad per `AbortReason`. `Record` — ikke array — nettopp for at
 * kompilatoren skal kreve at raden finnes.
 */
const CASES: { readonly [K in AbortReason]: Case } = {
  noExpandableLabels: {
    kind: "exhausted",
    why: "værfeltet slutter i tid; fronten kan ikke utvides videre",
    run: () =>
      planRoute(
        input({
          weather: constantWeather({
            speedKn: 14,
            fromDeg: 270,
            validFromS: DEPART_S,
            validToS: DEPART_S + 2 * 3600,
          }),
        }),
      ),
  },
  labelCap: {
    kind: "capped",
    why: "etikett-taket tok slutt mot en vegg",
    run: () =>
      planRoute(
        input({
          mask: rectMask({ noGo: [WALL] }),
          options: options({ maxTotalLabels: 20_000 }),
        }),
      ),
  },
  iterationCap: {
    kind: "capped",
    why: "iterasjonstaket tok slutt lenge før målet",
    run: () => planRoute(input({ options: options({ maxIterations: 3 }) })),
  },
  stagnation: {
    kind: "guard",
    why: "ingen forbedring mot målet bak veggen",
    run: () =>
      planRoute(
        input({
          mask: rectMask({ noGo: [WALL] }),
          options: options({ stagnationIterations: 1 }),
        }),
      ),
  },
  callerStopped: {
    kind: "aborted",
    why: "kalleren ba søket stoppe",
    run: () => {
      const search = createSearch(input());
      search.advance(2);
      search.stop();
      return search.finish();
    },
  },
  noWeatherAtStart: {
    kind: "aborted",
    why: "ingen vind i startpunktet — ingenting er forsøkt",
    run: () => planRoute(input({ weather: emptyWeather() })),
  },
  outsideDomain: {
    kind: "aborted",
    why: "start utenfor domenets bbox",
    run: () => planRoute(input({ start: { lat: 40, lon: 10 } })),
  },
};

describe("diagnostics.termination — uttømmende over abortReason", () => {
  for (const [reason, testCase] of Object.entries(CASES) as [
    AbortReason,
    Case,
  ][]) {
    it(`${reason} ⇒ termination.kind = "${testCase.kind}" (${testCase.why})`, () => {
      const result = testCase.run();
      // Raden må faktisk framprovosere sin egen abort — ellers tester vi
      // tabellen mot seg selv.
      expect(result.abortReason, testCase.why).toBe(reason);
      expect(result.diagnostics.termination.kind).toBe(testCase.kind);
      expect(result.diagnostics.termination.prunedBound).toBe(
        result.diagnostics.pruned.bound,
      );
    }, 30_000);
  }

  it('abortReason = null og nådd mål ⇒ "reached"', () => {
    const result = planRoute(input());
    expect(result.abortReason).toBeNull();
    expect(result.reached).toBe(true);
    expect(result.diagnostics.termination.kind).toBe("reached");
  });

  it('abortReason = null i et uferdig snapshot ⇒ "aborted", aldri "exhausted"', () => {
    const search = createSearch(input());
    search.advance(2);
    const snapshot = search.snapshot();
    expect(snapshot.abortReason).toBeNull();
    expect(snapshot.reached).toBe(false);
    // Et delresultat er ikke et bevis på noe som helst — og særlig ikke på
    // ugjennomførbarhet. `exhausted` er reservert for søk som faktisk brukte
    // opp rommet sitt.
    expect(snapshot.diagnostics.termination.kind).toBe("aborted");
  });
});

describe("diagnostics.termination.boundSource — kilde, ikke bruk", () => {
  it('motorens egen grådige forhåndsrute gir "own"', () => {
    const result = planRoute(input());
    expect(result.diagnostics.tubBoundS).not.toBeNull();
    expect(result.diagnostics.termination.boundSource).toBe("own");
  });

  it('en bound fra kalleren gir "shared"', () => {
    const result = planRoute({ ...input(), tubBoundS: 12 * 3600 });
    expect(result.diagnostics.tubBoundS).toBe(12 * 3600);
    expect(result.diagnostics.termination.boundSource).toBe("shared");
  });

  it("noTubBound gir null kilde, ingen bound og ingen bound-beskjæring", () => {
    const result = planRoute({ ...input(), noTubBound: true });
    expect(result.diagnostics.termination.boundSource).toBeNull();
    expect(result.diagnostics.tubBoundS).toBeNull();
    expect(result.diagnostics.pruned.bound).toBe(0);
    expect(result.diagnostics.termination.prunedBound).toBe(0);
  });

  it('exactMode beholder kilden "own" selv om bounden aldri beskjærer', () => {
    // Kilde, ikke bruk: `exactMode` slår av selve beskjæringen, men
    // forhåndsruten kjøres og horisonten rapporteres. Sertifikatregelen er
    // dermed konservativ her — den krever `boundSource === null`.
    const result = planRoute(input({ options: options({ exactMode: true }) }));
    expect(result.diagnostics.termination.boundSource).toBe("own");
    expect(result.diagnostics.pruned.bound).toBe(0);
  });

  it("et søk som aborterer før bounden beregnes har ingen kilde", () => {
    // `noWeatherAtStart` stopper i `initialise()` før `computeTubBound`.
    // Kilden er da `null` — ikke «own» med en tom horisont.
    const result = planRoute(input({ weather: emptyWeather() }));
    expect(result.abortReason).toBe("noWeatherAtStart");
    expect(result.diagnostics.termination.boundSource).toBeNull();
    expect(result.diagnostics.tubBoundS).toBeNull();
  });

  it("noTubBound sammen med tubBoundS er en motstridende bestilling", () => {
    expect(() =>
      planRoute({ ...input(), noTubBound: true, tubBoundS: 3600 }),
    ).toThrow(/motstridende/);
  });
});
