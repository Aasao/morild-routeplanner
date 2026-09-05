import { defineConfig } from "vitest/config";

/**
 * Pakkelokal vitest-konfigurasjon, slik at
 * `pnpm --filter @morild/routing test` kjører denne pakkens tester alene.
 *
 * Uten den arver kjøringen rotkonfigurasjonens `include`-mønstre
 * (`packages/**`), som ikke treffer noe når arbeidskatalogen allerede *er*
 * pakken. Rotkjøringen (`pnpm test`) bruker fortsatt rotkonfigurasjonen og
 * plukker opp de samme filene — de to skal aldri divergere i hvilke tester
 * som kjøres, bare i hvor mange pakker som er med.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Skademålingen (`*.damage.test.ts`) kjøres kun via `pnpm test:damage` (D9.5).
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.damage.test.ts"],
    // Golden-, ytelses- og egenskapstestene kjører hele ruter og er tregere
    // enn vitests standard på 5 s. Grensen her er en sikkerhetsventil mot
    // hengende kjøringer, ikke et ytelsesbudsjett — det ligger i perf.test.ts.
    testTimeout: 60_000,
  },
});
