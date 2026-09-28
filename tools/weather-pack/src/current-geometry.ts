/**
 * NorKyst-strøm: geometri og regridding (`docs/specs/strom-produsent.md` §3
 * invariant 1–6, §4 steg 2–4). Rene, deterministiske funksjoner — ingen
 * nettverk (det bor i `norkyst-source.ts`).
 *
 * **Egen kodevei, bevisst.** Vindens `windLayerGeometry`/
 * `sampleFromFetchedGrid` (`pipeline.ts`) behandler et hentet (y,x)-
 * indeksvindu som et jevnt lat/lon-rutenett over flisens bbox. For NorKyst
 * (polarstereografisk, ~60° gridrotasjon i Skagerrak) er den forenklingen
 * MÅLT å gi 15–62 km posisjonsfeil (`docs/research/spike-norkyst-geometri-
 * 2026-09-27.md`). Denne fila gjenbruker derfor ingenting derfra, og ingen
 * funksjon her skal noensinne gjøre indeksaritmetikk mellom en regulær
 * lat/lon-node og kildens (y,x): hver regulær node får verdien fra
 * nærmeste native sjønode målt i haversine mot kildens EGNE 2D lat/lon
 * (invariant 3). `current-geometry.test.ts` har en test som feiler om noen
 * gjeninnfører indeksvindu-forenklingen.
 *
 * Kildens rådata er Int16 med `_FillValue -32767` og `scale_factor 0.001`.
 * Fill sjekkes på den RÅ verdien før avskalering (invariant 1) og blir
 * aldri et tall — den blir `NaN` her og sentinel i pakken.
 */
import type { IndexWindow } from "./grid.js";
import { METERS_PER_SECOND_TO_KNOTS } from "./pipeline.js";

// --- Kildekonstanter (verifiseres mot `.das` ved hvert bygg, norkyst-source.ts) ---

/** `_FillValue` for `u_eastward`/`v_northward` (Int16). */
export const NORKYST_FILL_VALUE = -32767;
/** `scale_factor` for `u_eastward`/`v_northward` — m/s per rå enhet. */
export const NORKYST_SCALE_FACTOR = 0.001;
/** `add_offset` for `u_eastward`/`v_northward`. */
export const NORKYST_ADD_OFFSET = 0;
/** Overflatelaget: `depth[0] = 0.0` m (verifisert 2026-09-27, spike §5). */
export const NORKYST_SURFACE_DEPTH_INDEX = 0;

// --- Pakkegeometri (spec §3 «Pakkelag») ---------------------------------------

/**
 * Regulært lat/lon-gitter for strøm: 139 intervaller per breddegrad
 * (Δlat = 1/139° ≈ 0,00719° ≈ 800 m) og 70 per lengdegrad (Δlon = 1/70° ≈
 * 0,01429° ≈ 0,84 km ved 58°N, 0,80 km ved 59,5°N). Valgt slik at 1°-flisens
 * kanter faller eksakt på noder (nabofliser deler kantnoder, som vind) og
 * nodeavstanden er ~800 m i korridoren — spec-ens «Δlat = 0,0072°, Δlon =
 * 0,0144° ved 59°N», rundet til heltall per grad.
 */
export const CURRENT_INTERVALS_PER_DEG_LAT = 139;
export const CURRENT_INTERVALS_PER_DEG_LON = 70;

/**
 * **D15.1 (vedtatt 2026-09-27):** en regulær node får verdien fra nærmeste
 * native sjønode hvis den ligger innenfor √2 native celler (haversine mot
 * kildens lat/lon, cellestørrelse målt lokalt); ellers sentinel. Utvides
 * ALDRI uten ny beslutning. Ingen «samme side av land»-sjekk ennå —
 * feil-side-frekvensen måles først.
 */
export const COAST_EXTENSION_CELLS = Math.SQRT2;

/**
 * **D15.2 (vedtatt 2026-09-27):** en node er kystsone hvis den fikk verdi via
 * forlengelsen ELLER ligger innenfor dette antall native celler fra en
 * fill-celle. Spec-en sier «2–3»; vi velger 3 (den konservative enden —
 * heller for mye merking enn for lite, CLAUDE.md §1). Logges i
 * kystmaskens header.
 */
export const COAST_FILL_PROXIMITY_CELLS = 3;

// --- Invariant 1: fill før avskalering ------------------------------------------

/**
 * Rå Int16 → m/s. `_FillValue` sjekkes på den RÅ verdien FØR avskalering og
 * gir `undefined` — aldri `-32,767 m/s`, aldri 0. Ikke-endelige rå verdier
 * (korrupt respons) behandles likt.
 */
export function decodeNorkystRaw(raw: number): number | undefined {
  if (raw === NORKYST_FILL_VALUE || !Number.isFinite(raw)) return undefined;
  return raw * NORKYST_SCALE_FACTOR + NORKYST_ADD_OFFSET;
}

/** m/s → knop, eksplisitt og ett sted (spec §3 «Konvensjoner»). Retning uendret. */
export function currentMsToKnots(valueMs: number): number {
  return valueMs * METERS_PER_SECOND_TO_KNOTS;
}

// --- Native grid -----------------------------------------------------------------

/** Kildens (y,x)-vindu med EGNE 2D lat/lon per node, row-major `y*xCount+x`. */
export interface NativeGrid {
  readonly yCount: number;
  readonly xCount: number;
  readonly lat: ArrayLike<number>;
  readonly lon: ArrayLike<number>;
}

/**
 * Statisk sjømaske per native node: sjø ⇔ verken `u` eller `v` er fill på
 * NOEN av de hentede tidsstegene. En node som er fill på bare noen tidssteg
 * (tørrfall/våtlegging) behandles som land — konservativt, og det betyr at
 * NN-valget aldri kan peke på en node som noen gang er fill. `uRaw`/`vRaw`
 * er rå Int16-verdier, layout `[t][node]`.
 */
export function seaMaskFromRaw(
  uRaw: ArrayLike<number>,
  vRaw: ArrayLike<number>,
  timeCount: number,
  nodeCount: number,
): Uint8Array {
  if (uRaw.length !== timeCount * nodeCount || vRaw.length !== timeCount * nodeCount) {
    throw new Error(
      `seaMaskFromRaw: forventet ${timeCount}×${nodeCount} rå verdier per komponent, fikk u=${uRaw.length}, v=${vRaw.length}`,
    );
  }
  const sea = new Uint8Array(nodeCount).fill(timeCount > 0 ? 1 : 0);
  for (let t = 0; t < timeCount; t++) {
    const base = t * nodeCount;
    for (let n = 0; n < nodeCount; n++) {
      if (sea[n] === 0) continue;
      if (decodeNorkystRaw(uRaw[base + n]!) === undefined || decodeNorkystRaw(vRaw[base + n]!) === undefined) {
        sea[n] = 0;
      }
    }
  }
  return sea;
}

const EARTH_RADIUS_M = 6_371_000;

/** Storsirkelavstand i meter (samme formel og radius som geometrispiken). */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Lokal native cellestørrelse (m) i node `idx`: snitt av haversine-avstanden
 * til de eksisterende naboene (x±1, y±1) i vinduet. Polarstereografisk
 * skala varierer noen prosent over domenet — derfor lokalt, ikke en global
 * 800 m-konstant.
 */
export function localCellSizeM(grid: NativeGrid, idx: number): number {
  const y = Math.floor(idx / grid.xCount);
  const x = idx - y * grid.xCount;
  const la = grid.lat[idx]!;
  const lo = grid.lon[idx]!;
  let sum = 0;
  let n = 0;
  const neighbours: ReadonlyArray<readonly [number, number]> = [
    [y, x - 1],
    [y, x + 1],
    [y - 1, x],
    [y + 1, x],
  ];
  for (const [ny, nx] of neighbours) {
    if (ny < 0 || nx < 0 || ny >= grid.yCount || nx >= grid.xCount) continue;
    const j = ny * grid.xCount + nx;
    sum += haversineM(la, lo, grid.lat[j]!, grid.lon[j]!);
    n++;
  }
  if (n === 0) throw new Error("localCellSizeM: vinduet har bare én node — cellestørrelsen er udefinert");
  return sum / n;
}

/**
 * Enkel romlig bøtteindeks over native noder, KUN for å finne kandidater
 * raskt. Rangeringen av kandidater skjer alltid med `haversineM` mot
 * kildens lat/lon — projeksjonen her (lokal ekvirektangulær) brukes aldri
 * til å avgjøre hvilken node som er nærmest, bare til å avgrense hvem som
 * sjekkes, med romslig margin.
 */
class NativeBucketIndex {
  private readonly buckets = new Map<number, number[]>();
  private readonly lat0: number;
  private readonly cosLat0: number;
  private static readonly M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M;
  private static readonly KEY_SPAN = 1 << 20;

  constructor(
    private readonly grid: NativeGrid,
    private readonly bucketM: number,
  ) {
    const n = grid.yCount * grid.xCount;
    let latSum = 0;
    for (let i = 0; i < n; i++) latSum += grid.lat[i]!;
    this.lat0 = n > 0 ? latSum / n : 0;
    this.cosLat0 = Math.cos((this.lat0 * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
      const key = this.keyOf(this.bx(grid.lon[i]!), this.by(grid.lat[i]!));
      const list = this.buckets.get(key);
      if (list) list.push(i);
      else this.buckets.set(key, [i]);
    }
  }

  private bx(lon: number): number {
    return Math.floor((lon * NativeBucketIndex.M_PER_DEG * this.cosLat0) / this.bucketM);
  }

  private by(lat: number): number {
    return Math.floor((lat * NativeBucketIndex.M_PER_DEG) / this.bucketM);
  }

  private keyOf(bx: number, by: number): number {
    return (bx + NativeBucketIndex.KEY_SPAN / 2) * NativeBucketIndex.KEY_SPAN + (by + NativeBucketIndex.KEY_SPAN / 2);
  }

  /**
   * Kaller `visit(idx, distM)` for hver native node med haversine-avstand
   * ≤ `radiusM`, i stigende indeksrekkefølge innen hver bøtte (deterministisk).
   */
  forEachWithin(lat: number, lon: number, radiusM: number, visit: (idx: number, distM: number) => void): void {
    // 10 % slakk + én bøtte ekstra: projeksjonsfeilen over et lite vindu er
    // langt under dette, og en node for mye i kandidatlista koster bare én
    // haversine — en node for lite ville vært en feil.
    const reach = Math.ceil((radiusM * 1.1) / this.bucketM) + 1;
    const cx = this.bx(lon);
    const cy = this.by(lat);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const list = this.buckets.get(this.keyOf(cx + dx, cy + dy));
        if (!list) continue;
        for (const idx of list) {
          const d = haversineM(lat, lon, this.grid.lat[idx]!, this.grid.lon[idx]!);
          if (d <= radiusM) visit(idx, d);
        }
      }
    }
  }
}

// --- Regulært gitter + NN (invariant 3–6) -----------------------------------

export interface RegularGridSpec {
  readonly latMin: number;
  readonly lonMin: number;
  readonly latStepDeg: number;
  readonly lonStepDeg: number;
  readonly nodesLat: number;
  readonly nodesLon: number;
}

/** Det regulære strømgitteret for én 1°-flis (kantene faller på noder). */
export function currentRegularGridForTile(bounds: {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}): RegularGridSpec {
  const intervalsLat = Math.round((bounds.north - bounds.south) * CURRENT_INTERVALS_PER_DEG_LAT);
  const intervalsLon = Math.round((bounds.east - bounds.west) * CURRENT_INTERVALS_PER_DEG_LON);
  if (intervalsLat < 1 || intervalsLon < 1) {
    throw new Error(`currentRegularGridForTile: flisen ${JSON.stringify(bounds)} er for liten`);
  }
  return {
    latMin: bounds.south,
    lonMin: bounds.west,
    latStepDeg: (bounds.north - bounds.south) / intervalsLat,
    lonStepDeg: (bounds.east - bounds.west) / intervalsLon,
    nodesLat: intervalsLat + 1,
    nodesLon: intervalsLon + 1,
  };
}

export interface RegridOptions {
  readonly extensionCells?: number;
  readonly fillProximityCells?: number;
}

export interface RegridStats {
  readonly nodes: number;
  /** Noder som fikk en verdi (egen sjønode eller forlengelse). */
  readonly withValue: number;
  /** Noder som fikk verdi KUN via kystkant-forlengelsen. */
  readonly extended: number;
  /** Noder merket kystsone (forlengelse eller nær fill), blant dem MED verdi. */
  readonly coastalWithValue: number;
  /**
   * «Sjønære» noder: minst én native sjønode innenfor 2 native celler.
   * Byggerapportens NÆRMING til «farbar» (den ekte farbarhetsmasken finnes
   * ikke i `tools/weather-pack`) — se README.
   */
  readonly nearSea: number;
  /** Sjønære noder som likevel står uten verdi. */
  readonly nearSeaWithoutValue: number;
}

export interface RegridResult {
  readonly spec: RegularGridSpec;
  readonly extensionCells: number;
  readonly fillProximityCells: number;
  /** Native kildeindeks per regulær node (`i*nodesLon+j`), −1 ⇒ sentinel. */
  readonly sourceIndex: Int32Array;
  /** 1 ⇒ verdien kom via kystkant-forlengelsen (nærmeste native node er land). */
  readonly extended: Uint8Array;
  /** Kystmasken (D15.2): 1 ⇒ forlenget ELLER innenfor `fillProximityCells` fra fill. */
  readonly coastal: Uint8Array;
  readonly stats: RegridStats;
}

/** Radius for «sjønær»-nærmingen i byggerapporten (native celler). */
const NEAR_SEA_REPORT_CELLS = 2;

/**
 * Invariant 3–6: hver regulær node → nærmeste native SJØnode (haversine
 * mot kildens 2D lat/lon), innenfor `extensionCells` lokale native celler,
 * ellers sentinel (−1). Kystmasken regnes i samme pass. Ingen midling,
 * ingen nedtynning — én kildenode per regulær node (invariant 2).
 *
 * Deterministisk: ved lik avstand vinner laveste native indeks.
 */
export function regridNearestSeaNode(
  grid: NativeGrid,
  sea: ArrayLike<number>,
  spec: RegularGridSpec,
  options: RegridOptions = {},
): RegridResult {
  const extensionCells = options.extensionCells ?? COAST_EXTENSION_CELLS;
  const fillProximityCells = options.fillProximityCells ?? COAST_FILL_PROXIMITY_CELLS;
  const nativeCount = grid.yCount * grid.xCount;
  if (grid.lat.length !== nativeCount || grid.lon.length !== nativeCount || sea.length !== nativeCount) {
    throw new Error("regridNearestSeaNode: lat/lon/sjømaske har ikke yCount×xCount elementer");
  }

  // Største lokale cellestørrelse i vinduet (stikkprøve over et grovt
  // utvalg + hjørner) bestemmer søkeradiusen. Selve grensene per node
  // regnes med den LOKALE cellestørrelsen i nærmeste native node.
  let maxCellM = 0;
  const strideY = Math.max(1, Math.floor(grid.yCount / 16));
  const strideX = Math.max(1, Math.floor(grid.xCount / 16));
  for (let y = 0; y < grid.yCount; y += strideY) {
    for (let x = 0; x < grid.xCount; x += strideX) {
      maxCellM = Math.max(maxCellM, localCellSizeM(grid, y * grid.xCount + x));
    }
  }
  maxCellM = Math.max(maxCellM, localCellSizeM(grid, nativeCount - 1));
  const radiusCells = Math.max(extensionCells, fillProximityCells, NEAR_SEA_REPORT_CELLS);
  // 10 % slakk på maks-cellen: lokal cellestørrelse varierer litt i vinduet.
  const searchRadiusM = radiusCells * maxCellM * 1.1;
  const index = new NativeBucketIndex(grid, Math.max(1, maxCellM));

  const nodes = spec.nodesLat * spec.nodesLon;
  const sourceIndex = new Int32Array(nodes).fill(-1);
  const extended = new Uint8Array(nodes);
  const coastal = new Uint8Array(nodes);
  let withValue = 0;
  let extendedCount = 0;
  let coastalWithValue = 0;
  let nearSea = 0;
  let nearSeaWithoutValue = 0;

  for (let i = 0; i < spec.nodesLat; i++) {
    const lat = spec.latMin + i * spec.latStepDeg;
    for (let j = 0; j < spec.nodesLon; j++) {
      const lon = spec.lonMin + j * spec.lonStepDeg;
      let anyIdx = -1;
      let anyD = Infinity;
      let seaIdx = -1;
      let seaD = Infinity;
      let fillD = Infinity;
      index.forEachWithin(lat, lon, searchRadiusM, (idx, d) => {
        if (d < anyD || (d === anyD && idx < anyIdx)) {
          anyD = d;
          anyIdx = idx;
        }
        if (sea[idx] === 1) {
          if (d < seaD || (d === seaD && idx < seaIdx)) {
            seaD = d;
            seaIdx = idx;
          }
        } else if (d < fillD) {
          fillD = d;
        }
      });
      const n = i * spec.nodesLon + j;
      if (anyIdx < 0) continue; // utenfor kildens domene/vindu: sentinel, ikke kyst
      const cellM = localCellSizeM(grid, anyIdx);
      const isNearSea = seaD <= NEAR_SEA_REPORT_CELLS * cellM;
      if (isNearSea) nearSea++;
      const hasValue = seaIdx >= 0 && seaD <= extensionCells * cellM;
      const isExtended = hasValue && fillD < seaD;
      const isCoastal = isExtended || fillD <= fillProximityCells * cellM;
      if (isCoastal) coastal[n] = 1;
      if (hasValue) {
        sourceIndex[n] = seaIdx;
        withValue++;
        if (isExtended) {
          extended[n] = 1;
          extendedCount++;
        }
        if (isCoastal) coastalWithValue++;
      } else if (isNearSea) {
        nearSeaWithoutValue++;
      }
    }
  }

  return {
    spec,
    extensionCells,
    fillProximityCells,
    sourceIndex,
    extended,
    coastal,
    stats: {
      nodes,
      withValue,
      extended: extendedCount,
      coastalWithValue,
      nearSea,
      nearSeaWithoutValue,
    },
  };
}

// --- Verdier i knop på det regulære gitteret -----------------------------------

/** Én komponent på det regulære gitteret, knop, layout `[k][i*nodesLon+j]`; `NaN` = sentinel. */
export interface RegularComponentValues {
  readonly timeSteps: number;
  readonly nodes: number;
  readonly values: Float64Array;
}

/**
 * Plukker kildeverdien for hver regulær node (NN, invariant 3) og hvert
 * pakketidssteg. `sourceTimeIndex[k]` er indeksen i de hentede rådataenes
 * tidsakse for pakkens tidssteg `k`, eller `undefined` når NorKyst ikke har
 * det tidspunktet (utover horisonten ⇒ sentinel, spec §4-tabellen). Fill
 * sjekkes på rå Int16 FØR avskalering (invariant 1) — også her, selv om
 * sjømasken allerede utelukker fill-noder.
 */
export function regularComponentValues(
  regrid: RegridResult,
  raw: ArrayLike<number>,
  nativeNodeCount: number,
  sourceTimeIndex: readonly (number | undefined)[],
): RegularComponentValues {
  const nodes = regrid.spec.nodesLat * regrid.spec.nodesLon;
  const timeSteps = sourceTimeIndex.length;
  const values = new Float64Array(timeSteps * nodes).fill(Number.NaN);
  for (let k = 0; k < timeSteps; k++) {
    const t = sourceTimeIndex[k];
    if (t === undefined) continue;
    const base = t * nativeNodeCount;
    for (let n = 0; n < nodes; n++) {
      const src = regrid.sourceIndex[n]!;
      if (src < 0) continue;
      const ms = decodeNorkystRaw(raw[base + src]!);
      if (ms === undefined) continue;
      values[k * nodes + n] = currentMsToKnots(ms);
    }
  }
  return { timeSteps, nodes, values };
}

// --- Tidsakse ----------------------------------------------------------------

/**
 * Pakkens tidssteg `t0S + k·dtS` (k = 0…count−1) → indeks i en hentet
 * tidsakse (`timesS[i]` = epoke-sekunder for global indeks `firstIndex + i`).
 * Eksakt treff innenfor 1 s kreves — ingen tidsinterpolasjon, ingen
 * «nærmeste time». Uten treff ⇒ `undefined` (sentinel i pakken).
 * Returnerer LOKALE indekser (0-basert i `timesS`).
 */
export function matchTimeSteps(
  timesS: ArrayLike<number>,
  t0S: number,
  dtS: number,
  count: number,
): (number | undefined)[] {
  const byEpoch = new Map<number, number>();
  for (let i = 0; i < timesS.length; i++) {
    const t = timesS[i]!;
    if (!Number.isFinite(t)) continue;
    const key = Math.round(t);
    if (!byEpoch.has(key)) byEpoch.set(key, i);
  }
  const out: (number | undefined)[] = [];
  for (let k = 0; k < count; k++) {
    const want = Math.round(t0S + k * dtS);
    out.push(byEpoch.get(want) ?? byEpoch.get(want - 1) ?? byEpoch.get(want + 1));
  }
  return out;
}

// --- Lokalisering av indeksvinduet (invariant 4) ------------------------------

export interface LatLonSample {
  /** Globale y-indekser for radene i prøven. */
  readonly yIndices: readonly number[];
  /** Globale x-indekser for kolonnene i prøven. */
  readonly xIndices: readonly number[];
  /** Row-major over (yIndices × xIndices). */
  readonly lat: ArrayLike<number>;
  readonly lon: ArrayLike<number>;
}

/**
 * Nærmeste-punkt-søk (haversine) i en grov prøve — spike-mønsteret. ALDRI
 * bbox-containment på den grove prøven: NorKysts domene er en lang, buet
 * stripe, og containment over en striden prøve aliaserer (spiken fant et
 * helt annet kyststrekk for Drøbaksund).
 */
export function nearestSampleNode(
  sample: LatLonSample,
  lat: number,
  lon: number,
): { readonly y: number; readonly x: number; readonly distM: number } | undefined {
  let best: { y: number; x: number; distM: number } | undefined;
  for (let r = 0; r < sample.yIndices.length; r++) {
    for (let c = 0; c < sample.xIndices.length; c++) {
      const f = r * sample.xIndices.length + c;
      const la = sample.lat[f];
      const lo = sample.lon[f];
      if (la === undefined || lo === undefined || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
      const d = haversineM(lat, lon, la, lo);
      if (best === undefined || d < best.distM) best = { y: sample.yIndices[r]!, x: sample.xIndices[c]!, distM: d };
    }
  }
  return best;
}

export interface Bbox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * Indeksvinduet (globalt) for alle noder i en LOKAL, sammenhengende
 * fulloppløst blokk hvis lat/lon ligger i `bbox`. Containment er trygt HER
 * (i motsetning til på den grove prøven) fordi blokken er avgrenset til ett
 * kystavsnitt rundt nærmeste-punkt-treffet. `touchesOpenEdge` er sant når
 * vinduet treffer blokkens kant på en side der blokken IKKE er domenets
 * kant — da var blokken for liten, og kalleren må feile høyt.
 */
export function windowInLocalBlock(
  block: {
    readonly window: IndexWindow;
    readonly lat: ArrayLike<number>;
    readonly lon: ArrayLike<number>;
  },
  bbox: Bbox,
  domain: { readonly yCount: number; readonly xCount: number },
): { readonly window: IndexWindow; readonly touchesOpenEdge: boolean } | undefined {
  const w = block.window;
  const xCount = w.xEnd - w.xStart + 1;
  const yCount = w.yEnd - w.yStart + 1;
  let yMin = Infinity;
  let yMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const f = y * xCount + x;
      const la = block.lat[f]!;
      const lo = block.lon[f]!;
      if (lo >= bbox.west && lo <= bbox.east && la >= bbox.south && la <= bbox.north) {
        yMin = Math.min(yMin, w.yStart + y);
        yMax = Math.max(yMax, w.yStart + y);
        xMin = Math.min(xMin, w.xStart + x);
        xMax = Math.max(xMax, w.xStart + x);
      }
    }
  }
  if (!Number.isFinite(yMin)) return undefined;
  const touchesOpenEdge =
    (yMin === w.yStart && w.yStart > 0) ||
    (yMax === w.yEnd && w.yEnd < domain.yCount - 1) ||
    (xMin === w.xStart && w.xStart > 0) ||
    (xMax === w.xEnd && w.xEnd < domain.xCount - 1);
  return { window: { yStart: yMin, yEnd: yMax, xStart: xMin, xEnd: xMax }, touchesOpenEdge };
}

/**
 * Margin rundt flisens bbox når indeksvinduet hentes: nodene langs flisens
 * kant trenger native naboer UTENFOR flisen for NN, forlengelse (√2 celler)
 * og kystmaske (3 celler). 0,05° lat ≈ 5,6 km, 0,1° lon ≈ 5,8 km ved 58°N —
 * godt over 3 celler (2,4 km).
 */
export const CURRENT_WINDOW_MARGIN_DEG = { lat: 0.05, lon: 0.1 } as const;

export function paddedTileBbox(bounds: Bbox): Bbox {
  return {
    west: bounds.west - CURRENT_WINDOW_MARGIN_DEG.lon,
    east: bounds.east + CURRENT_WINDOW_MARGIN_DEG.lon,
    south: bounds.south - CURRENT_WINDOW_MARGIN_DEG.lat,
    north: bounds.north + CURRENT_WINDOW_MARGIN_DEG.lat,
  };
}

/** Skjærer ut et delvindu (globale indekser) av en større blokk sine lat/lon. */
export function sliceBlock(
  block: { readonly window: IndexWindow; readonly lat: ArrayLike<number>; readonly lon: ArrayLike<number> },
  inner: IndexWindow,
): { readonly lat: Float64Array; readonly lon: Float64Array } {
  const bx = block.window.xEnd - block.window.xStart + 1;
  const yCount = inner.yEnd - inner.yStart + 1;
  const xCount = inner.xEnd - inner.xStart + 1;
  const lat = new Float64Array(yCount * xCount);
  const lon = new Float64Array(yCount * xCount);
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const src = (inner.yStart - block.window.yStart + y) * bx + (inner.xStart - block.window.xStart + x);
      const la = block.lat[src];
      const lo = block.lon[src];
      if (la === undefined || lo === undefined) {
        throw new Error("sliceBlock: delvinduet faller utenfor blokken");
      }
      lat[y * xCount + x] = la;
      lon[y * xCount + x] = lo;
    }
  }
  return { lat, lon };
}
