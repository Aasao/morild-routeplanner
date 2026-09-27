import { defineConfig } from "vitest/config";

// Pakkelokal vitest-konfigurasjon (samme mønster som
// packages/routing/vitest.config.ts), slik at
// `pnpm --filter @morild/pwa test` kjører denne pakkens tester alene, og —
// viktigere her — slik at tsc -b sitt build-output i dist-tsc (som ellers
// matcher vitests standard test-fil-mønster og ville kjørt hver test to
// ganger) eksplisitt ekskluderes.
//
// (Merk: bevisst linje-kommentarer, ikke en /** */-blokk — et bokstavelig
// "*/" inne i en glob-streng midt i en blokk-kommentar avslutter den
// kommentaren for tidlig og gir en forvirrende parse-feil.)
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "dev-server/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-tsc/**"],
  },
});
