import { describe, expect, it } from "vitest";
import type { LatLon } from "@morild/geo";
import { crossTrackNm } from "@morild/geo";
import type { BailoutProfile } from "@morild/routing";
import type { DecisionAdvice, DecisionRule } from "./decision-rule.js";
import type { InconclusiveReason, MemberOutcome, MemberSummary, OutcomeKind } from "./outcome.js";
import { buildFanBand, buildFirstPage, type FirstPageInput, type FirstPageLine } from "./presentation.js";
import { summarizeDeparture, type DepartureSummary, type RobustnessStamp } from "./summary.js";
import type { ThresholdSpec } from "./traffic-light.js";

const DEPART_EPOCH_S = 1_700_000_000;
const HOUR_S = 3600;

const STAMP: RobustnessStamp = {
  maskVersion: "test-mask-1",
  packageId: "test-package-1",
  packageInitEpochS: DEPART_EPOCH_S - HOUR_S,
  memberAgesS: [HOUR_S, HOUR_S * 2],
  optionsHash: "test-hash",
  estimator: "naermeste-rang-v1",
  thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
};

function makeSummary(overrides: Partial<MemberSummary> = {}): MemberSummary {
  const durationS = overrides.durationS ?? HOUR_S * 10;
  return {
    durationS,
    distanceNm: 60,
    beatS: 0,
    motorS: 0,
    nightS: 0,
    beatAtNightS: 0,
    fuelL: 40,
    arrivalEpochS: DEPART_EPOCH_S + durationS,
    departEpochS: DEPART_EPOCH_S,
    daylightArrival: true,
    flags: 0,
    safetyVerdict: "trygt",
    coverageWeather: "full",
    prunedBound: 0,
    tubBoundS: null,
    hourlyTrack: [],
    ...overrides,
  };
}

function outcome(
  memberIndex: number,
  kind: OutcomeKind,
  overrides: Partial<MemberSummary> = {},
  inconclusiveReason?: InconclusiveReason,
): MemberOutcome {
  return {
    memberIndex,
    kind,
    summary: makeSummary(overrides),
    ...(inconclusiveReason !== undefined ? { inconclusiveReason } : {}),
  };
}

function errorOutcome(memberIndex: number): MemberOutcome {
  return { memberIndex, kind: "error", summary: null, error: "worker-feil (test)" };
}

interface MemberSpec {
  readonly nF: number;
  readonly nInf: number;
  readonly nInc: number;
  readonly nErr: number;
  readonly inconclusiveReason?: InconclusiveReason;
}

function buildMembers(spec: MemberSpec): MemberOutcome[] {
  const members: MemberOutcome[] = [];
  let idx = 1;
  for (let i = 0; i < spec.nF; i++) members.push(outcome(idx++, "feasible", { durationS: HOUR_S * (10 + i) }));
  for (let i = 0; i < spec.nInf; i++) members.push(outcome(idx++, "infeasible"));
  for (let i = 0; i < spec.nInc; i++) {
    members.push(outcome(idx++, "inconclusive", {}, spec.inconclusiveReason ?? "dekning"));
  }
  for (let i = 0; i < spec.nErr; i++) members.push(errorOutcome(idx++));
  return members;
}

function buildDeparture(
  spec: MemberSpec,
  opts: {
    readonly expectedMembers?: number;
    readonly control?: MemberOutcome;
    readonly thresholds?: readonly ThresholdSpec[];
  } = {},
): DepartureSummary {
  const members = buildMembers(spec);
  const control = opts.control ?? outcome(0, "feasible");
  return summarizeDeparture({
    departEpochS: DEPART_EPOCH_S,
    control,
    members,
    expectedMembers: opts.expectedMembers ?? members.length,
    thresholds: opts.thresholds ?? [],
    stamp: STAMP,
  });
}

function makeBailout(overrides: Partial<BailoutProfile> = {}): BailoutProfile {
  return {
    samples: [],
    longestGapS: HOUR_S * 2,
    coverage: "full",
    basis: "kontrollvaer",
    label: "kontrollvær — ikke ensemble-sjekket",
    sampleIntervalS: 1800,
    limitS: 21600,
    missingDepthHarbourIds: [],
    missingFieldHarbourIds: [],
    searchCount: 0,
    fieldScreenedSamples: 0,
    fieldScreenedCandidates: 0,
    ...overrides,
  };
}

const FALLBACK_ADVICE: DecisionAdvice = { kind: "fallback", text: "Fallback-tekst (test)." };

function makeRegelAdvice(overrides: Partial<DecisionRule> = {}): DecisionAdvice {
  return {
    kind: "regel",
    rule: {
      checkEpochS: DEPART_EPOCH_S + HOUR_S * 4,
      position: { lat: 58.205, lon: 10.76 },
      test: "nord",
      explanation: "",
      hitRate: { k: 28, n: 30 },
      concordance: 0.9,
      action: "Vent til neste vindu, eller revurder ruten hvis vinduet ikke kommer.",
      ...overrides,
    },
  };
}

function baseInput(summary: DepartureSummary, overrides: Partial<FirstPageInput> = {}): FirstPageInput {
  return {
    summary,
    advice: FALLBACK_ADVICE,
    sensitivity: null,
    bailout: makeBailout(),
    packageAgeS: 0,
    staleAfterS: HOUR_S * 6,
    thresholds: [],
    ...overrides,
  };
}

function linesOf(page: { readonly lines: readonly FirstPageLine[] }): readonly FirstPageLine[] {
  return page.lines;
}

// ---------------------------------------------------------------------------
// §4.7 «ærlig degradering» — tabellen rad for rad. Én test per rad (9 rader).
// ---------------------------------------------------------------------------
describe("buildFirstPage — §4.7 ærlig degradering, tabellen rad for rad", () => {
  it("inkonklusiv kontroll MED rute (dekning-felt) gir IKKE «ingen kontrollrute å tegne» (målt 2026-09-08)", () => {
    const control = outcome(0, "inconclusive", { hourlyTrack: [{ lat: 59.1, lon: 10.9 }, { lat: 58.9, lon: 10.8 }] }, "dekning-felt");
    const summary = buildDeparture({ nF: 0, nInf: 0, nInc: 29, nErr: 0 }, { control });
    const texts = linesOf(buildFirstPage(baseInput(summary))).map((l) => l.text);
    expect(texts.some((t) => t.includes("Ingen kontrollrute å tegne"))).toBe(false);
  });

  it("kontroll uten rutegeometri (tomt spor) ⇒ «ingen kontrollrute å tegne»", () => {
    const control = outcome(0, "error", { hourlyTrack: [] });
    const summary = buildDeparture({ nF: 20, nInf: 5, nInc: 4, nErr: 0 }, { control });
    const texts = linesOf(buildFirstPage(baseInput(summary))).map((l) => l.text);
    expect(texts.some((t) => t.includes("Ingen kontrollrute å tegne"))).toBe(true);
  });

  it("rad 1b (review bølge 5): pakkealder ukjent (null) ⇒ ingen robusthetstall, aldri tolket som fersk", () => {
    const summary = buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 });
    const page = buildFirstPage(baseInput(summary, { packageAgeS: null }));
    expect(page.lines).toHaveLength(1);
    expect(page.lines[0]?.severity).toBe("kritisk");
    expect(page.lines[0]?.text).toContain("Pakkealder ukjent");
  });

  it("sikkerhetsflagg (review bølge 5): kontroll merket usikker-rute ⇒ kritisk varsellinje; usikre gjennomførbare telles", () => {
    const control = { ...outcome(0, "feasible"), summary: makeSummary({ safetyVerdict: "usikker-rute" }) };
    const summary = buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 }, { control });
    const texts = linesOf(buildFirstPage(baseInput(summary))).map((l) => l.text);
    expect(texts.some((t) => t.includes("USIKKER RUTE"))).toBe(true);
    const unsafeMembers = buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 });
    const patched = {
      ...unsafeMembers,
      members: unsafeMembers.members.map((m, i) =>
        i < 3 && m.kind === "feasible" && m.summary !== null
          ? { ...m, summary: { ...m.summary, safetyVerdict: "usikkert" as const } }
          : m,
      ),
    };
    const texts2 = linesOf(buildFirstPage(baseInput(patched))).map((l) => l.text);
    expect(texts2.some((t) => t.includes("3 av 27 gjennomførbare medlemmer har rute merket usikker"))).toBe(true);
  });

  it("bail-out-gapet rundes OPP til 0,1 t (review bølge 5): 2,04 t ⇒ «2,1 t»", () => {
    const summary = buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 });
    const page = buildFirstPage(baseInput(summary, { bailout: makeBailout({ longestGapS: Math.round(2.04 * HOUR_S) }) }));
    const bail = linesOf(page).find((l) => l.kind === "bailout");
    expect(bail?.text).toContain("2,1 t");
  });

  it("rad 1: pakke for gammel ⇒ ingen robusthetstall, kun «prognose N t gammel»", () => {
    const summary = buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 });
    const page = buildFirstPage(
      baseInput(summary, { packageAgeS: HOUR_S * 10, staleAfterS: HOUR_S * 6 }),
    );
    expect(page.lines).toHaveLength(1);
    expect(page.lines[0]?.kind).toBe("varsel");
    expect(page.lines[0]?.severity).toBe("kritisk");
    expect(page.lines[0]?.text).toContain("10 t gammel");
    expect(page.lines[0]?.text).not.toContain("Grønt");
    expect(page.lines[0]?.text).not.toContain("Rødt");
  });

  it("rad 2: dekning partial > 20 % (nF+nInf > 0) ⇒ gul «horisont for kort», andel likevel vist", () => {
    // nF=5, nInf=2 ⇒ s = 5/7 ≈ 0,71 (over rød-terskelen), nInc=8/15 > 0,2.
    const summary = buildDeparture({ nF: 5, nInf: 2, nInc: 8, nErr: 0 }, { expectedMembers: 15 });
    expect(summary.horizonTooShort).toBe(true);
    expect(summary.complete).toBe(true);
    const page = buildFirstPage(baseInput(summary));
    const lys = linesOf(page).find((l) => l.kind === "lys");
    expect(lys?.text).toContain("horisont");
    // «andel alltid vist»: plantid-linjen skal IKKE være undertrykt.
    const plantid = linesOf(page).find((l) => l.kind === "plantid");
    expect(plantid?.text).toMatch(/Regn med inntil|Framme før mørket/);
    const varsel = linesOf(page).find((l) => l.text.includes("Horisonten er for kort"));
    expect(varsel).toBeDefined();
  });

  it("rad 3: nErr > 0 ⇒ eget flagg «k medlemmer feilet i beregningen», aldri i nevneren", () => {
    const summary = buildDeparture({ nF: 20, nInf: 5, nInc: 2, nErr: 3 }, { expectedMembers: 30 });
    const page = buildFirstPage(baseInput(summary));
    const varsel = linesOf(page).find((l) => l.text.includes("feilet i beregningen"));
    expect(varsel?.text).toBe("3 medlemmer feilet i beregningen.");
    // Ikke i nevneren: feasibleShare regnes kun av nF/(nF+nInf).
    expect(summary.feasibleShare).toBeCloseTo(20 / 25, 10);
  });

  it("rad 4: nF < 12 ⇒ «verste av nF gjennomførbare» + tynt-utvalg, ordet P90 aldri", () => {
    const summary = buildDeparture({ nF: 8, nInf: 1, nInc: 0, nErr: 0 }, { expectedMembers: 9 });
    const page = buildFirstPage(baseInput(summary));
    const plantid = linesOf(page).find((l) => l.kind === "plantid");
    expect(plantid?.text).toContain("(verste av 8 gjennomførbare)");
    expect(plantid?.text).not.toContain("P90");
    const varsel = linesOf(page).find((l) => l.text.startsWith("Tynt utvalg"));
    expect(varsel?.text).toBe("Tynt utvalg (8 gjennomførbare).");
  });

  it("rad 5: kontrollen feiler ⇒ «ingen kontrollrute å tegne»", () => {
    const control = outcome(0, "infeasible");
    const summary = buildDeparture({ nF: 20, nInf: 5, nInc: 2, nErr: 3 }, { expectedMembers: 30, control });
    const page = buildFirstPage(baseInput(summary));
    const varsel = linesOf(page).find((l) => l.text.includes("Ingen kontrollrute å tegne"));
    expect(varsel).toBeDefined();
    expect(varsel?.severity).toBe("kritisk");
  });

  it("rad 6: havnebok tom/uten dybde ⇒ coverage none/partial med tekst, aldri «ingen alternativ»", () => {
    const summary = buildDeparture({ nF: 25, nInf: 3, nInc: 1, nErr: 1 }, { expectedMembers: 30 });

    const pageNone = buildFirstPage(baseInput(summary, { bailout: makeBailout({ coverage: "none", longestGapS: null }) }));
    const bailoutNone = linesOf(pageNone).find((l) => l.kind === "bailout");
    expect(bailoutNone?.text).toContain("havnebok mangler dekning her");
    expect(bailoutNone?.text).not.toContain("ingen alternativ");

    const pagePartial = buildFirstPage(
      baseInput(summary, {
        bailout: makeBailout({ coverage: "partial", missingDepthHarbourIds: ["h1"] }),
      }),
    );
    const bailoutPartial = linesOf(pagePartial).find((l) => l.kind === "bailout");
    expect(bailoutPartial?.text).toContain("dekker ikke alle havner");
    expect(bailoutPartial?.text).not.toContain("ingen alternativ");
  });

  it("rad 7: delt Tub avslått/redningsvei kjørt ⇒ ingen synlig forskjell i førstesiden", () => {
    // MemberSummary er (per §5.3-skademålingen) bit-identisk uansett delt
    // Tub/redningsvei — kun `tubBoundS`/`prunedBound` kan i teorien variere,
    // og INGEN av dem leses av presentasjonslaget. To ellers identiske
    // summaries som bare skiller seg på disse to feltene skal derfor gi
    // bit-identisk `FirstPage`.
    const membersA = buildMembers({ nF: 10, nInf: 2, nInc: 1, nErr: 0 }).map((m) =>
      m.summary === null ? m : { ...m, summary: { ...m.summary, tubBoundS: null, prunedBound: 0 } },
    );
    const membersB = buildMembers({ nF: 10, nInf: 2, nInc: 1, nErr: 0 }).map((m) =>
      m.summary === null ? m : { ...m, summary: { ...m.summary, tubBoundS: HOUR_S * 14, prunedBound: 0.4 } },
    );
    const control = outcome(0, "feasible");
    const summaryA = summarizeDeparture({
      departEpochS: DEPART_EPOCH_S,
      control,
      members: membersA,
      expectedMembers: membersA.length,
      thresholds: [],
      stamp: STAMP,
    });
    const summaryB = summarizeDeparture({
      departEpochS: DEPART_EPOCH_S,
      control,
      members: membersB,
      expectedMembers: membersB.length,
      thresholds: [],
      stamp: STAMP,
    });
    const pageA = buildFirstPage(baseInput(summaryA));
    const pageB = buildFirstPage(baseInput(summaryB));
    expect(pageA.lines).toEqual(pageB.lines);
    expect(pageA.behindTap).toEqual(pageB.behindTap);
  });

  it("rad 8: perturbasjon mangler (tidsnød) ⇒ «følsomhet ikke beregnet», aldri antatt", () => {
    const summary = buildDeparture({ nF: 20, nInf: 5, nInc: 2, nErr: 3 }, { expectedMembers: 30 });
    const page = buildFirstPage(baseInput(summary, { sensitivity: "ikke-beregnet" }));
    const varsel = linesOf(page).find((l) => l.text === "Følsomhet ikke beregnet.");
    expect(varsel).toBeDefined();
  });

  it("rad 9: progressiv beregning (bare topp-avgang ferdig) ⇒ aldri blank, viser «Beregner (k av N) …»", () => {
    // §4.7 pkt. 1: «Under beregning: 'Beregner (k av 30) …', aldri blank.»
    // Den øvrige rangerte lista sin «foreløpig (kontroll)»-merking er
    // `ranking.ts`s ansvar (`RankedDeparture.provisional`, se
    // `ranking.test.ts`) — presentation.ts sin del av samme prinsipp er at
    // ÉN avgangs egen førsteside aldri er taus mens den fortsatt beregnes.
    const summary = buildDeparture({ nF: 5, nInf: 2, nInc: 1, nErr: 0 }, { expectedMembers: 30 });
    expect(summary.complete).toBe(false);
    const page = buildFirstPage(baseInput(summary));
    const lys = linesOf(page).find((l) => l.kind === "lys");
    expect(lys?.text).toMatch(/^Beregner \(8 av 30\) …$/);
  });
});

// ---------------------------------------------------------------------------
// (ii) §4.7 pkt. 1–6 rekkefølge
// ---------------------------------------------------------------------------
describe("buildFirstPage — rekkefølge §4.7 pkt. 1–6", () => {
  it("lys, plantid, regel, dekning, bailout, deretter varsler i fast rekkefølge", () => {
    const control = outcome(0, "infeasible"); // trigger «ingen kontrollrute»
    const members = [
      ...buildMembers({ nF: 8, nInf: 1, nInc: 0, nErr: 0 }), // nF < 12 ⇒ tynt-utvalg
      outcome(20, "inconclusive", {}, "dekning"), // løfter nInc for horisont
      outcome(21, "inconclusive", {}, "dekning"),
      outcome(22, "inconclusive", {}, "dekning-felt"),
      outcome(23, "inconclusive", {}, "dekning-felt"),
      errorOutcome(24),
      errorOutcome(25),
    ];
    const summary = summarizeDeparture({
      departEpochS: DEPART_EPOCH_S,
      control,
      members,
      expectedMembers: members.length,
      thresholds: [],
      stamp: STAMP,
    });
    expect(summary.complete).toBe(true);
    expect(summary.horizonTooShort).toBe(true);
    expect(summary.nErr).toBe(2);

    const page = buildFirstPage(baseInput(summary));
    const kinds = page.lines.map((l) => l.kind);
    expect(kinds).toEqual(["lys", "plantid", "regel", "dekning", "bailout", "varsel", "varsel", "varsel", "varsel", "varsel"]);

    const varselTexts = page.lines.filter((l) => l.kind === "varsel").map((l) => l.text);
    expect(varselTexts[0]).toContain("Tynt utvalg");
    expect(varselTexts[1]).toContain("Horisonten er for kort");
    expect(varselTexts[2]).toContain("Ingen kontrollrute å tegne");
    expect(varselTexts[3]).toContain("feilet i beregningen");
    expect(varselTexts[4]).toContain("kom fram uten fullt værfelt");
  });
});

// ---------------------------------------------------------------------------
// (iii) Ordet «P90» og tegnet «%» forekommer aldri i lines[].text
// ---------------------------------------------------------------------------
describe("buildFirstPage — P90/% forekommer aldri på førstesiden", () => {
  const scenarios: { readonly name: string; readonly summary: DepartureSummary; readonly input?: Partial<FirstPageInput> }[] = [
    { name: "grønn", summary: buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 }, { expectedMembers: 30, thresholds: [{ id: "moerke", label: "framme før mørket", passes: () => true }] }) },
    { name: "rød andel", summary: buildDeparture({ nF: 5, nInf: 20, nInc: 3, nErr: 2 }, { expectedMembers: 30 }) },
    { name: "rød tynt-grunnlag", summary: buildDeparture({ nF: 2, nInf: 3, nInc: 0, nErr: 0 }, { expectedMembers: 5 }) },
    { name: "gul andel", summary: buildDeparture({ nF: 13, nInf: 2, nInc: 0, nErr: 0 }, { expectedMembers: 15 }) },
    { name: "gul tynt-utvalg", summary: buildDeparture({ nF: 8, nInf: 1, nInc: 0, nErr: 0 }, { expectedMembers: 9 }) },
    { name: "gul inkonklusiv (ingen avgjorte)", summary: buildDeparture({ nF: 0, nInf: 0, nInc: 5, nErr: 0 }, { expectedMembers: 5 }) },
    { name: "gul inkonklusiv (horisont)", summary: buildDeparture({ nF: 5, nInf: 2, nInc: 8, nErr: 0 }, { expectedMembers: 15 }) },
    { name: "beregner", summary: buildDeparture({ nF: 5, nInf: 2, nInc: 1, nErr: 0 }, { expectedMembers: 30 }) },
    {
      name: "nF = 0",
      summary: buildDeparture({ nF: 0, nInf: 12, nInc: 0, nErr: 0 }, { expectedMembers: 12 }),
    },
    {
      name: "med regel-linje",
      summary: buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 }, { expectedMembers: 30 }),
      input: { advice: makeRegelAdvice() },
    },
    {
      name: "med følsomhet + konflikt",
      summary: buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 }, { expectedMembers: 30 }),
      input: { sensitivity: { runs: [], conflict: true, mostSensitive: null, label: "basert på kontrollvær" } },
    },
    { name: "pakke for gammel", summary: buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 }), input: { packageAgeS: HOUR_S * 20, staleAfterS: HOUR_S * 6 } },
  ];

  for (const scenario of scenarios) {
    it(`scenario «${scenario.name}» unngår P90 og %`, () => {
      const page = buildFirstPage(baseInput(scenario.summary, scenario.input));
      for (const l of page.lines) {
        expect(l.text).not.toContain("P90");
        expect(l.text).not.toContain("%");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// (iv) Terskelform vs. pessimistisk par
// ---------------------------------------------------------------------------
describe("buildFirstPage — plantid: terskelform vs. pessimistisk par (§4.2.2)", () => {
  it("terskel definert ⇒ terskeltellingen er primærsetningen", () => {
    const summary = buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 }, { expectedMembers: 30 });
    const page = buildFirstPage(
      baseInput(summary, { thresholds: [{ id: "moerke", label: "framme før mørket", k: 24, n: 27 }] }),
    );
    const plantid = page.lines.find((l) => l.kind === "plantid");
    expect(plantid?.text).toMatch(/^Framme før mørket i 24 av 27 utfall\. Hvis forsinket: opptil \d+ t\.$/);
  });

  it("ingen terskel ⇒ pessimistisk par («regn med inntil … typisk …»)", () => {
    const summary = buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 }, { expectedMembers: 30 });
    const page = buildFirstPage(baseInput(summary, { thresholds: [] }));
    const plantid = page.lines.find((l) => l.kind === "plantid");
    expect(plantid?.text).toMatch(/^Regn med inntil \d+ t, typisk \d+ t\.$/);
  });
});

// ---------------------------------------------------------------------------
// (v) Lokal tid — kjent epoketall i Europe/Oslo (sommertid)
// ---------------------------------------------------------------------------
describe("buildFirstPage — regel-linjen bruker lokal tid (Europe/Oslo, sommertid)", () => {
  it("2026-07-01T10:00:00Z (CEST, UTC+2) vises som 12:00", () => {
    const checkEpochS = Date.UTC(2026, 6, 1, 10, 0, 0) / 1000; // juli = måned 6 (0-indeksert)
    const summary = buildDeparture({ nF: 27, nInf: 1, nInc: 1, nErr: 1 }, { expectedMembers: 30 });
    const advice = makeRegelAdvice({ checkEpochS, position: { lat: 58.2051, lon: 10.7583 } });
    const page = buildFirstPage(baseInput(summary, { advice }));
    const regel = page.lines.find((l) => l.kind === "regel");
    expect(regel?.text).toContain("kl. 12:00");
    expect(regel?.text).toContain("N 58°12,3′ Ø 10°45,5′");
  });
});

// ---------------------------------------------------------------------------
// (vi) FanBand på syntetiske spor
// ---------------------------------------------------------------------------
describe("buildFanBand — syntetiske spor (§4.7 pkt. 7)", () => {
  const HOURS = 6; // kontrollspor h = 0..6 (7 punkter)
  const OFFSET_DEG = 0.5; // ~30 nm

  function track(lengthHours: number, latOffset: number): LatLon[] {
    return Array.from({ length: lengthHours + 1 }, (_, h) => ({ lat: 60 + latOffset, lon: 10 + h * 0.2 }));
  }

  const controlTrack: LatLon[] = Array.from({ length: HOURS + 1 }, (_, h) => ({ lat: 60, lon: 10 + h * 0.2 }));
  const control: MemberOutcome = outcome(0, "feasible", { hourlyTrack: controlTrack });

  // 3 gjennomførbare nord: N1, N2 (fulle spor), N3 (kort, slutter etter h=1).
  const n1 = outcome(1, "feasible", { hourlyTrack: track(HOURS, OFFSET_DEG) });
  const n2 = outcome(2, "feasible", { hourlyTrack: track(HOURS, OFFSET_DEG) });
  const n3 = outcome(3, "feasible", { hourlyTrack: track(1, OFFSET_DEG) });
  // 2 ugjennomførbare sør: S1 (slutter etter h=4), S2 (kort, slutter etter h=1).
  const s1 = outcome(4, "infeasible", { hourlyTrack: track(4, -OFFSET_DEG) });
  const s2 = outcome(5, "infeasible", { hourlyTrack: track(1, -OFFSET_DEG) });

  const members = [n1, n2, n3, s1, s2];

  it("gir riktige min/maks (nærmeste-rang) når ≥ 3 medlemmer har posisjon", () => {
    const fan = buildFanBand(control, members);
    expect(fan).not.toBeNull();
    const h0 = fan?.hours[0];
    expect(h0?.nMembers).toBe(5);
    expect(h0?.control).toEqual(controlTrack[0]);

    // Fasit regnet med samme funksjon (`crossTrackNm`) og samme
    // segmentvalg som `buildFanBand` (h=0 ⇒ segment (spor[0], spor[1])).
    const a = controlTrack[0]!;
    const b = controlTrack[1]!;
    const expectedDistances = members
      .map((m) => m.summary!.hourlyTrack[0]!)
      .map((p) => crossTrackNm(a, b, p))
      .sort((x, y) => x - y);
    expect(h0?.min).toBeCloseTo(expectedDistances[0]!, 6);
    expect(h0?.max).toBeCloseTo(expectedDistances[4]!, 6);
    expect(h0?.p50).toBeCloseTo(expectedDistances[2]!, 6);
  });

  it("gir eksakt 3 medlemmer ved grensen (fortsatt beregnet, ikke null)", () => {
    const fan = buildFanBand(control, members);
    const h3 = fan?.hours[3]; // N1, N2, S1 igjen — N3 og S2 sluttet etter h=1.
    expect(h3?.nMembers).toBe(3);
    expect(h3?.min).not.toBeNull();
    expect(h3?.max).not.toBeNull();
  });

  it("gir null når færre enn 3 medlemmer har posisjon ved timen", () => {
    const fan = buildFanBand(control, members);
    const h5 = fan?.hours[5]; // Kun N1, N2 igjen (S1 sluttet etter h=4).
    expect(h5?.nMembers).toBe(2);
    expect(h5?.min).toBeNull();
    expect(h5?.p10).toBeNull();
    expect(h5?.p50).toBeNull();
    expect(h5?.p90).toBeNull();
    expect(h5?.max).toBeNull();
    expect(h5?.control).toEqual(controlTrack[5]);
  });

  it("null for hele viften når kontrollen ikke har et spor med ≥ 2 punkter", () => {
    const noTrackControl = outcome(0, "feasible", { hourlyTrack: [] });
    expect(buildFanBand(noTrackControl, members)).toBeNull();
  });

  it("buildFirstPage inkluderer viften fra samme funksjon", () => {
    const summary = summarizeDeparture({
      departEpochS: DEPART_EPOCH_S,
      control,
      members,
      expectedMembers: members.length,
      thresholds: [],
      stamp: STAMP,
    });
    const page = buildFirstPage(baseInput(summary));
    expect(page.fan?.hours.length).toBe(HOURS + 1);
  });
});
