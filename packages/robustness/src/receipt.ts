/**
 * Prognose-kvittering (`docs/specs/robusthet.md` §3.6, §5.7, D8.12).
 *
 * Skrives når Magnus faktisk seiler på en plan; fryser sammendraget slik
 * det så ut DA, slik at det kan etterprøves mot hva som faktisk skjedde
 * (`realized`, satt seinere, aldri overskrevet).
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 * `plannedAtEpochS` mottas som argument — denne pakken leser aldri
 * systemklokken selv.
 */
import type { BailoutProfile } from "@morild/routing";
import type { DecisionAdvice } from "./decision-rule.js";
import type { OutcomeKind } from "./outcome.js";
import type { DepartureSummary, RobustnessStamp } from "./summary.js";

/**
 * `DepartureSummary` uten `members`/`control` — de fulle utfallslistene
 * (som kan bære hele `RouteResult`-er, §6.2) fryses IKKE i kvitteringen;
 * `memberKinds`/`memberArrivalEpochS` under bærer akkurat det som trengs
 * for reliability-analysen uten å duplisere de tunge feltene.
 */
export type FrozenDepartureSummary = Omit<DepartureSummary, "members" | "control">;

export interface PlanReceiptRealized {
  readonly arrivalEpochS: number | null;
  readonly aborted: boolean;
  readonly note?: string;
}

export interface PlanReceipt {
  readonly plannedAtEpochS: number;
  readonly departEpochS: number;
  readonly stamp: RobustnessStamp;
  readonly summary: FrozenDepartureSummary;
  /** `members[i].kind`, samme rekkefølge som `DepartureSummary.members` (sortert på `memberIndex`). */
  readonly memberKinds: readonly OutcomeKind[];
  /** `members[i].summary?.arrivalEpochS ?? null`, samme rekkefølge. */
  readonly memberArrivalEpochS: readonly (number | null)[];
  readonly advice: DecisionAdvice;
  readonly bailout: Pick<BailoutProfile, "longestGapS" | "coverage" | "basis">;
  /** Fylles inn etterpå, aldri overskrevet: faktisk ankomst eller avbrudd. Kan kun settes én gang (§5.7). */
  readonly realized?: PlanReceiptRealized;
}

export interface CreatePlanReceiptInput {
  readonly plannedAtEpochS: number;
  readonly summary: DepartureSummary;
  readonly advice: DecisionAdvice;
  readonly bailout: BailoutProfile;
}

/**
 * Fjerner `members`/`control` fra et `DepartureSummary` uten å måtte
 * navngi (og dermed la stå ubrukt) noen av de to feltene selv — robust mot
 * at `DepartureSummary` får flere felt senere.
 */
function omitMembersAndControl(summary: DepartureSummary): FrozenDepartureSummary {
  const clone: Record<string, unknown> = { ...summary };
  delete clone["members"];
  delete clone["control"];
  // Type-escape er bevisst: vi har nettopp fjernet nøyaktig de to feltene
  // `Omit<DepartureSummary, "members" | "control">` utelater.
  return clone as unknown as FrozenDepartureSummary;
}

/** Fryser et `DepartureSummary` til en `PlanReceipt` (§3.6, §5.7). */
export function createPlanReceipt(input: CreatePlanReceiptInput): PlanReceipt {
  const members = input.summary.members;
  return {
    plannedAtEpochS: input.plannedAtEpochS,
    departEpochS: input.summary.departEpochS,
    stamp: input.summary.stamp,
    summary: omitMembersAndControl(input.summary),
    memberKinds: members.map((m) => m.kind),
    memberArrivalEpochS: members.map((m) => m.summary?.arrivalEpochS ?? null),
    advice: input.advice,
    bailout: {
      longestGapS: input.bailout.longestGapS,
      coverage: input.bailout.coverage,
      basis: input.bailout.basis,
    },
  };
}

/**
 * Setter `realized` på en kvittering. Kaster hvis `receipt.realized`
 * allerede finnes — §5.7: «kan bare settes én gang». Returnerer en NY
 * kvittering (immutabel); overskriver aldri objektet den fikk inn.
 */
export function realizeReceipt(receipt: PlanReceipt, realized: PlanReceiptRealized): PlanReceipt {
  if (receipt.realized !== undefined) {
    throw new Error("PlanReceipt.realized kan bare settes én gang (§5.7)");
  }
  return { ...receipt, realized };
}

/** Sorterer nøklene i et objekt rekursivt (arrayer beholder sin rekkefølge). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * `PlanReceipt` som JSON-stabil streng (§5.7): samme kvittering, uansett
 * nøkkelrekkefølgen den ble bygget i, gir identisk streng — nøklene
 * sorteres rekursivt før `JSON.stringify`.
 */
export function receiptToJson(receipt: PlanReceipt): string {
  return JSON.stringify(sortKeysDeep(receipt));
}
