/**
 * Punktbølge fra MET Oceanforecast 2.0 via Worker-proxyen
 * (`docs/specs/punktbolge.md`, ADR-0007).
 *
 * Tre ting bor her, alle rene og deterministiske (ingen I/O — hentingen og
 * klientbufferet lever i `apps/pwa`):
 *
 * 1. **Wire-kontrakten** `WavePointSet` (`"morild-punktbolge/1"`) som
 *    proxyen svarer med og klienten fryser per kjøring. `apps/worker` har en
 *    strukturell kopi (Workeren avhenger bevisst ikke av workspace-pakkene);
 *    de to holdes i synk manuelt. `parseWavePointSet` validerer et svar fra
 *    nettet/bufferet før det slippes inn i motoren.
 * 2. **Oppslaget** (`wavePointLookup`, spec §3 «Oppslag i motoren»):
 *    nærmeste punkt med data (storsirkelavstand, samme ordning som
 *    haversine) innenfor `WAVE_POINT_MAX_DISTANCE_NM` (D16.2); lineær i tid
 *    mellom punktets to nærmeste tidssteg; retning lineært på sirkelen;
 *    `hsM === null` eller utenfor punktets tidsrom ⇒ `undefined`. **`tpS`
 *    settes aldri** — kilden har ingen periode (D14.1), og motorens
 *    `waveFactor` bruker da v1-heuristikken.
 * 3. **`withWavePoints`**: legger punktbølgen på et eksisterende
 *    `WeatherFieldLike` (etter `compositeWeatherField`), og eksponerer
 *    `wavePointDistanceNm` til motorens per-steg-merking.
 *
 * **Fryseregelen (ADR-0007)** håndheves av kalleren: ett `WavePointSet`
 * (ett `hash`) per kjøring, delt av kontroll, medlemmer og perturbasjon.
 * Her er alt en ren funksjon av settet — samme sett ⇒ samme svar.
 */
import { haversineNm } from "@morild/geo";
import type { WaveSample } from "./samples.js";
import type { WeatherFieldLike } from "./weather-field-adapter.js";

export const WAVE_POINT_SET_SCHEMA = "morild-punktbolge/1" as const;

/** D16.1 (vedtatt 2026-09-29): punktavstand i gitteret over korridoren. */
export const WAVE_POINT_SPACING_NM = 10;

/** D16.2 (vedtatt 2026-09-29): lenger unna enn dette ⇒ bølge mangler (`undefined`). */
export const WAVE_POINT_MAX_DISTANCE_NM = 10;

/**
 * Største antall punkter proxyen tar i ett kall. Styrt av Cloudflare
 * Workers' gratisplan: **50 delforespørsler per kall, og Cache API-kall
 * deler den kvoten** (developers.cloudflare.com/workers/platform/limits,
 * lest 2026-09-29). Proxyen bruker 1 cache-oppslag + ≤ 1 MET-kall per punkt
 * + 1 cache-skriving ⇒ 48 punkter er taket. Skjæløy–Skagen gir 34 punkter
 * med 10 nm (målt på A*-feltet, se `apps/pwa/src/weather/wave-point-grid.ts`).
 */
export const WAVE_POINTS_MAX = 48;

export interface WavePointTime {
  readonly epochS: number;
  /** Signifikant bølgehøyde (m). `null` = MET hadde ikke verdien i dette tidssteget. */
  readonly hsM: number | null;
  /** FRA-retning (grader, MET-konvensjon). `null` = mangler. */
  readonly fromDeg: number | null;
}

/**
 * - `"ok"`: MET svarte med tidsserie.
 * - `"ingen-data"`: MET svarte, men har ingen data i punktet (typisk land —
 *   `meta.error: "no data at the given location"`). Ikke en feil hos MET.
 * - `"feilet"`: nettverksfeil, HTTP-feil eller uleselig svar hos MET.
 *
 * Begge de to siste står med tom `times` — aldri utelatt i stillhet (spec §3).
 */
export type WavePointStatus = "ok" | "ingen-data" | "feilet";

export interface WavePoint {
  /** Forespurt posisjon, avrundet til 4 desimaler (MET-vilkårene). */
  readonly lat: number;
  readonly lon: number;
  /**
   * Posisjonen MET faktisk leverte data for (`geometry.coordinates` — MET
   * snapper til nærmeste modellpunkt, målt 2026-09-29: forespurt
   * 58,5000/10,7000 ⇒ levert 58,4945/10,6748). Oppslaget måler avstand hit,
   * ikke til den forespurte posisjonen: det er her bølgen gjelder. `null`
   * når MET ikke oppga posisjon.
   */
  readonly sourceLat: number | null;
  readonly sourceLon: number | null;
  readonly status: WavePointStatus;
  /** Stigende i tid. Tom når `status !== "ok"`. */
  readonly times: readonly WavePointTime[];
}

export type WaveSourceStatus = "ok" | "degraded" | "failed";

export interface WavePointSet {
  readonly schema: typeof WAVE_POINT_SET_SCHEMA;
  /** Når proxyen hentet/revaliderte (eldste bekreftelse over punktene med data), epoch-sekunder. */
  readonly fetchedAtEpochS: number;
  readonly points: readonly WavePoint[];
  /** `"degraded"` når minst ett punkt feilet hos MET, `"failed"` når alle gjorde det. */
  readonly sourceStatus: WaveSourceStatus;
  /** Årsak når `sourceStatus !== "ok"`, ellers `null`. */
  readonly sourceReason: string | null;
  /** SHA-256 (hex) over kanonisk JSON av `points` — identiteten fryseregelen bærer. */
  readonly hash: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function nullableNumber(v: unknown, what: string): number | null {
  if (v === null) return null;
  if (isFiniteNumber(v)) return v;
  throw new Error(`WavePointSet: ${what} må være et endelig tall eller null`);
}

/**
 * Validerer et `WavePointSet` fra nettet eller klientbufferet. Kaster med
 * forklarende tekst ved feil form — et uleselig sett skal aldri bli til
 * stille manglende bølge uten at noen får vite hvorfor.
 */
export function parseWavePointSet(raw: unknown): WavePointSet {
  if (typeof raw !== "object" || raw === null) throw new Error("WavePointSet: ikke et objekt");
  const o = raw as Record<string, unknown>;
  if (o["schema"] !== WAVE_POINT_SET_SCHEMA) {
    throw new Error(`WavePointSet: ukjent skjema ${JSON.stringify(o["schema"])}`);
  }
  if (!isFiniteNumber(o["fetchedAtEpochS"])) throw new Error("WavePointSet: fetchedAtEpochS mangler");
  if (typeof o["hash"] !== "string" || o["hash"].length === 0) throw new Error("WavePointSet: hash mangler");
  const status = o["sourceStatus"];
  if (status !== "ok" && status !== "degraded" && status !== "failed") {
    throw new Error(`WavePointSet: ukjent sourceStatus ${JSON.stringify(status)}`);
  }
  const reason = o["sourceReason"];
  if (reason !== null && typeof reason !== "string") throw new Error("WavePointSet: sourceReason må være tekst eller null");
  if (!Array.isArray(o["points"])) throw new Error("WavePointSet: points mangler");
  const points: WavePoint[] = o["points"].map((p: unknown, i: number): WavePoint => {
    if (typeof p !== "object" || p === null) throw new Error(`WavePointSet: punkt ${i} er ikke et objekt`);
    const q = p as Record<string, unknown>;
    if (!isFiniteNumber(q["lat"]) || !isFiniteNumber(q["lon"])) throw new Error(`WavePointSet: punkt ${i} mangler lat/lon`);
    const st = q["status"];
    if (st !== "ok" && st !== "ingen-data" && st !== "feilet") {
      throw new Error(`WavePointSet: punkt ${i} har ukjent status ${JSON.stringify(st)}`);
    }
    if (!Array.isArray(q["times"])) throw new Error(`WavePointSet: punkt ${i} mangler times`);
    let prev = -Infinity;
    const times = q["times"].map((t: unknown): WavePointTime => {
      if (typeof t !== "object" || t === null) throw new Error(`WavePointSet: punkt ${i} har et ugyldig tidssteg`);
      const r = t as Record<string, unknown>;
      if (!isFiniteNumber(r["epochS"])) throw new Error(`WavePointSet: punkt ${i} har tidssteg uten epochS`);
      if (r["epochS"] <= prev) throw new Error(`WavePointSet: punkt ${i} har tidssteg som ikke er strengt stigende`);
      prev = r["epochS"];
      return {
        epochS: r["epochS"],
        hsM: nullableNumber(r["hsM"], `punkt ${i} hsM`),
        fromDeg: nullableNumber(r["fromDeg"], `punkt ${i} fromDeg`),
      };
    });
    return {
      lat: q["lat"],
      lon: q["lon"],
      sourceLat: nullableNumber(q["sourceLat"] ?? null, `punkt ${i} sourceLat`),
      sourceLon: nullableNumber(q["sourceLon"] ?? null, `punkt ${i} sourceLon`),
      status: st,
      times,
    };
  });
  return {
    schema: WAVE_POINT_SET_SCHEMA,
    fetchedAtEpochS: o["fetchedAtEpochS"],
    points,
    sourceStatus: status,
    sourceReason: reason,
    hash: o["hash"],
  };
}

export interface WavePointLookup {
  waves(lat: number, lon: number, epochS: number): WaveSample | undefined;
  /** Avstand (nm) til nærmeste punkt med data, uansett grensen. `undefined` når ingen punkter har data. */
  wavePointDistanceNm(lat: number, lon: number): number | undefined;
}

export interface WavePointLookupOptions {
  /** Overstyrer D16.2-grensen (tester). */
  readonly maxDistanceNm?: number;
}

const DEG = Math.PI / 180;

/** Lineær interpolasjon av retning på sirkelen (korteste bue), normalisert til [0, 360). */
export function lerpDirectionDeg(a: number, b: number, frac: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  const v = a + d * frac;
  return ((v % 360) + 360) % 360;
}

function sampleAt(times: readonly WavePointTime[], epochS: number): WaveSample | undefined {
  const n = times.length;
  if (n === 0) return undefined;
  const first = times[0]!;
  const last = times[n - 1]!;
  if (epochS < first.epochS || epochS > last.epochS) return undefined;
  // Binærsøk: største i med times[i].epochS <= epochS.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]!.epochS <= epochS) lo = mid;
    else hi = mid - 1;
  }
  const a = times[lo]!;
  if (a.epochS === epochS || lo === n - 1) {
    if (a.hsM === null) return undefined;
    return a.fromDeg === null ? { hsM: a.hsM } : { hsM: a.hsM, fromDeg: ((a.fromDeg % 360) + 360) % 360 };
  }
  const b = times[lo + 1]!;
  // Et manglende nabosteg ⇒ ingen verdi: vi interpolerer aldri over et hull.
  if (a.hsM === null || b.hsM === null) return undefined;
  const frac = (epochS - a.epochS) / (b.epochS - a.epochS);
  const hsM = a.hsM + (b.hsM - a.hsM) * frac;
  if (a.fromDeg === null || b.fromDeg === null) return { hsM };
  return { hsM, fromDeg: lerpDirectionDeg(a.fromDeg, b.fromDeg, frac) };
}

/**
 * Oppslag i et fryst `WavePointSet` (spec §3). Kun punkter med tidsserie
 * deltar i nærmeste-punkt-valget; `"ingen-data"`/`"feilet"` gjør det ikke.
 *
 * Nærmeste punkt finnes via enhetsvektorer (største prikkprodukt = korteste
 * storsirkelavstand — samme ordning som haversine, men uten trigonometri per
 * punkt i den varme løkken; motoren slår opp bølge ved hver ekspansjon).
 * Likhet ⇒ laveste indeks, deterministisk. Selve avstanden regnes med
 * `haversineNm` til det valgte punktet.
 */
export function wavePointLookup(set: WavePointSet, opts: WavePointLookupOptions = {}): WavePointLookup {
  const maxDistanceNm = opts.maxDistanceNm ?? WAVE_POINT_MAX_DISTANCE_NM;
  const pts = set.points.filter((p) => p.times.length > 0);
  const n = pts.length;
  const lats = new Float64Array(n);
  const lons = new Float64Array(n);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const lat = p.sourceLat ?? p.lat;
    const lon = p.sourceLon ?? p.lon;
    lats[i] = lat;
    lons[i] = lon;
    const cl = Math.cos(lat * DEG);
    xs[i] = cl * Math.cos(lon * DEG);
    ys[i] = cl * Math.sin(lon * DEG);
    zs[i] = Math.sin(lat * DEG);
  }

  function nearest(lat: number, lon: number): { readonly index: number; readonly distanceNm: number } | undefined {
    if (n === 0) return undefined;
    const cl = Math.cos(lat * DEG);
    const qx = cl * Math.cos(lon * DEG);
    const qy = cl * Math.sin(lon * DEG);
    const qz = Math.sin(lat * DEG);
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < n; i++) {
      const dot = xs[i]! * qx + ys[i]! * qy + zs[i]! * qz;
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    return { index: best, distanceNm: haversineNm({ lat, lon }, { lat: lats[best]!, lon: lons[best]! }) };
  }

  return {
    waves(lat, lon, epochS) {
      const hit = nearest(lat, lon);
      if (hit === undefined || hit.distanceNm > maxDistanceNm) return undefined;
      return sampleAt(pts[hit.index]!.times, epochS);
    },
    wavePointDistanceNm(lat, lon) {
      return nearest(lat, lon)?.distanceNm;
    },
  };
}

/**
 * Legger punktbølgen på et felt (typisk etter `compositeWeatherField`).
 * Med punktbølge kommer `waves()` **kun** fra punktene — et eventuelt
 * gridded bølgelag i pakken blandes ikke inn (to kilder med ulik
 * semantikk i samme oppslag ville gjort `hash`-identiteten ufullstendig).
 * Alt annet delegeres uendret.
 */
export function withWavePoints(
  field: WeatherFieldLike,
  set: WavePointSet,
  opts: WavePointLookupOptions = {},
): WeatherFieldLike {
  const lookup = wavePointLookup(set, opts);
  const out: WeatherFieldLike = {
    wind: (lat, lon, epochS) => field.wind(lat, lon, epochS),
    waves: (lat, lon, epochS) => lookup.waves(lat, lon, epochS),
    current: (lat, lon, epochS) => field.current(lat, lon, epochS),
    wavePointDistanceNm: (lat, lon) => lookup.wavePointDistanceNm(lat, lon),
    maxTwsKn: field.maxTwsKn,
    maxCurrentKn: field.maxCurrentKn,
    maxDecodeErrorKn: field.maxDecodeErrorKn,
    validFromS: field.validFromS,
    validToS: field.validToS,
    header: field.header,
  };
  const coastal = field.currentCoastal?.bind(field);
  const decodeAt = field.maxDecodeErrorKnAt?.bind(field);
  return {
    ...out,
    ...(coastal !== undefined ? { currentCoastal: coastal } : {}),
    ...(decodeAt !== undefined ? { maxDecodeErrorKnAt: decodeAt } : {}),
  };
}

/**
 * Avstand til nærmeste punkt for en liste posisjoner (rutens steg) —
 * diagnostikken «maks og median» (spec §4.1). `null` for tom liste eller
 * når settet ikke har punkter med data. Median = nærmeste-rang (øvre ved
 * partall), samme konvensjon som resten av robusthetslaget.
 */
export function wavePointDistanceStats(
  set: WavePointSet,
  positions: readonly { readonly lat: number; readonly lon: number }[],
): { readonly maxNm: number; readonly medianNm: number; readonly beyondLimit: number } | null {
  const lookup = wavePointLookup(set);
  const ds: number[] = [];
  for (const p of positions) {
    const d = lookup.wavePointDistanceNm(p.lat, p.lon);
    if (d !== undefined) ds.push(d);
  }
  if (ds.length === 0) return null;
  ds.sort((a, b) => a - b);
  return {
    maxNm: ds[ds.length - 1]!,
    medianNm: ds[Math.floor(ds.length / 2)]!,
    beyondLimit: ds.filter((d) => d > WAVE_POINT_MAX_DISTANCE_NM).length,
  };
}
