/**
 * **D9.3 — gapmåling: hvor nær er den grådige Tub-ruten et gyldig
 * sertifikat?** (`docs/specs/robusthet.md` §7 D9.3,
 * `docs/research/ekspertpanel-d9-delt-tub-2026-09-05.md` §4.1; fase 4a
 * bølge 3.)
 *
 * Matematikerens funn: `computeTubBound` (rutemotor.md §5.5) bygger en
 * grådig forhåndsrute mot A\*-feltets gradient og bruker dens seilingstid
 * som øvre skranke `Tub`. Ruten sjekkes mot værdekning, harde båtgrenser,
 * farbarhetsmasken og TSS — men (fram til bølge 3) **ikke** mot
 * klaringskorridoren eller dagslyskravet. Sertifikatmengden er dermed en
 * ekte delmengde av søkets skranker, og `Tub` kan ligge **under** det
 * skrankede optimum. Da beskjærer bounden en lovlig rute, og eneste vern er
 * `tubMarginFrac` (0,25).
 *
 * Denne testen er den **forhåndsregistrerte målingen** panelet ba om (D9.3
 * (b) før (a)): for hvert medlem i S-1, S-3, S-5, S-7 og S-8 måles
 *
 *     ratio = T*ₘ / tubBoundS
 *
 * der `T*ₘ` er medlemmets faktisk funne `totals.durationS` og `tubBoundS`
 * er motorens egen bound i **samme** kjøring. Rapportert per fikstur:
 * maks ratio, andel > 1,00 og andel > 1,25.
 *
 * **Hva de tre tallene betyr.**
 *  - `ratio ≤ 1,00`: den grådige ruten var minst like treg som den ruten
 *    søket endte med — bounden oppførte seg som en ekte øvre skranke.
 *  - `1,00 < ratio ≤ 1,25`: bounden var *for stram*, men marginen dekket
 *    den. Ingen skade skjedde, men vernet var marginen, ikke sertifikatet.
 *  - `ratio > 1,25`: marginen holdt ikke. Ruten vi ser er da beskåret av
 *    en ugyldig skranke — enten fant søket en dårligere rute enn det
 *    kunne, eller et medlem ble feilaktig erklært ugjennomførbart.
 *
 * **Forhåndsregistrert hypotese (skrevet før tallene ble kjørt):** andelen
 * > 1,25 er **0** i alle fiksturene. Var den ikke det, ville medlemmer blitt
 * beskåret feilaktig allerede i dag, og det ville vist seg som falske
 * `error`/`inconclusive` i skademålingen. Hypotesen er hard assertion
 * nedenfor: slår den feil, er det et sikkerhetsfunn, ikke en fasit å
 * oppdatere.
 *
 * **Målingens egen skarpe kant.** `T*ₘ` er *den funne* ruten, ikke det
 * sanne skrankede optimum. Er optimum beskåret bort, er `T*ₘ` **større**
 * enn optimum (vi fant en dårligere rute) — eller ruten ble borte helt, og
 * medlemmet teller i `utenMaal` i stedet. Målingen er derfor en **nedre**
 * skranke for gapet: den kan ikke overdrive problemet, bare underdrive det.
 * Nettopp derfor er den et forkrav til fiksen (a), ikke en erstatning.
 *
 * Kjøres med `pnpm test:damage` (D9.5) — ikke i standard `pnpm test`.
 */
import { describe, expect, it } from "vitest";
import type { EnsembleFixture } from "../test-fixtures/ensemble.js";
import { memberInput } from "../test-fixtures/ensemble.js";
import { s1SlorEnsemble } from "../test-fixtures/ensemble-golden.js";
import { s3FrontEnsemble } from "../test-fixtures/ensemble-s3-front.js";
import { s5DepartureWindowEnsemble } from "../test-fixtures/ensemble-s5-departure.js";
import { s7TwoRegimeEnsemble } from "../test-fixtures/ensemble-s7-two-regime.js";
import { s8WindAgainstCurrentEnsemble } from "../test-fixtures/ensemble-s8-wind-current.js";
import { withDefaults } from "./options.js";
import { buildFieldForInput, planRoute } from "./search.js";
import type { RouteInput } from "./search.js";

interface GapRow {
  readonly id: string;
  readonly reaches: boolean;
  readonly durationS: number;
  readonly tubBoundS: number | null;
  readonly prunedBound: number;
  readonly abortReason: string | null;
  /** `null` når medlemmet mangler bound eller ikke kom fram. */
  readonly ratio: number | null;
}

interface GapSummary {
  readonly name: string;
  readonly marginFrac: number;
  readonly rows: readonly GapRow[];
  /** Medlemmer med både bound og mål — nevneren i andelene. */
  readonly measured: number;
  readonly utenBound: number;
  readonly utenMaal: number;
  readonly maxRatio: number | null;
  readonly overOne: number;
  readonly overMargin: number;
  /** Medlemmer der bounden faktisk beskar minst én kandidat. */
  readonly prunedBoundMembers: number;
}

function gapOf(fixture: EnsembleFixture): GapSummary {
  const marginFrac = withDefaults(fixture.options).tubMarginFrac;
  const controlBase: RouteInput = {
    start: fixture.start,
    dest: fixture.dest,
    departEpochS: fixture.departEpochS,
    weather: fixture.control,
    mask: fixture.mask,
    boat: fixture.boat,
    options: fixture.options,
  };
  // Delt A*-felt, som i produksjonsoppsettet (robusthet.md §4.1). Feltet er
  // væruavhengig, og deling er bevist nøytralt i `shared-field.test.ts`.
  const field = buildFieldForInput(controlBase);

  const rows: GapRow[] = [];
  for (const member of fixture.members) {
    const input: RouteInput = { ...memberInput(fixture, member), field };
    const r = planRoute(input);
    const tubBoundS = r.diagnostics.tubBoundS;
    const reaches = r.safety.reachesDestination;
    rows.push({
      id: member.id,
      reaches,
      durationS: r.totals.durationS,
      tubBoundS,
      prunedBound: r.diagnostics.pruned.bound,
      abortReason: r.abortReason,
      ratio:
        tubBoundS !== null && tubBoundS > 0 && reaches
          ? r.totals.durationS / tubBoundS
          : null,
    });
  }

  const ratios = rows
    .map((row) => row.ratio)
    .filter((x): x is number => x !== null);
  return {
    name: fixture.name,
    marginFrac,
    rows,
    measured: ratios.length,
    utenBound: rows.filter((row) => row.tubBoundS === null).length,
    utenMaal: rows.filter((row) => !row.reaches).length,
    maxRatio: ratios.length === 0 ? null : Math.max(...ratios),
    overOne: ratios.filter((x) => x > 1).length,
    overMargin: ratios.filter((x) => x > 1 + marginFrac).length,
    prunedBoundMembers: rows.filter((row) => row.prunedBound > 0).length,
  };
}

function report(g: GapSummary): void {
  const share = (n: number): string =>
    g.measured === 0
      ? "n/a"
      : `${n}/${g.measured} (${((100 * n) / g.measured).toFixed(1)} %)`;
  const worst = [...g.rows]
    .filter((row) => row.ratio !== null)
    .sort((a, b) => b.ratio! - a.ratio! || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map(
      (row) =>
        `${row.id}=${row.ratio!.toFixed(3)}` +
        ` (T*=${(row.durationS / 3600).toFixed(2)} t,` +
        ` Tub=${(row.tubBoundS! / 3600).toFixed(2)} t)`,
    );
  const lines = [
    `--- D9.3 gapmåling T*/Tub: ${g.name} (robusthet.md §7 D9.3) ---`,
    `medlemmer: ${g.rows.length}  |  målt (bound + mål): ${g.measured}` +
      `  |  uten bound: ${g.utenBound}  |  uten mål: ${g.utenMaal}`,
    `medlemmer der bounden beskar (pruned.bound > 0): ${g.prunedBoundMembers}`,
    `maks ratio: ${g.maxRatio === null ? "n/a" : g.maxRatio.toFixed(4)}`,
    `andel > 1,00: ${share(g.overOne)}`,
    `andel > ${(1 + g.marginFrac).toFixed(2)} (tubMarginFrac): ${share(g.overMargin)}`,
    `5 største: ${worst.join("  ")}`,
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

/**
 * Den forhåndsregistrerte hypotesen, som hard assertion.
 *
 * Merk at `> 1,00` **ikke** assertes: den er selve funnet D9.3 beskriver, og
 * tallet skal leses, ikke fastholdes. Det er marginbruddet som er farlig.
 */
function assertWithinMargin(g: GapSummary): void {
  const violators = g.rows
    .filter((row) => row.ratio !== null && row.ratio > 1 + g.marginFrac)
    .map((row) => `${row.id}: ratio=${row.ratio!.toFixed(4)}`);
  expect(
    violators,
    `${g.name}: Tub-bounden er mer enn tubMarginFrac for stram — ` +
      "en lovlig rute kan ha blitt beskåret (D9.3)",
  ).toEqual([]);
}

describe("D9.3 — gapmåling av motorens Tub-bound", () => {
  it("S-1 slør-referanse: 30 medlemmer", () => {
    const g = gapOf(s1SlorEnsemble());
    report(g);
    expect(g.rows.length).toBe(30);
    assertWithinMargin(g);
  }, 600_000);

  it("S-3 frontpassasje: 30 medlemmer", () => {
    const g = gapOf(s3FrontEnsemble());
    report(g);
    expect(g.rows.length).toBe(30);
    assertWithinMargin(g);
  }, 600_000);

  it("S-5 avgangsvindu: 30 medlemmer", () => {
    const g = gapOf(s5DepartureWindowEnsemble());
    report(g);
    assertWithinMargin(g);
  }, 600_000);

  it("S-7 to-regime: 30 medlemmer", () => {
    const g = gapOf(s7TwoRegimeEnsemble());
    report(g);
    expect(g.rows.length).toBe(30);
    assertWithinMargin(g);
  }, 600_000);

  it("S-8 vind mot strøm: 30 medlemmer", () => {
    const g = gapOf(s8WindAgainstCurrentEnsemble());
    report(g);
    assertWithinMargin(g);
  }, 600_000);
});
