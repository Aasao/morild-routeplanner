/**
 * Fyllverdi-medlemmer i MEPS-vind (`docs/specs/vaerpakker.md` §19
 * 2026-09-29): plausibilitetsgrensen på sertifikatet, avvisning PER
 * vindmedlem (ikke hele flisen), og at nevneren «n av N» er ærlig — også for
 * medlemmer produsenten aldri skrev til pekeren (`missingFields` med `member`).
 */
import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import { buildLayer, serializeLayer, type LayerGeometry } from "@morild/weather";
import { DEFAULT_APP_CONFIG } from "./config.js";
import { prepareEnsembleInputs, screenTiles, windMemberCensus } from "./pipeline.js";
import type { PointerFieldEntry, PointerTileEntry, WeatherPointer } from "./pointer-types.js";
import { FakeCacheStorage } from "./test-support/fake-cache-storage.js";
import { acceptTileHeader, MAX_PLAUSIBLE_DECODE_ERROR_KN } from "./tile-certificate.js";

const BASE: PackageHeader = {
  formatVersion: "1.1.0",
  producedAt: "2026-09-29T01:00:00Z",
  model: "MEPS",
  init: "2026-09-29T00:00:00Z",
  resolution: "2.5km",
  sourceStatus: { status: "ok" },
};

const GOOD = { maxDecodeErrorKn: 0.09, maxDirectionErrorDeg: 0.6, clippedSamples: 0, referenceInit: BASE.init, verifiedAt: BASE.producedAt };
/** Slik funnet så ut: fyllverdi kvantisert som tall, formelt gyldig sertifikat. */
const FILL = { ...GOOD, maxDecodeErrorKn: 1.2e33 };

function header(cert: Record<string, unknown>): PackageHeader {
  return { ...BASE, certificate: cert } as PackageHeader;
}

function wind(member: number, cert: Record<string, unknown> = GOOD): PointerFieldEntry {
  return { field: "wind", member, key: `weather/1/wind-${member}.bin`, hash: `wind-${member}`, header: header(cert) };
}

function tile(tileId: string, fields: readonly PointerFieldEntry[], missingMembers: readonly number[] = []): PointerTileEntry {
  return {
    tileId,
    bbox: [7.8, 56.4, 12.8, 60.4],
    fields,
    missingFields: missingMembers.map((member) => ({
      field: "wind",
      member,
      sourceStatus: { status: "degraded", reason: `medlem ${member}: 100.0 % mangler (fyllverdi) — utelatt` },
    })),
  };
}

describe("plausibilitetsgrensen på sertifikatet", () => {
  it("er 1 kn og avviser et umulig sertifikat med synlig grunn", () => {
    expect(MAX_PLAUSIBLE_DECODE_ERROR_KN).toBe(1);
    const verdict = acceptTileHeader(header(FILL));
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted === false && verdict.reason).toMatch(/umulig sertifikat.*1\.20e\+33 kn > 1 kn/);
  });

  it("grensen er «større enn»: nøyaktig 1 kn godtas, rett over avvises", () => {
    expect(acceptTileHeader(header({ ...GOOD, maxDecodeErrorKn: 1 })).accepted).toBe(true);
    expect(acceptTileHeader(header({ ...GOOD, maxDecodeErrorKn: 1.0001 })).accepted).toBe(false);
  });
});

describe("screenTiles — avvisning per vindmedlem", () => {
  it("et umulig medlem tas ut av ALLE fliser, flisene beholdes, teksten sier «medlem N … utelatt»", () => {
    const { tiles, rejections, excludedWindMembers } = screenTiles([
      tile("a", [wind(0), wind(1), wind(2, FILL)]),
      tile("b", [wind(0), wind(1), wind(2)]),
    ]);
    expect(tiles.map((t) => t.tileId)).toEqual(["a", "b"]);
    for (const t of tiles) expect(t.fields.map((f) => f.member)).toEqual([0, 1]);
    expect(excludedWindMembers).toEqual([2]);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toMatchObject({ tileId: "a", field: "wind", member: 2 });
    expect(rejections[0]!.reason).toMatch(/^medlem 2 uten brukbare vinddata \(fyllverdi\/umulig sertifikat\) — utelatt/);
  });

  it("kontrollens avvisning fjerner flisen som før — og medlemsavvisninger i den flisen smitter ikke andre fliser", () => {
    const { tiles, rejections, excludedWindMembers } = screenTiles([
      tile("a", [wind(0, FILL), wind(1), wind(2, FILL)]),
      tile("b", [wind(0), wind(1), wind(2)]),
    ]);
    expect(tiles.map((t) => t.tileId)).toEqual(["b"]);
    expect(tiles[0]!.fields.map((f) => f.member)).toEqual([0, 1, 2]);
    expect(excludedWindMembers).toEqual([]);
    expect(rejections.map((r) => [r.tileId, r.member])).toEqual([
      ["a", 0],
      ["a", 2],
    ]);
    expect(rejections[0]!.reason).toMatch(/umulig sertifikat/);
  });
});

describe("windMemberCensus — «n av N»", () => {
  it("nevneren tar med medlemmer produsenten meldte utelatt og medlemmer klienten avviste", () => {
    const selected = [tile("a", [wind(0), wind(1), wind(2, FILL)], [3, 4])];
    const { tiles } = screenTiles(selected);
    expect(windMemberCensus(selected, tiles)).toEqual({ nominal: 5, withData: 2, missingMembers: [2, 3, 4] });
  });

  it("uten hull er n = N", () => {
    const selected = [tile("a", [wind(0), wind(1)])];
    expect(windMemberCensus(selected, screenTiles(selected).tiles)).toEqual({ nominal: 2, withData: 2, missingMembers: [] });
  });
});

function tinyWindBlob(): Uint8Array {
  const g: LayerGeometry = { latMin: 58, lonMin: 10, latStepDeg: 1, lonStepDeg: 1, nodesLat: 2, nodesLon: 2, tileNodes: 32, t0S: 1_790_000_000, dtS: 3600, timeSteps: 2 };
  const layer = (v: number) => serializeLayer(buildLayer({ geometryBase: g, bitsPerSample: 8, roundingMode: "nearest", channelKind: "linear", sample: () => v }));
  const u = layer(5);
  const v = layer(3);
  const out = new Uint8Array(u.length + v.length);
  out.set(u, 0);
  out.set(v, u.length);
  return out;
}

describe("prepareEnsembleInputs — nevneren blir synlig færre", () => {
  it("avvist og produsent-utelatt medlem kjøres ikke; stempelet bærer «n av N»", async () => {
    const t = tile("a", [wind(0), wind(1), wind(2, FILL)], [3]);
    const pointer: WeatherPointer = { formatVersion: "1.1.0", tiles: [t] };
    const fetched: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/pointer/")) {
        return new Response(JSON.stringify(pointer), { status: 200, headers: { "content-type": "application/json" } });
      }
      const key = decodeURIComponent(url.split("/blob/")[1] ?? "");
      fetched.push(key);
      return key.startsWith("weather/1/wind-") ? new Response(tinyWindBlob() as BodyInit, { status: 200 }) : new Response(null, { status: 404 });
    }) as typeof fetch;

    const inputs = await prepareEnsembleInputs({
      config: { ...DEFAULT_APP_CONFIG, apiBase: "http://localhost" },
      fetchImpl,
      cacheStorage: new FakeCacheStorage(),
      nowEpochS: 1_790_000_000,
    });
    expect(inputs).not.toBeNull();
    expect(inputs!.jobs.map((j) => j.memberIndex)).toEqual([0, 1]);
    expect(inputs!.context.expectedMembers).toBe(1);
    expect(inputs!.windMembers).toEqual({ nominal: 4, withData: 2, missingMembers: [2, 3] });
    expect(inputs!.context.stamp.windMembers).toEqual({ withData: 2, nominal: 4, missing: [2, 3] });
    // Det avviste medlemmet koster aldri båndbredde.
    expect(fetched).not.toContain("weather/1/wind-2.bin");
  });
});
