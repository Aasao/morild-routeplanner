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
  {
    // E1′-målescriptet er et node-script som kjører den bygde motoren og
    // skriver rådata til disk. Det er ikke motorkode og skal ha node-globaler
    // og lov til å skrive til stdout — det er hele poenget med det.
    files: ["tools/e1-maaling/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", performance: "readonly" },
    },
    rules: { "no-console": "off" },
  },
);
