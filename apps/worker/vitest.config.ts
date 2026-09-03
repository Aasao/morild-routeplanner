import { defineConfig } from "vitest/config";

/**
 * Pakkelokal vitest-konfigurasjon (samme mønster som
 * `packages/routing/vitest.config.ts`), slik at
 * `pnpm --filter @morild/worker test` kjører denne pakkens tester alene i
 * stedet for å arve rotkonfigurasjonens `include`-mønstre (`apps/**`), som
 * ikke treffer noe når arbeidskatalogen allerede *er* pakken.
 * Rotkjøringen (`pnpm test`) bruker fortsatt rotkonfigurasjonen og plukker
 * opp de samme filene.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
