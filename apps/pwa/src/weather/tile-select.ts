/**
 * Hvilke(n) av pekerens faste 2°×2°-fliser (`docs/specs/vaerpakker.md` §7)
 * dekker en gitt rute. Rene funksjoner — ren geometri, ingen I/O.
 *
 * **Dokumentert forenkling (fase 3 bølge 2C):** krysser ruten flere fliser,
 * brukes kun den FØRSTE flisen som overlapper (etter pekerens rekkefølge).
 * Sammensying av flere fliser til én sammenhengende `WeatherField` er ikke
 * bygget her — Skjæløy→Skagen (§ eksempel-strekket, ~87 nm) faller innenfor
 * én flis på et 2°-rutenett i praksis (samme antagelse
 * `packages/weather/src/budget.test.ts`s bbox bygger på). Flere fliser
 * langs én rute er gjenstående arbeid, ikke stille utelatt.
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
 * Den primære flisen for en rute — se forenklingen i toppkommentaren.
 * `undefined` når ingen flis i pekeren dekker ruten (N2: synlig, ikke
 * skjult — kalleren viser "ingen værdekning for dette området").
 */
export function primaryTileFor(pointer: WeatherPointer, points: readonly LatLon[]): PointerTileEntry | undefined {
  const overlapping = tilesOverlapping(pointer, boundingBoxOf(points));
  return overlapping[0];
}
