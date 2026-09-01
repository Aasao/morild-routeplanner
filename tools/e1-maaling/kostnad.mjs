/**
 * **Deterministisk kostnadsmåling av E1′-variantene** (måleplanens §3 punkt 7,
 * skjerpet 2026-09-01).
 *
 * Kjør: `node tools/e1-maaling/kostnad.mjs [--ut <fil>] [--gjentak 1] [S-3 …]`
 *
 * ## Hvorfor denne finnes ved siden av `ms`-kolonnen i `maaling.mjs`
 *
 * `ms` er veggklokke, og veggklokke er det eneste i hele E1′-riggen som
 * **ikke** er deterministisk. Den 2026-09-01-kjøringen viste hvor mye det
 * koster: samme fasit på samme input varierte 67–99 s per S-1-avgang mellom
 * to kjøringer, og enkeltavganger fikk ratioer som er fysisk urimelige (et
 * skalarsøk «dyrere» enn fullt Pareto). Med fire varianter i minnet i stedet
 * for tre er GC-trykket dessuten et annet.
 *
 * Motoren rapporterer heldigvis sitt eget arbeid: `diagnostics.labelsCreated`,
 * `iterations` og `clearance.clearanceCalls` er **bit-deterministiske** og
 * teller nøyaktig det kursløkken, etikettlageret og geometrisjekkene gjør.
 * De er derfor hovedkolonnen her, og `ms` (minimum over gjentak) står ved
 * siden av som virkelighetssjekk.
 *
 * ## Hva som måles
 *
 * Kun **medlemssøket** — det er den delen F3.5s kursoppløsning gjelder.
 * R2-re-søket og de deskriptive ekstrakjøringene er holdt utenfor med vilje;
 * de har sin egen kolonne i matrisen.
 *
 * Rent og deterministisk (bortsett fra `ms`): ingen RNG, ingen nett.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planRoute, planRouteScalar } from "../../packages/routing/dist/src/index.js";
import {
  s1SlorEnsemble,
  s2BeatEnsemble,
  s4BohuslanEnsemble,
} from "../../packages/routing/dist/test-fixtures/ensemble-golden.js";
import { s3FrontEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s3-front.js";
import { s5DepartureWindowEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s5-departure.js";
import { s7TwoRegimeEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s7-two-regime.js";
import { s8WindAgainstCurrentEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s8-wind-current.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

const MATRIX = [
  { id: "S-1", bygg: s1SlorEnsemble },
  { id: "S-2", bygg: s2BeatEnsemble },
  { id: "S-3", bygg: s3FrontEnsemble },
  { id: "S-4", bygg: s4BohuslanEnsemble },
  { id: "S-5", bygg: s5DepartureWindowEnsemble },
  { id: "S-7", bygg: s7TwoRegimeEnsemble },
  { id: "S-8", bygg: s8WindAgainstCurrentEnsemble },
];

/** Samme fire varianter som den daterte tilleggskjøringen (måleplanens §8.4). */
const VARIANTS = [
  { navn: "F", skalar: false, opts: {} },
  { navn: "A", skalar: true, opts: {} },
  { navn: "F12", skalar: false, opts: { headingStepDeg: 12 } },
  { navn: "A12", skalar: true, opts: { headingStepDeg: 12 } },
];

function kjoerVariant(fx, variant) {
  const plan = variant.skalar ? planRouteScalar : planRoute;
  const opts = { ...fx.options, ...variant.opts };
  let etiketter = 0;
  let iterasjoner = 0;
  let klaringskall = 0;
  let toppEtiketter = 0;
  let framme = 0;
  const t0 = performance.now();
  for (const m of fx.members) {
    const r = plan({
      start: fx.start,
      dest: fx.dest,
      departEpochS: fx.departEpochS,
      weather: m.weather,
      mask: fx.mask,
      boat: fx.boat,
      options: opts,
    });
    const d = r.diagnostics;
    etiketter += d.labelsCreated;
    iterasjoner += d.iterations;
    klaringskall += d.clearance.clearanceCalls + d.clearanceRecheck.clearanceCalls;
    toppEtiketter = Math.max(toppEtiketter, d.peakActiveLabels);
    if (r.safety.reachesDestination) framme++;
  }
  return {
    ms: performance.now() - t0,
    etiketter,
    iterasjoner,
    klaringskall,
    toppEtiketter,
    framme,
    headingStepDeg: opts.headingStepDeg,
  };
}

function main() {
  const args = process.argv.slice(2);
  const utIndex = args.indexOf("--ut");
  const utFil =
    utIndex >= 0
      ? resolve(args[utIndex + 1])
      : join(REPO, "docs/research/maaling-e1-raadata-2026-09-01/kostnad.json");
  const gjIndex = args.indexOf("--gjentak");
  const gjentak = gjIndex >= 0 ? Number(args[gjIndex + 1]) : 1;
  const filter = args.filter((a) => /^S-\d$/.test(a));
  mkdirSync(dirname(utFil), { recursive: true });

  const alle = [];
  for (const spec of MATRIX) {
    if (filter.length > 0 && !filter.includes(spec.id)) continue;
    const rad = { fikstur: spec.id, varianter: {} };
    for (const variant of VARIANTS) {
      let best = null;
      for (let i = 0; i < gjentak; i++) {
        // Egen fikstur-instans per gjentak — ingen delte lukkinger.
        const r = kjoerVariant(spec.bygg(), variant);
        if (best === null) best = r;
        else best = { ...r, ms: Math.min(best.ms, r.ms) };
      }
      rad.varianter[variant.navn] = best;
    }
    const f = rad.varianter.F;
    for (const v of VARIANTS) {
      if (v.navn === "F") continue;
      const r = rad.varianter[v.navn];
      r.motFasit = {
        etiketter: r.etiketter / f.etiketter,
        iterasjoner: r.iterasjoner / f.iterasjoner,
        klaringskall: r.klaringskall / f.klaringskall,
        ms: r.ms / f.ms,
      };
    }
    alle.push(rad);
    console.log(
      `${spec.id} (${f.headingStepDeg}° fasit)  ` +
        VARIANTS.map((v) => {
          const r = rad.varianter[v.navn];
          return `${v.navn}: ${(r.etiketter / 1000).toFixed(0)}k etik / ${Math.round(r.ms)} ms` +
            (v.navn === "F"
              ? ""
              : ` (etik ${(r.etiketter / f.etiketter).toFixed(3)}, ms ${(r.ms / f.ms).toFixed(3)})`);
        }).join("  |  "),
    );
  }

  writeFileSync(
    utFil,
    JSON.stringify(
      {
        beskrivelse:
          "Deterministisk kostnadsmåling av E1′-variantenes MEDLEMSSØK " +
          "(måleplanens §8.4 punkt 3). `etiketter`/`iterasjoner`/`klaringskall` " +
          "er bit-deterministiske; `ms` er minimum over gjentak og indikativ.",
        gjentak,
        avgang: "fiksturens egen (+0 t)",
        fiksturer: alle,
      },
      null,
      1,
    ),
  );
  console.log(`\nSkrevet til ${utFil}`);
}

main();
