/**
 * Etikett-arena: struct-of-arrays i typede arrays (docs/specs/rutemotor.md
 * §4.5). Indeksen i arenaen *er* etikettens identitet; `parent` peker til
 * forelderindeksen, `-1` for start.
 *
 * Etiketter fjernes aldri fra arenaen — bare fra tilstandenes aktive lister.
 * Grunnen er at allerede ekspanderte barn av en fjernet etikett fortsatt er
 * gyldige ruter og fortsatt må ha en gyldig forelderpeker.
 *
 * Bufferne er ment å kunne overføres (transferable) ut av en worker uten
 * kopiering; derfor typede arrays og ikke objekter per node.
 */
import type { CostVector } from "./cost.js";

/** Felt som må fylles når en etikett legges inn. */
export interface LabelInit {
  readonly lat: number;
  readonly lon: number;
  readonly cost: CostVector;
  readonly headingDeg: number;
  readonly sector: number;
  readonly tack: number;
  readonly parent: number;
  readonly flags: number;
  readonly cellKey: number;
  readonly stateKey: number;
  /**
   * Gjenværende avstand til målet i nm (A\*-feltet når det finnes, ellers
   * storsirkel). Brukes **kun** som geometrisk uavgjort-bryter mellom
   * etiketter med identisk kostnadsvektor — se `LabelStore.insert`.
   */
  readonly remainingNm: number;
  /**
   * Klaring til nærmeste ikke-farbare areal i etikettens posisjon, i nm — en
   * gyldig **nedre skranke** (avkortet ved maskens `maxNm`, eventuelt
   * Lipschitz-korrigert fra et nabooppslag). `Infinity` når kystbufferen er
   * slått av eller masken mangler.
   *
   * Lagres fordi den er `d(A)` i R3-gaten (`clearance.ts`): korden fra
   * forelder til barn kan bare sertifiseres når begge endenes klaring er kjent.
   * Uten dette feltet måtte forelderens klaring slås opp på nytt for hver av
   * de 60 kursene per etikett.
   */
  readonly clearanceNm: number;
  readonly twsKn: number;
  readonly twdDeg: number;
  readonly bspKn: number;
  readonly hsM: number;
}

/** Logisk view av én rad. Materialiseres kun ved rekonstruksjon. */
export interface Label extends LabelInit {
  readonly index: number;
}

const INITIAL_CAPACITY = 4096;

export class LabelArena {
  private capacity: number;
  private size = 0;
  readonly maxLabels: number;

  lat: Float64Array;
  lon: Float64Array;
  tS: Int32Array;
  beatS: Int32Array;
  motorS: Int32Array;
  nightS: Int32Array;
  headingDeg: Float32Array;
  sector: Uint8Array;
  tack: Int8Array;
  parent: Int32Array;
  flags: Uint16Array;
  cellKey: Int32Array;
  stateKey: Int32Array;
  remainingNm: Float32Array;
  clearanceNm: Float32Array;
  twsKn: Float32Array;
  twdDeg: Float32Array;
  bspKn: Float32Array;
  hsM: Float32Array;

  constructor(maxLabels: number) {
    this.maxLabels = maxLabels;
    this.capacity = Math.min(INITIAL_CAPACITY, Math.max(1, maxLabels));
    const n = this.capacity;
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    this.tS = new Int32Array(n);
    this.beatS = new Int32Array(n);
    this.motorS = new Int32Array(n);
    this.nightS = new Int32Array(n);
    this.headingDeg = new Float32Array(n);
    this.sector = new Uint8Array(n);
    this.tack = new Int8Array(n);
    this.parent = new Int32Array(n);
    this.flags = new Uint16Array(n);
    this.cellKey = new Int32Array(n);
    this.stateKey = new Int32Array(n);
    this.remainingNm = new Float32Array(n);
    this.clearanceNm = new Float32Array(n);
    this.twsKn = new Float32Array(n);
    this.twdDeg = new Float32Array(n);
    this.bspKn = new Float32Array(n);
    this.hsM = new Float32Array(n);
  }

  get count(): number {
    return this.size;
  }

  /** Er arenaen full i forhold til det globale etikett-taket? */
  get isFull(): boolean {
    return this.size >= this.maxLabels;
  }

  private grow(): void {
    const next = Math.min(this.capacity * 2, this.maxLabels);
    if (next <= this.capacity) {
      throw new Error("Arena er full — kalleren skal sjekke isFull først");
    }
    this.capacity = next;
    this.lat = growF64(this.lat, next);
    this.lon = growF64(this.lon, next);
    this.tS = growI32(this.tS, next);
    this.beatS = growI32(this.beatS, next);
    this.motorS = growI32(this.motorS, next);
    this.nightS = growI32(this.nightS, next);
    this.headingDeg = growF32(this.headingDeg, next);
    this.sector = growU8(this.sector, next);
    this.tack = growI8(this.tack, next);
    this.parent = growI32(this.parent, next);
    this.flags = growU16(this.flags, next);
    this.cellKey = growI32(this.cellKey, next);
    this.stateKey = growI32(this.stateKey, next);
    this.remainingNm = growF32(this.remainingNm, next);
    this.clearanceNm = growF32(this.clearanceNm, next);
    this.twsKn = growF32(this.twsKn, next);
    this.twdDeg = growF32(this.twdDeg, next);
    this.bspKn = growF32(this.bspKn, next);
    this.hsM = growF32(this.hsM, next);
  }

  /** Legger inn en etikett og returnerer indeksen (etikettens identitet). */
  push(init: LabelInit): number {
    if (this.size >= this.capacity) this.grow();
    const i = this.size++;
    this.lat[i] = init.lat;
    this.lon[i] = init.lon;
    this.tS[i] = init.cost.tS;
    this.beatS[i] = init.cost.beatS;
    this.motorS[i] = init.cost.motorS;
    this.nightS[i] = init.cost.nightS;
    this.headingDeg[i] = init.headingDeg;
    this.sector[i] = init.sector;
    this.tack[i] = init.tack;
    this.parent[i] = init.parent;
    this.flags[i] = init.flags;
    this.cellKey[i] = init.cellKey;
    this.stateKey[i] = init.stateKey;
    this.remainingNm[i] = init.remainingNm;
    this.clearanceNm[i] = init.clearanceNm;
    this.twsKn[i] = init.twsKn;
    this.twdDeg[i] = init.twdDeg;
    this.bspKn[i] = init.bspKn;
    this.hsM[i] = init.hsM;
    return i;
  }

  costOf(i: number): CostVector {
    return {
      tS: this.tS[i]!,
      beatS: this.beatS[i]!,
      motorS: this.motorS[i]!,
      nightS: this.nightS[i]!,
    };
  }

  labelAt(i: number): Label {
    return {
      index: i,
      lat: this.lat[i]!,
      lon: this.lon[i]!,
      cost: this.costOf(i),
      headingDeg: this.headingDeg[i]!,
      sector: this.sector[i]!,
      tack: this.tack[i]!,
      parent: this.parent[i]!,
      flags: this.flags[i]!,
      cellKey: this.cellKey[i]!,
      stateKey: this.stateKey[i]!,
      remainingNm: this.remainingNm[i]!,
      clearanceNm: this.clearanceNm[i]!,
      twsKn: this.twsKn[i]!,
      twdDeg: this.twdDeg[i]!,
      bspKn: this.bspKn[i]!,
      hsM: this.hsM[i]!,
    };
  }

  /**
   * Byte-for-byte-bilde av arenaens fylte del. Brukes av determinisme-
   * egenskapstesten (§8.3) og av eventuell overføring ut av en worker.
   */
  bytes(): Uint8Array {
    const parts: ArrayBufferView[] = [
      this.lat.subarray(0, this.size),
      this.lon.subarray(0, this.size),
      this.tS.subarray(0, this.size),
      this.beatS.subarray(0, this.size),
      this.motorS.subarray(0, this.size),
      this.nightS.subarray(0, this.size),
      this.headingDeg.subarray(0, this.size),
      this.sector.subarray(0, this.size),
      this.tack.subarray(0, this.size),
      this.parent.subarray(0, this.size),
      this.flags.subarray(0, this.size),
      this.cellKey.subarray(0, this.size),
      this.stateKey.subarray(0, this.size),
      this.remainingNm.subarray(0, this.size),
      this.clearanceNm.subarray(0, this.size),
      this.twsKn.subarray(0, this.size),
      this.twdDeg.subarray(0, this.size),
      this.bspKn.subarray(0, this.size),
      this.hsM.subarray(0, this.size),
    ];
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(
        new Uint8Array(p.buffer, p.byteOffset, p.byteLength),
        offset,
      );
      offset += p.byteLength;
    }
    return out;
  }
}

function growF64(src: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  out.set(src);
  return out;
}
function growF32(src: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n);
  out.set(src);
  return out;
}
function growI32(src: Int32Array, n: number): Int32Array {
  const out = new Int32Array(n);
  out.set(src);
  return out;
}
function growU16(src: Uint16Array, n: number): Uint16Array {
  const out = new Uint16Array(n);
  out.set(src);
  return out;
}
function growU8(src: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  out.set(src);
  return out;
}
function growI8(src: Int8Array, n: number): Int8Array {
  const out = new Int8Array(n);
  out.set(src);
  return out;
}
