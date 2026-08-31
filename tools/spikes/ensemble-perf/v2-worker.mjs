/**
 * Modul-Worker som kjører DEN EKTE v2-motoren (packages/routing) — ikke en
 * kopi. Lastes av `serve.mjs` fra `/engine/routing/...` (se der for hvorfor
 * en tynn server-proxy erstatter bundling/importmap).
 *
 * Instrumentering per steg3-plan-2026-08-31.md §4:
 *  1. Fase-klokker: konstruksjon (feltbygg+Tub-bound+oppsett) / søkeløkke /
 *     rekonstruksjon+ettersjekk, målt separat med `performance.now()`.
 *  2. Splittet hard-pruning: leses direkte fra `diagnostics.pruned.*`
 *     (packages/routing/src/search.ts — splittet 2026-08-31 for akkurat
 *     denne målingen, se rapport).
 *  3. Tellende maske-dekorator (denne filen, IKKE i packages/routing):
 *     teller kall + akkumulert tid per metode på `NavigabilityMask`.
 *  4. Antikjede-histogram: periodiske øyeblikksbilder av
 *     `RouteSearch.labelStoreSnapshot()` (ny, ren, lesende metode i
 *     packages/routing — se rapport) + sluttdump.
 *  5. Gate-statistikk: `diagnostics.clearance`/`clearanceRecheck` + et
 *     analytisk heap-estimat (arena-antall × bytes/etikett) kryssjekket mot
 *     `arenaBytes().length`.
 */
import {
  createSearchForTesting,
} from "/engine/routing/src/index.js";
import { goldenScenarios } from "/engine/routing/test-fixtures/golden-scenarios.js";
import { mulberry32 } from "/engine/routing/test-fixtures/seeded-random.js";

/** Bytes/etikett i `LabelArena` (§8.5, arena.ts-feltlisten) — analytisk skranke. */
const BYTES_PER_LABEL =
  8 + 8 + // lat, lon (Float64)
  4 + 4 + 4 + 4 + // tS, beatS, motorS, nightS (Int32)
  4 + // headingDeg (Float32)
  1 + // sector (Uint8)
  1 + // tack (Int8)
  4 + // parent (Int32)
  2 + // flags (Uint16)
  4 + 4 + // cellKey, stateKey (Int32)
  4 + 4 + // remainingNm, clearanceNm (Float32)
  4 + 4 + 4 + 4; // twsKn, twdDeg, bspKn, hsM (Float32)

let scenarioCache = null;
function scenarioByName(name) {
  scenarioCache ??= new Map(goldenScenarios().map((s) => [s.name, s]));
  const found = scenarioCache.get(name);
  if (!found) throw new Error(`ukjent golden-scenario: ${name}`);
  return found;
}

/** Deterministisk medlemsperturbasjon — IKKE E1'-ensemblet, kun lastgenerator for ytelsesmåling. */
function memberParams(index) {
  if (index === 0) return { ampMul: 1, dirOffDeg: 0, label: "control" };
  const rnd = mulberry32(1000 + index);
  return {
    ampMul: 1 + (rnd() * 2 - 1) * 0.2, // ±20 %
    dirOffDeg: (rnd() * 2 - 1) * 25, // ±25°
    label: `m${index}`,
  };
}

function perturbWeather(base, member) {
  return {
    wind(lat, lon, epochS) {
      const w = base.wind(lat, lon, epochS);
      if (!w) return w;
      return {
        speedKn: Math.max(0.3, w.speedKn * member.ampMul),
        fromDeg: (w.fromDeg + member.dirOffDeg + 360) % 360,
      };
    },
    waves: (lat, lon, epochS) => base.waves(lat, lon, epochS),
    current: (lat, lon, epochS) => base.current(lat, lon, epochS),
    maxTwsKn: base.maxTwsKn * member.ampMul,
    maxCurrentKn: base.maxCurrentKn,
    validFromS: base.validFromS,
    validToS: base.validToS,
    header: base.header,
  };
}

/** Teller kall + akkumulert tid (ms) per metode. IKKE i packages/routing (§4 pkt. 3). */
function makeCountingMask(mask) {
  const calls = {
    pointVerdict: 0,
    segmentVerdict: 0,
    clearanceNm: 0,
    tssVerdict: 0,
  };
  const timeMs = {
    pointVerdict: 0,
    segmentVerdict: 0,
    clearanceNm: 0,
    tssVerdict: 0,
  };
  function wrap(name, fn) {
    return (...args) => {
      const t0 = performance.now();
      const r = fn(...args);
      timeMs[name] += performance.now() - t0;
      calls[name]++;
      return r;
    };
  }
  return {
    coverage: mask.coverage,
    sources: mask.sources,
    pointVerdict: wrap("pointVerdict", mask.pointVerdict.bind(mask)),
    segmentVerdict: wrap("segmentVerdict", mask.segmentVerdict.bind(mask)),
    clearanceNm: wrap("clearanceNm", mask.clearanceNm.bind(mask)),
    tssVerdict: wrap("tssVerdict", mask.tssVerdict.bind(mask)),
    _stats: () => ({ calls: { ...calls }, timeMs: { ...timeMs } }),
  };
}

/** Frekvenstabell over antall etiketter per tilstand/celle, splittet på tack. */
function buildAntichainHistogram(entries) {
  const group = () => ({ countHistogram: {}, totalGroups: 0, totalLabels: 0 });
  const out = {
    perState: { tackZero: group(), tackNonzero: group() },
    perCell: { tackZero: group(), tackNonzero: group() },
  };
  const tally = (map, key, tack, n) => {
    const bucket = tack === 0 ? map.tackZero : map.tackNonzero;
    const label = n >= 10 ? "10+" : String(n);
    bucket.countHistogram[label] = (bucket.countHistogram[label] ?? 0) + 1;
    bucket.totalGroups++;
    bucket.totalLabels += n;
  };
  const byStateTack = new Map(); // `${stateKey}:${tackBucket}` -> count
  const byCellTack = new Map();
  for (const e of entries) {
    const tackBucket = e.tack === 0 ? 0 : 1;
    const sKey = `${e.stateKey}:${tackBucket}`;
    const cKey = `${e.cellKey}:${tackBucket}`;
    byStateTack.set(sKey, (byStateTack.get(sKey) ?? 0) + 1);
    byCellTack.set(cKey, (byCellTack.get(cKey) ?? 0) + 1);
  }
  for (const [key, n] of byStateTack) {
    const tackBucket = Number(key.split(":")[1]);
    tally(out.perState, key, tackBucket, n);
  }
  for (const [key, n] of byCellTack) {
    const tackBucket = Number(key.split(":")[1]);
    tally(out.perCell, key, tackBucket, n);
  }
  return out;
}

function summarizeMemory() {
  // performance.memory er Chrome-only og finnes i Worker-scope også der.
  const pm = globalThis.performance?.memory;
  return pm
    ? {
        usedJSHeapSize: pm.usedJSHeapSize,
        totalJSHeapSize: pm.totalJSHeapSize,
        jsHeapSizeLimit: pm.jsHeapSizeLimit,
      }
    : null;
}

/**
 * Kjører ETT ensemble-medlem gjennom den ekte motoren, fase-instrumentert.
 * `optionsOverride` lar protokoll-kjøringen variere kurs-/tidsoppløsning
 * (F3.5) uten å bytte scenario.
 */
function runMember({
  scenario: scenarioName,
  memberIndex,
  optionsOverride,
  snapshotEveryIterations,
  includeFullResult,
}) {
  const scenario = scenarioByName(scenarioName);
  const member = memberParams(memberIndex ?? 0);
  const countingMask = makeCountingMask(scenario.input.mask);
  const weather = perturbWeather(scenario.input.weather, member);

  const input = {
    ...scenario.input,
    weather,
    mask: countingMask,
    options: { ...(scenario.input.options ?? {}), ...(optionsOverride ?? {}) },
  };

  const snapshots = [];
  const everyN = snapshotEveryIterations && snapshotEveryIterations > 0
    ? snapshotEveryIterations
    : 20;

  const memBefore = summarizeMemory();
  const t0 = performance.now();
  const search = createSearchForTesting(input);
  const t1 = performance.now();

  let progress = { done: false, iterations: 0 };
  let iterCount = 0;
  while (!progress.done) {
    progress = search.advance(1);
    iterCount++;
    if (iterCount % everyN === 0) {
      snapshots.push({
        atIteration: iterCount,
        histogram: buildAntichainHistogram(search.labelStoreSnapshot()),
      });
    }
  }
  const t2 = performance.now();
  const result = search.finish();
  const t3 = performance.now();
  const finalHistogram = buildAntichainHistogram(search.labelStoreSnapshot());
  const memAfter = summarizeMemory();

  const arenaBytesActual = search.arenaBytes().length;
  const labelsCreated = result.diagnostics.labelsCreated;

  const maskStats = countingMask._stats();

  const timing = {
    constructorS: (t1 - t0) / 1000,
    searchLoopS: (t2 - t1) / 1000,
    reconstructRecheckS: (t3 - t2) / 1000,
    totalS: (t3 - t0) / 1000,
  };

  const heapEstimate = {
    labelsCreated,
    analyticBytes: labelsCreated * BYTES_PER_LABEL,
    actualArenaBytes: arenaBytesActual,
    bytesPerLabelAnalytic: BYTES_PER_LABEL,
    bytesPerLabelActual: labelsCreated > 0 ? arenaBytesActual / labelsCreated : 0,
  };

  return {
    scenario: scenarioName,
    member: member.label,
    memberIndex: memberIndex ?? 0,
    timing,
    diagnostics: result.diagnostics,
    reached: result.reached,
    abortReason: result.abortReason,
    totals: result.totals,
    maskStats,
    antichain: { snapshots, final: finalHistogram },
    heapEstimate,
    memory: { before: memBefore, after: memAfter },
    // Fullt RouteResult sendes kun på forespørsel (structured-clone-probe,
    // §7 pkt. 5) — ellers holdes nyttelasten liten for protokollkjøringer.
    fullResult: includeFullResult ? result : undefined,
  };
}

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "run-member") {
      const out = runMember(msg);
      // Absolutt epoke-tid (ikke `performance.now()`, som har egen
      // tidsopprinnelse per Worker): gjør sendetidspunktet sammenlignbart
      // med hovedtrådens klokke for postMessage/structured-clone-målingen
      // (§7 pkt. 5).
      const sentAtEpochMs = performance.timeOrigin + performance.now();
      self.postMessage({
        type: "done",
        jobId: msg.jobId,
        sentAtEpochMs,
        result: out,
      });
      return;
    }
    self.postMessage({
      type: "err",
      jobId: msg.jobId,
      message: `ukjent meldingstype: ${msg.type}`,
    });
  } catch (err) {
    self.postMessage({
      type: "err",
      jobId: msg.jobId,
      message: err?.message ?? String(err),
      stack: err?.stack ?? null,
    });
  }
};
