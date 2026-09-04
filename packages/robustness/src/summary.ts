/**
 * Avgangssammendrag (`docs/specs/robusthet.md` §3.3, §3.6).
 *
 * Bølge 1 (denne fila): kun skjelettet — typene og de tellbare feltene
 * (`nF/nInf/nInc/nErr`, `feasibleShare`, `inconclusiveShare`,
 * `horizonTooShort`, `complete`). Estimatorene (persentiler, terskler,
 * trafikklys, sertifikat) kommer i bølge 3 (§4.2) og returneres her som
 * `null`/`"beregner"` med tydelig markering — se kommentarene under.
 *
 * Ren og deterministisk, uavhengig av rekkefølgen `members` ankommer i:
 * `summarizeDeparture` sorterer selv på `memberIndex` før noe telles.
 */
import type { MemberOutcome, MemberSummary } from "./outcome.js";

export interface ThresholdSpec {
  /** F.eks. "moerke", "tidsbudsjett". */
  readonly id: string;
  /** F.eks. «framme før mørket». */
  readonly label: string;
  readonly passes: (m: MemberSummary) => boolean;
}

export interface TrafficLight {
  readonly color: "gronn" | "gul" | "rod" | "beregner";
  readonly reason: "andel" | "tid" | "inkonklusiv" | "tynt-utvalg" | "ingen-kontrollrute" | null;
  readonly kOfN: { readonly k: number; readonly n: number };
  /** DA6-stempel: tersklene som brukes er provisoriske (§4.2.3). */
  readonly provisionalThresholds: true;
}

/**
 * Bevis om det fulle ensemblet, utledet fra en delmengde (§4.2.3).
 * Deterministisk og kun i advarselsretning — grønn kan aldri sertifiseres.
 * Bølge 3 fyller ut sertifikatlogikken; bølge 1 returnerer alltid `null`.
 */
export interface Certificate {
  readonly color: "rod" | "gul";
  readonly reason: "andel" | "tid";
}

export interface RobustnessStamp {
  readonly maskVersion: string;
  readonly packageId: string;
  readonly packageInitEpochS: number;
  /** Lagget ensemble: alder per medlem, i sekunder. */
  readonly memberAgesS: readonly number[];
  /** Hash av `RouteOptions` + robusthetskonstanter. */
  readonly optionsHash: string;
  readonly estimator: "naermeste-rang-v1";
  /** Provisoriske (DA6) — se §4.2.3, §5.4. */
  readonly thresholds: { readonly gronn: 0.9; readonly rod: 0.7; readonly inkonklusiv: 0.2; readonly konkordans: 0.75 };
}

export interface DepartureSummary {
  readonly departEpochS: number;
  readonly control: MemberOutcome;
  /** Sortert på `memberIndex`. */
  readonly members: readonly MemberOutcome[];
  /** Alle `expectedMembers` klassifisert. */
  readonly complete: boolean;
  readonly nF: number;
  readonly nInf: number;
  readonly nInc: number;
  readonly nErr: number;
  /** nF / (nF + nInf). Inkonklusive og feil er IKKE i nevneren. `null` når nF + nInf === 0. */
  readonly feasibleShare: number | null;
  /** nInc / forventet antall medlemmer. */
  readonly inconclusiveShare: number;
  /** inconclusiveShare > 0,20. */
  readonly horizonTooShort: boolean;
  /** Seilingstid blant gjennomførbare, nærmeste-rang (§4.2.1). Bølge 3. */
  readonly durationWorstS: number | null;
  readonly durationP50S: number | null;
  readonly durationP90S: number | null;
  readonly beatShareP50: number | null;
  readonly beatShareP90: number | null;
  readonly motorShareP50: number | null;
  readonly motorShareP90: number | null;
  /** Merkes «ikke usikkerhetsberegnet» i presentasjonen. Bølge 3. */
  readonly fuelWorstL: number | null;
  /** k av n gjennomførbare som består terskelen. Tom i bølge 1 — se merknad. */
  readonly thresholds: readonly { readonly id: string; readonly k: number; readonly n: number }[];
  readonly light: TrafficLight;
  readonly certificate: Certificate | null;
  readonly stamp: RobustnessStamp;
}

export interface SummarizeDepartureInput {
  readonly departEpochS: number;
  readonly control: MemberOutcome;
  readonly members: readonly MemberOutcome[];
  /** Forventet antall medlemmer i ensemblet (typisk 30). */
  readonly expectedMembers: number;
  readonly thresholds: readonly ThresholdSpec[];
  readonly stamp: RobustnessStamp;
}

/**
 * Bølge 1-skjelett av avgangssammendraget (§3.3). Teller `nF/nInf/nInc/
 * nErr` og de avledede andelene; alle estimatorer som krever nærmeste-rang
 * (§4.2.1) eller trafikklys-tabellen (§4.2.3) er stubbet ut som `null`
 * eller `"beregner"` — IKKE implementert her, se bølge 3 i
 * `docs/research/fase4a-plan-2026-09-04.md`.
 *
 * Uavhengig av ankomstrekkefølge: `input.members` sorteres på
 * `memberIndex` før noe som helst telles.
 */
export function summarizeDeparture(input: SummarizeDepartureInput): DepartureSummary {
  const members = [...input.members].sort((a, b) => a.memberIndex - b.memberIndex);

  const nF = members.filter((m) => m.kind === "feasible").length;
  const nInf = members.filter((m) => m.kind === "infeasible").length;
  const nInc = members.filter((m) => m.kind === "inconclusive").length;
  const nErr = members.filter((m) => m.kind === "error").length;

  const feasibleShare = nF + nInf === 0 ? null : nF / (nF + nInf);
  const inconclusiveShare = input.expectedMembers === 0 ? 0 : nInc / input.expectedMembers;
  const horizonTooShort = inconclusiveShare > 0.2;
  const complete = members.length === input.expectedMembers;

  // bølge 3: nærmeste-rang over gjennomførbare (§4.2.1/§4.2.4).
  const durationWorstS = null;
  const durationP50S = null;
  const durationP90S = null;
  const beatShareP50 = null;
  const beatShareP90 = null;
  const motorShareP50 = null;
  const motorShareP90 = null;
  const fuelWorstL = null;

  // bølge 3: terskeltelling (§4.2.2) — `input.thresholds` brukes ikke ennå.
  const thresholds: readonly { readonly id: string; readonly k: number; readonly n: number }[] = [];

  // bølge 3: trafikklys-tabellen (§4.2.3). Før den er implementert er
  // svaret alltid "beregner" med `kOfN` = ferdige klassifisert av forventet.
  const light: TrafficLight = {
    color: "beregner",
    reason: null,
    kOfN: { k: members.length, n: input.expectedMembers },
    provisionalThresholds: true,
  };

  // bølge 3: sertifikater (§4.2.3) — deterministiske, kun i advarselsretning.
  const certificate = null;

  return {
    departEpochS: input.departEpochS,
    control: input.control,
    members,
    complete,
    nF,
    nInf,
    nInc,
    nErr,
    feasibleShare,
    inconclusiveShare,
    horizonTooShort,
    durationWorstS,
    durationP50S,
    durationP90S,
    beatShareP50,
    beatShareP90,
    motorShareP50,
    motorShareP90,
    fuelWorstL,
    thresholds,
    light,
    certificate,
    stamp: input.stamp,
  };
}
