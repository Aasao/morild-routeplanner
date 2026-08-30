// Fixture brukt av tools/arch-tests/import-boundaries.test.ts for å bevise
// at grensesjekken faktisk fanger brudd. Kompileres aldri av tsc -b (ikke
// referert fra noe tsconfig) og lintes ikke (ekskludert i eslint.config.js).
import fs from "node:fs";
import { CHARTS_PACKAGE_PLACEHOLDER } from "@morild/charts";

export function bad(): void {
  fs.readFileSync("/etc/hosts");
  console.log(CHARTS_PACKAGE_PLACEHOLDER);
}
