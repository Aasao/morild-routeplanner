/**
 * Konfigurasjon og standardverdier (docs/specs/rutemotor.md §4.7).
 *
 * Alle tall som ikke er utledet fra fysikk er markert med hvor de kommer fra:
 * v1-arv, ADR-0004, eller «gjetningsbasert startpunkt som skal måles». Vi
 * later ikke som om et ukalibrert tall er en fasit.
 */
import type { CostWeights } from "./cost.js";
import type { Domain } from "./domain.js";
import { SCANDINAVIA } from "./domain.js";
import type { TackPenaltyParams } from "./tack.js";
import { DEFAULT_TACK_PARAMS } from "./tack.js";
import type { TssRuleParams } from "./tss.js";
import { DEFAULT_TSS_PARAMS } from "./tss.js";

export interface RouteOptions {
  // --- Søkeoppløsning (F3.5) ---
  /** 6° for kontrollmedlem, 10–12° for ensemble-medlem. */
  readonly headingStepDeg: number;
  /** 1800 eller 3600 sekunder. */
  readonly timeStepS: number;
  /** Cellestørrelse for tilstandsnøkkelen. v1: 0,02°. */
  readonly cellDeg: number;
  readonly domain: Domain;

  // --- Etikett-tak (ADR-0004 mottiltak) ---
  readonly maxLabelsPerState: number;
  /**
   * Tak per celle på tvers av sektorer.
   *
   * **Avvik fra spec §4.7 (målt, ikke antatt).** Spec-en foreslår 12, men
   * krever i §7 måling 2 at tallet måles før det låses. Målingen er gjort på
   * v1s referansestrekk Skjæløy→Skagen (87 nm, 6° kurs, 1 t steg,
   * syntetisk felt), og resultatet er entydig:
   *
   * | tak per celle | utfall | etiketter | tid |
   * |---|---|---|---|
   * | 12 (spec) | **når ikke fram** — `labelCap` ved 250 000 | 250 000 | 9,8 s |
   * | 6 | 15,28 t / 86,0 nm | 169 678 | 7,6 s |
   * | 4 | 15,28 t / 86,0 nm | 116 177 | 3,5 s |
   *
   * Rutene er *identiske* for 6 og 4 — det tolvte etikettslotet kjøper
   * ingen rutekvalitet på denne geometrien, men gjør at
   * standardkonfigurasjonen ikke klarer prosjektets egen referanseetappe.
   * Vi setter derfor 6: halvparten av spec-forslaget, fortsatt seks ganger
   * v1s ene node per celle, og med margin igjen til skjærgård (Bohuslän-
   * scenariet topper på 3 846 aktive etiketter og berører aldri taket).
   */
  readonly maxLabelsPerCell: number;
  readonly maxTotalLabels: number;

  // --- Avbrudd (v1-arv) ---
  readonly maxIterations: number;
  readonly stagnationIterations: number;

  // --- Beskjæring ---
  /** Slakk på Tub-bounden. Gjetningsbasert startpunkt (spec §9 spm. 4). */
  readonly tubMarginFrac: number;
  /** v1: 1,09. Gjør restestimatet konservativt, altså bounden svakere. */
  readonly boundSlack: number;
  /**
   * Kjeglen er **av som standard** (ADR-0004 avvik 2). Den er beholdt som en
   * valgfri ventil, ikke som algoritmisk kjernebegrensning.
   *
   * Spec §7 måling 1 ber om kostnaden ved å fjerne den. Målt på
   * Skjæløy→Skagen: `undefined` gir 44 578 aktive etiketter på topp,
   * `165` (v1 med land) gir 44 360, og `115` gir 42 884 — altså **under 4 %**
   * forskjell. A\*-feltets blindvei-eliminering gjør allerede jobben kjeglen
   * gjorde i v1, og ADR-0004s bekymring for at fjerningen skulle koste
   * søkerom er dermed målt til å være liten på denne geometrien.
   */
  readonly coneDeg: number | undefined;

  // --- Brukervekter: KUN rangering, aldri søk (besluttet 2026-08-30) ---
  readonly rankingWeights: CostWeights;
  readonly beatWeightLengthScaling: boolean;

  // --- Harde brukerkrav (F3.4) ---
  /** Gjelder **kun sluttankomsten** (besluttet 2026-08-30, spec §9 spm. 12). */
  readonly requireDaylightArrival: boolean;
  /** Mannskapstak. Etterfilter/rapportering i v2.0, ikke hard constraint. */
  readonly maxContinuousLegS: number | undefined;
  /** Kystbuffer i nm. v1: 0,5. */
  readonly minOffingNm: number;
  /** Kystbufferen gjelder ikke nær start/mål (havneanløp). v1: 3,0 nm. */
  readonly offingExemptNearEndsNm: number;
  /**
   * Sjøgangstillegg i klaringstallet: kravet til kystbuffer øker med
   * `hsM · denne` (besluttet 2026-08-30 — sjøgang inn i klaringstallet, hard
   * avvisning når data finnes). Ukalibrert startpunkt: 0,10 nm per meter Hs.
   * Mangler bølgedata, faller kravet tilbake til `minOffingNm` og etiketten
   * flagges `SJOEGANG_DATA_MANGLER` — vi later ikke som marginen er dekket.
   */
  readonly seaStateOffingNmPerM: number;
  /**
   * R3 (besluttet 2026-08-31): kystbufferen håndheves langs **hele korden**,
   * ikke bare i kandidatpunktet. Bommer Lipschitz-gaten, deles korden rekursivt
   * til den kan sertifiseres eller et brudd er målt. Denne verdien er
   * rekursjonsbunnen i nm: en korde kortere enn dette deles ikke videre, og
   * hvis gaten fortsatt bommer, avvises den (sikkerhet foran optimalitet).
   * Konservatismen er dermed avgrenset til halve denne lengden — 0,01 nm ≈
   * 18 m med standardverdien.
   */
  readonly clearanceCorridorMinChordNm: number;
  /** Dybdetak i bisectionen. Vern mot patologiske felt, ikke normal stopp. */
  readonly clearanceCorridorMaxDepth: number;
  /** Kryss defineres som TWA < denne. v1s kryssandel-definisjon: 60°. */
  readonly beatTwaDeg: number;

  readonly tackParams: TackPenaltyParams;
  readonly tssParams: TssRuleParams;

  // --- Rapportering ---
  readonly isochroneSnapshotHours: number;

  /**
   * Referansemodus: slår AV alle **tapsgivende** beskjæringer (etikett-tak,
   * Tub-bound, stagnasjonsvakt, kjegle). Det globale etikett-taket og
   * iterasjonstaket står igjen som rene sikkerhetsgrenser — de er der for at
   * en feilkonfigurert kjøring ikke skal spise all minne, ikke for å
   * beskjære. Kun for egenskapstester på små problemer, aldri i produksjon.
   */
  readonly exactMode: boolean;
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = Object.freeze({
  headingStepDeg: 6,
  timeStepS: 1800,
  cellDeg: 0.02,
  domain: SCANDINAVIA,

  maxLabelsPerState: 4,
  maxLabelsPerCell: 6,
  maxTotalLabels: 250_000,

  maxIterations: 1500,
  stagnationIterations: 80,

  tubMarginFrac: 0.25,
  boundSlack: 1.09,
  coneDeg: undefined,

  rankingWeights: Object.freeze({ beat: 0.5, motor: 0.5, night: 0.5 }),
  beatWeightLengthScaling: true,

  requireDaylightArrival: false,
  maxContinuousLegS: undefined,
  minOffingNm: 0.5,
  offingExemptNearEndsNm: 3.0,
  seaStateOffingNmPerM: 0.1,
  clearanceCorridorMinChordNm: 0.02,
  clearanceCorridorMaxDepth: 12,
  beatTwaDeg: 60,

  tackParams: DEFAULT_TACK_PARAMS,
  tssParams: DEFAULT_TSS_PARAMS,

  isochroneSnapshotHours: 6,
  exactMode: false,
});

/** Absolutt tak fra ADR-0004 — over dette avviser vi konfigurasjonen. */
export const ABSOLUTE_MAX_LABELS = 400_000;

export function withDefaults(
  overrides: Partial<RouteOptions> = {},
): RouteOptions {
  const merged = { ...DEFAULT_ROUTE_OPTIONS, ...overrides };
  if (merged.maxTotalLabels > ABSOLUTE_MAX_LABELS) {
    throw new Error(
      `maxTotalLabels ${merged.maxTotalLabels} overstiger det absolutte taket ${ABSOLUTE_MAX_LABELS}`,
    );
  }
  if (merged.headingStepDeg <= 0 || merged.headingStepDeg > 90) {
    throw new Error(`Ugyldig headingStepDeg: ${merged.headingStepDeg}`);
  }
  if (merged.timeStepS <= 0) {
    throw new Error(`Ugyldig timeStepS: ${merged.timeStepS}`);
  }
  return merged;
}
