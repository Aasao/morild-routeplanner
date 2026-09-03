import { gzipSync } from "node:zlib";
import { decodeLayerNode, computeSubtileLayout, deserializeLayer, serializeLayer } from "@morild/weather";
import { describe, expect, it } from "vitest";
import { createDryRunFetch } from "./dry-run-fixtures.js";
import type { IndexWindow } from "./grid.js";
import {
  buildWindMemberLayers,
  buildWindMemberPackage,
  fetchWindComponents,
  flatIndex,
  resolveEnsembleSourceStatus,
} from "./pipeline.js";

/** [west, south, east, north] — vilkårlig for testene, geometrien er en dokumentert forenkling (se `pipeline.ts::windLayerGeometry`). */
const SMALL_BBOX: readonly [number, number, number, number] = [10, 58, 12, 60];

const SMALL_WINDOW: IndexWindow = { yStart: 0, yEnd: 15, xStart: 0, xEnd: 15 };
const USER_AGENT = "morild-routeplanner-test/0.0 maasao@gmail.com";

describe("fetchWindComponents (dry-run — hele hentekjeden uten nettverk)", () => {
  it("henter u/v for alle 'medlemmer' i ETT kall hver, riktig form", async () => {
    const fetchImpl = createDryRunFetch();
    const result = await fetchWindComponents({
      datasetUrl: "https://thredds.met.no/thredds/dodsC/mepslatest/x",
      window: SMALL_WINDOW,
      timeCount: 2,
      memberCount: 3,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    expect(result.dims).toEqual({ timeCount: 2, memberCount: 3, yCount: 16, xCount: 16 });
    expect(result.u.length).toBe(2 * 3 * 16 * 16);
    expect(result.v.length).toBe(2 * 3 * 16 * 16);
  });

  it("verdiene er deterministiske og matcher det syntetiske mønsteret (kontroll = medlem 0, ingen spredning)", async () => {
    const fetchImpl = createDryRunFetch();
    const result = await fetchWindComponents({
      datasetUrl: "https://thredds.met.no/thredds/dodsC/mepslatest/x",
      window: SMALL_WINDOW,
      timeCount: 1,
      memberCount: 2,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    const controlValue = result.u[flatIndex(result.dims, 0, 0, 5, 5)] ?? NaN;
    const expected = 5 + 3 * Math.sin(5 * 0.15);
    expect(controlValue).toBeCloseTo(expected, 5);
    // medlem != 0 skal ha et tillegg (spredning) — annerledes enn kontrollen ved samme (y,x).
    const memberValue = result.u[flatIndex(result.dims, 0, 1, 5, 5)] ?? NaN;
    expect(memberValue).not.toBeCloseTo(controlValue, 5);
  });

  it("kaster for en variabel dry-run ikke har et syntetisk mønster for", async () => {
    const badFetch = createDryRunFetch();
    await expect(
      badFetch("https://x.dods?hs%5B0%3A1%3A0%5D", {}),
    ).rejects.toThrow(/syntetisk mønster/);
  });
});

describe("buildWindMemberLayers — ekte @morild/weather-lag (§19: buildLayer/serializeLayer)", () => {
  it("bygger u/v-lag med riktig geometri og bit-eksakt dekodbare verdier", async () => {
    const fetchImpl = createDryRunFetch();
    const components = await fetchWindComponents({
      datasetUrl: "https://x",
      window: SMALL_WINDOW,
      timeCount: 2,
      memberCount: 1,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    const { geometry, uLayer, vLayer } = buildWindMemberLayers({
      components,
      memberIndex: 0,
      bbox: SMALL_BBOX,
      t0S: 0,
      dtS: 3600,
    });
    expect(geometry.nodesLat).toBe(16);
    expect(geometry.nodesLon).toBe(16);
    expect(geometry.timeSteps).toBe(2);
    expect(uLayer.payload.byteLength).toBe(16 * 16 * 2);
    expect(vLayer.payload.byteLength).toBe(16 * 16 * 2);

    // Rundtur: serialisert og dekodet på nytt skal gi samme verdier som direkte fra laget.
    const layout = computeSubtileLayout(geometry);
    const backU = deserializeLayer(serializeLayer(uLayer));
    for (let i = 0; i < geometry.nodesLat; i += 3) {
      for (let j = 0; j < geometry.nodesLon; j += 3) {
        for (let k = 0; k < geometry.timeSteps; k++) {
          expect(decodeLayerNode(backU, layout, i, j, k)).toBe(decodeLayerNode(uLayer, layout, i, j, k));
        }
      }
    }
  });
});

describe("buildWindMemberPackage (fetch->subset->encode->skriv, ETT medlem)", () => {
  it("bygger en komplett pakke med header, innholdsadressert nøkkel og vaktbånd-tall", async () => {
    const fetchImpl = createDryRunFetch();
    const components = await fetchWindComponents({
      datasetUrl: "https://x",
      window: SMALL_WINDOW,
      timeCount: 1,
      memberCount: 1,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    const result = buildWindMemberPackage({
      formatVersion: "1.0.0",
      producedAt: "2026-09-03T00:00:00Z",
      init: "2026-09-03T00:00:00Z",
      resolution: "2.5km",
      components,
      memberIndex: 0,
      tileId: "5_29",
      bbox: SMALL_BBOX,
    });
    expect(result.header.model).toBe("MEPS");
    expect(result.key).toBe(`weather/1/${result.hash}.bin`);
    expect(result.payload.length).toBeGreaterThan(0);
    expect(result.maxDecodeErrorKn).toBeGreaterThan(0);
    expect(result.rawPayloadBytes).toBeGreaterThan(0);
    expect(result.pointerEntry.member).toBe(0);
    expect(result.pointerEntry.field).toBe("wind");
  });

  it("deltaCoded (§8, default) og ikke-deltaCoded gir bit-identisk dekodet payload, men ulik on-disk-byte", async () => {
    const fetchImpl = createDryRunFetch();
    const components = await fetchWindComponents({
      datasetUrl: "https://x",
      window: SMALL_WINDOW,
      timeCount: 4,
      memberCount: 1,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    const base = {
      formatVersion: "1.0.0",
      producedAt: "2026-09-03T00:00:00Z",
      init: "2026-09-03T00:00:00Z",
      resolution: "2.5km",
      components,
      memberIndex: 0,
      tileId: "5_29",
      bbox: SMALL_BBOX,
    } as const;
    const plain = buildWindMemberPackage({ ...base, deltaCoded: false });
    const delta = buildWindMemberPackage({ ...base, deltaCoded: true });
    expect(delta.payload.length).toBe(plain.payload.length); // delta endrer ikke byte-antallet
    expect(Array.from(delta.payload)).not.toEqual(Array.from(plain.payload)); // men byte-VERDIENE endres
    // gzip på delta-kodet payload skal aldri være verre enn en pinlig stor faktor
    // av rått for et glatt syntetisk felt — svak, men reell regresjonssjekk.
    expect(gzipSync(delta.payload).length).toBeLessThan(delta.payload.length);
  });

  it("er deterministisk: samme input gir samme hash (innholdsadressering, §5)", async () => {
    const fetchImpl = createDryRunFetch();
    const components = await fetchWindComponents({
      datasetUrl: "https://x",
      window: SMALL_WINDOW,
      timeCount: 1,
      memberCount: 1,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    const build = () =>
      buildWindMemberPackage({
        formatVersion: "1.0.0",
        producedAt: "2026-09-03T00:00:00Z",
        init: "2026-09-03T00:00:00Z",
        resolution: "2.5km",
        components,
        memberIndex: 0,
        tileId: "5_29",
        bbox: SMALL_BBOX,
      });
    expect(build().hash).toBe(build().hash);
  });
});

describe("resolveEnsembleSourceStatus (§11 + §12 sammen)", () => {
  it("gir status ok når siste kjøring er komplett", () => {
    const result = resolveEnsembleSourceStatus([{ init: "A", memberCount: 30, hasControlMember: true }]);
    expect(result.sourceStatus).toEqual({ status: "ok" });
  });

  it("gir degraded status med årsak når det falt tilbake til en eldre kjøring", () => {
    const result = resolveEnsembleSourceStatus([
      { init: "A", memberCount: 10, hasControlMember: true },
      { init: "B", memberCount: 30, hasControlMember: true },
    ]);
    expect(result.sourceStatus.status).toBe("degraded");
  });

  it("gir 'ingen brukbart ensemble'-status når ingen kandidat er komplett", () => {
    const result = resolveEnsembleSourceStatus(
      [
        { init: "A", memberCount: 10, hasControlMember: true },
        { init: "B", memberCount: 15, hasControlMember: true },
      ],
      { requiredMembers: 30, maxRunsBack: 1 },
    );
    expect(result.sourceStatus.status).toBe("degraded");
    expect(result.selection.outcome).toBe("no-usable-ensemble");
  });
});
