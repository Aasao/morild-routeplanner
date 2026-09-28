/**
 * NorKyst-strøm i klientens værflyt (`docs/specs/strom-produsent.md` §4b,
 * D15.2): screening av strøm/kystmaske (eget sertifikatkrav, aldri strøm
 * uten maske), og at den delte strømmen legges på ALLE medlemmenes fliser.
 */
import { describe, expect, it } from "vitest";
import type { PackageHeader } from "@morild/protocol";
import { buildLayer, serializeLayer, type LayerGeometry } from "@morild/weather";
import { DEFAULT_APP_CONFIG } from "./config.js";
import { prepareEnsembleInputs, screenTiles } from "./pipeline.js";
import type { PointerFieldEntry, PointerTileEntry, WeatherPointer } from "./pointer-types.js";
import { FakeCacheStorage } from "./test-support/fake-cache-storage.js";

const BASE: PackageHeader = {
  formatVersion: "1.1.0",
  producedAt: "2026-09-27T01:00:00Z",
  model: "MEPS",
  init: "2026-09-27T00:00:00Z",
  resolution: "2.5km",
  sourceStatus: { status: "ok" },
};

function withCert(certificate: Record<string, unknown>, model = "MEPS"): PackageHeader {
  return { ...BASE, model, certificate } as PackageHeader;
}

const WIND_CERT = { maxDecodeErrorKn: 0.09, maxDirectionErrorDeg: 0.6, clippedSamples: 0, referenceInit: BASE.init, verifiedAt: BASE.producedAt };
const CURRENT_CERT = { maxDecodeErrorKn: 0.02, clippedSamples: 0, referenceInit: BASE.init, verifiedAt: BASE.producedAt };
const MASK_CERT = { clippedSamples: 0, referenceInit: BASE.init, verifiedAt: BASE.producedAt };

function entry(field: string, member: number, header: PackageHeader): PointerFieldEntry {
  return { field, member, key: `weather/1/${field}-${member}.bin`, hash: `${field}-${member}`, header };
}

const wind0 = entry("wind", 0, withCert(WIND_CERT));
const wind1 = entry("wind", 1, withCert(WIND_CERT));
const current = entry("current", 0, withCert(CURRENT_CERT, "NorKyst-800"));
const coastal = entry("current-coastal", 0, withCert(MASK_CERT, "NorKyst-800"));

function tile(fields: readonly PointerFieldEntry[]): PointerTileEntry {
  return { tileId: "t0", bbox: [7.8, 56.4, 12.8, 60.4], fields };
}

describe("screenTiles — strøm og kystmaske", () => {
  it("gyldig strøm uten retningsskranke + kystmaske godtas sammen med vinden", () => {
    const { tiles, rejections } = screenTiles([tile([wind0, current, coastal])]);
    expect(rejections).toEqual([]);
    expect(tiles[0]!.fields.map((f) => f.field)).toEqual(["wind", "current", "current-coastal"]);
  });

  it("strøm uten kystmaske brukes IKKE (kystnære punkter ville stått umerket) — vinden beholdes", () => {
    const { tiles, rejections } = screenTiles([tile([wind0, current])]);
    expect(tiles[0]!.fields.map((f) => f.field)).toEqual(["wind"]);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.reason).toMatch(/kystmaske/);
  });

  it("klipping eller manglende maxDecodeErrorKn på strøm ⇒ strøm OG maske fjernes, synlig avvisning", () => {
    for (const bad of [
      entry("current", 0, withCert({ ...CURRENT_CERT, clippedSamples: 3 })),
      entry("current", 0, withCert({ clippedSamples: 0, referenceInit: BASE.init, verifiedAt: BASE.producedAt })),
      entry("current", 0, BASE),
    ]) {
      const { tiles, rejections } = screenTiles([tile([wind0, bad, coastal])]);
      expect(tiles[0]!.fields.map((f) => f.field)).toEqual(["wind"]);
      expect(rejections.length).toBeGreaterThan(0);
    }
  });

  it("maske uten clippedSamples (ugyldig sertifikat, §9.10) ⇒ strøm fjernes", () => {
    const badMask = entry("current-coastal", 0, withCert({ referenceInit: BASE.init, verifiedAt: BASE.producedAt }));
    const { tiles } = screenTiles([tile([wind0, current, badMask])]);
    expect(tiles[0]!.fields.map((f) => f.field)).toEqual(["wind"]);
  });

  it("flis uten strøm er uendret", () => {
    const t = tile([wind0]);
    const { tiles, rejections } = screenTiles([t]);
    expect(tiles[0]).toBe(t);
    expect(rejections).toEqual([]);
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

describe("prepareEnsembleInputs — delt strøm på alle medlemmer", () => {
  it("strøm og kystmaske lastes én gang og legges på kontroll og medlemmer", async () => {
    const pointer: WeatherPointer = { formatVersion: "1.1.0", tiles: [tile([wind0, wind1, current, coastal])] };
    const blobs = new Map<string, Uint8Array>([
      [wind0.key, tinyWindBlob()],
      [wind1.key, tinyWindBlob()],
      [current.key, new Uint8Array([1, 2, 3])],
      [coastal.key, new Uint8Array([4, 5])],
    ]);
    const fetched: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/pointer/")) {
        return new Response(JSON.stringify(pointer), { status: 200, headers: { "content-type": "application/json" } });
      }
      const key = decodeURIComponent(url.split("/blob/")[1] ?? "");
      fetched.push(key);
      const bytes = blobs.get(key);
      return bytes ? new Response(bytes as BodyInit, { status: 200 }) : new Response(null, { status: 404 });
    }) as typeof fetch;

    const inputs = await prepareEnsembleInputs({
      config: { ...DEFAULT_APP_CONFIG, apiBase: "http://localhost" },
      fetchImpl,
      cacheStorage: new FakeCacheStorage(),
      nowEpochS: 1_790_000_000,
    });
    expect(inputs).not.toBeNull();
    expect(inputs!.jobs).toHaveLength(2);
    for (const job of inputs!.jobs) {
      const t = job.tiles[0]!;
      expect(new Uint8Array(t.currentBuffer!)).toEqual(new Uint8Array([1, 2, 3]));
      expect(new Uint8Array(t.coastalBuffer!)).toEqual(new Uint8Array([4, 5]));
      expect(t.currentHeader?.model).toBe("NorKyst-800");
    }
    expect(fetched.filter((k) => k === current.key)).toHaveLength(1);
    expect(inputs!.blobHashes).toContain("current-0");
    expect(inputs!.blobHashes).toContain("current-coastal-0");
  });
});
