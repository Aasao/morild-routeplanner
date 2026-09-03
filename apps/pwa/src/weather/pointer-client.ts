/**
 * Henter og cacher pekerdokumentet (`docs/specs/vaerpakker.md` §14):
 * nett→cache ved suksess, cache-fallback ved nettverksfeil, og
 * kompatibilitetssjekk FØR noe forsøkes brukt (§5/§14: klienten kaller
 * `checkCompatibility` på `header.formatVersion` før den ber om noen
 * `blob`).
 *
 * Offline-først-kontrakten (F6.4, `docs/specs/app-skjelett.md` §5.5): et
 * mislykket/blokkert kall skal falle tilbake til sist cachede svar og gi et
 * eksplisitt, synlig «ingen data» — ALDRI en krasjende `JSON.parse` på noe
 * uventet (f.eks. en fremtidig auth-vegg som svarer med HTML). Denne
 * modulen forsøker aldri å parse en respons uten først å ha sjekket
 * `content-type`.
 */
import { checkCompatibility } from "@morild/protocol";
import { WEATHER_PACKAGE_FORMAT_VERSION } from "@morild/weather";
import type { AppConfig } from "./config.js";
import { apiUrl } from "./config.js";
import { openWeatherCache, type CacheStorageLike } from "./pack-cache.js";
import type { WeatherPointer } from "./pointer-types.js";

/** Kompilert inn, ikke hentet (§14) — samme kilde som pakke-lag-skjemaets versjon, se `@morild/weather`. */
export const CLIENT_WEATHER_FORMAT_VERSION = WEATHER_PACKAGE_FORMAT_VERSION;

export type PointerLoadResult =
  | { readonly status: "ok"; readonly pointer: WeatherPointer; readonly source: "network" | "cache" }
  | {
      readonly status: "incompatible";
      readonly reason: string;
      readonly fallback?: WeatherPointer;
    }
  | { readonly status: "unavailable"; readonly reason: string };

function pointerUrl(config: AppConfig): string {
  return apiUrl(config, `/pointer/${config.weatherPointerName}`);
}

function isJson(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("application/json");
}

export interface PointerClientDeps {
  readonly fetchImpl?: typeof fetch;
  readonly cacheStorage?: CacheStorageLike;
}

export async function loadWeatherPointer(
  config: AppConfig,
  deps: PointerClientDeps = {},
): Promise<PointerLoadResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = pointerUrl(config);
  const request = new Request(url);
  const cache = await openWeatherCache(deps.cacheStorage);

  let networkResponse: Response | undefined;
  try {
    const res = await fetchImpl(url);
    if (res.ok && isJson(res)) {
      networkResponse = res;
    }
  } catch {
    // Nettverksfeil (offline, DNS, osv.) — faller igjennom til cache under.
    networkResponse = undefined;
  }

  if (networkResponse) {
    const pointer = (await networkResponse.clone().json()) as WeatherPointer;
    const compat = checkCompatibility(CLIENT_WEATHER_FORMAT_VERSION, pointer.formatVersion);
    if (!compat.compatible) {
      // §14: fortsett på sist synkede lokale pakke hvis en finnes.
      const cached = await cache.match(request);
      const fallback = cached && isJson(cached) ? ((await cached.json()) as WeatherPointer) : undefined;
      return { status: "incompatible", reason: compat.reason, ...(fallback ? { fallback } : {}) };
    }
    await cache.put(request, networkResponse.clone());
    return { status: "ok", pointer, source: "network" };
  }

  const cached = await cache.match(request);
  if (cached && isJson(cached)) {
    const pointer = (await cached.json()) as WeatherPointer;
    return { status: "ok", pointer, source: "cache" };
  }
  return {
    status: "unavailable",
    reason: "Ingen nettverk og ingen tidligere cachet peker — appen har ingen værdata å vise",
  };
}
