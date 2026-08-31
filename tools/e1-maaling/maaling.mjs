/**
 * E1′-matrisen — måleplanens §2/§3, kjørt fra låst ref (se `--ref`).
 *
 * Kjør: `node tools/e1-maaling/maaling.mjs [--ut <mappe>] [--fikstur S-3] ...`
 *
 * Scriptet er **rent og deterministisk**: ingen RNG, ingen klokke i noe som
 * påvirker resultatet (kun `performance.now()` til kostnadskolonnen), ingen
 * nett. Rådata skrives som JSON.
 *
 * ## Variant-isolasjon (§8.2)
 *
 * Ingen avledet tilstand deles på tvers av varianter:
 *  - `field` og `tubBoundS` sendes **aldri** inn i `planRoute` — hvert søk
 *    bygger sitt eget A*-felt og sin egen Tub-bound. Det håndheves av
 *    `assertIsolated` under, som kaster hvis en input har fått dem satt.
 *  - `LabelStore`/`LabelArena`/klaringscachen lever inne i ett `RouteSearch` og
 *    kan per konstruksjon ikke krysse variantgrenser.
 *  - Hver variant får sin **egen fikstur-instans** (`bygg()` kalles på nytt),
 *    slik at heller ikke feltlukkinger deles.
 *
 * Det som *deles* med vilje, er inputen: geometri, maske, båt, medlemsfelt og
 * kandidatruten. Det er forutsetningen for at variantene måles på identisk
 * input (§2), ikke en delingsartefakt.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planRoute } from "../../packages/routing/dist/src/index.js";
import { INTERIM_BAILOUT_HARBOURS } from "../../packages/routing/dist/test-fixtures/bailout-harbours.js";
import {
  E1_TUBE_NM,
  memberOutcome,
  R2_MODE,
  trapVerdict,
} from "../../packages/routing/dist/test-fixtures/e1-outcome.js";
import {
  s1SlorEnsemble,
  s2BeatEnsemble,
  s4BohuslanEnsemble,
} from "../../packages/routing/dist/test-fixtures/ensemble-golden.js";
import { s3FrontEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s3-front.js";
import {
  s5DepartureWindowEnsemble,
  S5_DEPARTURE_OFFSETS_S,
} from "../../packages/routing/dist/test-fixtures/ensemble-s5-departure.js";
import { s7TwoRegimeEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s7-two-regime.js";
import { s8WindAgainstCurrentEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s8-wind-current.js";
import { corridorDeviationNm } from "../../packages/routing/dist/test-fixtures/track-compare.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

// --------------------------------------------------------------- matrisen

const H = 3600;

/** Avgangene per fikstur, som forskyvning fra fiksturens egen avgang (§8.2). */
const MATRIX = [
  { id: "S-1", bygg: s1SlorEnsemble, avganger: [0, 3 * H, 6 * H] },
  { id: "S-2", bygg: s2BeatEnsemble, avganger: [0, 3 * H, 6 * H] },
  { id: "S-3", bygg: s3FrontEnsemble, avganger: [0, 2 * H, 4 * H, 6 * H, 8 * H] },
  { id: "S-4", bygg: s4BohuslanEnsemble, avganger: [0, 3 * H, 6 * H] },
  { id: "S-5", bygg: s5DepartureWindowEnsemble, avganger: S5_DEPARTURE_OFFSETS_S },
  { id: "S-7", bygg: s7TwoRegimeEnsemble, avganger: [0, 3 * H, 6 * H] },
  { id: "S-8", bygg: s8WindAgainstCurrentEnsemble, avganger: [0, 3 * H, 6 * H] },
];

const VARIANTS = ["A", "B", "F"];
/**
 * Variantmekanikken og utfallsklassifiseringen bor i
 * `packages/routing/test-fixtures/e1-outcome.ts`, ikke her: §8.2 krever at
 * abort-typene telles likt i alle tre varianter, og det kravet kan bare
 * bevises hvis tellingen har én implementasjon. Forkravstesten
 * (`src/e1-forkrav.test.ts`) beviser det på nøyaktig denne koden.
 */
const TUBE_NM = E1_TUBE_NM;

// ------------------------------------------------------------- småverktøy

function assertIsolated(input, hvor) {
  if (input.field !== undefined || input.tubBoundS !== undefined) {
    throw new Error(`variant-isolasjon brutt i ${hvor}: delt field/tubBoundS`);
  }
  return input;
}

function kvantil(xs, p) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function median(xs) {
  return kvantil(xs, 0.5);
}

function iqr(xs) {
  if (xs.length === 0) return null;
  return kvantil(xs, 0.75) - kvantil(xs, 0.25);
}

/** Kendall-τ-b på to rangeringer av samme n elementer. */
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

/** Sammendraget skal kunne leses; medlemstabellene bor i per-fikstur-filene. */
function utenTungeFelt(variantResultat) {
  const kopi = { ...variantResultat };
  delete kopi.utfall;
  delete kopi.r2Sok;
  return kopi;
}

function track(result) {
  return result.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
}

/**
 * Utvei-margin (§8.1s deskriptive kolonne): minste avstand til den harde
 * grensen langs fluktruten. Regnes kun når fasiten faktisk fant en utvei.
 */
function utveiMargin(felles, verdict) {
  if (verdict === null || verdict.reachedHarbour === null) return null;
  const havn = INTERIM_BAILOUT_HARBOURS.find(
    (h) => h.name === verdict.reachedHarbour,
  );
  const rute = planRoute(
    assertIsolated(
      {
        start: verdict.from,
        dest: havn.position,
        departEpochS: felles.departEpochS + verdict.fromTS,
        weather: felles.weather,
        mask: felles.mask,
        boat: felles.boat,
        options: {
          ...felles.options,
          maxIterations:
            Math.ceil(6 * 3600 / (felles.options.timeStepS ?? 1800)) + 1,
          requireDaylightArrival: false,
        },
      },
      "utveiMargin",
    ),
  );
  const steg = rute.steps.filter((s) => s.headingDeg !== null);
  if (steg.length === 0) return null;
  return {
    havn: verdict.reachedHarbour,
    timer: rute.totals.durationS / 3600,
    hsMarginM: Math.min(...steg.map((s) => felles.boat.maxHsM - s.hsM)),
    twsMarginKn: Math.min(...steg.map((s) => felles.boat.maxTwsKn - s.twsKn)),
  };
}

// ------------------------------------------------------- én fikstur × avgang

function kjoerAvgang(spec, offsetS) {
  // Kandidatruten: ett fullt Pareto-søk på kontrollfeltet. Den er **input**
  // til alle tre variantene (planen som skal valideres), ikke en delt cache.
  const kontrollFx = spec.bygg();
  const departEpochS = kontrollFx.departEpochS + offsetS;
  const t0Kontroll = performance.now();
  const kontroll = planRoute(
    assertIsolated(
      {
        start: kontrollFx.start,
        dest: kontrollFx.dest,
        departEpochS,
        weather: kontrollFx.control,
        mask: kontrollFx.mask,
        boat: kontrollFx.boat,
        options: kontrollFx.options,
      },
      "kontrollsøk",
    ),
  );
  const kontrollMs = performance.now() - t0Kontroll;
  const route = track(kontroll);

  const resultat = {
    fikstur: spec.id,
    navn: kontrollFx.name,
    offsetH: offsetS / 3600,
    departEpochS,
    kontroll: {
      reached: kontroll.reached,
      naaddeMaal: kontroll.safety.reachesDestination,
      timer: kontroll.totals.durationS / 3600,
      distanceNm: kontroll.totals.distanceNm,
      steg: route.length,
      ms: kontrollMs,
    },
    varianter: {},
    // Deskriptivt: felle-settets følsomhet for backoff (§8.1).
    backoffSensitivitet: {},
    utveiMargin: {},
  };

  const medlemsSpor = {};

  for (const variant of VARIANTS) {
    // Egen fikstur-instans per variant — ingen delte lukkinger.
    const fx = spec.bygg();
    const t0 = performance.now();
    let sok = 0;
    let evalueringer = 0;
    const utfall = {};
    const spor = {};
    const feller = [];
    const hardeFeil = [];
    const r2Sok = {};

    for (const m of fx.members) {
      const felles = {
        route,
        departEpochS,
        weather: m.weather,
        mask: fx.mask,
        boat: fx.boat,
        options: fx.options,
        harbours: INTERIM_BAILOUT_HARBOURS,
        tubeNm: TUBE_NM,
      };

      const ut = memberOutcome(
        assertIsolated(
          { ...felles, variant, start: fx.start, dest: fx.dest },
          `medlemsutfall ${variant}`,
        ),
      );
      sok += ut.sok;
      evalueringer += ut.evalueringer;
      utfall[m.id] = ut;
      spor[m.id] = ut.track;

      // Felle-dommen: felles feildeteksjon, variantens egen re-søksmekanikk.
      const dom = trapVerdict(felles, R2_MODE[variant], 1);
      evalueringer++;
      sok += dom.sok;
      r2Sok[m.id] = dom.sok;
      if (dom.hardFeil) hardeFeil.push(m.id);
      if (dom.felle) feller.push(m.id);

      if (variant === "F") {
        // Deskriptive tilleggskolonner regnes kun på fasiten.
        if (dom.hardFeil) {
          const margin = utveiMargin(felles, dom.verdict);
          if (margin !== null) resultat.utveiMargin[m.id] = margin;
        }
        for (const backoff of [0, 2]) {
          const alt = trapVerdict(felles, "pareto", backoff);
          const key = `backoff${backoff}`;
          resultat.backoffSensitivitet[key] ??= [];
          if (alt.felle) resultat.backoffSensitivitet[key].push(m.id);
        }
      }
    }

    const ms = performance.now() - t0;
    medlemsSpor[variant] = spor;

    const framme = Object.values(utfall).filter((u) => u.gjennomfoerbar);
    const t = framme.map((u) => u.timerH);
    resultat.varianter[variant] = {
      gjennomfoerbare: framme.length,
      medlemmer: fx.members.length,
      algoritmiskeAborter: Object.entries(utfall)
        .filter(([, u]) => u.algoritmiskAbort)
        .map(([id, u]) => `${id}:${u.avbrudd}`),
      avbruddstyper: Object.entries(utfall)
        .filter(([, u]) => !u.gjennomfoerbar)
        .map(([id, u]) => `${id}:${u.avbrudd}`),
      p50H: kvantil(t, 0.5),
      p90H: kvantil(t, 0.9),
      beatP50H: kvantil(framme.map((u) => u.beatH), 0.5),
      beatP90H: kvantil(framme.map((u) => u.beatH), 0.9),
      motorP50H: kvantil(framme.map((u) => u.motorH), 0.5),
      motorP90H: kvantil(framme.map((u) => u.motorH), 0.9),
      nightP50H: kvantil(framme.map((u) => u.nightH), 0.5),
      nightP90H: kvantil(framme.map((u) => u.nightH), 0.9),
      spredningH: t.length > 1 ? kvantil(t, 0.9) - kvantil(t, 0.1) : 0,
      felleSett: feller,
      hardeFeil,
      sok,
      evalueringer,
      r2Sok,
      ms,
      utfall,
    };
  }

  // --- parede per-medlem-differanser og topologi, mot fasiten F
  const fasit = resultat.varianter.F;
  for (const variant of ["A", "B"]) {
    const v = resultat.varianter[variant];
    const diff = [];
    const beatDiff = [];
    const motorDiff = [];
    const nightDiff = [];
    const avvikNm = [];
    let annenTopologi = 0;
    for (const id of Object.keys(fasit.utfall)) {
      const a = v.utfall[id];
      const f = fasit.utfall[id];
      if (a.gjennomfoerbar && f.gjennomfoerbar) {
        diff.push(a.timerH - f.timerH);
        beatDiff.push(a.beatH - f.beatH);
        motorDiff.push(a.motorH - f.motorH);
        nightDiff.push(a.nightH - f.nightH);
      }
      const d = corridorDeviationNm(medlemsSpor[variant][id], medlemsSpor.F[id]);
      avvikNm.push(d);
      if (d > 0.5) annenTopologi++;
    }
    v.motFasit = {
      parede: diff.length,
      medianDiffH: median(diff),
      iqrDiffH: iqr(diff),
      medianBeatDiffH: median(beatDiff),
      medianMotorDiffH: median(motorDiff),
      medianNightDiffH: median(nightDiff),
      identiskFelleSett:
        JSON.stringify([...v.felleSett].sort()) ===
        JSON.stringify([...fasit.felleSett].sort()),
      gjennomfoerbarhetsdiff: v.gjennomfoerbare - fasit.gjennomfoerbare,
      medianAvvikNm: median(avvikNm),
      maksAvvikNm: avvikNm.length === 0 ? null : Math.max(...avvikNm),
      annenTopologi,
    };
  }

  // Utfallstabellen er stor; den beholdes i rådata, men ikke i sammendraget.
  return resultat;
}

// ------------------------------------------------------------------- kjøring

function main() {
  const args = process.argv.slice(2);
  const utIndex = args.indexOf("--ut");
  const utMappe =
    utIndex >= 0
      ? resolve(args[utIndex + 1])
      : join(REPO, "docs/research/maaling-e1-raadata");
  const filter = args.filter((a) => /^S-\d$/.test(a));
  mkdirSync(utMappe, { recursive: true });

  const alle = [];
  for (const spec of MATRIX) {
    if (filter.length > 0 && !filter.includes(spec.id)) continue;
    const perAvgang = [];
    for (const offsetS of spec.avganger) {
      const t0 = performance.now();
      const r = kjoerAvgang(spec, offsetS);
      perAvgang.push(r);
      const f = r.varianter.F;
      console.log(
        `${spec.id} +${(offsetS / 3600).toString().padStart(2)}t  ` +
          `F: ${f.gjennomfoerbare}/${f.medlemmer} P50=${f.p50H?.toFixed(3) ?? "-"} feller=[${f.felleSett}]  ` +
          `A: ${r.varianter.A.gjennomfoerbare}/30 feller=[${r.varianter.A.felleSett}]  ` +
          `B: ${r.varianter.B.gjennomfoerbare}/30 feller=[${r.varianter.B.felleSett}]  ` +
          `(${((performance.now() - t0) / 1000).toFixed(1)} s)`,
      );
    }

    // Avgangsrangering per variant: laveste P50-ankomst vinner (låst før
    // kjøring, se `ensemble-s5-departure.ts`). Avganger uten gjennomførbare
    // medlemmer rangeres sist.
    const rang = {};
    for (const variant of VARIANTS) {
      const verdier = perAvgang.map((r) =>
        r.varianter[variant].p50H === null
          ? Number.POSITIVE_INFINITY
          : r.varianter[variant].p50H,
      );
      const sortert = [...verdier.keys()].sort((i, j) => verdier[i] - verdier[j]);
      const plass = new Array(verdier.length);
      sortert.forEach((idx, plassering) => (plass[idx] = plassering));
      rang[variant] = {
        p50PerAvgang: verdier,
        rangering: plass,
        toppAvgangH: perAvgang[sortert[0]].offsetH,
        alleUgjennomfoerbare: verdier.every((v) => !Number.isFinite(v)),
      };
    }
    const rangering = {
      toppAvgang: Object.fromEntries(
        VARIANTS.map((v) => [v, rang[v].toppAvgangH]),
      ),
      sammeToppAvgang: {
        A: rang.A.toppAvgangH === rang.F.toppAvgangH,
        B: rang.B.toppAvgangH === rang.F.toppAvgangH,
      },
      kendallTau:
        perAvgang.length >= 5
          ? {
              A: kendallTau(rang.A.rangering, rang.F.rangering),
              B: kendallTau(rang.B.rangering, rang.F.rangering),
            }
          : null,
      p50PerAvgang: Object.fromEntries(
        VARIANTS.map((v) => [v, rang[v].p50PerAvgang]),
      ),
      merknad:
        perAvgang.length >= 5
          ? "n=5: Kendall-τ rapportert"
          : "n=3: τ erstattet av «identisk topp-1 + ingen flipp utenfor båndet» (§8.2)",
    };

    alle.push({ fikstur: spec.id, avganger: perAvgang, rangering });
    writeFileSync(
      join(utMappe, `${spec.id.toLowerCase()}.json`),
      JSON.stringify({ fikstur: spec.id, avganger: perAvgang, rangering }, null, 1),
    );
  }

  writeFileSync(
    join(utMappe, "sammendrag.json"),
    JSON.stringify(
      {
        beskrivelse:
          "E1′-matrisen. Se docs/research/maaling-e1-2026-08-31.md og måleplanens §3/§4.",
        varianter: VARIANTS,
        r2Mekanikk: R2_MODE,
        tubeNm: TUBE_NM,
        fiksturer: alle.map((f) => ({
          fikstur: f.fikstur,
          rangering: f.rangering,
          avganger: f.avganger.map((a) => ({
            offsetH: a.offsetH,
            kontroll: a.kontroll,
            backoffSensitivitet: a.backoffSensitivitet,
            utveiMargin: a.utveiMargin,
            varianter: Object.fromEntries(
              VARIANTS.map((v) => [v, utenTungeFelt(a.varianter[v])]),
            ),
          })),
        })),
      },
      null,
      1,
    ),
  );
  console.log(`\nRådata skrevet til ${utMappe}`);
}

main();
