/**
 * Henter og cacher en innholdsadressert værblob (`docs/specs/vaerpakker.md`
 * §5, §14): `weather/<major>/<hash>.bin` via `/blob/:key`.
 *
 * Cache-FØRST, ikke bare offline-fallback: innholdsadressert data er
 * immutable under samme nøkkel (§5 — samme hash kan aldri gi et annet
 * svar), så et cache-treff er strengt korrekt, ikke bare "godt nok" —
 * network only forsøkes ved cache-bom, og resultatet caches deretter for
 * neste oppslag (offline-første, F6.4).
 */
import type { AppConfig } from "./config.js";
import { apiUrl } from "./config.js";
import { openWeatherCache, type CacheStorageLike } from "./pack-cache.js";

export interface BlobLoadResult {
  readonly buffer: ArrayBuffer;
  readonly source: "network" | "cache";
}

export interface BlobClientDeps {
  readonly fetchImpl?: typeof fetch;
  readonly cacheStorage?: CacheStorageLike;
}

function blobUrl(config: AppConfig, key: string): string {
  return apiUrl(config, `/blob/${key}`);
}

export async function loadWeatherBlob(
  config: AppConfig,
  key: string,
  deps: BlobClientDeps = {},
): Promise<BlobLoadResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = blobUrl(config, key);
  const request = new Request(url);
  const cache = await openWeatherCache(deps.cacheStorage);

  const cached = await cache.match(request);
  if (cached) {
    return { buffer: await cached.arrayBuffer(), source: "cache" };
  }

  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Henting av værblob "${key}" feilet: HTTP ${res.status}`);
  }
  await cache.put(request, res.clone());
  return { buffer: await res.arrayBuffer(), source: "network" };
}
