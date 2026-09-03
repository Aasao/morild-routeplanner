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
      // apps/worker: wrangler dev sitt lokale build-/runtime-cache
      // (generert kode, ikke noe vi skriver eller eier).
      "**/.wrangler/**",
      "tools/arch-tests/fixtures/**",
      // tools/spikes/ er en annen agents arbeidsområde (THREDDS-spike) —
      // røres ikke, heller ikke av lint-konfigurasjon her.
      "tools/spikes/**",
      // .claude/hooks: Node-skript for Claude Code-hooks (ikke domenekode;
      // egen test via `node .claude/hooks/vern.test.mjs`).
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prosjektregel (CLAUDE.md): ingen `any` uten begrunnende kommentar.
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "warn",
      // Slått av for hele repoet, ikke bare apps/: tsc fanger udefinerte
      // identifikatorer langt mer presist enn eslints kjerneregel, som
      // ikke kjenner ambiente globaler (DOM/WebWorker-libs,
      // @cloudflare/workers-types) og gir falske positiver for dem —
      // offisiell typescript-eslint-anbefaling. Ble aktuelt først med
      // apps/pwa (nettleser-globaler) og apps/worker (Workers-globaler).
      "no-undef": "off",
    },
  },
  {
    // E1′- og kvantiseringsmålescriptene er node-scripts som kjører den bygde
    // motoren og skriver rådata til disk. Det er ikke motorkode og skal ha
    // node-globaler og lov til å skrive til stdout — det er hele poenget med
    // dem.
    files: ["tools/e1-maaling/**/*.mjs", "tools/kvantisering/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", performance: "readonly" },
    },
    rules: { "no-console": "off" },
  },
);
