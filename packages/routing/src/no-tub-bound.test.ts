/**
 * **`RouteInput.noTubBound` — omkjøringen uten bound** (D9.2 b-full,
 * `docs/specs/robusthet.md` §7 og §4.1; `docs/specs/rutemotor.md` §4.7).
 *
 * Ventilen i robusthet.md §4.1 sier: terminerer et medlem uten
 * `safety.reachesDestination` mens `diagnostics.pruned.bound > 0`, er det
 * **ikke** bevist ugjennomførbart — bounden kan ha kuttet den ruten som
 * fantes — og medlemmet skal kjøres om uten bound før det klassifiseres.
 * Fram til bølge 3 fantes ingen bryter for det: `exactMode` slår i tillegg av
 * etikett-tak og stagnasjonsvakt, og ville gjort omkjøringen til et *annet
 * søk* enn førstepasset. `noTubBound` slår av nøyaktig én ting.
 *
 * Scenarioet er det samme som i `shared-tub.damage.test.ts`: åpent vann,
 * konstant vind, en triviell og gjennomførbar rute — og en **kunstig lav**
 * `tubBoundS` som garantert feller den. Da er alt som skjer, bounden alene.
 */
import { describe, expect, it } from "vitest";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { constantWeather } from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import type { RouteResult } from "./result.js";
import { planRoute, type RouteInput } from "./search.js";

const DEPART_S = 1781668800;

function baseInput(): RouteInput {
  return {
    start: { lat: 58.0, lon: 10.6 },
    dest: { lat: 58.4, lon: 10.6 },
    departEpochS: DEPART_S,
    weather: constantWeather({
      speedKn: 14,
      fromDeg: 270,
      validFromS: DEPART_S - 3600,
      validToS: DEPART_S + 86_400,
    }),
    mask: rectMask(),
    boat: testBoat(),
    options: { headingStepDeg: 15, timeStepS: 3600 },
  };
}

/**
 * **Nøyaktig hva som sammenlignes — og hva som ikke gjør det.**
 *
 * Sammenligningen er bit-identitet på **alt resultatet sier om ruten**:
 * `legs`, `steps`, `totals`, `finalLeg`, `safety`, `coverage`,
 * `alternatives`, `isochrones`, `flags`, `reached`, `abortReason`.
 *
 * `diagnostics` er bevisst utenfor, og grunnen er selve poenget med
 * opsjonen: uten bound utforsker søket **mer**. I scenarioet under beskjærer
 * motorens egen bound over 11 000 kandidater, og uten den lages det ti
 * ganger så mange etiketter. Å kreve at de tellerne var like ville vært å
 * kreve at beskjæringen ikke gjorde noe — da hadde opsjonen vært
 * meningsløs. Det interessante — og det denne testen fastholder — er at all
 * den ekstra letingen **ikke endret ruten med en eneste bit**: bounden
 * beskar bare kandidater som uansett ikke vant.
 *
 * `tubBoundS` og `termination.boundSource` ligger dermed også utenfor
 * sammenligningen (de *skal* være ulike: `13,0 t`/`"own"` mot `null`/`null`),
 * mens `pruned.bound === 0` og `boundSource === null` asserteres for seg.
 */
function routeFacingJson(r: RouteResult): string {
  const { diagnostics, ...rest } = r;
  void diagnostics;
  return JSON.stringify(rest);
}

describe("noTubBound (D9.2 b-full)", () => {
  it("gir bit-identisk rute som kjøringen med motorens egen bound", () => {
    const base = baseInput();
    const referanse = planRoute(base);
    expect(
      referanse.safety.reachesDestination,
      "forutsetningen: ruten er gjennomførbar",
    ).toBe(true);
    expect(
      referanse.diagnostics.pruned.bound,
      "forutsetningen: motorens egen bound beskjærer faktisk her — ellers " +
        "måler testen ingenting",
    ).toBeGreaterThan(0);

    const uten = planRoute({ ...base, noTubBound: true });
    expect(uten.diagnostics.tubBoundS).toBeNull();
    expect(uten.diagnostics.termination.boundSource).toBeNull();
    expect(uten.diagnostics.pruned.bound).toBe(0);
    // Mer arbeid, samme svar: det er hele påstanden.
    expect(uten.diagnostics.labelsCreated).toBeGreaterThan(
      referanse.diagnostics.labelsCreated,
    );
    expect(routeFacingJson(uten)).toBe(routeFacingJson(referanse));
  }, 60_000);

  it("redder ruten en for stram bound kuttet — og gir referansens svar", () => {
    const base = baseInput();
    const referanse = planRoute(base);

    // En halvtimes «seilingstid» er langt under den ekte (~3,5 t).
    const stram = planRoute({ ...base, tubBoundS: 1800 });
    expect(stram.safety.reachesDestination).toBe(false);
    expect(stram.diagnostics.pruned.bound).toBeGreaterThan(0);
    expect(stram.diagnostics.termination.boundSource).toBe("shared");
    // §3.2s skarpe kant: bounden beskar hele fronten, og søket døde av
    // `noExpandableLabels`. Uten `termination` ville det sett ut som et
    // *uttømt* søk — altså nesten som et sertifikat for ugjennomførbarhet.
    expect(stram.abortReason).toBe("noExpandableLabels");
    expect(stram.diagnostics.termination.kind).toBe("exhausted");

    // Sertifikatregelen redder oss likevel: `exhausted` teller bare når
    // ingen bound var i spill.
    expect(stram.diagnostics.termination.boundSource).not.toBeNull();
    expect(stram.diagnostics.termination.prunedBound).toBeGreaterThan(0);

    // Omkjøringen: samme søk, bare uten bound.
    const omkjort = planRoute({ ...base, noTubBound: true });
    expect(omkjort.safety.reachesDestination).toBe(true);
    expect(routeFacingJson(omkjort)).toBe(routeFacingJson(referanse));
  }, 60_000);

  it("beholder etikett-tak og stagnasjonsvakt (ulikt exactMode)", () => {
    const base = baseInput();
    // Et tak som garantert binder: 200 etiketter tar ikke båten 24 nm.
    const capped = planRoute({
      ...base,
      noTubBound: true,
      options: { ...base.options, maxTotalLabels: 200 },
    });
    expect(capped.abortReason).toBe("labelCap");
    expect(capped.diagnostics.termination.kind).toBe("capped");

    // Stagnasjonsvakten står også: en vegg tvers over gir «guard», ikke et
    // søk som leter til iterasjonstaket.
    const wall = planRoute({
      ...base,
      noTubBound: true,
      mask: rectMask({
        noGo: [{ latMin: 58.15, latMax: 58.25, lonMin: 9.0, lonMax: 12.0 }],
      }),
      options: { ...base.options, stagnationIterations: 1 },
    });
    expect(wall.abortReason).toBe("stagnation");
    expect(wall.diagnostics.termination.kind).toBe("guard");
  }, 60_000);
});
