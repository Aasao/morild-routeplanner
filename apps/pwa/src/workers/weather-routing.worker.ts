/**
 * Ekte-vær rutemotor-Worker (fase 3 bølge 2C).
 *
 * Kjører ETT ensemble-medlem per melding: bygger ETT `WeatherField` PER
 * FLIS fra transferred, kvantiserte vind-payloader (`@morild/weather`s
 * `windMemberLayersFromBytes` + `toWeatherField`, §15), syr dem sammen med
 * `compositeWeatherField` (review-funn fase 3 bølge 2, funn 2: en rute kan
 * krysse en flisgrense, §7 — `tile-select.ts` laster da flere fliser for
 * samme medlem), og kaller SAMME `planRoute`-søkekjerne som
 * `routing.worker.ts`s hello-route-bevis — ADR-0005 krever eksplisitt at
 * ensemblet kaller samme søk som kontrollen, aldri en egen "lettvekts"-
 * motor. Flere instanser av denne workeren utgjør worker-poolen
 * (`../weather/ensemble.ts`, størrelse `navigator.hardwareConcurrency`).
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
import {
  compositeWeatherField,
  toWeatherField,
  windMemberLayersFromBytes,
  type WeatherFieldLike,
  type WeatherPackage,
} from "@morild/weather";
import type { PackageHeader } from "@morild/protocol";

const SCENARIO_NAME = "skjaeloy-skagen-apent";

/** Strukturell kopi av `../weather/ensemble.ts::TileWindSource` — se toppkommentaren. */
export interface TileWindSource {
  readonly tileId: string;
  readonly windHeader: PackageHeader;
  /** Transferred — u+v konkatenert, `windMemberLayersFromBytes`-formatet (§15). */
  readonly windBuffer: ArrayBuffer;
}

export interface PlanRouteMemberRequest {
  readonly type: "plan-route-member";
  readonly memberIndex: number;
  readonly isControl: boolean;
  /** Én kilde per flis som dekker ruten OG har dette medlemmet (§7). */
  readonly tiles: readonly TileWindSource[];
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
  if (msg.tiles.length === 0) {
    throw new Error("plan-route-member: meldingen manglet vinddata for alle fliser");
  }
  const tileFields: WeatherFieldLike[] = msg.tiles.map((tile) => {
    const windMember = windMemberLayersFromBytes(new Uint8Array(tile.windBuffer));
    const pkg: WeatherPackage = {
      windMembers: [windMember],
      windHeader: tile.windHeader,
    };
    // memberIndex er alltid 0 i DENNE ett-medlems-pakken (§ adapter-
    // toppkommentar) — `isControl` overstyres eksplisitt fra meldingen, se
    // `weather-field-adapter.ts::ToWeatherFieldOptions.isControl`.
    return toWeatherField(pkg, 0, {
      departEpochS: msg.departEpochS,
      isControl: msg.isControl,
    });
  });
  // Sy sammen per-flis-feltene til ETT felt (funn 2): rutens punkter kan
  // falle i hvilken som helst av rutens fliser, og motoren vet ikke noe om
  // fliser i det hele tatt — den ser bare ett `WeatherField`.
  const field = compositeWeatherField(tileFields);
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
