/**
 * Genererer markdown-tabellene til `docs/research/kvantiseringsmaaling-2026-09-01.md`
 * fra rådataene i `docs/research/kvantisering-raadata/`.
 *
 * Tabellene skrives av maskin og limes inn i rapporten, slik at ingen tall i
 * rapporten er skrevet av for hånd. Kjør:
 *   node tools/kvantisering/tabeller.mjs [--inn <mappe>] > tabeller.txt
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

const args = process.argv.slice(2);
const i = args.indexOf("--inn");
const INN = resolve(
  i >= 0 ? args[i + 1] : join(REPO, "docs/research/kvantisering-raadata"),
);

const les = (n) =>
  existsSync(join(INN, n)) ? JSON.parse(readFileSync(join(INN, n), "utf8")) : null;

const pst = (x) =>
  x === null || x === undefined || !Number.isFinite(x)
    ? "—"
    : `${(x * 100).toFixed(2)} %`;
const nm = (x) =>
  x === null || x === undefined ? "—" : `${x.toFixed(3)}`;
const num = (x, d = 3) =>
  x === null || x === undefined ? "—" : x.toFixed(d);

const meta = les("meta.json");
const KONFIG = new Map((meta?.konfigurasjoner ?? []).map((k) => [k.id, k]));
const REKKEFOLGE = (meta?.konfigurasjoner ?? []).map((k) => k.id);

// ------------------------------------------------------------------ P1

const p1 = les("p1-rutediff.json");
if (p1 !== null) {
  const ANKOMST = (r) => r.motRef.ankomstScenario === true;
  console.log("## P1a — ruteeffekt per konfigurasjon (aggregert over alle scenarioer)\n");
  console.log(
    "Δt og korridor gjelder **ankomstscenarioene**; `uoppnaelig-mal` og " +
      "`hull-i-vaerfeltet` ender per konstruksjon ikke i målet, og «tid» er " +
      "der hvor langt beste delrute rakk — de er derfor holdt utenfor " +
      "prosenttallene og vurdert på de diskrete feltene alene.\n",
  );
  console.log(
    "| konfig | akse | maks \\|Δt\\| | maks korridor (nm) | maks anger | maks optimisme | plan feiler under sannhet | diskrete endringer | N5-brudd |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const id of REKKEFOLGE) {
    const alle = p1.rader.filter((r) => r.konfig === id);
    if (alle.length === 0) continue;
    const rader = alle.filter(ANKOMST);
    const maxT = Math.max(...rader.map((r) => Math.abs(r.motRef.dTidRel)));
    const maxK = Math.max(...rader.map((r) => r.motRef.korridorNm ?? 0));
    // Anger og optimisme regnes KUN på ankomstscenarioene: på et scenario som
    // per konstruksjon ikke ender i målet, sammenligner «tid» to delruter med
    // hvert sitt endepunkt, og prosenten måler ingenting.
    const anger = rader
      .map((r) => r.motRef.angerRel)
      .filter((x) => x !== null && x !== undefined);
    const maxA = anger.length === 0 ? null : Math.max(...anger);
    const opt = rader.map((r) => r.optimismeRel).filter((x) => Number.isFinite(x));
    const maxO = opt.length === 0 ? null : Math.max(...opt);
    const mister = alle
      .filter((r) => r.motRef.angerMistetGjennomfoerbarhet)
      .map((r) => r.scenario);
    const diskret = alle.filter((r) => !r.motRef.eksaktLik).map((r) => r.scenario);
    const brudd = rader.filter((r) => !r.motRef.n5Ok).map((r) => r.scenario);
    console.log(
      `| \`${id}\` | ${KONFIG.get(id)?.akse ?? ""} | ${pst(maxT)} | ${nm(maxK)} | ` +
        `${pst(maxA)} | ${pst(maxO)} | ` +
        `${mister.length === 0 ? "—" : `**${mister.join(", ")}**`} | ` +
        `${diskret.length === 0 ? "ingen" : `**${diskret.join(", ")}**`} | ` +
        `${brudd.length === 0 ? "ingen" : brudd.join(", ")} |`,
    );
  }

  console.log("\n### P1b — feltnær diagnose (kontekstkolonne, ikke beslutningsgrunnlag)\n");
  console.log(
    "| konfig | maks TWS-feil (kn) | RMS TWS (kn) | maks retn.feil (°) | maks Hs-feil (m) | verste Hs for lav (m) | maks strømfeil (kn) | TWS over deklarert skranke |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  for (const id of REKKEFOLGE) {
    const s = p1.rader
      .filter((r) => r.konfig === id)
      .map((r) => r.feltsonde)
      .filter((x) => x !== null && x !== undefined);
    if (s.length === 0) continue;
    const m = (f) => Math.max(...s.map(f));
    const mn = (f) => Math.min(...s.map(f));
    console.log(
      `| \`${id}\` | ${num(m((x) => x.maxTwsErrKn), 2)} | ${num(m((x) => x.rmsTwsErrKn), 3)} | ` +
        `${num(m((x) => x.maxDirErrDeg), 2)} | ${num(m((x) => x.maxHsErrM), 3)} | ` +
        `${num(mn((x) => x.worstHsUnderM), 3)} | ${num(m((x) => x.maxCurrentErrKn), 3)} | ` +
        `${s.reduce((a, x) => a + x.twsOverDeclared, 0)} punkter, maks +${num(m((x) => x.maxTwsOverKn), 2)} kn |`,
    );
  }

  console.log(
    "\n#### Feltsonde kun på frontfeltet (`s3-front-kontroll`) — der tidsaksen biter\n",
  );
  console.log("| konfig | maks TWS-feil (kn) | RMS TWS (kn) | maks retn.feil (°) | maks Hs-feil (m) |");
  console.log("|---|---|---|---|---|");
  for (const id of REKKEFOLGE) {
    const r = p1.rader.find(
      (x) => x.konfig === id && x.scenario === "s3-front-kontroll",
    );
    if (r === undefined || r.feltsonde === null || r.feltsonde === undefined) continue;
    const s = r.feltsonde;
    console.log(
      `| \`${id}\` | ${num(s.maxTwsErrKn, 2)} | ${num(s.rmsTwsErrKn, 3)} | ${num(s.maxDirErrDeg, 2)} | ${num(s.maxHsErrM, 3)} |`,
    );
  }

  console.log("\n### P1c — verste konfigurasjon per scenario\n");
  console.log(
    "| scenario | kilde | kommer fram | REF-tid (t) | verste Δt (konfig) | verste korridor (konfig) | verste anger (konfig) |",
  );
  console.log("|---|---|---|---|---|---|---|");
  for (const sc of p1.scenarioer) {
    const rader = p1.rader.filter((r) => r.scenario === sc.id && r.konfig !== "REF");
    if (rader.length === 0) continue;
    const ref = p1.rader.find((r) => r.scenario === sc.id && r.konfig === "REF");
    const vt = rader.reduce((a, b) =>
      Math.abs(a.motRef.dTidRel) >= Math.abs(b.motRef.dTidRel) ? a : b,
    );
    const vk = rader.reduce((a, b) =>
      (a.motRef.korridorNm ?? 0) >= (b.motRef.korridorNm ?? 0) ? a : b,
    );
    const medAnger = rader.filter((r) => r.motRef.angerRel !== null);
    const va =
      medAnger.length === 0
        ? null
        : medAnger.reduce((a, b) => (a.motRef.angerRel >= b.motRef.angerRel ? a : b));
    console.log(
      `| ${sc.id} | ${sc.kilde} | ${ref.eksakt.reachesDestination ? "ja" : "nei"} | ${num(ref.timer)} | ` +
        `${pst(vt.motRef.dTidRel)} (\`${vt.konfig}\`) | ` +
        `${nm(vk.motRef.korridorNm)} (\`${vk.konfig}\`) | ` +
        `${va === null ? "—" : `${pst(va.motRef.angerRel)} (\`${va.konfig}\`)`} |`,
    );
  }

  console.log("\n### P1d — rader med diskret endring, tapt gjennomførbarhet, eller anger > 1 %\n");
  console.log("| scenario | konfig | Δt | korridor (nm) | anger | optimisme | diskret endring |");
  console.log("|---|---|---|---|---|---|---|");
  const ref = new Map(
    p1.rader.filter((r) => r.konfig === "REF").map((r) => [r.scenario, r]),
  );
  for (const r of p1.rader) {
    const alvorlig =
      !r.motRef.eksaktLik ||
      r.motRef.angerMistetGjennomfoerbarhet ||
      (r.motRef.angerRel !== null && Math.abs(r.motRef.angerRel) > 0.01) ||
      Math.abs(r.optimismeRel) > 0.02;
    if (!alvorlig) continue;
    const rf = ref.get(r.scenario);
    const endret = [];
    for (const [k, v] of Object.entries(r.eksakt)) {
      if (JSON.stringify(v) !== JSON.stringify(rf.eksakt[k])) {
        endret.push(`${k}: ${JSON.stringify(rf.eksakt[k])} → ${JSON.stringify(v)}`);
      }
    }
    if (r.motRef.angerMistetGjennomfoerbarhet) {
      endret.push(
        `**planen holder ikke under sannheten**: ${r.underSannhet.avvisning?.kind} @ ${num(r.underSannhet.avvisning?.tH, 2)} t`,
      );
    }
    console.log(
      `| ${r.scenario} | \`${r.konfig}\` | ${pst(r.motRef.dTidRel)} | ${nm(r.motRef.korridorNm)} | ` +
        `${pst(r.motRef.angerRel)} | ${pst(r.optimismeRel)} | ` +
        `${endret.length === 0 ? "—" : endret.join("; ")} |`,
    );
  }
}

// ------------------------------------------------- P1e: vaktbånd og bitbredde

/**
 * **Vaktbånd-tabellen** (tillegg §9.2, fast fysisk LSB).
 *
 * Kolonnene her er *ikke* feltsonden i P1b: de måler pakken mot en pakke med
 * identisk grid, flisgeometri og tidsnett, men Float32 vind. Differansen er
 * dermed ren kvantiseringsfeil — den eneste størrelsen `maxDecodeErrorKn`
 * påstår noe om (§9.5). «Innenfor» er kriteriet: vaktbåndet skal være en
 * skranke over den målte feilen i alle scenarioer, ellers er båndet feil.
 */
if (p1 !== null) {
  const medBand = REKKEFOLGE.filter((id) =>
    p1.rader.some((r) => r.konfig === id && r.vaktband !== null && r.vaktband !== undefined),
  );
  if (medBand.length > 0) {
    console.log(
      "\n### P1e — vaktbånd mot målt kvantiseringsfeil (ren, uten grid-/tidsfeil)\n",
    );
    console.log(
      "| konfig | LSB (kn) | vaktbånd (kn) | maks målt kvant.feil (kn) | RMS (kn) | innenfor båndet | maks over deklarert maks (kn) | fanget av båndet | klippede koder |",
    );
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const id of medBand) {
      const v = p1.rader
        .filter((r) => r.konfig === id && r.vaktband)
        .map((r) => r.vaktband);
      const m = (f) => Math.max(...v.map(f));
      const klipp = v.reduce((a, x) => a + (x.klippedeKoder ?? 0), 0);
      console.log(
        `| \`${id}\` | ${v[0].lsbKn === null ? "—" : num(v[0].lsbKn, 2)} | ${num(m((x) => x.bandKn), 4)} | ` +
          `${num(m((x) => x.maksKvantiseringsfeilKn), 4)} | ${num(m((x) => x.rmsKvantiseringsfeilKn), 4)} | ` +
          `${v.every((x) => x.innenfor) ? "ja" : "**NEI**"} | ${num(m((x) => x.maksOverDeklarertKn), 4)} | ` +
          `${v.every((x) => x.overDeklarertFanget) ? "ja" : "**NEI**"} | ${klipp === 0 ? "0" : `**${klipp}**`} |`,
      );
    }

    const medLsb = medBand.filter((id) =>
      p1.rader.some((r) => r.konfig === id && r.vaktband && r.vaktband.lsbKn !== null),
    );
    if (medLsb.length > 0) {
      console.log(
        "\n### P1f — fast LSB: bitbredden er en konsekvens, ikke et valg\n",
      );
      console.log(
        "| konfig | LSB (kn) | maks kodespenn i én flis+skive | bit m/flis-offset | maks \\|kode\\| | bit u/offset (realisert) | bit u/offset (deklarert område) |",
      );
      console.log("|---|---|---|---|---|---|---|");
      for (const id of medLsb) {
        const v = p1.rader
          .filter((r) => r.konfig === id && r.vaktband && r.vaktband.lsbKn !== null)
          .map((r) => r.vaktband);
        const m = (f) => Math.max(...v.map(f));
        console.log(
          `| \`${id}\` | ${num(v[0].lsbKn, 2)} | ${m((x) => x.spennKoder)} | ${m((x) => x.bitMedFlisOffset)} | ` +
            `${m((x) => x.absKode)} | ${m((x) => x.bitUtenOffsetRealisert)} | ${m((x) => x.bitUtenOffsetDeklarert)} |`,
        );
      }
    }
  }
}

// ------------------------------------------------------------------ P2

for (const [fil, tittel] of [
  ["p2-rangering-billig.json", "P2a — avgangsrangering S-5 (billig: kontrollsøk + evaluering)"],
  ["p2-rangering-fulle-sok.json", "P2b — avgangsrangering S-5 (fulle Pareto-søk per medlem)"],
]) {
  const p2 = les(fil);
  if (p2 === null) continue;
  console.log(`\n## ${tittel}\n`);
  console.log(
    "| konfig | akse | P50 per avgang (t) | topp-avgang | topp lik REF | inversjoner P50 | inversjoner P90 | maks ΔP50 | maks ΔP90 | gj.førbarhetsdiff |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const id of REKKEFOLGE) {
    const r = p2.perKonfig[id];
    if (r === undefined) continue;
    console.log(
      `| \`${id}\` | ${r.akse} | ${r.p50.map((x) => num(x)).join(" / ")} | ` +
        `+${r.motRef.toppAvgangH} t | ${id === "REF" ? "(ref)" : r.motRef.sammeTopp ? "ja" : "**NEI**"} | ` +
        `${r.motRef.inversjonerP50} | ${r.motRef.inversjonerP90} | ` +
        `${pst(r.motRef.maksDP50Rel)} | ${pst(r.motRef.maksDP90Rel)} | ` +
        `${r.motRef.gjennomfoerbarhetsdiff.join(",")} |`,
    );
  }
}

// ------------------------------------------------------------------ P3

const p3 = les("p3-flips.json");
if (p3 !== null) {
  console.log("\n## P3 — gjennomførbarhets- og felle-flips\n");
  console.log(
    "| konfig | akse | fast rute: gj.f.diff | fast: hardfeil lik REF | flippede medlemmer | felle-sett lik REF | egen rute: gj.f.diff | egen: maks Δt | egen: maks korridor (nm) |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const id of REKKEFOLGE) {
    const celler = p3
      .map((a) => ({ a, p: a.perKonfig[id] }))
      .filter((x) => x.p !== undefined);
    if (celler.length === 0) continue;
    const gjDiff = celler.map((c) => c.p.motRef.fastGjennomfoerbarhetsdiff);
    const flippet = [];
    for (const { a, p } of celler) {
      if (p.motRef.fastSammeHardFeil) continue;
      const refH = new Set(a.perKonfig["REF"].fast.hardFeil);
      const her = new Set(p.fast.hardFeil);
      const nye = [...her].filter((m) => !refH.has(m)).map((m) => `+${m}`);
      const tapte = [...refH].filter((m) => !her.has(m)).map((m) => `−${m}`);
      flippet.push(`${a.fikstur}+${a.offsetH}t: ${[...nye, ...tapte].join(" ")}`);
    }
    const fs = celler.map((c) => c.p.motRef.sammeFelleSett);
    const felleTekst = fs.every((x) => x === null)
      ? "(ikke kjørt)"
      : fs.some((x) => x === false)
        ? "**NEI**"
        : id === "REF"
          ? "(ref)"
          : "ja";
    console.log(
      `| \`${id}\` | ${celler[0].p.akse} | ${Math.min(...gjDiff)} … ${Math.max(...gjDiff)} | ` +
        `${celler.every((c) => c.p.motRef.fastSammeHardFeil) ? "ja" : "**NEI**"} | ` +
        `${flippet.length === 0 ? "—" : flippet.join("; ")} | ${felleTekst} | ` +
        `${Math.min(...celler.map((c) => c.p.motRef.egenGjennomfoerbarhetsdiff))} … ${Math.max(...celler.map((c) => c.p.motRef.egenGjennomfoerbarhetsdiff))} | ` +
        `${pst(Math.max(...celler.map((c) => Math.abs(c.p.motRef.dTidEgenRel))))} | ` +
        `${nm(Math.max(...celler.map((c) => c.p.egen.korridorMotRefNm ?? 0)))} |`,
    );
  }

  console.log("\n### P3 — felle-sett per avgang (kjørte konfigurasjoner)\n");
  console.log("| fikstur | avgang | konfig | hardfeil (fast rute) | felle-sett (R2 pareto) |");
  console.log("|---|---|---|---|---|");
  for (const a of p3) {
    for (const id of REKKEFOLGE) {
      const p = a.perKonfig[id];
      if (p === undefined || p.felleSett === null) continue;
      console.log(
        `| ${a.fikstur} | +${a.offsetH} t | \`${id}\` | [${p.fast.hardFeil.join(", ")}] | [${p.felleSett.join(", ")}] |`,
      );
    }
  }

  console.log("\n### P3 — avvisningsårsaker der de flyttet seg\n");
  console.log("| fikstur | avgang | konfig | medlem | REF | konfig |");
  console.log("|---|---|---|---|---|---|");
  for (const a of p3) {
    const ref = a.perKonfig["REF"];
    for (const id of REKKEFOLGE) {
      if (id === "REF") continue;
      const p = a.perKonfig[id];
      if (p === undefined || p.motRef.fastSammeHardFeil) continue;
      const alle = new Set([
        ...Object.keys(ref.fast.avvisning),
        ...Object.keys(p.fast.avvisning),
      ]);
      for (const m of [...alle].sort()) {
        const r = ref.fast.avvisning[m];
        const q = p.fast.avvisning[m];
        if (JSON.stringify(r) === JSON.stringify(q)) continue;
        console.log(
          `| ${a.fikstur} | +${a.offsetH} t | \`${id}\` | ${m} | ` +
            `${r === undefined ? "ingen" : `${r.kind} @ ${r.tH.toFixed(2)} t`} | ` +
            `${q === undefined ? "ingen" : `${q.kind} @ ${q.tH.toFixed(2)} t`} |`,
        );
      }
    }
  }
}

// ------------------------------------------------------- kostnad (kontekst)

if (p1 !== null) {
  console.log("\n## Dekodekostnad (deterministiske tellere, P1 summert)\n");
  console.log("| konfig | gridnoder samplet | fliser bygget | feltoppslag |");
  console.log("|---|---|---|---|");
  for (const id of REKKEFOLGE) {
    const rader = p1.rader.filter((r) => r.konfig === id);
    if (rader.length === 0) continue;
    const s = (f) => rader.reduce((a, r) => a + f(r.telling), 0);
    console.log(
      `| \`${id}\` | ${s((t) => t.baseSamples)} | ${s((t) => t.fliser)} | ${s((t) => t.oppslag)} |`,
    );
  }
}
