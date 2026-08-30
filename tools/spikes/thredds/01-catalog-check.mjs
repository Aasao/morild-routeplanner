// Task 1: catalog verification.
// - MEPS latest run: filename pattern for members, newest run.
// - NorKyst: does norkyst800m-1h still exist? Is there a v2/v3?
// - Coastal wave model (WAM800) Skagerrak domain: actual THREDDS path.
//
// Usage: node 01-catalog-check.mjs
import { timedFetch, fmtMs, fmtBytes, sleep } from "./lib.mjs";
import fs from "node:fs";

const results = [];

async function check(label, url) {
  console.log(`\n--- ${label} ---\n${url}`);
  try {
    const r = await timedFetch(url, { asText: true });
    console.log(`status=${r.status} time=${fmtMs(r.ms)} bytes=${fmtBytes(r.bytes)}`);
    results.push({ label, url, status: r.status, ms: r.ms, bytes: r.bytes });
    return r;
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    results.push({ label, url, error: e.message });
    return null;
  } finally {
    await sleep(300); // be nice
  }
}

const out = [];

// 1. MEPS latest catalog (XML — machine readable)
const meps = await check("MEPS latest catalog.xml", "https://thredds.met.no/thredds/catalog/mepslatest/catalog.xml");
if (meps?.text) {
  // extract dataset names / urlPaths
  const nameMatches = [...meps.text.matchAll(/<dataset name="([^"]+)"[^>]*urlPath="([^"]+)"/g)];
  out.push(`\n## mepslatest/catalog.xml — ${nameMatches.length} dataset entries found`);
  const sample = nameMatches.slice(0, 15).map((m) => m[1]);
  out.push("Sample dataset names:\n" + sample.map((s) => `- ${s}`).join("\n"));
  // look for member pattern meps_mbrNNN
  const memberNames = nameMatches.filter((m) => /mbr\d{3}/.test(m[1]));
  out.push(`\nEntries matching mbr### pattern: ${memberNames.length}`);
  out.push(memberNames.slice(0, 10).map((m) => `- ${m[1]} -> ${m[2]}`).join("\n"));
  fs.writeFileSync(new URL("./out-mepslatest-catalog.xml", import.meta.url), meps.text);
} else {
  out.push("\n## mepslatest/catalog.xml — FAILED, see error above");
}

// 2. meps25epsarchive top catalog (to see date-organized structure)
const archive = await check("MEPS eps archive catalog.xml", "https://thredds.met.no/thredds/catalog/meps25epsarchive/catalog.xml");
if (archive?.text) {
  const dirMatches = [...archive.text.matchAll(/<catalogRef[^>]*xlink:href="([^"]+)"[^>]*xlink:title="([^"]+)"/g)];
  out.push(`\n## meps25epsarchive/catalog.xml — ${dirMatches.length} sub-catalogs`);
  out.push(dirMatches.slice(0, 10).map((m) => `- ${m[2]} -> ${m[1]}`).join("\n"));
}

// 3. NorKyst800m-1h catalog — does it still exist?
const nk1 = await check("NorKyst800m-1h catalog.xml", "https://thredds.met.no/thredds/catalog/fou-hi/norkyst800m-1h/catalog.xml");
if (nk1?.text) {
  const dsMatches = [...nk1.text.matchAll(/<dataset name="([^"]+)"/g)];
  out.push(`\n## fou-hi/norkyst800m-1h/catalog.xml — ${dsMatches.length} dataset entries`);
  out.push(dsMatches.slice(0, 10).map((m) => `- ${m[1]}`).join("\n"));
}

// 4. NorKyst v2 page (HTML, human page — may 404 or redirect)
await check("NorKyst v2 page (html)", "https://thredds.met.no/thredds/fou-hi/norkyst800v2.html");

// 4b. Try a plausible v2/v3 catalog path directly
await check("NorKyst v2 catalog attempt", "https://thredds.met.no/thredds/catalog/fou-hi/norkyst800v2/catalog.xml");
await check("NorKyst v3 catalog attempt", "https://thredds.met.no/thredds/catalog/fou-hi/norkyst800v3/catalog.xml");

// 5. ocean.met.no models page — find WAM800 Skagerrak (c4) domain path
await check("ocean.met.no models page", "https://ocean.met.no/models");

// 6. fou-hi top-level catalog — browse for wave model directories
const fouhi = await check("fou-hi top catalog.xml", "https://thredds.met.no/thredds/catalog/fou-hi/catalog.xml");
if (fouhi?.text) {
  const dirMatches = [...fouhi.text.matchAll(/<catalogRef[^>]*xlink:href="([^"]+)"[^>]*xlink:title="([^"]+)"/g)];
  out.push(`\n## fou-hi/catalog.xml — ${dirMatches.length} sub-catalogs (looking for wave/wam)`);
  const waveish = dirMatches.filter((m) => /wam|wave|bølge|skag/i.test(m[2]) || /wam|wave|skag/i.test(m[1]));
  out.push("All entries:\n" + dirMatches.map((m) => `- ${m[2]} -> ${m[1]}`).join("\n"));
  out.push("\nWave-ish matches:\n" + waveish.map((m) => `- ${m[2]} -> ${m[1]}`).join("\n"));
}

fs.writeFileSync(new URL("./out-01-catalog-check.md", import.meta.url), out.join("\n"));
fs.writeFileSync(new URL("./out-01-catalog-check.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("\n\nDone. Wrote out-01-catalog-check.md and .json");
