/**
 * Leser rådataene fra `maaling.mjs` og skriver ut tabellene rapporten trenger.
 * Ren visning — ingen tall regnes om her, bortsett fra prosentavvik mot fasit.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(REPO, "docs/research/maaling-e1-raadata");
const s = JSON.parse(readFileSync(join(DIR, "sammendrag.json"), "utf8"));

const f2 = (x, n = 3) => (x === null || x === undefined ? "–" : x.toFixed(n));
const pct = (v, fasit) =>
  v === null || fasit === null || fasit === 0 ? null : ((v - fasit) / fasit) * 100;

for (const fx of s.fiksturer) {
  console.log(`\n### ${fx.fikstur}`);
  console.log(
    "| avgang | var | gj.f | P50 | P90 | ΔP50 % | ΔP90 % | beat P50 | motor P50 | natt P50 | felle-sett | alg.abort | median Δ (t) | IQR | maks avvik nm | ulik topologi | søk | eval | ms |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of fx.avganger) {
    const F = a.varianter.F;
    for (const v of ["A", "B", "F"]) {
      const V = a.varianter[v];
      const mf = V.motFasit;
      console.log(
        `| +${a.offsetH} t | ${v} | ${V.gjennomfoerbare}/${V.medlemmer} | ${f2(V.p50H)} | ${f2(V.p90H)} | ` +
          `${v === "F" ? "–" : f2(pct(V.p50H, F.p50H), 2)} | ${v === "F" ? "–" : f2(pct(V.p90H, F.p90H), 2)} | ` +
          `${f2(V.beatP50H, 2)} | ${f2(V.motorP50H, 2)} | ${f2(V.nightP50H, 2)} | ` +
          `${V.felleSett.length === 0 ? "∅" : V.felleSett.join(",")} | ${V.algoritmiskeAborter.length} | ` +
          `${mf ? f2(mf.medianDiffH, 4) : "–"} | ${mf ? f2(mf.iqrDiffH, 4) : "–"} | ` +
          `${mf ? f2(mf.maksAvvikNm, 2) : "–"} | ${mf ? `${mf.annenTopologi}/30` : "–"} | ` +
          `${V.sok} | ${V.evalueringer} | ${Math.round(V.ms)} |`,
      );
    }
  }
  console.log(
    `rangering: topp-avgang A=+${fx.rangering.toppAvgang.A}t B=+${fx.rangering.toppAvgang.B}t F=+${fx.rangering.toppAvgang.F}t ` +
      `| samme topp: A=${fx.rangering.sammeToppAvgang.A} B=${fx.rangering.sammeToppAvgang.B} ` +
      `| τ: ${fx.rangering.kendallTau ? `A=${f2(fx.rangering.kendallTau.A, 3)} B=${f2(fx.rangering.kendallTau.B, 3)}` : "n=3, ikke beregnet"}`,
  );
  console.log(
    "P50 per avgang: " +
      ["A", "B", "F"]
        .map((v) => `${v}=[${fx.rangering.p50PerAvgang[v].map((x) => f2(x, 3)).join(", ")}]`)
        .join("  "),
  );
  for (const a of fx.avganger) {
    const b = a.backoffSensitivitet;
    if (Object.keys(b).length > 0) {
      const b0 = (b.backoff0 ?? []).join(",") || "∅";
      const b2 = (b.backoff2 ?? []).join(",") || "∅";
      const b1 = a.varianter.F.felleSett.join(",") || "∅";
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

// Kostnadssammendrag på tvers (deskriptivt).
console.log("\n### Kostnad (sum ms over alle avganger per fikstur)");
console.log("| fikstur | A | B | F | B/F | A/F |");
console.log("|---|---|---|---|---|---|");
for (const fx of s.fiksturer) {
  const sum = (v) => fx.avganger.reduce((acc, a) => acc + a.varianter[v].ms, 0);
  const a = sum("A");
  const b = sum("B");
  const f = sum("F");
  console.log(
    `| ${fx.fikstur} | ${Math.round(a)} | ${Math.round(b)} | ${Math.round(f)} | ${(b / f).toFixed(3)} | ${(a / f).toFixed(3)} |`,
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

console.log("\n\n## Kriterietabell (§4 med §8-erstatninger)\n");
console.log(
  "| fikstur | variant | felle-sett | topp-avgang | τ / flipp | P50 | P90 | gj.f ±1 | alg.abort=0 |",
);
console.log("|---|---|---|---|---|---|---|---|---|");
const brudd = [];
for (const fx of s.fiksturer) {
  const n = fx.avganger.length;
  const fasitP50 = fx.rangering.p50PerAvgang.F;
  for (const v of ["A", "B"]) {
    const felle = fx.avganger.every((a) => a.varianter[v].motFasit.identiskFelleSett);
    const sammeTopp = fx.rangering.sammeToppAvgang[v];
    // Flipp utenfor båndet? Sammenlign parvis orden mot fasiten.
    let flippUtenfor = false;
    const vP50 = fx.rangering.p50PerAvgang[v];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const df = fasitP50[i] - fasitP50[j];
        const dv = vP50[i] - vP50[j];
        if (!Number.isFinite(df) || !Number.isFinite(dv)) continue;
        if (Math.sign(df) === Math.sign(dv) || df === 0) continue;
        const rel = (Math.abs(df) / ((fasitP50[i] + fasitP50[j]) / 2)) * 100;
        if (rel > BAND_PCT) flippUtenfor = true;
      }
    }
    // §6.4: en topp-avgang-flipp diskvalifiserer KUN utenfor toleransebåndet.
    const toppF = fasitP50.indexOf(Math.min(...fasitP50.filter(Number.isFinite)));
    const toppV = vP50.indexOf(Math.min(...vP50.filter(Number.isFinite)));
    const toppFlippUtenfor =
      toppF !== toppV &&
      Number.isFinite(fasitP50[toppF]) &&
      Number.isFinite(fasitP50[toppV]) &&
      (Math.abs(fasitP50[toppF] - fasitP50[toppV]) /
        ((fasitP50[toppF] + fasitP50[toppV]) / 2)) *
        100 >
        BAND_PCT;
    const tau = fx.rangering.kendallTau?.[v] ?? null;
    const p50 = fx.avganger.map((a) =>
      bandVerdict(a.varianter[v].p50H, a.varianter.F.p50H, a.varianter.F.spredningH),
    );
    const p90 = fx.avganger.map((a) =>
      bandVerdict(a.varianter[v].p90H, a.varianter.F.p90H, a.varianter.F.spredningH),
    );
    // «Verst» = største relative avvik, uansett om det bestod eller ikke.
    const verst = (xs) =>
      xs.reduce((w, x) => (x.rel === null ? w : w.rel === null || x.rel > w.rel ? x : w), xs[0]);
    const verstP50 = verst(p50);
    const verstP90 = verst(p90);
    const gjf = fx.avganger.every(
      (a) => Math.abs(a.varianter[v].motFasit.gjennomfoerbarhetsdiff) <= 1,
    );
    const abort = fx.avganger.every(
      (a) => a.varianter[v].algoritmiskeAborter.length === 0,
    );
    const merk = (ok) => (ok === null ? "?" : ok ? "✓" : "✗");
    const rangOk =
      !toppFlippUtenfor && !flippUtenfor && (tau === null || tau >= 0.8);
    console.log(
      `| ${fx.fikstur} | ${v} | ${merk(felle)} | ${sammeTopp ? "✓" : toppFlippUtenfor ? "✗ utenfor bånd" : "~ flipp i bånd"} | ` +
        `${merk(rangOk)} ${tau === null ? "(n=3)" : `τ=${tau.toFixed(2)}`}${flippUtenfor ? " flipp>bånd" : ""} | ` +
        `${merk(p50.every((x) => x.ok !== false))} ${verstP50.tekst} | ` +
        `${merk(p90.every((x) => x.ok !== false))} ${verstP90.tekst} | ` +
        `${merk(gjf)} | ${merk(abort)} |`,
    );
    if (!felle) brudd.push(`${fx.fikstur}/${v}: felle-sett`);
    if (!rangOk) brudd.push(`${fx.fikstur}/${v}: rangering`);
    if (p50.some((x) => x.ok === false)) brudd.push(`${fx.fikstur}/${v}: P50`);
    if (p90.some((x) => x.ok === false)) brudd.push(`${fx.fikstur}/${v}: P90`);
    if (!gjf) brudd.push(`${fx.fikstur}/${v}: gjennomførbarhet`);
    if (!abort) brudd.push(`${fx.fikstur}/${v}: aborter`);
  }
}
console.log("\nBrudd:\n" + brudd.map((b) => "  - " + b).join("\n"));
