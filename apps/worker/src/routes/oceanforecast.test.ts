import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleOceanForecast,
  parseMetOceanForecast,
  parsePointsParam,
  WAVE_POINTS_MAX,
  type WavePointSet,
} from "./oceanforecast.js";
import type { Env } from "../env.js";

/**
 * `docs/specs/punktbolge.md` §5 «Proxy»: rate-limit, cache/revalidering, én
 * payload, feilet punkt står med tom `times` og degradert status,
 * koordinater avrundet til 4 desimaler. Samme falske Cache API som
 * `metalerts.test.ts` (ingen ekte `caches` i Vitest).
 */
function createFakeCache() {
  const store = new Map<string, Response>();
  return {
    match: vi.fn(async (req: Request) => {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    }),
    put: vi.fn(async (req: Request, res: Response) => {
      store.set(req.url, res.clone());
    }),
    store,
  };
}

function createCtx(): ExecutionContext & { readonly settled: Promise<unknown> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
    props: {},
    get settled() {
      return Promise.all(pending);
    },
  } as unknown as ExecutionContext & { readonly settled: Promise<unknown> };
}

type FakeEnv = Pick<Env, "MET_USER_AGENT" | "OCEANFORECAST_RATE_LIMITER">;

const NOW_MS = Date.parse("2026-09-29T08:00:00Z");

function metBody(lat: number, lon: number, hs: readonly (number | undefined)[]) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon - 0.0252, lat - 0.0055] },
    properties: {
      meta: { updated_at: "2026-09-29T06:07:56Z", units: {} },
      timeseries: hs.map((h, i) => ({
        time: new Date(NOW_MS + i * 3600_000).toISOString().replace(".000", ""),
        data: {
          instant: {
            details: {
              ...(h === undefined ? {} : { sea_surface_wave_height: h }),
              sea_surface_wave_from_direction: 250 + i,
              sea_water_speed: 0.3,
            },
          },
        },
      })),
    },
  };
}

const NO_DATA = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [9, 60.5] },
  properties: { meta: { updated_at: "x", error: "no data at the given location", units: {} }, timeseries: [] },
};

function metResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      expires: "Tue, 29 Sep 2026 08:33:07 GMT",
      "last-modified": "Tue, 29 Sep 2026 08:01:17 GMT",
      ...headers,
    },
  });
}

function request(points: string): Request {
  return new Request(`https://worker.example/proxy/oceanforecast?points=${encodeURIComponent(points)}`);
}

async function run(points: string, env: FakeEnv = {}, nowMs = NOW_MS) {
  const ctx = createCtx();
  const response = await handleOceanForecast(request(points), env, ctx, { nowMs: () => nowMs });
  await ctx.settled;
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parsePointsParam", () => {
  it("avrunder til 4 desimaler og bevarer rekkefølgen", () => {
    expect(parsePointsParam("58.123456,10.987654;59,11")).toEqual([
      { lat: 58.1235, lon: 10.9877 },
      { lat: 59, lon: 11 },
    ]);
  });

  it("avviser tom, uleselig, utenfor området og for mange punkter", () => {
    expect(parsePointsParam(null)).toMatch(/mangler/);
    expect(parsePointsParam("58,x")).toMatch(/ugyldig/);
    expect(parsePointsParam("58,10,3")).toMatch(/ugyldig/);
    expect(parsePointsParam("10,10")).toMatch(/utenfor/);
    const many = Array.from({ length: WAVE_POINTS_MAX + 1 }, () => "58,10").join(";");
    expect(parsePointsParam(many)).toMatch(/for mange/);
  });
});

describe("parseMetOceanForecast", () => {
  it("Hs og FRA-retning per tidssteg; manglende Hs ⇒ null (aldri 0)", () => {
    const out = parseMetOceanForecast(metBody(58.5, 10.7, [0.8, undefined]));
    expect(out.status).toBe("ok");
    expect(out.times).toEqual([
      { epochS: NOW_MS / 1000, hsM: 0.8, fromDeg: 250 },
      { epochS: NOW_MS / 1000 + 3600, hsM: null, fromDeg: 251 },
    ]);
    expect(out.sourceLat).toBeCloseTo(58.4945, 4);
    expect(out.sourceLon).toBeCloseTo(10.6748, 4);
  });

  it("landpunkt («no data at the given location») ⇒ ingen-data med tom tidsserie", () => {
    expect(parseMetOceanForecast(NO_DATA)).toMatchObject({ status: "ingen-data", times: [] });
  });

  it("uleselig form kaster", () => {
    expect(() => parseMetOceanForecast({ properties: {} })).toThrow();
  });
});

describe("handleOceanForecast — én payload, kontrakt og feilede punkter", () => {
  it("henter hvert punkt med 4 desimaler og User-Agent, svarer med ett WavePointSet", async () => {
    vi.stubGlobal("caches", { default: createFakeCache() });
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      return metResponse(metBody(Number(u.searchParams.get("lat")), Number(u.searchParams.get("lon")), [1.1, 1.2]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await run("58.500001,10.7;58.6,10.812345");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as WavePointSet;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0]).sort();
    expect(urls).toEqual([
      "https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=58.5000&lon=10.7000",
      "https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=58.6000&lon=10.8123",
    ]);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^morild-routeplanner\/.+@/);

    expect(body.schema).toBe("morild-punktbolge/1");
    expect(body.sourceStatus).toBe("ok");
    expect(body.sourceReason).toBeNull();
    expect(body.fetchedAtEpochS).toBe(NOW_MS / 1000);
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.points.map((p) => [p.lat, p.lon])).toEqual([
      [58.5, 10.7],
      [58.6, 10.8123],
    ]);
    expect(body.points[0]!.times[0]).toEqual({ epochS: NOW_MS / 1000, hsM: 1.1, fromDeg: 250 });
  });

  it("feilet punkt står med tom times og degradert status — aldri utelatt", async () => {
    vi.stubGlobal("caches", { default: createFakeCache() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("lat=59.0000")
          ? new Response("oops", { status: 503 })
          : url.includes("lat=60.5000")
            ? metResponse(NO_DATA)
            : metResponse(metBody(58, 10, [1])),
      ),
    );
    const body = (await (await run("58,10;59,10;60.5,9")).json()) as WavePointSet;
    expect(body.points).toHaveLength(3);
    expect(body.points[1]).toMatchObject({ lat: 59, lon: 10, status: "feilet", times: [] });
    expect(body.points[2]).toMatchObject({ status: "ingen-data", times: [] });
    expect(body.sourceStatus).toBe("degraded");
    expect(body.sourceReason).toContain("1 av 3");
    expect(body.sourceReason).toContain("HTTP 503");
  });

  it("alle feilet ⇒ failed", async () => {
    vi.stubGlobal("caches", { default: createFakeCache() });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("nett nede")));
    const body = (await (await run("58,10;59,10")).json()) as WavePointSet;
    expect(body.sourceStatus).toBe("failed");
    expect(body.points.every((p) => p.times.length === 0)).toBe(true);
  });

  it("samme svar ⇒ samme hash (kanonisk JSON av points)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => metResponse(metBody(58, 10, [1, 2]))));
    vi.stubGlobal("caches", { default: createFakeCache() });
    const a = (await (await run("58,10")).json()) as WavePointSet;
    vi.stubGlobal("caches", { default: createFakeCache() });
    const b = (await (await run("58,10")).json()) as WavePointSet;
    expect(a.hash).toBe(b.hash);
  });

  it("400 på ugyldig punktliste, uten MET-kall", async () => {
    vi.stubGlobal("caches", { default: createFakeCache() });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await run("")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleOceanForecast — cache og revalidering", () => {
  it("ferske punkter (Expires ikke passert) hentes ikke på nytt; fetchedAt er da forrige bekreftelse", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn(async () => metResponse(metBody(58, 10, [1])));
    vi.stubGlobal("fetch", fetchMock);
    await run("58,10;59,10");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const later = NOW_MS + 10 * 60_000; // 08:10, Expires er 08:33
    const body = (await (await run("58,10;59,10", {}, later)).json()) as WavePointSet;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.fetchedAtEpochS).toBe(NOW_MS / 1000);
    expect(body.points[0]!.times).toHaveLength(1);
  });

  it("utløpte punkter revalideres med If-Modified-Since; 304 beholder dataene og fornyer fetchedAt", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    vi.stubGlobal("fetch", vi.fn(async () => metResponse(metBody(58, 10, [1.5]))));
    await run("58,10");

    const fetch304 = vi.fn(async () => new Response(null, { status: 304, headers: { expires: "Tue, 29 Sep 2026 09:30:00 GMT" } }));
    vi.stubGlobal("fetch", fetch304);
    const later = NOW_MS + 60 * 60_000; // 09:00 — utløpt
    const body = (await (await run("58,10", {}, later)).json()) as WavePointSet;
    expect(fetch304).toHaveBeenCalledTimes(1);
    const init = (fetch304.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["If-Modified-Since"]).toBe("Tue, 29 Sep 2026 08:01:17 GMT");
    expect(body.points[0]!.times[0]!.hsM).toBe(1.5);
    expect(body.fetchedAtEpochS).toBe(later / 1000);
    expect(body.sourceStatus).toBe("ok");
  });

  it("én bokføringsoppføring for hele listen — innenfor gratisplanens 50 delforespørsler ved maks punkter", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn(async () => metResponse(metBody(58, 10, [1])));
    vi.stubGlobal("fetch", fetchMock);
    const pts = Array.from({ length: WAVE_POINTS_MAX }, (_, i) => `${(55 + i * 0.1).toFixed(1)},10`).join(";");
    await run(pts);
    const subrequests = fetchMock.mock.calls.length + cache.match.mock.calls.length + cache.put.mock.calls.length;
    expect(subrequests).toBeLessThanOrEqual(50);
    expect(cache.store.size).toBe(1);
  });
});

describe("handleOceanForecast — misbruksvern", () => {
  it("svarer 429 uten MET-kall når rate-limit-bindingen sier nei", async () => {
    vi.stubGlobal("caches", { default: createFakeCache() });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const response = await run("58,10", {
      OCEANFORECAST_RATE_LIMITER: limiter as unknown as NonNullable<Env["OCEANFORECAST_RATE_LIMITER"]>,
    });
    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(limiter.limit).toHaveBeenCalledWith({ key: "oceanforecast-proxy" });
  });

  it("fungerer uten binding (ærlig degradering, som metalerts)", async () => {
    vi.stubGlobal("caches", { default: createFakeCache() });
    vi.stubGlobal("fetch", vi.fn(async () => metResponse(metBody(58, 10, [1]))));
    expect((await run("58,10")).status).toBe(200);
  });
});
