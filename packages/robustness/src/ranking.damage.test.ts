/**
 * **S-9 — rangeringsfikstur, skademåling** (`docs/specs/robusthet.md` §5.4,
 * D8.9). Kjøres av `pnpm exec vitest run --config vitest.damage.config.ts
 * packages/robustness` (holdt utenfor `pnpm test`, D9.5).
 *
 * Kjører HELE S-9-fiksturen (`ensemble-s9-ranking.ts`, bygget PÅ
 * S-7-generatoren) gjennom motoren: 30 fulle søk for avgang A, 30 for
 * avgang B (60 totalt, §5.4). Beviser fiksturens forhåndsregistrerte
 * påstand — `argmin P50 = A`, `argmin P90 = B` — og at rangeringen
 * (`rankDepartures`) er invariant under leave-one-out for hvert av de 30
 * medlemmene (gjenbruker de 60 søkeresultatene; LOO kjører INGEN nye søk).
 *
 * Bygges ETTER §4.2/§4.3 er implementert (denne bølgen, punkt 1–4).
 */
import { describe, expect, it } from "vitest";
import { buildFieldForInput, planRoute } from "@morild/routing";
import type { DistanceField, RouteInput, RouteResult } from "@morild/routing";
import {
  S9_EXPECTED_ARGMIN_P50,
  S9_EXPECTED_ARGMIN_P90,
  s9RankingFixture,
} from "@morild/routing/test-fixtures/ensemble-s9-ranking";
import { classifyMember, summarizeMember, type MemberOutcome } from "./outcome.js";
import { rankDepartures } from "./ranking.js";
import { nextAction } from "./rerun.js";
import { summarizeDeparture, type RobustnessStamp } from "./summary.js";

const EXPECTED_MEMBERS = 30;

const STAMP: RobustnessStamp = {
  maskVersion: "s9-test-mask",
  packageId: "s9-test-package",
  packageInitEpochS: 1_700_000_000,
  memberAgesS: [],
  optionsHash: "s9-test-hash",
  estimator: "naermeste-rang-v1",
  thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
  waveGreenCap: { hsM: 1.0, status: "foreløpig, ikke verifisert mot NORA3" },
  wavePeriodKnown: false,
  wavePoints: null,
};

/**
 * Kjører ett medlem gjennom motoren, med §4.1s ventil + D9.4s rerun-tak:
 * `pruned.bound > 0 && !reachesDestination` ⇒ kjør om med `noTubBound: true`
 * (maks én gang). Returnerer det ENDELIGE `RouteResult` og hvor mange
 * ganger det ble kjørt om (for rapportering).
 */
function runMember(input: RouteInput): { readonly result: RouteResult; readonly reruns: 0 | 1 } {
  let result = planRoute(input);
  let classification = classifyMember(result);
  let reruns: 0 | 1 = 0;
  if (classification.kind === "rerun-without-bound") {
    const action = nextAction(classification, 0);
    if (action.kind === "rerun-without-bound") {
      result = planRoute({ ...input, noTubBound: true });
      reruns = 1;
      classification = classifyMember(result);
      // D9.4s tak er 1 — hvis ventilen SLÅR TIL igjen etter noTubBound, er
      // det en motorfeil (noTubBound skal garantere pruned.bound === 0), ikke
      // noe denne testen skal late som er inkonklusivt av budsjettgrunner.
      expect(classification.kind, "ventilen slo til igjen etter noTubBound=true — motorfeil, ikke budsjett").not.toBe(
        "rerun-without-bound",
      );
    }
  }
  return { result, reruns };
}

/** Bygger `RouteInput` for ett medlem i en `EnsembleFixture`-lik struktur. */
function memberRouteInput(
  fixture: ReturnType<typeof s9RankingFixture>["departureA"],
  member: ReturnType<typeof s9RankingFixture>["departureA"]["members"][number],
  field: DistanceField | undefined,
): RouteInput {
  return {
    start: fixture.start,
    dest: fixture.dest,
    departEpochS: fixture.departEpochS,
    weather: member.weather,
    mask: fixture.mask,
    boat: fixture.boat,
    options: fixture.options,
    field,
  };
}

interface RunDepartureResult {
  readonly members: readonly MemberOutcome[];
  readonly totalReruns: number;
}

/** Kjører alle 30 medlemmene i én avgang. 30 fulle søk (+ evt. reruns). */
function runDeparture(fixture: ReturnType<typeof s9RankingFixture>["departureA"]): RunDepartureResult {
  const controlInput: RouteInput = {
    start: fixture.start,
    dest: fixture.dest,
    departEpochS: fixture.departEpochS,
    weather: fixture.control,
    mask: fixture.mask,
    boat: fixture.boat,
    options: fixture.options,
  };
  // Delt A*-felt (§4.1) — bygget én gang, delt av alle 30 medlemmene i denne avgangen.
  const field = buildFieldForInput(controlInput);

  const members: MemberOutcome[] = [];
  let totalReruns = 0;
  for (const member of fixture.members) {
    const input = memberRouteInput(fixture, member, field);
    const { result, reruns } = runMember(input);
    totalReruns += reruns;
    const kind = classifyMember(result);
    members.push({
      // Medlemsindeksen i fiksturen er 0-basert; MemberOutcome bruker 1..30
      // for medlemmer (0 er reservert kontrollen, §3.2).
      memberIndex: member.index + 1,
      kind: kind.kind === "rerun-without-bound" ? "error" : kind.kind, // uråkbart etter runMember over
      summary: summarizeMember(result),
      ...(kind.kind === "inconclusive" ? { inconclusiveReason: kind.reason } : {}),
      ...(kind.kind === "error" ? { error: "s9-damage: uventet feil-klassifisering" } : {}),
    });
  }
  return { members, totalReruns };
}

describe("S-9 rangeringsfikstur — skademåling (robusthet.md §5.4, D8.9)", () => {
  it("argmin P50 = A, argmin P90 = B; rangeringen er invariant under leave-one-out for alle 30 medlemmer", () => {
    const fixture = s9RankingFixture();

    const runA = runDeparture(fixture.departureA);
    const runB = runDeparture(fixture.departureB);

    // Kontrollen er ikke en del av de 60 medlemssøkene (§5.4 sier 60, ikke
    // 62) — vi bruker medlem 0 sitt resultat som kontroll-plassholder i
    // sammendraget, siden `control` kun brukes til den "foreløpige"
    // sorteringen for UFULLSTENDIGE avganger (§4.3), og begge S-9-avgangene
    // er `complete` her.
    function summarize(run: RunDepartureResult, departEpochS: number) {
      const control: MemberOutcome = { ...run.members[0]!, memberIndex: 0 };
      return summarizeDeparture({
        departEpochS,
        control,
        members: run.members,
        expectedMembers: EXPECTED_MEMBERS,
        thresholds: [],
        stamp: STAMP,
      });
    }

    function assertPrediction(summaryA: ReturnType<typeof summarize>, summaryB: ReturnType<typeof summarize>): void {
      expect(summaryA.complete, "avgang A skal være complete (30/30 klassifisert)").toBe(true);
      expect(summaryB.complete, "avgang B skal være complete (30/30 klassifisert)").toBe(true);
      expect(summaryA.durationP50S, "avgang A har ingen gjennomførbare medlemmer").not.toBeNull();
      expect(summaryB.durationP50S, "avgang B har ingen gjennomførbare medlemmer").not.toBeNull();
      expect(summaryA.durationP90S).not.toBeNull();
      expect(summaryB.durationP90S).not.toBeNull();

      const p50Winner = summaryA.durationP50S! <= summaryB.durationP50S! ? "A" : "B";
      const p90Winner = summaryA.durationP90S! <= summaryB.durationP90S! ? "A" : "B";
      expect(p50Winner, `argmin P50 skal være ${S9_EXPECTED_ARGMIN_P50} (A=${summaryA.durationP50S}, B=${summaryB.durationP50S})`).toBe(
        S9_EXPECTED_ARGMIN_P50,
      );
      expect(p90Winner, `argmin P90 skal være ${S9_EXPECTED_ARGMIN_P90} (A=${summaryA.durationP90S}, B=${summaryB.durationP90S})`).toBe(
        S9_EXPECTED_ARGMIN_P90,
      );

      // Selve poenget med S-9 (D8.9): rangeringsalgoritmen (§4.3) bruker
      // P90, ikke P50, som primærnøkkel i robust-settet — den skal la seg
      // overbevise av avgang Bs bedre P90, IKKE av avgang As raskere median.
      const ranked = rankDepartures([summaryA, summaryB]);
      expect(ranked[0]?.summary.departEpochS).toBe(summaryB.departEpochS);
    }

    // Fullt sett — beviser den forhåndsregistrerte påstanden.
    const fullA = summarize(runA, fixture.departureA.departEpochS);
    const fullB = summarize(runB, fixture.departureB.departEpochS);
    assertPrediction(fullA, fullB);

    // Leave-one-out: for hver av de 30 medlemsindeksene, fjern medlemmet fra
    // BEGGE avganger og se at påstanden fortsatt holder. INGEN nye søk — de
    // 60 resultatene over gjenbrukes. `expectedMembers` settes til 29 for
    // LOO-settet, slik at avgangen fortsatt telles `complete`.
    for (let i = 1; i <= EXPECTED_MEMBERS; i++) {
      const looMembersA = runA.members.filter((m) => m.memberIndex !== i);
      const looMembersB = runB.members.filter((m) => m.memberIndex !== i);
      const summaryA = summarizeDeparture({
        departEpochS: fixture.departureA.departEpochS,
        control: { ...looMembersA[0]!, memberIndex: 0 },
        members: looMembersA,
        expectedMembers: EXPECTED_MEMBERS - 1,
        thresholds: [],
        stamp: STAMP,
      });
      const summaryB = summarizeDeparture({
        departEpochS: fixture.departureB.departEpochS,
        control: { ...looMembersB[0]!, memberIndex: 0 },
        members: looMembersB,
        expectedMembers: EXPECTED_MEMBERS - 1,
        thresholds: [],
        stamp: STAMP,
      });
      assertPrediction(summaryA, summaryB);
    }
  }, 600_000);
});
