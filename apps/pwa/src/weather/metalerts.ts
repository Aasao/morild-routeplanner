/**
 * MetAlerts-filtrering i klienten (F2.6, `docs/specs/vaerpakker.md` §4.5,
 * §18 pkt. 5): Workeren speiler nå HELE Skandinavia-settet (ny kontrakt —
 * ingen `bbox`-parameter sendes), og klienten avgjør hvilke varsler som er
 * relevante for DENNE ruten: **varselpolygonet skjærer rutesporet bufret
 * 5 nm, ELLER inneholder start- eller målpunktet.**
 *
 * Geometriprimitivene (`pointInPolygon`, `distanceToPolygonNm`,
 * `distanceToSegmentNm`) gjenbrukes fra `@morild/charts` — MetAlerts sine
 * GeoJSON-koordinater ER allerede `[lon, lat]`-ringer
 * (`@morild/charts`s `Ring`-type), så ingen konvertering trengs utover å
 * pakke dem i en `PackedPolygon`.
 *
 * **Dokumentert tilnærming, ikke skjult (N2):** "skjærer bufret 5 nm" burde
 * strengt vært en polygonkant-mot-linjesegment-avstand. Denne funksjonen
 * tester i stedet (a) hvert rutepunkt mot polygonkanten og (b) hvert
 * polygonhjørne mot rutens segmenter, og tar minimum av begge — dette
 * fanger praktiske kryssinger og nærhet (rutepunktene er timevis tette),
 * men kan i sjeldne, smale kileformede overlapp MELLOM to prøvepunkter og
 * MELLOM to polygonhjørner teoretisk bomme en ekte skjæring. En fullstendig
 * segment-mot-segment-avstand er ikke bygget her — gjenstående arbeid, ikke
 * en stille forenkling.
 */
import type { LatLon } from "@morild/geo";
import {
  distanceToPolygonNm,
  distanceToSegmentNm,
  pointInPolygon,
  type PackedPolygon,
  type Ring,
} from "@morild/charts";

export const METALERTS_BUFFER_NM = 5;

export type MetAlertGeometry =
  | { readonly type: "Polygon"; readonly coordinates: readonly Ring[] }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly (readonly Ring[])[] };

export interface MetAlertProperties {
  readonly event?: string;
  /** CAP-alvorlighetsgrad ("Minor"|"Moderate"|"Severe"|"Extreme"), når MET oppgir den. */
  readonly severity?: string;
  /** METs eget varselnivå, f.eks. "2; yellow" — presentasjon/fargekoding er IKKE denne spec-ens ansvar (§4.5). */
  readonly awareness_level?: string;
  readonly title?: string;
  readonly description?: string;
}

export interface MetAlertFeature {
  readonly type: "Feature";
  readonly properties: MetAlertProperties;
  readonly geometry: MetAlertGeometry;
}

export interface MetAlertsFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly MetAlertFeature[];
}

function polygonsOf(feature: MetAlertFeature): readonly PackedPolygon[] {
  if (feature.geometry.type === "Polygon") {
    return [{ rings: feature.geometry.coordinates }];
  }
  return feature.geometry.coordinates.map((rings) => ({ rings }));
}

/** Se toppkommentaren for hvorfor dette er en tilnærming, ikke en eksakt polygon-til-linje-avstand. */
export function approximateTrackDistanceToPolygonNm(
  track: readonly LatLon[],
  polygon: PackedPolygon,
): number {
  let min = Infinity;
  for (const p of track) {
    if (pointInPolygon(p, polygon)) return 0;
    const d = distanceToPolygonNm(p, polygon);
    if (d < min) min = d;
  }
  for (const ring of polygon.rings) {
    for (const vertex of ring) {
      const point: LatLon = { lon: vertex[0], lat: vertex[1] };
      for (let i = 0; i < track.length - 1; i++) {
        const a = track[i];
        const b = track[i + 1];
        if (!a || !b) continue;
        const d = distanceToSegmentNm(point, a, b);
        if (d < min) min = d;
      }
    }
  }
  return min;
}

export interface RelevantAlert {
  readonly feature: MetAlertFeature;
  /** `0` når polygonet inneholder ruteporet et sted, eller start/mål ligger inni. */
  readonly minDistanceNm: number;
  readonly containsEndpoint: boolean;
}

/** §4.5/§18 pkt. 5s kontrakt: skjærer bufret 5 nm ELLER inneholder et endepunkt. */
export function filterAlertsForRoute(
  alerts: MetAlertsFeatureCollection,
  track: readonly LatLon[],
  start: LatLon,
  dest: LatLon,
): readonly RelevantAlert[] {
  const relevant: RelevantAlert[] = [];
  for (const feature of alerts.features) {
    const polygons = polygonsOf(feature);
    let minDistanceNm = Infinity;
    let containsEndpoint = false;
    for (const polygon of polygons) {
      if (pointInPolygon(start, polygon) || pointInPolygon(dest, polygon)) {
        containsEndpoint = true;
      }
      const d = approximateTrackDistanceToPolygonNm(track, polygon);
      if (d < minDistanceNm) minDistanceNm = d;
    }
    if (containsEndpoint || minDistanceNm <= METALERTS_BUFFER_NM) {
      relevant.push({ feature, minDistanceNm, containsEndpoint });
    }
  }
  return relevant;
}
