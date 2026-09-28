// D14.3-spiken (docs/specs/vaerpakker.md §18b pkt. 4): tallfest hvor feil
// vindens indeksvindu-forenkling (windLayerGeometry i tools/weather-pack/src/
// pipeline.ts — behandler et hentet (y,x)-indeksvindu som et jevnt lat/lon-
// rutenett over den ETTERSPURTE 1°-flisen) blir for NorKyst sammenlignet
// med nearest-neighbour mot kildens egne 2D lat/lon-arrays, i tre områder:
// Drøbaksund, Hvaler og åpent Skagerrak-vann på ruten Skjæløy-Skagen.
//
// Ingen produksjonskode endres eller importeres — dette er en frittstående
// måling. Sekvensielle, høflige OPeNDAP-kall (§16), samme User-Agent/lib som
// 01-04.
//
// Usage: node 05-norkyst-geometry-compare.mjs
import { timedFetch, fmtMs, fmtBytes, sleep } from "./lib.mjs";
import fs from "node:fs";

const DATASET = "https://thredds.met.no/thredds/dodsC/fou-hi/norkystv3_800m_m00_be";
const GRID = { ny: 1148, nx: 2747 };
const WEATHER_TILE_DEG = 1; // grid.ts, D7.1 — delt her for at spiken skal speile ekte flisstørrelse

// De tre områdene fra oppdraget. `point` er testpunktet selve saken gjelder;
// `tile` er 1°-flisen `tileBounds()` (grid.ts, floor(v/1)..+1) ville brukt
// som `bbox` inn i `windLayerGeometry` for et punkt her.
const AREAS = [
  { name: "Drøbaksund", point: { lat: 59.65, lon: 10.62 } },
  { name: "Hvaler", point: { lat: 59.05, lon: 11.05 } },
  { name: "Skagerrak-åpent", point: { lat: 58.3, lon: 10.3 } },
];

function tileBoundsFor(lat, lon) {
  const lonIndex = Math.floor(lon / WEATHER_TILE_DEG);
  const latIndex = Math.floor(lat / WEATHER_TILE_DEG);
  return {
    west: lonIndex * WEATHER_TILE_DEG,
    east: (lonIndex + 1) * WEATHER_TILE_DEG,
    south: latIndex * WEATHER_TILE_DEG,
    north: (latIndex + 1) * WEATHER_TILE_DEG,
  };
}

for (const area of AREAS) {
  area.tile = tileBoundsFor(area.point.lat, area.point.lon);
  // Tre testpunkter langs samme breddegrad, vest/midt/øst i flisen — viser
  // hvordan posisjonsfeilen vokser fra flisens origo.
  const w = area.tile.west, e = area.tile.east;
  area.testPoints = [
    { label: "vest-i-flis", lat: area.point.lat, lon: w + (e - w) * 0.1 },
    { label: "midt-i-flis (oppgitt punkt)", lat: area.point.lat, lon: area.point.lon },
    { label: "øst-i-flis", lat: area.point.lat, lon: e - (e - w) * 0.1 },
  ];
}

function strideIndices(stop, stride) {
  const out = [];
  for (let i = 0; i <= stop; i += stride) out.push(i);
  return out;
}

function ascii(spec) {
  return DATASET + ".ascii?" + encodeURIComponent(spec).replace(/%2C/g, ",");
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

// 4D-slice (time=1,depth=1,Y,X) ascii-parser — rader er "[t][d][y], v0,v1,..."
// (bekreftet format, se scratchpad-probe 2026-09-27).
function parse4dAscii(text, varName, yCount, xCount) {
  const marker = `${varName}.${varName}`;
  const idx = text.indexOf(marker);
  if (idx === -1) throw new Error(`marker ${marker} not found in:\n${text.slice(0, 300)}`);
  const lines = text.slice(idx).split("\n").filter((l) => l.trim().length > 0);
  const values = [];
  for (let y = 0; y < yCount; y++) {
    const line = lines[1 + y];
    values.push(line.split(",").slice(1).map(Number));
  }
  return values; // [y][x] raw Int16
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

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Retningsbevisst peiling (grader fra nord, med klokken) fra (lat1,lon1) til (lat2,lon2). */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function nearestIndex(value, min, stepDeg) {
  if (stepDeg === 0) return 0;
  return Math.round((value - min) / stepDeg);
}

const REPORT = { generatedAt: new Date().toISOString(), dataset: DATASET, areas: [] };

// --- Steg 1: én kombinert GROV probe over hele domenet, brukt til å finne
// nærmeste (y,x) til hvert testpunkt (nærmeste-punkt-søk, IKKE bbox-
// filtrering — se advarsel under). ---
const strideY = 6, strideX = 10;
const yIdxCoarse = strideIndices(GRID.ny - 1, strideY);
const xIdxCoarse = strideIndices(GRID.nx - 1, strideX);
const coarse = await probeLonLat(yIdxCoarse, xIdxCoarse, "coarse-whole-domain");
await sleep(600);

/**
 * NorKyst v3s rutenett følger norskekysten i en lang, buet stripe (bekreftet
 * ved firehjørne-probe: (y=0,x=0)=54,3°N/8,7°Ø ... (y=1147,x=2746)=75,7°N/
 * 18,3°Ø — IKKE en enkel plan rektangel-projeksjon i lat/lon-forstand).
 * Et rent bbox-CONTAINMENT-søk over en grovt STRIDET prøve kan derfor
 * plukke opp et helt annet, fjernt kystavsnitt som TILFELDIGVIS har
 * overlappende lat/lon-rekkevidde (funnet i denne spiken: Drøbaksunds
 * padBbox matchet feilaktig et Hvaler/Skagerrak-aktig område via en
 * strided bbox-filtrering). Nærmeste-punkt-søk (minimum avstand, ikke
 * "er innenfor boksen") unngår denne aliasingfellen.
 */
function nearestCoarsePoint(lat0, lon0) {
  let best = null;
  for (let ri = 0; ri < yIdxCoarse.length; ri++) {
    for (let ci = 0; ci < xIdxCoarse.length; ci++) {
      const la = coarse.lat.values[ri][ci];
      const lo = coarse.lon.values[ri][ci];
      const d = haversineMeters(lat0, lon0, la, lo);
      if (!best || d < best.d) best = { d, y: yIdxCoarse[ri], x: xIdxCoarse[ci], lat: la, lon: lo };
    }
  }
  return best;
}

for (const area of AREAS) {
  console.log(`\n=== ${area.name} ===`);
  const areaReport = { name: area.name, point: area.point, tile: area.tile };

  const nearestCoarse = nearestCoarsePoint(area.point.lat, area.point.lon);
  console.log(`${area.name} nærmeste grovpunkt:`, nearestCoarse);
  areaReport.nearestCoarsePoint = nearestCoarse;

  // Lokalt (geografisk sammenhengende) finoppslag rundt det grove treffet —
  // stort nok vindu til å romme hele 1°-flisen (empirisk ~130-140 native
  // celler per grad her), men avgrenset til ett kystavsnitt (unngår aliasing).
  const halfWindow = 130;
  const yLo = Math.max(0, nearestCoarse.y - halfWindow);
  const yHi = Math.min(GRID.ny - 1, nearestCoarse.y + halfWindow);
  const xLo = Math.max(0, nearestCoarse.x - halfWindow);
  const xHi = Math.min(GRID.nx - 1, nearestCoarse.x + halfWindow);
  const fineYIdx = strideIndices(yHi - yLo, 1).map((i) => i + yLo);
  const fineXIdx = strideIndices(xHi - xLo, 1).map((i) => i + xLo);
  const fine = await probeLonLat(fineYIdx, fineXIdx, `${area.name}-fine y=[${yLo},${yHi}] x=[${xLo},${xHi}]`);
  await sleep(600);

  // Flisens eksakte indeksvindu (det pipeline.ts ville fått for denne bboxen)
  // — trygt nå: søket er begrenset til DENNE lokale, sammenhengende blokken.
  const tileWin = findWindow(fineYIdx, fineXIdx, fine.lon, fine.lat, area.tile);
  console.log(`${area.name} flis-indeksvindu:`, tileWin);
  areaReport.tileIndexWindow = tileWin;
  const yCount = tileWin.yMax - tileWin.yMin + 1;
  const xCount = tileWin.xMax - tileWin.xMin + 1;
  areaReport.tileWindowDims = { yCount, xCount };

  // Native lat/lon for HELE flisvinduet (til NN-søk) — hentet fra den finmaskede probens undermatrise
  const yOffset = tileWin.yMin - yLo, xOffset = tileWin.xMin - xLo;
  const nativeLon = [], nativeLat = [];
  for (let y = 0; y < yCount; y++) {
    nativeLon.push(fine.lon.values[yOffset + y].slice(xOffset, xOffset + xCount));
    nativeLat.push(fine.lat.values[yOffset + y].slice(xOffset, xOffset + xCount));
  }

  // --- Lokal gridrotasjon: peiling fra node (y,x) til (y,x+1), midt i flisvinduet ---
  const midY = Math.floor(yCount / 2), midX = Math.floor(xCount / 2);
  const rotationSamples = [];
  for (const [dy, dx] of [[0, 0], [Math.floor(yCount / 4), 0], [-Math.floor(yCount / 4), 0]]) {
    const y = midY + dy;
    const x = midX;
    if (y < 0 || y >= yCount || x + 1 >= xCount) continue;
    const b = bearingDeg(nativeLat[y][x], nativeLon[y][x], nativeLat[y][x + 1], nativeLon[y][x + 1]);
    rotationSamples.push({ y: tileWin.yMin + y, x: tileWin.xMin + x, gridEastBearingDeg: b, rotationFromTrueEastDeg: b - 90 });
  }
  areaReport.localGridRotation = rotationSamples;
  console.log(`${area.name} lokal gridrotasjon (grid-x mot øst, grader):`, rotationSamples.map((s) => s.rotationFromTrueEastDeg.toFixed(1)));

  // --- Hent u_eastward/v_northward, overflate (depth-indeks 0), for hele flisvinduet, ett tidssteg ---
  const t0 = Date.UTC(2024, 0, 1, 0, 0, 0);
  const hoursSince = Math.floor((Date.now() - t0) / 3_600_000);
  const timeIdx = Math.max(0, hoursSince - 24); // ett døgn tilbake, trygt innenfor analyse
  const spec4d = (varName) =>
    `${varName}[${timeIdx}:1:${timeIdx}][0:1:0][${tileWin.yMin}:1:${tileWin.yMax}][${tileWin.xMin}:1:${tileWin.xMax}]`;
  const uUrl = ascii(spec4d("u_eastward"));
  console.log(`${area.name} u_eastward: ${uUrl}`);
  const uRes = await timedFetch(uUrl, { asText: true });
  console.log(`status=${uRes.status} time=${fmtMs(uRes.ms)} bytes=${fmtBytes(uRes.bytes)}`);
  await sleep(600);
  const vUrl = ascii(spec4d("v_northward"));
  const vRes = await timedFetch(vUrl, { asText: true });
  console.log(`status=${vRes.status} time=${fmtMs(vRes.ms)} bytes=${fmtBytes(vRes.bytes)}`);
  await sleep(600);

  const uRaw = parse4dAscii(uRes.text, "u_eastward", yCount, xCount);
  const vRaw = parse4dAscii(vRes.text, "v_northward", yCount, xCount);
  const FILL = -32767, SCALE = 0.001, OFFSET = 0.0;
  const decode = (raw) => (raw === FILL ? undefined : raw * SCALE + OFFSET);

  // Fyll-/maskestatistikk for hele flisvinduet
  let fillCount = 0, total = 0;
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      total++;
      if (uRaw[y][x] === FILL) fillCount++;
    }
  }
  areaReport.fillStats = { fillCount, total, fillFraction: fillCount / total };
  console.log(`${area.name} fyll-andel (land/no-data) i flisvinduet: ${fillCount}/${total} = ${((fillCount / total) * 100).toFixed(1)}%`);

  // --- For hvert testpunkt: naiv indeksvindu-metode (windLayerGeometry-stil) vs NN mot 2D lat/lon ---
  const latStepDeg = yCount > 1 ? (area.tile.north - area.tile.south) / (yCount - 1) : 0;
  const lonStepDeg = xCount > 1 ? (area.tile.east - area.tile.west) / (xCount - 1) : 0;

  areaReport.testPoints = [];
  for (const tp of area.testPoints) {
    // Naiv metode: windLayerGeometry ville regnet (y,x) fra flisens ANTATTE jevne rutenett
    const yNaive = Math.min(yCount - 1, Math.max(0, nearestIndex(tp.lat, area.tile.south, latStepDeg)));
    const xNaive = Math.min(xCount - 1, Math.max(0, nearestIndex(tp.lon, area.tile.west, lonStepDeg)));
    const naiveLat = nativeLat[yNaive][xNaive];
    const naiveLon = nativeLon[yNaive][xNaive];
    const naiveURaw = uRaw[yNaive][xNaive];
    const naiveVRaw = vRaw[yNaive][xNaive];
    const naiveU = decode(naiveURaw);
    const naiveV = decode(naiveVRaw);

    // NN: brute-force nærmeste ekte node i flisvinduet
    let bestDist = Infinity, bestY = 0, bestX = 0;
    for (let y = 0; y < yCount; y++) {
      for (let x = 0; x < xCount; x++) {
        const d = haversineMeters(tp.lat, tp.lon, nativeLat[y][x], nativeLon[y][x]);
        if (d < bestDist) {
          bestDist = d;
          bestY = y;
          bestX = x;
        }
      }
    }
    const nnLat = nativeLat[bestY][bestX];
    const nnLon = nativeLon[bestY][bestX];
    const nnURaw = uRaw[bestY][bestX];
    const nnVRaw = vRaw[bestY][bestX];
    const nnU = decode(nnURaw);
    const nnV = decode(nnVRaw);

    const posErrorNaiveM = haversineMeters(tp.lat, tp.lon, naiveLat, naiveLon);
    const posErrorNNM = bestDist;
    const sameNode = yNaive === bestY && xNaive === bestX;

    const speedKn = (u, v) => (u === undefined || v === undefined ? undefined : Math.hypot(u, v) * (3600 / 1852));
    // Strøm MOT (§ retningskonvensjon): bearing = atan2(u,v) — u=øst-komponent, v=nord-komponent,
    // "hvor strømmen går mot" i grader fra nord.
    const toDirDeg = (u, v) =>
      u === undefined || v === undefined ? undefined : (((Math.atan2(u, v) * 180) / Math.PI) + 360) % 360;

    const result = {
      label: tp.label,
      testPoint: { lat: tp.lat, lon: tp.lon },
      naive: {
        index: { y: tileWin.yMin + yNaive, x: tileWin.xMin + xNaive },
        assignedNodeLatLon: { lat: naiveLat, lon: naiveLon },
        posErrorM: posErrorNaiveM,
        raw: { u: naiveURaw, v: naiveVRaw },
        speedKn: speedKn(naiveU, naiveV),
        toDirectionDeg: toDirDeg(naiveU, naiveV),
        filled: naiveURaw === FILL || naiveVRaw === FILL,
      },
      nearestNeighbour: {
        index: { y: tileWin.yMin + bestY, x: tileWin.xMin + bestX },
        assignedNodeLatLon: { lat: nnLat, lon: nnLon },
        posErrorM: posErrorNNM,
        raw: { u: nnURaw, v: nnVRaw },
        speedKn: speedKn(nnU, nnV),
        toDirectionDeg: toDirDeg(nnU, nnV),
        filled: nnURaw === FILL || nnVRaw === FILL,
      },
      sameNode,
      speedDiffKn:
        speedKn(naiveU, naiveV) !== undefined && speedKn(nnU, nnV) !== undefined
          ? Math.abs(speedKn(naiveU, naiveV) - speedKn(nnU, nnV))
          : undefined,
      directionDiffDeg:
        toDirDeg(naiveU, naiveV) !== undefined && toDirDeg(nnU, nnV) !== undefined
          ? Math.min(
              Math.abs(toDirDeg(naiveU, naiveV) - toDirDeg(nnU, nnV)),
              360 - Math.abs(toDirDeg(naiveU, naiveV) - toDirDeg(nnU, nnV)),
            )
          : undefined,
    };
    areaReport.testPoints.push(result);
    console.log(
      `  [${tp.label}] naiv posfeil=${posErrorNaiveM.toFixed(0)}m (node y${result.naive.index.y}/x${result.naive.index.x}${result.naive.filled ? " FYLT" : ""}) ` +
        `NN posfeil=${posErrorNNM.toFixed(0)}m (node y${result.nearestNeighbour.index.y}/x${result.nearestNeighbour.index.x}${result.nearestNeighbour.filled ? " FYLT" : ""}) ` +
        `sammeNode=${sameNode} fartDiff=${result.speedDiffKn?.toFixed(2) ?? "n/a"}kn retnDiff=${result.directionDiffDeg?.toFixed(0) ?? "n/a"}°`,
    );
  }

  REPORT.areas.push(areaReport);
}

fs.writeFileSync(
  new URL("./out-05-norkyst-geometry-compare.json", import.meta.url),
  JSON.stringify(REPORT, null, 2),
);
console.log("\nSkrev out-05-norkyst-geometry-compare.json");
