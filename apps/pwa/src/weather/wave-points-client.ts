/**
 * Henting og klientbuffer for punktbølgen (`docs/specs/punktbolge.md` §3
 * «Klientbuffer», §4, ADR-0007).
 *
 * Kalles ÉN gang per kjøring, før kontrollen (fryseregelen håndheves av
 * `pipeline.ts`: samme `WavePointSet` går til alle jobbene). Resultatet er
 * alltid ett av tre, og alle tre er synlige i UI:
 *
 * - `"nett"`: ferskt sett fra proxyen (kan selv være `degraded` — feilede
 *   punkter står med tom `times` og vises i diagnostikken).
 * - `"buffer"`: proxyen var utilgjengelig eller svarte `failed`, og siste
 *   vellykkede sett for **denne korridoren** ble brukt, med sitt eget
 *   tidsstempel (`fetchedAtEpochS`) — «frakoblet, fra kl. HH:MM».
 * - `"mangler"`: ingen nett og intet buffer ⇒ «Bølgedata krever nett»;
 *   eller korridoren krever flere punkter enn proxyen tar. Motoren får da
 *   ingen punktbølge (`waves()` ⇒ `undefined`, delvis dekning).
 *
 * **Bufferet** ligger i Cache Storage (eget navnerom), nøklet på proxy-URL-
 * en — som ER korridoren (punktlisten er deterministisk, `wave-point-grid.ts`).
 * Kun sett med `sourceStatus !== "failed"` lagres. Mangler Cache Storage
 * (usikker kontekst) brukes appens minnecache, og `persistentBuffer: false`
 * sier ærlig at bufferet ikke overlever en sideinnlasting.
 */
import { parseWavePointSet, type WavePointSet } from "@morild/weather";
import type { LatLon } from "@morild/geo";
import { apiUrl, type AppConfig } from "./config.js";
import type { CacheStorageLike } from "./pack-cache.js";
import { pointsParam } from "./wave-point-grid.js";

export const WAVE_POINT_CACHE_NAME = "morild-punktbolge-v1";

export type WavePointLoad =
  | { readonly kind: "nett"; readonly set: WavePointSet; readonly persistentBuffer: boolean }
  | {
      readonly kind: "buffer";
      readonly set: WavePointSet;
      /** Hvorfor nettet ikke ga et brukbart sett (frakoblet, HTTP-feil, `failed`). */
      readonly reason: string;
      /** Sant når årsaken er at proxyen ikke kunne nås (frakoblet), ikke at den svarte med feil. */
      readonly offline: boolean;
      readonly persistentBuffer: boolean;
    }
  | {
      readonly kind: "mangler";
      readonly reason: "krever-nett" | "for-mange-punkter" | "kilde-feilet";
      readonly detail: string;
      readonly persistentBuffer: boolean;
    };

export interface WavePointDeps {
  readonly fetchImpl: typeof fetch;
  readonly cacheStorage: CacheStorageLike;
  /** `false` når `cacheStorage` er minnecachen (usikker kontekst). */
  readonly persistentBuffer: boolean;
}

/** Settet som skal fryses for kjøringen, eller `undefined` når bølge mangler. */
export function frozenSet(load: WavePointLoad): WavePointSet | undefined {
  return load.kind === "mangler" ? undefined : load.set;
}

async function readBuffer(deps: WavePointDeps, url: string): Promise<WavePointSet | undefined> {
  try {
    const cache = await deps.cacheStorage.open(WAVE_POINT_CACHE_NAME);
    const hit = await cache.match(url);
    return hit === undefined ? undefined : parseWavePointSet(await hit.json());
  } catch {
    return undefined; // uleselig buffer ⇒ som om det ikke fantes (N2: «krever nett» vises)
  }
}

async function writeBuffer(deps: WavePointDeps, url: string, set: WavePointSet): Promise<void> {
  try {
    const cache = await deps.cacheStorage.open(WAVE_POINT_CACHE_NAME);
    await cache.put(url, new Response(JSON.stringify(set), { headers: { "content-type": "application/json" } }));
  } catch {
    // Beste innsats: et buffer som ikke kan skrives, gjør bare neste frakoblede
    // kjøring dårligere — det er ingen grunn til å stoppe denne.
  }
}

export async function loadWavePoints(
  config: AppConfig,
  points: readonly LatLon[],
  maxPoints: number,
  deps: WavePointDeps,
): Promise<WavePointLoad> {
  const persistentBuffer = deps.persistentBuffer;
  if (points.length === 0) {
    return { kind: "mangler", reason: "kilde-feilet", detail: "ingen varselpunkter i korridoren", persistentBuffer };
  }
  if (points.length > maxPoints) {
    return {
      kind: "mangler",
      reason: "for-mange-punkter",
      detail: `korridoren krever ${points.length} varselpunkter, proxyen tar høyst ${maxPoints}`,
      persistentBuffer,
    };
  }
  const url = apiUrl(config, `/proxy/oceanforecast?points=${encodeURIComponent(pointsParam(points))}`);

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  let failure: { readonly reason: string; readonly offline: boolean } = { reason: "ukjent feil", offline: false };
  let res: Response | undefined;
  try {
    res = await deps.fetchImpl(url);
  } catch (err) {
    // `fetch` kaster kun når proxyen ikke kunne nås — det er «frakoblet».
    res = undefined;
    failure = { reason: message(err), offline: true };
  }
  if (res !== undefined) {
    if (res.ok) {
      try {
        const set = parseWavePointSet(await res.json());
        if (set.sourceStatus !== "failed") {
          await writeBuffer(deps, url, set);
          return { kind: "nett", set, persistentBuffer };
        }
        failure = { reason: `alle varselpunkter feilet hos MET (${set.sourceReason ?? "ukjent"})`, offline: false };
      } catch (err) {
        failure = { reason: `uleselig svar fra proxyen: ${message(err)}`, offline: false };
      }
    } else {
      failure = { reason: `proxyen svarte HTTP ${res.status}`, offline: false };
    }
  }

  const buffered = await readBuffer(deps, url);
  if (buffered !== undefined) {
    return { kind: "buffer", set: buffered, reason: failure.reason, offline: failure.offline, persistentBuffer };
  }
  return failure.offline
    ? { kind: "mangler", reason: "krever-nett", detail: failure.reason, persistentBuffer }
    : { kind: "mangler", reason: "kilde-feilet", detail: failure.reason, persistentBuffer };
}
