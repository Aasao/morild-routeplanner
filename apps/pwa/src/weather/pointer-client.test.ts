import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import { DEFAULT_APP_CONFIG, apiUrl } from "./config.js";
import { CLIENT_WEATHER_FORMAT_VERSION, loadWeatherPointer } from "./pointer-client.js";
import { openWeatherCache } from "./pack-cache.js";
import { FakeCacheStorage } from "./test-support/fake-cache-storage.js";
import type { WeatherPointer } from "./pointer-types.js";

const CONFIG = { ...DEFAULT_APP_CONFIG, apiBase: "http://localhost" };

const HEADER: PackageHeader = {
  formatVersion: CLIENT_WEATHER_FORMAT_VERSION,
  producedAt: "2026-09-03T00:00:00Z",
  model: "MEPS",
  init: "2026-09-03T00:00:00Z",
  resolution: "2.5km",
  sourceStatus: { status: "ok" },
};

function pointerFixture(overrides: Partial<WeatherPointer> = {}): WeatherPointer {
  return {
    formatVersion: CLIENT_WEATHER_FORMAT_VERSION,
    tiles: [
      {
        tileId: "t0",
        bbox: [10, 57, 12, 60],
        fields: [{ field: "wind", member: 0, key: "weather/1/abc.bin", hash: "abc", header: HEADER }],
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("loadWeatherPointer", () => {
  it("henter fra nettverk, cacher svaret, og rapporterer source:'network'", async () => {
    const cacheStorage = new FakeCacheStorage();
    const fixture = pointerFixture();
    const fetchImpl = (async () => jsonResponse(fixture)) as typeof fetch;

    const result = await loadWeatherPointer(CONFIG, { fetchImpl, cacheStorage });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("network");
      expect(result.pointer).toEqual(fixture);
    }

    const cache = await openWeatherCache(cacheStorage);
    const cached = await cache.match(apiUrl(CONFIG, `/pointer/${CONFIG.weatherPointerName}`));
    expect(cached).toBeDefined();
  });

  it("faller tilbake til cache når nettverket feiler", async () => {
    const cacheStorage = new FakeCacheStorage();
    const fixture = pointerFixture();

    // Første kall (nett OK) fyller cachen.
    await loadWeatherPointer(CONFIG, {
      fetchImpl: (async () => jsonResponse(fixture)) as typeof fetch,
      cacheStorage,
    });

    // Andre kall: nettverket feiler helt (offline).
    const offlineFetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const result = await loadWeatherPointer(CONFIG, { fetchImpl: offlineFetch, cacheStorage });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("cache");
      expect(result.pointer).toEqual(fixture);
    }
  });

  it("gir status:'unavailable' når nettverket feiler OG ingen cache finnes fra før", async () => {
    const cacheStorage = new FakeCacheStorage();
    const offlineFetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const result = await loadWeatherPointer(CONFIG, { fetchImpl: offlineFetch, cacheStorage });
    expect(result.status).toBe("unavailable");
  });

  it("avviser en inkompatibel major-versjon (F2.3) og faller tilbake til sist synkede peker hvis en finnes", async () => {
    const cacheStorage = new FakeCacheStorage();
    const compatibleFixture = pointerFixture();
    await loadWeatherPointer(CONFIG, {
      fetchImpl: (async () => jsonResponse(compatibleFixture)) as typeof fetch,
      cacheStorage,
    });

    const incompatibleFixture = pointerFixture({ formatVersion: "99.0.0" });
    const result = await loadWeatherPointer(CONFIG, {
      fetchImpl: (async () => jsonResponse(incompatibleFixture)) as typeof fetch,
      cacheStorage,
    });
    expect(result.status).toBe("incompatible");
    if (result.status === "incompatible") {
      expect(result.fallback).toEqual(compatibleFixture);
    }
  });

  it("avviser en inkompatibel major-versjon UTEN fallback når ingen cache finnes fra før", async () => {
    const cacheStorage = new FakeCacheStorage();
    const incompatibleFixture = pointerFixture({ formatVersion: "99.0.0" });
    const result = await loadWeatherPointer(CONFIG, {
      fetchImpl: (async () => jsonResponse(incompatibleFixture)) as typeof fetch,
      cacheStorage,
    });
    expect(result.status).toBe("incompatible");
    if (result.status === "incompatible") {
      expect(result.fallback).toBeUndefined();
    }
  });

  it("behandler et ikke-JSON-svar (f.eks. en fremtidig auth-vegg som svarer med HTML) som nettverksfeil, ikke som en krasjende JSON.parse", async () => {
    const cacheStorage = new FakeCacheStorage();
    const htmlFetch = (async () =>
      new Response("<html>logg inn</html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    const result = await loadWeatherPointer(CONFIG, { fetchImpl: htmlFetch, cacheStorage });
    expect(result.status).toBe("unavailable");
  });
});
