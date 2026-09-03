/**
 * Ekte-vær rutemotor-Worker (fase 3 bølge 2C).
 *
 * Kjører ETT ensemble-medlem per melding: bygger et `WeatherField` fra en
 * transferred, kvantisert vind-payload (`@morild/weather`s
 * `windMemberLayersFromBytes` + `toWeatherField`, §15) og kaller SAMME
 * `planRoute`-søkekjerne som `routing.worker.ts`s hello-route-bevis —
 * ADR-0005 krever eksplisitt at ensemblet kaller samme søk som kontrollen,
 * aldri en egen "lettvekts"-motor. Flere instanser av denne workeren utgjør
 * worker-poolen (`../weather/ensemble.ts`, størrelse
 * `navigator.hardwareConcurrency`).
 *
 * Start-/mål-punkt, farbarhetsmaske og båtmodell hentes fra samme
 * golden-fikstur (`skjaeloy-skagen-apent`) som `routing.worker.ts` allerede
 * bruker — se `docs/specs/app-skjelett.md` §5.3/§5.4: fase 3 bølge 2C
 * bytter ut FELTET (syntetisk → ekte MEPS-vind), ikke masken/båten;
 * farbarhetsmaske er en egen, ennå ikke bygget spec (§2 i
 * `app-skjelett.md`). Dette er en dokumentert, midlertidig sammensetning —
 * ikke en påstand om at Skagerrak-land-karikaturen er den ekte
 * farbarhetsmasken.
 *
 * Eget TS-prosjekt (tsconfig.worker.json, WebWorker-lib) — meldingstypene
 * under er strukturelle kopier av `../weather/ensemble.ts`s typer, ikke
 * importert derfra (samme begrunnelse som `routing.worker.ts`s
 * toppkommentar: ulike TS-prosjekter/lib-sett kan ikke dele en fil på tvers
 * av rootDir-grensen).
 */
import { planRoute, type RouteResult } from "@morild/routing";
import { goldenScenarios } from "@morild/routing/test-fixtures/golden-scenarios";
import { toWeatherField, windMemberLayersFromBytes, type WeatherPackage } from "@morild/weather";
import type { PackageHeader } from "@morild/protocol";

const SCENARIO_NAME = "skjaeloy-skagen-apent";

export interface PlanRouteMemberRequest {
  readonly type: "plan-route-member";
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly windHeader: PackageHeader;
  /** Transferred — u+v konkatenert, `windMemberLayersFromBytes`-formatet (§15). */
  readonly windBuffer: ArrayBuffer;
  readonly departEpochS: number;
}

export type ToWorker = PlanRouteMemberRequest;

export interface PlanRouteMemberOk {
  readonly type: "plan-route-member-result";
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly result: RouteResult;
}

export interface PlanRouteMemberError {
  readonly type: "error";
  readonly memberIndex: number;
  readonly message: string;
}

export type FromWorker = PlanRouteMemberOk | PlanRouteMemberError;

function runMember(msg: PlanRouteMemberRequest): PlanRouteMemberOk {
  const scenario = goldenScenarios().find((candidate) => candidate.name === SCENARIO_NAME);
  if (!scenario) {
    throw new Error(`Fant ikke golden-scenario "${SCENARIO_NAME}"`);
  }
  const windMember = windMemberLayersFromBytes(new Uint8Array(msg.windBuffer));
  const pkg: WeatherPackage = {
    windMembers: [windMember],
    windHeader: msg.windHeader,
  };
  // memberIndex er alltid 0 i DENNE ett-medlems-pakken (§ adapter-
  // toppkommentar) — `isControl` overstyres eksplisitt fra meldingen, se
  // `weather-field-adapter.ts::ToWeatherFieldOptions.isControl`.
  const field = toWeatherField(pkg, 0, {
    departEpochS: msg.departEpochS,
    isControl: msg.isControl,
  });
  const result = planRoute({
    ...scenario.input,
    departEpochS: msg.departEpochS,
    weather: field,
  });
  return {
    type: "plan-route-member-result",
    memberIndex: msg.memberIndex,
    isControl: msg.isControl,
    result,
  };
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    self.postMessage(runMember(msg));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", memberIndex: msg.memberIndex, message } satisfies FromWorker);
  }
});
