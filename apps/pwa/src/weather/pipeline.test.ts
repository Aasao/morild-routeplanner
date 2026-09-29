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
  compositeWeatherField,
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
import type { TileSelection } from "./tile-select.js";
import type { TileRejection } from "./tile-certificate.js";

const CONFIG = { ...DEFAULT_APP_CONFIG, apiBase: "http://localhost" };

const scenario = goldenScenarios().find((s) => s.name === "skjaeloy-skagen-apent")!;
const trueWind = scenario.input.weather;

/** Samme BBOX/oppløsning som `packages/weather/src/golden-bridge.test.ts` — bevist tilstrekkelig til at søket fullfører identisk med det ubegrensede analytiske feltet. */
const BBOX = { latMin: 56.4, latMax: 60.4, lonMin: 7.8, lonMax: 12.8 };
const NODE_STEP_DEG = 0.1;
function nodeCount(min: number, max: number, step: number): number {
  return Math.round((max - min) / step) + 1;
}
function geometry(t0S: number, hours: number, bbox: typeof BBOX = BBOX): LayerGeometry {
  return {
    latMin: bbox.latMin,
    lonMin: bbox.lonMin,
    latStepDeg: NODE_STEP_DEG,
    lonStepDeg: NODE_STEP_DEG,
    nodesLat: nodeCount(bbox.latMin, bbox.latMax, NODE_STEP_DEG),
    nodesLon: nodeCount(bbox.lonMin, bbox.lonMax, NODE_STEP_DEG),
    tileNodes: 32,
    t0S,
    dtS: 3600,
    timeSteps: hours + 1,
  };
}

/**
 * Bygger én vind-medlems R2-blob (u+v konkatenert, `tools/weather-pack`s
 * faktiske byte-layout) fra det ekte golden-feltet, for `hours` timer.
 * `bbox` (default: hele `BBOX`) lar `describe("flere fliser …")` under
 * bygge SNEVRERE, ikke-overlappende fliser som til sammen dekker samme
 * areal — review-funn fase 3 bølge 2, funn 2.
 */
function buildWindMemberBytes(hours: number, bbox: typeof BBOX = BBOX): Uint8Array {
  const g = geometry(trueWind.validFromS, hours, bbox);
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

/**
 * **Sertifikatet D7.2 krever** (`tile-certificate.ts`). Feltet bor ikke i
 * `PackageHeader`-typen i `@morild/protocol` ennå — værpakke-siden legger det
 * på i samme bølge — så testen setter det strukturelt, nøyaktig slik klienten
 * leser det. Uten sertifikat avviser klienten flisen, og det er hele poenget
 * med asserten: en ikke-verifisert flis skal ikke kunne brukes i stillhet.
 */
const DEFAULT_CERTIFICATE = {
  maxDecodeErrorKn: 0.09,
  maxDirectionErrorDeg: 0.6,
  referenceInit: "2026-09-03T00:00:00Z",
  verifiedAt: "2026-09-03T01:00:00Z",
};

function header(
  overrides: Partial<PackageHeader> & { readonly certificate?: unknown } = {},
): PackageHeader {
  return {
    formatVersion: "1.0.0",
    producedAt: "2026-09-03T00:00:00Z",
    model: "MEPS",
    init: new Date(trueWind.validFromS * 1000).toISOString(),
    resolution: "2.5km",
    sourceStatus: { status: "ok" },
    certificate: DEFAULT_CERTIFICATE,
    ...overrides,
  } as PackageHeader;
}

/** Header uten sertifikat — slik pakkene så ut før D7.2. */
function uncertifiedHeader(): PackageHeader {
  const rest = { ...header() } as PackageHeader & { certificate?: unknown };
  delete rest.certificate;
  return rest;
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
          // Én `WeatherFieldLike` PER FLIS, sydd sammen med `compositeWeatherField`
          // — speiler den ekte `weather-routing.worker.ts` (review-funn fase 3
          // bølge 2, funn 2).
          const tileFields = message.tiles.map((tile) => {
            const windMember = windMemberLayersFromBytes(new Uint8Array(tile.windBuffer));
            const pkg: WeatherPackage = {
              windMembers: [windMember],
              windHeader: tile.windHeader,
              ...(sharedFields?.current ? { current: sharedFields.current } : {}),
              ...(sharedFields?.waves ? { waves: sharedFields.waves } : {}),
            };
            return toWeatherField(pkg, 0, {
              departEpochS: message.departEpochS,
              isControl: message.isControl,
            });
          });
          const field = compositeWeatherField(tileFields);
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
    removeEventListener() {
      /* attrappen holder bare siste lytter — once-semantikken testes i ensemble.test.ts */
    },
    terminate() {
      /* no-op */
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Delt `fetch`-dobbel for pekeren/MetAlerts/blob-nøkler — brukt av alle harnesser i denne fila. */
function makePointerFetch(pointer: WeatherPointer, blobs: ReadonlyMap<string, Uint8Array>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
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
}

interface Harness {
  readonly deps: PipelineDeps;
  readonly captured: {
    pointerStatus?: string;
    fieldStatuses: readonly FieldPresenceStatus[];
    controlOutcome?: MemberOutcome;
    lastSummary?: EnsembleSummary;
    metalerts?: { result: MetAlertsLoadResult; relevant: readonly RelevantAlert[] };
    tileSelection?: TileSelection;
    tileRejections: TileRejection[];
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

  const fetchImpl = makePointerFetch(pointer, blobs);

  const captured: Harness["captured"] = { fieldStatuses: [], tileRejections: [], errors: [] };

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
    onTileSelection: (selection, rejections) => {
      harness.captured.tileSelection = selection;
      harness.captured.tileRejections = [...rejections];
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
    // §19 2026-09-29: ingen etikett forkastet for manglende vær (feltet tok
    // ikke slutt) — partial skyldes strøm/bølge, og teksten sier det, ikke
    // «værfeltet tok slutt».
    expect(control.result!.diagnostics.pruned.noWeather).toBe(0);
    expect(flags.some((f) => f.code === "VAER_DEKNING_DELVIS_FELT")).toBe(true);
    expect(flags.some((f) => f.code === "VAER_DEKNING_PARTIAL")).toBe(false);

    expect(captured.metalerts?.relevant).toEqual([]);

    // Med strøm/bølge strukturelt fraværende for BEGGE medlemmer, er HELE
    // ensemblet inkonklusivt — se toppkommentarens funn. Dette er ærlig
    // (N2), ikke en feil i denne bølgens kode.
    const summary = captured.lastSummary!;
    expect(summary.inconclusiveCount).toBe(2);
    expect(summary.feasibleCount).toBe(0);
    expect(summary.infeasibleCount).toBe(0);
  }, 120_000); // hevet fra 30 s (review-funn): timeout observert under full-suite-parallellitet, bekreftet bestått isolert — reell arbeidsmengde (ekte kvantisering+dekoding+planRoute), ikke en hengende test.

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
  }, 120_000); // hevet fra 30 s (review-funn): timeout observert under full-suite-parallellitet, bekreftet bestått isolert — reell arbeidsmengde (ekte kvantisering+dekoding+planRoute), ikke en hengende test.
});

/**
 * Integrasjonstest for review-funn fase 3 bølge 2, funn 2: `tile-select.ts`
 * brukte tidligere kun FØRSTE overlappende flis. Den ekte Skjæløy→Skagen-
 * pakken har TO fliser (5_28/5_29, delt ved 58°N,
 * `tools/weather-pack/src/build-live-package.ts`s `TARGET_TILES`) — ruten
 * (start Skjæløy ~59,10°N, mål Skagen ~57,72°N) krysser midt gjennom den
 * grensen.
 *
 * Fliser er her bygget med SAMME oppløsning/metode som resten av fila
 * (`buildWindMemberBytes`/ekte kvantisering), bare med en SNEVRERE bbox
 * hver — sør dekker 56,4–58,4°N, nord 58,4–60,4°N — slik at de til sammen
 * dekker akkurat det samme arealet som `BBOX` i testene over.
 *
 * To scenarioer:
 * 1. BEGGE fliser i pekeren → komposittfeltet dekker hele ruten → ruten
 *    når målet (samme utfall som `BBOX`-testene over, nå sydd av to
 *    fliser i stedet for én).
 * 2. KUN nordflisen (regresjonstesten som gir denne bølgens fiks tenner):
 *    ruten STARTER med vinddata (Skjæløy er i nordflisen), men søket går
 *    tom for vind når det når sørhalvdelen av ruten — akkurat symptomet
 *    review-funnet beskrev ("noder stoppes uten synlig årsak"). Med DEN
 *    GAMLE "kun første flis"-logikken ville dette vært det ENESTE mulige
 *    utfallet uansett hvilke fliser pekeren hadde — denne testen ville
 *    IKKE fanget regresjonen om fiksen ble reversert til kun én flis totalt,
 *    så den fanger nettopp mangelen på sammensying, ikke bare fravær av data.
 */
describe("runWeatherPipeline — flere fliser over en flisgrense (review-funn fase 3 bølge 2, funn 2)", () => {
  const SPLIT_LAT = 58.4; // mellom Skagen (~57,72°N) og Skjæløy (~59,10°N)
  const SOUTH_BBOX = { latMin: BBOX.latMin, latMax: SPLIT_LAT, lonMin: BBOX.lonMin, lonMax: BBOX.lonMax };
  const NORTH_BBOX = { latMin: SPLIT_LAT, latMax: BBOX.latMax, lonMin: BBOX.lonMin, lonMax: BBOX.lonMax };

  function tileEntry(
    tileId: string,
    bbox: typeof BBOX,
    key: string,
    tileHeader: PackageHeader = header(),
  ): WeatherPointer["tiles"][number] {
    return {
      tileId,
      bbox: [bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax],
      fields: [{ field: "wind", member: 0, key, hash: tileId, header: tileHeader }],
    };
  }

  function buildMultiTileHarness(
    include: readonly ("south" | "north")[],
    headers: Partial<Record<"south" | "north", PackageHeader>> = {},
  ): Harness {
    const southBytes = buildWindMemberBytes(24, SOUTH_BBOX);
    const northBytes = buildWindMemberBytes(24, NORTH_BBOX);

    const allTiles: Record<"south" | "north", WeatherPointer["tiles"][number]> = {
      south: tileEntry("t-sor", SOUTH_BBOX, "weather/1/sor.bin", headers.south ?? header()),
      north: tileEntry("t-nord", NORTH_BBOX, "weather/1/nord.bin", headers.north ?? header()),
    };
    const pointer: WeatherPointer = { formatVersion: "1.0.0", tiles: include.map((id) => allTiles[id]) };

    const blobs = new Map<string, Uint8Array>([
      ["weather/1/sor.bin", southBytes],
      ["weather/1/nord.bin", northBytes],
    ]);

    const fetchImpl = makePointerFetch(pointer, blobs);
    const captured: Harness["captured"] = { fieldStatuses: [], tileRejections: [], errors: [] };
    const deps: PipelineDeps = {
      config: CONFIG,
      fetchImpl,
      cacheStorage: new FakeCacheStorage(),
      workerFactory: () => realWorkFakeWorker(),
      poolSize: 1,
      nowEpochS: trueWind.validFromS + 3600,
    };
    return { deps, captured };
  }

  it("BEGGE fliser (5_28 sør + 5_29 nord): komposittfeltet dekker hele ruten — ruten NÅR målet", async () => {
    const harness = buildMultiTileHarness(["south", "north"]);
    await runHarness(harness);
    const { captured } = harness;

    expect(captured.errors).toEqual([]);
    expect(captured.pointerStatus).toBe("ok");
    const control = captured.controlOutcome!;
    expect(control.result!.reached).toBe(true);
    expect(control.result!.safety.reachesDestination).toBe(true);
  }, 120_000);

  it("REGRESJON — kun nordflisen (én-flis-varianten): ruten starter (Skjæløy er i nordflisen) men når IKKE målet, sørhalvdelen mangler vind", async () => {
    const harness = buildMultiTileHarness(["north"]);
    await runHarness(harness);
    const { captured } = harness;

    expect(captured.errors).toEqual([]);
    const control = captured.controlOutcome!;
    // Ikke "noWeatherAtStart" — starten (Skjæløy) HAR vinddata her, i
    // motsetning til om vi hadde kuttet nordflisen i stedet. Søket kommer i
    // gang, men mister vind idet det krysser inn i sørhalvdelen og finner
    // aldri veien til målet.
    expect(control.result!.abortReason).not.toBe("noWeatherAtStart");
    expect(control.result!.reached).toBe(false);
    expect(control.result!.safety.reachesDestination).toBe(false);
  }, 120_000);

  /**
   * **Klippe- og sertifikat-asserten** (D7.2 vilkår (iv)). Flisen skal
   * avvises FØR den brukes, med en synlig årsak — ikke stille utelates og
   * ikke stille brukes. Se `tile-certificate.ts`.
   */
  it("avviser en flis UTEN sertifikat, med synlig årsak (D7.2)", async () => {
    const harness = buildMultiTileHarness(["south", "north"], {
      south: uncertifiedHeader(),
    });
    await runHarness(harness);
    const { captured } = harness;

    expect(captured.tileRejections.map((r) => r.tileId)).toEqual(["t-sor"]);
    expect(captured.tileRejections[0]!.reason).toMatch(/uten sertifikat/);
    // Nordflisen er sertifisert og brukes videre — asserten er per flis.
    expect(captured.tileSelection!.tiles.map((t) => t.tileId)).toEqual([
      "t-sor",
      "t-nord",
    ]);
    expect(captured.fieldStatuses.length).toBeGreaterThan(0);
    // Uten sørflisen mister ruten vind i sørhalvdelen — den når ikke målet,
    // og det er den ærlige konsekvensen (aldri et stille «trygt»).
    expect(captured.controlOutcome!.result!.safety.reachesDestination).toBe(false);
  }, 120_000);

  it("avviser en flis som RAPPORTERER KLIPPING (vaktbåndet er da ugyldig)", async () => {
    const harness = buildMultiTileHarness(["south", "north"], {
      south: header({
        certificate: { ...DEFAULT_CERTIFICATE, clippedSamples: 17 },
      }),
    });
    await runHarness(harness);
    const { captured } = harness;

    expect(captured.tileRejections.map((r) => r.tileId)).toEqual(["t-sor"]);
    expect(captured.tileRejections[0]!.reason).toMatch(/klipping/);
  }, 120_000);

  it("begge fliser sertifisert: ingen avvisning, ingen manglende fliser", async () => {
    const harness = buildMultiTileHarness(["south", "north"]);
    await runHarness(harness);
    expect(harness.captured.tileRejections).toEqual([]);
    expect(harness.captured.tileSelection!.missingTileIds).toEqual([]);
  }, 120_000);
});
