/**
 * **Bail-out-profilen langs hele ruten** (F4.6, D8.6 (b), D8.10;
 * `docs/specs/robusthet.md` §4.5; `docs/specs/rutemotor.md` §5.14).
 *
 * Fram til nå har R2 bare svart på ett spørsmål: «da ruten feilet hardt,
 * kunne du kommet deg i havn?». På en rute som *ikke* feiler — altså den
 * ruten Magnus faktisk får anbefalt — svarte den ingenting. Det er
 * bugfiksen panelet ba om (D8.6): spørsmålet «hvor lenge er jeg uten en
 * havn jeg kan gå inn i?» er interessant nettopp når alt ser bra ut.
 *
 * Profilen sampler ruten hvert 30. minutt (pluss ved hvert segmentskifte) og
 * spør, i hvert punkt: finnes det en havn i boken jeg kan nå innen 6 timer,
 * som er dyp nok, som jeg tør gå inn i på det tidspunktet, og som været
 * tillater anløp i? Svaret er `naadd` eller det er det ikke — og lengste
 * sammenhengende strekk uten et `naadd` er tallet førstesiden viser.
 *
 * **Rekkefølgen på gatene er en kostnadsbeslutning, ikke en semantisk.**
 * Havnefeltet (`harbour-field.ts`) siler først, og kun i «ingen havn»-retning.
 * Så dybde og mørke, som er rene funksjoner. Sist det fulle R2-søket
 * (`mode: "pareto"`, udelt maske, `noTubBound: true` per D11.2) og
 * `harbourApproachable`. Hver gate kan bare gjøre svaret mer pessimistisk;
 * ingen av dem kan gjøre en havn «nådd» som ikke er det.
 *
 * **Basis er kontrollværet i 4a** (§4.5 pkt. 5). Profilen er derfor merket
 * «kontrollvær — ikke ensemble-sjekket», og den merkingen er en del av
 * datastrukturen, ikke noe UI-et må huske å skrive. Maks over medlemmer er
 * en egen bølge, betinget av kostnadsmålingen i §6.3.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 */
import type { LatLon } from "@morild/geo";
import { harbourApproachable, R2_LIMIT_S, r2SearchInput } from "./bailout.js";
import type { BoatModel, NavigabilityMask, WeatherField } from "./contracts.js";
import type { BailoutGateKind, HarbourBookEntry } from "./harbour-book.js";
import {
  darknessGate,
  darknessPreGate,
  depthGate,
  requiredHarbourDepthM,
} from "./harbour-book.js";
import type { HarbourField } from "./harbour-field.js";
import { lowerBoundS } from "./harbour-field.js";
import type { RouteOptions } from "./options.js";
import { withDefaults } from "./options.js";
import type { RouteLeg, RouteStep } from "./result.js";
import { planRoute } from "./search.js";

/** Standard sampleintervall langs ruten (§4.5 pkt. 2). */
export const BAILOUT_SAMPLE_INTERVAL_S = 1800;

export interface BailoutSample {
  readonly epochS: number;
  /** Sekunder siden avgang — profilens egen tidsakse. */
  readonly tS: number;
  readonly position: LatLon;
  /** `min_h D_h(p)·3600/vmax`, `Infinity` når ingen havn er nåbar i feltene. */
  readonly lowerBoundS: number;
  readonly status: "ingen-innen-6t" | "naadd" | "ikke-anloepbar" | "ukjent";
  readonly harbourId: string | null;
  readonly timeToHarbourS: number | null;
  readonly gatesFailed: readonly BailoutGateKind[];
  /** Ble et fullt R2-søk faktisk kjørt i dette punktet? */
  readonly searched: boolean;
  /** Antall R2-søk punktet kostet (kostnadskolonnen, §6.3). */
  readonly searchCount: number;
}

export interface BailoutProfile {
  readonly samples: readonly BailoutSample[];
  /** Maks strekk uten «naadd», rundet OPP med et halvt sampleintervall. */
  readonly longestGapS: number | null;
  readonly coverage: "none" | "partial" | "full";
  readonly basis: "kontrollvaer" | "medlemmer";
  readonly label: "kontrollvær — ikke ensemble-sjekket" | "maks over medlemmer";
  readonly sampleIntervalS: number;
  readonly limitS: number;
  /** Havner ekskludert fordi dybden mangler (§4.5 pkt. 4: listen bak «partial»). */
  readonly missingDepthHarbourIds: readonly string[];
  /** Havner uten brukbart felt (maske/oppløsning nådde dem ikke). */
  readonly missingFieldHarbourIds: readonly string[];
  /** Kostnadstall (§6.3): fulle R2-søk kjørt i hele profilen. */
  readonly searchCount: number;
  /** Punkter feltet avviste uten et eneste søk. */
  readonly fieldScreenedSamples: number;
  /** Kandidat–punkt-par feltet avviste uten søk. */
  readonly fieldScreenedCandidates: number;
}

export interface BailoutRoute {
  readonly steps: readonly RouteStep[];
  /** Segmentskiftene. Hver `startTS` blir et ekstra samplepunkt. */
  readonly legs?: readonly RouteLeg[] | undefined;
}

export interface BailoutProfileInput {
  readonly route: BailoutRoute;
  readonly departEpochS: number;
  /** Kontrollværet (4a). */
  readonly weather: WeatherField;
  readonly mask: NavigabilityMask | undefined;
  readonly boat: BoatModel;
  readonly book: readonly HarbourBookEntry[];
  /** Havnefelt per havn-id. Mangler et felt, flagges havnen og dekningen. */
  readonly fields: ReadonlyMap<string, HarbourField>;
  readonly options?: Partial<RouteOptions> | undefined;
  /** Opsjoner som slås inn i selve R2-søket. */
  readonly searchOptions?: Partial<RouteOptions> | undefined;
  readonly limitS?: number | undefined;
  readonly sampleIntervalS?: number | undefined;
  /** Dybdekravet. Standard `requiredHarbourDepthM(boat)`. */
  readonly requiredDepthM?: number | undefined;
  /**
   * Tak på antall fulle R2-søk per samplet punkt. Standard: ingen.
   *
   * Taket er en **budsjettventil, ikke en semantisk grense**: treffer den,
   * blir punktet stående som `ukjent` (ikke `ingen-innen-6t`) — vi later
   * aldri som om et avbrutt søk er et bevis.
   */
  readonly maxSearchesPerSample?: number | undefined;
}

const EMPTY_PROFILE_BASE = {
  basis: "kontrollvaer",
  label: "kontrollvær — ikke ensemble-sjekket",
} as const;

/**
 * Posisjonen på ruten ved `tS`, lineært interpolert mellom rutepunktene.
 *
 * Interpolasjon er nødvendig fordi sampleintervallet (30 min) er finere enn
 * tidssteget i mange kjøringer (golden `skjaeloy-skagen-apent` går med 1 t).
 * Feilen er den samme som mellom to isokrone steg og bæres av havnefeltets
 * slakk; alternativet — å sample bare der det tilfeldigvis finnes et steg —
 * ville gjort profilens oppløsning avhengig av søkets diskretisering.
 */
export function positionAtTS(
  steps: readonly RouteStep[],
  tS: number,
): LatLon | undefined {
  if (steps.length === 0) return undefined;
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  if (tS <= first.tS) return { lat: first.lat, lon: first.lon };
  if (tS >= last.tS) return { lat: last.lat, lon: last.lon };
  let lo = 0;
  let hi = steps.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (steps[mid]!.tS <= tS) lo = mid;
    else hi = mid;
  }
  const a = steps[lo]!;
  const b = steps[hi]!;
  const span = b.tS - a.tS;
  const f = span > 0 ? (tS - a.tS) / span : 0;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/**
 * Tidspunktene profilen samples på: rutetidens 30-minuttersnett, pluss hvert
 * segmentskifte. Sortert, uten duplikater.
 */
export function sampleTimesS(
  route: BailoutRoute,
  intervalS: number,
): readonly number[] {
  const steps = route.steps;
  if (steps.length === 0) return [];
  const startTS = steps[0]!.tS;
  const endTS = steps[steps.length - 1]!.tS;
  const times: number[] = [];
  for (let t = startTS; t <= endTS; t += intervalS) times.push(t);
  for (const leg of route.legs ?? []) {
    if (leg.startTS > startTS && leg.startTS < endTS) times.push(leg.startTS);
  }
  times.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const t of times) {
    if (unique.length === 0 || unique[unique.length - 1] !== t) unique.push(t);
  }
  return unique;
}

/**
 * Lengste sammenhengende strekk uten `naadd`, i rutetid.
 *
 * Regelen (§4.5 pkt. 3): strekket måles mellom første og siste punkt i et
 * ubrutt løp av ikke-`naadd`-samples, og rundes **opp** med et halvt
 * sampleintervall — den ukjente biten på hver side av løpet, der vi ikke har
 * målt. Et enkelt punkt uten havn gir dermed et halvt intervall, ikke null:
 * å rapportere «0 t uten havn» for et punkt vi vet ikke hadde noen, ville
 * vært å runde feil vei.
 */
export function longestGapS(
  samples: readonly BailoutSample[],
  intervalS: number,
): number | null {
  if (samples.length === 0) return null;
  let best: number | null = null;
  let runStart: number | null = null;
  let runEnd = 0;
  const closeRun = (): void => {
    if (runStart === null) return;
    const gap = runEnd - runStart + intervalS / 2;
    if (best === null || gap > best) best = gap;
    runStart = null;
  };
  for (const s of samples) {
    if (s.status === "naadd") {
      closeRun();
      continue;
    }
    if (runStart === null) runStart = s.tS;
    runEnd = s.tS;
  }
  closeRun();
  return best;
}

/** «≥ 6 t»-formen fra §4.5 pkt. 3: `longestGapS >= limitS`. */
export function gapAtLeastLimit(
  profile: BailoutProfile,
  limitS: number = profile.limitS,
): boolean {
  return profile.longestGapS !== null && profile.longestGapS >= limitS;
}

interface Candidate {
  readonly entry: HarbourBookEntry;
  readonly lowerBoundS: number;
}

/** Bail-out-profilen for én rute under ett værfelt (kontrollen i 4a). */
export function bailoutProfile(input: BailoutProfileInput): BailoutProfile {
  const limitS = input.limitS ?? R2_LIMIT_S;
  const intervalS = input.sampleIntervalS ?? BAILOUT_SAMPLE_INTERVAL_S;
  const opts = withDefaults(input.options ?? {});
  const requiredDepthM = input.requiredDepthM ?? requiredHarbourDepthM(input.boat);
  const maxPerSample = input.maxSearchesPerSample ?? Number.POSITIVE_INFINITY;

  const missingDepthHarbourIds: string[] = [];
  const missingFieldHarbourIds: string[] = [];

  // Tom bok er IKKE «ingen brukbart alternativ» (§4.5 pkt. 4): den er
  // manglende dekning, og profilen sier det med `coverage: "none"` og ingen
  // samples i det hele tatt. `longestGapS: null` betyr «vi vet ikke», og UI-et
  // skriver «havneboken mangler dekning her». Det samme gjelder når hele boken
  // faller på dybde- eller feltmangel: da har vi ikke MÅLT noe hull, og å
  // rapportere ett ville vært å presentere manglende data som et funn.
  const noCoverage = (): BailoutProfile => ({
    samples: [],
    longestGapS: null,
    coverage: "none",
    ...EMPTY_PROFILE_BASE,
    sampleIntervalS: intervalS,
    limitS,
    missingDepthHarbourIds,
    missingFieldHarbourIds,
    searchCount: 0,
    fieldScreenedSamples: 0,
    fieldScreenedCandidates: 0,
  });
  if (input.book.length === 0) return noCoverage();

  // Dybdegaten er væruavhengig og punktuavhengig: den kjøres én gang for hele
  // boken, ikke per sample.
  const usable: HarbourBookEntry[] = [];
  const depthFailed: HarbourBookEntry[] = [];
  for (const entry of input.book) {
    const verdict = depthGate(entry, requiredDepthM);
    if (verdict.passed) {
      usable.push(entry);
      continue;
    }
    if (verdict.gate === "mangler-dybde") missingDepthHarbourIds.push(entry.id);
    depthFailed.push(entry);
  }

  const withField: HarbourBookEntry[] = [];
  for (const entry of usable) {
    const field = input.fields.get(entry.id);
    if (field === undefined || field.reachedCells === 0) {
      missingFieldHarbourIds.push(entry.id);
      continue;
    }
    withField.push(entry);
  }
  if (withField.length === 0) return noCoverage();

  const times = sampleTimesS(input.route, intervalS);
  const samples: BailoutSample[] = [];
  let searchCount = 0;
  let fieldScreenedSamples = 0;
  let fieldScreenedCandidates = 0;

  for (const tS of times) {
    const position = positionAtTS(input.route.steps, tS);
    if (position === undefined) continue;
    const epochS = input.departEpochS + tS;

    const candidates: Candidate[] = [];
    let minLowerBoundS = Infinity;
    for (const entry of withField) {
      const field = input.fields.get(entry.id)!;
      const lb = lowerBoundS(field, position);
      if (lb < minLowerBoundS) minLowerBoundS = lb;
      if (lb > limitS) {
        fieldScreenedCandidates++;
        continue;
      }
      candidates.push({ entry, lowerBoundS: lb });
    }

    // Gatene som slo til i dette punktet, i rekkefølge, uten duplikater.
    const gatesFailed: BailoutGateKind[] = [];
    const noteGate = (gate: BailoutGateKind): void => {
      if (!gatesFailed.includes(gate)) gatesFailed.push(gate);
    };
    if (depthFailed.length > 0) {
      for (const entry of depthFailed) {
        noteGate(
          entry.minDepthAtQuayM === null || entry.minDepthAtAnchorageM === null
            ? "mangler-dybde"
            : "dybde",
        );
      }
    }

    if (candidates.length === 0) {
      // Feltets ENESTE konklusjon: ingen havn innen skranken.
      fieldScreenedSamples++;
      samples.push({
        epochS,
        tS,
        position,
        lowerBoundS: minLowerBoundS,
        status: "ingen-innen-6t",
        harbourId: null,
        timeToHarbourS: null,
        gatesFailed,
        searched: false,
        searchCount: 0,
      });
      continue;
    }

    // Stigende nedre skranke; havn-id som deterministisk tie-break.
    candidates.sort(
      (a, b) =>
        a.lowerBoundS - b.lowerBoundS ||
        (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0),
    );

    let status: BailoutSample["status"] = "ukjent";
    let harbourId: string | null = null;
    let timeToHarbourS: number | null = null;
    let sampleSearches = 0;

    for (const candidate of candidates) {
      if (sampleSearches >= maxPerSample) break;
      const entry = candidate.entry;

      const preDark = darknessPreGate(
        entry,
        epochS + candidate.lowerBoundS,
        epochS + limitS,
      );
      if (!preDark.passed) {
        // Merk: dette gir IKKE `ikke-anloepbar`. Vi vet at ankomsten ville
        // vært i mørket, men ikke at vi hadde rukket fram — søket ble aldri
        // kjørt. `ukjent` er det ærlige svaret; gaten står i `gatesFailed`.
        noteGate(preDark.gate);
        continue;
      }

      const maxIterations = Math.ceil(limitS / opts.timeStepS) + 1;
      sampleSearches++;
      searchCount++;
      const result = planRoute(
        r2SearchInput({
          from: position,
          harbour: entry.position,
          departEpochS: epochS,
          weather: input.weather,
          mask: input.mask,
          boat: input.boat,
          options: input.options,
          searchOptions: input.searchOptions,
          maxIterations,
          // Fasiten og produksjonen er Pareto på udelt maske (§4.5 pkt. 2).
          scalarSearchMode: false,
        }),
      );
      if (!result.safety.reachesDestination) continue;
      if (result.totals.durationS > limitS) continue;

      // Framme i tide, men ikke inn: mørke og vær er begge *anløpbarhet*, og
      // punktet skal si `ikke-anloepbar` — ikke `ukjent`. Forskjellen er reell:
      // «du rekker fram, men kommer ikke inn» er et annet råd enn «vi vet ikke
      // om du rekker fram».
      const dark = darknessGate(entry, result.totals.arrivalEpochS);
      if (!dark.passed) {
        noteGate(dark.gate);
        if (status === "ukjent") status = "ikke-anloepbar";
        continue;
      }

      // `HarbourBookEntry extends BailoutHarbour`: samme værgate som R2 bruker.
      const weatherVerdict = harbourApproachable(
        entry,
        input.weather,
        result.totals.arrivalEpochS,
      );
      if (!weatherVerdict.approachable) {
        noteGate("vaer");
        if (status === "ukjent") status = "ikke-anloepbar";
        continue;
      }

      status = "naadd";
      harbourId = entry.id;
      timeToHarbourS = result.totals.durationS;
      break;
    }

    samples.push({
      epochS,
      tS,
      position,
      lowerBoundS: minLowerBoundS,
      status,
      harbourId,
      timeToHarbourS,
      gatesFailed,
      searched: sampleSearches > 0,
      searchCount: sampleSearches,
    });
  }

  const coverage: BailoutProfile["coverage"] =
    missingDepthHarbourIds.length > 0 || missingFieldHarbourIds.length > 0
      ? "partial"
      : "full";

  return {
    samples,
    longestGapS: longestGapS(samples, intervalS),
    coverage,
    ...EMPTY_PROFILE_BASE,
    sampleIntervalS: intervalS,
    limitS,
    missingDepthHarbourIds,
    missingFieldHarbourIds,
    searchCount,
    fieldScreenedSamples,
    fieldScreenedCandidates,
  };
}
