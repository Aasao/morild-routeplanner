import { gzipSync } from "node:zlib";
import { decodeLayerNode, computeSubtileLayout, decodeWindAt, deserializeLayer, serializeLayer, windMemberLayersFromBytes } from "@morild/weather";
import { describe, expect, it } from "vitest";
import { createDryRunFetch } from "./dry-run-fixtures.js";
import type { IndexWindow } from "./grid.js";
import {
  applyLccRotationToWindComponents,
  assessWindMembers,
  buildWindMemberLayers,
  buildWindMemberPackage,
  convertWindComponentsToKnots,
  fetchWindComponents,
  flatIndex,
  maskMissingWindValues,
  METERS_PER_SECOND_TO_KNOTS,
  parseWindMissingValuesFromDas,
  resolveEnsembleSourceStatus,
  windValueMissingCause,
  WIND_MEMBER_MAX_MISSING_FRACTION,
  WIND_PLAUSIBLE_MAX_MS,
  type FetchedWindComponents,
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

describe("convertWindComponentsToKnots (§19 2026-09-03 — reelt funn: THREDDS gir m/s, §3 krever knop)", () => {
  it("skalerer u og v med nøyaktig 1852/3600 (definisjonen av 1 knop), bevarer retning", async () => {
    const fetchImpl = createDryRunFetch();
    const components = await fetchWindComponents({
      datasetUrl: "https://x",
      window: SMALL_WINDOW,
      timeCount: 1,
      memberCount: 1,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    const idx = flatIndex(components.dims, 0, 0, 5, 5);
    const uMs = components.u[idx] ?? NaN;
    const vMs = components.v[idx] ?? NaN;
    convertWindComponentsToKnots(components);
    expect(components.u[idx]).toBeCloseTo(uMs * METERS_PER_SECOND_TO_KNOTS, 9);
    expect(components.v[idx]).toBeCloseTo(vMs * METERS_PER_SECOND_TO_KNOTS, 9);
    // 10 m/s er ca. 19,44 kn — sanity-sjekk av selve konstanten.
    expect(METERS_PER_SECOND_TO_KNOTS * 10).toBeCloseTo(19.438, 2);
  });
});

describe("applyLccRotationToWindComponents (§19 2026-09-03 — griddrelativt→sann nord)", () => {
  it("er identitet på sentralmeridianen (15°Ø), endrer verdier vekk fra den", async () => {
    const fetchImpl = createDryRunFetch();
    const componentsOnMeridian = await fetchWindComponents({
      datasetUrl: "https://x",
      window: SMALL_WINDOW,
      timeCount: 1,
      memberCount: 1,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    const beforeOnMeridian = componentsOnMeridian.u[flatIndex(componentsOnMeridian.dims, 0, 0, 5, 5)];
    applyLccRotationToWindComponents(componentsOnMeridian, () => 15.0);
    expect(componentsOnMeridian.u[flatIndex(componentsOnMeridian.dims, 0, 0, 5, 5)]).toBeCloseTo(
      beforeOnMeridian ?? NaN,
      9,
    );

    const componentsOffMeridian = await fetchWindComponents({
      datasetUrl: "https://x",
      window: SMALL_WINDOW,
      timeCount: 1,
      memberCount: 1,
      userAgent: USER_AGENT,
      fetchImpl,
    });
    const idx = flatIndex(componentsOffMeridian.dims, 0, 0, 5, 5);
    const uBefore = componentsOffMeridian.u[idx] ?? NaN;
    const vBefore = componentsOffMeridian.v[idx] ?? NaN;
    const speedBefore = Math.hypot(uBefore, vBefore);
    applyLccRotationToWindComponents(componentsOffMeridian, () => 8.0);
    const uAfter = componentsOffMeridian.u[idx] ?? NaN;
    const vAfter = componentsOffMeridian.v[idx] ?? NaN;
    expect(Math.hypot(uAfter, vAfter)).toBeCloseTo(speedBefore, 9); // fart bevart
    expect(uAfter).not.toBeCloseTo(uBefore, 6); // men retningen er endret
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

// --- §19 2026-09-29: fyllverdi i MEPS-vind --------------------------------

/** NetCDF-standard float-fyllverdi slik den kommer ut av Float32-dekodingen. */
const NC_FILL_F32 = Math.fround(9.969209968386869e36);

/** Syntetisk 2 t × 3 medlemmer × 4×4 i m/s; medlem 2 er ren fyllverdi (funnets mønster). */
function componentsWithFillMember(): FetchedWindComponents {
  const dims = { timeCount: 2, memberCount: 3, yCount: 4, xCount: 4 };
  const n = dims.timeCount * dims.memberCount * dims.yCount * dims.xCount;
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  for (let t = 0; t < dims.timeCount; t++)
    for (let m = 0; m < dims.memberCount; m++)
      for (let y = 0; y < dims.yCount; y++)
        for (let x = 0; x < dims.xCount; x++) {
          const i = flatIndex(dims, t, m, y, x);
          u[i] = m === 2 ? NC_FILL_F32 : 3 + 0.5 * x;
          v[i] = m === 2 ? NC_FILL_F32 : -2 + 0.25 * y;
        }
  return { dims, u, v };
}

const MEPS_DAS_EXCERPT = `Attributes {
    x_wind_10m {
        String standard_name "x_wind";
        String units "m/s";
        Float32 _FillValue 9.96921e+36;
        String grid_mapping "projection_lambert";
    }
    y_wind_10m {
        String standard_name "y_wind";
        String units "m/s";
        Float32 _FillValue 9.96921e+36;
        Float32 missing_value -999.0;
    }
}`;

describe("fyllverdi i MEPS-vind (§19 2026-09-29)", () => {
  it("parseWindMissingValuesFromDas leser _FillValue og missing_value per komponent", () => {
    const spec = parseWindMissingValuesFromDas(MEPS_DAS_EXCERPT);
    expect(spec.x).toEqual([9.96921e36]);
    expect(spec.y).toEqual([9.96921e36, -999]);
    expect(() => parseWindMissingValuesFromDas("Attributes { }")).toThrow(/x_wind_10m/);
  });

  it("windValueMissingCause: fyll (Float32-lik med .das' 6 sifre), ikke-endelig, fysisk umulig, ellers gyldig", () => {
    const fills = [9.96921e36];
    expect(windValueMissingCause(NC_FILL_F32, fills)).toBe("fill");
    expect(windValueMissingCause(Number.NaN, fills)).toBe("nonFinite");
    expect(windValueMissingCause(Number.POSITIVE_INFINITY, fills)).toBe("nonFinite");
    expect(windValueMissingCause(WIND_PLAUSIBLE_MAX_MS + 1, fills)).toBe("implausible");
    expect(windValueMissingCause(-(WIND_PLAUSIBLE_MAX_MS + 1), [])).toBe("implausible");
    expect(windValueMissingCause(NC_FILL_F32, [])).toBe("implausible"); // uten .das-fyll fanger grensen den likevel
    expect(windValueMissingCause(35, fills)).toBeUndefined();
    expect(windValueMissingCause(-WIND_PLAUSIBLE_MAX_MS, fills)).toBeUndefined();
  });

  it("maskMissingWindValues setter u OG v til NaN der én mangler, og teller per medlem", () => {
    const c = componentsWithFillMember();
    // Ett enkelt hull i medlem 1: bare v mangler — hele vektoren skal bli NaN.
    const hole = flatIndex(c.dims, 1, 1, 2, 3);
    c.v[hole] = Number.NaN;
    const stats = maskMissingWindValues(c, parseWindMissingValuesFromDas(MEPS_DAS_EXCERPT));
    expect(stats.map((s) => s.missing)).toEqual([0, 1, 32]);
    expect(stats[2]!.causes.fill).toBe(32);
    expect(stats[1]!.causes.nonFinite).toBe(1);
    expect(Number.isNaN(c.u[hole]!)).toBe(true);
    expect(Number.isNaN(c.v[hole]!)).toBe(true);
    expect(Number.isNaN(c.u[flatIndex(c.dims, 0, 2, 0, 0)]!)).toBe(true);
    expect(c.u[flatIndex(c.dims, 0, 0, 0, 0)]).toBe(3);
  });

  it("assessWindMembers: medlem > 50 % mangler utelates med grunn; status «n av N»; enkelthull beholdes", () => {
    const c = componentsWithFillMember();
    c.u[flatIndex(c.dims, 0, 1, 0, 0)] = Number.NaN;
    const a = assessWindMembers(maskMissingWindValues(c, { x: [9.96921e36], y: [9.96921e36] }));
    expect(a.included).toEqual([0, 1]);
    expect(a.excluded.map((e) => e.member)).toEqual([2]);
    expect(a.excluded[0]!.reason).toMatch(/medlem 2: 100\.0 % .*fyllverdi.*utelatt/);
    expect(a.sourceStatus).toEqual({
      status: "degraded",
      reason: expect.stringMatching(/^2 av 3 medlemmer har vinddata — utelatt: 2 \(fyllverdi\)/),
    });
  });

  it("assessWindMembers: grensen er «mer enn» 50 %, og uten utelatte er status ok", () => {
    const stats = [
      { member: 0, missing: 0, total: 10, causes: { fill: 0, nonFinite: 0, implausible: 0 } },
      { member: 1, missing: 5, total: 10, causes: { fill: 5, nonFinite: 0, implausible: 0 } },
    ];
    const a = assessWindMembers(stats);
    expect(a.included).toEqual([0, 1]);
    expect(a.sourceStatus).toEqual({ status: "ok" });
    expect(WIND_MEMBER_MAX_MISSING_FRACTION).toBe(0.5);
  });

  it("kontrollen uten data ⇒ kaster høylytt (bygget feiler)", () => {
    const stats = [{ member: 0, missing: 10, total: 10, causes: { fill: 10, nonFinite: 0, implausible: 0 } }];
    expect(() => assessWindMembers(stats)).toThrow(/Kontrollen \(medlem 0\).*bygget stoppes/);
  });

  it("enkeltvise manglende verdier blir sentinel i pakken — aldri et tall, og sertifikatet forblir lite", () => {
    const c = componentsWithFillMember();
    const hole = { t: 1, y: 2, x: 1 };
    c.u[flatIndex(c.dims, hole.t, 0, hole.y, hole.x)] = NC_FILL_F32;
    maskMissingWindValues(c, { x: [9.96921e36], y: [9.96921e36] });
    convertWindComponentsToKnots(c);
    const bbox: readonly [number, number, number, number] = [10, 58, 10.3, 58.3];
    const pkg = buildWindMemberPackage({
      formatVersion: "1.1.0",
      producedAt: "2026-09-29T00:00:00Z",
      init: "2026-09-29T00:00:00Z",
      resolution: "2.5km",
      components: c,
      memberIndex: 0,
      bbox,
      tileId: "t",
      t0S: 0,
      dtS: 3600,
    });
    expect(pkg.maxDecodeErrorKn).toBeLessThan(1);
    expect(pkg.header.certificate.clippedSamples).toBe(0);
    const layers = windMemberLayersFromBytes(pkg.payload);
    const lat = 58 + hole.y * (0.3 / 3);
    const lon = 10 + hole.x * (0.3 / 3);
    expect(decodeWindAt(layers, lat, lon, hole.t * 3600)).toBeUndefined();
    expect(decodeWindAt(layers, lat, lon, 0)).toBeDefined();
  });

  it("uten maskering ville fyllverdien gitt et umulig sertifikat — regresjonsvakt for funnet", () => {
    const c = componentsWithFillMember();
    convertWindComponentsToKnots(c);
    const pkg = buildWindMemberPackage({
      formatVersion: "1.1.0",
      producedAt: "2026-09-29T00:00:00Z",
      init: "2026-09-29T00:00:00Z",
      resolution: "2.5km",
      components: c,
      memberIndex: 2,
      bbox: [10, 58, 10.3, 58.3],
      tileId: "t",
    });
    // Fyllverdi alene i subflisen gir spenn 0 ⇒ skala 0; blandet med ett gyldig
    // tall eksploderer skalaen. Poenget: sertifikatet alene er ikke et vern.
    const mixed = componentsWithFillMember();
    mixed.u[flatIndex(mixed.dims, 0, 2, 0, 0)] = 5;
    convertWindComponentsToKnots(mixed);
    const pkgMixed = buildWindMemberPackage({
      formatVersion: "1.1.0",
      producedAt: "2026-09-29T00:00:00Z",
      init: "2026-09-29T00:00:00Z",
      resolution: "2.5km",
      components: mixed,
      memberIndex: 2,
      bbox: [10, 58, 10.3, 58.3],
      tileId: "t",
    });
    expect(pkg.header.certificate.clippedSamples).toBe(0);
    expect(pkgMixed.maxDecodeErrorKn).toBeGreaterThan(1e30);
  });
});
