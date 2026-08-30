// Task 3: NorKyst subset test for surface current (u_eastward/v_northward),
// one day, in the Skjæløy->Skagen bbox.
//
// Dataset in use: fou-hi/norkystv3_800m_m00_be (LIVE "best estimate"
// aggregation of the NorKyst v3 system, 2024-01-01 .. ~today+5d, updated
// continuously). This supersedes fou-hi/norkyst800m-1h, which stopped being
// updated after 2025-10-05 (confirmed dead-end catalog, see spike report).
//
// NCSS is unavailable (503 everywhere, see 01/03) -> OPeNDAP index-range
// subsetting throughout, same approach as 02/03.
//
// Usage: node 04-norkyst-bbox-and-subset.mjs
import { timedFetch, fmtMs, fmtBytes, sleep } from "./lib.mjs";
import fs from "node:fs";

const DATASET = "https://thredds.met.no/thredds/dodsC/fou-hi/norkystv3_800m_m00_be";
const BBOX = { south: 57.3, north: 59.6, west: 9.0, east: 11.5 };
const GRID = { ny: 1148, nx: 2747 };

function strideIndices(stop, stride) {
  const out = [];
  for (let i = 0; i <= stop; i += stride) out.push(i);
  return out;
}

function ascii(spec) {
  return DATASET + ".ascii?" + encodeURIComponent(spec).replace(/%2C/g, ",");
}
function dods(spec) {
  return DATASET + ".dods?" + encodeURIComponent(spec).replace(/%2C/g, ",");
}

function parseGridAscii(text, varName) {
  const marker = `${varName}.${varName}`;
  const idx = text.indexOf(marker);
  if (idx === -1) throw new Error(`marker ${marker} not found in:\n${text.slice(0, 300)}`);
  const lines = text.slice(idx).split("\n").filter((l) => l.trim().length > 0);
  const dimMatch = lines[0].match(/\[(\d+)\]\[(\d+)\]/);
  const rows = Number(dimMatch[1]);
  const values = [];
  for (let r = 1; r <= rows; r++) {
    values.push(lines[r].split(",").slice(1).map(Number));
  }
  return { rows, values };
}

async function probeLonLat(yIndices, xIndices, label) {
  const spec =
    `lon[${yIndices[0]}:${yIndices[1] - yIndices[0] || 1}:${yIndices[yIndices.length - 1]}]` +
    `[${xIndices[0]}:${xIndices[1] - xIndices[0] || 1}:${xIndices[xIndices.length - 1]}],` +
    `lat[${yIndices[0]}:${yIndices[1] - yIndices[0] || 1}:${yIndices[yIndices.length - 1]}]` +
    `[${xIndices[0]}:${xIndices[1] - xIndices[0] || 1}:${xIndices[xIndices.length - 1]}]`;
  const url = ascii(spec);
  console.log(`\n[${label}]\n${url}`);
  const r = await timedFetch(url, { asText: true });
  console.log(`status=${r.status} time=${fmtMs(r.ms)} bytes=${fmtBytes(r.bytes)}`);
  if (r.status !== 200) throw new Error(r.text.slice(0, 400));
  return { lon: parseGridAscii(r.text, "lon"), lat: parseGridAscii(r.text, "lat") };
}

function findWindow(yIndices, xIndices, lon, lat, bbox) {
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

const report = { bbox: BBOX, grid: GRID, steps: [] };

// Coarse probe: stride 25 over the whole grid (~46 x 110 points)
const strideY = 25, strideX = 40;
const yIdx = strideIndices(GRID.ny - 1, strideY);
const xIdx = strideIndices(GRID.nx - 1, strideX);
const coarseBboxPad = { south: BBOX.south - 1.5, north: BBOX.north + 1.5, west: BBOX.west - 2, east: BBOX.east + 2 };
const coarse = await probeLonLat(yIdx, xIdx, "coarse");
const coarseWin = findWindow(yIdx, xIdx, coarse.lon, coarse.lat, coarseBboxPad);
console.log("coarse window:", coarseWin);
report.steps.push({ label: "coarse", strideY, strideX, window: coarseWin });
if (!isFinite(coarseWin.yMin)) {
  console.error("FATAL: coarse probe found nothing — check grid/projection assumptions.");
  process.exit(1);
}
await sleep(500);

// Fine probe: full resolution in padded neighbourhood
const pad = 30;
const yLo = Math.max(0, coarseWin.yMin - pad), yHi = Math.min(GRID.ny - 1, coarseWin.yMax + pad);
const xLo = Math.max(0, coarseWin.xMin - pad), xHi = Math.min(GRID.nx - 1, coarseWin.xMax + pad);
const fineYIdx = strideIndices(yHi - yLo, 1).map((i) => i + yLo);
const fineXIdx = strideIndices(xHi - xLo, 1).map((i) => i + xLo);
const fine = await probeLonLat(fineYIdx, fineXIdx, `fine y=[${yLo},${yHi}] x=[${xLo},${xHi}]`);
const fineWin = findWindow(fineYIdx, fineXIdx, fine.lon, fine.lat, BBOX);
console.log("fine window (exact bbox):", fineWin);
report.steps.push({ label: "fine", searchWindow: { yLo, yHi, xLo, xHi }, window: fineWin });
await sleep(500);

report.finalWindow = fineWin;
const nPoints = (fineWin.yMax - fineWin.yMin + 1) * (fineWin.xMax - fineWin.xMin + 1);
report.pointCountEstimate = nPoints;
console.log(`\nFinal NorKyst v3 index window: y=[${fineWin.yMin},${fineWin.yMax}] x=[${fineWin.xMin},${fineWin.xMax}] -> ${nPoints} points (800 m grid)`);

fs.writeFileSync(new URL("./out-norkyst-bbox-indices.json", import.meta.url), JSON.stringify(report, null, 2));

// --- Now the actual subset test: surface current (depth index 0), one day (24h) ---
// Find "today" as an index into the time array: since the aggregation runs
// 2024-01-01T00Z hourly, index = hours since 2024-01-01T00:00:00Z.
const t0 = Date.UTC(2024, 0, 1, 0, 0, 0);
const now = new Date();
const hoursSince = Math.floor((now.getTime() - t0) / 3_600_000);
// clamp to a day roughly "yesterday" to be safely within analysis (not forecast edge)
const startIdx = Math.max(0, hoursSince - 48);
const endIdx = startIdx + 23; // 24 hourly steps

console.log(`\nSubsetting one day of surface current: time index [${startIdx}..${endIdx}]`);

async function fetchCurrentVar(varName) {
  const spec =
    `${varName}[${startIdx}:1:${endIdx}][0:1:0]` +
    `[${fineWin.yMin}:1:${fineWin.yMax}][${fineWin.xMin}:1:${fineWin.xMax}]`;
  const url = dods(spec);
  const r = await timedFetch(url, { asText: false });
  console.log(`  ${varName}: status=${r.status} time=${fmtMs(r.ms)} bytes=${fmtBytes(r.bytes)}`);
  return { varName, status: r.status, ms: r.ms, bytes: r.bytes, url };
}

const subsetResults = [];
for (const v of ["u_eastward", "v_northward"]) {
  subsetResults.push(await fetchCurrentVar(v));
  await sleep(500);
}

report.oneDaySubset = {
  timeIndexRange: [startIdx, endIdx],
  depthIndex: 0,
  pointsPerTimestep: nPoints,
  results: subsetResults,
};

fs.writeFileSync(new URL("./out-04-norkyst-subset.json", import.meta.url), JSON.stringify(report, null, 2));
console.log("\nWrote out-norkyst-bbox-indices.json and out-04-norkyst-subset.json");
