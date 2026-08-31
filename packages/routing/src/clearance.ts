/**
 * Kystbuffer langs **hele korden** — R3, lagdelt (docs/specs/rutemotor.md
 * §5.3.2, besluttet av Magnus 2026-08-31).
 *
 * Problemet R3 løser: fram til 2026-08-31 ble klaringskravet bare kontrollert i
 * kandidatpunktet. Et tidssteg er en korde på flere nautiske mil, og en korde
 * kan runde et nes med god klaring i *begge* ender og 0,1 nm på midten. Kravet
 * var dermed per definisjon mykt — «et hardt krav som bare kontrolleres i
 * endepunktene er ikke kontrollert» (kartologen).
 *
 * Mekanismen er tre lag, og alle tre bor i denne filen slik at søket,
 * evaluatoren, konsolideringen, ettersjekken og sluttetappen bruker **samme
 * kode** (én-sannhet-prinsippet, §5.11):
 *
 *  1. **Lipschitz-gaten (gratis).** Klaringsfunksjonen d(p) = avstand fra p til
 *     nærmeste ikke-farbare areal er **1-Lipschitz**: |d(p) − d(q)| ≤ |pq|.
 *     For et vilkårlig punkt p på korden A→B med kordelengde L gjelder derfor
 *
 *         d(p) ≥ max(d(A) − |Ap|, d(B) − |pB|),   |Ap| + |pB| = L
 *
 *     og minimum over korden er lavest når de to skrankene møtes, altså i
 *     `(d(A) + d(B) − L)/2`. Betingelsen
 *
 *         **d(A) + d(B) ≥ 2·krav + L**
 *
 *     garanterer dermed at *intet* punkt på korden bryter kravet. Den er skarp:
 *     det finnes klaringsfelt der likhet er akkurat nok og hvor som helst
 *     mindre er utrygt.
 *  2. **Rekursiv bisection ved gate-miss.** Gaten er tilstrekkelig, ikke
 *     nødvendig. Bommer den, deles korden på midten: klaringen i midtpunktet
 *     måles, og gaten anvendes på hver halvdel. Dette er en
 *     Lipschitz-sertifisert intervallmetode — den terminerer, og hver gren
 *     ender enten i «sertifisert trygg» eller i et konkret punkt der klaringen
 *     er under kravet. Fast finmasket sampling *uten* Lipschitz-terskel er
 *     bevisst forkastet: den har alltid restlekkasje mellom prøvepunktene.
 *  3. **Full korridorsjekk i den autoritative stien.** Ettersjekken (§5.10),
 *     konsolideringen (§5.9) og sluttetappen (§5.8) kjører alltid den samme
 *     mekanismen, uavhengig av hva søket gjorde — forsvar i dybden.
 *
 * **Forutsetningen garantien hviler på:** `mask.clearanceNm` må aldri
 * *overestimere* avstanden til nærmeste fare. Avkorting ved `maxNm` er en
 * gyldig nedre skranke og bevarer garantien; overestimering ville brutt den.
 * Kravet føres i `docs/specs/farbarhetsmaske.md` (annen eier), ikke antas her.
 *
 * **maxNm må være stor nok.** Fordi avkortede klaringstall er nedre skranker,
 * kan gaten aldri passere hvis `maxNm < krav + L/2`. Vi spør derfor alltid med
 * `maxNm ≥ krav + L` (`queryCapNm`), ellers ville hele søket falt ned i
 * bisection uten grunn.
 *
 * **Korde vs. storsirkel.** Punktene på korden parametriseres lineært i
 * lat/lon — samme flate modell som `stepLatLon`, og nøyaktig den linjen
 * `mask.segmentVerdict` vurderer. Avviket mot storsirkelen er neglisjerbart
 * for kordelengder ≤ 4 nm (meter-nivå), og noteres her i stedet for å
 * kompenseres.
 *
 * Ren og deterministisk som resten av motoren: ingen I/O, ingen klokke, ingen
 * `Math.random`.
 */
import type { LatLon } from "@morild/geo";
import { haversineNm } from "@morild/geo";
import type { NavigabilityMask } from "./contracts.js";
import { FLAG_SJOEGANG_DATA_MANGLER } from "./cost.js";
import { HARD_OK, type HardCheck } from "./expand.js";

/** Parametrene korridorsjekken trenger. `RouteOptions` oppfyller dem. */
export interface CorridorParams {
  /** Statisk kystbuffer i nm. v1: 0,5. */
  readonly minOffingNm: number;
  /** Bufferen gjelder ikke nær start/mål (havneanløp). v1: 3,0 nm. */
  readonly offingExemptNearEndsNm: number;
  /** Sjøgangstillegg i klaringstallet: kravet øker med `hsM · denne`. */
  readonly seaStateOffingNmPerM: number;
  /**
   * Rekursjonsbunn i bisectionen. Korder kortere enn denne deles ikke videre;
   * har gaten bommet på dem, kan de ikke sertifiseres og avvises (se
   * `uncertified` under).
   */
  readonly clearanceCorridorMinChordNm: number;
  /** Absolutt dybdetak i bisectionen — vern, ikke normal terminering. */
  readonly clearanceCorridorMaxDepth: number;
}

export const DEFAULT_CORRIDOR_PARAMS: CorridorParams = Object.freeze({
  minOffingNm: 0.5,
  offingExemptNearEndsNm: 3.0,
  seaStateOffingNmPerM: 0.1,
  clearanceCorridorMinChordNm: 0.02,
  clearanceCorridorMaxDepth: 12,
});

/**
 * Instrumentering (§7 «det som må måles»): hvor ofte holder gaten, hvor ofte
 * må vi bisecte, og hvor dypt? Tallene bæres ut i `RouteResult.diagnostics`
 * slik at nettbrett-målingen kan lese kostnaden i stedet for å gjette den.
 *
 * Muterbar med vilje — den er en teller, ikke en verdi. Determinismen er
 * uberørt: tellingen følger den samme deterministiske kallrekkefølgen.
 */
export interface CorridorStats {
  /** Korder (og delkorder) der Lipschitz-gaten alene ga garantien. */
  gatePass: number;
  /** Korder (og delkorder) der gaten bommet og vi måtte gå videre. */
  gateMiss: number;
  /** Antall midtpunkter evaluert i bisectionen. */
  midpointChecks: number;
  /** Største rekursjonsdybde nådd. 0 = bisection aldri brukt. */
  maxDepth: number;
  /** Antall `mask.clearanceNm`-kall gjort av korridorsjekken selv. */
  clearanceCalls: number;
  /** Antall harde avvisninger. */
  rejections: number;
  /** Korder som falt helt innenfor havneunntaket. */
  exemptChords: number;
  /** Avvisninger som skyldtes rekursjonsbunnen, ikke et målt brudd. */
  uncertified: number;
}

export function createCorridorStats(): CorridorStats {
  return {
    gatePass: 0,
    gateMiss: 0,
    midpointChecks: 0,
    maxDepth: 0,
    clearanceCalls: 0,
    rejections: 0,
    exemptChords: 0,
    uncertified: 0,
  };
}

/** Slår `source` inn i `target`. Brukes til å summere delfaser. */
export function addCorridorStats(
  target: CorridorStats,
  source: CorridorStats,
): void {
  target.gatePass += source.gatePass;
  target.gateMiss += source.gateMiss;
  target.midpointChecks += source.midpointChecks;
  target.maxDepth = Math.max(target.maxDepth, source.maxDepth);
  target.clearanceCalls += source.clearanceCalls;
  target.rejections += source.rejections;
  target.exemptChords += source.exemptChords;
  target.uncertified += source.uncertified;
}

/** Frossen kopi til `RouteResult` (ren data, ingen delt muterbar tilstand). */
export function freezeCorridorStats(stats: CorridorStats): CorridorStats {
  return Object.freeze({ ...stats });
}

/** Havneendene unntaket måles mot. */
export interface CorridorEnds {
  readonly start: LatLon;
  readonly dest: LatLon;
}

export interface CorridorFailure {
  readonly lat: number;
  readonly lon: number;
  /** Målt klaring (eller gyldig nedre skranke) i punktet, i nm. */
  readonly clearanceNm: number;
  readonly requiredNm: number;
  /**
   * Sant når avvisningen kom av rekursjonsbunnen: korden kunne ikke
   * *sertifiseres* trygg, men vi har heller ikke målt et brudd. Det skjer bare
   * for korder som streifer kravgrensen innenfor `clearanceCorridorMinChordNm/2`
   * (standard 18 m). Vi avviser da — sikkerhet foran optimalitet.
   */
  readonly uncertified: boolean;
}

export interface CorridorInput {
  readonly mask: NavigabilityMask | undefined;
  readonly from: LatLon;
  readonly to: LatLon;
  /** Kjent klaring i `from` (forelderens lagrede tall). Må være nedre skranke. */
  readonly fromClearanceNm?: number | undefined;
  /** Kjent klaring i `to` (steg 13s oppslag). Må være nedre skranke. */
  readonly toClearanceNm?: number | undefined;
  /** Kordelengde i nm når kalleren allerede har den (sparer én haversine). */
  readonly chordNm?: number | undefined;
  /** Signifikant bølgehøyde der steget seiles. `undefined` = ingen data. */
  readonly hsM: number | undefined;
  /** `undefined` ⇒ ingen havneunntak (f.eks. ved evaluering av en delrute). */
  readonly ends: CorridorEnds | undefined;
  readonly params: CorridorParams;
  /** `maxNm` for interne klaringsoppslag. Løftes alltid til `krav + L`. */
  readonly queryCapNm?: number | undefined;
  readonly stats?: CorridorStats | undefined;
}

export interface CorridorOutcome {
  readonly check: HardCheck;
  /** Flagg som skal settes på etiketten uansett utfall. */
  readonly flags: number;
  readonly requiredNm: number;
  /** Klaringen i `to`, slik den ble målt/mottatt. Lagres på etiketten. */
  readonly toClearanceNm: number;
  readonly failure: CorridorFailure | null;
}

/**
 * Klaringskravet i ett punkt: statisk buffer pluss sjøgangstillegg.
 *
 * Besluttet 2026-08-30: sjøgangen går inn i selve klaringstallet og gir hard
 * avvisning når bølgedata finnes; mangler data, faller kravet tilbake til
 * `minOffingNm` og etiketten flagges — vi later ikke som marginen er dekket.
 */
export function requiredClearanceNm(
  minOffingNm: number,
  hsM: number | undefined,
  seaStateOffingNmPerM: number,
): number {
  return minOffingNm + (hsM === undefined ? 0 : hsM * seaStateOffingNmPerM);
}

const OK_OUTCOME_NO_MASK: CorridorOutcome = Object.freeze({
  check: HARD_OK,
  flags: 0,
  requiredNm: 0,
  toClearanceNm: Number.POSITIVE_INFINITY,
  failure: null,
});

/**
 * **Hard:** holder kystbufferen langs hele korden `from`→`to`?
 *
 * Kalles med `from === to` gir nøyaktig den gamle punkttesten (L = 0 ⇒ gaten
 * reduseres til `d ≥ krav`) — det er ingen egen kodevei for punkttesten.
 */
export function checkClearanceCorridor(input: CorridorInput): CorridorOutcome {
  const { mask, from, to, params, stats } = input;
  if (mask === undefined || params.minOffingNm <= 0) return OK_OUTCOME_NO_MASK;

  const requiredNm = requiredClearanceNm(
    params.minOffingNm,
    input.hsM,
    params.seaStateOffingNmPerM,
  );
  const seaStateNm = requiredNm - params.minOffingNm;
  const flags = input.hsM === undefined ? FLAG_SJOEGANG_DATA_MANGLER : 0;

  const chordNm = input.chordNm ?? haversineNm(from, to);
  // Avkortede klaringstall er gyldige nedre skranker, men gaten kan ikke
  // passere med et tak lavere enn krav + L/2. Vi spør med krav + L.
  const capNm = Math.max(input.queryCapNm ?? 0, requiredNm + chordNm);

  const toClearanceNm =
    input.toClearanceNm ?? measureClearance(mask, to, capNm, stats);
  const fromClearanceNm =
    input.fromClearanceNm ??
    (chordNm <= 0
      ? toClearanceNm
      : measureClearance(mask, from, capNm, stats));

  const ctx: VerifyContext = {
    mask,
    requiredNm,
    capNm,
    params,
    stats,
    // Løses dovent: havneunntaket koster storsirkelavstander, og de skal ikke
    // betales for de aller fleste kandidatene, som ligger langt fra land.
    ends: input.ends,
    zone: undefined,
    zoneResolved: false,
  };

  const verdict = verifyChord(
    ctx,
    from,
    to,
    fromClearanceNm,
    toClearanceNm,
    chordNm,
    0,
  );

  if (verdict.kind === "exempt") {
    // Hele korden ligger i havneunntaket: kravet gjelder ikke, og da har
    // sjøgangsflagget heller ingenting å si om.
    return { check: HARD_OK, flags: 0, requiredNm, toClearanceNm, failure: null };
  }
  if (verdict.kind === "certified") {
    return { check: HARD_OK, flags, requiredNm, toClearanceNm, failure: null };
  }

  const f = verdict.failure;
  if (stats !== undefined) {
    stats.rejections++;
    if (f.uncertified) stats.uncertified++;
  }
  return {
    check: {
      ok: false,
      reason: f.uncertified
        ? `Kystbuffer: korden kan ikke sertifiseres mot kravet ${requiredNm.toFixed(2)} nm ` +
          `(nærmeste målte klaring ${f.clearanceNm.toFixed(2)} nm ved ${f.lat.toFixed(4)}, ${f.lon.toFixed(4)})`
        : `Klaring ${f.clearanceNm.toFixed(2)} nm under kravet ${requiredNm.toFixed(2)} nm` +
          (seaStateNm > 0
            ? ` (inkl. sjøgangstillegg ${seaStateNm.toFixed(2)} nm)`
            : "") +
          (chordNm > 0
            ? ` ved ${f.lat.toFixed(4)}, ${f.lon.toFixed(4)} på korden`
            : ""),
    },
    flags,
    requiredNm,
    toClearanceNm,
    failure: f,
  };
}

// ------------------------------------------------------------------ internt

interface ExemptZone {
  readonly start: LatLon;
  readonly dest: LatLon;
  readonly radiusNm: number;
}

interface VerifyContext {
  readonly mask: NavigabilityMask;
  readonly requiredNm: number;
  readonly capNm: number;
  readonly params: CorridorParams;
  readonly stats: CorridorStats | undefined;
  readonly ends: CorridorEnds | undefined;
  zone: ExemptZone | undefined;
  zoneResolved: boolean;
}

type ChordVerdict =
  | { readonly kind: "certified" }
  | { readonly kind: "exempt" }
  | { readonly kind: "failed"; readonly failure: CorridorFailure };

const CERTIFIED: ChordVerdict = Object.freeze({ kind: "certified" });
const EXEMPT: ChordVerdict = Object.freeze({ kind: "exempt" });

function measureClearance(
  mask: NavigabilityMask,
  p: LatLon,
  capNm: number,
  stats: CorridorStats | undefined,
): number {
  if (stats !== undefined) stats.clearanceCalls++;
  return mask.clearanceNm(p.lat, p.lon, capNm);
}

/**
 * Midtpunktet i den lineære lat/lon-parametriseringen — samme linje som
 * `mask.segmentVerdict` vurderer, og samme flate modell som `stepLatLon`.
 */
function midpoint(a: LatLon, b: LatLon): LatLon {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

/**
 * Lag 1 + lag 2 på én korde. Returnerer `certified` når hele korden er
 * garantert innenfor kravet, `exempt` når hele korden ligger i havneunntaket,
 * og ellers punktet som feller den.
 */
function verifyChord(
  ctx: VerifyContext,
  a: LatLon,
  b: LatLon,
  dA: number,
  dB: number,
  chordNm: number,
  depth: number,
): ChordVerdict {
  const stats = ctx.stats;
  if (stats !== undefined && depth > stats.maxDepth) stats.maxDepth = depth;

  // --- Lag 1: den skarpe Lipschitz-gaten.
  if (dA + dB >= 2 * ctx.requiredNm + chordNm) {
    if (stats !== undefined) stats.gatePass++;
    return CERTIFIED;
  }
  if (stats !== undefined) stats.gateMiss++;

  // Havneanløp: ligger hele korden inne i unntakssonen, gjelder ikke kravet.
  // Disken er konveks, så to endepunkter i samme disk ⇒ hele korden i disken.
  if (chordIsExempt(ctx, a, b)) {
    if (stats !== undefined) stats.exemptChords++;
    return EXEMPT;
  }

  // Endepunktene: målt brudd, ikke bare manglende sertifikat.
  if (dA < ctx.requiredNm && !pointIsExempt(ctx, a)) {
    return failed(a, dA, ctx.requiredNm, false);
  }
  if (dB < ctx.requiredNm && !pointIsExempt(ctx, b)) {
    return failed(b, dB, ctx.requiredNm, false);
  }

  // --- Lag 2: rekursiv bisection.
  if (
    chordNm <= ctx.params.clearanceCorridorMinChordNm ||
    depth >= ctx.params.clearanceCorridorMaxDepth
  ) {
    // Bunnen. Gaten bommet, så vi kan ikke sertifisere korden; da avviser vi.
    // Konservatismen er kvantifisert: et brudd ville i så fall ligget innenfor
    // `chordNm/2` av kravgrensen (≤ 18 m med standardverdien).
    return failed(
      midpoint(a, b),
      Math.min(dA, dB),
      ctx.requiredNm,
      true,
    );
  }

  const m = midpoint(a, b);
  const dM = measureClearance(ctx.mask, m, ctx.capNm, stats);
  if (stats !== undefined) stats.midpointChecks++;
  if (dM < ctx.requiredNm && !pointIsExempt(ctx, m)) {
    return failed(m, dM, ctx.requiredNm, false);
  }

  const half = chordNm / 2;
  const left = verifyChord(ctx, a, m, dA, dM, half, depth + 1);
  if (left.kind === "failed") return left;
  const right = verifyChord(ctx, m, b, dM, dB, half, depth + 1);
  if (right.kind === "failed") return right;
  return CERTIFIED;
}

function failed(
  p: LatLon,
  clearanceNm: number,
  requiredNm: number,
  uncertified: boolean,
): ChordVerdict {
  return {
    kind: "failed",
    failure: {
      lat: p.lat,
      lon: p.lon,
      clearanceNm,
      requiredNm,
      uncertified,
    },
  };
}

/**
 * Havneunntaket løses første gang det spørres etter, og slås av helt hvis
 * korden er for langt unna til å kunne berøre noen av diskene. Da koster
 * unntaket ingenting i resten av rekursjonen.
 */
function zoneOf(ctx: VerifyContext): ExemptZone | undefined {
  if (!ctx.zoneResolved) {
    ctx.zoneResolved = true;
    const ends = ctx.ends;
    const radiusNm = ctx.params.offingExemptNearEndsNm;
    ctx.zone =
      ends === undefined || radiusNm <= 0
        ? undefined
        : { start: ends.start, dest: ends.dest, radiusNm };
  }
  return ctx.zone;
}

function pointIsExempt(ctx: VerifyContext, p: LatLon): boolean {
  const zone = zoneOf(ctx);
  if (zone === undefined) return false;
  return (
    haversineNm(p, zone.start) <= zone.radiusNm ||
    haversineNm(p, zone.dest) <= zone.radiusNm
  );
}

function chordIsExempt(ctx: VerifyContext, a: LatLon, b: LatLon): boolean {
  const zone = zoneOf(ctx);
  if (zone === undefined) return false;
  return (
    (haversineNm(a, zone.start) <= zone.radiusNm &&
      haversineNm(b, zone.start) <= zone.radiusNm) ||
    (haversineNm(a, zone.dest) <= zone.radiusNm &&
      haversineNm(b, zone.dest) <= zone.radiusNm)
  );
}
