/**
 * NorKyst v3 800 m (THREDDS `fou-hi/norkystv3_800m_m00_be`) — nettverkssiden
 * for strømlaget (`docs/specs/strom-produsent.md` §4 steg 2–3,
 * `docs/specs/vaerpakker.md` §16).
 *
 * Alle kall går sekvensielt (aldri `Promise.all` — §16: aldri parallelle
 * OPeNDAP-sesjoner), via `fetchWithBackoff` med den identifiserende
 * User-Agenten. `fetchImpl` injiseres alltid; ingen fil her binder seg til
 * det globale `fetch` (det gjør `build-live-package.ts`, bak legal-gaten).
 *
 * Lokalisering (invariant 4): nærmeste-punkt-søk mot en grov prøve av HELE
 * domenet, deterministisk etterfulgt av en lokal, sammenhengende fulloppløst
 * blokk rundt treffet — spike-mønsteret fra
 * `tools/spikes/thredds/05-norkyst-geometry-compare.mjs`. Aldri bbox-
 * containment på den grove prøven.
 */
import { decodeDodsArray, findDataSectionOffset } from "./dap2.js";
import type { IndexWindow } from "./grid.js";
import { strideIndices } from "./live-source.js";
import { buildDodsUrl, fetchWithBackoff, type BackoffOptions, type FetchLike } from "./opendap-client.js";
import {
  NORKYST_ADD_OFFSET,
  NORKYST_FILL_VALUE,
  NORKYST_SCALE_FACTOR,
  NORKYST_SURFACE_DEPTH_INDEX,
  nearestSampleNode,
  paddedTileBbox,
  sliceBlock,
  windowInLocalBlock,
  type Bbox,
  type LatLonSample,
} from "./current-geometry.js";

export const NORKYST_DATASET_URL = "https://thredds.met.no/thredds/dodsC/fou-hi/norkystv3_800m_m00_be";
/** Cache-nøkkelrom (spec §4 steg 2): egen nøkkel per datasett + flis, adskilt fra MEPS-cachen. */
export const NORKYST_CACHE_NAMESPACE = "norkystv3_800m_m00_be";

/** Grov prøve over hele domenet: samme stride som spiken (6×10 ⇒ ~5×8 km mellom prøvepunktene). */
export const NORKYST_COARSE_STRIDE = { y: 6, x: 10 } as const;
/**
 * Halv bredde (native celler) på den lokale fulloppløste blokken rundt
 * nærmeste-punkt-treffet. En 1°-flis + margin spenner ~140 celler i
 * nord-sør og ~75 i øst-vest, dreid ~60° i indeksrommet — 170 gir romslig
 * plass. Er blokken likevel for liten, feiler lokaliseringen høyt
 * (`touchesOpenEdge`), aldri et stille avkuttet vindu.
 */
export const NORKYST_FINE_HALF_WINDOW = 170;

export interface NorkystRequestContext {
  readonly datasetUrl: string;
  readonly fetchImpl: FetchLike;
  readonly userAgent: string;
  readonly backoff?: BackoffOptions;
}

async function fetchBytes(ctx: NorkystRequestContext, url: string): Promise<Uint8Array> {
  const { buffer } = await fetchWithBackoff(url, ctx.userAgent, ctx.fetchImpl, ctx.backoff);
  return new Uint8Array(buffer);
}

async function fetchText(ctx: NorkystRequestContext, url: string): Promise<string> {
  return new TextDecoder("utf-8").decode(await fetchBytes(ctx, url));
}

// --- Metadata (DDS/DAS) --------------------------------------------------------

export interface NorkystDims {
  readonly yCount: number;
  readonly xCount: number;
  readonly timeCount: number;
}

/** Leser Y/X/time-lengdene ut av DDS-teksten (`Float64 time[time = N]` osv.). */
export function parseNorkystDims(ddsText: string): NorkystDims {
  const dim = (name: string): number => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(\\d+)`).exec(ddsText);
    if (!m || m[1] === undefined) throw new Error(`NorKyst-DDS mangler dimensjonen "${name}"`);
    return Number(m[1]);
  };
  return { yCount: dim("Y"), xCount: dim("X"), timeCount: dim("time") };
}

export interface NorkystComponentAttributes {
  readonly fillValue: number | undefined;
  readonly scaleFactor: number | undefined;
  readonly addOffset: number | undefined;
  readonly units: string | undefined;
}

/** Trekker `_FillValue`/`scale_factor`/`add_offset`/`units` for én variabel ut av DAS-teksten. */
export function parseNorkystComponentAttributes(dasText: string, variable: string): NorkystComponentAttributes {
  const start = dasText.search(new RegExp(`\\n\\s*${variable}\\s*\\{`));
  if (start < 0) throw new Error(`NorKyst-DAS mangler variabelen "${variable}"`);
  const end = dasText.indexOf("}", start);
  const block = dasText.slice(start, end < 0 ? undefined : end);
  const num = (attr: string): number | undefined => {
    const m = new RegExp(`\\b${attr}\\s+(-?[0-9.eE+-]+)\\s*;`).exec(block);
    return m && m[1] !== undefined ? Number(m[1]) : undefined;
  };
  const unitsMatch = /\bunits\s+"([^"]*)"/.exec(block);
  return {
    fillValue: num("_FillValue"),
    scaleFactor: num("scale_factor"),
    addOffset: num("add_offset"),
    units: unitsMatch?.[1],
  };
}

/**
 * Hard verifisering av kodingen vi hardkoder i `current-geometry.ts`
 * (samme filosofi som LCC-verifiseringen for vind): et avvik betyr at
 * avskaleringen eller fill-sjekken ville vært feil, og da skal det ikke
 * bygges et strømlag i det hele tatt. Returnerer avvikene (tom = ok).
 */
export function verifyNorkystComponentAttributes(dasText: string): string[] {
  const mismatches: string[] = [];
  for (const variable of ["u_eastward", "v_northward"]) {
    const a = parseNorkystComponentAttributes(dasText, variable);
    if (a.fillValue !== NORKYST_FILL_VALUE) mismatches.push(`${variable}._FillValue = ${a.fillValue} (forventet ${NORKYST_FILL_VALUE})`);
    if (a.scaleFactor === undefined || Math.abs(a.scaleFactor - NORKYST_SCALE_FACTOR) > 1e-12) {
      mismatches.push(`${variable}.scale_factor = ${a.scaleFactor} (forventet ${NORKYST_SCALE_FACTOR})`);
    }
    if ((a.addOffset ?? 0) !== NORKYST_ADD_OFFSET) mismatches.push(`${variable}.add_offset = ${a.addOffset} (forventet ${NORKYST_ADD_OFFSET})`);
    if (a.units !== "meter second-1" && a.units !== "m/s" && a.units !== "m s-1") {
      mismatches.push(`${variable}.units = "${a.units}" (forventet m/s)`);
    }
  }
  const time = parseNorkystComponentAttributes(dasText, "time");
  if (time.units === undefined || !/^seconds since 1970-01-01/.test(time.units)) {
    mismatches.push(`time.units = "${time.units}" (forventet "seconds since 1970-01-01 ...")`);
  }
  return mismatches;
}

export async function fetchNorkystMetadata(
  ctx: NorkystRequestContext,
): Promise<{ readonly dims: NorkystDims; readonly dasText: string }> {
  const ddsText = await fetchText(ctx, `${ctx.datasetUrl}.dds`);
  const dasText = await fetchText(ctx, `${ctx.datasetUrl}.das`);
  return { dims: parseNorkystDims(ddsText), dasText };
}

/**
 * `forecast_reference_time` (skalar, sekunder siden 1970) via `.ascii` —
 * brukes som `PackageHeader.init`. `undefined` hvis svaret ikke lar seg
 * tolke (kalleren merker det i `sourceStatus`, gjetter ikke).
 */
export async function fetchNorkystReferenceTime(ctx: NorkystRequestContext): Promise<string | undefined> {
  const text = await fetchText(ctx, `${ctx.datasetUrl}.ascii?forecast_reference_time`);
  return parseReferenceTimeAscii(text);
}

export function parseReferenceTimeAscii(text: string): string | undefined {
  const numbers = text.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  const last = numbers?.[numbers.length - 1];
  if (last === undefined) return undefined;
  const epochS = Number(last);
  // Plausibilitetssjekk: etter 2020, før 2100 — ellers er det ikke en epoke.
  if (!Number.isFinite(epochS) || epochS < 1_577_836_800 || epochS > 4_102_444_800) return undefined;
  return new Date(epochS * 1000).toISOString().replace(".000Z", "Z");
}

/** Siste `tailCount` verdier av den løpende tidsaksen (epoke-sekunder). */
export async function fetchNorkystTimeTail(
  ctx: NorkystRequestContext,
  timeCount: number,
  tailCount: number,
): Promise<{ readonly firstIndex: number; readonly timesS: Float64Array }> {
  const firstIndex = Math.max(0, timeCount - tailCount);
  const url = buildDodsUrl(ctx.datasetUrl, "time", [{ start: firstIndex, stop: timeCount - 1 }]);
  const bytes = await fetchBytes(ctx, url);
  const timesS = decodeDodsArray(bytes, findDataSectionOffset(bytes), "Float64").values;
  return { firstIndex, timesS };
}

// --- lat/lon og lokalisering -----------------------------------------------------

/** Henter 2D `lat`/`lon` for et vindu med gitt stride — sekvensielt (lat, så lon). */
export async function fetchNorkystLatLon(
  ctx: NorkystRequestContext,
  window: IndexWindow,
  stride: { readonly y: number; readonly x: number } = { y: 1, x: 1 },
): Promise<LatLonSample> {
  const dims = [
    { start: window.yStart, stop: window.yEnd, stride: stride.y },
    { start: window.xStart, stop: window.xEnd, stride: stride.x },
  ];
  const decode = async (variable: "lat" | "lon"): Promise<Float64Array> => {
    const bytes = await fetchBytes(ctx, buildDodsUrl(ctx.datasetUrl, variable, dims));
    return decodeDodsArray(bytes, findDataSectionOffset(bytes), "Float64").values;
  };
  const lat = await decode("lat");
  const lon = await decode("lon");
  const yIndices = strideIndices(window.yEnd - window.yStart, stride.y).map((i) => i + window.yStart);
  const xIndices = strideIndices(window.xEnd - window.xStart, stride.x).map((i) => i + window.xStart);
  if (lat.length !== yIndices.length * xIndices.length || lon.length !== lat.length) {
    throw new Error(
      `NorKyst lat/lon: forventet ${yIndices.length}×${xIndices.length} verdier, fikk lat=${lat.length}, lon=${lon.length}`,
    );
  }
  return { yIndices, xIndices, lat, lon };
}

/** Hentefunksjon for lat/lon — injisert slik at lokaliseringen kan testes mot et syntetisk domene. */
export type LatLonFetcher = (
  window: IndexWindow,
  stride: { readonly y: number; readonly x: number },
) => Promise<LatLonSample>;

export interface LocatedCurrentTile {
  /** Globalt indeksvindu for flisen + margin. */
  readonly window: IndexWindow;
  /** Kildens 2D lat/lon for `window`, row-major. */
  readonly lat: Float64Array;
  readonly lon: Float64Array;
}

/**
 * Invariant 4: nærmeste-punkt-søk mot den grove prøven (flisens senter), så
 * en lokal, sammenhengende fulloppløst blokk rundt treffet, og først DER
 * containment mot flisens bbox + margin. `undefined` ⇒ ingen kildenoder i
 * flisen (utenfor NorKyst-domenet) — kalleren merker strøm som manglende.
 */
export async function locateCurrentTile(args: {
  readonly tileBounds: Bbox;
  readonly dims: { readonly yCount: number; readonly xCount: number };
  readonly coarse: LatLonSample;
  readonly fetchLatLon: LatLonFetcher;
  readonly fineHalfWindow?: number;
}): Promise<LocatedCurrentTile | undefined> {
  const half = args.fineHalfWindow ?? NORKYST_FINE_HALF_WINDOW;
  const b = args.tileBounds;
  const nearest = nearestSampleNode(args.coarse, (b.south + b.north) / 2, (b.west + b.east) / 2);
  if (nearest === undefined) return undefined;
  const blockWindow: IndexWindow = {
    yStart: Math.max(0, nearest.y - half),
    yEnd: Math.min(args.dims.yCount - 1, nearest.y + half),
    xStart: Math.max(0, nearest.x - half),
    xEnd: Math.min(args.dims.xCount - 1, nearest.x + half),
  };
  const block = await args.fetchLatLon(blockWindow, { y: 1, x: 1 });
  const blockWithWindow = { window: blockWindow, lat: block.lat, lon: block.lon };
  const found = windowInLocalBlock(blockWithWindow, paddedTileBbox(b), args.dims);
  if (found === undefined) return undefined;
  if (found.touchesOpenEdge) {
    throw new Error(
      `NorKyst-lokalisering: flisvinduet ${JSON.stringify(found.window)} treffer kanten av den lokale blokken ` +
        `${JSON.stringify(blockWindow)} — blokken er for liten (øk NORKYST_FINE_HALF_WINDOW), nekter å bygge et avkuttet vindu`,
    );
  }
  const { lat, lon } = sliceBlock(blockWithWindow, found.window);
  return { window: found.window, lat, lon };
}

// --- u/v rådata ------------------------------------------------------------------

export interface FetchedCurrentRaw {
  /** Rå Int16 (som tall), layout `[t][y*xCount+x]`, t relativt til `timeStart`. */
  readonly uRaw: Float64Array;
  readonly vRaw: Float64Array;
  readonly timeStart: number;
  readonly timeCount: number;
  readonly nodeCount: number;
}

/**
 * Henter `u_eastward` og `v_northward` for overflatelaget (depth-indeks 0)
 * over et sammenhengende tidsintervall — ett kall per komponent,
 * SEKVENSIELT (§16). Verdiene returneres RÅ (Int16): fill-sjekk og
 * avskalering skjer i `current-geometry.ts` (invariant 1).
 */
export async function fetchCurrentRaw(
  ctx: NorkystRequestContext,
  window: IndexWindow,
  timeStart: number,
  timeEnd: number,
): Promise<FetchedCurrentRaw> {
  const dims = [
    { start: timeStart, stop: timeEnd },
    { start: NORKYST_SURFACE_DEPTH_INDEX, stop: NORKYST_SURFACE_DEPTH_INDEX },
    { start: window.yStart, stop: window.yEnd },
    { start: window.xStart, stop: window.xEnd },
  ];
  const nodeCount = (window.yEnd - window.yStart + 1) * (window.xEnd - window.xStart + 1);
  const timeCount = timeEnd - timeStart + 1;
  const decode = async (variable: "u_eastward" | "v_northward"): Promise<Float64Array> => {
    const bytes = await fetchBytes(ctx, buildDodsUrl(ctx.datasetUrl, variable, dims));
    const values = decodeDodsArray(bytes, findDataSectionOffset(bytes), "Int16").values;
    if (values.length !== timeCount * nodeCount) {
      throw new Error(`NorKyst ${variable}: forventet ${timeCount}×${nodeCount} verdier, fikk ${values.length}`);
    }
    return values;
  };
  const uRaw = await decode("u_eastward");
  const vRaw = await decode("v_northward");
  return { uRaw, vRaw, timeStart, timeCount, nodeCount };
}
