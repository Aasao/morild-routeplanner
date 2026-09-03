import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { buildHelloRouteFeatureCollection, drawHelloRoute, whenMapReady } from "./map.js";

const STEPS = [
  { lat: 59.1, lon: 10.9 },
  { lat: 59.3, lon: 11.1 },
  { lat: 59.6, lon: 11.4 },
];

describe("buildHelloRouteFeatureCollection", () => {
  it("bygger en LineString med alle stegene i rekkefølge som [lon, lat]", () => {
    const fc = buildHelloRouteFeatureCollection(STEPS);
    const line = fc.features.find((f: Feature) => f.geometry.type === "LineString");
    expect(line).toBeDefined();
    const coords = (line!.geometry as LineString).coordinates;
    expect(coords.length).toBe(STEPS.length);
    expect(coords[0]).toEqual([10.9, 59.1]);
    expect(coords[coords.length - 1]).toEqual([11.4, 59.6]);
  });

  it("legger til start- og sluttpunkt som separate Point-features merket med role", () => {
    const fc = buildHelloRouteFeatureCollection(STEPS);
    const start = fc.features.find(
      (f: Feature) => f.geometry.type === "Point" && f.properties?.role === "start",
    );
    const end = fc.features.find(
      (f: Feature) => f.geometry.type === "Point" && f.properties?.role === "end",
    );
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect((start!.geometry as Point).coordinates).toEqual([10.9, 59.1]);
    expect((end!.geometry as Point).coordinates).toEqual([11.4, 59.6]);
  });

  it("legger ikke til et duplisert sluttpunkt når det bare finnes ett steg", () => {
    const fc = buildHelloRouteFeatureCollection([STEPS[0]!]);
    const points = fc.features.filter((f: Feature) => f.geometry.type === "Point");
    expect(points).toHaveLength(1);
  });
});

/**
 * Lettvekts mock av MapLibre sitt `Map` — nok overflate til å drive
 * `drawHelloRoute`/`whenMapReady` uten WebGL/DOM. `getSource` returnerer et
 * duck-typet objekt med `setData` (se `isSetDataCapable` i map.ts), ikke en
 * ekte `GeoJSONSource`-instans.
 */
function createFakeMap(options: { readonly loaded?: boolean } = {}) {
  const setData = vi.fn();
  const fitBounds = vi.fn();
  const listeners = new Map<string, () => void>();
  const map = {
    getSource: vi.fn(() => ({ setData })),
    fitBounds,
    loaded: vi.fn(() => options.loaded ?? true),
    once: vi.fn((event: string, cb: () => void) => {
      listeners.set(event, cb);
    }),
  };
  return { map: map as unknown as MapLibreMap, setData, fitBounds, listeners };
}

describe("drawHelloRoute", () => {
  it("setter kildens data med N>1 koordinater og kaller fitBounds", () => {
    const { map, setData, fitBounds } = createFakeMap();
    drawHelloRoute(map, STEPS);

    expect(setData).toHaveBeenCalledTimes(1);
    const fc = setData.mock.calls[0]![0] as FeatureCollection;
    const line = fc.features.find((f: Feature) => f.geometry.type === "LineString")!;
    const coords = (line.geometry as LineString).coordinates;
    expect(coords.length).toBeGreaterThan(1);
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("gjør ingenting (kaster ikke) når kilden ikke er 'setData'-i-stand — f.eks. før stilen er lastet", () => {
    const fitBounds = vi.fn();
    const map = {
      getSource: vi.fn(() => undefined),
      fitBounds,
    } as unknown as MapLibreMap;
    expect(() => drawHelloRoute(map, STEPS)).not.toThrow();
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe("whenMapReady", () => {
  it("løser umiddelbart når kartet allerede er lastet", async () => {
    const { map } = createFakeMap({ loaded: true });
    await expect(whenMapReady(map)).resolves.toBeUndefined();
  });

  it("venter på 'load'-hendelsen når kartet ikke er lastet ennå — dette er selve race-bugen som gjorde rutelinjen usynlig", async () => {
    const { map, listeners } = createFakeMap({ loaded: false });
    let resolved = false;
    const ready = whenMapReady(map).then(() => {
      resolved = true;
    });
    // Ingen "load" utløst ennå.
    await Promise.resolve();
    expect(resolved).toBe(false);

    listeners.get("load")?.();
    await ready;
    expect(resolved).toBe(true);
  });
});
