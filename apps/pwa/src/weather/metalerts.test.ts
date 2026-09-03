import { describe, expect, it } from "vitest";
import type { LatLon } from "@morild/geo";
import { approximateTrackDistanceToPolygonNm, filterAlertsForRoute, type MetAlertFeature } from "./metalerts.js";
import type { PackedPolygon } from "@morild/charts";

const TRACK: readonly LatLon[] = [
  { lat: 59.1032, lon: 10.9327 }, // Skjæløy
  { lat: 58.5, lon: 10.8 },
  { lat: 58.0, lon: 10.6 },
  { lat: 57.7211, lon: 10.5836 }, // Skagen
];

function polygonAround(lat: number, lon: number, halfDeg: number): PackedPolygon {
  return {
    rings: [
      [
        [lon - halfDeg, lat - halfDeg],
        [lon + halfDeg, lat - halfDeg],
        [lon + halfDeg, lat + halfDeg],
        [lon - halfDeg, lat + halfDeg],
        [lon - halfDeg, lat - halfDeg],
      ],
    ],
  };
}

function feature(polygon: PackedPolygon, properties: MetAlertFeature["properties"] = {}): MetAlertFeature {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates: polygon.rings },
  };
}

describe("approximateTrackDistanceToPolygonNm", () => {
  it("er 0 når et rutepunkt ligger inni polygonet", () => {
    const polygon = polygonAround(58.5, 10.8, 0.2);
    expect(approximateTrackDistanceToPolygonNm(TRACK, polygon)).toBe(0);
  });

  it("er en liten, positiv avstand når polygonet ligger like utenfor sporet", () => {
    const polygon = polygonAround(58.5, 12.0, 0.05); // langt øst for sporet, samme høyde
    const d = approximateTrackDistanceToPolygonNm(TRACK, polygon);
    expect(d).toBeGreaterThan(5);
  });
});

describe("filterAlertsForRoute — §4.5/§18 pkt. 5s kontrakt", () => {
  it("inkluderer et varsel som skjærer det 5 nm bufrede sporet", () => {
    const alert = feature(polygonAround(58.5, 10.8, 0.05));
    const relevant = filterAlertsForRoute({ type: "FeatureCollection", features: [alert] }, TRACK, TRACK[0]!, TRACK[TRACK.length - 1]!);
    expect(relevant).toHaveLength(1);
  });

  it("inkluderer et varsel som dekker startpunktet, SELV OM sporet for øvrig er langt unna", () => {
    const start = { lat: 59.1032, lon: 10.9327 };
    const dest = { lat: 30, lon: 30 }; // urealistisk langt unna — testen bryr seg kun om start-inneslutning
    const alert = feature(polygonAround(start.lat, start.lon, 0.05));
    const relevant = filterAlertsForRoute({ type: "FeatureCollection", features: [alert] }, [start, dest], start, dest);
    expect(relevant).toHaveLength(1);
    expect(relevant[0]!.containsEndpoint).toBe(true);
  });

  it("ekskluderer et varsel langt unna både sporet og endepunktene", () => {
    const alert = feature(polygonAround(10, 10, 0.05));
    const relevant = filterAlertsForRoute(
      { type: "FeatureCollection", features: [alert] },
      TRACK,
      TRACK[0]!,
      TRACK[TRACK.length - 1]!,
    );
    expect(relevant).toHaveLength(0);
  });

  it("håndterer MultiPolygon-geometri", () => {
    const feat: MetAlertFeature = {
      type: "Feature",
      properties: { title: "Test-multi" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [polygonAround(10, 10, 0.05).rings, polygonAround(58.5, 10.8, 0.05).rings],
      },
    };
    const relevant = filterAlertsForRoute(
      { type: "FeatureCollection", features: [feat] },
      TRACK,
      TRACK[0]!,
      TRACK[TRACK.length - 1]!,
    );
    expect(relevant).toHaveLength(1);
  });
});
