/**
 * **Hvor stort blir Hs-trinnet når skalaen er per flis?**
 *
 * §10 krav 2 i kvantiseringsmålingen sier «Hs-trinnet skal være ≤ 5 cm», og
 * anbefaler samtidig **8 bit med skala/offset per flis**. Med global skala er
 * trinnet kjent på forhånd (12 m / 255 = 4,7 cm). Med flis-skala er det ikke:
 * trinnet er `(maks − min i flisen og skiven) / 255`, altså en **egenskap ved
 * feltet**, ikke ved formatet. Denne sonden måler det direkte på de fiksturene
 * hardgrense-flippene faktisk bor i (S-3 og S-8, kontroll + 30 medlemmer), med
 * nøyaktig samme flisgeometri som `pack-degradation.ts` bruker.
 *
 * Sonden er ren og deterministisk: den leser analytiske fiksturfelt, ingen I/O
 * utover å skrive rådatafilen.
 *
 * Kjør:  node tools/kvantisering/hs-trinn.mjs [--ut <mappe>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { s3FrontEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s3-front.js";
import { s8WindAgainstCurrentEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s8-wind-current.js";
import {
  domainAround,
  latStepDegFor,
  lonStepDegFor,
} from "../../packages/routing/dist/test-fixtures/pack-degradation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const H = 3600;
const TILE_NODES = 32;
const BITS = 8;
const LEVELS = 2 ** BITS - 1;
/** Antall timesskiver som måles fra feltets `validFromS` — dekker rutehorisonten. */
const SLICES = 20;

/** Maks Hs-trinn over alle fliser/skiver i ett felt, ved gitt nodeavstand. */
function trinnFor(field, domain, waveKm) {
  const latStep = latStepDegFor(waveKm);
  const lonStep = lonStepDegFor(waveKm);
  const tiMin = Math.floor(domain.latMin / latStep / TILE_NODES);
  const tiMax = Math.floor(domain.latMax / latStep / TILE_NODES);
  const tjMin = Math.floor(domain.lonMin / lonStep / TILE_NODES);
  const tjMax = Math.floor(domain.lonMax / lonStep / TILE_NODES);

  let maksTrinn = 0;
  let maksSpenn = 0;
  let fliser = 0;
  let overTerskel = 0;
  const TERSKEL_M = 0.05;

  for (let k = 0; k < SLICES; k++) {
    const epochS = field.validFromS + k * H;
    if (epochS > field.validToS) break;
    for (let ti = tiMin; ti <= tiMax; ti++) {
      for (let tj = tjMin; tj <= tjMax; tj++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let a = 0; a < TILE_NODES; a++) {
          const lat = (ti * TILE_NODES + a) * latStep;
          for (let b = 0; b < TILE_NODES; b++) {
            const lon = (tj * TILE_NODES + b) * lonStep;
            const s = field.waves(lat, lon, epochS);
            if (s === undefined || !Number.isFinite(s.hsM)) continue;
            if (s.hsM < lo) lo = s.hsM;
            if (s.hsM > hi) hi = s.hsM;
          }
        }
        if (lo === Infinity) continue;
        fliser++;
        const spenn = hi - lo;
        const trinn = spenn / LEVELS;
        if (spenn > maksSpenn) maksSpenn = spenn;
        if (trinn > maksTrinn) maksTrinn = trinn;
        if (trinn > TERSKEL_M) overTerskel++;
      }
    }
  }
  return { maksTrinnM: maksTrinn, maksSpennM: maksSpenn, fliser, fliserOver5cm: overTerskel };
}

function felter() {
  const ut = [];
  for (const [navn, bygg] of [
    ["S-3", s3FrontEnsemble],
    ["S-8", s8WindAgainstCurrentEnsemble],
  ]) {
    const fx = bygg();
    const domain = domainAround([fx.start, fx.dest]);
    ut.push({ fikstur: navn, id: "kontroll", field: fx.control, domain });
    for (const m of fx.members) {
      ut.push({ fikstur: navn, id: m.id, field: m.weather, domain });
    }
  }
  return ut;
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--ut");
  const utMappe = resolve(
    i >= 0
      ? args[i + 1]
      : join(REPO, "docs/research/kvantisering-raadata/tillegg-k-anbefalt"),
  );
  mkdirSync(utMappe, { recursive: true });

  const rader = [];
  for (const f of felter()) {
    for (const [variant, waveKm] of [
      ["K-ANB-KYST (2,5 km)", 2.5],
      ["K-ANB-UTASKJAERS (5 km)", 5],
    ]) {
      const r = trinnFor(f.field, f.domain, waveKm);
      rader.push({ fikstur: f.fikstur, felt: f.id, variant, waveKm, ...r });
    }
  }

  const oppsummering = {};
  for (const v of new Set(rader.map((r) => r.variant))) {
    const s = rader.filter((r) => r.variant === v);
    oppsummering[v] = {
      maksTrinnM: Math.max(...s.map((r) => r.maksTrinnM)),
      maksSpennM: Math.max(...s.map((r) => r.maksSpennM)),
      fliser: s.reduce((a, r) => a + r.fliser, 0),
      fliserOver5cm: s.reduce((a, r) => a + r.fliserOver5cm, 0),
      verstFelt: s.reduce((a, b) => (a.maksTrinnM >= b.maksTrinnM ? a : b)).felt,
    };
    console.log(
      `${v.padEnd(24)} maks trinn=${(oppsummering[v].maksTrinnM * 100).toFixed(2)} cm ` +
        `(spenn ${oppsummering[v].maksSpennM.toFixed(2)} m, verste felt ${oppsummering[v].verstFelt}) ` +
        `fliser>5cm: ${oppsummering[v].fliserOver5cm}/${oppsummering[v].fliser}`,
    );
  }

  writeFileSync(
    join(utMappe, "hs-trinn.json"),
    JSON.stringify(
      {
        beskrivelse:
          "Realisert Hs-kvantiseringstrinn ved 8 bit med skala/offset per flis (32×32 noder), " +
          "målt på S-3 og S-8 (kontroll + 30 medlemmer), 20 timesskiver.",
        bits: BITS,
        tileNodes: TILE_NODES,
        slices: SLICES,
        oppsummering,
        rader,
      },
      null,
      1,
    ),
  );
  console.log(`Rådata skrevet til ${join(utMappe, "hs-trinn.json")}`);
}

main();
