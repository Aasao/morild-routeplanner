import { describe, expect, it } from "vitest";
import {
  findBboxIndexWindow,
  initTimeFromRunName,
  parseEnsembleMemberCountFromDds,
  parseMepsLatestCatalogRunNames,
  strideIndices,
} from "./live-source.js";

describe("parseMepsLatestCatalogRunNames", () => {
  it("plukker ut kun ekte .nc-kjøringer (ikke .ncml), sortert nyest først", () => {
    const xml = `
      <dataset name="meps_lagged_6_h_latest_2_5km_20260902T18Z.ncml" />
      <dataset name="meps_lagged_6_h_latest_2_5km_20260902T18Z.nc" />
      <dataset name="meps_lagged_6_h_latest_2_5km_20260903T00Z.nc" />
      <dataset name="meps_lagged_6_h_latest_2_5km_20260902T12Z.nc" />
      <dataset name="meps_lagged_6_h_latest_2_5km_latest.nc" />
    `;
    const names = parseMepsLatestCatalogRunNames(xml);
    expect(names).toEqual([
      "meps_lagged_6_h_latest_2_5km_20260903T00Z.nc",
      "meps_lagged_6_h_latest_2_5km_20260902T18Z.nc",
      "meps_lagged_6_h_latest_2_5km_20260902T12Z.nc",
    ]);
  });

  it("returnerer tom liste for en katalog uten treff", () => {
    expect(parseMepsLatestCatalogRunNames("<catalog></catalog>")).toEqual([]);
  });
});

describe("initTimeFromRunName", () => {
  it("konverterer kjøringsnavn til ISO 8601", () => {
    expect(initTimeFromRunName("meps_lagged_6_h_latest_2_5km_20260903T00Z.nc")).toBe("2026-09-03T00:00:00Z");
  });

  it("kaster for et ukjent mønster", () => {
    expect(() => initTimeFromRunName("noe-annet.nc")).toThrow();
  });
});

describe("parseEnsembleMemberCountFromDds", () => {
  it("leser dimensjonslengden ut av en ekte-formet DDS-header", () => {
    const dds = `Dataset {\n    Int16 ensemble_member[ensemble_member = 30];\n}`;
    expect(parseEnsembleMemberCountFromDds(dds)).toBe(30);
  });

  it("kaster hvis dimensjonen ikke finnes", () => {
    expect(() => parseEnsembleMemberCountFromDds("Dataset {}")).toThrow();
  });
});

describe("strideIndices", () => {
  it("inkluderer 0 og siste indeks <= stop, aldri stop selv om det ikke faller på et stride-multiplum", () => {
    expect(strideIndices(10, 3)).toEqual([0, 3, 6, 9]);
    expect(strideIndices(9, 3)).toEqual([0, 3, 6, 9]);
  });
});

describe("findBboxIndexWindow", () => {
  it("finner riktig (y,x)-vindu for punkter innenfor bboxen, ignorerer punkter utenfor", () => {
    // 3x3 probet grid, yIndices=[0,5,10], xIndices=[0,5,10]
    const yIndices = [0, 5, 10];
    const xIndices = [0, 5, 10];
    // lon/lat radmajor (y,x): senterpunktet (5,5) har lon=10,lat=58 — inni bboxen; hjørnene er utenfor.
    const lon = [8, 9, 20, 9, 10, 20, 20, 20, 20];
    const lat = [56, 57, 70, 57, 58, 70, 70, 70, 70];
    const win = findBboxIndexWindow(yIndices, xIndices, lon, lat, { west: 8.5, east: 10.5, south: 56.5, north: 58.5 });
    expect(win).toEqual({ yStart: 0, yEnd: 5, xStart: 0, xEnd: 5 });
  });

  it("returnerer undefined hvis ingen probede punkter er innenfor bboxen", () => {
    const win = findBboxIndexWindow([0], [0], [100], [80], { west: 8, east: 12, south: 56, north: 60 });
    expect(win).toBeUndefined();
  });
});
