// Fixture brukt av tools/arch-tests/import-boundaries.test.ts for å bevise
// at forbiddenPathFragments-sjekken fanger en dypimport av corridor.js —
// strukturgarantien «robusthetstall kun fra fulle søk» (D8.8, §5.1).
// Kompileres aldri av tsc -b (ikke referert fra noe tsconfig) og lintes
// ikke (ekskludert i eslint.config.js).
import { buildCorridor } from "../../../../../packages/routing/src/corridor.js";

export function bad(): unknown {
  return buildCorridor;
}
