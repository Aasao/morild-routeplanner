/**
 * A\*-vannavstandsfeltet (docs/specs/rutemotor.md §5.5).
 *
 * Dijkstra fra **målet** på et 8-nabo-grid, med kanter stengt av en injisert
 * `FieldEdgeGate`. Feltet gir to ting:
 *   1. blindvei-/øy-eliminering (`atNear` udefinert ⇒ innestengt vann), og
 *   2. et admissibelt underestimat av gjenværende distanse, som Tub-bounden
 *      beskjærer på.
 *
 * **Float64 er påkrevd.** v1 lagret feltet i Float32 og fikk «foreldede»
 * celler: heap-prioriteten regnes i dobbel presisjon, mens den lagrede
 * verdien avrundes, slik at `pd > D[idx]` ble sant for en celle som aldri
 * hadde blitt ekspandert — og cellen ble hoppet over. Regresjonstesten i
 * `distance-field.test.ts` demonstrerer avviket og feiler hvis lagringen
 * noen gang byttes til Float32.
 *
 * Feltet er **væruavhengig** og skal gjenbrukes på tvers av avganger og
 * ensemble-medlemmer: det er en funksjon av geometri, ikke av vær.
 * `toData()`/`fromData()` gjør det til ren, klonbar data.
 */
import type { LatLon } from "@morild/geo";
import { haversineNm } from "@morild/geo";
import type { FieldEdgeGate } from "./contracts.js";
import { MinHeap } from "./heap.js";

/** Ren, structured-clone-bar representasjon av feltet. */
export interface DistanceFieldData {
  readonly lat0: number;
  readonly lon0: number;
  readonly cellDeg: number;
  readonly width: number;
  readonly height: number;
  /** Avstand til målet i nm per celle, `Infinity` = ikke nåbar. */
  readonly d: Float64Array;
}

export interface FieldBuildOptions {
  /** Ønsket oppløsning i grader. Standard 0,01° ≈ 1,1 km (spec: 500 m–1 km). */
  readonly cellDeg?: number;
  /** Tak på antall celler; oppløsningen grovnes til den passer. */
  readonly maxCells?: number;
}

export const DEFAULT_FIELD_CELL_DEG = 0.01;
export const DEFAULT_FIELD_MAX_CELLS = 250_000;

export class DistanceField {
  readonly data: DistanceFieldData;
  private readonly lat0: number;
  private readonly lon0: number;
  private readonly cellDeg: number;
  private readonly width: number;
  private readonly height: number;
  private readonly d: Float64Array;

  constructor(data: DistanceFieldData) {
    this.data = data;
    this.lat0 = data.lat0;
    this.lon0 = data.lon0;
    this.cellDeg = data.cellDeg;
    this.width = data.width;
    this.height = data.height;
    this.d = data.d;
  }

  private ix(lon: number): number {
    return Math.floor((lon - this.lon0) / this.cellDeg);
  }

  private iy(lat: number): number {
    return Math.floor((lat - this.lat0) / this.cellDeg);
  }

  /** Avstand til målet i nm, eller `undefined` utenfor feltet/ikke nåbart. */
  at(lat: number, lon: number): number | undefined {
    const ix = this.ix(lon);
    const iy = this.iy(lat);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) {
      return undefined;
    }
    const v = this.d[iy * this.width + ix]!;
    return Number.isFinite(v) ? v : undefined;
  }

  /**
   * Minimum over 3×3-nabolaget. Redder kystnære celler der senteret havnet
   * på land — v1s `atNear`, beholdt fordi kandidatpunkter i skjærgård ofte
   * treffer en landcelle i et grovere felt enn masken.
   */
  atNear(lat: number, lon: number): number | undefined {
    const ix = this.ix(lon);
    const iy = this.iy(lat);
    let best: number | undefined;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
        const v = this.d[ny * this.width + nx]!;
        if (Number.isFinite(v) && (best === undefined || v < best)) best = v;
      }
    }
    return best;
  }

  /** `at`, med `atNear` som fallback — mønsteret alle kallsteder bruker. */
  atOrNear(lat: number, lon: number): number | undefined {
    return this.at(lat, lon) ?? this.atNear(lat, lon);
  }

  get cellCount(): number {
    return this.width * this.height;
  }

  toData(): DistanceFieldData {
    return this.data;
  }

  static fromData(data: DistanceFieldData): DistanceField {
    return new DistanceField(data);
  }
}

/** Cellesenteret for (ix, iy). */
function centerOf(
  lat0: number,
  lon0: number,
  cellDeg: number,
  ix: number,
  iy: number,
): LatLon {
  return { lat: lat0 + (iy + 0.5) * cellDeg, lon: lon0 + (ix + 0.5) * cellDeg };
}

/**
 * Bygger vannavstandsfeltet fra `dest`, med en boks som dekker start og mål
 * med margin. Returnerer `undefined` hvis målet faller utenfor boksen (kan
 * ikke skje med marginen under, men vi later ikke som det er umulig).
 */
export function buildDistanceField(
  start: LatLon,
  dest: LatLon,
  gate: FieldEdgeGate,
  options: FieldBuildOptions = {},
): DistanceField | undefined {
  const dLat = Math.abs(start.lat - dest.lat);
  const dLon = Math.abs(start.lon - dest.lon);
  // v1s marginregel: 30 % av lengste side, klemt til [0,4°, 2,0°].
  const margin = Math.min(2.0, Math.max(0.4, 0.3 * Math.max(dLat, dLon)));
  const lat0 = Math.min(start.lat, dest.lat) - margin;
  const lat1 = Math.max(start.lat, dest.lat) + margin;
  const lon0 = Math.min(start.lon, dest.lon) - margin;
  const lon1 = Math.max(start.lon, dest.lon) + margin;

  const maxCells = options.maxCells ?? DEFAULT_FIELD_MAX_CELLS;
  let cellDeg = options.cellDeg ?? DEFAULT_FIELD_CELL_DEG;
  let width = Math.max(2, Math.round((lon1 - lon0) / cellDeg));
  let height = Math.max(2, Math.round((lat1 - lat0) / cellDeg));
  if (width * height > maxCells) {
    cellDeg *= Math.sqrt((width * height) / maxCells);
    width = Math.max(2, Math.round((lon1 - lon0) / cellDeg));
    height = Math.max(2, Math.round((lat1 - lat0) / cellDeg));
  }

  // Float64: se filhodet. Float32 gir foreldede celler ved pop.
  const d = new Float64Array(width * height).fill(Infinity);

  const destIx = Math.floor((dest.lon - lon0) / cellDeg);
  const destIy = Math.floor((dest.lat - lat0) / cellDeg);
  if (destIx < 0 || destIy < 0 || destIx >= width || destIy >= height) {
    return undefined;
  }

  const destIdx = destIy * width + destIx;
  d[destIdx] = 0;
  const heap = new MinHeap(Math.min(width * height, 1 << 14));
  heap.push(0, destIdx);

  while (heap.length > 0) {
    const { priority, value: idx } = heap.pop();
    // Foreldet heap-oppføring: cellen er allerede nådd billigere.
    if (priority > d[idx]!) continue;
    const iy = (idx / width) | 0;
    const ix = idx - iy * width;
    const here = centerOf(lat0, lon0, cellDeg, ix, iy);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        const there = centerOf(lat0, lon0, cellDeg, nx, ny);
        const nd = priority + haversineNm(here, there);
        if (nd >= d[nIdx]!) continue;
        if (!gate.edgeOpen(here.lat, here.lon, there.lat, there.lon)) continue;
        d[nIdx] = nd;
        heap.push(nd, nIdx);
      }
    }
  }

  return new DistanceField({ lat0, lon0, cellDeg, width, height, d });
}
