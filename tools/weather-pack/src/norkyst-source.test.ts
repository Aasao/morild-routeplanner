/**
 * `norkyst-source.ts`: metadata-verifisering mot den EKTE `.das`/`.dds` fra
 * spiken (`tools/spikes/thredds/out-norkystv3-live.*`), sekvensiell henting,
 * og lokalisering over et buet domene der bbox-containment aliaserer
 * (`docs/specs/strom-produsent.md` §3 invariant 4, §5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeSingleVariableDods } from "./dap2.js";
import type { IndexWindow } from "./grid.js";
import { findBboxIndexWindow, strideIndices } from "./live-source.js";
import type { FetchLike } from "./opendap-client.js";
import {
  fetchCurrentRaw,
  locateCurrentTile,
  parseNorkystComponentAttributes,
  parseNorkystDims,
  parseReferenceTimeAscii,
  verifyNorkystComponentAttributes,
  type LatLonFetcher,
} from "./norkyst-source.js";
import type { LatLonSample } from "./current-geometry.js";

const SPIKE_DIR = join(import.meta.dirname, "..", "..", "spikes", "thredds");
const DAS = readFileSync(join(SPIKE_DIR, "out-norkystv3-live.das"), "utf8");
const DDS = readFileSync(join(SPIKE_DIR, "out-norkystv3-live.dds"), "utf8");

describe("metadata mot ekte NorKyst-.das/.dds (spike 2026-09-27)", () => {
  it("leser fill/skala/offset/enhet for u_eastward og v_northward", () => {
    for (const v of ["u_eastward", "v_northward"]) {
      expect(parseNorkystComponentAttributes(DAS, v)).toEqual({
        fillValue: -32767,
        scaleFactor: 0.001,
        addOffset: 0,
        units: "meter second-1",
      });
    }
  });

  it("verifiseringen er ren for ekte .das — og hard ved avvik", () => {
    expect(verifyNorkystComponentAttributes(DAS)).toEqual([]);
    const wrongScale = DAS.replace(/(v_northward \{[\s\S]*?scale_factor )0\.001/, "$10.01");
    expect(verifyNorkystComponentAttributes(wrongScale).join()).toMatch(/v_northward\.scale_factor/);
    const wrongFill = DAS.replace(/(u_eastward \{[\s\S]*?_FillValue )-32767/, "$1-32768");
    expect(verifyNorkystComponentAttributes(wrongFill).join()).toMatch(/u_eastward\._FillValue/);
  });

  it("dimensjoner fra DDS", () => {
    expect(parseNorkystDims(DDS)).toEqual({ yCount: 1148, xCount: 2747, timeCount: 23327 });
  });

  it("forecast_reference_time fra .ascii", () => {
    expect(parseReferenceTimeAscii("Dataset {\n    Float64 forecast_reference_time;\n} x;\n---\nforecast_reference_time, 1.7589312E9\n")).toBe(
      "2025-09-27T00:00:00Z",
    );
    expect(parseReferenceTimeAscii("ingen tall her")).toBeUndefined();
  });
});

describe("fetchCurrentRaw — overflatelag, rå Int16, sekvensielt (§16)", () => {
  it("to kall, u før v, aldri samtidige; depth-indeks 0; verdiene urørt rå", async () => {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const window: IndexWindow = { yStart: 10, yEnd: 11, xStart: 20, xEnd: 22 };
    const values = [1, -32767, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const fetchImpl: FetchLike = async (url) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(decodeURIComponent(url));
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const bytes = encodeSingleVariableDods("Dataset {} x;\n", values, "Int16");
      return { status: 200, ok: true, arrayBuffer: async () => bytes.slice().buffer };
    };
    const raw = await fetchCurrentRaw({ datasetUrl: "https://example.test/nk", fetchImpl, userAgent: "ua" }, window, 5, 6);
    expect(maxInFlight).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("u_eastward[5:1:6][0:1:0][10:1:11][20:1:22]");
    expect(calls[1]).toContain("v_northward[5:1:6][0:1:0][10:1:11][20:1:22]");
    expect(raw.timeCount).toBe(2);
    expect(raw.nodeCount).toBe(6);
    expect(Array.from(raw.uRaw)).toEqual(values); // fill forblir rå −32767 til current-geometry
  });
});

/**
 * Buet (hårnål-)domene: arm A går østover langs ~58,5°N (y 0–149), svinger
 * sørover (y 150–249) og arm B går vestover langs ~57,3°N (y 250–399).
 * Flisen 58–59°N/10–11°Ø treffer bare arm A — men arm B ligger innenfor den
 * 1,5°-margen en bbox-containment-probe bruker, så containment over en grov
 * prøve plukker opp begge armene og hele svingen (spikens aliasingfelle).
 */
function hairpinDomain(): { readonly yCount: number; readonly xCount: number; readonly lat: Float64Array; readonly lon: Float64Array } {
  const yCount = 400;
  const xCount = 20;
  const lat = new Float64Array(yCount * xCount);
  const lon = new Float64Array(yCount * xCount);
  const dLon = 0.8 / (111.32 * Math.cos((58 * Math.PI) / 180));
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const k = y * xCount + x;
      if (y < 150) {
        lat[k] = 58.5 + x * 0.0072;
        lon[k] = 9 + y * dLon;
      } else if (y < 250) {
        const theta = Math.PI / 2 - ((y - 150) / 100) * Math.PI;
        const r = 0.6 + x * 0.0072;
        lat[k] = 57.9 + r * Math.sin(theta);
        lon[k] = 9 + 150 * dLon + (r * Math.cos(theta)) / Math.cos((57.9 * Math.PI) / 180);
      } else {
        lat[k] = 57.3 - x * 0.0072;
        lon[k] = 9 + 150 * dLon - (y - 250) * dLon;
      }
    }
  }
  return { yCount, xCount, lat, lon };
}

function sampleFrom(domain: ReturnType<typeof hairpinDomain>, window: IndexWindow, stride: { y: number; x: number }): LatLonSample {
  const yIndices = strideIndices(window.yEnd - window.yStart, stride.y).map((i) => i + window.yStart);
  const xIndices = strideIndices(window.xEnd - window.xStart, stride.x).map((i) => i + window.xStart);
  const lat: number[] = [];
  const lon: number[] = [];
  for (const y of yIndices) {
    for (const x of xIndices) {
      lat.push(domain.lat[y * domain.xCount + x]!);
      lon.push(domain.lon[y * domain.xCount + x]!);
    }
  }
  return { yIndices, xIndices, lat, lon };
}

describe("lokalisering over buet domene (invariant 4)", () => {
  const domain = hairpinDomain();
  const dims = { yCount: domain.yCount, xCount: domain.xCount };
  const full: IndexWindow = { yStart: 0, yEnd: domain.yCount - 1, xStart: 0, xEnd: domain.xCount - 1 };
  const coarse = sampleFrom(domain, full, { y: 6, x: 5 });
  const tile = { west: 10, east: 11, south: 58, north: 59 };

  it("forutsetning: bbox-containment på grov prøve + margin aliaserer (spenner begge armene)", () => {
    const margin = 1.5;
    const aliased = findBboxIndexWindow(coarse.yIndices, coarse.xIndices, coarse.lon, coarse.lat, {
      west: tile.west - margin,
      east: tile.east + margin,
      south: tile.south - margin,
      north: tile.north + margin,
    });
    expect(aliased).toBeDefined();
    expect(aliased!.yEnd - aliased!.yStart).toBeGreaterThan(300);
  });

  it("nærmeste-punkt-søket finner riktig arm og et lite, sammenhengende vindu", async () => {
    const requested: IndexWindow[] = [];
    const fetchLatLon: LatLonFetcher = async (window, stride) => {
      requested.push(window);
      return sampleFrom(domain, window, stride);
    };
    const located = await locateCurrentTile({ tileBounds: tile, dims, coarse, fetchLatLon, fineHalfWindow: 60 });
    expect(located).toBeDefined();
    const w = located!.window;
    expect(w.yEnd).toBeLessThan(160); // arm A (+ de første nodene i svingen), aldri arm B
    expect(w.yEnd - w.yStart).toBeLessThan(110);
    for (const la of located!.lat) {
      expect(la).toBeGreaterThan(58.3); // ingen noder fra arm B (57,2–57,3°N)
    }
    expect(located!.lat.length).toBe((w.yEnd - w.yStart + 1) * (w.xEnd - w.xStart + 1));
    expect(requested).toHaveLength(1); // én lokal blokk, fulloppløst
  });

  it("feiler høyt når den lokale blokken er for liten, i stedet for å kutte vinduet", async () => {
    const fetchLatLon: LatLonFetcher = async (window, stride) => sampleFrom(domain, window, stride);
    await expect(locateCurrentTile({ tileBounds: tile, dims, coarse, fetchLatLon, fineHalfWindow: 10 })).rejects.toThrow(
      /for liten/,
    );
  });

  it("flis utenfor domenet ⇒ undefined (strøm merkes manglende), ikke et gjettet vindu", async () => {
    const fetchLatLon: LatLonFetcher = async (window, stride) => sampleFrom(domain, window, stride);
    const far = await locateCurrentTile({
      tileBounds: { west: 20, east: 21, south: 65, north: 66 },
      dims,
      coarse,
      fetchLatLon,
      fineHalfWindow: 60,
    });
    expect(far).toBeUndefined();
  });
});
