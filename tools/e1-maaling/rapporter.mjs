/**
 * Leser rådataene fra `maaling.mjs` og skriver ut tabellene rapporten trenger.
 * Ren visning — ingen tall regnes om her, bortsett fra prosentavvik mot fasit.
 *
 * Kjør: `node tools/e1-maaling/rapporter.mjs [--dir <rådatamappe>]`
 *
 * ## To rangeringskolonner (2026-09-01)
 *
 * Rangeringskriteriet i §4 ble forhåndsregistrert på **P50**-ankomst, og den
 * kolonnen står som målt. Produktets egen rangering er derimot **P90** («P90
 * som plantid», rutemotor-specens F4.4/F4.5). Begge skrives ut her, tydelig
 * merket: P50 er dommen, P90 er deskriptivt tillegg.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const dirIndex = args.indexOf("--dir");
const DIR =
  dirIndex >= 0
    ? resolve(args[dirIndex + 1])
    : join(REPO, "docs/research/maaling-e1-raadata");
const s = JSON.parse(readFileSync(join(DIR, "sammendrag.json"), "utf8"));

const VARIANTS = s.varianter;
const FASIT = s.fasit ?? "F";
const ANDRE = VARIANTS.filter((v) => v !== FASIT);

const f2 = (x, n = 3) => (x === null || x === undefined ? "–" : x.toFixed(n));
const pct = (v, fasit) =>
  v === null || fasit === null || fasit === 0 ? null : ((v - fasit) / fasit) * 100;

console.log(`# E1′-tabeller fra ${DIR}`);
console.log(
  `varianter: ${VARIANTS.join(", ")} (fasit: ${FASIT})` +
    (s.variantSpesifikasjon
      ? `\nspesifikasjon: ${JSON.stringify(s.variantSpesifikasjon)}`
      : ""),
);

for (const fx of s.fiksturer) {
  console.log(`\n### ${fx.fikstur}`);
  console.log(
    "| avgang | var | gj.f | P50 | P90 | ΔP50 % | ΔP90 % | beat P50 | motor P50 | natt P50 | felle-sett | alg.abort | median Δ (t) | IQR | maks avvik nm | ulik topologi | søk | eval | ms |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of fx.avganger) {
    const F = a.varianter[FASIT];
    for (const v of VARIANTS) {
      const V = a.varianter[v];
      const mf = V.motFasit;
      console.log(
        `| +${a.offsetH} t | ${v} | ${V.gjennomfoerbare}/${V.medlemmer} | ${f2(V.p50H)} | ${f2(V.p90H)} | ` +
          `${v === FASIT ? "–" : f2(pct(V.p50H, F.p50H), 2)} | ${v === FASIT ? "–" : f2(pct(V.p90H, F.p90H), 2)} | ` +
          `${f2(V.beatP50H, 2)} | ${f2(V.motorP50H, 2)} | ${f2(V.nightP50H, 2)} | ` +
          `${V.felleSett.length === 0 ? "∅" : V.felleSett.join(",")} | ${V.algoritmiskeAborter.length} | ` +
          `${mf ? f2(mf.medianDiffH, 4) : "–"} | ${mf ? f2(mf.iqrDiffH, 4) : "–"} | ` +
          `${mf ? f2(mf.maksAvvikNm, 2) : "–"} | ${mf ? `${mf.annenTopologi}/${V.medlemmer}` : "–"} | ` +
          `${V.sok} | ${V.evalueringer} | ${Math.round(V.ms)} |`,
      );
    }
  }

  // --- rangering, begge kvantiler
  for (const [merkelapp, nokkel] of [
    ["P50 (forhåndsregistrert dom)", "p50H"],
    ["P90 (deskriptivt tillegg 2026-09-01)", "p90H"],
  ]) {
    const r = rangering(fx, nokkel);
    console.log(
      `rangering ${merkelapp}: topp-avgang ` +
        VARIANTS.map((v) => `${v}=+${r.topp[v]}t`).join(" ") +
        ` | samme topp: ` +
        ANDRE.map((v) => `${v}=${r.sammeTopp[v]}`).join(" ") +
        ` | τ: ${r.tau ? ANDRE.map((v) => `${v}=${f2(r.tau[v], 3)}`).join(" ") : "n=3, ikke beregnet"}`,
    );
    for (const v of VARIANTS) {
      if (r.uavgjort[v].length > 1) {
        console.log(
          `  ⚠ ${v} har UAVGJORT topp mellom +${r.uavgjort[v].join("t/+")}t (identisk ${nokkel})`,
        );
      }
    }
    console.log(
      `  ${nokkel} per avgang: ` +
        VARIANTS.map((v) => `${v}=[${r.verdier[v].map((x) => f2(x, 3)).join(", ")}]`).join("  "),
    );
  }

  for (const a of fx.avganger) {
    const b = a.backoffSensitivitet;
    if (Object.keys(b).length > 0) {
      const b0 = (b.backoff0 ?? []).join(",") || "∅";
      const b2 = (b.backoff2 ?? []).join(",") || "∅";
      const b1 = a.varianter[FASIT].felleSett.join(",") || "∅";
      // §8.1 binder på paret 1 vs 2. Avvik ved 0 er den degenerasjonen §7.2
      // beskrev på forhånd, og er deskriptiv — ikke et inkonklusivt-flagg.
      console.log(
        `  +${a.offsetH} t backoff 0/1/2 (fasit): [${b0}] / [${b1}] / [${b2}]` +
          (b1 === b2 ? "  1≡2 KONKLUSIV" : "  ⚠ 1≠2 INKONKLUSIV") +
          (b0 === b1 ? "" : "  (0 avviker — forventet degenerasjon, §7.2)"),
      );
    }
    for (const [id, m] of Object.entries(a.utveiMargin ?? {})) {
      console.log(
        `  +${a.offsetH} t utvei-margin ${id}: ${m.havn}, ${f2(m.timer, 2)} t, Hs-margin ${f2(m.hsMarginM, 2)} m, TWS-margin ${f2(m.twsMarginKn, 1)} kn`,
      );
    }
  }
}

/**
 * Rangeringen på ett kvantil-felt, regnet **fra tallene i rådataene**, ikke
 * fra et lagret felt — slik at kjøringen 2026-08-31 (som bare lagret
 * P50-rangeringen) kan leses med samme kode.
 */
function rangering(fx, nokkel) {
  const verdier = {};
  const plass = {};
  const topp = {};
  const uavgjort = {};
  for (const v of VARIANTS) {
    const xs = fx.avganger.map((a) =>
      a.varianter[v][nokkel] === null
        ? Number.POSITIVE_INFINITY
        : a.varianter[v][nokkel],
    );
    verdier[v] = xs;
    const sortert = [...xs.keys()].sort((i, j) => xs[i] - xs[j]);
    const p = new Array(xs.length);
    sortert.forEach((idx, i) => (p[idx] = i));
    plass[v] = p;
    topp[v] = fx.avganger[sortert[0]].offsetH;
    const best = xs[sortert[0]];
    uavgjort[v] = fx.avganger
      .map((a, i) => (xs[i] === best ? a.offsetH : null))
      .filter((x) => x !== null);
  }
  const fasitUavgjort = new Set(uavgjort[FASIT]);
  return {
    verdier,
    plass,
    topp,
    uavgjort,
    sammeTopp: Object.fromEntries(
      ANDRE.map((v) => [v, fasitUavgjort.has(topp[v])]),
    ),
    tau:
      fx.avganger.length >= 5
        ? Object.fromEntries(
            ANDRE.map((v) => [v, kendallTau(plass[v], plass[FASIT])]),
          )
        : null,
  };
}

/** Kendall-τ-b (samme implementasjon som i `maaling.mjs`). */
function kendallTau(a, b) {
  const n = a.length;
  if (n < 2) return null;
  let concordant = 0;
  let discordant = 0;
  let tiesA = 0;
  let tiesB = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = Math.sign(a[i] - a[j]);
      const db = Math.sign(b[i] - b[j]);
      if (da === 0 && db === 0) {
        tiesA++;
        tiesB++;
      } else if (da === 0) tiesA++;
      else if (db === 0) tiesB++;
      else if (da === db) concordant++;
      else discordant++;
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const nevner = Math.sqrt((n0 - tiesA) * (n0 - tiesB));
  return nevner === 0 ? null : (concordant - discordant) / nevner;
}

// Kostnadssammendrag på tvers (deskriptivt).
console.log("\n### Kostnad (sum ms over alle avganger per fikstur)");
console.log(`| fikstur | ${VARIANTS.join(" | ")} | ${ANDRE.map((v) => `${v}/${FASIT}`).join(" | ")} |`);
console.log(`|---${"|---".repeat(VARIANTS.length + ANDRE.length)}|`);
for (const fx of s.fiksturer) {
  const sum = (v) => fx.avganger.reduce((acc, a) => acc + a.varianter[v].ms, 0);
  console.log(
    `| ${fx.fikstur} | ${VARIANTS.map((v) => Math.round(sum(v))).join(" | ")} | ` +
      `${ANDRE.map((v) => (sum(v) / sum(FASIT)).toFixed(3)).join(" | ")} |`,
  );
}
{
  const total = (v) =>
    s.fiksturer.reduce(
      (acc, fx) => acc + fx.avganger.reduce((a2, a) => a2 + a.varianter[v].ms, 0),
      0,
    );
  console.log(
    `| **sum** | ${VARIANTS.map((v) => Math.round(total(v))).join(" | ")} | ` +
      `${ANDRE.map((v) => (total(v) / total(FASIT)).toFixed(3)).join(" | ")} |`,
  );
}

// ---------------------------------------------------------- kriterietabellen
//
// §4, med §8-erstatningene. Ingen skjønn: reglene er skrevet ned slik de står
// i planen, og utfallet leses av tallene.

const BAND_PCT = 2;

function bandVerdict(v, fasit, spredning) {
  if (v === null || fasit === null)
    return { ok: null, rel: null, tekst: "ikke målbart" };
  const rel = Math.abs((v - fasit) / fasit) * 100;
  const abs = Math.abs(v - fasit);
  const okPct = rel <= BAND_PCT;
  const okSpread = spredning > 0 ? abs < 0.2 * spredning : okPct;
  // «Den strengeste som binder»: begge terskler må holde.
  return {
    ok: okPct && okSpread,
    rel,
    tekst: `${rel.toFixed(2)} % / ${spredning > 0 ? ((abs / spredning) * 100).toFixed(1) : "–"} % av spredning`,
  };
}

/** Rangeringsdommen på ett kvantil-felt (topp-avgang, flipp, τ). */
function rangeringsdom(fx, v, nokkel) {
  const r = rangering(fx, nokkel);
  const n = fx.avganger.length;
  const fasitVerdier = r.verdier[FASIT];
  const vVerdier = r.verdier[v];
  let flippUtenfor = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const df = fasitVerdier[i] - fasitVerdier[j];
      const dv = vVerdier[i] - vVerdier[j];
      if (!Number.isFinite(df) || !Number.isFinite(dv)) continue;
      if (Math.sign(df) === Math.sign(dv) || df === 0) continue;
      const rel = (Math.abs(df) / ((fasitVerdier[i] + fasitVerdier[j]) / 2)) * 100;
      if (rel > BAND_PCT) flippUtenfor = true;
    }
  }
  // §6.4: en topp-avgang-flipp diskvalifiserer KUN utenfor toleransebåndet.
  const toppF = fasitVerdier.indexOf(Math.min(...fasitVerdier.filter(Number.isFinite)));
  const toppV = vVerdier.indexOf(Math.min(...vVerdier.filter(Number.isFinite)));
  const sammeTopp = r.sammeTopp[v];
  const toppFlippUtenfor =
    !sammeTopp &&
    toppF !== toppV &&
    Number.isFinite(fasitVerdier[toppF]) &&
    Number.isFinite(fasitVerdier[toppV]) &&
    (Math.abs(fasitVerdier[toppF] - fasitVerdier[toppV]) /
      ((fasitVerdier[toppF] + fasitVerdier[toppV]) / 2)) *
      100 >
      BAND_PCT;
  const tau = r.tau?.[v] ?? null;
  return {
    sammeTopp,
    toppFlippUtenfor,
    flippUtenfor,
    tau,
    ok: !toppFlippUtenfor && !flippUtenfor && (tau === null || tau >= 0.8),
    uavgjortFasit: r.uavgjort[FASIT].length > 1,
  };
}

for (const [merkelapp, nokkel] of [
  ["§4 med §8-erstatninger — rangering på P50 (FORHÅNDSREGISTRERT DOM)", "p50H"],
  ["Samme tabell, rangering på P90 (DESKRIPTIVT TILLEGG 2026-09-01)", "p90H"],
]) {
  console.log(`\n\n## Kriterietabell: ${merkelapp}\n`);
  console.log(
    "| fikstur | variant | felle-sett | topp-avgang | τ / flipp | P50 | P90 | gj.f ±1 | alg.abort=0 |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  const brudd = [];
  for (const fx of s.fiksturer) {
    for (const v of ANDRE) {
      const felle = fx.avganger.every((a) => a.varianter[v].motFasit.identiskFelleSett);
      const rd = rangeringsdom(fx, v, nokkel);
      const p50 = fx.avganger.map((a) =>
        bandVerdict(a.varianter[v].p50H, a.varianter[FASIT].p50H, a.varianter[FASIT].spredningH),
      );
      const p90 = fx.avganger.map((a) =>
        bandVerdict(a.varianter[v].p90H, a.varianter[FASIT].p90H, a.varianter[FASIT].spredningH),
      );
      // «Verst» = største relative avvik, uansett om det bestod eller ikke.
      const verst = (xs) =>
        xs.reduce((w, x) => (x.rel === null ? w : w.rel === null || x.rel > w.rel ? x : w), xs[0]);
      const gjf = fx.avganger.every(
        (a) => Math.abs(a.varianter[v].motFasit.gjennomfoerbarhetsdiff) <= 1,
      );
      const abort = fx.avganger.every(
        (a) => a.varianter[v].algoritmiskeAborter.length === 0,
      );
      const merk = (ok) => (ok === null ? "?" : ok ? "✓" : "✗");
      console.log(
        `| ${fx.fikstur} | ${v} | ${merk(felle)} | ${rd.sammeTopp ? `✓${rd.uavgjortFasit ? " (fasit uavgjort)" : ""}` : rd.toppFlippUtenfor ? "✗ utenfor bånd" : "~ flipp i bånd"} | ` +
          `${merk(rd.ok)} ${rd.tau === null ? "(n=3)" : `τ=${rd.tau.toFixed(2)}`}${rd.flippUtenfor ? " flipp>bånd" : ""} | ` +
          `${merk(p50.every((x) => x.ok !== false))} ${verst(p50).tekst} | ` +
          `${merk(p90.every((x) => x.ok !== false))} ${verst(p90).tekst} | ` +
          `${merk(gjf)} | ${merk(abort)} |`,
      );
      if (!felle) brudd.push(`${fx.fikstur}/${v}: felle-sett`);
      if (!rd.ok) brudd.push(`${fx.fikstur}/${v}: rangering`);
      if (p50.some((x) => x.ok === false)) brudd.push(`${fx.fikstur}/${v}: P50`);
      if (p90.some((x) => x.ok === false)) brudd.push(`${fx.fikstur}/${v}: P90`);
      if (!gjf) brudd.push(`${fx.fikstur}/${v}: gjennomførbarhet`);
      if (!abort) brudd.push(`${fx.fikstur}/${v}: aborter`);
    }
  }
  console.log("\nBrudd:\n" + brudd.map((b) => "  - " + b).join("\n"));
}
