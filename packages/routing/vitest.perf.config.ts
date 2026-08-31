import { defineConfig } from "vitest/config";

/**
 * Egen konfigurasjon for ytelsesmålingen (`pnpm --filter @morild/routing
 * test:perf`).
 *
 * Målingen ligger i `perf.bench.ts`, ikke `perf.test.ts`, med vilje: en
 * tidsassertion som kjører parallelt med resten av suiten måler CPU-strid,
 * ikke motoren, og ble flaky i rotkjøringen. Her kjører den alene, i én
 * prosess, uten parallellitet.
 */
export default defineConfig({
  test: {
    include: ["src/perf.bench.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 300_000,
    // Ingen samtidige filer: målingen skal ikke konkurrere med seg selv.
    fileParallelism: false,
  },
});
