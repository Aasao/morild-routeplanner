// Task 2: subset test for MEPS 10 m wind, one ensemble member, all timesteps,
// for the Skjæløy->Skagen bbox.
//
// IMPORTANT DEVIATION FROM PLAN: NCSS (thredds/ncss/...) returned HTTP 503
// for every dataset tried, including the service root (thredds/ncss/) — see
// out-01-catalog-check.md. This looks like NCSS being disabled/down
// server-wide on this THREDDS instance, not a per-dataset issue. We fall
// back to OPeNDAP index-range subsetting (dodsC + [start:stride:stop]),
// which the research doc flagged as the fallback to verify anyway.
//
// Usage: node 03-meps-member-subset.mjs
import { timedFetch, fmtMs, fmtBytes, sleep } from "./lib.mjs";
import fs from "node:fs";

const DATASET =
  "https://thredds.met.no/thredds/dodsC/mepslatest/meps_lagged_6_h_latest_2_5km_20260830T15Z.nc";

const bboxIdx = JSON.parse(
  fs.readFileSync(new URL("./out-bbox-indices.json", import.meta.url), "utf8")
).finalWindow;

const NTIME = 62; // from .dds — meps_lagged_6_h_latest has 62 timesteps

function subsetUrl(varName, memberIdx, heightDimName = "height2") {
  const q =
    `${varName}[0:1:${NTIME - 1}][0:1:0][${memberIdx}:1:${memberIdx}]` +
    `[${bboxIdx.yMin}:1:${bboxIdx.yMax}][${bboxIdx.xMin}:1:${bboxIdx.xMax}]`;
  return DATASET + ".dods?" + encodeURIComponent(q).replace(/%2C/g, ",");
}

const results = [];
const nPointsPerTime = (bboxIdx.yMax - bboxIdx.yMin + 1) * (bboxIdx.xMax - bboxIdx.xMin + 1);
console.log(`bbox index window: y=[${bboxIdx.yMin},${bboxIdx.yMax}] x=[${bboxIdx.xMin},${bboxIdx.xMax}] -> ${nPointsPerTime} points/timestep, ${NTIME} timesteps`);

async function fetchOneVarOneMember(varName, memberIdx) {
  const url = subsetUrl(varName, memberIdx);
  const r = await timedFetch(url, { asText: false });
  console.log(`  ${varName} member=${memberIdx}: status=${r.status} time=${fmtMs(r.ms)} bytes=${fmtBytes(r.bytes)}`);
  return { varName, memberIdx, status: r.status, ms: r.ms, bytes: r.bytes, url };
}

// Test 1: single member (member 0), both wind components, all timesteps.
console.log("\n=== Single member (member 0), x_wind_10m + y_wind_10m ===");
for (const v of ["x_wind_10m", "y_wind_10m"]) {
  const r = await fetchOneVarOneMember(v, 0);
  results.push({ test: "single-member", ...r });
  await sleep(500);
}

// Test 2: repeat for 3 members (0, 1, 2) to see variance, x_wind_10m only.
console.log("\n=== 3 members sequentially (variance check), x_wind_10m ===");
for (const m of [0, 1, 2]) {
  const r = await fetchOneVarOneMember("x_wind_10m", m);
  results.push({ test: "3-members-x_wind_10m", ...r });
  await sleep(500);
}

// Test 3 (bonus): one combined request for members 0-2 in a single call,
// to see whether batching members into one request beats N separate calls.
console.log("\n=== Combined request: members 0-2 in one call, x_wind_10m ===");
{
  const q =
    `x_wind_10m[0:1:${NTIME - 1}][0:1:0][0:1:2]` +
    `[${bboxIdx.yMin}:1:${bboxIdx.yMax}][${bboxIdx.xMin}:1:${bboxIdx.xMax}]`;
  const url = DATASET + ".dods?" + encodeURIComponent(q).replace(/%2C/g, ",");
  const r = await timedFetch(url, { asText: false });
  console.log(`  combined 3-member: status=${r.status} time=${fmtMs(r.ms)} bytes=${fmtBytes(r.bytes)}`);
  results.push({ test: "combined-3-members", varName: "x_wind_10m", status: r.status, ms: r.ms, bytes: r.bytes, url });
}

// Extrapolate to 30 members based on the average per-member time/bytes for x_wind_10m.
const singleMemberSamples = results.filter((r) => r.test === "3-members-x_wind_10m" || (r.test === "single-member" && r.varName === "x_wind_10m"));
const avgMs = singleMemberSamples.reduce((a, r) => a + r.ms, 0) / singleMemberSamples.length;
const avgBytes = singleMemberSamples.reduce((a, r) => a + r.bytes, 0) / singleMemberSamples.length;

const summary = {
  bboxIndexWindow: bboxIdx,
  pointsPerTimestepPerMember: nPointsPerTime,
  timesteps: NTIME,
  avgSingleMemberFetchMs: avgMs,
  avgSingleMemberFetchBytes: avgBytes,
  extrapolation_30members_sequential: {
    totalSeconds: (avgMs * 30) / 1000,
    totalBytesFloat32Raw: avgBytes * 30,
    note: "x_wind_10m only; double for x+y components; NorKyst is separate dataset/request",
  },
  results,
};

fs.writeFileSync(new URL("./out-03-meps-member-subset.json", import.meta.url), JSON.stringify(summary, null, 2));
console.log(`\nAvg single-member fetch: ${fmtMs(avgMs)}, ${fmtBytes(avgBytes)}`);
console.log(`Extrapolated 30-member sequential total (x_wind_10m only): ${(avgMs*30/1000).toFixed(1)} s, ${fmtBytes(avgBytes*30)}`);
console.log("\nWrote out-03-meps-member-subset.json");
