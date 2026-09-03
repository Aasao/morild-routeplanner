/**
 * Ende-til-ende-integrasjonstest (oppdragets punkt 5): pakke-peker → Cache
 * API → transferert `ArrayBuffer` → dekoding (`@morild/weather`) →
 * `planRoute` (`@morild/routing`) på EKTE (syntetisk, men reelt kvantisert)
 * vær — med mocket `fetch`/`caches`, ingen ekte nettverk, ingen ekte Web
 * Worker-tråd.
 *
 * **`workerFactory` her utfører VIRKELIG arbeid** (dekoding + `planRoute`),
 * bare uten en faktisk `Worker`-tråd (samme prinsipp som
 * `packages/weather/src/golden-bridge.test.ts`s `packAndDecode`, gjenbrukt
 * på selve pakke-formatet i stedet for en hånd-bygget `Layer`) — dette gir
 * ekte dekning av hele kjeden, ikke bare et mock-basert kontraktsbevis.
 *
 * **Funn under bygging av denne testen (dokumentert, ikke stille rettet):**
 * `packages/routing/src/search.ts::environmentAt` setter
 * `weatherPartial = true` (⇒ `coverage.weather === "partial"`) så snart
 * `waves === undefined || current === undefined` I ETT ENESTE punkt — ikke
 * bare når et medlems tidshorisont faktisk går tom. Med DAGENS vind-only
 * pakke (ingen strøm-/bølgefelt i det hele tatt) blir derfor coverage
 * ALLTID "partial" for ALLE medlemmer, også kontrollen — ikke bare for
 * medlemmer som treffer 48 t-horisonten. ADR-0005s inkonklusiv-regel
 * («coverage.weather === "partial" ⇒ inkonklusiv») er derfor, mekanisk
 * anvendt på en vind-only-pakke, sant for HELE ensemblet — F4.2s
 * gjennomførbarhetsandel er ikke meningsfull før strøm/bølge faktisk
 * finnes i pakken (`tools/weather-pack`s README bekrefter disse feltene
 * ikke er wiret opp ennå). Dette er ærlig (N2), men verdt å vite for
 * `docs/specs/robusthet.md` (fase 4). Se rapporten til Magnus.
 *
 * Testene under isolerer derfor de to fenomenene i separate scenarioer:
 * (1) vind-only-pakken, slik den faktisk er i dag — viser at manglende
 *     strøm/bølge er synlig som flagg OG korrekt gjør HELE resultatet
 *     inkonklusivt (ikke stille "gjennomførbart").
 * (2) en pakke MED (konstant, i minnet — ikke over transferable bytes,
 *     siden strøm-/bølge-byte-formatet ikke er produsert av
 *     `tools/weather-pack` ennå) strøm+bølger, der KUN vind-horisonten er
 *     kort — isolerer ADR-0005s medlemshorisont-mekanisme rendyrket.
 */
import { describe, expect, it } from "vitest";
import { goldenScenarios } from "@morild/routing/test-fixtures/golden-scenarios";
import { planRoute } from "@morild/routing";
import {
  buildLayer,
  buildLayerLookup,
  serializeLayer,
  toWeatherField,
  windMemberLayersFromBytes,
  windToUV,
  type CurrentLayers,
  type LayerGeometry,
  type WaveLayers,
  type WeatherPackage,
} from "@morild/weather";
import type { PackageHeader } from "@morild/protocol";
import { DEFAULT_APP_CONFIG } from "./config.js";
import { runWeatherPipeline, type PipelineDeps } from "./pipeline.js";
import { FakeCacheStorage } from "./test-support/fake-cache-storage.js";
import { allDisplayFlags } from "./route-flags.js";
import type { WeatherPointer } from "./pointer-types.js";
import type { EnsembleSummary, FromWorker, MemberOutcome, PlanRouteMemberRequest, WorkerLike } from "./ensemble.js";
import type { FieldPresenceStatus } from "./field-status.js";
import type { MetAlertsLoadResult } from "./metalerts-client.js";
import type { RelevantAlert } from "./metalerts.js";

const CONFIG = { ...DEFAULT_APP_CONFIG, apiBase: "http://localhost" };

const scenario = goldenScenarios().find((s) => s.name === "skjaeloy-skagen-apent")!;
const trueWind = scenario.input.weather;

/** Samme BBOX/oppløsning som `packages/weather/src/golden-bridge.test.ts` — bevist tilstrekkelig til at søket fullfører identisk med det ubegrensede analytiske feltet. */
const BBOX = { latMin: 56.4, latMax: 60.4, lonMin: 7.8, lonMax: 12.8 };
const NODE_STEP_DEG = 0.1;
function nodeCount(min: number, max: number, step: number): number {
  return Math.round((max - min) / step) + 1;
}
function geometry(t0S: number, hours: number): LayerGeometry {
  return {
    latMin: BBOX.latMin,
    lonMin: BBOX.lonMin,
    latStepDeg: NODE_STEP_DEG,
    lonStepDeg: NODE_STEP_DEG,
    nodesLat: nodeCount(BBOX.latMin, BBOX.latMax, NODE_STEP_DEG),
    nodesLon: nodeCount(BBOX.lonMin, BBOX.lonMax, NODE_STEP_DEG),
    tileNodes: 32,
    t0S,
    dtS: 3600,
    timeSteps: hours + 1,
  };
}

/** Bygger én vind-medlems R2-blob (u+v konkatenert, `tools/weather-pack`s faktiske byte-layout) fra det ekte golden-feltet, for `hours` timer. */
function buildWindMemberBytes(hours: number): Uint8Array {
  const g = geometry(trueWind.validFromS, hours);
  const uLayer = buildLayer({
    sample: (lat, lon, epochS) => {
      const w = trueWind.wind(lat, lon, epochS);
      return w === undefined ? undefined : windToUV(w.speedKn, w.fromDeg)[0];
    },
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const vLayer = buildLayer({
    sample: (lat, lon, epochS) => {
      const w = trueWind.wind(lat, lon, epochS);
      return w === undefined ? undefined : windToUV(w.speedKn, w.fromDeg)[1];
    },
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const uBytes = serializeLayer(uLayer, { deltaCoded: true });
  const vBytes = serializeLayer(vLayer, { deltaCoded: true });
  const out = new Uint8Array(uBytes.length + vBytes.length);
  out.set(uBytes, 0);
  out.set(vBytes, uBytes.length);
  return out;
}

/**
 * Konstant strøm+bølger, i minnet — IKKE over transferable bytes.
 * `tools/weather-pack` produserer ikke strøm-/bølge-byte-formatet ennå
 * (README: "IKKE wiret opp i denne bølgen"), så det finnes ingen reell
 * ledningsformat å teste mot her. Brukt KUN i test 2 for å isolere
 * ADR-0005s medlemshorisont-mekanisme fra "felt mangler helt"-fenomenet
 * (se toppkommentaren).
 */
function constantCurrentAndWaves(hours: number): { current: CurrentLayers; waves: WaveLayers } {
  const g = geometry(trueWind.validFromS, hours);
  const uLayer = buildLayer({
    sample: () => 0.1,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const vLayer = buildLayer({
    sample: () => 0.05,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
  });
  const hsLayer = buildLayer({
    sample: () => 0.5,
    geometryBase: g,
    bitsPerSample: 8,
    roundingMode: "up",
    channelKind: "linear",
  });
  return {
    current: { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) },
    waves: { hs: buildLayerLookup(hsLayer) },
  };
}

function header(overrides: Partial<PackageHeader> = {}): PackageHeader {
  return {
    formatVersion: "1.0.0",
    producedAt: "2026-09-03T00:00:00Z",
    model: "MEPS",
    init: new Date(trueWind.validFromS * 1000).toISOString(),
    resolution: "2.5km",
    sourceStatus: { status: "ok" },
    ...overrides,
  };
}

/**
 * `workerFactory`-dobbel som gjør EKTE arbeid (dekoding + `planRoute`) —
 * se toppkommentaren. Farbarhetsmaske/båt/start/mål kommer fra samme
 * golden-fikstur som den ekte `weather-routing.worker.ts` bruker.
 * `sharedFields` (valgfri) sprøytes inn som pakkens strøm/bølge — se
 * `constantCurrentAndWaves`s kommentar for hvorfor dette ikke går via
 * transferable bytes slik vind gjør.
 */
function realWorkFakeWorker(sharedFields?: { current?: CurrentLayers; waves?: WaveLayers }): WorkerLike {
  let messageListener: ((ev: MessageEvent<FromWorker>) => void) | undefined;
  return {
    postMessage(message: PlanRouteMemberRequest) {
      queueMicrotask(() => {
        try {
          const windMember = windMemberLayersFromBytes(new Uint8Array(message.windBuffer));
          const pkg: WeatherPackage = {
            windMembers: [windMember],
            windHeader: message.windHeader,
            ...(sharedFields?.current ? { current: sharedFields.current } : {}),
            ...(sharedFields?.waves ? { waves: sharedFields.waves } : {}),
          };
          const field = toWeatherField(pkg, 0, {
            departEpochS: message.departEpochS,
            isControl: message.isControl,
          });
          const result = planRoute({ ...scenario.input, departEpochS: message.departEpochS, weather: field });
          const ok: FromWorker = {
            type: "plan-route-member-result",
            memberIndex: message.memberIndex,
            isControl: message.isControl,
            result,
          };
          messageListener?.({ data: ok } as MessageEvent<FromWorker>);
        } catch (err) {
          const errMsg: FromWorker = {
            type: "error",
            memberIndex: message.memberIndex,
            message: err instanceof Error ? err.message : String(err),
          };
          messageListener?.({ data: errMsg } as MessageEvent<FromWorker>);
        }
      });
    },
    addEventListener(type, listener) {
      if (type === "message") messageListener = listener as (ev: MessageEvent<FromWorker>) => void;
    },
    terminate() {
      /* no-op */
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

interface Harness {
  readonly deps: PipelineDeps;
  readonly captured: {
    pointerStatus?: string;
    fieldStatuses: readonly FieldPresenceStatus[];
    controlOutcome?: MemberOutcome;
    lastSummary?: EnsembleSummary;
    metalerts?: { result: MetAlertsLoadResult; relevant: readonly RelevantAlert[] };
    errors: string[];
  };
}

function buildHarness(args: {
  readonly controlHours: number;
  readonly memberHours: number;
  readonly sharedFields?: { current?: CurrentLayers; waves?: WaveLayers };
}): Harness {
  const controlBytes = buildWindMemberBytes(args.controlHours);
  const memberBytes = buildWindMemberBytes(args.memberHours);

  const pointer: WeatherPointer = {
    formatVersion: "1.0.0",
    tiles: [
      {
        tileId: "t0",
        bbox: [BBOX.lonMin, BBOX.latMin, BBOX.lonMax, BBOX.latMax],
        fields: [
          { field: "wind", member: 0, key: "weather/1/control.bin", hash: "control", header: header() },
          { field: "wind", member: 1, key: "weather/1/member1.bin", hash: "member1", header: header() },
        ],
      },
    ],
  };

  const blobs = new Map<string, Uint8Array>([
    ["weather/1/control.bin", controlBytes],
    ["weather/1/member1.bin", memberBytes],
  ]);

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/pointer/")) {
      return jsonResponse(pointer);
    }
    if (url.includes("/proxy/metalerts")) {
      return new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "fetched-at": "2026-09-03T06:00:00Z", "source-status": "ok" },
      });
    }
    const key = decodeURIComponent(url.split("/blob/")[1] ?? "");
    const bytes = blobs.get(key);
    if (!bytes) return new Response(null, { status: 404 });
    // Se tilsvarende cast/kommentar i blob-client.test.ts.
    return new Response(bytes as BodyInit, { status: 200 });
  }) as typeof fetch;

  const captured: Harness["captured"] = { fieldStatuses: [], errors: [] };

  const deps: PipelineDeps = {
    config: CONFIG,
    fetchImpl,
    cacheStorage: new FakeCacheStorage(),
    workerFactory: () => realWorkFakeWorker(args.sharedFields),
    poolSize: 2,
    nowEpochS: trueWind.validFromS + 3600,
  };

  return { deps, captured };
}

async function runHarness(
  harness: Harness,
): Promise<void> {
  await runWeatherPipeline(harness.deps, {
    onPointerStatus: (s) => {
      harness.captured.pointerStatus = s.status;
    },
    onFieldStatuses: (statuses) => {
      harness.captured.fieldStatuses = statuses;
    },
    onControlResult: (outcome) => {
      harness.captured.controlOutcome = outcome;
    },
    onMemberResult: (_o, summary) => {
      harness.captured.lastSummary = summary;
    },
    onMetAlerts: (result, relevant) => {
      harness.captured.metalerts = { result, relevant };
    },
    onError: (m) => harness.captured.errors.push(m),
  });
}

describe("runWeatherPipeline — pointer→cache→dekode→planRoute, ende til ende", () => {
  it("dagens vind-only-pakke: kontrollen kjører og fullfører, men HELE resultatet er ærlig inkonklusivt fordi strøm/bølge mangler helt (se toppkommentarens funn)", async () => {
    const harness = buildHarness({ controlHours: 24, memberHours: 24 });
    await runHarness(harness);
    const { captured } = harness;

    expect(captured.errors).toEqual([]);
    expect(captured.pointerStatus).toBe("ok");

    const control = captured.controlOutcome!;
    // Selve søket fullfører ruten — dette er IKKE et mislykket søk.
    expect(control.result!.reached).toBe(true);
    expect(control.result!.safety.reachesDestination).toBe(true);
    // Men vind-only ⇒ current/waves alltid undefined ⇒ engine-flagget "partial".
    expect(control.result!.coverage.weather).toBe("partial");
    expect(control.classification).toBe("inconclusive");

    // Vind-only-pakke: strøm og bølger MANGLER helt i selve PAKKEN — skal være synlige flagg, aldri skjult.
    const currentStatus = captured.fieldStatuses.find((s) => s.field === "current")!;
    const wavesStatus = captured.fieldStatuses.find((s) => s.field === "waves")!;
    expect(currentStatus.present).toBe(false);
    expect(wavesStatus.present).toBe(false);

    const flags = allDisplayFlags(control.result!, captured.fieldStatuses);
    expect(flags.some((f) => f.code === "CURRENT_DATA_MANGLER")).toBe(true);
    expect(flags.some((f) => f.code === "WAVES_DATA_MANGLER")).toBe(true);
    // Bølgedata mangler helt i pakken ⇒ ruten viser også motorens EGET
    // per-punkt-flagg for at klaringskravet falt tilbake til standardmarginen.
    expect(flags.some((f) => f.code === "SJOEGANG_DATA_MANGLER")).toBe(true);
    expect(flags.some((f) => f.code === "VAER_DEKNING_PARTIAL")).toBe(true);

    expect(captured.metalerts?.relevant).toEqual([]);

    // Med strøm/bølge strukturelt fraværende for BEGGE medlemmer, er HELE
    // ensemblet inkonklusivt — se toppkommentarens funn. Dette er ærlig
    // (N2), ikke en feil i denne bølgens kode.
    const summary = captured.lastSummary!;
    expect(summary.inconclusiveCount).toBe(2);
    expect(summary.feasibleCount).toBe(0);
    expect(summary.infeasibleCount).toBe(0);
  }, 30_000);

  it("med strøm+bølger TIL STEDE (isolert scenario): et medlem med kortere vind-horisont enn seilasen telles INKONKLUSIVT, kontrollen (full horisont) GJENNOMFØRBAR — ADR-0005", async () => {
    const sharedFields = constantCurrentAndWaves(30); // dekker godt utover seilastiden for begge
    const harness = buildHarness({ controlHours: 24, memberHours: 3, sharedFields });
    await runHarness(harness);
    const { captured } = harness;

    expect(captured.errors).toEqual([]);

    const control = captured.controlOutcome!;
    expect(control.result!.coverage.weather).toBe("full");
    expect(control.classification).toBe("feasible");

    const summary = captured.lastSummary!;
    expect(summary.totalMembers).toBe(2); // kontroll + ett medlem
    expect(summary.feasibleCount).toBe(1);
    expect(summary.inconclusiveCount).toBe(1);
    expect(summary.infeasibleCount).toBe(0); // ALDRI ugjennomførbar av ren datamangel
    expect(summary.inconclusiveFraction).toBeCloseTo(0.5, 5);
    expect(summary.horizonTooShortWarning).toBe(true); // > 20 % inkonklusive (ADR-0005 horisont-port)
  }, 30_000);
});
