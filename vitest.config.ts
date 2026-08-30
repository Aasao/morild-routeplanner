import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tools/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
  },
});
