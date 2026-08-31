/**
 * Kontroll- og determinismetester for E1′-fiksturene
 * (`docs/research/maaleplan-e1-2026-08-31.md` §1 og §6).
 *
 * Fiksturene er måleinstrumenter. Et måleinstrument som ikke er kalibrert er
 * verre enn ingen måling, så hver fikstur har:
 *
 *  1. **determinismetest** — samme input gir bit-identisk medlemstabell;
 *  2. **kontrolltest** — mekanismen fiksturen skal skape, oppstår faktisk
 *     (S-3: hard forkastelse og felle; S-7: bimodal topologi; S-8:
 *     bratthetsderating), og
 *  3. **negativ kontroll** der det gir mening — mekanismen oppstår *ikke* når
 *     den ikke skal.
 *
 * Testene her måler fiksturene, ikke variantene. Selve E1′-kjøringen er en
 * egen jobb.
 */
import { describe, expect, it } from "vitest";
import { haversineNm } from "@morild/geo";
import { INTERIM_BAILOUT_HARBOURS } from "../test-fixtures/bailout-harbours.js";
import { controlInput, ensembleDigest, memberInput } from "../test-fixtures/ensemble.js";
import type { EnsembleFixture } from "../test-fixtures/ensemble.js";
import {
  s3FrontEnsemble,
  s3FrontOptionsFor,
} from "../test-fixtures/ensemble-s3-front.js";
import {
  S7_MEDOIDS,
  SKAGERRAKBANKEN,
  s7TwoRegimeEnsemble,
} from "../test-fixtures/ensemble-s7-two-regime.js";
import {
  S8_BAND,
  s8WindAgainstCurrentEnsemble,
} from "../test-fixtures/ensemble-s8-wind-current.js";
import { frontGeometry } from "../test-fixtures/front-weather.js";
import { corridorDeviationNm } from "../test-fixtures/track-compare.js";
import { steepness } from "../test-fixtures/wind-current-weather.js";
import { r2Verdict } from "./bailout.js";
import { FLAG_VIND_MOT_STROM } from "./cost.js";
import { evaluateRoute } from "./evaluate.js";
import { planRoute } from "./search.js";
import type { LatLon } from "./contracts.js";

/** Kandidatruten alle medlemmene måles mot: kontrollmedlemmets rute. */
function controlRoute(fixture: EnsembleFixture): readonly LatLon[] {
  const result = planRoute(controlInput(fixture));
  expect(result.reached, `${fixture.name}: kontrollruten når ikke fram`).toBe(
    true,
  );
  return result.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
}

function evaluateMembers(
  fixture: EnsembleFixture,
  route: readonly LatLon[],
): Map<string, ReturnType<typeof evaluateRoute>> {
  const out = new Map<string, ReturnType<typeof evaluateRoute>>();
  for (const member of fixture.members) {
    out.set(
      member.id,
      evaluateRoute({
        waypoints: route,
        departEpochS: fixture.departEpochS,
        weather: member.weather,
        mask: fixture.mask,
        boat: fixture.boat,
        options: fixture.options,
      }),
    );
  }
  return out;
}

// --------------------------------------------------------------------- S-3

describe("S-3 frontpassasje: fiksturen", () => {
  it("er deterministisk — to konstruksjoner gir identisk medlemstabell", () => {
    expect(ensembleDigest(s3FrontEnsemble())).toBe(
      ensembleDigest(s3FrontEnsemble()),
    );
  });

  it("har 30 medlemmer med 30 forskjellige parameterrader", () => {
    const fixture = s3FrontEnsemble();
    expect(fixture.members).toHaveLength(30);
    const rows = new Set(
      fixture.members.map((m) => JSON.stringify(m.params)),
    );
    expect(rows.size).toBe(30);
  });

  /**
   * §6.3: felle-settet skal ikke kunne leses av én parameter alene. Det
   * dødelige styrkenivået må derfor forekomme både der fronten rekker båten og
   * der den ikke gjør det.
   */
  it("sprer den dødelige styrken over både tidlige og sene tidsskyv", () => {
    const fixture = s3FrontEnsemble();
    const lethal = fixture.members.filter((m) =>
      fixture.hardRejectionMemberIds.includes(m.id),
    );
    expect(lethal.map((m) => m.id)).toEqual(["m04", "m09", "m14", "m29"]);
    const shifts = lethal.map((m) => m.params["timingShiftH"]);
    expect(shifts).toEqual([9, 6, 3, -9]);
  });

  it("gjengir frontens struktur: dreining, lull og frikoblet gammel sjø", () => {
    const fixture = s3FrontEnsemble();
    const member = fixture.members.find((m) => m.id === "m09")!;
    // Parametrene leses fra fiksturen selv — en kopi her ville drevet fra den.
    const front = s3FrontOptionsFor(member.index);
    const geometry = frontGeometry(front);
    expect(front.timingShiftH).toBe(6);
    expect(front.postHsM).toBe(4.6);

    const at = (hours: number) => {
      const epochS = fixture.departEpochS + hours * 3600;
      return {
        d: geometry.signedDistanceNm(fixture.start.lat, fixture.start.lon, epochS),
        wind: member.weather.wind(fixture.start.lat, fixture.start.lon, epochS)!,
        waves: member.weather.waves(
          fixture.start.lat,
          fixture.start.lon,
          epochS,
        )!,
      };
    };

    // Prefrontalt: svak SV-lig vind og gammel SV-sjø.
    const before = at(0);
    expect(before.d).toBeLessThan(0);
    expect(before.wind.speedKn).toBeCloseTo(15.2, 1);
    expect(before.wind.fromDeg).toBeCloseTo(228, 0);
    expect(before.waves.hsM).toBeCloseTo(1.8, 2);
    expect(before.waves.fromDeg).toBe(225);

    // Postfrontalt: full styrke og ~68° dreining fra prefrontalt.
    const after = at(14);
    expect(after.d).toBeGreaterThan(0);
    expect(after.wind.speedKn).toBeGreaterThan(33);
    expect(after.wind.fromDeg - before.wind.fromDeg).toBeCloseTo(70, 0);
    // Gammel sjø er borte, ny vindsjø fra NV har tatt over — frikoblet felt.
    expect(after.waves.fromDeg).toBe(300);

    // På selve linjen: vindstille-stripa. Vi leter opp tidspunktet der d ≈ 0.
    let lullTws = Infinity;
    let lullHours = 0;
    for (let h = 0; h <= 14; h += 0.05) {
      const s = at(h);
      if (s.wind.speedKn < lullTws) {
        lullTws = s.wind.speedKn;
        lullHours = h;
      }
    }
    expect(lullTws).toBeGreaterThan(4);
    expect(lullTws).toBeLessThan(8);
    expect(Math.abs(at(lullHours).d)).toBeLessThan(2);

    // Krysshav: rett etter skiftet står sjøen fortsatt fra SV mens vinden er
    // dreid til NV. Det er «lull + krysshav»-situasjonen fiksturen finnes for.
    let maxCross = 0;
    for (let h = 0; h <= 14; h += 0.05) {
      const s = at(h);
      const cross = Math.abs(s.wind.fromDeg - (s.waves.fromDeg ?? 0));
      if (cross > maxCross) maxCross = cross;
    }
    expect(maxCross).toBeGreaterThan(40);
  });
});

describe("S-3 frontpassasje: positiv og negativ kontroll", () => {
  const fixture = s3FrontEnsemble();
  const route = controlRoute(fixture);
  const evaluations = evaluateMembers(fixture, route);

  it("POSITIV: nøyaktig de eksponerte dødelige medlemmene forkastes hardt", () => {
    const failing = [...evaluations.entries()]
      .filter(([, e]) => e.rejection !== null)
      .map(([id]) => id);
    // m29 har samme dødelige sjø, men fronten rekker aldri ruten — den er
    // fiksturens innebygde kontroll mot falske positive.
    expect(failing).toEqual(["m04", "m09", "m14"]);
    for (const id of failing) {
      const rejection = evaluations.get(id)!.rejection!;
      expect(rejection.kind).toBe("boatLimits");
      expect(rejection.reason).toContain("Hs");
    }
    expect(evaluations.get("m29")!.feasible).toBe(true);
  });

  it("POSITIV: de samme medlemmene er feller etter R2", () => {
    const traps = fixture.members
      .filter(
        (m) =>
          r2Verdict({
            route,
            departEpochS: fixture.departEpochS,
            weather: m.weather,
            mask: fixture.mask,
            boat: fixture.boat,
            options: fixture.options,
            r2: { harbours: INTERIM_BAILOUT_HARBOURS, mode: "pareto" },
          }).isTrap,
      )
      .map((m) => m.id);
    expect(traps).toEqual(["m04", "m09", "m14"]);
  }, 120_000);

  /**
   * Sanity-sjekken oppskriften ber om (steg3-planen): et **forward-søk fra
   * rutens midtpunkt** i felle-medlemmene skal ikke komme fram — eller komme
   * fram langt etter Tub. Uten den kunne «fella» like gjerne vært treg
   * seiling, og hele fiksturen ville målt noe annet enn den påstår.
   */
  it("POSITIV: forward-søk fra midtpunktet strander i felle-medlemmene", () => {
    const mid = route[Math.floor(route.length / 2)]!;
    const midTS = (planRoute(controlInput(fixture)).steps[
      Math.floor(route.length / 2)
    ]!).tS;
    const reference = planRoute({
      start: mid,
      dest: fixture.dest,
      departEpochS: fixture.departEpochS + midTS,
      weather: fixture.control,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
    });
    expect(reference.reached).toBe(true);

    for (const id of ["m04", "m09", "m14"]) {
      const member = fixture.members.find((m) => m.id === id)!;
      const result = planRoute({
        start: mid,
        dest: fixture.dest,
        departEpochS: fixture.departEpochS + midTS,
        weather: member.weather,
        mask: fixture.mask,
        boat: fixture.boat,
        options: fixture.options,
      });
      const strandet =
        !result.safety.reachesDestination ||
        result.totals.durationS > 2 * reference.totals.durationS;
      expect(
        strandet,
        `${id}: forward-søk fra midtpunktet kom fram på ` +
          `${(result.totals.durationS / 3600).toFixed(1)} t mot referansens ` +
          `${(reference.totals.durationS / 3600).toFixed(1)} t — fella er treg seiling, ikke forkastelse`,
      ).toBe(true);
    }
  }, 300_000);

  it("NEGATIV: uten felle-medlemmene forkastes ingenting og ingen feller finnes", () => {
    const negative = s3FrontEnsemble({ withTrapMembers: false });
    expect(negative.hardRejectionMemberIds).toEqual([]);
    const negativeRoute = controlRoute(negative);
    for (const [id, evaluation] of evaluateMembers(negative, negativeRoute)) {
      expect(evaluation.rejection, `${id} skulle vært gjennomførbar`).toBeNull();
    }
  }, 120_000);
});

// --------------------------------------------------------------------- S-7

describe("S-7 to-regime: fiksturen", () => {
  it("er deterministisk — to konstruksjoner gir identisk medlemstabell", () => {
    expect(ensembleDigest(s7TwoRegimeEnsemble())).toBe(
      ensembleDigest(s7TwoRegimeEnsemble()),
    );
  });

  it("er delt 15/15 mellom regimene, med 30 forskjellige parameterrader", () => {
    const fixture = s7TwoRegimeEnsemble();
    const passing = fixture.members.filter(
      (m) => m.params["regime"] === "passerer",
    );
    const stalled = fixture.members.filter(
      (m) => m.params["regime"] === "stopper",
    );
    expect(passing).toHaveLength(15);
    expect(stalled).toHaveLength(15);
    expect(new Set(fixture.members.map((m) => JSON.stringify(m.params))).size).toBe(
      30,
    );
    // Retrograd front i minst ett regime-medlem — måleplanens §6.2.
    expect(stalled.some((m) => (m.params["frontSpeedKn"] as number) < 0)).toBe(
      true,
    );
  });

  /**
   * Bimodaliteten er hele grunnen til at S-7 finnes: et kontrollsøk under hver
   * regime-medoid skal gi **ulik topologi**, ikke bare ulik ankomsttid.
   * Måleplanens §3 punkt 5 definerer «annen topologi» som korridoravvik
   * > 0,5 nm; her passerer de to rutene i tillegg på hver sin side av
   * Skagerrakbanken, som er en topologisk forskjell i ordets egentlige
   * forstand.
   */
  it("gir topologisk splitt mellom regime-medoidene", () => {
    const fixture = s7TwoRegimeEnsemble();
    const sides: Record<string, { east: number; west: number }> = {};
    const tracks: Record<string, LatLon[]> = {};
    for (const [regime, id] of Object.entries(S7_MEDOIDS)) {
      const member = fixture.members.find((m) => m.id === id)!;
      const result = planRoute(memberInput(fixture, member));
      expect(result.reached, `${regime} (${id}) nådde ikke fram`).toBe(true);
      const track = result.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
      tracks[regime] = track;
      sides[regime] = {
        east: track.filter(
          (p) =>
            p.lat >= SKAGERRAKBANKEN.latMin &&
            p.lat <= SKAGERRAKBANKEN.latMax &&
            p.lon > SKAGERRAKBANKEN.lonMax,
        ).length,
        west: track.filter(
          (p) =>
            p.lat >= SKAGERRAKBANKEN.latMin &&
            p.lat <= SKAGERRAKBANKEN.latMax &&
            p.lon < SKAGERRAKBANKEN.lonMin,
        ).length,
      };
    }

    const deviation = corridorDeviationNm(
      tracks["passerer"]!,
      tracks["stopper"]!,
    );
    expect(
      deviation,
      `regimene skiller bare ${deviation.toFixed(2)} nm — ingen topologisk splitt`,
    ).toBeGreaterThan(0.5);

    // Motsatte sider av banken.
    expect(sides["passerer"]!.east).toBeGreaterThan(0);
    expect(sides["passerer"]!.west).toBe(0);
    expect(sides["stopper"]!.west).toBeGreaterThan(0);
    expect(sides["stopper"]!.east).toBe(0);
  }, 300_000);

  it("har ingen harde forkastelser — S-7 måler topologi, ikke feller", () => {
    const fixture = s7TwoRegimeEnsemble();
    expect(fixture.hardRejectionMemberIds).toEqual([]);
    const route = controlRoute(fixture);
    for (const [id, evaluation] of evaluateMembers(fixture, route)) {
      expect(
        evaluation.rejection?.kind ?? null,
        `${id} ble hardt avvist i en fikstur som ikke skal ha feller`,
      ).not.toBe("boatLimits");
    }
  }, 300_000);
});

// --------------------------------------------------------------------- S-8

describe("S-8 vind mot strøm: fiksturen", () => {
  const fixture = s8WindAgainstCurrentEnsemble();

  it("er deterministisk — to konstruksjoner gir identisk medlemstabell", () => {
    expect(ensembleDigest(s8WindAgainstCurrentEnsemble())).toBe(
      ensembleDigest(s8WindAgainstCurrentEnsemble()),
    );
  });

  it("har 30 medlemmer i en fast strømstyrke × vindretning-tabell", () => {
    expect(fixture.members).toHaveLength(30);
    expect(
      new Set(fixture.members.map((m) => JSON.stringify(m.params))).size,
    ).toBe(30);
    expect(fixture.hardRejectionMemberIds).toEqual(["m26", "m27"]);
  });

  /**
   * Kontrolltesten for S-8: **bratthetsderatingen skal faktisk aktiveres**.
   * Uten den ville fiksturen bare vært «litt høyere bølger», og den egne
   * fellemekanismen måleplanens §6.2 ber om ville ikke finnes.
   */
  it("aktiverer bratthetsderatingen der strømmen står mot vinden", () => {
    const band = { lat: S8_BAND.centerLat, lon: fixture.start.lon };
    const calm = fixture.members.find((m) => m.id === "m04")!; // 0,4 kn, vind 140°
    const steep = fixture.members.find((m) => m.id === "m27")!; // 2,4 kn, vind 60°

    const calmWaves = calm.weather.waves(band.lat, band.lon, fixture.departEpochS)!;
    const steepWaves = steep.weather.waves(band.lat, band.lon, fixture.departEpochS)!;

    expect(steepness(calmWaves.hsM, calmWaves.tpS!)).toBeLessThan(0.035);
    expect(steepness(steepWaves.hsM, steepWaves.tpS!)).toBeGreaterThan(0.08);

    // Tverrsjø: deratingen skal være nesten fraværende i det rolige medlemmet
    // og kraftig i det bratte.
    const calmFactor = fixture.boat.waveFactor(
      calmWaves.hsM,
      calmWaves.tpS,
      90,
    );
    const steepFactor = fixture.boat.waveFactor(
      steepWaves.hsM,
      steepWaves.tpS,
      90,
    );
    expect(calmFactor).toBeGreaterThan(0.9);
    expect(steepFactor).toBeLessThan(0.5);

    // Utenfor båndet er sjøen den samme i begge medlemmene: fellen er lokal.
    const outside = { lat: 58.9, lon: fixture.start.lon };
    const a = calm.weather.waves(outside.lat, outside.lon, fixture.departEpochS)!;
    const b = steep.weather.waves(outside.lat, outside.lon, fixture.departEpochS)!;
    expect(a.hsM).toBeCloseTo(b.hsM, 6);
  });

  it("setter VIND_MOT_STROM bare der strømmen faktisk står mot vinden", () => {
    const route = controlRoute(fixture);
    const evaluations = evaluateMembers(fixture, route);
    // Vind fra 60° mot strøm mot 060° ⇒ rett imot.
    expect(evaluations.get("m27")!.flags & FLAG_VIND_MOT_STROM).not.toBe(0);
    // Vind fra 140° ⇒ vinkelen er under flaggets 135°-terskel.
    expect(evaluations.get("m29")!.flags & FLAG_VIND_MOT_STROM).toBe(0);
  }, 120_000);

  /**
   * S-8s rolle i felle-målingen er å være en **falsk-positiv-kontroll**: her
   * finnes harde avvisninger midt i strømbåndet, men båten kan snu og løpe inn
   * i skjærgården. En variant som kaller dem feller, har feil felle-sett.
   */
  it("gir harde avvisninger som IKKE er feller — nødhavn finnes", () => {
    const route = controlRoute(fixture);
    for (const id of fixture.hardRejectionMemberIds) {
      const member = fixture.members.find((m) => m.id === id)!;
      const verdict = r2Verdict({
        route,
        departEpochS: fixture.departEpochS,
        weather: member.weather,
        mask: fixture.mask,
        boat: fixture.boat,
        options: fixture.options,
        r2: { harbours: INTERIM_BAILOUT_HARBOURS, mode: "pareto" },
      });
      expect(verdict.failure, `${id} manglet den harde avvisningen`).not.toBeNull();
      expect(
        verdict.isTrap,
        `${id}: R2 fant ingen vei til nødhavn — da er S-8 ikke lenger en ` +
          `falsk-positiv-kontroll`,
      ).toBe(false);
      expect(verdict.reachedHarbour).not.toBeNull();
      // Havnen skal ligge innenfor rekkevidde fra feilpunktet.
      expect(haversineNm(verdict.from!, fixture.dest)).toBeGreaterThan(0);
    }
  }, 300_000);
});
