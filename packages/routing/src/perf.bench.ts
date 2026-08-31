/**
 * Ytelses-røyktest (docs/specs/rutemotor.md §7).
 *
 * Kjøres med `pnpm --filter @morild/routing test:perf`.
 *
 * Dette er en **røyktest, ikke en benchmark**: den fanger at noe har blitt
 * dramatisk tregere, ikke små regresjoner. Terskelen er derfor satt med god
 * margin, og testen måler på utviklings-PC-en — budsjettet i §7 gjelder et
 * moderat Android-nettbrett, som spike-rapporten anslår til 2–4× tregere.
 *
 * Budsjettet det egentlig gjelder:
 *   - én deterministisk kontrollrute < 5 s på nettbrett
 *   - fullt ensemble < 60 s på nettbrett
 *
 * Her måler vi PC-tallet og lar 2–4×-faktoren stå igjen som margin.
 */
import { describe, expect, it } from "vitest";
import {
  GOLDEN_DEPART_S,
  goldenScenarios,
  SKAGEN,
  SKJAELOY,
} from "../test-fixtures/golden-scenarios.js";
import { OPEN_SEA_MASK } from "../test-fixtures/synthetic-mask.js";
import { syntheticField } from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import { buildDistanceField } from "./distance-field.js";
import { maskAsEdgeGate } from "./contracts.js";
import { planRoute, type RouteInput } from "./search.js";

/**
 * **Regresjonsvakt, ikke måloppnåelse.**
 *
 * Oppdraget ba om < 1 s for kontrollkjøringen på denne PC-en. Det målet er
 * **ikke nådd**: målt 3,8 s for Skjæløy→Skagen (87 nm, 6°, 1 t) med delt
 * A\*-felt. Tallet er ærlig rapportert videre i stedet for å skjules bak en
 * mildere testkonfigurasjon.
 *
 * Årsaken er målt og strukturell, ikke en enkelt treg funksjon: motoren
 * lager ~170 000 etiketter der v1 lagde ~15 000, fordi ADR-0004 bytter v1s
 * ene node per celle mot Pareto-etiketter × 8 kurssektorer. Kostnaden per
 * kandidat er ~370 ns, som er rimelig; det er *antallet* kandidater
 * (~10 millioner) som er prisen for beslutningen. CPU-profilen fordeler seg
 * jevnt (31 % ekspansjonsløkke, 12 % kinematikk, 9 % innsetting), altså
 * ingen enkelt flaskehals å fjerne.
 *
 * Vakten står derfor på 6 s: den fanger en dobling, uten å påstå at
 * budsjettet er innfridd. Se rapporten for de målte spakene.
 */
const CONTROL_REGRESSION_GUARD_MS = 6000;

/** Det oppdraget ba om, beholdt som tall vi måler oss mot. */
const CONTROL_TARGET_MS = 1000;

function flagshipInput(): RouteInput {
  const scenario = goldenScenarios().find(
    (s) => s.name === "skjaeloy-skagen-apent",
  );
  if (scenario === undefined) throw new Error("mangler flaggskip-scenario");
  return scenario.input;
}

describe("ytelses-røyk", () => {
  it("kontrollkjøring Skjæløy→Skagen er under budsjettet", () => {
    const input = flagshipInput();

    // Feltet er væruavhengig og deles i praksis på tvers av alle avganger og
    // alle ensemble-medlemmer (§5.5). Å bygge det på nytt per kjøring ville
    // målt noe vi aldri gjør i drift, så vi bygger det først — og måler det
    // separat under.
    const field = buildDistanceField(
      input.start,
      input.dest,
      maskAsEdgeGate(input.mask!),
    );
    expect(field).toBeDefined();

    // Én oppvarming: vi måler stabil kode, ikke JIT-oppstart.
    planRoute({ ...input, field });

    const t0 = performance.now();
    const result = planRoute({ ...input, field });
    const elapsedMs = performance.now() - t0;

    expect(result.reached).toBe(true);
    // eslint-disable-next-line no-console -- ytelsestall skal være synlige
    console.log(
      `[perf] Skjæløy→Skagen kontroll (6°, 1 t): ${elapsedMs.toFixed(0)} ms ` +
        `(mål ${CONTROL_TARGET_MS} ms — ${elapsedMs < CONTROL_TARGET_MS ? "nådd" : `IKKE nådd, ${(elapsedMs / CONTROL_TARGET_MS).toFixed(1)}×`}), ` +
        `${result.diagnostics.labelsCreated} etiketter, ` +
        `topp ${result.diagnostics.peakActiveLabels} aktive, ` +
        `${(result.totals.durationS / 3600).toFixed(2)} t rute`,
    );
    expect(elapsedMs).toBeLessThan(CONTROL_REGRESSION_GUARD_MS);
  }, 120_000);

  it("A*-feltet bygges én gang og er billig nok til å deles", () => {
    const t0 = performance.now();
    const field = buildDistanceField(
      SKJAELOY,
      SKAGEN,
      maskAsEdgeGate(OPEN_SEA_MASK),
    );
    const elapsedMs = performance.now() - t0;
    expect(field).toBeDefined();
    // eslint-disable-next-line no-console -- ytelsestall skal være synlige
    console.log(
      `[perf] A*-felt: ${elapsedMs.toFixed(0)} ms, ${field?.cellCount ?? 0} celler`,
    );
    expect(elapsedMs).toBeLessThan(20_000);
  }, 60_000);

  it("et lite ensemble med delt felt holder seg innenfor sin andel", () => {
    // Fem medlemmer på medlemsoppløsning (12°), delt felt — én tjuedel av et
    // fullt 30-medlemsensemble ×1 avgang. Ekstrapoleringen til fullt
    // ensemble gjøres i rapporten, ikke i testen.
    const base = flagshipInput();
    const field = buildDistanceField(
      base.start,
      base.dest,
      maskAsEdgeGate(base.mask!),
    );

    const t0 = performance.now();
    let reachedCount = 0;
    for (let member = 0; member < 5; member++) {
      const result = planRoute({
        ...base,
        field,
        weather: syntheticField({
          seed: 1000 + member,
          baseSpeedKn: 11 + member * 0.5,
          baseFromDeg: 235 + member * 3,
          speedVariationKn: 4,
          dirVariationDeg: 35,
          baseHsM: 1.0,
          validFromS: GOLDEN_DEPART_S - 3600,
          validToS: GOLDEN_DEPART_S + 8 * 24 * 3600,
        }),
        boat: testBoat(),
        options: { ...base.options, headingStepDeg: 12 },
      });
      if (result.reached) reachedCount++;
    }
    const elapsedMs = performance.now() - t0;
    // eslint-disable-next-line no-console -- ytelsestall skal være synlige
    console.log(
      `[perf] 5 medlemmer (12°, delt felt): ${elapsedMs.toFixed(0)} ms ` +
        `(${(elapsedMs / 5).toFixed(0)} ms/medlem), ${reachedCount}/5 nådde fram`,
    );
    expect(elapsedMs).toBeLessThan(30_000);
  }, 120_000);
});
