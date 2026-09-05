/**
 * Spak 7 — PC-remåling av ÉN avgang på full oppløsning med bølge 1-riggen
 * på plass (docs/specs/robusthet.md §6.3, fase4a-plan bølge 2).
 *
 * Måler per fikstur (S-1, S-3, S-7 — første avgang): kontrollen med
 * `buildFieldForInput`, deretter alle 30 medlemmer sekvensielt med
 * kontrollens felt (`RouteInput.field`, slik PWA-workerne gjør det etter
 * bølge 1). Ingen delt Tub (D9.1). Full oppløsning = motorens standard
 * 6° / 1800 s (ADR-0005 pkt. 4: spikens 12° var ugyldig), overstyrt på
 * fiksturer som selv kjører 10°/3600 s.
 *
 * Veggklokke er ikke reproduserbar på tvers av kjøringer (maaling-e1 §7.4);
 * tallene her er én kjøring, én prosess, og rapporteres med iterasjoner/
 * etiketter ved siden av så de kan sammenlignes strukturelt senere.
 *
 * Kjør: `pnpm exec tsc -b packages/routing && node tools/spak7-maaling/maaling.mjs`
 * Skriver `docs/research/maaling-spak7-<dato>.md`.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFieldForInput, planRoute } from "../../packages/routing/dist/src/index.js";
import { controlInput, memberInput } from "../../packages/routing/dist/test-fixtures/ensemble.js";
import { s1SlorEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-golden.js";
import { s3FrontEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s3-front.js";
import { s7TwoRegimeEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s7-two-regime.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FULL = { headingStepDeg: 6, timeStepS: 1800 };
const FIXTURES = [
  { id: "S-1", bygg: s1SlorEnsemble },
  { id: "S-3", bygg: s3FrontEnsemble },
  { id: "S-7", bygg: s7TwoRegimeEnsemble },
];
const POOLS = [3, 5, 6];

function kind(r) {
  if (r.safety.reachesDestination) return "feasible";
  if (r.coverage.weather === "partial") return "inconclusive";
  if (r.diagnostics.pruned.bound > 0) return "rerun";
  return r.abortReason ?? "infeasible";
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const rows = [];
const lines = [];
const log = (t) => {
  lines.push(t);
  console.log(t);
};

for (const fx of FIXTURES) {
  const fixture = fx.bygg();
  const ctrl = { ...controlInput(fixture), options: { ...fixture.options, ...FULL } };
  const t0 = performance.now();
  const field = buildFieldForInput(ctrl);
  const tField = performance.now() - t0;
  const t1 = performance.now();
  const control = planRoute({ ...ctrl, field });
  const tControl = performance.now() - t1;

  const memberMs = [];
  let iterations = 0;
  let labels = 0;
  const kinds = new Map();
  for (const member of fixture.members) {
    const input = { ...memberInput(fixture, member, FULL), field };
    const s = performance.now();
    const r = planRoute(input);
    memberMs.push(performance.now() - s);
    iterations += r.diagnostics.iterations;
    labels += r.diagnostics.labelsCreated;
    const k = kind(r);
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const total = memberMs.reduce((a, b) => a + b, 0);
  const med = median(memberMs);
  const max = Math.max(...memberMs);
  const pooled = Object.fromEntries(
    POOLS.map((p) => [p, tField + tControl + (Math.ceil(fixture.members.length / p) * med) ]),
  );
  rows.push({ id: fx.id, tField, tControl, controlKind: kind(control), memberCount: fixture.members.length, total, med, max, iterations, labels, kinds, pooled });
  log(
    `[spak7] ${fx.id}: felt ${tField.toFixed(0)} ms, kontroll ${tControl.toFixed(0)} ms (${kind(control)}), ` +
      `30 medl. sekvensielt ${(total / 1000).toFixed(1)} s (median ${(med / 1000).toFixed(2)} s, maks ${(max / 1000).toFixed(2)} s), ` +
      `iter ${iterations}, etiketter ${labels}, klasser ${[...kinds].map(([k, v]) => `${k}:${v}`).join(" ")}; ` +
      `pool-anslag ${POOLS.map((p) => `${p}w=${(pooled[p] / 1000).toFixed(0)} s`).join(", ")}`,
  );
}

const dato = new Date().toISOString().slice(0, 10);
const md = `# Spak 7 — PC-remåling av én avgang, full oppløsning, med bølge 1-rigg

- Dato: ${dato}
- Status: målt (én kjøring, én prosess, Node ${process.version}; veggklokke er
  ikke reproduserbar på tvers av kjøringer — maaling-e1 §7.4).
- Oppsett: kontroll + 30 medlemmer sekvensielt per fikstur, første avgang;
  \`headingStepDeg: 6\`, \`timeStepS: 1800\` (full oppløsning); delt A\\*-felt fra
  kontrollen i \`RouteInput.field\`; ingen delt Tub (D9.1). Verktøy:
  \`tools/spak7-maaling/maaling.mjs\`.
- Pool-anslag = felt + kontroll + ⌈30/p⌉ × median medlemstid — en nedre
  grense (antar perfekt fordeling og ingen worker-overhead/strukturert
  kloning). PC: kjerner−1 = ${Math.max(1, Math.min(6, (await import("node:os")).cpus().length - 1))} workere.

| Fikstur | Felt | Kontroll | 30 medl. sekv. | Median/medlem | Maks/medlem | Iterasjoner | Etiketter | Klasser | 3 w | 5 w | 6 w |
|---|---|---|---|---|---|---|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.id} | ${r.tField.toFixed(0)} ms | ${(r.tControl / 1000).toFixed(1)} s (${r.controlKind}) | ${(r.total / 1000).toFixed(1)} s | ${(r.med / 1000).toFixed(2)} s | ${(r.max / 1000).toFixed(2)} s | ${r.iterations} | ${r.labels} | ${[...r.kinds].map(([k, v]) => `${k} ${v}`).join(", ")} | ${(r.pooled[3] / 1000).toFixed(0)} s | ${(r.pooled[5] / 1000).toFixed(0)} s | ${(r.pooled[6] / 1000).toFixed(0)} s |`,
  )
  .join("\n")}

## Tolkning mot portene

- ADR-0005 port 2 / robusthet.md §6.3 spak 7: «viser PC-remålingen > 40–50 s
  per avgang (sekvensielt), er nettbrett-tallet i praksis avgjort».
  Sekvensielt-kolonnen er det tallet; pool-kolonnene er hva progressiv
  UX faktisk får med 3–6 workere før nettbrett-faktoren (2–4×, umålt).
- F3.5s «< 60 s for topp-avgang» er hypotesen som testes: pool-anslag ×
  nettbrett-faktor mot 60 s.

## Rå logg

\`\`\`
${lines.join("\n")}
\`\`\`
`;
const out = resolve(join(HERE, "..", "..", "docs", "research", `maaling-spak7-${dato}.md`));
writeFileSync(out, md);
console.log(`skrev ${out}`);
