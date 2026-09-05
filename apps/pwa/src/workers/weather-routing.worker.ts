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
import {
  DistanceField,
  buildFieldForInput,
  evaluateRoute,
  planRoute,
  type DistanceFieldData,
  type RouteResult,
} from "@morild/routing";
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
  /** Delt A*-felt fra kontrollen (robusthet.md §4.1) — strukturell kopi av `ensemble.ts`. */
  readonly sharedField?: SharedField | undefined;
  /** Omkjøring uten motorens egen Tub-bound (§4.1-ventilen, D9.2/D9.4) — settes av orkestratoren. */
  readonly noTubBound?: boolean | undefined;
}

/** Strukturell kopi av `ensemble.ts::SharedField` — se toppkommentaren. */
export interface SharedField {
  readonly key: string;
  readonly data: DistanceFieldData;
}

/**
 * Verste-først-orakelet (robusthet.md §4.1, D10.5): kontrollruten evaluert
 * i medlemmets vær med S1b-evaluatoren — millisekunder, og lovlig under
 * ADR-0005s rekkefølge-klausul fordi svaret KUN styrer i hvilken rekkefølge
 * medlemmene søkes, aldri et tall som vises. Strukturell kopi av
 * `../weather/ensemble.ts`.
 */
export interface EvaluateControlRequest {
  readonly type: "evaluate-control";
  readonly memberIndex: number;
  readonly tiles: readonly TileWindSource[];
  readonly departEpochS: number;
  /** Kontrollrutens steg som veipunkter (`steps[0]` = avgang). */
  readonly waypoints: readonly { readonly lat: number; readonly lon: number }[];
}

export interface EvaluateControlResult {
  readonly type: "evaluate-control-result";
  readonly memberIndex: number;
  readonly feasible: boolean;
  /** Evaluert seilingstid (s) fram til der evalueringen stoppet. */
  readonly durationS: number;
}

export type ToWorker = PlanRouteMemberRequest | EvaluateControlRequest;

export interface PlanRouteMemberOk {
  readonly type: "plan-route-member-result";
  readonly memberIndex: number;
  readonly isControl: boolean;
  readonly result: RouteResult;
  /** Kun fra kontrollen: feltet den bygde. */
  readonly sharedField?: SharedField | undefined;
  /** Nettbrett-målingen (D10.2 b): tid i workeren, delt opp. */
  readonly timing: WorkerTiming;
}

/** Strukturell kopi av `ensemble.ts::WorkerTiming`. Millisekunder, `performance.now()` i workeren. */
export interface WorkerTiming {
  /** `windMemberLayersFromBytes` + `toWeatherField` + `compositeWeatherField` for alle fliser. */
  readonly decodeMs: number;
  /** `buildFieldForInput` (kontrollen) eller rekonstruksjon fra delt felt (medlemmer). */
  readonly fieldMs: number;
  /** `planRoute` alene. */
  readonly searchMs: number;
}

export interface PlanRouteMemberError {
  readonly type: "error";
  readonly memberIndex: number;
  readonly message: string;
}

export type FromWorker = PlanRouteMemberOk | PlanRouteMemberError | EvaluateControlResult;

function scenarioOrThrow() {
  const scenario = goldenScenarios().find((candidate) => candidate.name === SCENARIO_NAME);
  if (!scenario) {
    throw new Error(`Fant ikke golden-scenario "${SCENARIO_NAME}"`);
  }
  return scenario;
}

/** Orakelet: kontrollruten seilt i medlemmets vær (S1b-evaluator). Aldri et tall til UI. */
function evaluateControl(msg: EvaluateControlRequest): EvaluateControlResult {
  const scenario = scenarioOrThrow();
  if (msg.tiles.length === 0 || msg.waypoints.length < 2) {
    throw new Error("evaluate-control: mangler vinddata eller veipunkter");
  }
  const weather = decodeWeather(msg.tiles, msg.departEpochS, false);
  const evaluation = evaluateRoute({
    waypoints: msg.waypoints,
    departEpochS: msg.departEpochS,
    weather,
    mask: scenario.input.mask,
    boat: scenario.input.boat,
    options: scenario.input.options,
  });
  return {
    type: "evaluate-control-result",
    memberIndex: msg.memberIndex,
    feasible: evaluation.feasible,
    durationS: evaluation.arrivalEpochS - msg.departEpochS,
  };
}

function decodeWeather(
  tiles: readonly TileWindSource[],
  departEpochS: number,
  isControl: boolean,
): WeatherFieldLike {
  const tileFields: WeatherFieldLike[] = tiles.map((tile) => {
    const windMember = windMemberLayersFromBytes(new Uint8Array(tile.windBuffer));
    const pkg: WeatherPackage = {
      windMembers: [windMember],
      windHeader: tile.windHeader,
    };
    return toWeatherField(pkg, 0, { departEpochS, isControl });
  });
  return compositeWeatherField(tileFields);
}

function runMember(msg: PlanRouteMemberRequest): PlanRouteMemberOk {
  const scenario = scenarioOrThrow();
  if (msg.tiles.length === 0) {
    throw new Error("plan-route-member: meldingen manglet vinddata for alle fliser");
  }
  const tDecode0 = performance.now();
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
  const weather = compositeWeatherField(tileFields);
  const decodeMs = performance.now() - tDecode0;
  const input = {
    ...scenario.input,
    departEpochS: msg.departEpochS,
    weather,
  };
  // Delt A*-felt (robusthet.md §4.1, D8.2): kontrollen bygger feltet med
  // NØYAKTIG samme parametre som søket selv ville brukt
  // (`buildFieldForInput`) og sender `DistanceFieldData` tilbake;
  // medlemmene rekonstruerer det. Bit-identisk med/uten felt er bevist i
  // `packages/routing/src/shared-field.test.ts`. Tub-bound deles IKKE
  // (skademåling 2026-09-04: null gevinst, netto tap — se robusthet.md §6.3).
  //
  // Feltet er kun gyldig for ett (start, mål, maske)-triplett. Nøkkelen
  // binder det strukturelt: stemmer ikke medlemmets egen nøkkel med
  // kontrollens, bygges feltet på nytt i stedet for å bruke feil felt.
  const fieldKey = sharedFieldKey(SCENARIO_NAME, input.start, input.dest);
  const reusable = msg.sharedField !== undefined && msg.sharedField.key === fieldKey;
  const tField0 = performance.now();
  const distanceField = reusable
    ? new DistanceField(msg.sharedField!.data)
    : buildFieldForInput(input);
  const fieldMs = performance.now() - tField0;
  const tSearch0 = performance.now();
  const result = planRoute({
    ...input,
    ...(distanceField !== undefined ? { field: distanceField } : {}),
    ...(msg.noTubBound === true ? { noTubBound: true } : {}),
  });
  const searchMs = performance.now() - tSearch0;
  return {
    type: "plan-route-member-result",
    memberIndex: msg.memberIndex,
    isControl: msg.isControl,
    result,
    timing: { decodeMs, fieldMs, searchMs },
    ...(msg.isControl && distanceField !== undefined
      ? { sharedField: { key: fieldKey, data: distanceField.data } }
      : {}),
  };
}

/**
 * Nøkkelen for et delt felt: scenario (= maskeidentitet inntil
 * farbarhetsmasken får egen versjon, se toppkommentaren) + start/mål
 * avrundet til 1e-6°. Samme regel må gjelde på begge sider av meldingen.
 */
export function sharedFieldKey(
  maskId: string,
  start: { readonly lat: number; readonly lon: number },
  dest: { readonly lat: number; readonly lon: number },
): string {
  const r = (x: number): string => x.toFixed(6);
  return `${maskId}|${r(start.lat)},${r(start.lon)}|${r(dest.lat)},${r(dest.lon)}`;
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    self.postMessage(msg.type === "evaluate-control" ? evaluateControl(msg) : runMember(msg));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", memberIndex: msg.memberIndex, message } satisfies FromWorker);
  }
});
