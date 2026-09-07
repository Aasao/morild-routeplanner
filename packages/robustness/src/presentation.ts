/**
 * Førstesiden og ærlig degradering (`docs/specs/robusthet.md` §4.7, §4.2.2,
 * §4.2.3, §4.5 pkt. 3–5, §4.6 pkt. 5–6, D8.11/D8.12; tekstråd i
 * `docs/research/ekspertpanel-d12-boelge4-2026-09-05.md` §1.3).
 *
 * `buildFirstPage` bygger førstesiden som STRUKTURERTE linjer — ingen DOM,
 * ingen HTML. `apps/pwa` tegner linjene; denne pakken bestemmer rekkefølge,
 * innhold og hvilke tall som skjules når grunnlaget ikke bærer dem.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke (mottar `nowEpochS`
 * indirekte via `packageAgeS`, ikke `Date.now()`), ingen `Math.random`.
 * `Intl.DateTimeFormat` brukes for klokkeslett — deterministisk gitt
 * `epochS` og `timeZone` (ingen systemklokke leses).
 *
 * ## Valg tatt der spec-en er underspesifisert (dokumentert her og i
 * leveranserapporten)
 *
 * 1. **Pakke for gammel (§4.7-tabellens rad 1).** Oppdraget spør eksplisitt
 *    om lyset skal vises som «beregner» i dette tilfellet, og svarer selv:
 *    les tabellen bokstavelig. Denne implementasjonen returnerer DERFOR
 *    `lines` med KUN én linje (kind `"varsel"`, severity `"kritisk"`) —
 *    ingen lys-, plantid-, regel-, dekning- eller bailout-linje — fordi
 *    tabellen sier «ingen robusthetstall», ikke «robusthetstall vist med
 *    forbehold». `behindTap` og `fan` bygges likevel (stempelet/alderen er
 *    nettopp det som forklarer HVORFOR siden er tom).
 * 2. **`advice: null` / `bailout: null`.** Typen tillater `null` for begge
 *    (progressiv beregning — regelen/bail-out-profilen for denne avgangen
 *    er ikke beregnet ennå, til forskjell fra `DecisionAdvice.fallback`,
 *    som ER et beregnet svar). Tolket som «beregnes», med en nøytral
 *    (`"info"`) linjetekst — ALDRI en antatt regel/bail-out-verdi (samme
 *    prinsipp som §4.7-tabellens «følsomhet ikke beregnet, aldri antatt»,
 *    generalisert til de to andre feltene som kan mangle progressivt).
 * 3. **Terskelform velger `id === "moerke"`** blant `input.thresholds` når
 *    den finnes (§4.2.2: «mørkeankomst er alltid definert»); ellers første
 *    oppgitte terskel; ellers pessimistisk par. Flere terskler samtidig er
 *    ikke spesifisert i §4.2.2 — kun mørke nevnes som alltid tilgjengelig.
 * 4. **Avrunding.** «Opptil»/«inntil»-tall (øvre skranker) rundes ALLTID
 *    OPP (`Math.ceil`) — å runde en øvre skranke ned ville underdrive
 *    risiko (N1/N2). «Typisk» (P50) rundes til nærmeste hele time.
 *    Bail-out-gapet («lengste strekk uten trygg havn») er også en øvre
 *    skranke og rundes OPP til nærmeste 0,1 t (desimalkomma) —
 *    review-funn bølge 5.
 * 5. **Sjømannsformat for posisjon** i regel-linjen: grader og
 *    desimalminutter, `N 58°12,3′ Ø 10°45,6′` — desimalkomma, ett desimal
 *    på minuttet (typisk håndbok-oppløsning, langt under GPS-presisjonen
 *    som ville vært støy i UI-et).
 * 6. **`FanBand`-projeksjon.** Gjenbruker konvensjonen fra
 *    `decision-rule.ts`: kontrollsporets tangent `a→b` ved hver hele time
 *    (siste time bruker forrige segment), `crossTrackNm(a, b, p)` for hvert
 *    medlems posisjon ved samme time. Kun `feasible`/`infeasible`-medlemmer
 *    telles (inkonklusive utelates, samme regel som §4.6 pkt. 1). `null`
 *    for HELE `FanBand` når kontrollen ikke har et spor med ≥ 2 punkter (da
 *    finnes ingen tangent å projisere på); `null` per time og per
 *    persentil-felt (samlet, ikke enkeltvis) når færre enn 3 medlemmer har
 *    en posisjon ved den timen.
 */
import type { LatLon } from "@morild/geo";
import { crossTrackNm } from "@morild/geo";
import type { BailoutProfile } from "@morild/routing";
import type { DecisionAdvice } from "./decision-rule.js";
import type { MemberOutcome, MemberSummary } from "./outcome.js";
import { nearestRankValue } from "./estimators.js";
import type { SensitivityReport } from "./perturbation.js";
import type { DepartureSummary } from "./summary.js";

export type FirstPageLineKind = "lys" | "plantid" | "regel" | "dekning" | "bailout" | "varsel";
export type FirstPageSeverity = "info" | "advarsel" | "kritisk";

export interface FirstPageLine {
  readonly kind: FirstPageLineKind;
  readonly text: string;
  readonly severity: FirstPageSeverity;
}

export interface FanBandHour {
  readonly h: number;
  readonly control: LatLon | null;
  /** Nærmeste-rang P0 (min), tverravstand i nm. `null` sammen med de andre firfelt når `nMembers < 3`. */
  readonly min: number | null;
  readonly p10: number | null;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly max: number | null;
  /** Gjennomførbare + ugjennomførbare med posisjon ved denne timen (inkonklusive utelates). */
  readonly nMembers: number;
}

export interface FanBand {
  readonly hours: readonly FanBandHour[];
}

export interface FirstPageInput {
  readonly summary: DepartureSummary;
  readonly advice: DecisionAdvice | null;
  readonly sensitivity: SensitivityReport | null | "ikke-beregnet";
  readonly bailout: BailoutProfile | null;
  /** `null` = pakkealder ukjent (skal ikke tolkes som "fersk"). */
  readonly packageAgeS: number | null;
  readonly staleAfterS: number;
  /** Terskellabel + telling, resolvert av kalleren fra `ThresholdSpec.label` + `DepartureSummary.thresholds`. */
  readonly thresholds: readonly { readonly id: string; readonly label: string; readonly k: number; readonly n: number }[];
  readonly locale?: { readonly timeZone: string } | undefined;
}

export interface FirstPage {
  readonly lines: readonly FirstPageLine[];
  readonly behindTap: readonly { readonly label: string; readonly text: string }[];
  readonly fan: FanBand | null;
}

const DEFAULT_TIME_ZONE = "Europe/Oslo";

function line(kind: FirstPageLineKind, text: string, severity: FirstPageSeverity): FirstPageLine {
  return { kind, text, severity };
}

function ceilHours(s: number): number {
  return Math.ceil(s / 3600);
}

function roundHours(s: number): number {
  return Math.round(s / 3600);
}

/** Desimalkomma, én desimal — norsk tallformat brukt overalt ellers i spec-en (f.eks. "1,25"). */
function formatDecimalComma(n: number, digits: number): string {
  return n.toFixed(digits).replace(".", ",");
}

/** «N 58°12,3′ Ø 10°45,6′» — grader og desimalminutter, sjømannsformat (valg 5). */
function formatLatLon(p: LatLon): string {
  const formatOne = (value: number, positiveLabel: string, negativeLabel: string): string => {
    const label = value >= 0 ? positiveLabel : negativeLabel;
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minutes = (abs - deg) * 60;
    return `${label} ${deg}°${formatDecimalComma(minutes, 1)}′`;
  };
  return `${formatOne(p.lat, "N", "S")} ${formatOne(p.lon, "Ø", "V")}`;
}

/** Klokkeslett i lokal tid — deterministisk gitt `epochS` og tidssone (§4.7 pkt. 3). */
function formatLocalTime(epochS: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("nb-NO", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return formatter.format(new Date(epochS * 1000));
}

const CARDINAL_LABEL: Record<"nord" | "sor" | "ost" | "vest", string> = {
  nord: "nord",
  sor: "sør",
  ost: "øst",
  vest: "vest",
};

/** «(verste av nF gjennomførbare)» — nF < 12 (§4.2.2), aldri ordet P90. */
function worstOfSuffix(summary: DepartureSummary): string {
  return summary.nF < 12 ? ` (verste av ${summary.nF} gjennomførbare)` : "";
}

function buildPlantidLine(summary: DepartureSummary, thresholds: FirstPageInput["thresholds"]): FirstPageLine {
  if (summary.durationWorstS === null) {
    return line(
      "plantid",
      "Ingen gjennomførbare utfall så langt — kan ikke anslå plantid.",
      "advarsel",
    );
  }

  const suffix = worstOfSuffix(summary);
  const worstHours = ceilHours(summary.durationWorstS);

  // Valg 3: mørke-terskelen først, ellers første oppgitte, ellers pessimistisk par.
  const moerke = thresholds.find((t) => t.id === "moerke");
  const chosen = moerke ?? thresholds[0];
  if (chosen !== undefined && chosen.n > 0) {
    return line(
      "plantid",
      `Framme før mørket i ${chosen.k} av ${chosen.n} utfall. Hvis forsinket: opptil ${worstHours} t${suffix}.`,
      "info",
    );
  }

  if (summary.durationP50S === null) {
    return line("plantid", `Regn med inntil ${worstHours} t${suffix}.`, "info");
  }
  const typicalHours = roundHours(summary.durationP50S);
  return line("plantid", `Regn med inntil ${worstHours} t, typisk ${typicalHours} t${suffix}.`, "info");
}

/** Item 1 (§4.7): trafikklys + én setning. Gul/rød navngir alltid årsaken; «beregner» er aldri blank. */
function buildLysLine(summary: DepartureSummary): FirstPageLine {
  const light = summary.light;
  const kOfN = light.kOfN;

  if (light.color === "beregner") {
    return line("lys", `Beregner (${kOfN.k} av ${kOfN.n}) …`, "info");
  }

  if (light.color === "gronn") {
    return line(
      "lys",
      `Grønt lys — ${summary.nF} av ${summary.nF + summary.nInf} avgjorte utfall når fram, godt innenfor tidsterskelen.`,
      "info",
    );
  }

  if (light.color === "rod") {
    if (light.reason === "tynt-grunnlag") {
      const avgjorte = summary.nF + summary.nInf;
      return line(
        "lys",
        `Rødt lys — av ${avgjorte} avgjorte kom ${summary.nInf} ikke fram — for få til å tallfeste.`,
        "kritisk",
      );
    }
    return line(
      "lys",
      `Rødt lys — ${summary.nInf} av ${summary.nF + summary.nInf} avgjorte utfall når ikke fram.`,
      "kritisk",
    );
  }

  // Gul — reason er aldri null i praksis her (kun grønn kan ha null-reason), men vi dekker den defensivt.
  switch (light.reason) {
    case "inkonklusiv":
      if (summary.nF + summary.nInf === 0) {
        return line("lys", "Gult lys — for få avgjorte utfall ennå til å si noe.", "advarsel");
      }
      return line(
        "lys",
        "Gult lys — horisonten er for kort for hele seilasen (dekningen tar slutt for tidlig).",
        "advarsel",
      );
    case "tynt-utvalg":
      return line("lys", `Gult lys — tynt utvalg (kun ${summary.nF} gjennomførbare).`, "advarsel");
    case "andel":
      return line(
        "lys",
        `Gult lys — ${summary.nF} av ${summary.nF + summary.nInf} avgjorte utfall når fram; usikkert nok til varsomhet.`,
        "advarsel",
      );
    case "tid":
      return line("lys", "Gult lys — mange av de gjennomførbare bryter tidsterskelen.", "advarsel");
    case "ingen-kontrollrute":
      return line("lys", "Gult lys — ingen kontrollrute; robusthetstallene bygger på medlemmene.", "advarsel");
    case "usikkert-grunnlag":
      return line(
        "lys",
        "Gult lys — grunnlaget er usikkert (for mange inkonklusive/feilede utfall til å stole på andelen).",
        "advarsel",
      );
    default:
      return line("lys", "Gult lys.", "advarsel");
  }
}

/** Item 3 (§4.7, §4.6 pkt. 5–6): regel eller fallback. Valg 2 for `advice === null`. */
function buildRegelLine(advice: DecisionAdvice | null, timeZone: string): FirstPageLine {
  if (advice === null) {
    return line("regel", "Beslutningsregel: beregnes når ensemblet er komplett.", "info");
  }
  if (advice.kind === "fallback") {
    return line("regel", advice.text, "info");
  }
  const rule = advice.rule;
  const time = formatLocalTime(rule.checkEpochS, timeZone);
  const position = formatLatLon(rule.position);
  const retning = CARDINAL_LABEL[rule.test];
  const explanationClause = rule.explanation !== "" ? ` (${rule.explanation})` : "";
  const text =
    `Sjekk selv kl. ${time} ved ${position}: er du ${retning} for punktet?${explanationClause} ` +
    `Hvis ikke — ${rule.action} Skiller ${rule.hitRate.k} av ${rule.hitRate.n} utfall.`;
  return line("regel", text, "info");
}

/** Item 4 (§4.7): fast linje. */
function buildDekningLine(summary: DepartureSummary): FirstPageLine {
  return line(
    "dekning",
    `Vindanslag (MEPS, ${summary.expectedMembers} medlemmer) · bølge og strøm er ikke usikkerhetsberegnet.`,
    "info",
  );
}

/** Item 5 (§4.5 pkt. 3–5, §4.7): bail-out. Valg 2 for `bailout === null`. */
function buildBailoutLine(bailout: BailoutProfile | null): FirstPageLine {
  if (bailout === null) {
    return line("bailout", "Lengste strekk uten trygg havn: beregnes.", "info");
  }
  if (bailout.coverage === "none") {
    return line(
      "bailout",
      `Lengste strekk uten trygg havn: havnebok mangler dekning her. ${bailout.label}.`,
      "advarsel",
    );
  }
  const gapS = bailout.longestGapS;
  const gapText =
    gapS === null
      ? "havnebok mangler dekning her"
      : gapS >= bailout.limitS
        ? `≥ ${ceilHours(bailout.limitS)} t`
        : `${formatDecimalComma(Math.ceil(gapS / 360) / 10, 1)} t`;
  const coverageText =
    bailout.coverage === "partial"
      ? " Havneboken dekker ikke alle havner her (mangler dybde eller felt for noen)."
      : "";
  return line(
    "bailout",
    `Lengste strekk uten trygg havn: ${gapText}.${coverageText} ${bailout.label}.`,
    bailout.coverage === "partial" ? "advarsel" : "info",
  );
}

/** Item 6 (§4.7): betingede varsellinjer, i en fast, deterministisk rekkefølge. */
function buildVarselLines(input: FirstPageInput): readonly FirstPageLine[] {
  const { summary, sensitivity } = input;
  const lines: FirstPageLine[] = [];

  if (summary.nF < 12) {
    lines.push(line("varsel", `Tynt utvalg (${summary.nF} gjennomførbare).`, "advarsel"));
  }
  if (summary.horizonTooShort) {
    lines.push(
      line("varsel", "Horisonten er for kort for denne seilasen (dekningen tar slutt for tidlig).", "advarsel"),
    );
  }
  if (sensitivity !== null && sensitivity !== "ikke-beregnet" && sensitivity.conflict) {
    lines.push(line("varsel", "Konfliktsignal — se detaljer.", "advarsel"));
  }
  if (sensitivity === "ikke-beregnet") {
    lines.push(line("varsel", "Følsomhet ikke beregnet.", "advarsel"));
  }
  if (summary.control.kind !== "feasible") {
    // §4.7-tabellen sier «verste/typisk medlem som geometri» — den
    // substitusjonen er ikke bygget ennå (viften og kartet trenger
    // kontrollens spor), og teksten skal ikke påstå noe som ikke skjer.
    lines.push(line("varsel", "Ingen kontrollrute å tegne — vifte og kart kan mangle geometri.", "kritisk"));
  }
  // Sikkerhetsflagg fra ruten selv (§3.2: «bæres videre til presentasjonen
  // som flagg»; CLAUDE.md §1: usikker rute merkes eksplisitt i UI).
  const controlVerdict = summary.control.summary?.safetyVerdict;
  if (controlVerdict !== undefined && controlVerdict !== "trygt") {
    lines.push(
      line(
        "varsel",
        controlVerdict === "usikker-rute"
          ? "Kontrollruten er merket USIKKER RUTE — kartlagte farer kan ikke utelukkes langs ruten."
          : "Kontrollruten er merket usikker — deler av ruten mangler pålitelige kart-/værdata.",
        "kritisk",
      ),
    );
  }
  const unsafeFeasible = summary.members.filter(
    (m) => m.kind === "feasible" && m.summary !== null && m.summary.safetyVerdict !== "trygt",
  ).length;
  if (unsafeFeasible > 0) {
    lines.push(
      line("varsel", `${unsafeFeasible} av ${summary.nF} gjennomførbare medlemmer har rute merket usikker.`, "advarsel"),
    );
  }
  if (summary.nErr > 0) {
    lines.push(line("varsel", `${summary.nErr} medlemmer feilet i beregningen.`, "advarsel"));
  }
  const dekningFeltCount = summary.members.filter(
    (m) => m.kind === "inconclusive" && m.inconclusiveReason === "dekning-felt",
  ).length;
  if (dekningFeltCount > 0) {
    lines.push(
      line(
        "varsel",
        `${dekningFeltCount} kom fram på vind alene — bølger og strøm mangler i pakken.`,
        "advarsel",
      ),
    );
  }
  return lines;
}

function buildBehindTap(input: FirstPageInput): readonly { readonly label: string; readonly text: string }[] {
  const { summary, sensitivity } = input;
  const entries: { readonly label: string; readonly text: string }[] = [];

  entries.push({
    label: "P50/P90",
    text:
      summary.durationP50S === null || summary.durationP90S === null
        ? "Ikke beregnet (ingen gjennomførbare)."
        : `P50 ${roundHours(summary.durationP50S)} t · P90 ${roundHours(summary.durationP90S)} t.`,
  });
  entries.push({
    label: "Utfall",
    text: `nF ${summary.nF} · nInf ${summary.nInf} · nInc ${summary.nInc} · nErr ${summary.nErr}.`,
  });
  entries.push({
    label: "Følsomhet",
    text:
      sensitivity === null
        ? "Beregnes."
        : sensitivity === "ikke-beregnet"
          ? "Ikke beregnet."
          : sensitivity.runs
              .map((r) => `${r.kind}×${r.factor} (${r.basis}): ${r.outcome.kind}`)
              .join(", ") || "Ingen kjøringer.",
  });
  entries.push({
    label: "Drivstoff",
    text:
      summary.fuelWorstL === null
        ? "Ikke beregnet."
        : `Verste ${formatDecimalComma(summary.fuelWorstL, 1)} l — ikke usikkerhetsberegnet.`,
  });
  entries.push({
    label: "Stempel",
    text: `Maske ${summary.stamp.maskVersion} · pakke ${summary.stamp.packageId} init ${summary.stamp.packageInitEpochS} · estimator ${summary.stamp.estimator} · provisoriske terskler.`,
  });
  const ages = summary.stamp.memberAgesS;
  entries.push({
    label: "Aldersspenn",
    text:
      ages.length === 0
        ? "Ukjent."
        : `${roundHours(Math.min(...ages))}–${roundHours(Math.max(...ages))} t.`,
  });
  return entries;
}

/** Tangent-retningen ved time `h` langs kontrollsporet (valg 6): `(h, h+1)`, eller `(h-1, h)` for siste punkt. */
function controlSegmentAt(track: readonly LatLon[], h: number): { readonly a: LatLon; readonly b: LatLon } | null {
  if (h < track.length - 1) {
    const a = track[h];
    const b = track[h + 1];
    if (a !== undefined && b !== undefined) return { a, b };
  }
  if (h > 0) {
    const a = track[h - 1];
    const b = track[h];
    if (a !== undefined && b !== undefined) return { a, b };
  }
  return null;
}

const MIN_FAN_MEMBERS = 3;
const FAN_PERCENTILES = { min: 0, p10: 10, p50: 50, p90: 90, max: 100 } as const;

/**
 * `FanBand` (§4.7 pkt. 7, valg 6). Kun `feasible`/`infeasible`-medlemmer
 * telles (samme regel som §4.6 pkt. 1); kontrollen selv brukes kun til
 * geometrien (tangenten), ikke som en av de tellende posisjonene.
 */
export function buildFanBand(control: MemberOutcome, members: readonly MemberOutcome[]): FanBand | null {
  const controlTrack = control.summary?.hourlyTrack ?? [];
  if (controlTrack.length < 2) return null;

  const counted: readonly MemberSummary[] = members
    .filter((m) => (m.kind === "feasible" || m.kind === "infeasible") && m.summary !== null)
    .map((m) => m.summary as MemberSummary);

  const hours: FanBandHour[] = [];
  for (let h = 0; h < controlTrack.length; h++) {
    const segment = controlSegmentAt(controlTrack, h);
    const controlPos = controlTrack[h] ?? null;
    if (segment === null) {
      hours.push({ h, control: controlPos, min: null, p10: null, p50: null, p90: null, max: null, nMembers: 0 });
      continue;
    }
    const distances = counted
      .map((m) => m.hourlyTrack[h])
      .filter((p): p is LatLon => p !== undefined)
      .map((p) => crossTrackNm(segment.a, segment.b, p))
      .sort((a, b) => a - b);

    if (distances.length < MIN_FAN_MEMBERS) {
      hours.push({
        h,
        control: controlPos,
        min: null,
        p10: null,
        p50: null,
        p90: null,
        max: null,
        nMembers: distances.length,
      });
      continue;
    }

    hours.push({
      h,
      control: controlPos,
      min: nearestRankValue(distances, FAN_PERCENTILES.min),
      p10: nearestRankValue(distances, FAN_PERCENTILES.p10),
      p50: nearestRankValue(distances, FAN_PERCENTILES.p50),
      p90: nearestRankValue(distances, FAN_PERCENTILES.p90),
      max: nearestRankValue(distances, FAN_PERCENTILES.max),
      nMembers: distances.length,
    });
  }
  return { hours };
}

/**
 * Bygger førstesiden (§4.7) i den bindende rekkefølgen 1–6, pluss viften
 * (pkt. 7) og bak-trykk-listen. Se toppkommentarens valg 1 for
 * stale-pakke-adferden (§4.7-tabellens rad 1).
 */
export function buildFirstPage(input: FirstPageInput): FirstPage {
  const timeZone = input.locale?.timeZone ?? DEFAULT_TIME_ZONE;
  const fan = buildFanBand(input.summary.control, input.summary.members);

  // §4.7-tabellen rad 1: pakke mangler ELLER for gammel ⇒ ingen
  // robusthetstall. `null` alder er «ukjent», aldri «fersk» (review-funn C).
  if (input.packageAgeS === null || input.packageAgeS > input.staleAfterS) {
    const ageText =
      input.packageAgeS === null
        ? "Pakkealder ukjent (vindfeltet mangler eller er uten init-tid) — ingen robusthetstall vises."
        : `Prognose ${roundHours(input.packageAgeS)} t gammel — ingen robusthetstall vises; kontrollrute merket «prognose ${roundHours(input.packageAgeS)} t gammel».`;
    return {
      lines: [line("varsel", ageText, "kritisk")],
      behindTap: buildBehindTap(input),
      fan,
    };
  }

  const lines: FirstPageLine[] = [
    buildLysLine(input.summary),
    buildPlantidLine(input.summary, input.thresholds),
    buildRegelLine(input.advice, timeZone),
    buildDekningLine(input.summary),
    buildBailoutLine(input.bailout),
    ...buildVarselLines(input),
  ];

  return { lines, behindTap: buildBehindTap(input), fan };
}
