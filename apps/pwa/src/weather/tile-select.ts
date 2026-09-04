/**
 * Hvilke av pekerens fliser (`docs/specs/vaerpakker.md` §7) en rute trenger.
 * Rene funksjoner — ren geometri, ingen I/O.
 *
 * **Rettet review-funn (fase 3 bølge 2, funn 2):** en tidligere versjon
 * brukte kun FØRSTE overlappende flis (etter pekerens rekkefølge) — en
 * dokumentert forenkling som viste seg gal: den ekte Skjæløy→Skagen-pakken
 * har TO fliser (5_28/5_29, delt ved 58°N-grensen,
 * `tools/weather-pack/src/build-live-package.ts`s `TARGET_TILES`), og
 * halve ruten mistet dermed vinddata stille. `tilesOverlapping` returnerer
 * ALLE fliser som overlapper ruteboksen; kalleren (`pipeline.ts`) laster
 * dem alle og syr dem sammen med `@morild/weather`s
 * `compositeWeatherField`.
 *
 * **Flisvalg-sikkerhetsregelen (D7.2, vedtatt 2026-09-04)** — se
 * `selectTilesForRoute` under. Ruteboksen alene er ikke lenger nok:
 * flissettet skal komme fra **A\*-vannavstandsfeltets rekkevidde**
 * (`@morild/routing`s `weatherTilesForField` — feltet er væruavhengig og
 * beregnes før søket), med endepunkt-bboksen + ≥ 0,5° som fallback når
 * feltet mangler. Grunnen står i `packages/routing/src/weather-tiles.ts`:
 * en manglende flis styrer ellers søket stille.
 */
import type { LatLon } from "@morild/geo";
import {
  padBounds,
  weatherTilesForBounds,
  weatherTilesForField,
  type DistanceField,
  type FieldTileBound,
  type WeatherTileRef,
} from "@morild/routing";
import type { PointerTileEntry, WeatherPointer } from "./pointer-types.js";

export type BBox = readonly [west: number, south: number, east: number, north: number];

export function boundingBoxOf(points: readonly LatLon[]): BBox {
  if (points.length === 0) {
    throw new Error("boundingBoxOf: tom punktliste");
  }
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return [west, south, east, north];
}

function bboxOverlaps(a: BBox, b: BBox): boolean {
  const [aw, as, ae, an] = a;
  const [bw, bs, be, bn] = b;
  return aw <= be && ae >= bw && as <= bn && an >= bs;
}

export function tilesOverlapping(pointer: WeatherPointer, bbox: BBox): readonly PointerTileEntry[] {
  return pointer.tiles.filter((tile) => bboxOverlaps(tile.bbox, bbox));
}

/**
 * ALLE fliser i pekeren som dekker en gitt rute (ruteboksens bbox). Tom
 * liste når ingen flis dekker ruten (N2: synlig, ikke skjult — kalleren
 * viser "ingen værdekning for dette området").
 */
export function tilesFor(pointer: WeatherPointer, points: readonly LatLon[]): readonly PointerTileEntry[] {
  return tilesOverlapping(pointer, boundingBoxOf(points));
}

/**
 * Flisstørrelsen i grader, lest ut av **pekeren selv** (§7-rutenettet er
 * kvadratisk, så bredden holder). 2° i dagens ekte pakke, 1° etter D7.1.
 *
 * Bevisst utledet og ikke hardkodet: klienten skal følge pakken, ikke en
 * konstant den tror på. Er pekeren tom, eller er flisene ikke på samme
 * rutenett, returneres `undefined` — kalleren faller da tilbake på den
 * geometriske overlappsregelen i stedet for å gjette et rutenett.
 */
export function tileSizeDegOf(pointer: WeatherPointer): number | undefined {
  const first = pointer.tiles[0];
  if (first === undefined) return undefined;
  const size = first.bbox[2] - first.bbox[0];
  if (!Number.isFinite(size) || size <= 0) return undefined;
  for (const tile of pointer.tiles) {
    const w = tile.bbox[2] - tile.bbox[0];
    const h = tile.bbox[3] - tile.bbox[1];
    if (Math.abs(w - size) > 1e-9 || Math.abs(h - size) > 1e-9) return undefined;
  }
  return size;
}

/** Hvilken regel flissettet ble valgt etter — bæres helt ut i UI-et (N2). */
export type TileSelectionRule =
  /** D7.2s hovedregel: A\*-feltets rekkevidde. */
  | "a-star-felt"
  /** Fallback: endepunkt-bboksen utvidet med ≥ 0,5°. */
  | "endepunkt-bbox"
  /**
   * Siste utvei: pekeren har ikke et gjenkjennelig flisrutenett, så
   * valget faller tilbake på ren bbox-overlapp mot pekerens egne fliser.
   * Da kan vi ikke navngi en manglende flis — bare rapportere at regelen
   * ikke kunne håndheves.
   */
  | "bbox-overlapp";

export interface TileSelection {
  readonly rule: TileSelectionRule;
  /** Flisene pekeren faktisk har, av dem regelen ba om. */
  readonly tiles: readonly PointerTileEntry[];
  /** Flis-ID-ene regelen ba om (deterministisk sortert). */
  readonly requiredTileIds: readonly string[];
  /**
   * Flis-ID-er regelen ba om, men pekeren ikke har. **Aldri stille:**
   * kalleren rapporterer dem, og motoren flagger uansett ruten med
   * `VAERDEKNING_BEGRENSET` hvis søket faktisk går inn i hullet.
   */
  readonly missingTileIds: readonly string[];
  readonly tileSizeDeg: number | undefined;
}

function contains(outer: BBox, inner: WeatherTileRef): boolean {
  const eps = 1e-9;
  return (
    outer[0] <= inner.west + eps &&
    outer[1] <= inner.south + eps &&
    outer[2] >= inner.east - eps &&
    outer[3] >= inner.north - eps
  );
}

function selectionFromRefs(
  pointer: WeatherPointer,
  refs: readonly WeatherTileRef[],
  rule: TileSelectionRule,
  tileSizeDeg: number,
): TileSelection {
  const tiles: PointerTileEntry[] = [];
  const missingTileIds: string[] = [];
  for (const ref of refs) {
    const covering = pointer.tiles.filter((tile) => contains(tile.bbox, ref));
    if (covering.length === 0) {
      missingTileIds.push(ref.id);
      continue;
    }
    for (const tile of covering) {
      if (!tiles.includes(tile)) tiles.push(tile);
    }
  }
  return {
    rule,
    tiles,
    requiredTileIds: refs.map((r) => r.id),
    missingTileIds,
    tileSizeDeg,
  };
}

/**
 * **Flisvalg-sikkerhetsregelen (D7.2).**
 *
 * 1. Har vi A\*-vannavstandsfeltet, utledes flissettet av feltets rekkevidde
 *    (`weatherTilesForField`) — den eneste geometrien som faktisk avgrenser
 *    hvor søket kan bevege seg.
 * 2. Mangler feltet, brukes endepunkt-bboksen utvidet med minst 0,5°
 *    (`padBounds`) — panelets «kontrollrute + ≥ 30 nm».
 * 3. Kan flisrutenettet ikke leses ut av pekeren, faller vi tilbake på ren
 *    overlapp mot pekerens egne fliser, og sier eksplisitt fra om at regelen
 *    ikke kunne håndheves (`rule: "bbox-overlapp"`).
 *
 * Manglende fliser er **aldri** en stille avvisning: de kommer ut i
 * `missingTileIds`, og motoren flagger dessuten ruten (`VAERDEKNING_BEGRENSET`)
 * hvis søket faktisk pruner etiketter i hullet. Forsvar i dybden.
 */
export function selectTilesForRoute(
  pointer: WeatherPointer,
  points: readonly LatLon[],
  field?: DistanceField | undefined,
  bound: FieldTileBound | null = null,
): TileSelection {
  const tileSizeDeg = tileSizeDegOf(pointer);
  if (tileSizeDeg === undefined) {
    const tiles = tilesOverlapping(pointer, boundingBoxOf(points));
    return {
      rule: "bbox-overlapp",
      tiles,
      requiredTileIds: [],
      missingTileIds: [],
      tileSizeDeg,
    };
  }
  if (field !== undefined) {
    return selectionFromRefs(
      pointer,
      weatherTilesForField(field, bound, tileSizeDeg),
      "a-star-felt",
      tileSizeDeg,
    );
  }
  const [west, south, east, north] = boundingBoxOf(points);
  const padded = padBounds({ west, south, east, north });
  return selectionFromRefs(
    pointer,
    weatherTilesForBounds(padded, tileSizeDeg),
    "endepunkt-bbox",
    tileSizeDeg,
  );
}
