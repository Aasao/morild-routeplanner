/**
 * Binær pakke-layout — ett kvantisert "lag" (ett fysisk kanal-sett: vind-u,
 * vind-v, strøm-u, strøm-v, Hs, Tp, bølgeretning). Delt av batch-encoderen
 * (`tools/weather-pack`, kommer i en senere bølge) og klient-dekoderen
 * (`field.ts`), slik at ingen av dem kan bygge en annen oppfatning av
 * byte-layouten enn den andre.
 *
 * Grunnlag: `docs/specs/vaerpakker.md` §7 (fliser/subfliser), §9.9
 * (`QuantizationParams`), §9.6 (sentinel), §9.7/§15 (kvantisert
 * `Uint8Array` er den residente representasjonen — payload i denne
 * modulen ER akkurat det).
 *
 * **Avvik/presisering, dokumentert (spec-ens endringslogg, 2026-09-03):**
 * §9.9 sier 16-bit er reservert "via formatVersion" og ikke i bruk. For
 * 10-bit (§9.1 pkt. 3s to smale unntak) sier §9.1 pkt. 1 at 10-bit ble
 * avvist for normaldrift nettopp fordi det krever bit-pakking uten
 * byte-alignering. Siden 10-bit likevel brukes i de to unntakene, men
 * bit-pakking er en betydelig implementasjonskostnad for en sjelden,
 * ikke-blokkerende sti, lagres 10-bit-prøver her som **2 byte (u16) per
 * prøve** — korrekt og bit-eksakt rundtur-testet, men ikke byte-optimalt.
 * Ekte bit-pakking for 10-bit er en `tools/weather-pack`-optimalisering å
 * ta stilling til når den stien faktisk bygges, ikke en beslutning denne
 * spec-en låser her.
 *
 * Hver flis/subflis sitt skala/offset-par (§7: «per felt per tidssteg»)
 * lagres eksplisitt i en liten indekstabell FORAN nyttelasten, slik at
 * `maxDecodeErrorKn` (vaerpakker.md §9.5) kan regnes fra metadata alene —
 * uten å dekode en eneste nodeverdi (§9.7: rimelig eager-kostnad, subflis-
 * tabellen er liten; selve nyttelasten forblir lat/per-oppslag).
 */
import {
  computeAngleParams,
  computeLinearParams,
  decodeAngleDeg,
  decodeLinear,
  encodeAngleDeg,
  encodeLinear,
  type QuantizationParams,
  type RoundingMode,
} from "./quantize.js";
import { decodeTemporalDeltaU8, encodeTemporalDeltaU8 } from "./delta.js";

export const WEATHER_LAYER_MAGIC = "MWL1";
/** Semver for selve lag-skjemaet (§5 — separat fra modellkjøringens `PackageHeader.formatVersion`). */
export const WEATHER_PACKAGE_FORMAT_VERSION = "1.0.0";

export type ChannelKind = "linear" | "angle";

export interface LayerGeometry {
  readonly latMin: number;
  readonly lonMin: number;
  readonly latStepDeg: number;
  readonly lonStepDeg: number;
  readonly nodesLat: number;
  readonly nodesLon: number;
  /** ≤32 (§7, §9 krav 8). */
  readonly tileNodes: number;
  readonly t0S: number;
  readonly dtS: number;
  readonly timeSteps: number;
}

/** Ett lag: én kanal, kvantisert. Payload er den residente representasjonen (§9.7). */
export interface Layer {
  readonly geometry: LayerGeometry;
  readonly bitsPerSample: 8 | 10;
  readonly roundingMode: RoundingMode;
  readonly channelKind: ChannelKind;
  /** `[subtileRow][subtileCol][timeIndex]` — skala/offset per subflis per tidssteg. */
  readonly subtileParams: readonly (readonly (readonly QuantizationParams[])[])[];
  /** Rå koder, subflis-major (se `computeSubtileLayout`). */
  readonly payload: Uint8Array | Uint16Array;
}

export interface SubtileBounds {
  readonly rowStart: number;
  readonly colStart: number;
  readonly rowCount: number;
  readonly colCount: number;
}

export interface SubtileLayout {
  readonly subtileRows: number;
  readonly subtileCols: number;
  readonly bounds: readonly (readonly SubtileBounds[])[];
  /** Antall prøver (node × tidssteg) FØR subflis (sr,sc) i payload-rekkefølgen. */
  readonly sampleOffset: readonly (readonly number[])[];
  readonly totalSamples: number;
}

export function computeSubtileLayout(geometry: LayerGeometry): SubtileLayout {
  const { nodesLat, nodesLon, tileNodes, timeSteps } = geometry;
  const subtileRows = Math.max(1, Math.ceil(nodesLat / tileNodes));
  const subtileCols = Math.max(1, Math.ceil(nodesLon / tileNodes));
  const bounds: SubtileBounds[][] = [];
  const sampleOffset: number[][] = [];
  let running = 0;
  for (let sr = 0; sr < subtileRows; sr++) {
    const rowStart = sr * tileNodes;
    const rowCount = Math.min(tileNodes, nodesLat - rowStart);
    const boundsRow: SubtileBounds[] = [];
    const offsetRow: number[] = [];
    for (let sc = 0; sc < subtileCols; sc++) {
      const colStart = sc * tileNodes;
      const colCount = Math.min(tileNodes, nodesLon - colStart);
      boundsRow.push({ rowStart, colStart, rowCount, colCount });
      offsetRow.push(running);
      running += rowCount * colCount * timeSteps;
    }
    bounds.push(boundsRow);
    sampleOffset.push(offsetRow);
  }
  return {
    subtileRows,
    subtileCols,
    bounds,
    sampleOffset,
    totalSamples: running,
  };
}

/** Hvilken subflis en node (i,j) faller i. */
export function subtileIndexOfNode(
  geometry: LayerGeometry,
  i: number,
  j: number,
): { readonly sr: number; readonly sc: number } {
  return {
    sr: Math.floor(i / geometry.tileNodes),
    sc: Math.floor(j / geometry.tileNodes),
  };
}

/** Byte-/element-indeks for nodeprøve (i,j) på tidssteg k i payload-arrayet. */
export function sampleIndex(
  geometry: LayerGeometry,
  layout: SubtileLayout,
  i: number,
  j: number,
  k: number,
): number {
  const { sr, sc } = subtileIndexOfNode(geometry, i, j);
  const b = layout.bounds[sr]![sc]!;
  const withinRow = i - b.rowStart;
  const withinCol = j - b.colStart;
  const base = layout.sampleOffset[sr]![sc]!;
  return base + (withinRow * b.colCount + withinCol) * geometry.timeSteps + k;
}

// ------------------------------------------------------------------ bygging

export interface BuildLayerOptions {
  readonly sample: (lat: number, lon: number, epochS: number) => number | undefined;
  readonly geometryBase: Omit<LayerGeometry, "timeSteps"> & { readonly timeSteps: number };
  readonly bitsPerSample: 8 | 10;
  readonly roundingMode: RoundingMode;
  readonly channelKind: ChannelKind;
}

/**
 * Bygger et lag fra en kildefunksjon: samler rå fysiske verdier per subflis
 * og tidssteg, regner skala/offset fra MIN/MAKS **i subflisen og skiven**
 * (§7 — "flis"-modus, ikke en global skala), og kvantiserer.
 *
 * Dette er produsent-siden (batch-encoder). Klienten kaller aldri denne —
 * den kaller `deserializeLayer` på en ferdig bygget buffer.
 */
export function buildLayer(opts: BuildLayerOptions): Layer {
  const geometry: LayerGeometry = opts.geometryBase;
  const layout = computeSubtileLayout(geometry);
  const elementBytes = opts.bitsPerSample <= 8 ? 1 : 2;
  const payload =
    elementBytes === 1
      ? new Uint8Array(layout.totalSamples)
      : new Uint16Array(layout.totalSamples);

  const subtileParams: QuantizationParams[][][] = [];

  for (let sr = 0; sr < layout.subtileRows; sr++) {
    const paramsRow: QuantizationParams[][] = [];
    for (let sc = 0; sc < layout.subtileCols; sc++) {
      const b = layout.bounds[sr]![sc]!;
      const paramsForTile: QuantizationParams[] = [];
      for (let k = 0; k < geometry.timeSteps; k++) {
        const epochS = geometry.t0S + k * geometry.dtS;
        // Pass 1: rå verdier + min/maks for denne subflisen/tidssteget.
        const raw: (number | undefined)[] = new Array(b.rowCount * b.colCount);
        let lo = Infinity;
        let hi = -Infinity;
        for (let a = 0; a < b.rowCount; a++) {
          const lat = geometry.latMin + (b.rowStart + a) * geometry.latStepDeg;
          for (let c = 0; c < b.colCount; c++) {
            const lon = geometry.lonMin + (b.colStart + c) * geometry.lonStepDeg;
            const v = opts.sample(lat, lon, epochS);
            raw[a * b.colCount + c] = v;
            if (v !== undefined && !Number.isNaN(v)) {
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
          }
        }
        const params =
          opts.channelKind === "angle"
            ? computeAngleParams(opts.bitsPerSample, opts.roundingMode)
            : computeLinearParams(
                lo === Infinity ? 0 : lo,
                hi === -Infinity ? (lo === Infinity ? 0 : lo) : hi,
                opts.bitsPerSample,
                opts.roundingMode,
              );
        paramsForTile.push(params);

        // Pass 2: kod og skriv til payload.
        for (let a = 0; a < b.rowCount; a++) {
          for (let c = 0; c < b.colCount; c++) {
            const v = raw[a * b.colCount + c];
            const code =
              opts.channelKind === "angle"
                ? encodeAngleDeg(v, params)
                : encodeLinear(v, params);
            const idx = sampleIndex(geometry, layout, b.rowStart + a, b.colStart + c, k);
            payload[idx] = code;
          }
        }
      }
      paramsRow.push(paramsForTile);
    }
    subtileParams.push(paramsRow);
  }

  return {
    geometry,
    bitsPerSample: opts.bitsPerSample,
    roundingMode: opts.roundingMode,
    channelKind: opts.channelKind,
    subtileParams,
    payload,
  };
}

// --------------------------------------------------------------- dekoding

/** Dekoder én eksakt node (heltallsindekser). `undefined` = sentinel/utenfor domenet. */
export function decodeLayerNode(
  layer: Layer,
  layout: SubtileLayout,
  i: number,
  j: number,
  k: number,
): number | undefined {
  if (i < 0 || j < 0 || i >= layer.geometry.nodesLat || j >= layer.geometry.nodesLon) {
    return undefined;
  }
  if (k < 0 || k >= layer.geometry.timeSteps) return undefined;
  const { sr, sc } = subtileIndexOfNode(layer.geometry, i, j);
  const params = layer.subtileParams[sr]![sc]![k]!;
  const idx = sampleIndex(layer.geometry, layout, i, j, k);
  const raw = layer.payload[idx]!;
  return layer.channelKind === "angle"
    ? decodeAngleDeg(raw, params)
    : decodeLinear(raw, params);
}

/**
 * Maksimal dekodefeil (i fysisk enhet, per kanal) over ALLE subfliser og
 * tidssteg laget faktisk bærer — regnet fra metadata alene, ingen
 * nodedekoding (§9.5 punkt 1: "maksimum over de subflisene pakken faktisk
 * bærer").
 */
export function layerMaxDecodeError(layer: Layer): number {
  let max = 0;
  for (const row of layer.subtileParams) {
    for (const perTime of row) {
      for (const params of perTime) {
        const oneSided = params.roundingMode === "nearest" ? 0.5 : 1;
        const err = oneSided * params.scale;
        if (err > max) max = err;
      }
    }
  }
  return max;
}

// ------------------------------------------------------ delta-koding (§8)

/**
 * Kobler `delta.ts`s testede tidsakse-primitiv (`encodeTemporalDeltaU8`)
 * inn i subflis-lagringens FAKTISKE byte-layout (`docs/specs/vaerpakker.md`
 * §8 "delta+gzip", §19 endringslogg 2026-09-03 — tidligere levert testet,
 * men ukoblet).
 *
 * `sampleIndex` legger tidsaksen INNERST per node (`... + k`, se over) — for
 * en gitt node er de `timeSteps` byte-verdiene allerede sammenhengende i
 * payload-arrayet, i stigende tidsrekkefølge. Det er nøyaktig samme
 * matematiske delta (`verdi[node][t] − verdi[node][t−1] mod 256`) som
 * `encodeTemporalDeltaU8` regner når den mates én skive per tidssteg — bare
 * en annen akse-rekkefølge (tid-major i primitiven, node-major i payloadet).
 * `toTimeMajorSlices`/`fromTimeMajorSlices` er den eksplisitte, testede
 * transponeringen mellom de to, slik at selve delta-matematikken forblir
 * definert ÉTT sted (`delta.ts`), ikke omskrevet her.
 *
 * Kun 8-bit (`elementBytes === 1`) støttes — `delta.ts`s primitiv er
 * bevisst `Uint8Array`/mod-256 (se dens toppkommentar). 10-bit-laget
 * (`Uint16Array`, §9.1 pkt. 3s to smale unntak) er en sjelden,
 * ikke-budsjett-dominerende sti (§8: vind-medlemmene på 8-bit er posten som
 * spiser budsjettet) — delta for den stien er ikke bygget her, og
 * `deltaEncodeLayerPayload` kaster eksplisitt i stedet for å late som den
 * støtter det.
 */
function toTimeMajorSlices(payload: Uint8Array, timeSteps: number): Uint8Array[] {
  const totalNodes = payload.length / timeSteps;
  const slices: Uint8Array[] = [];
  for (let k = 0; k < timeSteps; k++) slices.push(new Uint8Array(totalNodes));
  for (let n = 0; n < totalNodes; n++) {
    const base = n * timeSteps;
    for (let k = 0; k < timeSteps; k++) {
      slices[k]![n] = payload[base + k]!;
    }
  }
  return slices;
}

function fromTimeMajorSlices(slices: readonly Uint8Array[], timeSteps: number): Uint8Array {
  const totalNodes = slices[0]?.length ?? 0;
  const payload = new Uint8Array(totalNodes * timeSteps);
  for (let n = 0; n < totalNodes; n++) {
    const base = n * timeSteps;
    for (let k = 0; k < timeSteps; k++) {
      payload[base + k] = slices[k]![n]!;
    }
  }
  return payload;
}

function requireDeltaCapableLayer(layer: Layer): asserts layer is Layer & { payload: Uint8Array } {
  if (layer.bitsPerSample > 8) {
    throw new Error(
      `Delta-koding støtter kun 8-bit lag (fikk bitsPerSample=${layer.bitsPerSample}) — ` +
        "10-bit-unntaket (§9.1 pkt. 3) er en sjelden, ikke-budsjett-dominerende sti (§8) og har ingen delta-transform ennå.",
    );
  }
}

/**
 * Delta-koder ETT lags payload langs tidsaksen, node for node (§8). Returnerer
 * et nytt `Layer` — geometri/subflis-parametre er uendret, kun `payload` er
 * transformert. Reversibel bit-eksakt med `deltaDecodeLayerPayload`
 * (mod-256, samme garanti som `delta.ts`).
 */
export function deltaEncodeLayerPayload(layer: Layer): Layer {
  requireDeltaCapableLayer(layer);
  const timeSteps = layer.geometry.timeSteps;
  const slices = toTimeMajorSlices(layer.payload as Uint8Array, timeSteps);
  const deltaSlices = encodeTemporalDeltaU8(slices);
  const payload = fromTimeMajorSlices(deltaSlices, timeSteps);
  return { ...layer, payload };
}

/** Den eksakte inversen av `deltaEncodeLayerPayload`. */
export function deltaDecodeLayerPayload(layer: Layer): Layer {
  requireDeltaCapableLayer(layer);
  const timeSteps = layer.geometry.timeSteps;
  const deltaSlices = toTimeMajorSlices(layer.payload as Uint8Array, timeSteps);
  const slices = decodeTemporalDeltaU8(deltaSlices);
  const payload = fromTimeMajorSlices(slices, timeSteps);
  return { ...layer, payload };
}

// ------------------------------------------------------------- serialisering

const HEADER_BYTES = 4 + 1 + 1 + 1 + 1 + 8 * 4 + 4 * 3 + 8 * 2 + 4;

export interface LayerByteLayout {
  /** Subflis-skala/offset-tabellen (f64 scale + f64 offset per subflis per tidssteg). */
  readonly indexBytes: number;
  /** De kvantiserte kodene selv. */
  readonly payloadBytes: number;
  /** Total byte-lengde ETT serialisert lag opptar (header + indeks + nyttelast). */
  readonly totalBytes: number;
}

/**
 * Total byte-lengde ett serialisert lag opptar, gitt subflis-layouten,
 * antall tidssteg og bitbredden. **Delt hjelper** — review-funn fase 3
 * bølge 2: denne formelen var duplisert i `serializeLayer` og
 * `readLayerFrame`, med reell driftsrisiko (endres den ene og ikke den
 * andre, blir rammededelingen feil uten at typene fanger det). Begge
 * kallsteder har allerede `layout` (fra `computeSubtileLayout`) og
 * `timeSteps` tilgjengelig, så denne tar dem som parametre i stedet for å
 * regne `computeSubtileLayout` en gang til.
 */
export function layerByteLayout(
  layout: SubtileLayout,
  timeSteps: number,
  bitsPerSample: 8 | 10,
): LayerByteLayout {
  const elementBytes = bitsPerSample <= 8 ? 1 : 2;
  const indexBytes = layout.subtileRows * layout.subtileCols * timeSteps * 16; // f64 scale + f64 offset
  const payloadBytes = layout.totalSamples * elementBytes;
  return { indexBytes, payloadBytes, totalBytes: HEADER_BYTES + indexBytes + payloadBytes };
}

function roundingCode(mode: RoundingMode): number {
  return mode === "nearest" ? 0 : mode === "up" ? 1 : 2;
}
function roundingFromCode(code: number): RoundingMode {
  return code === 0 ? "nearest" : code === 1 ? "up" : "down";
}

export interface SerializeLayerOptions {
  /**
   * §8 "delta+gzip": deltakod payload langs tidsaksen (node for node) FØR
   * skriving (`deltaEncodeLayerPayload`). Kun gyldig for `bitsPerSample<=8`
   * (kaster ellers, se `requireDeltaCapableLayer`). Flagget lagres i
   * headerens reserverte byte, slik at `deserializeLayer` inverterer det
   * automatisk — en dekodet `Layer` er ALLTID i rå kvantiserte koder, aldri
   * delta-kodet, uansett hvordan den ble serialisert.
   */
  readonly deltaCoded?: boolean;
}

/** Serialiserer ett lag til en `Uint8Array` — bit-eksakt rundtur med `deserializeLayer`. */
export function serializeLayer(layer: Layer, options: SerializeLayerOptions = {}): Uint8Array {
  const deltaCoded = options.deltaCoded ?? false;
  const layerToWrite = deltaCoded ? deltaEncodeLayerPayload(layer) : layer;
  const g = layer.geometry;
  const layout = computeSubtileLayout(g);
  const elementBytes = layer.bitsPerSample <= 8 ? 1 : 2;
  const { totalBytes: total } = layerByteLayout(layout, g.timeSteps, layer.bitsPerSample);
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  let off = 0;
  for (let i = 0; i < WEATHER_LAYER_MAGIC.length; i++) {
    bytes[off + i] = WEATHER_LAYER_MAGIC.charCodeAt(i);
  }
  off += 4;
  view.setUint8(off, layer.bitsPerSample);
  off += 1;
  view.setUint8(off, roundingCode(layer.roundingMode));
  off += 1;
  view.setUint8(off, layer.channelKind === "linear" ? 0 : 1);
  off += 1;
  view.setUint8(off, deltaCoded ? 1 : 0); // tidligere "reservert" — nå deltaCoded-flagget (§8, §19)
  off += 1;
  view.setFloat64(off, g.latMin, true);
  off += 8;
  view.setFloat64(off, g.lonMin, true);
  off += 8;
  view.setFloat64(off, g.latStepDeg, true);
  off += 8;
  view.setFloat64(off, g.lonStepDeg, true);
  off += 8;
  view.setUint32(off, g.nodesLat, true);
  off += 4;
  view.setUint32(off, g.nodesLon, true);
  off += 4;
  view.setUint32(off, g.tileNodes, true);
  off += 4;
  view.setFloat64(off, g.t0S, true);
  off += 8;
  view.setFloat64(off, g.dtS, true);
  off += 8;
  view.setUint32(off, g.timeSteps, true);
  off += 4;

  for (let sr = 0; sr < layout.subtileRows; sr++) {
    for (let sc = 0; sc < layout.subtileCols; sc++) {
      const perTime = layer.subtileParams[sr]![sc]!;
      for (let k = 0; k < g.timeSteps; k++) {
        const p = perTime[k]!;
        view.setFloat64(off, p.scale, true);
        off += 8;
        view.setFloat64(off, p.offset, true);
        off += 8;
      }
    }
  }

  if (elementBytes === 1) {
    bytes.set(layerToWrite.payload as Uint8Array, off);
  } else {
    for (let idx = 0; idx < layout.totalSamples; idx++) {
      view.setUint16(off, (layerToWrite.payload as Uint16Array)[idx]!, true);
      off += 2;
    }
  }

  return bytes;
}

export function deserializeLayer(bytes: Uint8Array): Layer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  const magic = String.fromCharCode(
    bytes[0]!,
    bytes[1]!,
    bytes[2]!,
    bytes[3]!,
  );
  if (magic !== WEATHER_LAYER_MAGIC) {
    throw new Error(`Ugyldig lag-magic "${magic}" — forventet "${WEATHER_LAYER_MAGIC}"`);
  }
  off += 4;
  const bitsPerSample = view.getUint8(off) as 8 | 10;
  off += 1;
  const roundingMode = roundingFromCode(view.getUint8(off));
  off += 1;
  const channelKind: ChannelKind = view.getUint8(off) === 0 ? "linear" : "angle";
  off += 1;
  const deltaCoded = view.getUint8(off) === 1; // tidligere "reservert" — nå deltaCoded-flagget (§8, §19)
  off += 1;
  const latMin = view.getFloat64(off, true);
  off += 8;
  const lonMin = view.getFloat64(off, true);
  off += 8;
  const latStepDeg = view.getFloat64(off, true);
  off += 8;
  const lonStepDeg = view.getFloat64(off, true);
  off += 8;
  const nodesLat = view.getUint32(off, true);
  off += 4;
  const nodesLon = view.getUint32(off, true);
  off += 4;
  const tileNodes = view.getUint32(off, true);
  off += 4;
  const t0S = view.getFloat64(off, true);
  off += 8;
  const dtS = view.getFloat64(off, true);
  off += 8;
  const timeSteps = view.getUint32(off, true);
  off += 4;

  const geometry: LayerGeometry = {
    latMin,
    lonMin,
    latStepDeg,
    lonStepDeg,
    nodesLat,
    nodesLon,
    tileNodes,
    t0S,
    dtS,
    timeSteps,
  };
  const layout = computeSubtileLayout(geometry);

  const subtileParams: QuantizationParams[][][] = [];
  for (let sr = 0; sr < layout.subtileRows; sr++) {
    const row: QuantizationParams[][] = [];
    for (let sc = 0; sc < layout.subtileCols; sc++) {
      const perTime: QuantizationParams[] = [];
      for (let k = 0; k < timeSteps; k++) {
        const scale = view.getFloat64(off, true);
        off += 8;
        const offset = view.getFloat64(off, true);
        off += 8;
        perTime.push({
          bitsPerSample,
          scale,
          offset,
          roundingMode,
          sentinelRawValue: 255,
        });
      }
      row.push(perTime);
    }
    subtileParams.push(row);
  }

  const elementBytes = bitsPerSample <= 8 ? 1 : 2;
  let payload: Uint8Array | Uint16Array;
  if (elementBytes === 1) {
    payload = bytes.slice(off, off + layout.totalSamples);
  } else {
    const u16 = new Uint16Array(layout.totalSamples);
    for (let idx = 0; idx < layout.totalSamples; idx++) {
      u16[idx] = view.getUint16(off, true);
      off += 2;
    }
    payload = u16;
  }

  const rawLayer: Layer = {
    geometry,
    bitsPerSample,
    roundingMode,
    channelKind,
    subtileParams,
    payload,
  };
  // §8/§19: deltaCoded er en ren serialiseringsdetalj — en dekodet `Layer`
  // bærer alltid rå kvantiserte koder, aldri delta-kodede byte, uansett
  // flagget som ble lest over.
  return deltaCoded ? deltaDecodeLayerPayload(rawLayer) : rawLayer;
}

// -------------------------------------------------- flerlags-rammededeling

/**
 * **Klientgap identifisert i fase 3 bølge 2C (`docs/specs/app-skjelett.md`
 * §5.3, `docs/specs/vaerpakker.md` §15).** Ett vind-medlems R2-blob er
 * `u`-lagets serialiserte bytes etterfulgt av `v`-lagets, konkatenert uten
 * lengde-prefiks (`tools/weather-pack/src/pipeline.ts::buildWindMemberPackage`).
 * `deserializeLayer` alene forutsetter at HELE input-arrayet er ett lag —
 * ingen eksisterende funksjon lot klienten dele opp konkatenerte lag før
 * denne. `readLayerFrame`/`readLayerFrames` regner ut nøyaktig hvor mange
 * byte ETT serialisert lag opptar (samme header-/indeks-/nyttelast-
 * regnestykke som `deserializeLayer` selv gjør internt) UTEN å kreve en
 * separat lengde-kanal i R2-objektet — produsent og konsument er dermed
 * fortsatt enige om formatet fra samme kildekode, ikke fra en ny,
 * frittstående avtale.
 */

interface LayerHeaderPeek {
  readonly bitsPerSample: 8 | 10;
  readonly geometry: LayerGeometry;
}

/** Leser kun det som trengs for å regne ut et lags total byte-lengde — ingen full deserialisering. */
function peekLayerHeader(bytes: Uint8Array, byteOffset: number): LayerHeaderPeek {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + byteOffset,
    bytes.byteLength - byteOffset,
  );
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== WEATHER_LAYER_MAGIC) {
    throw new Error(
      `Ugyldig lag-magic "${magic}" ved byte-offset ${byteOffset} — forventet "${WEATHER_LAYER_MAGIC}"`,
    );
  }
  const bitsPerSample = view.getUint8(4) as 8 | 10;
  // roundingMode (5), channelKind (6) og deltaCoded-flagget (7) påvirker
  // ikke byte-lengden — hoppes bevisst over her.
  const geometry: LayerGeometry = {
    latMin: view.getFloat64(8, true),
    lonMin: view.getFloat64(16, true),
    latStepDeg: view.getFloat64(24, true),
    lonStepDeg: view.getFloat64(32, true),
    nodesLat: view.getUint32(40, true),
    nodesLon: view.getUint32(44, true),
    tileNodes: view.getUint32(48, true),
    t0S: view.getFloat64(52, true),
    dtS: view.getFloat64(60, true),
    timeSteps: view.getUint32(68, true),
  };
  return { bitsPerSample, geometry };
}

export interface LayerFrame {
  readonly layer: Layer;
  /** Antall byte dette laget faktisk opptok fra `byteOffset` — bruk til å finne neste lags startpunkt. */
  readonly byteLength: number;
}

/**
 * Leser ETT serialisert lag som starter ved `byteOffset` i `bytes`, og
 * rapporterer hvor mange byte det opptok. `bytes` kan være lengre enn ett
 * lag (flerlags-konkatenering, se toppkommentaren) — kun byte-vinduet dette
 * laget faktisk eier sendes videre til `deserializeLayer`.
 */
export function readLayerFrame(bytes: Uint8Array, byteOffset = 0): LayerFrame {
  const { bitsPerSample, geometry } = peekLayerHeader(bytes, byteOffset);
  const layout = computeSubtileLayout(geometry);
  const { totalBytes: byteLength } = layerByteLayout(layout, geometry.timeSteps, bitsPerSample);
  const frame = bytes.subarray(byteOffset, byteOffset + byteLength);
  const layer = deserializeLayer(frame);
  return { layer, byteLength };
}

/** Leser `count` sekvensielt konkatenerte lag fra starten av `bytes` (§15). */
export function readLayerFrames(bytes: Uint8Array, count: number): Layer[] {
  const layers: Layer[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const { layer, byteLength } = readLayerFrame(bytes, offset);
    layers.push(layer);
    offset += byteLength;
  }
  return layers;
}
