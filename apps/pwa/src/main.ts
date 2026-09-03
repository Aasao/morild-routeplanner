/**
 * `apps/pwa` — bootstrap: kart (F1.8), disclaimer, og "hello route"-beviset
 * for at rutemotoren kjører i en Web Worker (ADR-0002). Se
 * docs/specs/app-skjelett.md.
 */
import "./style.css";
import { createMap, drawHelloRoute, whenMapReady } from "./map.js";
import { runHelloRoute } from "./hello-route.js";

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
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
}

main();
