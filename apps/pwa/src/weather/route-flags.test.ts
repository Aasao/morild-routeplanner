/**
 * Review-funn (fase 3 bølge 2, sikkerhetssemantikk): `displayFlagsForStepFlag`
 * satte tidligere `severity: "info"` for ALLE `RouteStep.flagNames`, også
 * sikkerhetsflaggene — et brudd på CLAUDE.md §1 ("usikker rute merkes
 * eksplisitt"). Denne testen låser klassifiseringstabellen i
 * `route-flags.ts` — se tabellen der for begrunnelsen per flagg.
 */
import { describe, expect, it } from "vitest";
import { FLAG_NAMES } from "@morild/routing";
import { allDisplayFlags, coverageFlags, displayFlagsForStepFlag } from "./route-flags.js";
import { fakeResult } from "./test-support/fake-route-result.js";

const SAFETY_FLAGS = [
  "USIKKER_TILLIT",
  "SJOEGANGS_MARGIN_OVERSKREDET",
  "NEGATIV_VANNSTAND_RISIKO",
  "SJOEGANG_DATA_MANGLER",
  // Rute-nivå (D7.2): søket ble begrenset av manglende flisdekning.
  "VAERDEKNING_BEGRENSET",
  // D15.1/D15.2 (strom-produsent.md §4b): strøm manglet ved sluttetappen / kystnær strøm.
  "STROM_DATA_MANGLER",
  // ADR-0008: rute-nivå, strømmodellen har ingen verdi i målet.
  "STROM_UKJENT_VED_ANKOMST",
  "STROM_KYSTSONE",
  // punktbolge.md §4: bølgen lånt fra et varselpunkt 5–20 / over 20 nm unna.
  "BOLGE_PUNKT_KATEGORI_5_20NM",
  "BOLGE_PUNKT_KATEGORI_OVER_20NM",
] as const;

const CONTEXT_FLAGS = [
  "MOTOR",
  "NATT",
  "KRYSS",
  "VIND_MOT_STROM",
  "TSS_LANGS",
  // Normaltilstanden for punktbølge; periodens ukjenthet står i bølgeteksten.
  "BOLGE_PUNKT_KATEGORI_UNDER_5NM",
] as const;

describe("displayFlagsForStepFlag — alvorlighet", () => {
  it.each(SAFETY_FLAGS)("%s er warning (berører farbarhet/klaring/datamangel)", (name) => {
    expect(displayFlagsForStepFlag(name).severity).toBe("warning");
  });

  it.each(CONTEXT_FLAGS)("%s er info (rent seilings-/kontekstflagg)", (name) => {
    expect(displayFlagsForStepFlag(name).severity).toBe("info");
  });

  it("dekker ALLE flaggnavn motoren faktisk kan sette (`FLAG_NAMES` i packages/routing)", () => {
    const known = new Set([...SAFETY_FLAGS, ...CONTEXT_FLAGS]);
    for (const [, name] of FLAG_NAMES) {
      expect(known.has(name as (typeof SAFETY_FLAGS)[number] | (typeof CONTEXT_FLAGS)[number])).toBe(true);
    }
    // Og omvendt — ingen "spøkelsesflagg" i testen som motoren ikke lenger setter.
    expect(known.size).toBe(FLAG_NAMES.length);
  });

  it("ukjent/fremtidig flaggnavn klassifiseres warning som konservativt standardvalg", () => {
    expect(displayFlagsForStepFlag("ET_FREMTIDIG_FLAGG_INGEN_KJENNER").severity).toBe("warning");
  });
});

describe("coverageFlags — horisont vs. delvis felt (§19 2026-09-29), rute vs. søk (ADR-0008)", () => {
  function withCoverage(opts: {
    readonly route: "full" | "partial";
    readonly search: "full" | "partial";
    readonly reached: boolean;
    readonly noWeather?: number;
  }) {
    const base = fakeResult({
      weatherCoverage: opts.route,
      searchWeatherCoverage: opts.search,
      reachesDestination: opts.reached,
    });
    return {
      ...base,
      diagnostics: { ...base.diagnostics, pruned: { ...base.diagnostics.pruned, noWeather: opts.noWeather ?? 0 } },
    };
  }

  it("ikke nådd: «Værfeltet tok slutt» KUN når søket faktisk forkastet etiketter for manglende vær", () => {
    const flags = coverageFlags(withCoverage({ route: "full", search: "partial", reached: false, noWeather: 3 }));
    expect(flags.map((f) => f.code)).toEqual(["VAER_DEKNING_PARTIAL"]);
    expect(flags[0]!.label).toMatch(/^Værfeltet tok slutt før ruten var ferdig beregnet/);
  });

  it("ikke nådd, søket partial uten noWeather ⇒ egen tekst: strøm/bølge mangler i søkeområdet, inkonklusiv", () => {
    const flags = coverageFlags(withCoverage({ route: "full", search: "partial", reached: false }));
    expect(flags.map((f) => f.code)).toEqual(["VAER_DEKNING_SOK_DELVIS_FELT"]);
    expect(flags[0]!.label).toBe(
      "Strøm og/eller bølge manglet i deler av søkeområdet — inkonklusiv, ikke ugjennomførbar (ADR-0005/ADR-0008)",
    );
    expect(flags[0]!.label).not.toMatch(/tok slutt/);
    expect(flags[0]!.severity).toBe("warning");
  });

  it("nådd, rutens steg manglet felt ⇒ advarsel om rutens egne steg (samme felt som klassifiseringen leser)", () => {
    const flags = coverageFlags(withCoverage({ route: "partial", search: "partial", reached: true, noWeather: 3 }));
    expect(flags.map((f) => f.code)).toEqual(["VAER_DEKNING_DELVIS_FELT"]);
    expect(flags[0]!.label).toMatch(/rutens egne steg/);
    expect(flags[0]!.label).not.toMatch(/tok slutt/);
    expect(flags[0]!.severity).toBe("warning");
  });

  it("nådd, hull KUN utenfor ruten ⇒ bare info — ruten er regnet med fullt felt (ADR-0008)", () => {
    const flags = coverageFlags(withCoverage({ route: "full", search: "partial", reached: true }));
    expect(flags.map((f) => f.code)).toEqual(["VAER_DEKNING_SOK_UTENFOR_RUTE"]);
    expect(flags[0]!.severity).toBe("info");
  });

  it("full dekning ⇒ ingen værdekningsflagg", () => {
    expect(coverageFlags(fakeResult({ weatherCoverage: "full" }))).toEqual([]);
    expect(coverageFlags(fakeResult({ weatherCoverage: "full", reachesDestination: false }))).toEqual([]);
  });
});

describe("ADR-0008-flaggene — synlig tekst der ruten leses", () => {
  it("STROM_DATA_MANGLER gjelder ethvert rutesteg, ikke bare sluttetappen", () => {
    const flag = displayFlagsForStepFlag("STROM_DATA_MANGLER");
    expect(flag.label).toMatch(/minst ett steg langs ruten/);
    expect(flag.label).not.toMatch(/sluttetappen/);
    expect(flag.severity).toBe("warning");
  });

  it("STROM_UKJENT_VED_ANKOMST (rute-nivå) vises med egen tekst og som warning", () => {
    const base = fakeResult({});
    const result = { ...base, flagNames: ["STROM_UKJENT_VED_ANKOMST"] };
    const flags = allDisplayFlags(result, []);
    const flag = flags.find((f) => f.code === "STROM_UKJENT_VED_ANKOMST");
    expect(flag).toBeDefined();
    expect(flag!.label).toMatch(/^Strøm ukjent ved ankomst/);
    expect(flag!.severity).toBe("warning");
  });

  it("SJOEGANG_DATA_MANGLER sier at Hs er ukjent, ikke 0 m (vedtak A)", () => {
    expect(displayFlagsForStepFlag("SJOEGANG_DATA_MANGLER").label).toMatch(/ukjent der \(ikke 0 m\)/);
  });
});

describe("STROM_KYSTSONE (D15.2) — synlig tekst der ruten leses", () => {
  it("ordlyden fra strom-produsent.md §4b, uten noen nøyaktighet i meter", () => {
    const flag = displayFlagsForStepFlag("STROM_KYSTSONE");
    expect(flag.label).toBe(
      "Strøm nær land: verdien er lånt fra nærmeste sjøcelle i 800 m-modellen — retningen kan være upålitelig eller komme fra feil side i trange sund.",
    );
    expect(flag.label).not.toMatch(/\d+\s*m\b(?!-modellen)/);
    expect(flag.severity).toBe("warning");
  });

  it("vises én gang selv om flagget står både på ruten og på stegene", () => {
    const base = fakeResult({});
    const step = { ...base.steps[0]!, flags: 0, flagNames: ["STROM_KYSTSONE"] };
    const result = { ...base, flagNames: ["STROM_KYSTSONE"], steps: [step, { ...step }] };
    const flags = allDisplayFlags(result, []);
    expect(flags.filter((f) => f.code === "STROM_KYSTSONE")).toHaveLength(1);
  });
});
