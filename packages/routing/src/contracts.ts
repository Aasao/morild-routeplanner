/**
 * Inn-kontraktene rutemotoren konsumerer: farbarhetsmaske, værfelt og
 * båtmodell. Alle tre er **rene og synkrone** — motoren gjør ingen I/O og
 * venter aldri (docs/specs/rutemotor.md §4.1–§4.3, §5.1).
 *
 * Grensesnittene bor her, i rutemotoren, og ikke i `packages/charts` eller
 * `packages/weather`. Det er bevisst: dette er motorens *behov*, uttrykt slik
 * at kart- og værpakkene senere adapteres til det. Motoren skal aldri
 * importere de pakkene (arkitekturgrensen i tools/arch-tests håndhever det).
 *
 * Når `docs/specs/farbarhetsmaske.md` lander med autoritative navn, er det
 * en tynn adapter som skal skrives — ikke en endring i motoren.
 */
import type { LatLon } from "@morild/geo";
import type { PackageHeader } from "@morild/protocol";

/** Tillitsnivå per posisjon/segment (F1.3). */
export type Tillit = "trygt" | "usikkert" | "no-go";

export interface SegmentVerdict {
  /** Hard: `false` ⇒ kandidaten forkastes, uansett hvor god den ellers er. */
  readonly passable: boolean;
  /** "usikkert" er tillatt, men flagges hele veien ut til resultatet. */
  readonly tillit: Tillit;
  /** F.eks. "under sikkerhetskontur", "bru 12 m". */
  readonly reason?: string;
}

export type TssVerdict =
  | { readonly kind: "none" }
  /** `angleDeg` = vinkelen mot ledaksen, [0, 90]. 90 = rett på tvers. */
  | { readonly kind: "crossing"; readonly angleDeg: number }
  | { readonly kind: "along"; readonly withDirection: boolean };

/** Datum/kilde per region — bæres videre til resultatets tillitsfelt (F1.7). */
export interface ChartSourceRef {
  readonly name: string;
  readonly datum: string;
}

/**
 * Alt motoren trenger fra kartsiden.
 *
 * Invarianter motoren stoler på (og som maskeimplementasjonen må holde):
 *  1. Renhet — samme argumenter gir samme svar, alltid.
 *  2. Konservativ — aldri `passable: true` for areal uten data.
 *  3. Symmetri — `segmentVerdict(a,b).passable === segmentVerdict(b,a).passable`.
 *     TSS-vurderingen er bevisst *ikke* symmetrisk; det er hele poenget.
 */
export interface NavigabilityMask {
  /** Punkt-test. Kjøres før den dyrere segmenttesten. */
  pointVerdict(lat: number, lon: number): SegmentVerdict;

  /** Kan båten gå i rett linje fra a til b? Motorens dyreste sjekk. */
  segmentVerdict(
    aLat: number,
    aLon: number,
    bLat: number,
    bLon: number,
  ): SegmentVerdict;

  /**
   * Avstand til nærmeste ikke-farbare areal i nm, avkortet ved `maxNm`
   * (returnerer `maxNm` når hindringen er lenger unna enn det).
   */
  clearanceNm(lat: number, lon: number, maxNm: number): number;

  /** TSS/skipsled-geometri (F1.5) — regelen står i `tss.ts`. */
  tssVerdict(
    aLat: number,
    aLon: number,
    bLat: number,
    bLon: number,
  ): TssVerdict;

  /** Dekningsgrad for området ruten berører (N2). */
  readonly coverage: "full" | "partial" | "none";
  readonly sources: readonly ChartSourceRef[];
}

export interface WindSample {
  readonly speedKn: number;
  /** FRA-retning: vinden kommer fra denne retningen. */
  readonly fromDeg: number;
}

export interface WaveSample {
  readonly hsM: number;
  readonly tpS?: number;
  /** FRA-retning (MET-konvensjon). */
  readonly fromDeg?: number;
}

export interface CurrentSample {
  /** MOT-retning, komponent mot øst, knop. */
  readonly u: number;
  /** MOT-retning, komponent mot nord, knop. */
  readonly v: number;
}

/**
 * Ett ensemble-medlem = ett `WeatherField`. Motoren vet ikke at det finnes
 * andre medlemmer; robusthetslaget (fase 4) kjører den mange ganger.
 */
export interface WeatherField {
  /** `undefined` = utenfor dekning i rom eller tid. Vi ekstrapolerer aldri. */
  wind(lat: number, lon: number, epochS: number): WindSample | undefined;
  waves(lat: number, lon: number, epochS: number): WaveSample | undefined;
  current(lat: number, lon: number, epochS: number): CurrentSample | undefined;

  /** Konservative maksverdier over hele feltet — grunnlag for Vmax/Tub. */
  readonly maxTwsKn: number;
  readonly maxCurrentKn: number;

  readonly validFromS: number;
  readonly validToS: number;

  readonly header: PackageHeader;
}

/** Båtmodellen motoren konsumerer (F3.2). Implementeres av `packages/polar`. */
export interface BoatModel {
  /** STW i knop, allerede skalert med cruising-faktor og seilvalg. */
  boatSpeedKn(twsKn: number, twaDeg: number): number;

  /** Deratingfaktor [0,1] fra bølgebratthet og relativ sjøretning. */
  waveFactor(hsM: number, tpS: number | undefined, relDirDeg: number): number;

  /** Harde ytelsesgrenser — brudd forkaster noden, det straffes ikke. */
  readonly maxTwsKn: number;
  readonly maxHsM: number;

  /** Motorseiling (B7). Under `motorThresholdKn` STW kobles motoren inn. */
  readonly motorThresholdKn: number;
  readonly motorSpeedKn: number;
  readonly motorFuelLPerH: number;
}

/**
 * Kantsjekk for A\*-vannavstandsfeltet (§5.5). Egen, minimal kontrakt slik at
 * feltet kan bygges og testes uten en full farbarhetsmaske — og slik at
 * feltets oppløsning kan være grovere enn maskens.
 */
export interface FieldEdgeGate {
  /** Kan feltet forplante seg langs kanten a→b? */
  edgeOpen(aLat: number, aLon: number, bLat: number, bLon: number): boolean;
}

/** Adapter fra farbarhetsmaske til feltets kantsjekk. */
export function maskAsEdgeGate(mask: NavigabilityMask): FieldEdgeGate {
  return {
    edgeOpen(aLat, aLon, bLat, bLon) {
      return mask.segmentVerdict(aLat, aLon, bLat, bLon).passable;
    },
  };
}

/** Kantsjekk som aldri stenger noe — brukes når masken mangler (§6). */
export const OPEN_EDGE_GATE: FieldEdgeGate = {
  edgeOpen(): boolean {
    return true;
  },
};

export type { LatLon };
