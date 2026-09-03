/**
 * Ekte THREDDS-oppslag: katalog-parsing, ensemble-medlemstelling og
 * grid-indeks-probing mot MEPS' `mepslatest`-katalog
 * (`docs/specs/vaerpakker.md` §7, §11; `docs/legal/met-norway-thredds.md`).
 *
 * Rene, testbare funksjoner (streng-/XML-parsing, vindu-utledning) er
 * skilt fra de tynne nettverksfunksjonene (`fetchImpl`-injisert, ALDRI kalt
 * direkte fra denne fila mot det globale `fetch` — det er
 * `build-live-package.ts`s ansvar, bak `--live` + legal-gate).
 *
 * Strategi for bbox→indeksvindu er identisk med den verifiserte spiken
 * (`tools/spikes/thredds/02-find-bbox-indices.mjs`): en grov, stridet probe
 * over et margin-utvidet område, deretter en fin probe (stride 1) i et
 * polstret nabolag av det grove resultatet. Sekvensielt (§16 — aldri
 * parallelle OPeNDAP-sesjoner).
 */
import { decodeDodsArray, findDataSectionOffset } from "./dap2.js";
import { buildDodsUrl, fetchWithBackoff, type BackoffOptions, type FetchLike } from "./opendap-client.js";
import type { IndexWindow } from "./grid.js";

// --- Katalog-parsing (ren) ----------------------------------------------

const RUN_NAME_PATTERN = /meps_lagged_6_h_latest_2_5km_(\d{8}T\d{2})Z\.nc(?!ml)/g;

/**
 * Trekker ut alle ekte (ikke `.ncml`) `meps_lagged_6_h_latest_2_5km_*.nc`-
 * kjøringsnavn fra `mepslatest/catalog.xml`-teksten, sortert NYEST FØRST
 * (§11s `selectEnsembleRun` forventer akkurat den rekkefølgen). `.ncml`-
 * varianter (aggregerings-metadata, ikke selve dataset-URL-en å hente fra)
 * ekskluderes bevisst.
 */
export function parseMepsLatestCatalogRunNames(catalogXml: string): string[] {
  const matches = [...catalogXml.matchAll(RUN_NAME_PATTERN)];
  const names = matches.map((m) => `meps_lagged_6_h_latest_2_5km_${m[1]}Z.nc`);
  const unique = [...new Set(names)];
  return unique.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // strengsortering funker (fast bredde, ISO-lik)
}

/** Init-tidspunkt (ISO 8601) utledet av et kjøringsnavn, f.eks. `...20260903T00Z.nc` → `2026-09-03T00:00:00Z`. */
export function initTimeFromRunName(runName: string): string {
  const m = /(\d{4})(\d{2})(\d{2})T(\d{2})Z\.nc$/.exec(runName);
  if (!m) throw new Error(`Kjenner ikke igjen kjøringsnavn-mønsteret: ${runName}`);
  const [, year, month, day, hour] = m;
  return `${year}-${month}-${day}T${hour}:00:00Z`;
}

const ENSEMBLE_MEMBER_DIM_PATTERN = /ensemble_member\s*=\s*(\d+)/;

/** Parser `ensemble_member[ensemble_member = N]`-dimensjonslengden ut av en DDS-headertekst. */
export function parseEnsembleMemberCountFromDds(ddsText: string): number {
  const m = ENSEMBLE_MEMBER_DIM_PATTERN.exec(ddsText);
  if (!m || m[1] === undefined) {
    throw new Error("Fant ikke 'ensemble_member = N' i DDS-headeren");
  }
  return Number(m[1]);
}

// --- Grid-indeksvindu (delvis ren: selve vindu-utledningen er ren) -------

export interface Bbox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** Genererer `[0, stride, 2*stride, ...]` opp til og med siste indeks `<= stop` — MÅ matche hva en `[0:stride:stop]`-OPeNDAP-forespørsel faktisk returnerer. */
export function strideIndices(stop: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= stop; i += stride) out.push(i);
  return out;
}

/**
 * Finner (yMin,yMax,xMin,xMax) blant de probede punktene som faller
 * innenfor `bbox`. Ren funksjon — samme logikk som spikens `findWindow`,
 * flyttet hit for gjenbruk og enhetstesting uten nettverk.
 */
export function findBboxIndexWindow(
  yIndices: readonly number[],
  xIndices: readonly number[],
  lon: ArrayLike<number>,
  lat: ArrayLike<number>,
  bbox: Bbox,
): IndexWindow | undefined {
  let yMin = Infinity;
  let yMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let ri = 0; ri < yIndices.length; ri++) {
    for (let ci = 0; ci < xIndices.length; ci++) {
      const flat = ri * xIndices.length + ci;
      const lo = lon[flat];
      const la = lat[flat];
      if (lo === undefined || la === undefined) continue;
      if (lo >= bbox.west && lo <= bbox.east && la >= bbox.south && la <= bbox.north) {
        const yIdx = yIndices[ri];
        const xIdx = xIndices[ci];
        if (yIdx === undefined || xIdx === undefined) continue;
        yMin = Math.min(yMin, yIdx);
        yMax = Math.max(yMax, yIdx);
        xMin = Math.min(xMin, xIdx);
        xMax = Math.max(xMax, xIdx);
      }
    }
  }
  if (!Number.isFinite(yMin)) return undefined;
  return { yStart: yMin, yEnd: yMax, xStart: xMin, xEnd: xMax };
}

// --- Tynne nettverksfunksjoner (fetchImpl-injisert) ----------------------

/** Henter og dekoder én 2D `Float64`-variabel (`longitude`/`latitude`) for et gitt (y,x)-vindu, valgfri stride. */
export async function fetchLonLatWindow(
  datasetUrl: string,
  window: IndexWindow,
  stride: number,
  fetchImpl: FetchLike,
  userAgent: string,
  backoff?: BackoffOptions,
): Promise<{ readonly lon: Float64Array; readonly lat: Float64Array; readonly yIndices: number[]; readonly xIndices: number[] }> {
  const yIndices = strideIndices(window.yEnd, stride).filter((i) => i >= window.yStart);
  const xIndices = strideIndices(window.xEnd, stride).filter((i) => i >= window.xStart);
  const dims = [
    { start: window.yStart, stop: window.yEnd, stride },
    { start: window.xStart, stop: window.xEnd, stride },
  ];
  async function fetchOne(variable: "longitude" | "latitude"): Promise<Float64Array> {
    const url = buildDodsUrl(datasetUrl, variable, dims);
    const { buffer } = await fetchWithBackoff(url, userAgent, fetchImpl, backoff);
    const bytes = new Uint8Array(buffer);
    const offset = findDataSectionOffset(bytes);
    return decodeDodsArray(bytes, offset, "Float64").values;
  }
  const lon = await fetchOne("longitude");
  const lat = await fetchOne("latitude");
  return { lon, lat, yIndices, xIndices };
}

export interface GridProbeResult {
  readonly window: IndexWindow;
  /** Ekte lengdegrad per node i det ENDELIGE vinduet, row-major (y,x), lengde (yCount*xCount) — serialiserbar (JSON-cachbar) og direkte konsumerbar av `applyLccRotationToWindComponents`. */
  readonly lonGrid: Float64Array;
}

/** Bygger `applyLccRotationToWindComponents`s `lonAtNode(y,x)`-oppslag fra et `GridProbeResult` (eller en gjenopprettet cache-oppføring med samme form). */
export function lonAtNodeFromGrid(window: IndexWindow, lonGrid: ArrayLike<number>): (y: number, x: number) => number {
  const xCount = window.xEnd - window.xStart + 1;
  return (y, x) => {
    const value = lonGrid[y * xCount + x];
    if (value === undefined) throw new Error(`lonAtNode(${y},${x}) utenfor vinduet`);
    return value;
  };
}

/**
 * To-pass bbox→indeksvindu-probe (§7 punkt 1 — resultatet skal CACHES av
 * kalleren, ikke re-probes per kjøring). `domain` er kildens totale
 * (yCount,xCount) — brukt til å klemme søkevinduet innenfor griddet.
 */
export async function probeBboxIndexWindow(args: {
  readonly datasetUrl: string;
  readonly bbox: Bbox;
  readonly domain: { readonly yCount: number; readonly xCount: number };
  readonly fetchImpl: FetchLike;
  readonly userAgent: string;
  readonly backoff?: BackoffOptions;
  readonly coarseStride?: number;
  readonly marginDeg?: number;
  readonly padIndices?: number;
}): Promise<GridProbeResult> {
  const coarseStride = args.coarseStride ?? 15;
  const marginDeg = args.marginDeg ?? 1.5;
  const padIndices = args.padIndices ?? 20;
  const fullWindow: IndexWindow = { yStart: 0, yEnd: args.domain.yCount - 1, xStart: 0, xEnd: args.domain.xCount - 1 };
  const coarseBbox: Bbox = {
    west: args.bbox.west - marginDeg,
    east: args.bbox.east + marginDeg,
    south: args.bbox.south - marginDeg,
    north: args.bbox.north + marginDeg,
  };
  const coarse = await fetchLonLatWindow(args.datasetUrl, fullWindow, coarseStride, args.fetchImpl, args.userAgent, args.backoff);
  const coarseWindow = findBboxIndexWindow(coarse.yIndices, coarse.xIndices, coarse.lon, coarse.lat, coarseBbox);
  if (!coarseWindow) {
    throw new Error(`Grov probe fant ingen punkter i bbox+margin ${JSON.stringify(coarseBbox)} — feil bbox eller griddorientering`);
  }
  const fineWindow: IndexWindow = {
    yStart: Math.max(0, coarseWindow.yStart - padIndices),
    yEnd: Math.min(args.domain.yCount - 1, coarseWindow.yEnd + padIndices),
    xStart: Math.max(0, coarseWindow.xStart - padIndices),
    xEnd: Math.min(args.domain.xCount - 1, coarseWindow.xEnd + padIndices),
  };
  const fine = await fetchLonLatWindow(args.datasetUrl, fineWindow, 1, args.fetchImpl, args.userAgent, args.backoff);
  const finalWindow = findBboxIndexWindow(fine.yIndices, fine.xIndices, fine.lon, fine.lat, args.bbox);
  if (!finalWindow) {
    throw new Error(`Fin probe fant ingen punkter i eksakt bbox ${JSON.stringify(args.bbox)}`);
  }
  const xCountFine = fineWindow.xEnd - fineWindow.xStart + 1;
  const finalYCount = finalWindow.yEnd - finalWindow.yStart + 1;
  const finalXCount = finalWindow.xEnd - finalWindow.xStart + 1;
  const lonGrid = new Float64Array(finalYCount * finalXCount);
  for (let y = 0; y < finalYCount; y++) {
    for (let x = 0; x < finalXCount; x++) {
      const globalY = finalWindow.yStart + y;
      const globalX = finalWindow.xStart + x;
      const ri = globalY - fineWindow.yStart;
      const ci = globalX - fineWindow.xStart;
      const value = fine.lon[ri * xCountFine + ci];
      if (value === undefined) {
        throw new Error(`Endelig vindu (${globalY},${globalX}) faller utenfor det probede finvinduet — bug i pad/vindu-utledningen`);
      }
      lonGrid[y * finalXCount + x] = value;
    }
  }
  return { window: finalWindow, lonGrid };
}
