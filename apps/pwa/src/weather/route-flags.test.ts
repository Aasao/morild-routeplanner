/**
 * Review-funn (fase 3 bølge 2, sikkerhetssemantikk): `displayFlagsForStepFlag`
 * satte tidligere `severity: "info"` for ALLE `RouteStep.flagNames`, også
 * sikkerhetsflaggene — et brudd på CLAUDE.md §1 ("usikker rute merkes
 * eksplisitt"). Denne testen låser klassifiseringstabellen i
 * `route-flags.ts` — se tabellen der for begrunnelsen per flagg.
 */
import { describe, expect, it } from "vitest";
import { FLAG_NAMES } from "@morild/routing";
import { allDisplayFlags, displayFlagsForStepFlag } from "./route-flags.js";
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
  "STROM_KYSTSONE",
] as const;

const CONTEXT_FLAGS = ["MOTOR", "NATT", "KRYSS", "VIND_MOT_STROM", "TSS_LANGS"] as const;

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
