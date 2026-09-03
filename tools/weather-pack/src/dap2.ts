/**
 * Minimal DAP2-binærdekoder (`.dods`-responser) — dependency-fri, jf.
 * `docs/research/spike-thredds.md` funn 9: spiken målte kun byte-volum, en
 * faktisk verdidekoder var "flagget som gjenstående arbeid for weather-pack".
 *
 * Dekker akkurat det formatet OPeNDAP index-range-oppslag mot
 * MEPS/NorKyst faktisk returnerer for ETT variabeloppslag om gangen (samme
 * mønster som `tools/spikes/thredds/03-meps-member-subset.mjs` brukte):
 * en tekst-DDS-header, deretter literalen `Data:\n`, deretter XDR-kodet
 * binærdata for nøyaktig én array.
 *
 * IKKE en generell DAP2-parser (ingen støtte for Grid-strukturer med flere
 * variabler i én respons, Sequence, String/URL-typer) — utvides ved behov,
 * ikke bygget for generalitet vi ikke trenger ennå.
 */

export type Dap2NumericType = "Float32" | "Float64" | "Int16" | "Int32" | "UInt16" | "UInt32" | "Byte";

/** Byte-bredden EN XDR-verdi opptar på "the wire" — spike-funn 7: Int16 padder til 4 byte. */
function xdrElementBytes(type: Dap2NumericType): number {
  switch (type) {
    case "Float64":
      return 8;
    case "Byte":
      // DAP2 Byte-arrays pakkes UTEN padding til 4-byte-ord (XDR opaque-regelen);
      // vi trenger ikke dem i praksis (§9.6s sentinel lever i vårt EGET
      // byteformat, ikke i kildedataenes), men tar den med for kompletthet.
      return 1;
    default:
      return 4;
  }
}

const DATA_MARKER = "Data:\n";
const DATA_MARKER_BYTES = new TextEncoder().encode(DATA_MARKER);

/** Finner byte-offset der binærdataseksjonen starter (rett etter `Data:\n`). Kaster hvis ikke funnet. */
export function findDataSectionOffset(buffer: Uint8Array): number {
  outer: for (let i = 0; i <= buffer.length - DATA_MARKER_BYTES.length; i++) {
    for (let j = 0; j < DATA_MARKER_BYTES.length; j++) {
      if (buffer[i + j] !== DATA_MARKER_BYTES[j]) continue outer;
    }
    return i + DATA_MARKER_BYTES.length;
  }
  throw new Error("Fant ikke 'Data:\\n'-markøren i .dods-responsen");
}

/** DDS-headerteksten (ASCII/UTF-8) FØR `Data:\n`-markøren. */
export function extractDdsHeader(buffer: Uint8Array): string {
  const offset = findDataSectionOffset(buffer);
  return new TextDecoder("utf-8").decode(buffer.subarray(0, offset - DATA_MARKER_BYTES.length));
}

export interface DecodedDodsArray {
  readonly length: number;
  readonly values: Float64Array;
  /** Byte-offset RETT ETTER denne arrayens data — for evt. påfølgende arrays i samme respons. */
  readonly nextOffset: number;
}

/**
 * Dekoder én XDR-kodet DAP2-array fra `Data:`-seksjonen, gitt starten på
 * seksjonen (`dataOffset`, som regel `findDataSectionOffset(buffer)` for
 * responser med kun én variabel).
 *
 * DAP2-arraykoding: 4-byte lengde, 4-byte lengde igjen (redundant felt i
 * protokollen), deretter `length` verdier i big-endian XDR, hver
 * `xdrElementBytes(type)` byte (§ finn.9 — Int16 padder til 4 byte).
 */
export function decodeDodsArray(
  buffer: Uint8Array,
  dataOffset: number,
  type: Dap2NumericType,
): DecodedDodsArray {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = view.getUint32(dataOffset, false);
  const lengthRepeated = view.getUint32(dataOffset + 4, false);
  if (length !== lengthRepeated) {
    throw new Error(
      `DAP2-arraylengde-feltene stemmer ikke overens (${length} vs. ${lengthRepeated}) — korrupt eller ikke-array-respons`,
    );
  }
  const elementBytes = xdrElementBytes(type);
  const dataStart = dataOffset + 8;
  const values = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const off = dataStart + i * elementBytes;
    switch (type) {
      case "Float64":
        values[i] = view.getFloat64(off, false);
        break;
      case "Float32":
        values[i] = view.getFloat32(off, false);
        break;
      case "Int32":
        values[i] = view.getInt32(off, false);
        break;
      case "UInt32":
        values[i] = view.getUint32(off, false);
        break;
      case "Int16":
        // Padded til 4-byte XDR-ord; verdien er hele det (sign-extended) 32-bits ordet.
        values[i] = view.getInt32(off, false);
        break;
      case "UInt16":
        values[i] = view.getUint32(off, false);
        break;
      case "Byte":
        values[i] = view.getUint8(off);
        break;
    }
  }
  return { length, values, nextOffset: dataStart + length * elementBytes };
}

/** Bekvemmelighetsfunksjon: parser en full `.dods`-buffer for ETT-variabel-responser. */
export function parseSingleVariableDods(
  buffer: Uint8Array,
  type: Dap2NumericType,
): { readonly dds: string; readonly array: DecodedDodsArray } {
  const dataOffset = findDataSectionOffset(buffer);
  return { dds: extractDdsHeader(buffer), array: decodeDodsArray(buffer, dataOffset, type) };
}

function xdrWrite(view: DataView, offset: number, value: number, type: Dap2NumericType): void {
  switch (type) {
    case "Float64":
      view.setFloat64(offset, value, false);
      break;
    case "Float32":
      view.setFloat32(offset, value, false);
      break;
    case "Int32":
    case "Int16": // padded til 4-byte XDR-ord, sign-extended (spike-funn 7)
      view.setInt32(offset, value, false);
      break;
    case "UInt32":
    case "UInt16":
      view.setUint32(offset, value, false);
      break;
    case "Byte":
      view.setUint8(offset, value);
      break;
  }
}

/**
 * Bygger en syntetisk `.dods`-buffer for ETT-variabel-responser — brukt av
 * `dap2.test.ts` og av `dry-run-fixtures.ts` (dry-run-modus, §16: ingen
 * ekte MET-kall før legal-gaten åpner). IKKE brukt på ekte data noe sted.
 */
export function encodeSingleVariableDods(
  ddsText: string,
  values: readonly number[],
  type: Dap2NumericType,
): Uint8Array {
  const header = new TextEncoder().encode(ddsText.endsWith(DATA_MARKER) ? ddsText : ddsText + DATA_MARKER);
  const elementBytes = xdrElementBytes(type);
  const buffer = new Uint8Array(header.length + 8 + values.length * elementBytes);
  buffer.set(header, 0);
  const view = new DataView(buffer.buffer);
  view.setUint32(header.length, values.length, false);
  view.setUint32(header.length + 4, values.length, false);
  values.forEach((v, i) => xdrWrite(view, header.length + 8 + i * elementBytes, v, type));
  return buffer;
}
