/**
 * Punktbølge i klienten (`docs/specs/punktbolge.md` §5): punktgitteret over
 * korridoren, klientbufferet (frakoblet ⇒ buffer merket; uten buffer
 * «krever nett»), fryseregelen (én proxy-henting per kjøring, samme `hash`
 * i alle jobbene, ingen henting i perturbasjonsfasen), determinisme (samme
 * sett ⇒ bit-identisk `RouteResult`) og UI-tekstene i §4.
 */
import { describe, expect, it } from "vitest";
import {
  buildDistanceField,
  FLAG_BOLGE_PUNKT_5_20NM,
  FLAG_BOLGE_PUNKT_UNDER_5NM,
  FLAG_STROM_KYSTSONE,
  maskAsEdgeGate,
  planRoute,
  type RouteStep,
} from "@morild/routing";
import { goldenScenarios, SKAGEN, SKJAELOY } from "@morild/routing/test-fixtures/golden-scenarios";
import type { PackageHeader } from "@morild/protocol";
import {
  buildLayer,
  parseWavePointSet,
  serializeLayer,
  WAVE_POINT_SET_SCHEMA,
  WAVE_POINTS_MAX,
  withWavePoints,
  type LayerGeometry,
  type WavePoint,
  type WavePointSet,
} from "@morild/weather";
import { DEFAULT_APP_CONFIG } from "./config.js";
import type { FromWorker, ToWorker, WorkerLike } from "./ensemble.js";
import { runWeatherPipeline } from "./pipeline.js";
import type { PointerFieldEntry, PointerTileEntry, WeatherPointer } from "./pointer-types.js";
import { FakeCacheStorage } from "./test-support/fake-cache-storage.js";
import { fakeResult } from "./test-support/fake-route-result.js";
import { wavePointGrid } from "./wave-point-grid.js";
import { loadWavePoints, WAVE_POINT_CACHE_NAME, type WavePointLoad } from "./wave-points-client.js";
import { waveDegradationText, waveDiagnosticsText, waveSourceFlags, WAVE_COASTAL_TEXT } from "./wave-text.js";
import { waveMeasurement } from "./measurement.js";

const CONFIG = { ...DEFAULT_APP_CONFIG, apiBase: "http://localhost" };
const T0 = 1_790_000_000;
const scenario = goldenScenarios().find((s) => s.name === "skjaeloy-skagen-apent")!;

function realField() {
  return buildDistanceField(SKJAELOY, SKAGEN, maskAsEdgeGate(scenario.input.mask!));
}

function setFor(points: readonly { lat: number; lon: number }[], opts: Partial<WavePointSet> = {}): WavePointSet {
  const wp: WavePoint[] = points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    sourceLat: null,
    sourceLon: null,
    status: "ok",
    times: Array.from({ length: 80 }, (_, h) => ({ epochS: T0 + h * 3600, hsM: 0.6 + (h % 5) * 0.1, fromDeg: 240 + h })),
  }));
  return {
    schema: WAVE_POINT_SET_SCHEMA,
    fetchedAtEpochS: T0,
    points: wp,
    sourceStatus: "ok",
    sourceReason: null,
    hash: "hash-" + points.length,
    ...opts,
  };
}

function pointsFromUrl(url: string): { lat: number; lon: number }[] {
  const raw = new URL(url).searchParams.get("points") ?? "";
  return raw.split(";").map((p) => {
    const [lat, lon] = p.split(",").map(Number);
    return { lat: lat!, lon: lon! };
  });
}

describe("punktgitteret over korridoren (D16.1)", () => {
  it("Skjæløy–Skagen: ≤ WAVE_POINTS_MAX punkter, alle i nåbart vann, 4 desimaler, deterministisk", () => {
    const field = realField()!;
    const a = wavePointGrid(field, [SKJAELOY, SKAGEN]);
    const b = wavePointGrid(field, [SKJAELOY, SKAGEN]);
    expect(a).toEqual(b);
    expect(a.rule).toBe("a-star-felt");
    expect(a.spacingNm).toBe(10);
    expect(a.points.length).toBeGreaterThan(10);
    expect(a.points.length).toBeLessThanOrEqual(WAVE_POINTS_MAX);
    expect(a.exceedsMax).toBe(false);
    for (const p of a.points) {
      expect(field.at(p.lat, p.lon)).toBeDefined();
      expect(Number(p.lat.toFixed(4))).toBe(p.lat);
    }
  });

  it("uten felt: endepunkt-bboks + 0,5° (samme fallback som flisvalget), og for mange punkter sies ærlig", () => {
    const g = wavePointGrid(undefined, [SKJAELOY, SKAGEN]);
    expect(g.rule).toBe("endepunkt-bbox");
    expect(g.exceedsMax).toBe(g.points.length > WAVE_POINTS_MAX);
  });
});

describe("klientbufferet (§3, §5)", () => {
  const points = [{ lat: 58.5, lon: 10.7 }, { lat: 58.6, lon: 10.8 }];

  it("nett: settet brukes og bufres per korridor", async () => {
    const cacheStorage = new FakeCacheStorage();
    const fetchImpl = (async (url: string) =>
      new Response(JSON.stringify(setFor(pointsFromUrl(url))), { status: 200 })) as unknown as typeof fetch;
    const load = await loadWavePoints(CONFIG, points, WAVE_POINTS_MAX, { fetchImpl, cacheStorage, persistentBuffer: true });
    expect(load.kind).toBe("nett");
    const cache = await cacheStorage.open(WAVE_POINT_CACHE_NAME);
    const url = "http://localhost/proxy/oceanforecast?points=" + encodeURIComponent("58.5000,10.7000;58.6000,10.8000");
    expect(await cache.match(url)).toBeDefined();
  });

  it("frakoblet med buffer: bufferet brukes med sitt tidsstempel, og merkes frakoblet", async () => {
    const cacheStorage = new FakeCacheStorage();
    const ok = (async (url: string) =>
      new Response(JSON.stringify(setFor(pointsFromUrl(url))), { status: 200 })) as unknown as typeof fetch;
    await loadWavePoints(CONFIG, points, WAVE_POINTS_MAX, { fetchImpl: ok, cacheStorage, persistentBuffer: true });
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const load = await loadWavePoints(CONFIG, points, WAVE_POINTS_MAX, { fetchImpl: offline, cacheStorage, persistentBuffer: true });
    expect(load.kind).toBe("buffer");
    if (load.kind !== "buffer") return;
    expect(load.offline).toBe(true);
    expect(load.set.fetchedAtEpochS).toBe(T0);
    expect(waveDegradationText(load, null, "UTC").text).toContain("(frakoblet, fra kl. ");
  });

  it("frakoblet uten buffer: «Bølgedata krever nett»", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const load = await loadWavePoints(CONFIG, points, WAVE_POINTS_MAX, {
      fetchImpl: offline,
      cacheStorage: new FakeCacheStorage(),
      persistentBuffer: true,
    });
    expect(load).toMatchObject({ kind: "mangler", reason: "krever-nett" });
    expect(waveDegradationText(load, null).text).toMatch(/^Bølgedata krever nett/);
    expect(waveSourceFlags(load)[0]!.code).toBe("BOLGE_DATA_MANGLER");
  });

  it("proxyen svarer failed: siste vellykkede fra bufferet, ikke frakoblet-tekst; failed bufres aldri", async () => {
    const cacheStorage = new FakeCacheStorage();
    const ok = (async (url: string) =>
      new Response(JSON.stringify(setFor(pointsFromUrl(url))), { status: 200 })) as unknown as typeof fetch;
    await loadWavePoints(CONFIG, points, WAVE_POINTS_MAX, { fetchImpl: ok, cacheStorage, persistentBuffer: true });
    const failed = (async (url: string) =>
      new Response(
        JSON.stringify({ ...setFor(pointsFromUrl(url)), fetchedAtEpochS: T0 + 7200, sourceStatus: "failed", sourceReason: "2 av 2 punkter feilet hos MET (HTTP 503)", hash: "ny" }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const load = await loadWavePoints(CONFIG, points, WAVE_POINTS_MAX, { fetchImpl: failed, cacheStorage, persistentBuffer: true });
    expect(load.kind).toBe("buffer");
    if (load.kind !== "buffer") return;
    expect(load.offline).toBe(false);
    expect(load.set.hash).toBe("hash-2");
    expect(waveDegradationText(load, null).text).not.toContain("frakoblet");
  });

  it("korridor over proxyens grense: bølge mangler med forklaring — aldri stille avkortet", async () => {
    const many = Array.from({ length: WAVE_POINTS_MAX + 1 }, (_, i) => ({ lat: 55 + i * 0.1, lon: 10 }));
    const load = await loadWavePoints(CONFIG, many, WAVE_POINTS_MAX, {
      fetchImpl: (async () => {
        throw new Error("skal ikke kalles");
      }) as unknown as typeof fetch,
      cacheStorage: new FakeCacheStorage(),
      persistentBuffer: true,
    });
    expect(load).toMatchObject({ kind: "mangler", reason: "for-mange-punkter" });
  });
});

// ---------------------------------------------------------------- fryseregelen

const HEADER: PackageHeader = {
  formatVersion: "1.1.0",
  producedAt: "2026-09-27T01:00:00Z",
  model: "MEPS",
  init: "2026-09-27T00:00:00Z",
  resolution: "2.5km",
  sourceStatus: { status: "ok" },
};
const CERT = { maxDecodeErrorKn: 0.09, maxDirectionErrorDeg: 0.6, clippedSamples: 0, referenceInit: HEADER.init, verifiedAt: HEADER.producedAt };

function windEntry(member: number): PointerFieldEntry {
  return { field: "wind", member, key: `weather/1/wind-${member}.bin`, hash: `wind-${member}`, header: { ...HEADER, certificate: CERT } as PackageHeader };
}

function tinyWindBlob(): Uint8Array {
  const g: LayerGeometry = { latMin: 58, lonMin: 10, latStepDeg: 1, lonStepDeg: 1, nodesLat: 2, nodesLon: 2, tileNodes: 32, t0S: T0, dtS: 3600, timeSteps: 2 };
  const layer = (v: number) => serializeLayer(buildLayer({ geometryBase: g, bitsPerSample: 8, roundingMode: "nearest", channelKind: "linear", sample: () => v }));
  const u = layer(5);
  const v = layer(3);
  const out = new Uint8Array(u.length + v.length);
  out.set(u, 0);
  out.set(v, u.length);
  return out;
}

function mockWorker(log: ToWorker[]): WorkerLike {
  const listeners = new Set<(ev: MessageEvent<FromWorker>) => void>();
  return {
    postMessage(message) {
      log.push(message);
      const response: FromWorker =
        message.type === "evaluate-control"
          ? { type: "evaluate-control-result", memberIndex: message.memberIndex, feasible: true, durationS: 3600 }
          : message.type === "plan-route-member"
            ? {
                type: "plan-route-member-result",
                memberIndex: message.memberIndex,
                isControl: message.isControl,
                result: fakeResult({ reachesDestination: true, weatherCoverage: "full", steps: 3 }),
                timing: { decodeMs: 1, fieldMs: 1, searchMs: 1, workerHeapMB: null, workerSlot: message.workerSlot ?? null },
              }
            : { type: "error", memberIndex: message.memberIndex, message: "ikke støttet" };
      queueMicrotask(() => {
        for (const fn of [...listeners]) {
          listeners.delete(fn);
          fn({ data: response } as MessageEvent<FromWorker>);
        }
      });
    },
    addEventListener(type: string, listener: unknown) {
      if (type === "message") listeners.add(listener as (ev: MessageEvent<FromWorker>) => void);
    },
    removeEventListener(type: string, listener: unknown) {
      if (type === "message") listeners.delete(listener as (ev: MessageEvent<FromWorker>) => void);
    },
    terminate() {},
  };
}

describe("fryseregelen (ADR-0007): én henting, samme hash overalt, ingen henting i perturbasjonen", () => {
  it("orkestreringen", async () => {
    const members = [0, 1, 2, 3];
    const tile: PointerTileEntry = { tileId: "t0", bbox: [7.8, 56.4, 12.8, 60.4], fields: members.map(windEntry) };
    const pointer: WeatherPointer = { formatVersion: "1.1.0", tiles: [tile] };
    const proxyCalls: { url: string; phase: string }[] = [];
    let phase = "forberedelse";
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/pointer/")) {
        return new Response(JSON.stringify(pointer), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/proxy/oceanforecast")) {
        proxyCalls.push({ url, phase });
        return new Response(JSON.stringify(setFor(pointsFromUrl(url), { hash: `sett-${proxyCalls.length}` })), { status: 200 });
      }
      if (url.includes("/proxy/metalerts")) return new Response(JSON.stringify({ features: [] }), { status: 200 });
      return new Response(tinyWindBlob() as BodyInit, { status: 200 });
    }) as typeof fetch;

    const log: ToWorker[] = [];
    let waveLoad: WavePointLoad | undefined;
    let stampHash: string | null | undefined;
    const errors: string[] = [];
    await runWeatherPipeline(
      {
        config: CONFIG,
        fetchImpl,
        cacheStorage: new FakeCacheStorage(),
        workerFactory: () => mockWorker(log),
        poolSize: 2,
        worstFirst: true,
        perturbation: true,
        bailout: false,
        nowEpochS: T0,
      },
      {
        onWavePoints: (load) => {
          waveLoad = load;
        },
        onControlResult: () => {
          phase = "ensemble";
        },
        onMemberResult: (_o, summary) => {
          stampHash = summary.departure?.stamp.wavePoints?.hash;
        },
        onSensitivity: () => {
          phase = "etter";
        },
        onError: (m) => errors.push(m),
      },
    );

    expect(errors).toEqual([]);
    expect(proxyCalls).toHaveLength(1);
    expect(proxyCalls[0]!.phase).toBe("forberedelse");
    expect(waveLoad?.kind).toBe("nett");
    const searches = log.filter((m) => m.type === "plan-route-member");
    const perturbed = searches.filter((m) => m.type === "plan-route-member" && m.perturbation !== undefined);
    const oracle = log.filter((m) => m.type === "evaluate-control");
    expect(perturbed.length).toBeGreaterThan(0);
    expect(oracle.length).toBe(members.length - 1);
    const hashes = new Set(
      [...searches, ...oracle].map((m) => ("wavePoints" in m ? m.wavePoints?.hash : undefined) ?? "MANGLER"),
    );
    expect(hashes).toEqual(new Set(["sett-1"]));
    expect(stampHash).toBe("sett-1");
    expect(waveMeasurement(waveLoad!).hash).toBe("sett-1");
  });
});

describe("determinisme: samme WavePointSet ⇒ bit-identisk RouteResult", () => {
  it("to kjøringer, og et JSON-rundtur-sett, gir samme resultat", () => {
    const depart = scenario.input.departEpochS;
    const grid = wavePointGrid(realField(), [SKJAELOY, SKAGEN]);
    const base = setFor(grid.points);
    const set: WavePointSet = {
      ...base,
      points: base.points.map((p) => ({
        ...p,
        times: Array.from({ length: 60 }, (_, h) => ({ epochS: depart + (h - 2) * 3600, hsM: 0.4 + ((h * 7) % 9) * 0.1, fromDeg: (200 + h * 13) % 360 })),
      })),
    };
    const a = planRoute({ ...scenario.input, weather: withWavePoints(scenario.input.weather, set) });
    const b = planRoute({ ...scenario.input, weather: withWavePoints(scenario.input.weather, set) });
    const c = planRoute({
      ...scenario.input,
      weather: withWavePoints(scenario.input.weather, parseWavePointSet(JSON.parse(JSON.stringify(set)))),
    });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    expect(a.flags & (FLAG_BOLGE_PUNKT_UNDER_5NM | FLAG_BOLGE_PUNKT_5_20NM)).not.toBe(0);
  }, 120_000);
});

describe("UI-tekstene (§4)", () => {
  const set = setFor([{ lat: 58.5, lon: 10.7 }]);
  const nett: WavePointLoad = { kind: "nett", set, persistentBuffer: true };
  const step = (lat: number, flags: number): RouteStep => ({
    lat,
    lon: 10.7,
    tS: 0,
    epochS: T0,
    headingDeg: null,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    twsKn: 10,
    twdDeg: 200,
    bspKn: 6,
    hsM: 0.8,
    flags,
    flagNames: [],
  });

  it("normal: én tekst med tid, avstandskategori og «bølgeperiode ukjent»", () => {
    const t = waveDegradationText(nett, [step(58.5, FLAG_BOLGE_PUNKT_UNDER_5NM)], "UTC");
    expect(t.text).toBe(
      "Bølger fra punktvarsel kl. 14:13 (nærmeste punkt < 5 nm) — bølgeperiode ukjent, konservativt anslag.",
    );
    expect(t.severity).toBe("info");
  });

  it("verste kategori langs ruten vises; steg over grensen gir «mangler på deler av ruten»", () => {
    const t = waveDegradationText(nett, [step(58.5, FLAG_BOLGE_PUNKT_UNDER_5NM), step(58.75, FLAG_BOLGE_PUNKT_5_20NM)]);
    expect(t.text).toContain("(nærmeste punkt 5–20 nm)");
    expect(t.text).toContain("Bølgedata mangler på deler av ruten (ingen varselpunkt i nærheten)");
    expect(t.severity).toBe("advarsel");
  });

  it("steg i strømmens kystmaske gir «nær land, mulig skjermet»", () => {
    const t = waveDegradationText(nett, [step(58.5, FLAG_BOLGE_PUNKT_UNDER_5NM | FLAG_STROM_KYSTSONE)]);
    expect(t.text).toContain(WAVE_COASTAL_TEXT);
    expect(WAVE_COASTAL_TEXT).toBe("nær land, mulig skjermet — punktvarselet fanger ikke le, refleksjon eller krysssjø");
  });

  it("diagnostikken viser alltid avstanden (maks og median), kilde og hash", () => {
    const grid = { points: [{ lat: 58.5, lon: 10.7 }], rule: "a-star-felt" as const, spacingNm: 10, exceedsMax: false };
    const d = waveDiagnosticsText(nett, grid, [step(58.5, 0), step(58.55, 0)]);
    expect(d).toMatch(/maks 3,0 nm, median 3,0 nm \(grense 10 nm\)/);
    expect(d).toContain("hash hash-1");
    expect(d).toContain("Cache Storage");
    const degraded: WavePointLoad = { kind: "nett", set: { ...set, sourceStatus: "degraded", sourceReason: "1 av 2 punkter feilet hos MET (HTTP 503)" }, persistentBuffer: false };
    expect(waveSourceFlags(degraded).map((f) => f.code)).toEqual(["BOLGE_KILDE_DEGRADERT"]);
    expect(waveDiagnosticsText(degraded, grid, null)).toContain("kun minne");
  });
});
