/**
 * MapLibre-oppsett (F1.8): Kartverket sjøkartraster + attribusjon, et tomt
 * vektorlag klart for farbarhetsmaske/PMTiles (docs/specs/app-skjelett.md
 * §3/§5.1), og hello-route-laget (§5.3).
 */
import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  AttributionControl,
  addProtocol,
  type LngLatLike,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection } from "geojson";
import {
  KARTVERKET_MAX_ZOOM,
  KVWMTS_TILE_TEMPLATE,
  registerKartverketProtocol,
} from "./kartverket-wmts.js";

registerKartverketProtocol(addProtocol);

/** Skjæløy (Hvaler) — samme referansepunkt som rutemotorens golden-fikstur. */
const INITIAL_CENTER: LngLatLike = [10.9327, 59.1032];
const INITIAL_ZOOM = 7;

const BACKGROUND_LAYER_ID = "havbunn-bakgrunn";
const KARTVERKET_SOURCE_ID = "kartverket-sjokartraster";
const FARBARHET_SOURCE_ID = "farbarhet";
const HELLO_ROUTE_SOURCE_ID = "hello-route";
const HELLO_ROUTE_CASING_LAYER_ID = "hello-route-line-casing";
const HELLO_ROUTE_LINE_LAYER_ID = "hello-route-line";
const HELLO_ROUTE_START_LAYER_ID = "hello-route-start";
const HELLO_ROUTE_END_LAYER_ID = "hello-route-end";

/**
 * N2 / ærlig degradering: Kartverkets sjøkartraster dekker norsk farvann.
 * Utenfor (f.eks. dansk/svensk side av Skagerrak) er det ingen kartdata —
 * MapLibre ville uten et eksplisitt `background`-lag vist rått svart, som
 * ser ut som en feil snarere enn en dokumentert dekningsgrense. Fargen er
 * en nøytral "ukjent sjø", bevisst ulik farbarhetsmaskens usikker-gult og
 * ulik selve sjøkartrasterets farger, slik at grensen er lesbar.
 */
const UKJENT_DEKNING_FARGE = "#173a52";

export function createMap(container: HTMLElement): MapLibreMap {
  const map = new MapLibreMap({
    container,
    zoom: INITIAL_ZOOM,
    center: INITIAL_CENTER,
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        [KARTVERKET_SOURCE_ID]: {
          type: "raster",
          tiles: [KVWMTS_TILE_TEMPLATE],
          tileSize: 256,
          maxzoom: KARTVERKET_MAX_ZOOM,
          // F1.8 / N3: attribusjon satt på selve MapLibre-kilden, ikke bare
          // den frittstående disclaimer-stripen i index.html — vises også
          // i kartets attribusjonskontroll.
          attribution: "© Kartverket",
        },
        [FARBARHET_SOURCE_ID]: {
          type: "geojson",
          // Tomt bevisst: erstattes med en PMTiles-kilde når
          // tools/chart-pack publiserer (docs/specs/app-skjelett.md §3).
          // Stilen under er satt opp nå så fargevalget er testet visuelt.
          data: { type: "FeatureCollection", features: [] },
        },
        [HELLO_ROUTE_SOURCE_ID]: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        },
      },
      layers: [
        // Bakgrunnslag først (= nederst i rendrerekkefølgen): dekker
        // områder utenfor Kartverket-dekning i stedet for MapLibres
        // standard svart.
        {
          id: BACKGROUND_LAYER_ID,
          type: "background",
          paint: { "background-color": UKJENT_DEKNING_FARGE },
        },
        {
          id: KARTVERKET_SOURCE_ID,
          type: "raster",
          source: KARTVERKET_SOURCE_ID,
        },
        {
          id: "farbarhet-usikker",
          type: "fill",
          source: FARBARHET_SOURCE_ID,
          paint: { "fill-color": "#e0b400", "fill-opacity": 0.3 },
        },
        // Hvit kant-linje under selve ruten: gjør den ellers tynne blå
        // linjen synlig mot både sjøkartrasterets blåtoner og
        // bakgrunnsfargen over.
        {
          id: HELLO_ROUTE_CASING_LAYER_ID,
          type: "line",
          source: HELLO_ROUTE_SOURCE_ID,
          filter: ["==", ["geometry-type"], "LineString"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 7 },
        },
        {
          id: HELLO_ROUTE_LINE_LAYER_ID,
          type: "line",
          source: HELLO_ROUTE_SOURCE_ID,
          filter: ["==", ["geometry-type"], "LineString"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#e2492d", "line-width": 4 },
        },
        {
          id: HELLO_ROUTE_START_LAYER_ID,
          type: "circle",
          source: HELLO_ROUTE_SOURCE_ID,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "start"]],
          paint: {
            "circle-radius": 6,
            "circle-color": "#1c9e4a",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        },
        {
          id: HELLO_ROUTE_END_LAYER_ID,
          type: "circle",
          source: HELLO_ROUTE_SOURCE_ID,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "end"]],
          paint: {
            "circle-radius": 6,
            "circle-color": "#e2492d",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        },
      ],
    },
  });

  map.addControl(new AttributionControl({ compact: false }));
  map.addControl(new NavigationControl(), "top-right");
  observeContainerResize(map, container);
  return map;
}

/**
 * MapLibre har sin egen interne ResizeObserver (`trackResize`, på som
 * standard), men den observerer kartets EGEN container-node ved
 * konstruksjonstidspunkt. Denne er en uavhengig sikkerhetsnett-observer
 * pluss en `window`-resize-lytter, slik at kartet garantert følger
 * viewporten selv i miljøer (TWA-WebView, eldre Android System WebView)
 * der den interne observatøren av en eller annen grunn ikke fyrer —
 * `map.resize()` er billig å kalle når størrelsen faktisk ikke er endret.
 */
function observeContainerResize(map: MapLibreMap, container: HTMLElement): void {
  const resize = (): void => {
    map.resize();
  };
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    map.once("remove", () => observer.disconnect());
  }
  const onWindowResize = (): void => resize();
  window.addEventListener("resize", onWindowResize);
  map.once("remove", () => window.removeEventListener("resize", onWindowResize));
}

/**
 * Venter til MapLibre-stilen er lastet og kildene faktisk eksisterer.
 * `map.getSource(...)` returnerer `undefined` før dette — å kalle
 * `drawHelloRoute` for tidlig (f.eks. rett etter at "hello route"-Workeren
 * er raskere ferdig enn stil-lastingen) feilet tidligere HELT STILLE:
 * ingen feilmelding, linjen ble bare aldri tegnet. Dette var årsaken til at
 * ruten ikke var synlig i røyktesten selv om lagrekkefølgen var riktig.
 */
export function whenMapReady(map: MapLibreMap): Promise<void> {
  if (map.loaded()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    map.once("load", () => resolve());
  });
}

/** Duck-typing i stedet for `instanceof GeoJSONSource`: gjør funksjonen testbar med et lettvekts mocket kart uten en ekte MapLibre-instans (samme begrunnelse som `AddProtocolFn` i kartverket-wmts.ts). */
interface SetDataCapable {
  readonly setData: (data: Feature | FeatureCollection) => void;
}

function isSetDataCapable(source: unknown): source is SetDataCapable {
  return (
    typeof source === "object" &&
    source !== null &&
    typeof (source as { setData?: unknown }).setData === "function"
  );
}

export interface HelloRouteStep {
  readonly lat: number;
  readonly lon: number;
}

/** Bygger GeoJSON-en for hello-route-kilden: selve linjen pluss start-/sluttpunkt som separate Point-features (matchet av `role`-filtrene på sirkel-lagene over). Ren funksjon — testbar uten MapLibre i det hele tatt. */
export function buildHelloRouteFeatureCollection(
  steps: readonly HelloRouteStep[],
): FeatureCollection {
  const coordinates = steps.map((step) => [step.lon, step.lat]);
  const features: Feature[] = [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    },
  ];
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (first) {
    features.push({
      type: "Feature",
      properties: { role: "start" },
      geometry: { type: "Point", coordinates: [first.lon, first.lat] },
    });
  }
  if (last && last !== first) {
    features.push({
      type: "Feature",
      properties: { role: "end" },
      geometry: { type: "Point", coordinates: [last.lon, last.lat] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function drawHelloRoute(
  map: MapLibreMap,
  steps: readonly HelloRouteStep[],
): void {
  const source = map.getSource(HELLO_ROUTE_SOURCE_ID);
  if (!isSetDataCapable(source)) {
    return;
  }
  source.setData(buildHelloRouteFeatureCollection(steps));

  const first = steps[0];
  if (!first) {
    return;
  }
  const bounds = steps.reduce(
    (acc, step) => acc.extend([step.lon, step.lat]),
    new LngLatBounds([first.lon, first.lat], [first.lon, first.lat]),
  );
  map.fitBounds(bounds, { padding: 40, duration: 0 });
}
