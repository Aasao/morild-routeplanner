/**
 * **Avkortet baklengs havnefelt** (D8.10; `docs/specs/robusthet.md` §3.5 og
 * §4.5 pkt. 1; `docs/specs/rutemotor.md` §5.14).
 *
 * Uten dette feltet koster bail-out-profilen 4–12 minutter per medlem
 * (panelets måling, robusthet.md §6.1): hvert samplet punkt langs ruten måtte
 * kjørt ett fullt R2-søk per havn i boken. Feltet er forfilteret som gjør
 * F4.6 gjennomførbar: én Dijkstra per havn, væruavhengig, gjenbrukt for alle
 * avganger, alle medlemmer og alle punkter langs alle ruter.
 *
 * **Sikkerhetskravet er admissibilitet, og det er ensidig.** Feltet gir en
 * NEDRE skranke for tiden til havnen:
 *
 *     lowerBoundS(p) = D(p) · 3600 / vmaxKn
 *
 * der `D` er vannavstand og `vmaxKn` er en øvre skranke for farten båten kan
 * gjøre noe sted i pakken. Da gjelder:
 *
 *  - `lowerBoundS > R2_LIMIT_S` ⇒ havnen kan ikke nås innen skranken, og
 *    R2-søket kan hoppes over. Dette er den eneste konklusjonen feltet har
 *    lov til å trekke.
 *  - `lowerBoundS ≤ R2_LIMIT_S` beviser **ingenting**. Havnen kan være
 *    stengt av vær, dybde, mørke eller rett og slett ikke være nåbar i tide.
 *    Da kjøres det ekte søket.
 *
 * Med andre ord: feltet kan bare spare arbeid, aldri gjøre en havn
 * utilgjengelig som faktisk var innen rekkevidde. Snur den retningen seg —
 * f.eks. ved at noen «strammer» skranken for å spare flere søk — blir
 * bail-out-profilen en løgn i den farligste retningen: «ingen havn innen 6 t»
 * der det fantes en. `harbour-field.test.ts` (§5.6) holder retningen fast med
 * 200 seedede punkter.
 *
 * **Hvorfor Float32 her, når `distance-field.ts` krever Float64.**
 * A\*-feltets Float32-bug (foreldede celler ved pop) oppstår fordi
 * heap-prioriteten regnes i dobbel presisjon mens den lagrede verdien
 * avrundes. Her regnes **hele Dijkstraen i Float64** internt; Float32 er kun
 * *lagringsformatet* på det ferdige feltet (§3.5: ~0,3 MB per havn, delt som
 * transferable ArrayBuffer). Konverteringen runder alltid NEDOVER
 * (`froundDown`), slik at den lagrede verdien aldri kan bli større enn den
 * beregnede — samme ensidighet som resten av filen.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 */
import type { LatLon } from "@morild/geo";
import { haversineNm } from "@morild/geo";
import { R2_LIMIT_S, r2VmaxKn } from "./bailout.js";
import type { BoatModel, FieldEdgeGate, NavigabilityMask, WeatherField } from "./contracts.js";
import { maskAsEdgeGate, OPEN_EDGE_GATE } from "./contracts.js";
import { MinHeap } from "./heap.js";

export interface BBox {
  readonly latMin: number;
  readonly lonMin: number;
  readonly latMax: number;
  readonly lonMax: number;
}

/**
 * Havnefeltet, som ren og klonbar data — samme overføringsform som
 * `DistanceFieldData`: et objekt med tall og én typed array, hvis `buffer`
 * kan listes som transferable i `postMessage`. Ingen `SharedArrayBuffer`.
 *
 * `maskVersion` er en del av identiteten: feltet er en funksjon av
 * (havn-id, maskeversjon, oppløsning) og skal bygges på nytt når masken
 * bygges på nytt.
 */
export interface HarbourField {
  readonly harbourId: string;
  readonly maskVersion: string;
  readonly cellDeg: number;
  readonly bbox: BBox;
  readonly width: number;
  readonly height: number;
  /** Vannavstand fra havnen i nm per celle, `Infinity` utenfor rekkevidde. */
  readonly distanceNm: Float32Array;
  /** Øvre fartsskranke feltet skal tolkes med. */
  readonly vmaxKn: number;
  /** Skranken feltet er avkortet ved (sekunder). */
  readonly limitS: number;
  /** Antall celler Dijkstraen faktisk nådde. `0` ⇒ havnen står på land i masken. */
  readonly reachedCells: number;
}

export interface HarbourFieldSource {
  readonly id: string;
  readonly position: LatLon;
}

export interface HarbourFieldOptions {
  /** Øvre fartsskranke i knop: maks polarfart + maks strøm i pakken. */
  readonly vmaxKn: number;
  /** Oppløsning i grader. Standard som A\*-feltets, 0,01°. */
  readonly cellDeg?: number;
  /** Skranken. Standard `R2_LIMIT_S` (6 t). */
  readonly limitS?: number;
  /** Identiteten til masken feltet bygges over. */
  readonly maskVersion?: string;
  /** Tak på antall celler; oppløsningen grovnes til den passer. */
  readonly maxCells?: number;
}

export const DEFAULT_HARBOUR_FIELD_CELL_DEG = 0.01;
export const DEFAULT_HARBOUR_FIELD_MAX_CELLS = 250_000;

/**
 * Største forhold mellom lengden av en 8-nabo-gridvei og den rette linjen den
 * tilnærmer: `√(4 − 2√2) ≈ 1,0824` (verst ved 22,5°).
 *
 * Gridveien er alltid **minst** like lang som den rette linjen, så rå
 * `D`-verdier OVERESTIMERER avstanden med inntil 8,3 % — feil retning for en
 * nedre skranke. `lowerBoundNm` deler derfor på denne faktoren.
 */
export const OCTILE_MAX_RATIO = Math.sqrt(4 - 2 * Math.sqrt(2));

/**
 * Runder til nærmeste float32 **nedover**: resultatet er aldri større enn
 * `v`. Uten dette kunne lagringen løftet en avstand med en halv ULP, og den
 * nedre skranken vært en anelse for høy.
 */
export function froundDown(v: number): number {
  if (!Number.isFinite(v)) return v;
  const f = Math.fround(v);
  if (f <= v) return f;
  // Ett float32-ULP ned. `2 ** -23` er relativ ULP-størrelse for float32.
  return Math.fround(v - Math.abs(v) * 2 ** -23);
}

/** Cellesenteret for (ix, iy). */
function centerOf(
  latMin: number,
  lonMin: number,
  cellDeg: number,
  ix: number,
  iy: number,
): LatLon {
  return {
    lat: latMin + (iy + 0.5) * cellDeg,
    lon: lonMin + (ix + 0.5) * cellDeg,
  };
}

/** Cellens diagonal i nm, regnet der den er størst (lavest |lat| i boksen). */
function cellDiagonalNm(bbox: BBox, cellDeg: number): number {
  const lat =
    Math.abs(bbox.latMin) < Math.abs(bbox.latMax) ? bbox.latMin : bbox.latMax;
  const dLatNm = cellDeg * 60;
  const dLonNm = cellDeg * 60 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLatNm, dLonNm);
}

/**
 * Bygger det avkortede feltet fra havnen.
 *
 * Boksen er nøyaktig rekkevidden `vmaxKn · limitS/3600` i alle retninger:
 * lenger unna er svaret uansett «ikke innen skranken», og en større boks er
 * bortkastet minne. Dijkstraen stopper i tillegg på selve avstanden, slik at
 * hjørnene av boksen ikke fylles.
 *
 * `mask === undefined` ⇒ åpen sjø (samme regel som motoren ellers, §6):
 * feltet blir da ren geometri, og siler kun på avstand.
 */
/**
 * Samme admissibilitetsmargin som søkemotorens restestimat (`search.ts`,
 * `+ 0.3` kn): polarens topp kan ligge mellom to 5°-samples i `r2VmaxKn`,
 * og feltets skranke er kun trygg hvis `vmaxKn` er en ekte øvre grense
 * (review-funn bølge 4, sikkerhet). Alle havnefelt bygges med denne.
 */
export const HARBOUR_FIELD_VMAX_MARGIN_KN = 0.3;

/** Øvre fartsskranke for havnefeltet: `r2VmaxKn` + admissibilitetsmarginen. */
export function harbourFieldVmaxKn(boat: BoatModel, weather: WeatherField): number {
  return r2VmaxKn(boat, weather) + HARBOUR_FIELD_VMAX_MARGIN_KN;
}

export function buildHarbourField(
  harbour: HarbourFieldSource,
  mask: NavigabilityMask | undefined,
  options: HarbourFieldOptions,
): HarbourField {
  const limitS = options.limitS ?? R2_LIMIT_S;
  const vmaxKn = options.vmaxKn;
  if (!(vmaxKn > 0) || !Number.isFinite(vmaxKn)) {
    throw new Error(
      `buildHarbourField: vmaxKn må være et endelig positivt tall (fikk ${vmaxKn})`,
    );
  }
  const reachNm = (vmaxKn * limitS) / 3600;
  const dLat = reachNm / 60;
  const cosLat = Math.max(0.05, Math.cos((harbour.position.lat * Math.PI) / 180));
  const dLon = reachNm / (60 * cosLat);

  const bbox0: BBox = {
    latMin: Math.max(-90, harbour.position.lat - dLat),
    latMax: Math.min(90, harbour.position.lat + dLat),
    lonMin: harbour.position.lon - dLon,
    lonMax: harbour.position.lon + dLon,
  };

  const maxCells = options.maxCells ?? DEFAULT_HARBOUR_FIELD_MAX_CELLS;
  let cellDeg = options.cellDeg ?? DEFAULT_HARBOUR_FIELD_CELL_DEG;
  let width = Math.max(2, Math.round((bbox0.lonMax - bbox0.lonMin) / cellDeg));
  let height = Math.max(2, Math.round((bbox0.latMax - bbox0.latMin) / cellDeg));
  if (width * height > maxCells) {
    cellDeg *= Math.sqrt((width * height) / maxCells);
    width = Math.max(2, Math.round((bbox0.lonMax - bbox0.lonMin) / cellDeg));
    height = Math.max(2, Math.round((bbox0.latMax - bbox0.latMin) / cellDeg));
  }
  const bbox: BBox = {
    latMin: bbox0.latMin,
    lonMin: bbox0.lonMin,
    latMax: bbox0.latMin + height * cellDeg,
    lonMax: bbox0.lonMin + width * cellDeg,
  };

  const gate: FieldEdgeGate =
    mask === undefined ? OPEN_EDGE_GATE : maskAsEdgeGate(mask);

  // Float64 under beregningen — se filhodet. Float32 kun ved lagring.
  const d = new Float64Array(width * height).fill(Infinity);
  const out = new Float32Array(width * height).fill(Infinity);

  const srcIx = Math.floor((harbour.position.lon - bbox.lonMin) / cellDeg);
  const srcIy = Math.floor((harbour.position.lat - bbox.latMin) / cellDeg);
  let reachedCells = 0;
  if (srcIx < 0 || srcIy < 0 || srcIx >= width || srcIy >= height) {
    // Kan ikke skje (havnen er boksens senter), men vi later ikke som det er
    // umulig: et tomt felt gir `Infinity` overalt, og profilen flagger det.
    return {
      harbourId: harbour.id,
      maskVersion: options.maskVersion ?? "ukjent",
      cellDeg,
      bbox,
      width,
      height,
      distanceNm: out,
      vmaxKn,
      limitS,
      reachedCells,
    };
  }

  const srcIdx = srcIy * width + srcIx;
  d[srcIdx] = 0;
  const heap = new MinHeap(Math.min(width * height, 1 << 14));
  heap.push(0, srcIdx);

  while (heap.length > 0) {
    const { priority, value: idx } = heap.pop();
    if (priority > d[idx]!) continue;
    reachedCells++;
    out[idx] = froundDown(priority);
    const iy = (idx / width) | 0;
    const ix = idx - iy * width;
    const here = centerOf(bbox.latMin, bbox.lonMin, cellDeg, ix, iy);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        const there = centerOf(bbox.latMin, bbox.lonMin, cellDeg, nx, ny);
        const nd = priority + haversineNm(here, there);
        // Avkortingen (D8.10): utenfor rekkevidden er svaret uansett
        // «ikke innen skranken», og cellen trenger ingen verdi.
        if (nd > reachNm) continue;
        if (nd >= d[nIdx]!) continue;
        if (!gate.edgeOpen(here.lat, here.lon, there.lat, there.lon)) continue;
        d[nIdx] = nd;
        heap.push(nd, nIdx);
      }
    }
  }

  return {
    harbourId: harbour.id,
    maskVersion: options.maskVersion ?? "ukjent",
    cellDeg,
    bbox,
    width,
    height,
    distanceNm: out,
    vmaxKn,
    limitS,
    reachedCells,
  };
}

/**
 * Rå cellemin over 3×3-nabolaget rundt punktet — `DistanceField.atNear`s
 * mønster, og av samme grunn: kandidatpunkter i skjærgård treffer ofte en
 * landcelle i et felt som er grovere enn masken, og uten nabolaget ville
 * feltet meldt `Infinity` («ingen havn») for et punkt som ligger én
 * cellebredde fra farbart vann. Retningen er trygg: minimum kan bare gjøre
 * skranken lavere.
 */
export function rawFieldDistanceNm(
  field: HarbourField,
  lat: number,
  lon: number,
): number {
  const ix = Math.floor((lon - field.bbox.lonMin) / field.cellDeg);
  const iy = Math.floor((lat - field.bbox.latMin) / field.cellDeg);
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = ix + dx;
      const ny = iy + dy;
      if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height) continue;
      const v = field.distanceNm[ny * field.width + nx]!;
      if (v < best) best = v;
    }
  }
  return best;
}

/**
 * **Admissibel nedre skranke for vannavstanden** fra punktet til havnen, i nm.
 *
 * To korreksjoner trekkes fra den rå gridavstanden, begge i «for lavt heller
 * enn for høyt»-retningen:
 *
 *  1. **Gridgeometri:** en 8-nabo-vei er inntil `OCTILE_MAX_RATIO` (8,3 %)
 *     lengre enn linjen den tilnærmer. Vi deler på faktoren.
 *  2. **Snapping:** både havnen og punktet er snappet til et cellesenter, og
 *     nabolagsminimet over kan hente en verdi halvannen celle unna. Vi
 *     trekker fra to celle-diagonaler.
 *
 * Det som IKKE kan korrigeres bort er at masken er diskretisert: et sund som
 * er smalere enn cellen finnes ikke i feltet, og avstanden rundt kan bli
 * lengre enn den ekte — eller `Infinity`. Det gir «ingen havn innen 6 t» der
 * det kanskje fantes en; pessimistisk, altså trygg retning for en advarsel,
 * men det er grunnen til at feltet aldri får si «havnen er nådd». Slakken fra
 * `vmaxKn` (maks polarfart + maks strøm, mot en båt som i praksis gjør en
 * brøkdel) er i tillegg stor nok til at diskretiseringen forsvinner i den;
 * §5.6-testen måler nettopp det på 200 punkter.
 */
export function lowerBoundNm(
  field: HarbourField,
  lat: number,
  lon: number,
): number {
  const raw = rawFieldDistanceNm(field, lat, lon);
  if (!Number.isFinite(raw)) return Infinity;
  const slackNm = 2 * cellDiagonalNm(field.bbox, field.cellDeg);
  return Math.max(0, raw / OCTILE_MAX_RATIO - slackNm);
}

/**
 * Nedre skranke for **tiden** til havnen i sekunder, `Infinity` når havnen
 * ikke er nåbar i feltet. `D · 3600 / vmaxKn` (§4.5 pkt. 1).
 */
export function lowerBoundS(
  field: HarbourField,
  p: LatLon,
): number {
  const nm = lowerBoundNm(field, p.lat, p.lon);
  if (!Number.isFinite(nm)) return Infinity;
  return (nm * 3600) / field.vmaxKn;
}
