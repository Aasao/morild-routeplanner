/**
 * Bygger `sammendrag.json` fra per-fikstur-filene i en rådatamappe.
 *
 * Kjør: `node tools/e1-maaling/sammendrag.mjs --dir <rådatamappe>`
 *
 * `maaling.mjs` skriver sammendraget selv, men bare over de fiksturene
 * *den kjøringen* omfattet. Tilleggskjøringen 2026-09-01 måtte kjøres i to
 * omganger (prosessen ble avbrutt under S-8), og da trengs en ren
 * sammenstilling som ikke regner om noe. Denne filen kopierer felter — den
 * beregner ingenting.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const dirIndex = args.indexOf("--dir");
const DIR =
  dirIndex >= 0
    ? resolve(args[dirIndex + 1])
    : join(REPO, "docs/research/maaling-e1-raadata-2026-09-01");

const REKKEFOLGE = ["S-1", "S-2", "S-3", "S-4", "S-5", "S-7", "S-8"];

function utenTungeFelt(variantResultat) {
  const kopi = { ...variantResultat };
  delete kopi.utfall;
  delete kopi.r2Sok;
  return kopi;
}

const fiksturer = [];
let varianter = null;
for (const id of REKKEFOLGE) {
  const fil = join(DIR, `${id.toLowerCase()}.json`);
  if (!existsSync(fil)) {
    console.warn(`hopper over ${id}: ${fil} finnes ikke`);
    continue;
  }
  const f = JSON.parse(readFileSync(fil, "utf8"));
  const vs = Object.keys(f.avganger[0].varianter);
  if (varianter === null) varianter = vs;
  else if (varianter.join(",") !== vs.join(",")) {
    throw new Error(
      `${id} har varianter [${vs}], men de øvrige har [${varianter}] — ` +
        "sammendraget ville sammenlignet ulike matriser",
    );
  }
  fiksturer.push({
    fikstur: f.fikstur,
    rangering: f.rangering,
    rangeringP90: f.rangeringP90,
    avganger: f.avganger.map((a) => ({
      offsetH: a.offsetH,
      kontroll: a.kontroll,
      backoffSensitivitet: a.backoffSensitivitet,
      utveiMargin: a.utveiMargin,
      varianter: Object.fromEntries(
        varianter.map((v) => [v, utenTungeFelt(a.varianter[v])]),
      ),
    })),
  });
}

writeFileSync(
  join(DIR, "sammendrag.json"),
  JSON.stringify(
    {
      beskrivelse:
        "E1′-matrisen, datert tilleggskjøring 2026-09-01 (måleplanens §8.4). " +
        "Se docs/research/maaling-e1-2026-08-31.md §6.",
      varianter,
      fasit: "F",
      variantSpesifikasjon: {
        F: { base: "F", soek: {}, r2: {} },
        A: { base: "A", soek: {}, r2: {} },
        F12: {
          base: "F",
          soek: { headingStepDeg: 12 },
          r2: { headingStepDeg: 12 },
        },
        A12: {
          base: "A",
          soek: { headingStepDeg: 12 },
          r2: { headingStepDeg: 12 },
        },
      },
      merknad:
        "Sammenstilt av tools/e1-maaling/sammendrag.mjs fra per-fikstur-filene " +
        "(kjøringen måtte deles i to fordi prosessen ble avbrutt under S-8). " +
        "`ms` er derfor ikke sammenlignbar på tvers av fiksturer; se " +
        "kostnad.json for den deterministiske kostnadsmålingen.",
      fiksturer,
    },
    null,
    1,
  ),
);
console.log(
  `sammendrag.json skrevet: ${fiksturer.length} fiksturer, varianter [${varianter}]`,
);
