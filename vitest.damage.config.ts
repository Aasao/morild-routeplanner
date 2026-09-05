import { defineConfig } from "vitest/config";

/**
 * Skademålingen (robusthet.md §5.3, D9.5): forhåndsregistrerte tester som
 * kjører hele ensembler (61 fulle søk × fikstur, ~250 s) for å bevise at
 * en søkeoptimalisering ikke flipper en eneste klassifisering. Holdes
 * utenfor `pnpm test` (sparer ~170 s per kjøring) og kjøres av `/qa` når
 * `packages/routing/src/{search,expand,distance-field}.ts` eller
 * `packages/robustness` er endret, samt som egen CI-jobb.
 */
export default defineConfig({
  test: {
    include: ["packages/**/*.damage.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 600_000,
    // Skademålingenes tall skrives med console.log — standardreporteren
    // svelger dem; verbose viser dem (rutemotor-agentens funn 2026-09-05).
    reporters: ["verbose"],
  },
});
