/**
 * Strøm og kystmaske som pakkelag (`docs/specs/strom-produsent.md` §3
 * «Pakkelag», invariant 6, §4 steg 5). Rene funksjoner: fra det regulære
 * gitteret (`current-geometry.ts`) til `buildLayer`/`serializeLayer`
 * (samme 8-bit, delta-kodede `Layer`-format som vind), sertifikat, full
 * rundtur-verifisering og pekeroppføringer.
 *
 * Strøm lagres som u/v MOT-retning i knop, `channelKind: "linear"`, aldri
 * fart/retning (§3). Kystmasken er ett lag med ett tidssteg og verdiene
 * 0/1 — én bit informasjon per node, lagret som 8-bit `Layer` for å bruke
 * samme ramme/serialisering/dekoder som resten av pakken (gzip tar
 * redundansen; ~10 kB rått per flis).
 */
import {
  buildLayer,
  buildLayerLookup,
  combineChannelDecodeErrorsKn,
  decodeCurrentAt,
  decodeLayerNode,
  computeSubtileLayout,
  layerMaxDecodeError,
  MAX_SUBTILE_NODES,
  readLayerFrames,
  serializeLayer,
  type CertifiedPackageHeader,
  type ClippedSample,
  type FieldCertificate,
  type Layer,
  type LayerGeometry,
} from "@morild/weather";
import type { SourceStatus } from "@morild/protocol";
import { contentHash, r2Key, type PointerFieldEntry } from "./package-writer.js";
import type { RegridResult, RegularComponentValues, RegularGridSpec } from "./current-geometry.js";

export const CURRENT_FIELD = "current";
export const CURRENT_COASTAL_FIELD = "current-coastal";
export const CURRENT_MODEL = "NorKyst-800";
export const CURRENT_RESOLUTION = "800m";

/** Geometri for et strømlag: det regulære gitteret + pakkens tidsakse (vindens t0S/dtS). */
export function currentLayerGeometry(spec: RegularGridSpec, t0S: number, dtS: number, timeSteps: number): LayerGeometry {
  return {
    latMin: spec.latMin,
    lonMin: spec.lonMin,
    latStepDeg: spec.latStepDeg,
    lonStepDeg: spec.lonStepDeg,
    nodesLat: spec.nodesLat,
    nodesLon: spec.nodesLon,
    tileNodes: MAX_SUBTILE_NODES,
    t0S,
    dtS,
    timeSteps,
  };
}

/**
 * `buildLayer`s `sample(lat, lon, epochS)` over VÅRT EGET regulære gitter.
 * Inversen `round((lat − latMin)/Δ)` er eksakt her fordi `buildLayer`
 * genererer lat/lon med nøyaktig den formelen fra nøyaktig denne
 * geometrien — dette er ikke et oppslag i kildens (y,x) (det skjedde i
 * `regridNearestSeaNode`, via haversine mot kildens lat/lon).
 */
function sampleRegular(
  geometry: LayerGeometry,
  values: RegularComponentValues,
): (lat: number, lon: number, epochS: number) => number | undefined {
  return (lat, lon, epochS) => {
    const i = Math.round((lat - geometry.latMin) / geometry.latStepDeg);
    const j = Math.round((lon - geometry.lonMin) / geometry.lonStepDeg);
    const k = Math.round((epochS - geometry.t0S) / geometry.dtS);
    if (i < 0 || j < 0 || k < 0 || i >= geometry.nodesLat || j >= geometry.nodesLon || k >= values.timeSteps) {
      return undefined;
    }
    const v = values.values[k * values.nodes + i * geometry.nodesLon + j]!;
    return Number.isNaN(v) ? undefined : v;
  };
}

export interface CurrentLayerBuild {
  readonly uLayer: Layer;
  readonly vLayer: Layer;
  /** Serialisert u-lag etterfulgt av v-lag (samme ramming som vind-medlemmer). */
  readonly payload: Uint8Array;
  readonly maxDecodeErrorKn: number;
  readonly clippedSamples: number;
}

export function buildCurrentLayers(args: {
  readonly geometry: LayerGeometry;
  readonly u: RegularComponentValues;
  readonly v: RegularComponentValues;
  readonly deltaCoded?: boolean;
  readonly onClip?: (channel: "u" | "v", info: ClippedSample) => void;
}): CurrentLayerBuild {
  let clippedSamples = 0;
  const onClip =
    (channel: "u" | "v") =>
    (info: ClippedSample): void => {
      clippedSamples++;
      args.onClip?.(channel, info);
    };
  const common = { geometryBase: args.geometry, bitsPerSample: 8 as const, roundingMode: "nearest" as const, channelKind: "linear" as const };
  const uLayer = buildLayer({ ...common, sample: sampleRegular(args.geometry, args.u), onClip: onClip("u") });
  const vLayer = buildLayer({ ...common, sample: sampleRegular(args.geometry, args.v), onClip: onClip("v") });
  const deltaCoded = args.deltaCoded ?? true;
  const uBytes = serializeLayer(uLayer, { deltaCoded });
  const vBytes = serializeLayer(vLayer, { deltaCoded });
  const payload = new Uint8Array(uBytes.length + vBytes.length);
  payload.set(uBytes, 0);
  payload.set(vBytes, uBytes.length);
  return {
    uLayer,
    vLayer,
    payload,
    maxDecodeErrorKn: combineChannelDecodeErrorsKn(layerMaxDecodeError(uLayer), layerMaxDecodeError(vLayer)),
    clippedSamples,
  };
}

/** Kystmasken som ett lag: ett tidssteg (`t0S`), verdier 0/1, aldri sentinel. */
export function buildCoastalMaskLayer(regrid: RegridResult, t0S: number, dtS: number): { readonly layer: Layer; readonly payload: Uint8Array } {
  const geometry = currentLayerGeometry(regrid.spec, t0S, dtS, 1);
  const layer = buildLayer({
    geometryBase: geometry,
    bitsPerSample: 8,
    roundingMode: "nearest",
    channelKind: "linear",
    sample: (lat, lon) => {
      const i = Math.round((lat - geometry.latMin) / geometry.latStepDeg);
      const j = Math.round((lon - geometry.lonMin) / geometry.lonStepDeg);
      if (i < 0 || j < 0 || i >= geometry.nodesLat || j >= geometry.nodesLon) return undefined;
      return regrid.coastal[i * geometry.nodesLon + j]!;
    },
  });
  return { layer, payload: serializeLayer(layer, { deltaCoded: true }) };
}

// --- Rundtur (spec §4 steg 5, §5) ------------------------------------------------

export interface CurrentRoundTripReport {
  readonly checkedSamples: number;
  readonly maxErrorUKn: number;
  readonly maxErrorVKn: number;
  /** Kildeverdi definert men dekodet sentinel, eller omvendt — skal alltid være 0. */
  readonly sentinelMismatches: number;
  /** Kystmaske-noder der dekodet bit ≠ produsert bit — skal alltid være 0. */
  readonly maskMismatches: number;
  readonly withinBudget: boolean;
}

/**
 * Dekoder den SERIALISERTE nyttelasten (ikke in-memory-lagene) og
 * sammenligner ALLE noder × tidssteg mot kildeverdiene i knop: feil per
 * kanal ≤ lagets analytiske skranke, og sentinel ⇔ sentinel. Kystmasken
 * sjekkes bit for bit. Et brudd ⇒ kalleren feiler bygget (ingen halv pakke).
 */
export function verifyCurrentRoundTrip(args: {
  readonly payload: Uint8Array;
  readonly maskPayload: Uint8Array;
  readonly u: RegularComponentValues;
  readonly v: RegularComponentValues;
  readonly coastal: Uint8Array;
}): CurrentRoundTripReport {
  const [uLayer, vLayer] = readLayerFrames(args.payload, 2);
  const [maskLayer] = readLayerFrames(args.maskPayload, 1);
  if (uLayer === undefined || vLayer === undefined || maskLayer === undefined) {
    throw new Error("verifyCurrentRoundTrip: kunne ikke lese lagrammene tilbake");
  }
  const g = uLayer.geometry;
  const uLayout = computeSubtileLayout(uLayer.geometry);
  const vLayout = computeSubtileLayout(vLayer.geometry);
  const uBudget = layerMaxDecodeError(uLayer) + 1e-9;
  const vBudget = layerMaxDecodeError(vLayer) + 1e-9;
  let checkedSamples = 0;
  let maxErrorUKn = 0;
  let maxErrorVKn = 0;
  let sentinelMismatches = 0;
  const nodes = g.nodesLat * g.nodesLon;
  for (let k = 0; k < g.timeSteps; k++) {
    for (let i = 0; i < g.nodesLat; i++) {
      for (let j = 0; j < g.nodesLon; j++) {
        const n = i * g.nodesLon + j;
        const su = args.u.values[k * nodes + n]!;
        const sv = args.v.values[k * nodes + n]!;
        const du = decodeLayerNode(uLayer, uLayout, i, j, k);
        const dv = decodeLayerNode(vLayer, vLayout, i, j, k);
        if (Number.isNaN(su) !== (du === undefined) || Number.isNaN(sv) !== (dv === undefined)) {
          sentinelMismatches++;
          continue;
        }
        if (du === undefined || dv === undefined) continue;
        checkedSamples++;
        maxErrorUKn = Math.max(maxErrorUKn, Math.abs(du - su));
        maxErrorVKn = Math.max(maxErrorVKn, Math.abs(dv - sv));
      }
    }
  }
  const maskLayout = computeSubtileLayout(maskLayer.geometry);
  let maskMismatches = 0;
  for (let i = 0; i < g.nodesLat; i++) {
    for (let j = 0; j < g.nodesLon; j++) {
      const bit = (decodeLayerNode(maskLayer, maskLayout, i, j, 0) ?? Number.NaN) > 0.5 ? 1 : 0;
      if (bit !== args.coastal[i * g.nodesLon + j]) maskMismatches++;
    }
  }
  return {
    checkedSamples,
    maxErrorUKn,
    maxErrorVKn,
    sentinelMismatches,
    maskMismatches,
    withinBudget: maxErrorUKn <= uBudget && maxErrorVKn <= vBudget && sentinelMismatches === 0 && maskMismatches === 0,
  };
}

/**
 * Dekodet via klientens egen bilineære vei (`decodeCurrentAt`) i et
 * punkt — til fasit-sjekker (Drøbaksund/Hvaler) og byggerapporten.
 */
export function decodeCurrentFromPayload(payload: Uint8Array, lat: number, lon: number, epochS: number) {
  const [uLayer, vLayer] = readLayerFrames(payload, 2);
  if (uLayer === undefined || vLayer === undefined) throw new Error("decodeCurrentFromPayload: mangler lag");
  return decodeCurrentAt({ u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) }, lat, lon, epochS);
}

// --- Header og peker ---------------------------------------------------------------

/** Kystmaskens regel, logget i headeren (spec §3 invariant 6: «nøyaktig tall = konstant, logget i headeren»). */
export interface CoastalMaskRule {
  readonly extensionCells: number;
  readonly fillProximityCells: number;
  readonly rule: string;
}

export interface CoastalMaskHeader extends CertifiedPackageHeader {
  readonly coastalMask: CoastalMaskRule;
}

export interface CurrentPointerEntries {
  readonly current: PointerFieldEntry;
  readonly coastal: PointerFieldEntry;
  readonly currentHash: string;
  readonly coastalHash: string;
}

export function currentPointerEntries(args: {
  readonly formatVersion: string;
  readonly producedAt: string;
  readonly init: string;
  readonly sourceStatus: SourceStatus;
  readonly currentPayload: Uint8Array;
  readonly maskPayload: Uint8Array;
  readonly maxDecodeErrorKn: number;
  readonly clippedSamples: number;
  readonly regrid: RegridResult;
}): CurrentPointerEntries {
  const base = {
    formatVersion: args.formatVersion,
    producedAt: args.producedAt,
    model: CURRENT_MODEL,
    init: args.init,
    resolution: CURRENT_RESOLUTION,
    sourceStatus: args.sourceStatus,
  };
  // Strøm har ingen retningsskranke i sertifikatet (spec §3: strøm lagres
  // kun som komponenter) — `maxDirectionErrorDeg` utelates bevisst.
  const currentCertificate: FieldCertificate = {
    maxDecodeErrorKn: args.maxDecodeErrorKn,
    clippedSamples: args.clippedSamples,
    referenceInit: args.init,
    verifiedAt: args.producedAt,
  };
  const currentHeader: CertifiedPackageHeader = { ...base, certificate: currentCertificate };
  const maskHeader: CoastalMaskHeader = {
    ...base,
    certificate: { clippedSamples: 0, referenceInit: args.init, verifiedAt: args.producedAt },
    coastalMask: {
      extensionCells: args.regrid.extensionCells,
      fillProximityCells: args.regrid.fillProximityCells,
      rule:
        "1 = verdien er lånt fra nærmeste native sjønode (kystkant-forlengelse) ELLER noden ligger innenfor " +
        "fillProximityCells native celler fra en fill-celle; et punkt er kystsone hvis ett av de bilineære hjørnene med positiv vekt er 1",
    },
  };
  const currentHash = contentHash(args.currentPayload);
  const coastalHash = contentHash(args.maskPayload);
  return {
    current: { field: CURRENT_FIELD, member: 0, key: r2Key(args.formatVersion, currentHash), hash: currentHash, header: currentHeader },
    coastal: { field: CURRENT_COASTAL_FIELD, member: 0, key: r2Key(args.formatVersion, coastalHash), hash: coastalHash, header: maskHeader },
    currentHash,
    coastalHash,
  };
}
