/**
 * Avgangssammendrag (`docs/specs/robusthet.md` §3.3, §3.6, §4.2, §4.2.3,
 * D10.4).
 *
 * Ren og deterministisk, uavhengig av rekkefølgen `members` ankommer i:
 * `summarizeDeparture` sorterer selv på `memberIndex` før noe telles, og
 * alle estimatorer (`estimators.ts`) og trafikklyset (`traffic-light.ts`)
 * regner kun på verdier, aldri på ankomstrekkefølgen.
 */
import { computeFeasibleEstimates } from "./estimators.js";
import type { MemberOutcome, MemberSummary } from "./outcome.js";
import {
  capForUnknownPeriod,
  computeFeasibleShareBounds,
  computeTrafficLight,
  WAVE_GREEN_CAP_HS_M,
  WAVE_GREEN_CAP_STATUS,
  type Certificate,
  type FeasibleShareBounds,
  type ThresholdRate,
  type ThresholdSpec,
  type TrafficLight,
} from "./traffic-light.js";

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
  /**
   * Bølge-taket (`docs/specs/punktbolge.md` §4.1): 1,0 m, stemplet
   * «foreløpig, ikke verifisert mot NORA3» — samme status som tersklene
   * over, men bevisst ikke en av dem (ikke en rad i tabellen).
   */
  readonly waveGreenCap: { readonly hsM: typeof WAVE_GREEN_CAP_HS_M; readonly status: typeof WAVE_GREEN_CAP_STATUS };
  /** Har bølgekilden periode? Oceanforecast: nei (D14.1). Styrer taket. */
  readonly wavePeriodKnown: boolean;
  /**
   * Det fryste punktbølgesettet kjøringen brukte (ADR-0007): samme `hash`
   * for kontroll, alle medlemmer og perturbasjon. `null` = ingen punktbølge
   * (frakoblet uten buffer, proxy feilet, eller ikke hentet).
   */
  readonly wavePoints: { readonly hash: string; readonly fetchedAtEpochS: number } | null;
  /**
   * Vindmedlemmer med brukbare data av det produsenten kjente til, kontrollen
   * inkludert (`docs/specs/vaerpakker.md` §19 2026-09-29: fyllverdi-medlemmer
   * utelates). `expectedMembers` er nevneren for skrankene (medlemmer MED
   * data); dette feltet gjør «n av N» synlig. Utelatt = ukjent (eldre kallere).
   */
  readonly windMembers?: { readonly withData: number; readonly nominal: number; readonly missing: readonly number[] };
}

/** Stempelets bølge-tak (§4.1) — én konstant, så ingen kaller skriver tallet selv. */
export const WAVE_GREEN_CAP_STAMP: RobustnessStamp["waveGreenCap"] = Object.freeze({
  hsM: WAVE_GREEN_CAP_HS_M,
  status: WAVE_GREEN_CAP_STATUS,
});

export interface DepartureSummary {
  readonly departEpochS: number;
  readonly control: MemberOutcome;
  /** Sortert på `memberIndex`. */
  readonly members: readonly MemberOutcome[];
  /** Alle `expectedMembers` klassifisert. */
  readonly complete: boolean;
  /** Forventet antall medlemmer (typisk 30) — nevneren i skrankene og «k av N». */
  readonly expectedMembers: number;
  readonly nF: number;
  readonly nInf: number;
  readonly nInc: number;
  readonly nErr: number;
  /** nF / (nF + nInf). Inkonklusive og feil er IKKE i nevneren. `null` når nF + nInf === 0. */
  readonly feasibleShare: number | null;
  /**
   * D10.4s eksakte skranker på andelen av HELE ensemblet som ender
   * gjennomførbar — bygget kun på `k` klassifiserte og `j` gjennomførbare,
   * uten antakelser om de uklassifiserte. Se `traffic-light.ts`.
   */
  readonly feasibleShareBounds: FeasibleShareBounds;
  /** nInc / expectedMembers. */
  readonly inconclusiveShare: number;
  /** inconclusiveShare > 0,20. */
  readonly horizonTooShort: boolean;
  /** Seilingstid blant gjennomførbare, nærmeste-rang (§4.2.1). */
  readonly durationWorstS: number | null;
  readonly durationP50S: number | null;
  readonly durationP90S: number | null;
  readonly beatShareP50: number | null;
  readonly beatShareP90: number | null;
  readonly motorShareP50: number | null;
  readonly motorShareP90: number | null;
  /** Merkes «ikke usikkerhetsberegnet» i presentasjonen. */
  readonly fuelWorstL: number | null;
  /** k av n gjennomførbare som består terskelen. */
  readonly thresholds: readonly { readonly id: string; readonly k: number; readonly n: number }[];
  readonly light: TrafficLight;
  readonly certificate: Certificate | null;
  /** Maks Hs over kontrollens steg og alle gjennomførbare medlemmer — grunnlaget for bølge-taket (§4.1). */
  readonly maxHsM: number;
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

/** Predikat-argumentet en `ThresholdSpec.passes` faktisk trenger fra `MemberSummary`. */
function thresholdSubject(m: MemberSummary): { readonly durationS: number; readonly daylightArrival: boolean } {
  return { durationS: m.durationS, daylightArrival: m.daylightArrival };
}

/**
 * Avgangssammendraget (§3.3). `input.members` sorteres på `memberIndex` før
 * noe som helst telles eller estimeres — determinismekravet i §5.2.
 */
export function summarizeDeparture(input: SummarizeDepartureInput): DepartureSummary {
  const members = [...input.members].sort((a, b) => a.memberIndex - b.memberIndex);

  const feasible = members.filter((m) => m.kind === "feasible");
  const nF = feasible.length;
  const nInf = members.filter((m) => m.kind === "infeasible").length;
  const nInc = members.filter((m) => m.kind === "inconclusive").length;
  const nErr = members.filter((m) => m.kind === "error").length;

  const feasibleShare = nF + nInf === 0 ? null : nF / (nF + nInf);
  const inconclusiveShare = input.expectedMembers === 0 ? 0 : nInc / input.expectedMembers;
  const horizonTooShort = inconclusiveShare > 0.2;
  const complete = members.length === input.expectedMembers;

  const feasibleShareBounds = computeFeasibleShareBounds({
    nF,
    nInf,
    nInc,
    nErr,
    expectedMembers: input.expectedMembers,
  });

  const estimates = computeFeasibleEstimates(feasible);

  // §4.2.2: terskeltelling blant gjennomførbare SÅ LANGT — `k av n`.
  const thresholds = input.thresholds.map((spec) => ({
    id: spec.id,
    k: feasible.filter((m) => m.summary !== null && spec.passes(thresholdSubject(m.summary))).length,
    n: nF,
  }));
  const thresholdRates: readonly ThresholdRate[] = thresholds;

  const table = computeTrafficLight({
    complete,
    expectedMembers: input.expectedMembers,
    nF,
    nInf,
    nInc,
    nErr,
    feasibleShare,
    inconclusiveShare,
    thresholdRates,
  });
  // Bølge-taket (punktbolge.md §4.1) ETTER §4.2.3-tabellen og D10.4-
  // sertifikatene: kan bare hindre grønt. `maxHsM` over kontrollens steg
  // og alle gjennomførbare medlemmer.
  const maxHsM = Math.max(
    input.control.summary?.maxHsM ?? 0,
    ...feasible.map((m) => m.summary?.maxHsM ?? 0),
  );
  const light = capForUnknownPeriod(table.light, {
    maxHsM,
    periodKnown: input.stamp.wavePeriodKnown,
    capHsM: input.stamp.waveGreenCap.hsM,
  });
  const certificate = table.certificate;

  return {
    departEpochS: input.departEpochS,
    control: input.control,
    members,
    complete,
    expectedMembers: input.expectedMembers,
    nF,
    nInf,
    nInc,
    nErr,
    feasibleShare,
    feasibleShareBounds,
    inconclusiveShare,
    horizonTooShort,
    durationWorstS: estimates.durationWorstS,
    durationP50S: estimates.durationP50S,
    durationP90S: estimates.durationP90S,
    beatShareP50: estimates.beatShareP50,
    beatShareP90: estimates.beatShareP90,
    motorShareP50: estimates.motorShareP50,
    motorShareP90: estimates.motorShareP90,
    fuelWorstL: estimates.fuelWorstL,
    thresholds,
    light,
    certificate,
    maxHsM,
    stamp: input.stamp,
  };
}
