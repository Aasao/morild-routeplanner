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
  bailoutProfile,
  buildFieldForInput,
  buildHarbourField,
  evaluateRoute,
  harbourFieldVmaxKn,
  planRoute,
  type BailoutProfile,
  type BoatModel,
  type DistanceFieldData,
  type HarbourField,
  type NavigabilityMask,
  type RouteOptions,
  type RouteResult,
} from "@morild/routing";
import { INTERIM_HARBOUR_BOOK } from "@morild/routing/test-fixtures/harbour-book";
import { goldenScenarios } from "@morild/routing/test-fixtures/golden-scenarios";
import {
  coastalMaskFromBytes,
  compositeWeatherField,
  currentLayersFromBytes,
  toWeatherField,
  windMemberLayersFromBytes,
  withWavePoints,
  type WavePointSet,
  type WeatherFieldLike,
  type WeatherPackage,
} from "@morild/weather";
import type { PackageHeader } from "@morild/protocol";
import { withCruisingFactor, withCurrentScale } from "@morild/robustness";

const SCENARIO_NAME = "skjaeloy-skagen-apent";

/** Strukturell kopi av `../weather/ensemble.ts::TileWindSource` — se toppkommentaren. */
export interface TileWindSource {
  readonly tileId: string;
  readonly windHeader: PackageHeader;
  /** Transferred — u+v konkatenert, `windMemberLayersFromBytes`-formatet (§15). */
  readonly windBuffer: ArrayBuffer;
  /** Delt NorKyst-strøm (u+v, `currentLayersFromBytes`) — kopiert, ikke transferred. */
  readonly currentHeader?: PackageHeader | undefined;
  readonly currentBuffer?: ArrayBuffer | undefined;
  /** Kystmasken for strømmen (D15.2, `coastalMaskFromBytes`). */
  readonly coastalBuffer?: ArrayBuffer | undefined;
}

/**
 * Én flis → ett `WeatherFieldLike`: medlemmets vind + flisens delte strøm og
 * kystmaske når de finnes (`memberIndex` er alltid 0 i DENNE ett-medlems-
 * pakken — `isControl` overstyres eksplisitt, se `weather-field-adapter.ts::
 * ToWeatherFieldOptions.isControl`).
 */
function tileField(tile: TileWindSource, departEpochS: number, isControl: boolean): WeatherFieldLike {
  const windMember = windMemberLayersFromBytes(new Uint8Array(tile.windBuffer));
  // Strøm brukes KUN sammen med kystmasken (D15.2): strøm uten maske ville
  // gitt kystnære verdier uten `STROM_KYSTSONE`-merking. `screenTiles`
  // håndhever det samme i hovedtråden; her håndheves det på bruksstedet.
  const withCurrent = tile.currentBuffer !== undefined && tile.coastalBuffer !== undefined;
  const pkg: WeatherPackage = {
    windMembers: [windMember],
    windHeader: tile.windHeader,
    ...(withCurrent
      ? {
          current: currentLayersFromBytes(new Uint8Array(tile.currentBuffer!)),
          currentCoastal: coastalMaskFromBytes(new Uint8Array(tile.coastalBuffer!)),
        }
      : {}),
    ...(withCurrent && tile.currentHeader !== undefined ? { currentHeader: tile.currentHeader } : {}),
  };
  return toWeatherField(pkg, 0, { departEpochS, isControl });
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
  /** Perturbasjon (§4.4, D8.4 c): cruising-faktor på båten eller skalering av strømmen. Strukturell kopi av `ensemble.ts`. */
  readonly perturbation?: { readonly kind: "cruising" | "current"; readonly factor: number } | undefined;
  /** Pool-plassen (robusthet.md §6.4, D13.2 a) — ekkoes i `WorkerTiming.workerSlot`. Strukturell kopi av `ensemble.ts`. */
  readonly workerSlot?: number | undefined;
  /** Fryst punktbølge (ADR-0007) — samme sett for alle jobbene i kjøringen. Strukturell kopi av `ensemble.ts`. */
  readonly wavePoints?: WavePointSet | undefined;
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
  /** Fryst punktbølge (ADR-0007). */
  readonly wavePoints?: WavePointSet | undefined;
}

export interface EvaluateControlResult {
  readonly type: "evaluate-control-result";
  readonly memberIndex: number;
  readonly feasible: boolean;
  /** Evaluert seilingstid (s) fram til der evalueringen stoppet. */
  readonly durationS: number;
}

export type ToWorker = PlanRouteMemberRequest | EvaluateControlRequest | BailoutProfileRequest;

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

/**
 * Bail-out-profilen (robusthet.md §4.5) bes om SEPARAT etter at kontroll-
 * resultatet er levert — den koster ~20 s på ekte vær (målt 2026-09-07,
 * 40 R2-søk), og progressiv semantikk (F3.5) krever at kontrollruten står
 * på skjermen på sekunder. Workeren husker sitt siste kontrollsøk.
 * Strukturell kopi av `ensemble.ts`.
 */
export interface BailoutProfileRequest {
  readonly type: "bailout-profile";
  readonly memberIndex: number;
}

export interface BailoutProfileResult {
  readonly type: "bailout-profile-result";
  readonly memberIndex: number;
  readonly bailout: BailoutProfile;
  readonly bailoutMs: number;
}

/** Strukturell kopi av `ensemble.ts::WorkerTiming`. Millisekunder, `performance.now()` i workeren. */
export interface WorkerTiming {
  /** `windMemberLayersFromBytes` + `toWeatherField` + `compositeWeatherField` for alle fliser. */
  readonly decodeMs: number;
  /** `buildFieldForInput` (kontrollen) eller rekonstruksjon fra delt felt (medlemmer). */
  readonly fieldMs: number;
  /** `planRoute` alene. */
  readonly searchMs: number;
  /**
   * `performance.memory.usedJSHeapSize` i DENNE Worker-konteksten etter
   * søket, MB med én desimal (§6.4, D13.2 a). `null` når API-et ikke finnes
   * her — ingen antakelse om at det gjør det (Chromium eksponerer det ikke
   * nødvendigvis i Workere).
   */
  readonly workerHeapMB: number | null;
  /** Ekko av `PlanRouteMemberRequest.workerSlot`; `null` for kontroll-Workeren. */
  readonly workerSlot: number | null;
}

export interface PlanRouteMemberError {
  readonly type: "error";
  readonly memberIndex: number;
  readonly message: string;
}

export type FromWorker = PlanRouteMemberOk | PlanRouteMemberError | EvaluateControlResult | BailoutProfileResult;

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
  const weather = decodeWeather(msg.tiles, msg.departEpochS, false, msg.wavePoints);
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

/**
 * Flisene sydd sammen, med punktbølgen lagt på ETTER sammensyingen
 * (`docs/specs/punktbolge.md` §3): punktene er ikke flisbundet, og samme
 * fryste sett skal gjelde uansett hvilken flis et punkt havner i.
 */
function decodeWeather(
  tiles: readonly TileWindSource[],
  departEpochS: number,
  isControl: boolean,
  wavePoints: WavePointSet | undefined,
): WeatherFieldLike {
  const composite = compositeWeatherField(tiles.map((tile) => tileField(tile, departEpochS, isControl)));
  return wavePoints === undefined ? composite : withWavePoints(composite, wavePoints);
}

function runMember(msg: PlanRouteMemberRequest): PlanRouteMemberOk {
  const scenario = scenarioOrThrow();
  if (msg.tiles.length === 0) {
    throw new Error("plan-route-member: meldingen manglet vinddata for alle fliser");
  }
  const tDecode0 = performance.now();
  // Sy sammen per-flis-feltene til ETT felt (funn 2): rutens punkter kan
  // falle i hvilken som helst av rutens fliser, og motoren vet ikke noe om
  // fliser i det hele tatt — den ser bare ett `WeatherField`. Punktbølgen
  // (fryst, ADR-0007) legges på etter sammensyingen.
  const composite = decodeWeather(msg.tiles, msg.departEpochS, msg.isControl, msg.wavePoints);
  const decodeMs = performance.now() - tDecode0;
  // Perturbasjon (§4.4): rene dekoratorer rundt båt/vær — samme fulle søk
  // med samme opsjoner, bare en annen båt eller et annet hav.
  const pert = msg.perturbation;
  const weather = pert?.kind === "current" ? withCurrentScale(composite, pert.factor) : composite;
  const boat = pert?.kind === "cruising" ? withCruisingFactor(scenario.input.boat, pert.factor) : scenario.input.boat;
  const input = {
    ...scenario.input,
    departEpochS: msg.departEpochS,
    weather,
    boat,
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

  // Kontrollsøket huskes så bail-out-profilen kan bes om etterpå uten å
  // søke på nytt (progressiv semantikk: kontrollruten først, profilen
  // som egen fase — se `BailoutProfileRequest`).
  if (msg.isControl && pert === undefined) {
    lastControl = { result, weather, boat, mask: input.mask, options: input.options, departEpochS: msg.departEpochS };
  }
  return {
    type: "plan-route-member-result",
    memberIndex: msg.memberIndex,
    isControl: msg.isControl,
    result,
    timing: { decodeMs, fieldMs, searchMs, workerHeapMB: workerHeapMB(), workerSlot: msg.workerSlot ?? null },
    ...(msg.isControl && distanceField !== undefined
      ? { sharedField: { key: fieldKey, data: distanceField.data } }
      : {}),
  };
}

/** Se `WorkerTiming.workerHeapMB`. Ikke-standard, Chromium-only API — derfor den smale strukturelle casten. */
function workerHeapMB(): number | null {
  const memory = (performance as unknown as { readonly memory?: { readonly usedJSHeapSize?: unknown } }).memory;
  const used = memory?.usedJSHeapSize;
  return typeof used === "number" && Number.isFinite(used) ? Math.round((used / (1024 * 1024)) * 10) / 10 : null;
}

interface LastControl {
  readonly result: RouteResult;
  readonly weather: WeatherFieldLike;
  readonly boat: BoatModel;
  readonly mask: NavigabilityMask | undefined;
  readonly options: Partial<RouteOptions> | undefined;
  readonly departEpochS: number;
}
let lastControl: LastControl | null = null;

/**
 * Bail-out-profil (robusthet.md §4.5, F4.6) for siste kontrollsøk i denne
 * workeren: kontrollvær, interim-havnebok — merket «ikke ensemble-sjekket».
 */
function runBailoutProfile(msg: BailoutProfileRequest): BailoutProfileResult {
  const c = lastControl;
  if (c === null) {
    throw new Error("bailout-profile: ingen kontrollrute i denne workeren ennå");
  }
  const tB0 = performance.now();
  const vmaxKn = harbourFieldVmaxKn(c.boat, c.weather);
  const fields = harbourFieldsFor(vmaxKn, c.mask);
  const bailout = bailoutProfile({
    route: { steps: c.result.steps, legs: c.result.legs },
    departEpochS: c.departEpochS,
    weather: c.weather,
    mask: c.mask,
    boat: c.boat,
    book: INTERIM_HARBOUR_BOOK,
    fields,
    options: c.options,
  });
  return { type: "bailout-profile-result", memberIndex: msg.memberIndex, bailout, bailoutMs: performance.now() - tB0 };
}

/**
 * Havnefeltene (D8.10) er væruavhengige og bygges én gang per worker-liv
 * per (maske, vmaxKn) — 8 havner tar ~0,1 s (kostnadsmålingen
 * `bailout-cost.damage.test.ts`). `vmaxKn` avhenger av pakkens maksvind, så
 * nøkkelen tar den med (avrundet, så støy i siste desimal ikke bygger på
 * nytt).
 */
const harbourFieldCache = new Map<string, ReadonlyMap<string, HarbourField>>();

function harbourFieldsFor(
  vmaxKn: number,
  mask: Parameters<typeof buildHarbourField>[1],
): ReadonlyMap<string, HarbourField> {
  const key = `${SCENARIO_NAME}|${vmaxKn.toFixed(2)}`;
  const cached = harbourFieldCache.get(key);
  if (cached !== undefined) return cached;
  const fields = new Map<string, HarbourField>();
  for (const harbour of INTERIM_HARBOUR_BOOK) {
    fields.set(harbour.id, buildHarbourField(harbour, mask, { vmaxKn, maskVersion: SCENARIO_NAME }));
  }
  harbourFieldCache.set(key, fields);
  return fields;
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
    self.postMessage(
      msg.type === "evaluate-control"
        ? evaluateControl(msg)
        : msg.type === "bailout-profile"
          ? runBailoutProfile(msg)
          : runMember(msg),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", memberIndex: msg.memberIndex, message } satisfies FromWorker);
  }
});
