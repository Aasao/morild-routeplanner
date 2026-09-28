/**
 * Feltmodell — den kvantiserte, residente representasjonen dekodet per
 * oppslag (`docs/specs/vaerpakker.md` §9.7, §15): bilineær i rom, lineær i
 * tid, i **komponentrommet** for vind (§3 punkt 4–5) — konvertering til
 * `WindSample` skjer som SISTE steg, aldri før interpolasjonen.
 *
 * Denne fila eier lag-nivå-dekoding (`WindMemberLayers`, `CurrentLayers`,
 * `WaveLayers`) og unntaksveien (`decodeAllNodesAtTimestep`,
 * `DecodeAllBudget`). Selve pakke-samlingen (`WeatherPackage`: ett
 * kontrollmedlem + 29 ensemble-medlemmer for vind — medlemshorisont 48 t,
 * kontroll full horisont, §9.1 pkt. 4 — delt strøm og delte bølger, pluss
 * per-felt `PackageHeader`, §5) bor i `weather-field-adapter.ts`, sammen
 * med `toWeatherField`.
 */
import { norm360 } from "@morild/geo";
import {
  computeSubtileLayout,
  decodeLayerNode,
  layerMaxDecodeError,
  readLayerFrames,
  type Layer,
  type SubtileLayout,
} from "./package-format.js";
import { combineChannelDecodeErrorsKn, uvToWind, type DecodedWind } from "./wind-codec.js";
import type { CurrentSample, WaveSample, WindSample } from "./samples.js";

export interface LayerLookup {
  readonly layer: Layer;
  readonly layout: SubtileLayout;
}

export function buildLayerLookup(layer: Layer): LayerLookup {
  return { layer, layout: computeSubtileLayout(layer.geometry) };
}

/**
 * Bilineær rom + lineær tid, generisk over kanaltype (`linear`/`angle`).
 * `undefined` hvis lat/lon/tid faller utenfor lagets dekning, ELLER hvis en
 * av de (inntil åtte) nabonodene med positiv vekt mangler data (sentinel) —
 * vi ekstrapolerer aldri (N2), og vi later aldri som en manglende nabo er
 * uviktig bare fordi vekten er liten.
 */
export function decodeLayerAt(
  lookup: LayerLookup,
  lat: number,
  lon: number,
  epochS: number,
): number | undefined {
  const { layer, layout } = lookup;
  const g = layer.geometry;
  const fi = (lat - g.latMin) / g.latStepDeg;
  const fj = (lon - g.lonMin) / g.lonStepDeg;
  const fk = (epochS - g.t0S) / g.dtS;
  if (!(fi >= 0) || fi > g.nodesLat - 1) return undefined;
  if (!(fj >= 0) || fj > g.nodesLon - 1) return undefined;
  if (!(fk >= 0) || fk > g.timeSteps - 1) return undefined;

  const i0 = Math.floor(fi);
  const j0 = Math.floor(fj);
  const k0 = Math.floor(fk);
  const wi = fi - i0;
  const wj = fj - j0;
  const wk = fk - k0;

  const isAngle = layer.channelKind === "angle";
  let sum = 0;
  let sumSin = 0;
  let sumCos = 0;

  for (let dk = 0; dk <= 1; dk++) {
    const tw = dk === 0 ? 1 - wk : wk;
    if (tw === 0) continue;
    for (let di = 0; di <= 1; di++) {
      const iw = di === 0 ? 1 - wi : wi;
      if (iw === 0) continue;
      for (let dj = 0; dj <= 1; dj++) {
        const jw = dj === 0 ? 1 - wj : wj;
        if (jw === 0) continue;
        const w = tw * iw * jw;
        const v = decodeLayerNode(layer, layout, i0 + di, j0 + dj, k0 + dk);
        if (isAngle) {
          const rad = v === undefined ? Number.NaN : (v * Math.PI) / 180;
          sumSin += w * Math.sin(rad);
          sumCos += w * Math.cos(rad);
        } else {
          sum += w * (v ?? Number.NaN);
        }
      }
    }
  }

  if (isAngle) {
    if (Number.isNaN(sumSin) || Number.isNaN(sumCos)) return undefined;
    return norm360((Math.atan2(sumSin, sumCos) * 180) / Math.PI);
  }
  return Number.isNaN(sum) ? undefined : sum;
}

// ------------------------------------------------------------------- vind

export interface WindMemberLayers {
  readonly u: LayerLookup;
  readonly v: LayerLookup;
}

/**
 * Dekoder vind ved ett punkt. **Interpolasjon skjer i u/v-komponentrommet
 * (to uavhengige `decodeLayerAt`-kall), `uvToWind` er det ALLER siste
 * steget** (§3 punkt 4–5, §9.1) — akkurat slik `uv-modus` i
 * `packages/routing/test-fixtures/pack-degradation.ts` gjør det.
 */
export function decodeWindAt(
  member: WindMemberLayers,
  lat: number,
  lon: number,
  epochS: number,
): WindSample | undefined {
  const u = decodeLayerAt(member.u, lat, lon, epochS);
  if (u === undefined) return undefined;
  const v = decodeLayerAt(member.v, lat, lon, epochS);
  if (v === undefined) return undefined;
  const wind: DecodedWind = uvToWind(u, v);
  return wind;
}

/**
 * Deler opp ETT vind-medlems R2-blob (u-lagets serialiserte bytes
 * etterfulgt av v-lagets, konkatenert — `tools/weather-pack`s
 * `buildWindMemberPackage`) til et `WindMemberLayers` klart for
 * `decodeWindAt`/`toWeatherField` (`weather-field-adapter.ts`). Klientens
 * standard inngangspunkt for et nedlastet vind-medlem (§15): kalleren gir
 * den mottatte `ArrayBuffer`/`Uint8Array` rett inn, ingen mellomliggende
 * full dekoding skjer her — kun rammedeling (`readLayerFrames`) og
 * `buildLayerLookup`, begge O(1) i datastørrelsen (kun header/indeks leses
 * eagerly, selve nyttelasten forblir kvantisert og udekodet).
 */
export function windMemberLayersFromBytes(bytes: Uint8Array): WindMemberLayers {
  const [uLayer, vLayer] = readLayerFrames(bytes, 2);
  if (uLayer === undefined || vLayer === undefined) {
    throw new Error("windMemberLayersFromBytes: forventet to konkatenerte lag (u, v)");
  }
  return { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) };
}

// ------------------------------------------------------------------- strøm

export interface CurrentLayers {
  readonly u: LayerLookup;
  readonly v: LayerLookup;
}

/**
 * Strøm dekodes SOM komponenter — ingen konvertering til fart+retning
 * noensinne (§3: strøm er additiv med båtfart som vektor). `atan2` kalles
 * aldri på disse komponentene.
 */
export function decodeCurrentAt(
  layers: CurrentLayers,
  lat: number,
  lon: number,
  epochS: number,
): CurrentSample | undefined {
  const u = decodeLayerAt(layers.u, lat, lon, epochS);
  if (u === undefined) return undefined;
  const v = decodeLayerAt(layers.v, lat, lon, epochS);
  if (v === undefined) return undefined;
  return { u, v };
}

/**
 * Deler opp strømblobben (u-lag etterfulgt av v-lag, samme ramming som et
 * vind-medlem — `tools/weather-pack/src/current-package.ts`) til
 * `CurrentLayers`. Kun rammedeling og `buildLayerLookup`; nyttelasten
 * forblir kvantisert (§15).
 */
export function currentLayersFromBytes(bytes: Uint8Array): CurrentLayers {
  const [uLayer, vLayer] = readLayerFrames(bytes, 2);
  if (uLayer === undefined || vLayer === undefined) {
    throw new Error("currentLayersFromBytes: forventet to konkatenerte lag (u, v)");
  }
  return { u: buildLayerLookup(uLayer), v: buildLayerLookup(vLayer) };
}

// ------------------------------------------------------------- kystmaske

/**
 * Kystmasken for strøm (`docs/specs/strom-produsent.md` §3 invariant 6,
 * D15.2): ett statisk lag (ett tidssteg) på strømmens regulære gitter,
 * verdier 0/1. 1 ⇒ nodens strømverdi er lånt fra nærmeste sjønode
 * (kystkant-forlengelse) eller noden ligger nær land i 800 m-modellen.
 */
export type CoastalMaskLayer = LayerLookup;

/** Verdier over denne regnes som merket (lagret 0/1, kvantisert 8-bit). */
export const COASTAL_MASK_THRESHOLD = 0.5;

export function coastalMaskFromBytes(bytes: Uint8Array): CoastalMaskLayer {
  const [layer] = readLayerFrames(bytes, 1);
  if (layer === undefined) {
    throw new Error("coastalMaskFromBytes: forventet ett lag (kystmasken)");
  }
  return buildLayerLookup(layer);
}

/**
 * **Hjørneregelen** (spec §3 invariant 6): et punkt er kystsone hvis ett av
 * de bilineære hjørnene er merket — nøyaktig de hjørnene `decodeLayerAt`
 * ville brukt for strømmen i samme punkt (positiv vekt), slik at merkingen
 * dekker akkurat de nodene strømverdien faktisk kommer fra. Tid ignoreres
 * (masken er statisk). Utenfor maskens dekning ⇒ `false` — da er strømmen
 * der også `undefined`, og det flagges som manglende data, ikke som kyst.
 * En sentinel i masken (skal ikke forekomme) regnes som merket.
 */
export function decodeCoastalMaskAt(mask: CoastalMaskLayer, lat: number, lon: number): boolean {
  const { layer, layout } = mask;
  const g = layer.geometry;
  const fi = (lat - g.latMin) / g.latStepDeg;
  const fj = (lon - g.lonMin) / g.lonStepDeg;
  if (!(fi >= 0) || fi > g.nodesLat - 1) return false;
  if (!(fj >= 0) || fj > g.nodesLon - 1) return false;
  const i0 = Math.floor(fi);
  const j0 = Math.floor(fj);
  const wi = fi - i0;
  const wj = fj - j0;
  for (let di = 0; di <= 1; di++) {
    const iw = di === 0 ? 1 - wi : wi;
    if (iw === 0) continue;
    for (let dj = 0; dj <= 1; dj++) {
      const jw = dj === 0 ? 1 - wj : wj;
      if (jw === 0) continue;
      const v = decodeLayerNode(layer, layout, i0 + di, j0 + dj, 0);
      if (v === undefined || v > COASTAL_MASK_THRESHOLD) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ bølger

export interface WaveLayers {
  readonly hs: LayerLookup;
  readonly tp?: LayerLookup;
  readonly dir?: LayerLookup;
}

/**
 * Hs mangler ⇒ hele returverdien er `undefined` (§12: "vi vet ingenting om
 * sjøgangen"). Hs finnes, Tp/retning mangler ⇒ objektet returneres med de
 * feltene utelatt — en svakere, eksplisitt degradering, ikke samme flagg.
 */
export function decodeWavesAt(
  layers: WaveLayers,
  lat: number,
  lon: number,
  epochS: number,
): WaveSample | undefined {
  const hsM = decodeLayerAt(layers.hs, lat, lon, epochS);
  if (hsM === undefined) return undefined;
  const out: { hsM: number; tpS?: number; fromDeg?: number } = {
    hsM: Math.max(0, hsM),
  };
  if (layers.tp !== undefined) {
    const tpS = decodeLayerAt(layers.tp, lat, lon, epochS);
    if (tpS !== undefined) out.tpS = tpS;
  }
  if (layers.dir !== undefined) {
    const fromDeg = decodeLayerAt(layers.dir, lat, lon, epochS);
    if (fromDeg !== undefined) out.fromDeg = fromDeg;
  }
  return out as WaveSample;
}

// ------------------------------------------------------ unntaksvei (§9.7)

/**
 * Full dekoding av ETT tidssteg i ett lag — unntaksveien for profilert
 * ytelsesbehov (§9.7, §15 pkt. 3). Standardveien er `decodeLayerAt`/
 * `decodeWindAt` osv.; denne finnes for målt flaskehals, ikke som
 * standard.
 */
export function decodeAllNodesAtTimestep(layer: Layer, k: number): Float32Array {
  const { geometry } = layer;
  const layout = computeSubtileLayout(geometry);
  const out = new Float32Array(geometry.nodesLat * geometry.nodesLon);
  for (let i = 0; i < geometry.nodesLat; i++) {
    for (let j = 0; j < geometry.nodesLon; j++) {
      const v = decodeLayerNode(layer, layout, i, j, k);
      out[i * geometry.nodesLon + j] = v ?? Number.NaN;
    }
  }
  return out;
}

/**
 * **Dekode-og-slipp-taket** (§9.7, §17 pkt. 11): antall SAMTIDIG utestående
 * fulle `Float32Array`-kopier skal aldri overstige antall Web Worker-
 * tråder. Denne klassen er ikke en cache — den er en teller/vakt som
 * kaster hvis noen glemmer å slippe en kopi før de ber om en ny, utover
 * taket.
 */
export class DecodeAllBudget {
  private outstanding = 0;

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error("DecodeAllBudget: maxConcurrent må være ≥ 1");
    }
  }

  /** Reserverer én plass. Kaster hvis taket allerede er nådd. */
  acquire(): void {
    if (this.outstanding >= this.maxConcurrent) {
      throw new Error(
        `DecodeAllBudget: ${this.outstanding} fulle kopier er allerede ute — ` +
          `taket er ${this.maxConcurrent} (§9.7: aldri flere enn antall worker-tråder)`,
      );
    }
    this.outstanding++;
  }

  /** Frigir plassen — kall alltid i en `finally`. */
  release(): void {
    if (this.outstanding <= 0) {
      throw new Error("DecodeAllBudget: release() uten en tilhørende acquire()");
    }
    this.outstanding--;
  }

  get outstandingCount(): number {
    return this.outstanding;
  }
}

/** Dekode-og-slipp med automatisk `release`, selv ved kastet unntak. */
export function withDecodeAllBudget<T>(
  budget: DecodeAllBudget,
  layer: Layer,
  k: number,
  use: (decoded: Float32Array) => T,
): T {
  budget.acquire();
  try {
    return use(decodeAllNodesAtTimestep(layer, k));
  } finally {
    budget.release();
  }
}

// ----------------------------------------------------------- pakke-samling
//
// `WeatherPackage` (medlemslag + delt strøm/bølge) er definert i
// `weather-field-adapter.ts`, sammen med per-felt `PackageHeader` (§5) —
// ikke duplisert her.

/**
 * §9.5 punkt 2: `|hypot(u+du,v+dv) − hypot(u,v)| ≤ hypot(du,dv)` (omvendt
 * trekantulikhet). Med uavhengige per-kanal-skranker `uErr`/`vErr`
 * (u og v kan ha ulik skala hvis subflisens spenn er ulikt i de to
 * kanalene) er `hypot(uErr, vErr)` den TETTESTE gyldige skranken —
 * strammere enn, men aldri mindre konservativ enn, den symmetriske
 * `√2 · e`-formelen i `packages/routing/test-fixtures/pack-degradation.ts`
 * (som antar samme trinn i begge kanaler). Selve hypot-kombinasjonen er
 * faktorisert ut som `wind-codec.ts::combineChannelDecodeErrorsKn` — den
 * ENE bindende utledningen, delt med `index.ts::computeMaxDecodeErrorKn`
 * (review-funn 3) slik at de to aldri kan drifte fra hverandre igjen.
 */
export function windLayerMaxDecodeErrorKn(member: WindMemberLayers): number {
  const uErr = layerMaxDecodeError(member.u.layer);
  const vErr = layerMaxDecodeError(member.v.layer);
  return combineChannelDecodeErrorsKn(uErr, vErr);
}

/**
 * **Deklarert maksimum, regnet på DEKODEDE verdier** (`docs/specs/vaerpakker.md`
 * §9.5 siste avsnitt): kvantisering kan løfte en dekodet verdi opptil et
 * halvt trinn over kildens nominelle maksimum. Valg (a) i spec-en — regn
 * det observerte maksimumet i det faktiske kvantiserte feltet — foretrekkes
 * fremfor å legge til et halvt trinn på kildens deklarerte maksimum, fordi
 * det ikke krever noen antakelse om trinnstørrelse.
 *
 * Dette er ÉN full skann over laget (alle noder × alle tidssteg), gjort ÉN
 * gang ved pakke-lasting (`weather-field-adapter.ts`), ikke per rutesøk og
 * ikke per oppslag — konsistent med §9.7s "per-oppslag er standard, full
 * dekoding er unntaket for PROFILERT ytelsesbehov": dette er ikke et
 * ytelsestiltak, det er en engangs lasteberegning uten noe raskere
 * alternativ (skala/offset alene forteller ikke hva MAX HYPOT(u,v) er,
 * siden det maksimale for hver kanal ikke nødvendigvis inntreffer i samme
 * node).
 */
export function computeObservedMaxSpeedKn(uLayer: Layer, vLayer: Layer): number {
  const g = uLayer.geometry;
  const uLayout = computeSubtileLayout(uLayer.geometry);
  const vLayout = computeSubtileLayout(vLayer.geometry);
  let max = 0;
  for (let k = 0; k < g.timeSteps; k++) {
    for (let i = 0; i < g.nodesLat; i++) {
      for (let j = 0; j < g.nodesLon; j++) {
        const u = decodeLayerNode(uLayer, uLayout, i, j, k);
        const v = decodeLayerNode(vLayer, vLayout, i, j, k);
        if (u === undefined || v === undefined) continue;
        const speed = Math.hypot(u, v);
        if (speed > max) max = speed;
      }
    }
  }
  return max;
}
