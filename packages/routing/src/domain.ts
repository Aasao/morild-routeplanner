/**
 * Tilstandsmodellen: kollisjonsfri cellenøkkel, kurssektor og den
 * sammensatte tilstandsnøkkelen `stateKey = cellKey * 9 + courseSector`
 * (docs/specs/rutemotor.md §4.4).
 *
 * v1 brukte `Math.round(la/cell)*100000 + Math.round(lo/cell)` som
 * cellenøkkel. Den er kollisjonsfri bare så lenge lengdegradindeksen holder
 * seg innenfor ±50 000 — en **uskreven forutsetning**. Ved negative
 * lengdegrader «låner» lengdegradleddet fra breddegradleddet, og bryter
 * forutsetningen kolliderer to ulike celler stille (feil rute, ingen feil-
 * melding). Målt konkret: ved `cellDeg = 0,001` gir (59,001°N, 60°V) og
 * (59,000°N, 40°Ø) samme nøkkel — se `domain.test.ts`.
 *
 * Ved v1s faste `cellDeg = 0,02` holder forutsetningen, så dette var en
 * latent og ikke en aktiv bug i v1. v2 gjør invarianten eksplisitt i stedet
 * for uskreven: vi indekserer inn i en oppgitt bboks med stride lik
 * nøyaktig antall kolonner, avviser alt utenfor bboksen framfor å lage en
 * nøkkel vi ikke kan bevise er unik, og sjekker i konstruktøren at hele
 * nøkkelrommet får plass i en Int32.
 */
import type { LatLon } from "@morild/geo";
import { norm360 } from "@morild/geo";

/** Reservert sektor for startetiketten, som ikke har noen forrige kurs. */
export const NO_COURSE = 8;

/** Antall kurssektorer. Låst til 8 i v2.0 (ADR-0004). */
export const COURSE_SECTORS = 8;

/**
 * Multiplikatoren i tilstandsnøkkelen er 9, ikke 8, nettopp for at
 * `NO_COURSE` skal være en egen tilstand og ikke kollidere med sektor 0.
 */
export const STATE_KEY_STRIDE = COURSE_SECTORS + 1;

/** Geografisk bboks søket lever innenfor. */
export interface Domain {
  readonly latMin: number;
  readonly latMax: number;
  readonly lonMin: number;
  readonly lonMax: number;
}

/** Skandinavia-bboksen fra spec §4.4. */
export const SCANDINAVIA: Domain = Object.freeze({
  latMin: 53,
  latMax: 72,
  lonMin: 2,
  lonMax: 32,
});

/**
 * Kurssektor: 8 sektorer à 45°, der sektor 0 dekker [337,5°, 22,5°).
 * `courseSector(headingDeg)` er total på alle endelige tall.
 */
export function courseSector(headingDeg: number): number {
  return Math.floor(norm360(headingDeg + 22.5) / 45) % COURSE_SECTORS;
}

/**
 * Cellegitteret. Instansieres per kjøring fra domenet og `cellDeg`, slik at
 * kollisjonsfriheten kan bevises (og testes uttømmende) for det konkrete
 * gitteret — også for domener med negative lengdegrader.
 */
export class CellGrid {
  readonly cellDeg: number;
  readonly domain: Domain;
  private readonly latMinIdx: number;
  private readonly lonMinIdx: number;
  /** Antall kolonner. Nøkkelen er iLat * lonStride + iLon. */
  readonly lonStride: number;
  readonly latRows: number;

  constructor(domain: Domain, cellDeg: number) {
    if (!(cellDeg > 0)) {
      throw new Error(`cellDeg må være positiv, fikk ${cellDeg}`);
    }
    if (domain.latMin >= domain.latMax || domain.lonMin >= domain.lonMax) {
      throw new Error("Ugyldig domene: min må være mindre enn maks");
    }
    this.cellDeg = cellDeg;
    this.domain = domain;
    this.latMinIdx = Math.round(domain.latMin / cellDeg);
    this.lonMinIdx = Math.round(domain.lonMin / cellDeg);
    this.latRows = Math.round(domain.latMax / cellDeg) - this.latMinIdx + 1;
    this.lonStride = Math.round(domain.lonMax / cellDeg) - this.lonMinIdx + 1;

    // Invariant: hele nøkkelrommet må få plass i en Int32 slik at både
    // arena-lagring og stateKey-aritmetikken er eksakt.
    const maxKey = this.latRows * this.lonStride * STATE_KEY_STRIDE;
    if (!Number.isSafeInteger(maxKey) || maxKey > 0x7fffffff) {
      throw new Error(
        `Tilstandsrommet (${maxKey}) er for stort for Int32 — velg grovere cellDeg eller mindre domene`,
      );
    }
  }

  /** Er punktet innenfor domenet? */
  contains(lat: number, lon: number): boolean {
    return (
      lat >= this.domain.latMin &&
      lat <= this.domain.latMax &&
      lon >= this.domain.lonMin &&
      lon <= this.domain.lonMax
    );
  }

  /**
   * Kollisjonsfri cellenøkkel, eller `undefined` utenfor domenet.
   * Vi lager aldri en nøkkel vi ikke kan bevise er unik.
   */
  keyOf(lat: number, lon: number): number | undefined {
    if (!this.contains(lat, lon)) return undefined;
    const iLat = Math.round(lat / this.cellDeg) - this.latMinIdx;
    const iLon = Math.round(lon / this.cellDeg) - this.lonMinIdx;
    // Math.round kan runde ytterkanten én celle ut av gitteret; klipp den
    // heller enn å returnere en nøkkel utenfor rommet.
    if (iLat < 0 || iLat >= this.latRows) return undefined;
    if (iLon < 0 || iLon >= this.lonStride) return undefined;
    return iLat * this.lonStride + iLon;
  }

  /** Senterpunktet i cellen med gitt nøkkel — invers av `keyOf`. */
  centerOf(cellKey: number): LatLon {
    const iLat = Math.floor(cellKey / this.lonStride);
    const iLon = cellKey - iLat * this.lonStride;
    return {
      lat: (iLat + this.latMinIdx) * this.cellDeg,
      lon: (iLon + this.lonMinIdx) * this.cellDeg,
    };
  }

  /** Antall celler i gitteret. */
  get cellCount(): number {
    return this.latRows * this.lonStride;
  }
}

/** `stateKey = cellKey * 9 + sector`, der sector ∈ [0, 8]. */
export function stateKeyOf(cellKey: number, sector: number): number {
  return cellKey * STATE_KEY_STRIDE + sector;
}

/** Cellenøkkelen en tilstandsnøkkel hører til. */
export function cellKeyOfState(stateKey: number): number {
  return Math.floor(stateKey / STATE_KEY_STRIDE);
}

/** Sektoren en tilstandsnøkkel hører til (0..7, eller NO_COURSE). */
export function sectorOfState(stateKey: number): number {
  return stateKey - cellKeyOfState(stateKey) * STATE_KEY_STRIDE;
}

/**
 * v1s cellenøkkel, bevart *kun* som testreferanse slik at
 * regresjonstesten kan vise kollisjonen konkret. Skal aldri brukes i søket.
 */
export function v1CellKeyForRegressionTest(
  lat: number,
  lon: number,
  cellDeg: number,
): number {
  return Math.round(lat / cellDeg) * 100000 + Math.round(lon / cellDeg);
}
