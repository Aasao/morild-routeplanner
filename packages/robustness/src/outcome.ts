/**
 * Medlemsutfall (`docs/specs/robusthet.md` §3.2): reduksjon av ett fullt
 * `RouteResult` til den formen robusthetslaget beholder for alle 31
 * medlemmer, og klassifisering til `OutcomeKind` etter den bindende
 * tabellen i §3.2.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`,
 * ingen `await` (samme regel som `@morild/routing`, håndhevet av
 * `tools/arch-tests`).
 */
import type { LatLon } from "@morild/geo";
import type { AbortReason, RouteResult, RouteStep } from "@morild/routing";

/** Bakoverkompatibelt alias — `provenance` er nå et påkrevd felt på `RouteResult` (rutemotor.md §4.8). */
export type ProvenancedRouteResult = RouteResult;

/** Medlemmets utfall etter klassifiseringstabellen i §3.2. */
export type OutcomeKind = "feasible" | "infeasible" | "inconclusive" | "error";

/**
 * Hvorfor et medlem er inkonklusivt (D9.2 b-min, vedtatt 2026-09-05):
 * `dekning` = værfeltet tok slutt eller manglet i avgangspunktet (ADR-0005
 * horisont); `budsjett` = søket stoppet på stagnasjonsvakt eller ble
 * avbrutt av kalleren — ingen av delene er bevis på ugjennomførbarhet;
 * `bound` = reservert for bølge 3s ensemble-budsjett (omkjøring ikke
 * rukket); `dekning-felt` = målet ble nådd, men et helt felt (bølger/
 * strøm) manglet i pakken — D11.1s konservative lesning, skilt fra
 * horisont så UI kan si «bølger og strøm mangler» (matematiker/værruting,
 * panel D11). Ingen av grunnene teller i `feasibleShare`-nevneren.
 */
export type InconclusiveReason = "dekning" | "dekning-felt" | "budsjett" | "bound";

export type MemberClassification =
  | { readonly kind: "feasible" }
  | { readonly kind: "infeasible" }
  | { readonly kind: "inconclusive"; readonly reason: InconclusiveReason }
  | { readonly kind: "error" }
  /** §4.1-ventilen: ikke klassifiserbar før søket er kjørt om uten bound (maks én gang, D9.4). */
  | { readonly kind: "rerun-without-bound" };

export interface MemberSummary {
  readonly durationS: number;
  readonly distanceNm: number;
  readonly beatS: number;
  readonly motorS: number;
  readonly nightS: number;
  readonly beatAtNightS: number;
  readonly fuelL: number;
  readonly arrivalEpochS: number;
  /** Avgangstid (D12.5): `hourlyTrack[h]` gjelder `departEpochS + h·3600`. */
  readonly departEpochS: number;
  readonly daylightArrival: boolean;
  /** Rute-nivå flagg — FLAG_* fra `@morild/routing`s `cost.ts`. */
  readonly flags: number;
  readonly safetyVerdict: "trygt" | "usikkert" | "usikker-rute";
  readonly coverageWeather: "full" | "partial";
  /** For §4.1-ventilen: `pruned.bound > 0 && !reachesDestination` ⇒ ikke bevist ugjennomførbart. */
  readonly prunedBound: number;
  /**
   * Søkets egen tidshorisont (motorens Tub-bound i sekunder, `null` når
   * den grådige forhåndsruten ikke nådde målet). Rapporteres som
   * *horisont*, ikke som sertifikat — den grådige ruten er ikke
   * skrankekomplett (D9.3). Alltid med i kvitteringen (D9.2).
   */
  readonly tubBoundS: number | null;
  /** Posisjon per hele time fra avgang, for viften og D8.5. Maks 48 punkter. */
  readonly hourlyTrack: readonly LatLon[];
}

export interface MemberOutcome {
  /** 0 = kontroll, 1..30 = medlemmer. */
  readonly memberIndex: number;
  readonly kind: OutcomeKind;
  /**
   * Redusert form beholdes for ALLE medlemmer med et resultat (§6.2).
   * `null` KUN når `kind === "error"` uten `RouteResult` (Workeren kastet)
   * — et feilet medlem har ingen tall å redusere, og det skal ikke
   * dikte opp noen.
   */
  readonly summary: MemberSummary | null;
  /** Full RouteResult beholdes kun for medlemmer §6.2 navngir. */
  readonly full?: RouteResult;
  /** Kun satt når `kind === "error"`. */
  readonly error?: string;
  /** Kun satt når `kind === "inconclusive"`. */
  readonly inconclusiveReason?: InconclusiveReason | undefined;
}

const VALID_PROVENANCE: ReadonlySet<string> = new Set(["planRoute", "createSearch"]);

/**
 * Kaster hvis `result.provenance` ikke er `"planRoute"` eller
 * `"createSearch"` (§3.1 pkt. 1 / §5.1): robusthetstall skal aldri bygges
 * av noe annet enn et fullt søk gjort av de to offisielle inngangene.
 */
function assertProvenance(result: RouteResult): void {
  // `provenance` er påkrevd i typen, men robusthetstall skal aldri stole på
  // typen alene: et JSON-deserialisert eller håndbygd objekt kan mangle det.
  const provenance: unknown = (result as { readonly provenance?: unknown }).provenance;
  if (typeof provenance !== "string" || !VALID_PROVENANCE.has(provenance)) {
    throw new Error(
      `RouteResult mangler gyldig provenance (fikk ${JSON.stringify(
        provenance,
      )}) — robusthetstall skal kun bygges av planRoute/createSearch (§3.1, §5.1)`,
    );
  }
}

/** Lineær interpolasjon mellom to steg ved et gitt `tS` (sekunder siden avgang). */
function interpolatePosition(a: RouteStep, b: RouteStep, tS: number): LatLon {
  const span = b.tS - a.tS;
  const frac = span > 0 ? (tS - a.tS) / span : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * frac,
    lon: a.lon + (b.lon - a.lon) * frac,
  };
}

const MAX_HOURLY_TRACK_POINTS = 48;

/**
 * Posisjon per hele time fra avgang (`tS = 0, 3600, 7200, …`), interpolert
 * lineært langs `steps`. Stopper ved rutens siste steg (uansett om ruten
 * nådde målet eller ble avbrutt) og er uansett aldri lenger enn 48 punkter
 * (§6.2).
 */
export function hourlyTrackFromSteps(steps: readonly RouteStep[]): readonly LatLon[] {
  if (steps.length === 0) return [];
  const lastStep = steps[steps.length - 1];
  if (!lastStep) return [];
  const lastTS = lastStep.tS;
  const hourCount = Math.min(MAX_HOURLY_TRACK_POINTS, Math.floor(lastTS / 3600) + 1);
  const track: LatLon[] = [];
  let cursor = 0;
  for (let h = 0; h < hourCount; h++) {
    const targetTS = h * 3600;
    while (
      cursor < steps.length - 2 &&
      (steps[cursor + 1]?.tS ?? Infinity) < targetTS
    ) {
      cursor++;
    }
    const a = steps[cursor];
    const b = steps[Math.min(cursor + 1, steps.length - 1)];
    if (!a || !b) break;
    track.push(interpolatePosition(a, b, targetTS));
  }
  return track;
}

/**
 * Reduserer et fullt `RouteResult` til `MemberSummary` (§3.2). Kaster hvis
 * `result.provenance` ikke er satt av `planRoute`/`createSearch`.
 */
export function summarizeMember(result: RouteResult): MemberSummary {
  assertProvenance(result);
  return {
    durationS: result.totals.durationS,
    distanceNm: result.totals.distanceNm,
    beatS: result.totals.beatS,
    motorS: result.totals.motorS,
    nightS: result.totals.nightS,
    beatAtNightS: result.totals.beatAtNightS,
    fuelL: result.totals.fuelL,
    arrivalEpochS: result.totals.arrivalEpochS,
    departEpochS: result.steps[0]?.epochS ?? result.totals.arrivalEpochS - result.totals.durationS,
    daylightArrival: result.totals.daylightArrival,
    flags: result.flags,
    safetyVerdict: result.safety.verdict,
    coverageWeather: result.coverage.weather,
    prunedBound: result.diagnostics.pruned.bound,
    tubBoundS: result.diagnostics.tubBoundS,
    hourlyTrack: hourlyTrackFromSteps(result.steps),
  };
}

const ERROR_ABORT_REASONS: ReadonlySet<AbortReason> = new Set([
  "labelCap",
  "iterationCap",
  "noExpandableLabels",
  // Start utenfor maske-/feltdomenet: et verktøysvar, ikke et værsvar (D9.2).
  "outsideDomain",
]);

/** Søket ga opp av budsjettgrunner — ikke bevis på ugjennomførbarhet (D9.2 b-min). */
const BUDGET_ABORT_REASONS: ReadonlySet<AbortReason> = new Set(["stagnation", "callerStopped"]);

/**
 * Klassifiserer et medlem etter tabellen i §3.2 (rekkefølgen er bindende).
 * Erstatter dagens ad hoc-klassifisering i `apps/pwa/src/weather/
 * ensemble.ts`. Kaster hvis `result.provenance` ikke er gyldig (§3.1/§5.1).
 *
 * Returnerer `{ kind: "rerun-without-bound" }` når
 * `pruned.bound > 0 && !reachesDestination`: medlemmet er IKKE bevist
 * ugjennomførbart (§4.1, delt soft Tub) og må kjøres om uten bound før det
 * kan klassifiseres endelig.
 *
 * **Rekkefølge (presisert 2026-09-04 etter skademålingen i
 * `packages/routing/src/shared-tub.damage.test.ts`):** inconclusive →
 * ventil → error → feasible → infeasible. Ventilen står FØR `error`: en
 * for stram bound kan beskjære hele fronten, og søket dør da av
 * `noExpandableLabels` — tabellen bokstavelig lest ville stemplet det som
 * «beregningen feilet» der det som skjedde var at bounden kuttet ruten.
 * Omkjøring er den eneste retningen som aldri lyver. Inconclusive står
 * likevel først: tok værfeltet slutt, er svaret «ikke bevist» uansett
 * bound, og en omkjøring ville bare gjenta det. Presisering til
 * robusthet.md §3.2 (D9.2) — se spec-ens §7.
 */
export function classifyMember(result: RouteResult): MemberClassification {
  assertProvenance(result);
  const reached = result.safety.reachesDestination;

  // Datahorisont: feltet tok slutt underveis, eller manglet allerede i
  // avgangspunktet (`noWeatherAtStart` settes før `environmentAt` kalles,
  // så `coverage.weather` er da fortsatt "full" — D9.2).
  if (!reached && (result.coverage.weather === "partial" || result.abortReason === "noWeatherAtStart")) {
    return { kind: "inconclusive", reason: "dekning" };
  }

  // D11.1 (vedtatt 2026-09-05): nådde målet, men dekningen var partial —
  // i praksis et helt felt (bølger/strøm) manglet i pakken. Bølger kan bare
  // fjerne gjennomførbare, aldri legge til; en andel regnet uten dem er en
  // øvre skranke presentert som estimat. Telles derfor inkonklusivt med
  // egen grunn, så UI kan si «kom fram på vind alene — bølger og strøm
  // mangler i pakken». (c) — skille horisont fra manglende felt i motoren —
  // kommer når bølger/strøm er i pakken.
  if (reached && result.coverage.weather === "partial") {
    return { kind: "inconclusive", reason: "dekning-felt" };
  }

  if (!reached && result.diagnostics.pruned.bound > 0) {
    return { kind: "rerun-without-bound" };
  }

  if (!reached && result.abortReason !== null && ERROR_ABORT_REASONS.has(result.abortReason)) {
    return { kind: "error" };
  }

  // Regnebudsjett: stagnasjonsvakt eller avbrudd fra kalleren. Var
  // «infeasible» før D9.2 — et budsjettstopp beviser ikke at ingen vei
  // finnes, og skal ikke inn i nevneren som «været sier nei».
  if (!reached && result.abortReason !== null && BUDGET_ABORT_REASONS.has(result.abortReason)) {
    return { kind: "inconclusive", reason: "budsjett" };
  }

  if (reached) {
    return { kind: "feasible" };
  }

  // Gjenstår: ikke nådd, full dekning, ingen beskjæring, ingen budsjett-/
  // verktøystopp. Inntil bølge 3s `diagnostics.termination` gir et positivt
  // sertifikat («uttømt uten tak, uten bound, full dekning»), er dette
  // det eneste som får bli `infeasible`.
  return { kind: "infeasible" };
}
