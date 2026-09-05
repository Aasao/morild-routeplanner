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
  },
});
