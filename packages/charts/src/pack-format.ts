/**
 * packages/charts — pakkeformatet for farbarhetsmasken.
 *
 * Typene her er den delte kontrakten mellom byggepipelinen
 * (`tools/chart-pack`, som produserer pakker) og kartleser-API-et i denne
 * pakken (som kun gjør oppslag mot ferdige pakker — F1.0 prefabrikkert-
 * prinsipp). Ingen I/O her, kun datastrukturer.
 *
 * Grunnlag: docs/specs/farbarhetsmaske.md §3.1–§3.3.
 */
import type { PackageHeader, SourceStatus } from "@morild/protocol";

/** §3.2 — manglende dekning er en egen degraderingstilstand, ikke et fjerde nivå. */
export type TrustLevel = "trygt" | "usikkert" | "no-go";

/**
 * §3.3 — datum er PER LAG, ikke per kildeorganisasjon. Et lag med datum
 * ulik "K0" (eller ukjent) kan aldri alene gi `trygt`, uansett målt dybde.
 */
export type Datum = "K0" | "MHW" | "DDM-middelverdi" | "ukjent";

export type ChartLayerId =
  | "dybdebaand"
  | "torrfall"
  | "skjaer"
  | "grunne"
  | "luftspenn"
  | "farled"
  | "tss"
  | "vernesone"
  | "datakvalitet"
  | "sonderingsguardrail";

export interface ChartLayerMetadata {
  readonly id: ChartLayerId;
  readonly kilde: string;
  readonly datum: Datum;
  /** ISO-dato: kildeuttrekkets tidspunkt. */
  readonly vintage: string;
  readonly baselineTillit: TrustLevel | "n/a";
  readonly sourceStatus: SourceStatus;
}

/** En enkelt lat/lon-flis, §3.1: 0,5° lengdegrad × 0,25° breddegrad. */
export interface ChartTileId {
  readonly lonIndex: number;
  readonly latIndex: number;
}

export function tileIdToString(id: ChartTileId): string {
  return `${id.latIndex}_${id.lonIndex}`;
}

/**
 * Finner flis-ID-en et punkt hører til, gitt rutenettet i §3.1. Rutenettet
 * er forankret i (0°, 0°) — flis-indeksen er `floor(verdi / steg)`.
 */
export function tileIdForPoint(
  lat: number,
  lon: number,
  grid: { readonly lonStepDeg: number; readonly latStepDeg: number },
): ChartTileId {
  return {
    lonIndex: Math.floor(lon / grid.lonStepDeg),
    latIndex: Math.floor(lat / grid.latStepDeg),
  };
}

export function tileBounds(
  id: ChartTileId,
  grid: { readonly lonStepDeg: number; readonly latStepDeg: number },
): { readonly west: number; readonly south: number; readonly east: number; readonly north: number } {
  return {
    west: id.lonIndex * grid.lonStepDeg,
    south: id.latIndex * grid.latStepDeg,
    east: (id.lonIndex + 1) * grid.lonStepDeg,
    north: (id.latIndex + 1) * grid.latStepDeg,
  };
}

export interface ChartPackageHeader extends PackageHeader {
  readonly boundingBox: readonly [west: number, south: number, east: number, north: number];
  readonly tileGrid: { readonly lonStepDeg: number; readonly latStepDeg: number };
  readonly tiles: readonly ChartTileId[];
  readonly layers: readonly ChartLayerMetadata[];
}

/** GeoJSON-kompatibel ring: `[lon, lat]`-par, siste punkt = første (lukket). */
export type Ring = readonly (readonly [number, number])[];

/** Polygon med ev. hull — første ring er ytre, resten er hull. */
export interface PackedPolygon {
  readonly rings: readonly Ring[];
}

/** §3.4 — ett bånd mellom to nabokurver (eller 0 og den grunneste kurven). */
export interface DepthBand {
  /** Nedre grense i meter — dybdekurve `c_i`, eller 0 for det grunneste båndet. */
  readonly lowerBoundM: number;
  /** Øvre grense i meter — dybdekurve `c_{i+1}`. */
  readonly upperBoundM: number;
  readonly polygons: readonly PackedPolygon[];
}

/**
 * §3.5 Datakvalitet — CATZOC-aktig klasse (bekreftet i fase 1-bygging:
 * Kartverkets "Datakvalitet"-WFS-lag har et maskinlesbart `catzoc`-attributt,
 * se docs/legal/kartverket-sjokart-dybdedata.md). A1/A2 = høy tillit,
 * B = moderat, C/D/U = lav.
 */
export type CatzocClass = "A1" | "A2" | "B" | "C" | "D" | "U";

export interface DataQualityZone {
  readonly catzoc: CatzocClass;
  readonly polygon: PackedPolygon;
}

/** §3.5 — farled/hovedled som tillitsløft (§3.4 steg 4), ingen egen trust selv. */
export interface FarledZone {
  readonly navn: string;
  readonly polygon: PackedPolygon;
}

export interface DryFallZone {
  readonly polygon: PackedPolygon;
}

/**
 * Skjær/grunne-punkt, allerede buffret til en polygon ved byggetid (§4 steg 4).
 *
 * **VALSOU-modellen (E4, beslutning 2026-08-31, se §3.4):** `dybdeM` bæres nå
 * gjennom fra kildedataens `app:dybde`-attributt for `kind: "grunne"` — den
 * avgjør ved OPPSLAGSTID (i `packages/charts`, ikke her ved byggetid) om
 * punktet faktisk blokkerer: no-go kun når `dybdeM < kravTilDybdeM` eller
 * `dybdeM` mangler, ellers ingen blokkering fra dette punktet alene. `Skjær`
 * har ALDRI dybdeattributt i kildedataene (bekreftet i fase 1-bølge 2,
 * 578 av 578 uten `app:dybde`) og forblir derfor alltid no-go uavhengig av
 * `dybdeM` — feltet er kun meningsfullt for `kind: "grunne"`.
 */
export interface BufferedHazardPoint {
  readonly kind: "skjaer" | "grunne";
  readonly bufferRadiusM: number;
  readonly polygon: PackedPolygon;
  /** Kun for `kind: "grunne"` — se VALSOU-merknaden over. `undefined` = ukjent dybde (no-go). */
  readonly dybdeM?: number;
  /**
   * Kildepunktets opprinnelige posisjon, FØR buffring til `polygon` (R1-fiks,
   * code-review 2026-08-31 — se §4.1 «Punkt+radius i stedet for ferdig-
   * bufrede polygoner»). Bevares gjennom flisklipping uendret (i motsetning
   * til `polygon`, som kan bli en avskåret sirkelbue ved flisgrensen).
   * Brukes av `segmentTest()`s eksakte avstand-fra-kord-til-punkt-test mot
   * `bufferRadiusM` — mer presist (ingen sirkel-tilnærmings-polygon å teste
   * mot) OG mer konservativt (en sirkel omslutter alltid minst like mye areal
   * som turfs innskrevne polygon-tilnærming) enn å teste korden mot
   * `polygon`. Valgfri kun for bakoverkompatibilitet med håndbygde
   * syntetiske testfiksturer fra før dette feltet fantes — ekte pakker bygget
   * av `tools/chart-pack` setter det alltid.
   */
  readonly centerLon?: number;
  readonly centerLat?: number;
}

/**
 * §3.5 Luftspenn — IKKE hentet fra ekte Kartverket-data i denne bølgen
 * (tjeneste-URL uverifisert, spec §8 pkt. 1). Typen og oppslagsregelen er
 * likevel implementert nå (§6.1-filosofi: syntetiske fasit-tester), slik at
 * `farbar()` allerede håndterer laget riktig den dagen kilden er avklart.
 * Beslutning (2026-08-30): uverifisert datum gir maks `usikkert` — laget
 * kan aldri bidra til `no-go` eller `trygt` alene, kun til `usikkert`.
 */
export interface AirDraftZone {
  readonly navn: string;
  readonly friHoydeM: number;
  readonly datum: Datum;
  readonly polygon: PackedPolygon;
}

/** §3.5 TSS/farled — lane-akse for krysningsvinkel (F1.5, Regel 10). */
export interface TssLane {
  readonly navn: string;
  readonly aksebæringGrader: number;
  readonly polygon: PackedPolygon;
}

/**
 * §3.5 Vernesone — sesongbasert (dag-måned, gjentas årlig). `gyldigFra`/
 * `gyldigTil` som "MM-DD". Håndterer ikke årsskifte-spennende sesonger i
 * denne bølgen (f.eks. "11-01"–"02-01") — se TODO.md.
 */
export interface ProtectedZone {
  readonly navn: string;
  readonly regel: "no-go" | "unnga";
  readonly gyldigFraMD: string;
  readonly gyldigTilMD: string;
  readonly polygon: PackedPolygon;
}

/**
 * Guardrail-sone (byggetids-QA-validator promotert til guardrail,
 * beslutning 2026-08-31 — se
 * `docs/research/beslutningsgrunnlag-r3-e1-2026-08-31.md` og
 * `docs/specs/farbarhetsmaske.md` §3.4). Et bånd-DELPOLYGON (ett enkelt
 * element i `DepthBand.polygons`, f.eks. én skjærgårds-/øyform) der minst én
 * dybdepunkt-sondering (`validateSoundingsAgainstBands` i
 * `tools/chart-pack`) er grunnere enn båndets nedre grense — bevist
 * upålitelig bånd-inndeling (503/3913 = 12,9 % i fase 1-bølge 2-fixturen,
 * trolig åpne-kurver-symptom). Delpolygonet kan ALDRI gi `trygt` ved oppslag
 * — maks `usikkert` — selv om det ellers ville fått tillitsløft fra
 * farled/god datakvalitet. Selve sonderingspunktet blokkeres i tillegg
 * strengere/presist som en egen VALSOU-punktfare i `bufferedHazards`
 * (`kind: "grunne"`, se `buildSoundingGuardrails` i `tools/chart-pack`) —
 * denne sonen dekker resten av delpolygonet som ingen punktfare når.
 */
export interface SoundingGuardrailZone {
  readonly polygon: PackedPolygon;
  /** Antall distinkte QA-brudd (sonderinger) som traff nøyaktig dette delpolygonet. */
  readonly violationCount: number;
  readonly bandLowerBoundM: number;
  readonly bandUpperBoundM: number;
}

/** Nyttelasten for én flis — alle lag klippet til flisens grense (§3.1). */
export interface ChartTilePayload {
  readonly id: ChartTileId;
  readonly bands: readonly DepthBand[];
  readonly dryFall: readonly DryFallZone[];
  readonly bufferedHazards: readonly BufferedHazardPoint[];
  readonly farled: readonly FarledZone[];
  readonly dataQuality: readonly DataQualityZone[];
  readonly airDraft: readonly AirDraftZone[];
  readonly tss: readonly TssLane[];
  readonly protectedZones: readonly ProtectedZone[];
  readonly soundingGuardrail: readonly SoundingGuardrailZone[];
}

export interface ChartPackage {
  readonly header: ChartPackageHeader;
  readonly tiles: readonly ChartTilePayload[];
}
