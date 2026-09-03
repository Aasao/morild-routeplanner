/**
 * Cache API-lagring for værpakker (D4-beslutning 2026-09-03: Cache API +
 * `navigator.storage.persist()`, IKKE IndexedDB nå — se oppdragsteksten
 * for denne bølgen og `docs/specs/app-skjelett.md` §3 "Offline-lagring").
 *
 * Eget cache-navnerom per formatversjon (major) — en fremtidig
 * major-bump skal ikke risikere å lese en gammel, inkompatibel
 * `Response`-kropp fra en tidligere appversjons cache.
 */
import { WEATHER_PACKAGE_FORMAT_VERSION } from "@morild/weather";

/**
 * Den delmengden av nettleserens `Cache` denne appen faktisk bruker.
 * Injisert (ikke `globalThis.caches` direkte) fordi verken Node.js eller
 * jsdom implementerer Cache API-en — se
 * `test-support/fake-cache-storage.ts`.
 */
export interface CacheLike {
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  put(request: RequestInfo | URL, response: Response): Promise<void>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

function formatMajor(version: string): string {
  return version.split(".")[0] ?? version;
}

/** `morild-weather-v1`, `morild-weather-v2`, … — se toppkommentaren. */
export const WEATHER_CACHE_NAME = `morild-weather-v${formatMajor(WEATHER_PACKAGE_FORMAT_VERSION)}`;

/** Global `caches` når den finnes (nettleser/service worker), ellers `undefined` (Node/jsdom i tester). */
export function browserCacheStorage(): CacheStorageLike | undefined {
  return typeof caches === "undefined" ? undefined : (caches as unknown as CacheStorageLike);
}

export async function openWeatherCache(
  cacheStorage: CacheStorageLike | undefined = browserCacheStorage(),
): Promise<CacheLike> {
  if (cacheStorage === undefined) {
    throw new Error(
      "Cache API er ikke tilgjengelig i dette miljøet — inject en CacheStorageLike (f.eks. FakeCacheStorage i tester)",
    );
  }
  return cacheStorage.open(WEATHER_CACHE_NAME);
}

/**
 * `navigator.storage.persist()` — bes om ved service worker-registrering
 * (oppdragets punkt 1). Beste-innsats: mangler API-et, eller nekter
 * nettleseren, degraderer vi stille til «best effort»-lagring (fortsatt
 * funksjonell, bare mer utsatt for automatisk sletting under lagringspress)
 * — dette blokkerer aldri appstart (N2: degradering skal være synlig, ikke
 * blokkerende, og selve persist-status er ikke sikkerhetskritisk her).
 */
export async function requestPersistentStorage(
  storage: StorageManager | undefined = typeof navigator === "undefined" ? undefined : navigator.storage,
): Promise<boolean> {
  if (storage === undefined || typeof storage.persist !== "function") {
    return false;
  }
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
