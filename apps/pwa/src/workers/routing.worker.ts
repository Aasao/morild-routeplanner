/**
 * Rutemotor-Worker (ADR-0002: ruteberegning kjører alltid på klienten, i
 * en Web Worker — aldri i `apps/worker`). Denne bølgen kjører kun
 * golden-fiksturen "skjaeloy-skagen-apent" som "hello route" — se
 * docs/specs/app-skjelett.md §5.3/§5.4.
 *
 * Eget TS-prosjekt (tsconfig.worker.json, WebWorker-lib) — kan derfor ikke
 * importere typer fra hovedtrådens `../hello-route.ts` (DOM-lib) uten å
 * krysse rootDir-grensen. Meldingstypen under er en strukturell, ikke
 * nominell, kopi — hold i synk manuelt hvis formen endres.
 */
import { planRoute } from "@morild/routing";
import { goldenScenarios } from "@morild/routing/test-fixtures/golden-scenarios";

const SCENARIO_NAME = "skjaeloy-skagen-apent";

interface ToWorker {
  readonly type: "run-hello-route";
}

type FromWorker =
  | {
      readonly type: "hello-route-result";
      readonly scenario: string;
      readonly purpose: string;
      readonly reached: boolean;
      readonly steps: readonly { readonly lat: number; readonly lon: number }[];
      readonly totals: { readonly durationS: number; readonly distanceNm: number };
    }
  | { readonly type: "error"; readonly message: string };

function runHelloRoute(): FromWorker {
  const scenario = goldenScenarios().find((candidate) => candidate.name === SCENARIO_NAME);
  if (!scenario) {
    throw new Error(`Fant ikke golden-scenario "${SCENARIO_NAME}"`);
  }
  const result = planRoute(scenario.input);
  return {
    type: "hello-route-result",
    scenario: scenario.name,
    purpose: scenario.purpose,
    reached: result.reached,
    steps: result.steps.map((step) => ({ lat: step.lat, lon: step.lon })),
    totals: {
      durationS: result.totals.durationS,
      distanceNm: result.totals.distanceNm,
    },
  };
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  if (event.data.type !== "run-hello-route") {
    return;
  }
  try {
    self.postMessage(runHelloRoute());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", message } satisfies FromWorker);
  }
});
