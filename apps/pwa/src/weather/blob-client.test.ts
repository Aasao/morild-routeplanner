import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_CONFIG } from "./config.js";
import { loadWeatherBlob } from "./blob-client.js";
import { FakeCacheStorage } from "./test-support/fake-cache-storage.js";

const CONFIG = { ...DEFAULT_APP_CONFIG, apiBase: "http://localhost" };

function bufferResponse(bytes: Uint8Array): Response {
  // `Uint8Array<ArrayBufferLike>` er ikke strukturelt `BodyInit` under denne
  // TS/lib-kombinasjonen (typed-array-generic-kvirk, ikke et faktisk
  // kjøretidsproblem — `Response` godtar en `Uint8Array` fint) — snever,
  // begrunnet cast, ikke `any`.
  return new Response(bytes as BodyInit, { status: 200 });
}

describe("loadWeatherBlob", () => {
  it("henter fra nettverk ved første oppslag og cacher resultatet", async () => {
    const cacheStorage = new FakeCacheStorage();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn(async () => bufferResponse(bytes)) as unknown as typeof fetch;

    const result = await loadWeatherBlob(CONFIG, "weather/1/abc.bin", { fetchImpl, cacheStorage });
    expect(result.source).toBe("network");
    expect(new Uint8Array(result.buffer)).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bruker cache-treff FØR nettverk (innholdsadressert, immutable — §5)", async () => {
    const cacheStorage = new FakeCacheStorage();
    const bytes = new Uint8Array([9, 9, 9]);
    const fetchImpl = vi.fn(async () => bufferResponse(bytes)) as unknown as typeof fetch;

    await loadWeatherBlob(CONFIG, "weather/1/abc.bin", { fetchImpl, cacheStorage });
    const second = await loadWeatherBlob(CONFIG, "weather/1/abc.bin", { fetchImpl, cacheStorage });

    expect(second.source).toBe("cache");
    expect(new Uint8Array(second.buffer)).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // nettverket ble IKKE kalt andre gang
  });

  it("kaster en forståelig feil på HTTP-feil (404 osv.), later ikke som en tom blob er gyldig", async () => {
    const cacheStorage = new FakeCacheStorage();
    const fetchImpl = (async () => new Response(null, { status: 404 })) as typeof fetch;
    await expect(
      loadWeatherBlob(CONFIG, "weather/1/missing.bin", { fetchImpl, cacheStorage }),
    ).rejects.toThrow(/404/);
  });
});
