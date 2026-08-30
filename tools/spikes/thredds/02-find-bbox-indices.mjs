// Find the (y,x) index window in a MEPS Lambert-conformal grid that covers
// a given lat/lon bounding box, using OPeNDAP index-range requests only
// (NCSS is unavailable — see out-01-catalog-check.md / spike report).
//
// Strategy: coarse strided probe of the full lon/lat grids, then a finer
// probe restricted to the neighbourhood of the bbox to tighten the window.
// This is a reusable building block for weather-pack (grid index lookup is
// a one-time-per-domain computation, cacheable).
//
// Usage: node 02-find-bbox-indices.mjs
import { timedFetch, fmtMs, fmtBytes } from "./lib.mjs";
import fs from "node:fs";

const DATASET =
  "https://thredds.met.no/thredds/dodsC/mepslatest/meps_lagged_6_h_latest_2_5km_20260830T15Z.nc";

// Skjæløy -> Skagen bbox from the task brief, with a small margin.
const BBOX = { south: 57.3, north: 59.6, west: 9.0, east: 11.5 };
const MARGIN = 0.3; // degrees, to be safe with coarse stride aliasing

const GRID = { ny: 1069, nx: 949 };

function dapAsciiUrl(varSpecs) {
  const q = varSpecs.join(",");
  return DATASET + ".ascii?" + encodeURIComponent(q).replace(/%2C/g, ",");
}

function spec(name, yRange, xRange) {
  return `${name}[${yRange[0]}:${yRange[2] ?? 1}:${yRange[1]}][${xRange[0]}:${xRange[2] ?? 1}:${xRange[1]}]`;
}

// Parse the ".ascii" Grid array body for a 2D variable into {rows, cols, values, yIdx, xIdx}
function parseGridAscii(text, varName) {
  const marker = `${varName}.${varName}`;
  const idx = text.indexOf(marker);
  if (idx === -1) throw new Error(`marker ${marker} not found`);
  const after = text.slice(idx);
  const lines = after.split("\n").filter((l) => l.trim().length > 0);
  // first line: "longitude.longitude[R][C]"
  const dimMatch = lines[0].match(/\[(\d+)\]\[(\d+)\]/);
  const rows = Number(dimMatch[1]);
  const cols = Number(dimMatch[2]);
  const values = [];
  for (let r = 1; r <= rows; r++) {
    const line = lines[r];
    const parts = line.split(",").map((s) => s.trim());
    // parts[0] is like "[r]"
    const rowVals = parts.slice(1).map(Number);
    values.push(rowVals);
  }
  return { rows, cols, values };
}

// Must match exactly what a DAP index-range request [0:stride:stop] returns:
// indices 0, stride, 2*stride, ... up to and including the last one <= stop.
// (No forced inclusion of the final index — that would desync from the
// actual response and break zip-alignment with the parsed values.)
function strideIndices(stop, stride) {
  const out = [];
  for (let i = 0; i <= stop; i += stride) out.push(i);
  return out;
}

async function probe(yStride, xStride, label) {
  const yIndices = strideIndices(GRID.ny - 1, yStride);
  const xIndices = strideIndices(GRID.nx - 1, xStride);

  const url = dapAsciiUrl([
    spec("longitude", [0, GRID.ny - 1, yStride], [0, GRID.nx - 1, xStride]),
    spec("latitude", [0, GRID.ny - 1, yStride], [0, GRID.nx - 1, xStride]),
  ]);
  console.log(`\n[${label}] stride y=${yStride} x=${xStride}\n${url}`);
  const r = await timedFetch(url, { asText: true });
  console.log(`status=${r.status} time=${fmtMs(r.ms)} bytes=${fmtBytes(r.bytes)}`);
  if (r.status !== 200) {
    console.log(r.text.slice(0, 500));
    throw new Error(`probe failed: ${r.status}`);
  }
  const lon = parseGridAscii(r.text, "longitude");
  const lat = parseGridAscii(r.text, "latitude");
  return { yIndices, xIndices, lon, lat, ms: r.ms, bytes: r.bytes };
}

function findWindow(probeResult, bbox) {
  const { yIndices, xIndices, lon, lat } = probeResult;
  let yMin = Infinity, yMax = -Infinity, xMin = Infinity, xMax = -Infinity;
  for (let ri = 0; ri < yIndices.length; ri++) {
    for (let ci = 0; ci < xIndices.length; ci++) {
      const lo = lon.values[ri][ci];
      const la = lat.values[ri][ci];
      if (lo >= bbox.west && lo <= bbox.east && la >= bbox.south && la <= bbox.north) {
        yMin = Math.min(yMin, yIndices[ri]);
        yMax = Math.max(yMax, yIndices[ri]);
        xMin = Math.min(xMin, xIndices[ri]);
        xMax = Math.max(xMax, xIndices[ri]);
      }
    }
  }
  return { yMin, yMax, xMin, xMax };
}

const results = { bbox: BBOX, margin: MARGIN, steps: [] };

// Pass 1: coarse probe, whole grid, stride 15 (~71x63 points)
const coarseBbox = {
  south: BBOX.south - 1.5,
  north: BBOX.north + 1.5,
  west: BBOX.west - 2,
  east: BBOX.east + 2,
};
const coarse = await probe(15, 15, "coarse");
const coarseWin = findWindow(coarse, coarseBbox);
console.log("coarse window (index space):", coarseWin);
results.steps.push({ label: "coarse", strideY: 15, strideX: 15, ms: coarse.ms, bytes: coarse.bytes, window: coarseWin });

if (!isFinite(coarseWin.yMin)) {
  console.error("FATAL: coarse probe found no points in bbox+margin — grid orientation or bbox may be wrong.");
  process.exit(1);
}

// Pass 2: fine probe restricted to a padded neighbourhood of the coarse window
const pad = 20; // index units, generously covers the coarse stride's aliasing
const yLo = Math.max(0, coarseWin.yMin - pad);
const yHi = Math.min(GRID.ny - 1, coarseWin.yMax + pad);
const xLo = Math.max(0, coarseWin.xMin - pad);
const xHi = Math.min(GRID.nx - 1, coarseWin.xMax + pad);

const t0 = performance.now();
const fineUrl = dapAsciiUrl([
  spec("longitude", [yLo, yHi, 1], [xLo, xHi, 1]),
  spec("latitude", [yLo, yHi, 1], [xLo, xHi, 1]),
]);
console.log(`\n[fine] full-res window y=[${yLo},${yHi}] x=[${xLo},${xHi}]\n${fineUrl}`);
const fineR = await timedFetch(fineUrl, { asText: true });
console.log(`status=${fineR.status} time=${fmtMs(fineR.ms)} bytes=${fmtBytes(fineR.bytes)}`);
const fineLon = parseGridAscii(fineR.text, "longitude");
const fineLat = parseGridAscii(fineR.text, "latitude");
const fineProbe = {
  yIndices: Array.from({ length: yHi - yLo + 1 }, (_, i) => yLo + i),
  xIndices: Array.from({ length: xHi - xLo + 1 }, (_, i) => xLo + i),
  lon: fineLon,
  lat: fineLat,
};
const fineWin = findWindow(fineProbe, BBOX);
console.log("fine window (index space, exact bbox):", fineWin);
results.steps.push({ label: "fine", window: fineWin, ms: fineR.ms, bytes: fineR.bytes, searchWindow: { yLo, yHi, xLo, xHi } });

results.finalWindow = fineWin;
results.gridResolutionKm = 2.5;
results.pointCountEstimate = (fineWin.yMax - fineWin.yMin + 1) * (fineWin.xMax - fineWin.xMin + 1);
console.log(`\nFinal index window: y=[${fineWin.yMin},${fineWin.yMax}] x=[${fineWin.xMin},${fineWin.xMax}]`);
console.log(`Grid points in bbox: ${results.pointCountEstimate}`);

fs.writeFileSync(new URL("./out-bbox-indices.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("\nWrote out-bbox-indices.json");
