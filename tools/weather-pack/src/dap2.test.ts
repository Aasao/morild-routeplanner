import { describe, expect, it } from "vitest";
import {
  decodeDodsArray,
  encodeSingleVariableDods,
  extractDdsHeader,
  findDataSectionOffset,
  parseSingleVariableDods,
} from "./dap2.js";

/** Bygger en syntetisk .dods-buffer: DDS-tekst + "Data:\n" + XDR-array. */
function buildDodsBuffer(
  ddsText: string,
  values: readonly number[],
  writeElement: (view: DataView, offset: number, value: number) => void,
  elementBytes: number,
): Uint8Array {
  const header = new TextEncoder().encode(ddsText.endsWith("Data:\n") ? ddsText : ddsText + "Data:\n");
  const dataBytes = 8 + values.length * elementBytes;
  const buffer = new Uint8Array(header.length + dataBytes);
  buffer.set(header, 0);
  const view = new DataView(buffer.buffer);
  view.setUint32(header.length, values.length, false);
  view.setUint32(header.length + 4, values.length, false);
  values.forEach((v, i) => writeElement(view, header.length + 8 + i * elementBytes, v));
  return buffer;
}

describe("findDataSectionOffset / extractDdsHeader", () => {
  it("finner markøren og trekker ut headeren foran den", () => {
    const buffer = buildDodsBuffer(
      "Dataset {\n    Float32 x_wind_10m[x = 3];\n} x_wind_10m;\n",
      [1, 2, 3],
      (v, o, val) => v.setFloat32(o, val, false),
      4,
    );
    const header = extractDdsHeader(buffer);
    expect(header).toContain("Float32 x_wind_10m[x = 3]");
    const offset = findDataSectionOffset(buffer);
    expect(buffer.byteLength - offset).toBe(8 + 3 * 4);
  });

  it("kaster hvis Data:-markøren mangler", () => {
    expect(() => findDataSectionOffset(new TextEncoder().encode("ingen markør her"))).toThrow();
  });
});

describe("decodeDodsArray — Float32 (MEPS x_wind_10m/y_wind_10m)", () => {
  it("dekoder kjente flyttallsverdier, inkl. negative", () => {
    const values = [-1.25, 0, 3.5, 10.0];
    const buffer = buildDodsBuffer(
      "Dataset { Float32 x_wind_10m[x = 4]; } x_wind_10m;\nData:\n",
      values,
      (v, o, val) => v.setFloat32(o, val, false),
      4,
    );
    const offset = findDataSectionOffset(buffer);
    const result = decodeDodsArray(buffer, offset, "Float32");
    expect(result.length).toBe(4);
    expect(Array.from(result.values)).toEqual(values);
  });
});

describe("decodeDodsArray — Int16 (padded til 4 byte, spike-funn 7)", () => {
  it("dekoder Int16-verdier lagret i 4-byte XDR-ord, inkl. negative", () => {
    const values = [0, 1, -1, 32000, -32000];
    const buffer = buildDodsBuffer(
      "Dataset { Int16 ensemble_member[m = 5]; } ensemble_member;\nData:\n",
      values,
      (v, o, val) => v.setInt32(o, val, false), // XDR: 32-bit ord, verdien sign-extended
      4,
    );
    const offset = findDataSectionOffset(buffer);
    const result = decodeDodsArray(buffer, offset, "Int16");
    expect(Array.from(result.values)).toEqual(values);
  });

  it("måler samme 2,1x byte-inflasjon som spiken observerte for Int16-arrays", () => {
    // spike-funn 7: 103041 x 24 Int16-verdier, teoretisk pakket 2 byte/verdi,
    // men DAP2 XDR padder til 4 byte/verdi -> ~2,1x (8-byte header inkludert i målingen der).
    const n = 1000;
    const buffer = buildDodsBuffer(
      "Dataset { Int16 v[n = 1000]; } v;\nData:\n",
      Array.from({ length: n }, (_, i) => i),
      (v, o, val) => v.setInt32(o, val, false),
      4,
    );
    const dataOffset = findDataSectionOffset(buffer);
    const theoreticalPackedBytes = n * 2;
    const actualBytes = buffer.byteLength - dataOffset;
    expect(actualBytes / theoreticalPackedBytes).toBeCloseTo(2, 1);
  });
});

describe("decodeDodsArray — feiler pent på korrupt lengdefelt", () => {
  it("kaster hvis de to lengdefeltene ikke stemmer overens", () => {
    const header = new TextEncoder().encode("Dataset { Float32 v[n=1]; } v;\nData:\n");
    const buffer = new Uint8Array(header.length + 12);
    buffer.set(header, 0);
    const view = new DataView(buffer.buffer);
    view.setUint32(header.length, 1, false);
    view.setUint32(header.length + 4, 2, false); // bevisst uenig
    expect(() => decodeDodsArray(buffer, header.length, "Float32")).toThrow();
  });
});

describe("parseSingleVariableDods", () => {
  it("returnerer både DDS-tekst og dekodet array i ett kall", () => {
    const buffer = buildDodsBuffer(
      "Dataset { Float64 time[t = 2]; } time;\n",
      [1_700_000_000, 1_700_003_600],
      (v, o, val) => v.setFloat64(o, val, false),
      8,
    );
    const { dds, array } = parseSingleVariableDods(buffer, "Float64");
    expect(dds).toContain("time[t = 2]");
    expect(Array.from(array.values)).toEqual([1_700_000_000, 1_700_003_600]);
  });
});

describe("encodeSingleVariableDods (brukt av dry-run-fixtures.ts)", () => {
  it("round-tripper gjennom parseSingleVariableDods for Float32", () => {
    const values = [1.5, -2.25, 0, 100];
    const buffer = encodeSingleVariableDods("Dataset { Float32 x_wind_10m[x = 4]; } x_wind_10m;\n", values, "Float32");
    const { array } = parseSingleVariableDods(buffer, "Float32");
    expect(Array.from(array.values)).toEqual(values);
  });

  it("round-tripper Int16 (padding til 4 byte)", () => {
    const values = [30, 0, -30];
    const buffer = encodeSingleVariableDods("Dataset { Int16 ensemble_member[m = 3]; } ensemble_member;\n", values, "Int16");
    const { array } = parseSingleVariableDods(buffer, "Int16");
    expect(Array.from(array.values)).toEqual(values);
  });

  it("er en no-op å legge til Data:\\n to ganger — begge stiler gir samme resultat", () => {
    const a = encodeSingleVariableDods("Dataset {} v;\n", [1, 2], "Float32");
    const b = encodeSingleVariableDods("Dataset {} v;\nData:\n", [1, 2], "Float32");
    expect(a).toEqual(b);
  });
});
