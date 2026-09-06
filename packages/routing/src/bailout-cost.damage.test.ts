/**
 * **Kostnadsmålingen for bail-out-profilen** (`docs/specs/robusthet.md` §6.3
 * og §7 D8.6: «(c) betinget av kostnadsmåling»).
 *
 * D8.6 vedtok (b) — sampling langs hele ruten med havnefelt som forfilter —
 * og satte (c), maks over ensemble-medlemmene, som en egen bølge **betinget
 * av at dette tallet finnes**. Denne testen er tallet. Den avgjør ingenting
 * selv; den måler, og skriver tallene til konsollet (damage-tierens reporter
 * er `verbose`, så de vises).
 *
 * Panelets anslag før måling (§6.1):
 *
 *   | uten havnefelt, 1 medlem | 4–12 min |
 *   | med havnefelt, 1 medlem  | < 40 R2-søk, anslått < 2 min |
 *
 * **Forhåndsregistrert hypotese** (skrevet før kjøring): anslaget holder på
 * golden-strekket — under 40 fulle R2-søk og under 2 minutter for én rute på
 * full oppløsning. Begge er harde assertions nedenfor. Slår de feil, er (c)
 * ikke bare ubetimelig, den er utelukket, og §4.5 pkt. 5 må skrives om.
 *
 * Kjøres ikke av `pnpm test` (se `vitest.damage.config.ts`):
 *   pnpm exec vitest run --config vitest.damage.config.ts \
 *     packages/routing/src/bailout-cost.damage.test.ts
 */
import { describe, expect, it } from "vitest";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import { INTERIM_HARBOUR_BOOK } from "../test-fixtures/harbour-book.js";
import { harbourFieldVmaxKn } from "./harbour-field.js";
import { bailoutProfile } from "./bailout-profile.js";
import { buildHarbourField, type HarbourField } from "./harbour-field.js";
import { planRoute } from "./search.js";

const SCENARIO = goldenScenarios().find(
  (s) => s.name === "skjaeloy-skagen-apent",
)!;

describe("bail-out-kostnad på golden skjaeloy-skagen-apent", () => {
  it("holder seg innenfor panelets anslag: < 40 R2-søk og < 2 min", () => {
    const input = SCENARIO.input;

    const tRoute0 = Date.now();
    const route = planRoute(input);
    const routeMs = Date.now() - tRoute0;
    expect(route.reached).toBe(true);

    // Feltene bygges én gang per (havn, maskeversjon, oppløsning) og gjenbrukes
    // for alle avganger og alle medlemmer — kostnaden deles, men den måles her
    // for én rute, som er det konservative regnestykket.
    const vmaxKn = harbourFieldVmaxKn(input.boat, input.weather);
    const tField0 = Date.now();
    const fields = new Map<string, HarbourField>();
    let fieldCells = 0;
    let fieldBytes = 0;
    for (const h of INTERIM_HARBOUR_BOOK) {
      const field = buildHarbourField(h, input.mask, {
        vmaxKn,
        // Full oppløsning, som A\*-feltet (`DEFAULT_FIELD_CELL_DEG`).
        cellDeg: 0.01,
        maskVersion: "golden-rectmask-v1",
      });
      fields.set(h.id, field);
      fieldCells += field.width * field.height;
      fieldBytes += field.distanceNm.byteLength;
    }
    const fieldMs = Date.now() - tField0;

    const tProfile0 = Date.now();
    const profile = bailoutProfile({
      route: { steps: route.steps, legs: route.legs },
      departEpochS: input.departEpochS,
      weather: input.weather,
      mask: input.mask,
      boat: input.boat,
      book: INTERIM_HARBOUR_BOOK,
      fields,
      // Ingen grovere mekanikk: dette er full oppløsning, som i produksjon.
      options: input.options,
    });
    const profileMs = Date.now() - tProfile0;

    const byStatus = new Map<string, number>();
    for (const s of profile.samples) {
      byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
    }

    const lines = [
      "",
      "=== Bail-out-kostnad, golden skjaeloy-skagen-apent (D8.6 c-betingelse) ===",
      `  rute:                 ${(routeMs / 1000).toFixed(2)} s (${route.steps.length} steps, ${(route.totals.durationS / 3600).toFixed(1)} t)`,
      `  havnefelt:            ${(fieldMs / 1000).toFixed(2)} s for ${INTERIM_HARBOUR_BOOK.length} havner`,
      `                        ${fieldCells} celler, ${(fieldBytes / 1024 / 1024).toFixed(2)} MB Float32`,
      `  bail-out-profil:      ${(profileMs / 1000).toFixed(2)} s`,
      `  TOTALT (felt+profil): ${((fieldMs + profileMs) / 1000).toFixed(2)} s`,
      "",
      `  samples:              ${profile.samples.length} (hvert ${profile.sampleIntervalS / 60}. min + segmentskifter)`,
      `  fulle R2-søk:         ${profile.searchCount}`,
      `  silt av feltet:       ${profile.fieldScreenedCandidates} kandidater, ${profile.fieldScreenedSamples} hele punkter`,
      `  kandidatpar totalt:   ${profile.samples.length * INTERIM_HARBOUR_BOOK.length} (uten felt og uten tidlig stopp: like mange søk)`,
      `  aldri forsøkt:        ${profile.samples.length * INTERIM_HARBOUR_BOOK.length - profile.fieldScreenedCandidates - profile.searchCount} (en nærmere havn lyktes først, eller mørke-forgaten stoppet dem)`,
      `  ms per R2-søk:        ${profile.searchCount > 0 ? (profileMs / profile.searchCount).toFixed(0) : "-"}`,
      "",
      `  status:               ${[...byStatus].map(([k, v]) => `${k}=${v}`).join(", ")}`,
      `  longestGapS:          ${profile.longestGapS === null ? "null" : `${(profile.longestGapS / 3600).toFixed(2)} t`}`,
      `  coverage:             ${profile.coverage} (${profile.label})`,
      "",
    ];
    console.log(lines.join("\n"));

    // Forhåndsregistrerte skranker — panelets egne anslag, §6.1.
    expect(profile.searchCount).toBeLessThan(40);
    expect(fieldMs + profileMs).toBeLessThan(120_000);
    // Feltet skal faktisk spare søk; ellers er D8.10 uten virkning her.
    expect(profile.fieldScreenedCandidates).toBeGreaterThan(profile.searchCount);
  });
});
