import { defineConfig } from "vite";

// Se docs/specs/app-skjelett.md §8: i dev peker disse prefiksene til
// `apps/worker`s `wrangler dev` (standardport 8787), slik at
// utviklingsmiljøet ikke trenger å tenke på CORS mellom to lokale porter.
const WORKER_DEV_URL = "http://127.0.0.1:8787";
const WORKER_PROXY_PATHS = ["/pointer", "/blob", "/proxy", "/healthz"];

export default defineConfig({
  server: {
    proxy: Object.fromEntries(
      WORKER_PROXY_PATHS.map((path) => [path, { target: WORKER_DEV_URL, changeOrigin: true }]),
    ),
  },
  worker: {
    format: "es",
  },
  // MapLibre 6 laster sin egen kart-Worker relativt til modulen
  // (`maplibre-gl-worker.mjs`). Vites forhåndsbunting flytter modulen til
  // `.vite/deps/` uten Worker-filen ⇒ 404, kartet sender aldri `load`, og
  // alt som venter på `whenMapReady` henger (2026-09-27: hello-route-statusen).
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
});
