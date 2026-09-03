/**
 * Entropi-eksperiment (D6-C, 2026-09-03 — Magnus' beslutning: kompresjonsspike
 * på den EKTE værpakken). Grunnlag: `docs/research/pakkestoerrelse-ekte-
 * 2026-09-03.md` (delta+gzip på ekte MEPS-vind komprimerer 1,06×, nesten
 * ingenting — gzipNoDelta≈14,87 MB mot rått 14,88 MB, bytene er nær full
 * entropi), og fagagent-diagnosen: dagens per-subflis-per-tidssteg min/maks-
 * kvantisering gir en LSB på ca. 0,1–0,2 kn — finere enn ruteren trenger —
 * og at delta i TID er feil akse (feltet flytter ~15 celler/t ved 2,5 km
 * oppløsning, MEPS-vindkast er turbulent/lite korrelert i tid på nodenivå).
 *
 * **Metode** (leser KUN de allerede nedlastede, ekte blobene i
 * `tools/weather-pack/out/weather/1/` — ingen nye THREDDS-kall):
 * 1. For hver flis (5_28, 5_29) og hvert medlem (kontroll+29), les blob'en
 *    via `readLayerFrames` (§15-rammedeling — automatisk delta-dekodet
 *    tilbake til RÅ per-slice-kvantiserte koder, `package-format.ts`s
 *    dokumenterte kontrakt).
 * 2. Rekonstruer FYSISK verdi (kn) per node/tidssteg via `decodeLayerNode`
 *    (dagens per-subflis-per-tidssteg skala/offset) — dette ER den eneste
 *    kilden til fysisk verdi vi har (de virkelig rå, ukvantiserte
 *    THREDDS-tallene ble aldri lagret separat).
 * 3. Re-kvantiser den rekonstruerte fysiske verdien under alternative,
 *    FASTE (globale, ikke per-slice-adaptive) skjemaer: LSB {0,25; 0,5} kn,
 *    med enten per-flis-offset (databasert, per-flis min) eller uten
 *    offset (fast, databasert på en dokumentert antatt fysisk grense —
 *    §measured-range under, IKKE en universell garanti for alle MEPS-
 *    forhold).
 * 4. Kjør hver av de 6 prediktorene PÅ DE KVANTISERTE KODENE (ikke på
 *    fysisk verdi — en byte-nivå-transform, samme filosofi som
 *    `@morild/weather::delta.ts`s dokumenterte "fysisk agnostisk"-prinsipp)
 *    for hver av de 5 kvantiseringsvariantene — 30 kombinasjoner.
 * 5. Mål EMPIRISK ENTROPI (bit/sample, ordre-0 Shannon over det pulje-
 *    de/samlede kodealfabetet for HELE datasettet denne kombinasjonen
 *    faktisk bærer — nedre grense for enhver koder) + FAKTISK gzip
 *    (node:zlib, nivå 9) og brotli (kvalitet 9 — bevisst IKKE 11, for å
 *    holde kjøretiden til denne spiken innenfor rimelig tid; dokumentert
 *    fart/kvalitet-avveining, ikke en påstand om brotlis maksimale evne)
 *    PER MEDLEMSFIL (samme konvensjon som `build-live-package.ts`s
 *    `gzipDeltaTotal`-regnskap: komprimert PER medlem, summert — matcher
 *    hvordan blobene faktisk overføres, ett medlem om gangen).
 *
 * **Representativitet (fagagentens forbehold, gjentatt eksplisitt her):**
 * dette er ÉN init (04Z 3. sept 2026), to fliser over åpent Skagerrak.
 * 3–5 init over ulike værregimer (stille høytrykk, frontpassasje, kraftig
 * vind) trengs før noe tall her låses som ny standard — se §7 i
 * `docs/research/kompresjonsmaaling-2026-09-03.md`.
 *
 * Kjøres KUN manuelt (`pnpm --filter @morild/weather-pack entropy-experiment`),
 * ALDRI fra `pnpm test`/CI — forutsetter at `out/weather/1/*.bin` og
 * `out/pointer-vaer-skandinavia.json` allerede finnes (git-ignorert,
 * bygget av `build-live-package.ts` i en tidligere bølge).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import {
  buildLayerLookup,
  computeMaxDecodeErrorKn,
  computeSubtileLayout,
  decodeLinear,
  readLayerFrames,
  subtileIndexOfNode,
  sampleIndex,
  windLayerMaxDecodeErrorKnFromLayers,
  type Layer,
  type SubtileLayout,
} from "@morild/weather";

const OUT_DIR = join(import.meta.dirname, "..", "out");
const POINTER_PATH = join(OUT_DIR, "pointer-vaer-skandinavia.json");
const REPORT_PATH = join(OUT_DIR, "entropy-experiment-report.json");

/**
 * Fast, dokumentert, DATA-UAVHENGIG antatt fysisk grense for "ingen
 * offset"-variantene (§ måling under bekreftet observert område
 * [-29,35; 36,18] kn på flis 5_28 og [-22,66; 32,20] kn på flis 5_29, alle
 * 30 medlemmer, hele grid/tidsvinduet — se
 * `docs/research/kompresjonsmaaling-2026-09-03.md` §1). 40 kn gir margin
 * over det observerte maksimumet, men er IKKE en universell garanti for
 * andre værregimer/init (jf. representativitetsforbeholdet i toppkommentaren).
 */
const ASSUMED_MAX_ABS_WIND_KN = 40;

// --------------------------------------------------------- pointer/filer

interface PointerFieldEntry {
  readonly field: string;
  readonly member: number;
  readonly key: string;
}
interface PointerTileEntry {
  readonly tileId: string;
  readonly bbox: readonly [number, number, number, number];
  readonly fields: readonly PointerFieldEntry[];
}
interface Pointer {
  readonly tiles: readonly PointerTileEntry[];
}

function loadPointer(): Pointer {
  return JSON.parse(readFileSync(POINTER_PATH, "utf8")) as Pointer;
}

function loadMemberLayers(key: string): { readonly u: Layer; readonly v: Layer } {
  const bytes = new Uint8Array(readFileSync(join(OUT_DIR, key)));
  const [u, v] = readLayerFrames(bytes, 2);
  if (u === undefined || v === undefined) {
    throw new Error(`Forventet to konkatenerte lag (u,v) i ${key}`);
  }
  return { u, v };
}

// ------------------------------------------------------- dense rekonstruksjon

type DenseGrid = Uint8Array | Uint16Array;

interface TileGeometry {
  readonly nodesLat: number;
  readonly nodesLon: number;
  readonly timeSteps: number;
}

/** RÅ per-slice-kvantiserte koder ("dagens" skjema) i kanonisk (i,j,k)-rekkefølge. */
function denseCodesFromLayer(layer: Layer, layout: SubtileLayout): Uint8Array {
  const { nodesLat, nodesLon, timeSteps } = layer.geometry;
  const out = new Uint8Array(nodesLat * nodesLon * timeSteps);
  const payload = layer.payload as Uint8Array;
  let outIdx = 0;
  for (let i = 0; i < nodesLat; i++) {
    for (let j = 0; j < nodesLon; j++) {
      const base = sampleIndex(layer.geometry, layout, i, j, 0);
      for (let k = 0; k < timeSteps; k++) {
        out[outIdx++] = payload[base + k]!;
      }
    }
  }
  return out;
}

/** Rekonstruert fysisk verdi (kn) i kanonisk (i,j,k)-rekkefølge, via dagens skala/offset. */
function densePhysicalFromLayer(layer: Layer, layout: SubtileLayout): Float64Array {
  const { nodesLat, nodesLon, timeSteps } = layer.geometry;
  const out = new Float64Array(nodesLat * nodesLon * timeSteps);
  const payload = layer.payload as Uint8Array;
  let outIdx = 0;
  for (let i = 0; i < nodesLat; i++) {
    for (let j = 0; j < nodesLon; j++) {
      const { sr, sc } = subtileIndexOfNode(layer.geometry, i, j);
      const base = sampleIndex(layer.geometry, layout, i, j, 0);
      const paramsForNode = layer.subtileParams[sr]![sc]!;
      for (let k = 0; k < timeSteps; k++) {
        const raw = payload[base + k]!;
        const v = decodeLinear(raw, paramsForNode[k]!);
        out[outIdx++] = v === undefined ? Number.NaN : v;
      }
    }
  }
  return out;
}

// -------------------------------------------------------- kvantiseringsplaner

type OffsetMode = "perTile" | "none";

interface QuantPlan {
  readonly id: string;
  readonly label: string;
  readonly bits: 8 | 16;
  readonly lsb: number;
  readonly offset: number;
  readonly maxDecodeErrorKn: number;
}

function planFixedQuant(
  lsb: number,
  offsetMode: OffsetMode,
  globalMin: number,
  globalMax: number,
): QuantPlan {
  const offset = offsetMode === "perTile" ? globalMin : -ASSUMED_MAX_ABS_WIND_KN;
  const span = offsetMode === "perTile" ? globalMax - globalMin : 2 * ASSUMED_MAX_ABS_WIND_KN;
  const levels = Math.ceil(span / lsb) + 2; // +1 inklusiv topp, +1 avrundingsmargin
  const bits: 8 | 16 = levels <= 256 ? 8 : 16;
  const maxDecodeErrorKn = computeMaxDecodeErrorKn(lsb, lsb);
  return {
    id: `lsb${lsb === 0.25 ? "025" : "05"}-${offsetMode}`,
    label: `LSB ${lsb} kn, offset=${offsetMode === "perTile" ? "per flis" : "ingen (fast ±" + ASSUMED_MAX_ABS_WIND_KN + " kn)"}`,
    bits,
    lsb,
    offset,
    maxDecodeErrorKn,
  };
}

function quantizeDense(physical: Float64Array, plan: QuantPlan): DenseGrid {
  const n = physical.length;
  const maxCode = (plan.bits === 8 ? 256 : 65536) - 1;
  const out: DenseGrid = plan.bits === 8 ? new Uint8Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const raw = physical[i]!;
    const c = Number.isNaN(raw) ? 0 : Math.round((raw - plan.offset) / plan.lsb);
    out[i] = Math.max(0, Math.min(maxCode, c));
  }
  return out;
}

// -------------------------------------------------------------- prediktorer

function modOf(bits: 8 | 16): number {
  return bits === 8 ? 256 : 65536;
}

function newGridLike(bits: 8 | 16, length: number): DenseGrid {
  return bits === 8 ? new Uint8Array(length) : new Uint16Array(length);
}

function predictNone(codes: DenseGrid): DenseGrid {
  return codes;
}

/** Samme matematikk som `@morild/weather::delta.ts` (mod-M, generalisert fra mod-256). */
function predictTemporalDelta(codes: DenseGrid, geo: TileGeometry, bits: 8 | 16): DenseGrid {
  const mod = modOf(bits);
  const out = newGridLike(bits, codes.length);
  const totalNodes = geo.nodesLat * geo.nodesLon;
  const timeSteps = geo.timeSteps;
  for (let n = 0; n < totalNodes; n++) {
    const base = n * timeSteps;
    out[base] = codes[base]!;
    for (let k = 1; k < timeSteps; k++) {
      out[base + k] = ((codes[base + k]! - codes[base + k - 1]!) + mod) % mod;
    }
  }
  return out;
}

/** Romlig venstre-nabo (samme rad, forrige kolonne) — første kolonne uendret. */
function predictSpatialLeft(codes: DenseGrid, geo: TileGeometry, bits: 8 | 16): DenseGrid {
  const mod = modOf(bits);
  const out = newGridLike(bits, codes.length);
  const { nodesLat, nodesLon, timeSteps } = geo;
  for (let i = 0; i < nodesLat; i++) {
    for (let j = 0; j < nodesLon; j++) {
      const base = (i * nodesLon + j) * timeSteps;
      if (j === 0) {
        for (let k = 0; k < timeSteps; k++) out[base + k] = codes[base + k]!;
        continue;
      }
      const leftBase = (i * nodesLon + (j - 1)) * timeSteps;
      for (let k = 0; k < timeSteps; k++) {
        out[base + k] = ((codes[base + k]! - codes[leftBase + k]!) + mod) % mod;
      }
    }
  }
  return out;
}

/**
 * JPEG-LS' MED-prediktor (Median Edge Detector), per tidssteg (2D, ikke
 * over tidsaksen): pred = min(venstre,over) hvis øvre-venstre >= maks av
 * dem, maks(venstre,over) hvis øvre-venstre <= min av dem, ellers
 * venstre+over-øvre-venstre (plan-flate-interpolasjon). Kant: manglende
 * nabo(er) → bruk det som finnes, `0` hvis ingen.
 */
function predictMed2D(codes: DenseGrid, geo: TileGeometry, bits: 8 | 16): DenseGrid {
  const mod = modOf(bits);
  const out = newGridLike(bits, codes.length);
  const { nodesLat, nodesLon, timeSteps } = geo;
  for (let k = 0; k < timeSteps; k++) {
    for (let i = 0; i < nodesLat; i++) {
      for (let j = 0; j < nodesLon; j++) {
        const idx = (i * nodesLon + j) * timeSteps + k;
        const left = j > 0 ? codes[(i * nodesLon + (j - 1)) * timeSteps + k]! : undefined;
        const above = i > 0 ? codes[((i - 1) * nodesLon + j) * timeSteps + k]! : undefined;
        let pred: number;
        if (left === undefined && above === undefined) {
          pred = 0;
        } else if (left === undefined) {
          pred = above!;
        } else if (above === undefined) {
          pred = left;
        } else {
          const tl = codes[((i - 1) * nodesLon + (j - 1)) * timeSteps + k]!;
          if (tl >= Math.max(left, above)) pred = Math.min(left, above);
          else if (tl <= Math.min(left, above)) pred = Math.max(left, above);
          else pred = left + above - tl;
        }
        out[idx] = ((codes[idx]! - pred) + mod * 4) % mod;
      }
    }
  }
  return out;
}

function predictMemberMinusControl(memberCodes: DenseGrid, controlCodes: DenseGrid, bits: 8 | 16): DenseGrid {
  const mod = modOf(bits);
  const out = newGridLike(bits, memberCodes.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = ((memberCodes[i]! - controlCodes[i]!) + mod) % mod;
  }
  return out;
}

type PredictorId = "ingen" | "tidsdelta" | "romlig-venstre" | "2d-med" | "medlem-kontroll" | "medlem-kontroll+romlig";

const PREDICTOR_IDS: readonly PredictorId[] = [
  "ingen",
  "tidsdelta",
  "romlig-venstre",
  "2d-med",
  "medlem-kontroll",
  "medlem-kontroll+romlig",
];

/**
 * Anvender prediktoren for ETT medlem. `isControl` — for de to
 * medlem-kontroll-variantene lagres kontrollen "ukodet" (kun kvantisert,
 * `predictNone`) fordi det ikke finnes noen kontroll å diffe kontrollen MOT
 * (§oppgavebeskrivelsen, "med kontrollen ukodet").
 */
function applyPredictor(
  id: PredictorId,
  memberCodes: DenseGrid,
  controlCodes: DenseGrid,
  isControl: boolean,
  geo: TileGeometry,
  bits: 8 | 16,
): DenseGrid {
  switch (id) {
    case "ingen":
      return predictNone(memberCodes);
    case "tidsdelta":
      return predictTemporalDelta(memberCodes, geo, bits);
    case "romlig-venstre":
      return predictSpatialLeft(memberCodes, geo, bits);
    case "2d-med":
      return predictMed2D(memberCodes, geo, bits);
    case "medlem-kontroll": {
      if (isControl) return predictNone(memberCodes);
      return predictMemberMinusControl(memberCodes, controlCodes, bits);
    }
    case "medlem-kontroll+romlig": {
      if (isControl) return predictNone(memberCodes);
      const residual = predictMemberMinusControl(memberCodes, controlCodes, bits);
      return predictSpatialLeft(residual, geo, bits);
    }
  }
}

// ------------------------------------------------------------ serialisering

function toBytesLE(grid: DenseGrid): Uint8Array {
  if (grid instanceof Uint8Array) return grid;
  const out = new Uint8Array(grid.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < grid.length; i++) view.setUint16(i * 2, grid[i]!, true);
  return out;
}

// ----------------------------------------------------------------- entropi

/** Order-0 Shannon-entropi (bit/sample) — puljet histogram, akkumulert innover. */
class RunningHistogram {
  private readonly hist: Float64Array;
  private n = 0;
  constructor(mod: number) {
    this.hist = new Float64Array(mod);
  }
  add(grid: DenseGrid): void {
    for (let i = 0; i < grid.length; i++) {
      const code = grid[i]!;
      this.hist[code] = (this.hist[code] ?? 0) + 1;
    }
    this.n += grid.length;
  }
  entropyBits(): number {
    if (this.n === 0) return 0;
    let h = 0;
    for (const count of this.hist) {
      if (count === 0) continue;
      const p = count / this.n;
      h -= p * Math.log2(p);
    }
    return h;
  }
}

// -------------------------------------------------------------- brotli-opsjon

const BROTLI_QUALITY = 9; // dokumentert fart/kvalitet-avveining, ikke maks (11) — se toppkommentaren.

function brotliSize(bytes: Uint8Array): number {
  return brotliCompressSync(bytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }).length;
}

// --------------------------------------------------------------- hovedløp

interface TileResult {
  readonly tileId: string;
  readonly nodesLat: number;
  readonly nodesLon: number;
  readonly timeSteps: number;
  readonly memberCount: number;
  readonly observedPhysicalRangeKn: { readonly min: number; readonly max: number };
  readonly dagensMaxDecodeErrorKnObserved: number;
  readonly variants: readonly {
    readonly quantId: string;
    readonly quantLabel: string;
    readonly predictorId: PredictorId;
    readonly bits: 8 | 16;
    readonly maxDecodeErrorKn: number;
    readonly combinedMaxDecodeErrorKn: number | undefined;
    readonly rawBytes: number;
    readonly gzipBytes: number;
    readonly brotliBytes: number;
    readonly entropyBitsPerSample: number;
    readonly entropyBytesTheoretical: number;
  }[];
}

async function processTile(tile: PointerTileEntry): Promise<TileResult> {
  const windFields = tile.fields.filter((f) => f.field === "wind").sort((a, b) => a.member - b.member);
  console.log(`\n=== Flis ${tile.tileId}: ${windFields.length} medlemmer ===`);

  // --- Pass 1: last alle medlemmer, bygg dagens-koder + fysisk rekonstruksjon
  let geo: TileGeometry | undefined;
  const dagensU: Uint8Array[] = [];
  const dagensV: Uint8Array[] = [];
  const physU: Float64Array[] = [];
  const physV: Float64Array[] = [];
  let dagensMaxErrKn = 0;
  let obsMin = Infinity;
  let obsMax = -Infinity;

  for (const f of windFields) {
    const { u, v } = loadMemberLayers(f.key);
    if (geo === undefined) {
      geo = { nodesLat: u.geometry.nodesLat, nodesLon: u.geometry.nodesLon, timeSteps: u.geometry.timeSteps };
    }
    const uLayout = computeSubtileLayout(u.geometry);
    const vLayout = computeSubtileLayout(v.geometry);
    dagensU.push(denseCodesFromLayer(u, uLayout));
    dagensV.push(denseCodesFromLayer(v, vLayout));
    const pu = densePhysicalFromLayer(u, uLayout);
    const pv = densePhysicalFromLayer(v, vLayout);
    for (const arr of [pu, pv]) {
      for (let i = 0; i < arr.length; i++) {
        const val = arr[i]!;
        if (Number.isNaN(val)) throw new Error(`Uventet manglende verdi (sentinel) i flis ${tile.tileId}, medlem ${f.member} — eksperimentet forutsetter full dekning`);
        if (val < obsMin) obsMin = val;
        if (val > obsMax) obsMax = val;
      }
    }
    physU.push(pu);
    physV.push(pv);
    const err = windLayerMaxDecodeErrorKnFromLayers({ u: buildLayerLookup(u), v: buildLayerLookup(v) });
    if (err > dagensMaxErrKn) dagensMaxErrKn = err;
  }
  if (geo === undefined) throw new Error(`Ingen vind-medlemmer funnet for flis ${tile.tileId}`);
  console.log(
    `  Lastet ${windFields.length} medlemmer (${geo.nodesLat}x${geo.nodesLon} noder, ${geo.timeSteps} tidssteg). ` +
      `Observert fysisk område: [${obsMin.toFixed(2)}, ${obsMax.toFixed(2)}] kn. Dagens maxDecodeErrorKn (observert maks over medlemmer): ${dagensMaxErrKn.toFixed(4)}`,
  );

  // --- Kvantiseringsplaner
  const plans: QuantPlan[] = [
    {
      id: "dagens",
      label: "Dagens (per subflis, per tidssteg, adaptiv min/maks, 8-bit)",
      bits: 8,
      lsb: Number.NaN, // ikke en enkelt skala — informativ placeholder, brukes ikke til kvantisering (koder finnes allerede)
      offset: Number.NaN,
      maxDecodeErrorKn: dagensMaxErrKn,
    },
    planFixedQuant(0.25, "perTile", obsMin, obsMax),
    planFixedQuant(0.25, "none", obsMin, obsMax),
    planFixedQuant(0.5, "perTile", obsMin, obsMax),
    planFixedQuant(0.5, "none", obsMin, obsMax),
  ];

  type VariantResultItem = TileResult["variants"][number];
  const variantResults: VariantResultItem[] = [];

  for (const plan of plans) {
    console.log(`  Kvantisering: ${plan.id} (${plan.label}) — ${plan.bits}-bit`);
    // Kodegrid per medlem for DENNE kvantiseringen.
    const codesU: DenseGrid[] = [];
    const codesV: DenseGrid[] = [];
    for (let m = 0; m < windFields.length; m++) {
      if (plan.id === "dagens") {
        codesU.push(dagensU[m]!);
        codesV.push(dagensV[m]!);
      } else {
        codesU.push(quantizeDense(physU[m]!, plan));
        codesV.push(quantizeDense(physV[m]!, plan));
      }
    }

    for (const predictorId of PREDICTOR_IDS) {
      const isResidualPredictor = predictorId === "medlem-kontroll" || predictorId === "medlem-kontroll+romlig";
      const mod = modOf(plan.bits);
      const hist = new RunningHistogram(mod);
      let rawBytes = 0;
      let gzipBytes = 0;
      let brotliBytes = 0;

      for (let m = 0; m < windFields.length; m++) {
        const isControl = windFields[m]!.member === 0;
        const predU = applyPredictor(predictorId, codesU[m]!, codesU[0]!, isControl, geo, plan.bits);
        const predV = applyPredictor(predictorId, codesV[m]!, codesV[0]!, isControl, geo, plan.bits);
        hist.add(predU);
        hist.add(predV);
        const bytesU = toBytesLE(predU);
        const bytesV = toBytesLE(predV);
        const fileBytes = new Uint8Array(bytesU.length + bytesV.length);
        fileBytes.set(bytesU, 0);
        fileBytes.set(bytesV, bytesU.length);
        rawBytes += fileBytes.length;
        gzipBytes += gzipSync(fileBytes, { level: 9 }).length;
        brotliBytes += brotliSize(fileBytes);
      }

      const entropyBitsPerSample = hist.entropyBits();
      const totalSamples = windFields.length * 2 * geo.nodesLat * geo.nodesLon * geo.timeSteps;
      const entropyBytesTheoretical = (entropyBitsPerSample * totalSamples) / 8;

      variantResults.push({
        quantId: plan.id,
        quantLabel: plan.label,
        predictorId,
        bits: plan.bits,
        maxDecodeErrorKn: plan.maxDecodeErrorKn,
        combinedMaxDecodeErrorKn: isResidualPredictor ? plan.maxDecodeErrorKn * 2 : undefined,
        rawBytes,
        gzipBytes,
        brotliBytes,
        entropyBitsPerSample,
        entropyBytesTheoretical,
      });
      console.log(
        `    ${predictorId.padEnd(24)} rått=${(rawBytes / 1e6).toFixed(2)}MB gzip=${(gzipBytes / 1e6).toFixed(2)}MB ` +
          `brotli=${(brotliBytes / 1e6).toFixed(2)}MB entropi=${entropyBitsPerSample.toFixed(3)}bit/sample (teoretisk ${(entropyBytesTheoretical / 1e6).toFixed(2)}MB)`,
      );
    }
  }

  return {
    tileId: tile.tileId,
    nodesLat: geo.nodesLat,
    nodesLon: geo.nodesLon,
    timeSteps: geo.timeSteps,
    memberCount: windFields.length,
    observedPhysicalRangeKn: { min: obsMin, max: obsMax },
    dagensMaxDecodeErrorKnObserved: dagensMaxErrKn,
    variants: variantResults,
  };
}

async function main(): Promise<void> {
  if (!existsSync(POINTER_PATH)) {
    console.error(
      `Fant ikke ${POINTER_PATH} — dette eksperimentet leser de allerede bygde blobene fra ` +
        `build-live-package.ts (§D6-C forutsetter at de finnes lokalt, ingen nye THREDDS-kall gjøres her).`,
    );
    process.exitCode = 1;
    return;
  }
  const pointer = loadPointer();
  const tileResults: TileResult[] = [];
  for (const tile of pointer.tiles) {
    tileResults.push(await processTile(tile));
  }

  // Kombinert (begge fliser) sum per (kvant,prediktor)-kombinasjon.
  const combinedKey = (quantId: string, predictorId: string) => `${quantId}::${predictorId}`;
  const combined = new Map<
    string,
    { quantId: string; quantLabel: string; predictorId: string; bits: number; maxDecodeErrorKn: number; combinedMaxDecodeErrorKn: number | undefined; rawBytes: number; gzipBytes: number; brotliBytes: number }
  >();
  for (const tr of tileResults) {
    for (const v of tr.variants) {
      const key = combinedKey(v.quantId, v.predictorId);
      const existing = combined.get(key);
      if (existing) {
        existing.rawBytes += v.rawBytes;
        existing.gzipBytes += v.gzipBytes;
        existing.brotliBytes += v.brotliBytes;
      } else {
        combined.set(key, {
          quantId: v.quantId,
          quantLabel: v.quantLabel,
          predictorId: v.predictorId,
          bits: v.bits,
          maxDecodeErrorKn: v.maxDecodeErrorKn,
          combinedMaxDecodeErrorKn: v.combinedMaxDecodeErrorKn,
          rawBytes: v.rawBytes,
          gzipBytes: v.gzipBytes,
          brotliBytes: v.brotliBytes,
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    assumedMaxAbsWindKn: ASSUMED_MAX_ABS_WIND_KN,
    brotliQuality: BROTLI_QUALITY,
    tiles: tileResults,
    combinedBothTiles: Array.from(combined.values()).sort((a, b) => a.gzipBytes - b.gzipBytes),
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n=== Beste 5 kombinasjoner (begge fliser, sortert på gzip-bytes) ===`);
  for (const c of report.combinedBothTiles.slice(0, 5)) {
    console.log(
      `${c.quantId} + ${c.predictorId}: gzip=${(c.gzipBytes / 1e6).toFixed(2)}MB brotli=${(c.brotliBytes / 1e6).toFixed(2)}MB ` +
        `(maxDecodeErrorKn=${c.maxDecodeErrorKn.toFixed(4)}${c.combinedMaxDecodeErrorKn !== undefined ? `, kombinert=${c.combinedMaxDecodeErrorKn.toFixed(4)}` : ""})`,
    );
  }
  console.log(`\nFull rapport: ${REPORT_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
