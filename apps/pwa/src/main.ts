/**
 * `apps/pwa` — bootstrap: kart (F1.8), disclaimer, "hello route"-beviset
 * for at rutemotoren kjører i en Web Worker (ADR-0002), og — fase 3
 * bølge 2C — den ekte værpakke-flyten (pakke-peker → cache → dekoding →
 * `planRoute` på ekte vær, ensemble-forberedelse, MetAlerts). Se
 * docs/specs/app-skjelett.md og docs/specs/vaerpakker.md §5/§14/§15.
 */
import "./style.css";
import { createMap, drawHelloRoute, drawWeatherRoute, whenMapReady } from "./map.js";
import { runHelloRoute } from "./hello-route.js";
import { DEFAULT_APP_CONFIG } from "./weather/config.js";
import { browserCacheStorage, memoryCacheStorage, requestPersistentStorage } from "./weather/pack-cache.js";
import { createRealWeatherWorker } from "./weather/ensemble.js";
import { runWeatherPipeline } from "./weather/pipeline.js";
import { allDisplayFlags } from "./weather/route-flags.js";
import type { FieldPresenceStatus } from "./weather/field-status.js";
import {
  renderControlResult,
  renderEnsembleSummary,
  renderFieldStatuses,
  renderFlags,
  renderMetAlerts,
  renderPointerStatus,
  renderTileSelection,
} from "./weather-ui.js";

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => requestPersistentStorage())
      .catch((err: unknown) => {
        console.warn("Service worker-registrering feilet:", err);
      });
  });
}

function formatStatus(result: Awaited<ReturnType<typeof runHelloRoute>>): string {
  if (result.type === "error") {
    return `Hello-route feilet: ${result.message}`;
  }
  const reachedText = result.reached ? "nådde målet" : "nådde IKKE målet";
  const distance = result.totals.distanceNm.toFixed(1);
  const duration = (result.totals.durationS / 3600).toFixed(1);
  return `${result.scenario}: ${reachedText} — ${distance} nm, ${duration} t (syntetisk golden-fikstur, ikke ekte vær)`;
}

function runWeatherFlow(mapReady: Promise<void>, map: ReturnType<typeof createMap>): void {
  const pointerStatusEl = document.querySelector<HTMLDivElement>("#weather-pointer-status");
  const tileSelectionEl = document.querySelector<HTMLDivElement>("#weather-tile-selection");
  const fieldStatusEl = document.querySelector<HTMLDivElement>("#weather-field-status");
  const controlResultEl = document.querySelector<HTMLDivElement>("#weather-control-result");
  const flagsEl = document.querySelector<HTMLDivElement>("#weather-flags");
  const ensembleEl = document.querySelector<HTMLDivElement>("#weather-ensemble-summary");
  const metalertsEl = document.querySelector<HTMLDivElement>("#weather-metalerts");

  // Cache API finnes kun i secure context (https/localhost). Fra en
  // LAN-IP over http (nettbrett-røyktest) faller vi ærlig tilbake til
  // minne-cache: ruting virker, men ingen offline-lagring (N2-flagg).
  const persistent = browserCacheStorage();
  const cacheStorage = persistent ?? memoryCacheStorage();
  if (persistent === undefined && pointerStatusEl) {
    // Egen, varig stripe — pekerstatusen under overskrives av pipelinen.
    const warn = document.createElement("div");
    warn.className = "weather-warning";
    warn.textContent =
      "⚠ Offline-lager utilgjengelig (usikker kontekst — http uten localhost/https): " +
      "værpakken lastes uten cache og overlever ikke sideinnlasting.";
    pointerStatusEl.insertAdjacentElement("beforebegin", warn);
  }

  let lastFieldStatuses: readonly FieldPresenceStatus[] = [];

  void runWeatherPipeline(
    {
      config: DEFAULT_APP_CONFIG,
      fetchImpl: fetch.bind(window),
      cacheStorage,
      workerFactory: createRealWeatherWorker,
      poolSize: navigator.hardwareConcurrency || 4,
      nowEpochS: Math.floor(Date.now() / 1000),
    },
    {
      onPointerStatus: (status) => {
        if (pointerStatusEl) renderPointerStatus(pointerStatusEl, status);
      },
      onTileSelection: (selection, rejections) => {
        if (tileSelectionEl) renderTileSelection(tileSelectionEl, selection, rejections);
      },
      onFieldStatuses: (statuses) => {
        lastFieldStatuses = statuses;
        if (fieldStatusEl) renderFieldStatuses(fieldStatusEl, statuses);
      },
      onControlResult: (outcome) => {
        if (controlResultEl) renderControlResult(controlResultEl, outcome);
        const result = outcome.result;
        if (result === undefined) return;
        if (flagsEl) {
          renderFlags(flagsEl, allDisplayFlags(result, lastFieldStatuses));
        }
        if (result.steps.length > 0) {
          mapReady
            .then(() => drawWeatherRoute(map, result.steps))
            .catch(() => {
              /* kartet er uansett ikke kritisk for at værpanelet skal vise tall */
            });
        }
      },
      onMemberResult: (_outcome, summary) => {
        if (ensembleEl) renderEnsembleSummary(ensembleEl, summary);
      },
      onMetAlerts: (result, relevant) => {
        if (metalertsEl) renderMetAlerts(metalertsEl, result, relevant);
      },
      onError: (message) => {
        if (pointerStatusEl) pointerStatusEl.textContent = `Værflyt: ${message}`;
        console.warn("Værflyt feilet:", message);
      },
    },
  );
}

function main(): void {
  const container = document.querySelector<HTMLDivElement>("#map");
  if (!container) {
    throw new Error("Fant ikke #map i index.html");
  }
  const map = createMap(container);
  const mapReady = whenMapReady(map);
  const statusEl = document.querySelector<HTMLDivElement>("#hello-route-status");

  runHelloRoute()
    .then(async (result) => {
      if (result.type === "hello-route-result") {
        // Rutemotor-Workeren og MapLibres stil-lasting løper parallelt og
        // uavhengig av hverandre — å tegne før stilen er klar feiler helt
        // stille (`getSource` returnerer `undefined`), se map.ts.
        await mapReady;
        drawHelloRoute(map, result.steps);
      }
      if (statusEl) {
        statusEl.textContent = formatStatus(result);
      }
    })
    .catch((err: unknown) => {
      if (statusEl) {
        statusEl.textContent = `Hello-route feilet: ${String(err)}`;
      }
    });

  registerServiceWorker();
  runWeatherFlow(mapReady, map);
}

main();
