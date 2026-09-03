/**
 * Hvilke(n) av pekerens faste 2°×2°-fliser (`docs/specs/vaerpakker.md` §7)
 * dekker en gitt rute. Rene funksjoner — ren geometri, ingen I/O.
 *
 * **Rettet review-funn (fase 3 bølge 2, funn 2):** en tidligere versjon
 * brukte kun FØRSTE overlappende flis (etter pekerens rekkefølge) — en
 * dokumentert forenkling som viste seg gal: den ekte Skjæløy→Skagen-pakken
 * har TO fliser (5_28/5_29, delt ved 58°N-grensen,
 * `tools/weather-pack/src/build-live-package.ts`s `TARGET_TILES`), og
 * halve ruten mistet dermed vinddata stille. `tilesOverlapping` returnerer
 * nå ALLE fliser som overlapper ruteboksen; kalleren (`pipeline.ts`) laster
 * dem alle og syr dem sammen med `@morild/weather`s
 * `compositeWeatherField`.
 */
import type { LatLon } from "@morild/geo";
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
