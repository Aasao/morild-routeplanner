import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tools/**/*.test.ts",
    ],
    // `*.damage.test.ts` er den forhåndsregistrerte skademålingen (robusthet.md
    // §5.3, ~250 s): egen kommando `pnpm test:damage` (D9.5), ikke standardløpet.
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**", "**/*.damage.test.ts"],
    // Samme sikkerhetsventil som packages/routing/vitest.config.ts: golden-/
    // søketester kjører hele ruter og kan overstige vitests 5 s under
    // full-suite-parallellitet (CPU-konkurranse, ikke regresjon —
    // search.test.ts «dagslys-ankomst» 2026-09-07).
    testTimeout: 60_000,
  },
});
