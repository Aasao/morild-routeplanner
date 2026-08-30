// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-tsc/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "tools/arch-tests/fixtures/**",
      // tools/spikes/ er en annen agents arbeidsområde (THREDDS-spike) —
      // røres ikke, heller ikke av lint-konfigurasjon her.
      "tools/spikes/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prosjektregel (CLAUDE.md): ingen `any` uten begrunnende kommentar.
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "warn",
    },
  },
);
