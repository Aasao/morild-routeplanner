/**
 * **Delt A\*-felt — bit-identitet** (`docs/specs/robusthet.md` §5.3 siste
 * setning, §4.1; `rutemotor.md` §5.5).
 *
 * Feltet er væruavhengig geometri. Robusthetslaget skal bygge det ÉN gang per
 * `(start, mål, maskeversjon, feltoppløsning)` og sende det til alle
 * ensemble-medlemmer og alle avganger, i stedet for å la hvert av 31 × 5–8
 * søk bygge det på nytt. Den besparelsen er bare lovlig hvis den er
 * **usynlig**: et medlem som fikk feltet utenfra må gi nøyaktig samme
 * `RouteResult` som et medlem som bygget sitt eget. Ellers ville
 * gjennomførbarhetsandelen avhengt av en ytelsesoptimalisering, og
 * ADR-0005s krav om at tallene kommer fra fulle, sammenlignbare søk ville
 * vært brutt.
 *
 * Testene her beviser tre ledd i den kjeden:
 *
 *  1. `buildFieldForInput` bygger med **nøyaktig samme parametre** som søkets
 *     eget `setUpField` (samme funksjon, ikke en kopi av parameterlisten).
 *  2. Et felt sendt inn via `RouteInput.field` gir bit-identisk resultat.
 *  3. Et felt som har vært gjennom `DistanceFieldData`-overføringen —
 *     `structuredClone` av `field.data`, som er nøyaktig det `postMessage`
 *     gjør mellom to workere — gir også bit-identisk resultat.
 *
 * Ledd 3 er ikke pedanteri: `Float64Array` overlever structured clone, men
 * hadde feltet vært lagret i `Float32Array` (v1s feil, se `distance-field.ts`)
 * ville avrundingen ved rekonstruksjon vært en ny kilde til avvik.
 */
import { describe, expect, it } from "vitest";
import { goldenScenarios } from "../test-fixtures/golden-scenarios.js";
import { maskAsEdgeGate, OPEN_EDGE_GATE } from "./contracts.js";
import { buildDistanceField, DistanceField } from "./distance-field.js";
import type { DistanceFieldData } from "./distance-field.js";
import type { RouteResult } from "./result.js";
import { buildFieldForInput, createSearch, planRoute } from "./search.js";
import type { RouteInput } from "./search.js";

/**
 * Simulerer worker-hoppet: bare `field.data` sendes, og mottakeren
 * rekonstruerer. `structuredClone` er den samme algoritmen `postMessage`
 * bruker — vi later ikke som om en delt referanse er en overføring.
 */
function throughWorkerBoundary(field: DistanceField): DistanceField {
  const data: DistanceFieldData = structuredClone(field.data);
  return new DistanceField(data);
}

describe("delt A*-felt (robusthet.md §5.3, §4.1)", () => {
  const scenarios = goldenScenarios();

  it("buildFieldForInput bygger med samme parametre som søket selv", () => {
    for (const { name, input } of scenarios) {
      const fromHelper = buildFieldForInput(input);
      // Den eksplisitte parameterlisten §5.5 beskriver, skrevet ut for hånd.
      // Driver `setUpField` fra hjelperen, skal denne bli rød først.
      const gate =
        input.mask === undefined ? OPEN_EDGE_GATE : maskAsEdgeGate(input.mask);
      const manual = buildDistanceField(input.start, input.dest, gate);
      expect(fromHelper === undefined, name).toBe(manual === undefined);
      if (fromHelper === undefined || manual === undefined) continue;
      expect(fromHelper.data.lat0, name).toBe(manual.data.lat0);
      expect(fromHelper.data.lon0, name).toBe(manual.data.lon0);
      expect(fromHelper.data.cellDeg, name).toBe(manual.data.cellDeg);
      expect(fromHelper.data.width, name).toBe(manual.data.width);
      expect(fromHelper.data.height, name).toBe(manual.data.height);
      expect(Array.from(fromHelper.data.d), name).toEqual(
        Array.from(manual.data.d),
      );
    }
  }, 120_000);

  it("er idempotent: et allerede oppgitt felt returneres urørt", () => {
    const input = scenarios[0]!.input;
    const field = buildFieldForInput(input)!;
    expect(field).toBeDefined();
    expect(buildFieldForInput({ ...input, field })).toBe(field);
  }, 60_000);

  /**
   * Kjernekravet, i begge ledd på én kjøring per scenario: `RouteResult` er
   * ren data (§4.8), så JSON-likhet ER bit-likhet her — samme
   * sammenligningsregel determinismetestene bruker.
   *
   * Én test per scenario (ikke én løkke): tre fulle søk × alle scenarioer i
   * én test sprengte 180 s under full-suite-parallellitet 2026-09-27
   * (CPU-konkurranse, ikke regresjon — 4 min alene).
   */
  for (const { name, input } of scenarios) {
    it(`gir bit-identisk RouteResult med felt, uten felt og etter overføring — ${name}`, () => {
      const utenFelt: RouteResult = planRoute(input);
      const field = buildFieldForInput(input);

      const medFelt = planRoute({ ...input, field });
      expect(JSON.stringify(medFelt), `${name}: delt felt`).toBe(
        JSON.stringify(utenFelt),
      );
      // `provenance` er inngangens, ikke feltets.
      expect(medFelt.provenance, name).toBe("planRoute");

      if (field === undefined) return;
      const overfoert = planRoute({
        ...input,
        field: throughWorkerBoundary(field),
      });
      expect(JSON.stringify(overfoert), `${name}: etter worker-hoppet`).toBe(
        JSON.stringify(utenFelt),
      );
    }, 180_000);
  }

  /**
   * Feltet skal kunne deles av **flere** søk uten at det første søket setter
   * spor i det. Det er en lesekun-kontrakt: bygger vi den ikke inn i testen,
   * er «send samme felt til 30 medlemmer» en antagelse og ikke et bevis.
   */
  it("er uendret etter bruk — samme instans kan deles av flere søk", () => {
    const { input } = scenarios[0]!;
    const field = buildFieldForInput(input)!;
    const before = Array.from(field.data.d);
    const a = planRoute({ ...input, field });
    const b = planRoute({ ...input, field });
    expect(Array.from(field.data.d)).toEqual(before);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 120_000);
});

/**
 * `provenance` er ADR-0005s bekreftelseskrav gjort strukturelt (D8.8):
 * robusthetslaget skal kunne se på et `RouteResult` alene og avgjøre om det
 * kom fra et fullt søk. Testene her fastholder at **kun** de to inngangene
 * setter de to anerkjente verdiene.
 */
describe("provenance (robusthet.md §3.1 pkt. 1)", () => {
  const input: RouteInput = goldenScenarios()[0]!.input;

  it("settes til planRoute av planRoute", () => {
    expect(planRoute(input).provenance).toBe("planRoute");
  }, 60_000);

  it("settes til createSearch av createSearch — også i snapshot()", () => {
    const search = createSearch(input);
    expect(search.snapshot().provenance).toBe("createSearch");
    search.advance(3);
    expect(search.snapshot().provenance).toBe("createSearch");
    expect(search.finish().provenance).toBe("createSearch");
  }, 60_000);

  /**
   * Det progressive API-et er samme søk som `planRoute`, bare kjørt i
   * porsjoner — ellers ville `provenance` skilt to resultater som skal være
   * like (§5.6).
   */
  it("gir ellers bit-identisk resultat fra de to inngangene", () => {
    const viaPlan = planRoute(input);
    const viaSearch = createSearch(input).finish();
    expect(JSON.stringify({ ...viaSearch, provenance: "planRoute" })).toBe(
      JSON.stringify(viaPlan),
    );
  }, 120_000);
});
