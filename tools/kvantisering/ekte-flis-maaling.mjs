/**
 * **Kvantiseringsharnessen på EKTE fliser** — §14-tillegget til
 * `docs/research/kvantiseringsmaaling-2026-09-01.md` (D7.5 vilkår vi).
 *
 * Kjør:
 *   node --max-old-space-size=6000 tools/kvantisering/ekte-flis-maaling.mjs \
 *     [--flis *] [--del feltprove,p3,rangering] [--konfig ...] \
 *     [--medlemmer 30] [--avganger 0,6,12] [--tws-grense 22] [--ut <mappe>]
 *
 * ## Hvorfor denne finnes
 *
 * §13 (kriterierevisjonen) slo fast at harnessen til nå kun har kjørt på
 * syntetiske/golden-felt, der verste målte flisspenn er **21,7 kn**. Dagens
 * format utleder trinnet av spennet, så både kvantiseringsfeilen og
 * vaktbåndet er funksjoner av data harnessen aldri har sett. Her er
 * referansefeltet i stedet den **ekte, dekodede MEPS-pakken**
 * (`tools/kvantisering/ekte-flis.mjs`), re-kvantisert i den samme
 * pakkemodellen (`pack-degradation.ts`) — samme instrument, ekte spenn.
 *
 * ## De beslutningsdyktige kriteriene (§13), og bare de
 *
 *  - **feltprøve/P1e (søkefri).** Pakken måles mot en pakke med *nøyaktig
 *    samme grid, flisgeometri og tidsnett, men Float32 vind*. Differansen er
 *    da ren kvantiseringsfeil, uten grid- og tidsfeil blandet inn, og
 *    spørsmålet «er `maxDecodeErrorKn` en gyldig skranke på ekte spenn?» blir
 *    målbart. Kriterier: maks målt feil ≤ båndet, alle overskridelser av
 *    feltets deklarerte maksvind ≤ båndet, **null klipping**.
 *  - **P3 flips.** Ekte 30-medlems ensemble, ekte vind, TWS-drevne harde
 *    forkastelser. Kriterier: null *tapte* harde forkastelser (den farlige
 *    retningen), null felle-flips, null gjennomførbarhetsflips.
 *  - **Rangering** rapporteres **deskriptivt** med uavgjort-bånd = søkets egen
 *    ~6 % rutevalgsstøy (§11.1, §13). Den avgjør ingenting her.
 *
 * ## To ting denne målingen IKKE kan gjøre
 *
 * 1. Den ekte pakken bærer **kun vind** — ingen strøm, ingen bølge
 *    (`build-report.json` §`missingFields`). Harde forkastelser er derfor
 *    TWS-drevne, ikke Hs-drevne. Det er den rette mekanismen når det er
 *    vindkvantiseringen som måles, men Hs-radene i §10 får ingen ny støtte
 *    herfra.
 * 2. Referansen er selv 8-bit fra produsenten. Vi måler *re*-kvantisering.
 *
 * Rent og deterministisk som resten av harnessen: ingen RNG, ingen nett,
 * ingen klokke i noe som havner i rådataene. Eneste I/O er **lesing** av den
 * ferdigbygde pakken under `tools/weather-pack/out/`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const fx = (p) => pathToFileURL(join(REPO, p)).href;

const {
  evaluateRoute,
  isHardRejection,
  planRoute,
} = await import(fx("packages/routing/dist/src/index.js"));
const { INTERIM_BAILOUT_HARBOURS } = await import(
  fx("packages/routing/dist/test-fixtures/bailout-harbours.js")
);
const { trapVerdict } = await import(
  fx("packages/routing/dist/test-fixtures/e1-outcome.js")
);
const { SKAGEN, SKAGERRAK_LAND, SKJAELOY } = await import(
  fx("packages/routing/dist/test-fixtures/golden-scenarios.js")
);
const {
  bitsForCodes,
  FLOAT32,
  packField,
  probePack,
  withPack,
} = await import(fx("packages/routing/dist/test-fixtures/pack-degradation.js"));
const { rectMask } = await import(
  fx("packages/routing/dist/test-fixtures/synthetic-mask.js")
);
const { testBoat } = await import(
  fx("packages/routing/dist/test-fixtures/test-boat.js")
);
const { corridorDeviationNm } = await import(
  fx("packages/routing/dist/test-fixtures/track-compare.js")
);
const { byggEkteFelt, ekteDomene, lastFlis, lesByggrapport, lesPeker } =
  await import(fx("tools/kvantisering/ekte-flis.mjs"));
const { KONFIGURASJONER, EKTE_FLIS_KONFIG } = await import(
  fx("tools/kvantisering/konfigurasjoner.mjs")
);

const H = 3600;

/**
 * Skjeve sondetimer — samme begrunnelse som hovedharnessen: hele timer
 * treffer tidsskivene eksakt og gjør interpolasjonsfeilen usynlig.
 */
const SONDE_TIMER = [0.37, 2.13, 4.71, 7.29, 9.83, 12.41, 15.07, 17.63];

/** Uavgjort-båndet for rangering (§13): søkets egen rutevalgsstøy. */
const UAVGJORT_BAND = 0.06;

// ------------------------------------------------------------------ verktøy

function kvantil(xs, p) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function relDiff(a, b) {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return (a - b) / b;
}

function rangeringAv(verdier) {
  const idx = [...verdier.keys()].sort((i, j) => {
    const a = verdier[i] === null ? Infinity : verdier[i];
    const b = verdier[j] === null ? Infinity : verdier[j];
    return a - b || i - j;
  });
  const plass = new Array(verdier.length);
  idx.forEach((i, p) => (plass[i] = p));
  return plass;
}

function inversjoner(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      if (Math.sign(a[i] - a[j]) !== Math.sign(b[i] - b[j])) n++;
    }
  }
  return n;
}

function spor(result) {
  return result.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
}

const settLik = (a, b) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Elementer i `a` som mangler i `b`. */
const mangler = (a, b) => [...a].filter((x) => !b.includes(x)).sort();

// -------------------------------------------- del 1: feltprøve/P1e (søkefri)

/**
 * Den søkefrie prøven, per medlem, aggregert over medlemmene.
 *
 * To probes, og forskjellen mellom dem er hele poenget:
 *  - **rein** = pakken mot en identisk pakke med Float32 vind ⇒ *bare*
 *    kvantiseringsfeil ⇒ det vaktbåndet faktisk er en skranke på (P1e).
 *  - **total** = pakken mot det ekte dekodede feltet ⇒ kvantisering + grid-
 *    og tidsomsampling ⇒ deskriptiv kontekst, aldri et vaktbåndskriterium.
 */
function feltprove(konfigurasjoner, felt, domene, departEpochS) {
  const ut = { departEpochS, sondeTimer: SONDE_TIMER, perKonfig: {} };
  for (const k of konfigurasjoner) {
    const agg = {
      akse: k.akse,
      note: k.spec === null ? k.note : k.spec.note,
      medlemmer: 0,
      bandKn: 0,
      lsbKn: k.spec === null ? null : (k.spec.windQuant.lsb ?? null),
      // P1e — ren kvantisering
      maksKvantiseringsfeilKn: 0,
      rmsKvantiseringsfeilKn: 0,
      innenforBand: true,
      versteBandmarginKn: Infinity,
      maksOverDeklarertKn: 0,
      antallOverDeklarert: 0,
      overDeklarertFanget: true,
      // total (deskriptiv)
      maksTotalfeilKn: 0,
      rmsTotalfeilKn: 0,
      maksRetningsfeilDeg: 0,
      dekningstap: 0,
      // format-regnskap
      klippedeKoder: 0,
      spennKoder: 0,
      absKode: 0,
      adaptivtSpennKn: 0,
      adaptivtTrinnKn: 0,
      deklarertMaksTwsKn: 0,
      sondepunkter: 0,
    };
    let sumRein = 0;
    let sumTotal = 0;
    let n = 0;

    for (const base of felt) {
      const pakke =
        k.spec === null
          ? { field: base, stats: null }
          : packField(base, k.spec, domene);
      agg.medlemmer++;
      agg.deklarertMaksTwsKn = Math.max(agg.deklarertMaksTwsKn, base.maxTwsKn);

      const total = probePack(base, pakke.field, domene, departEpochS, SONDE_TIMER);
      agg.maksTotalfeilKn = Math.max(agg.maksTotalfeilKn, total.maxTwsErrKn);
      agg.maksRetningsfeilDeg = Math.max(
        agg.maksRetningsfeilDeg,
        total.maxDirErrDeg,
      );
      agg.dekningstap += total.coverageLoss;
      sumTotal += total.rmsTwsErrKn ** 2 * total.samples;
      n += total.samples;
      agg.sondepunkter += total.samples;

      if (k.spec !== null && k.spec.windQuant !== FLOAT32) {
        const reinSpec = withPack(
          `${k.id}-F32VIND`,
          "samme pakke, men Float32 vind — instrument, ikke konfigurasjon",
          { ...k.spec, windQuant: FLOAT32, dirQuant: FLOAT32 },
        );
        const rein = packField(base, reinSpec, domene);
        const pr = probePack(
          rein.field,
          pakke.field,
          domene,
          departEpochS,
          SONDE_TIMER,
        );
        const band = pakke.field.maxDecodeErrorKn;
        agg.bandKn = Math.max(agg.bandKn, band);
        agg.maksKvantiseringsfeilKn = Math.max(
          agg.maksKvantiseringsfeilKn,
          pr.maxTwsErrKn,
        );
        sumRein += pr.rmsTwsErrKn ** 2 * pr.samples;
        agg.versteBandmarginKn = Math.min(
          agg.versteBandmarginKn,
          band - pr.maxTwsErrKn,
        );
        if (pr.maxTwsErrKn > band) agg.innenforBand = false;
        agg.maksOverDeklarertKn = Math.max(
          agg.maksOverDeklarertKn,
          pr.maxTwsOverKn,
        );
        agg.antallOverDeklarert += pr.twsOverDeclared;
        if (pr.maxTwsOverKn > band) agg.overDeklarertFanget = false;
      }
      if (pakke.stats !== null) {
        agg.klippedeKoder += pakke.stats.fixedLsbClamped;
        agg.spennKoder = Math.max(agg.spennKoder, pakke.stats.fixedLsbMaxSpanCodes);
        agg.absKode = Math.max(agg.absKode, pakke.stats.fixedLsbMaxAbsCode);
        agg.adaptivtSpennKn = Math.max(
          agg.adaptivtSpennKn,
          pakke.stats.adaptiveMaxSpan,
        );
        agg.adaptivtTrinnKn = Math.max(
          agg.adaptivtTrinnKn,
          pakke.stats.adaptiveMaxStep,
        );
      }
    }

    agg.rmsKvantiseringsfeilKn = n === 0 ? 0 : Math.sqrt(sumRein / n);
    agg.rmsTotalfeilKn = n === 0 ? 0 : Math.sqrt(sumTotal / n);
    if (agg.versteBandmarginKn === Infinity) agg.versteBandmarginKn = null;
    if (agg.lsbKn !== null) {
      agg.bitMedFlisOffset = bitsForCodes(agg.spennKoder);
      agg.bitUtenOffsetRealisert = bitsForCodes(2 * agg.absKode);
      agg.bitUtenOffsetDeklarert = bitsForCodes(
        2 * Math.round(agg.deklarertMaksTwsKn / agg.lsbKn),
      );
      agg.dekkerVedLsb8bit = 255 * agg.lsbKn;
    }
    ut.perKonfig[k.id] = agg;
    console.log(
      `FELT ${k.id.padEnd(11)} bånd=${agg.bandKn.toFixed(4)} kn  ` +
        `maks kvant=${agg.maksKvantiseringsfeilKn.toFixed(4)}  ` +
        `margin=${agg.versteBandmarginKn === null ? "-" : agg.versteBandmarginKn.toFixed(4)}  ` +
        `over-dekl=${agg.maksOverDeklarertKn.toFixed(4)} (${agg.antallOverDeklarert})  ` +
        `klippet=${agg.klippedeKoder}  ` +
        `total=${agg.maksTotalfeilKn.toFixed(4)}  ` +
        `${agg.innenforBand && agg.overDeklarertFanget && agg.klippedeKoder === 0 ? "ok" : "BRUDD"}`,
    );
  }
  return ut;
}

// --------------------------------------------------------- del 2: P3 (flips)

/**
 * Ensemblet er ekte: 30 MEPS-medlemmer for samme flis(er) og init.
 * Strekket er `SKJAELOY → SKAGEN` — det samme v1 brukte, og det pakken
 * faktisk ble bygget for (`build-report.json`s kontrollkryss).
 *
 * **Båtens TWS-grense er en måleparameter, ikke en båtegenskap.** Med
 * standardgrensen (35 kn) forkaster ingen medlemmer noe i dette værbildet, og
 * P3 måler da ingenting. Grensen legges derfor der den *biter* — midt i
 * fordelingen av ekte maksvind langs korridoren — slik at et halvt
 * kvantiseringstrinn faktisk kan flytte en forkastelse. Det er hele poenget
 * med kriteriet «null tapte harde forkastelser».
 */
function p3(konfigurasjoner, felt, domene, avganger, twsGrenseKn) {
  const boat = testBoat({ ignoreWaves: true, maxTwsKn: twsGrenseKn });
  const mask = rectMask({ noGo: SKAGERRAK_LAND });
  const ut = [];

  for (const offsetS of avganger) {
    const departEpochS = felt[0].validFromS + H + offsetS;
    // REF-ruten alle «fast rute»-kolonnene måles på: kontrollmedlemmet,
    // pakket med REF (Float32) — samme rolle som i hovedharnessen.
    const refKonfig = konfigurasjoner.find((k) => k.id === "REF");
    const refKontroll =
      refKonfig.spec === null
        ? { field: felt[0] }
        : packField(felt[0], refKonfig.spec, domene);
    const refRute = spor(
      planRoute({
        start: SKJAELOY,
        dest: SKAGEN,
        departEpochS,
        weather: refKontroll.field,
        mask,
        boat,
      }),
    );

    const perKonfig = {};
    for (const k of konfigurasjoner) {
      const pakkede = felt.map((f, i) => ({
        id: `m${String(i).padStart(2, "0")}`,
        field: k.spec === null ? f : packField(f, k.spec, domene).field,
      }));

      // (a) fast rute — kun feltverdiene degradert.
      const fast = { gjennomfoerbare: 0, hardFeil: [], avvisning: {} };
      for (const m of pakkede) {
        const e = evaluateRoute({
          waypoints: refRute,
          departEpochS,
          weather: m.field,
          mask,
          boat,
        });
        if (e.feasible) fast.gjennomfoerbare++;
        if (e.rejection !== null) {
          fast.avvisning[m.id] = {
            kind: e.rejection.kind,
            reason: e.rejection.reason,
            tH: e.rejection.tS / 3600,
            hard: isHardRejection(e.rejection),
          };
        }
        if (isHardRejection(e.rejection)) fast.hardFeil.push(m.id);
      }

      // (b) egen rute — hele kjeden degradert, som i produksjon.
      const kontrollFelt = pakkede[0].field;
      const egenRes = planRoute({
        start: SKJAELOY,
        dest: SKAGEN,
        departEpochS,
        weather: kontrollFelt,
        mask,
        boat,
      });
      const egenRute = spor(egenRes);
      const egen = { gjennomfoerbare: 0, hardFeil: [] };
      for (const m of pakkede) {
        const e = evaluateRoute({
          waypoints: egenRute,
          departEpochS,
          weather: m.field,
          mask,
          boat,
        });
        if (e.feasible) egen.gjennomfoerbare++;
        if (isHardRejection(e.rejection)) egen.hardFeil.push(m.id);
      }

      // Felle-dommen (R2, fullt Pareto-re-søk) på den FASTE ruten. Alle
      // konfigurasjoner får full dom her — matrisen er liten nok, og det er
      // nettopp den dommen beslutningen skal hvile på (§13).
      const feller = [];
      /**
       * **Felle-dommens mekanikk, ikke bare dens konklusjon.**
       *
       * En felle-flipp mellom to konfigurasjoner er uleselig uten dette:
       * vaktbåndet gjør at den harde feilen fyrer *tidligere* (grensen er
       * `maxTws − bånd`), tilbaketrekkingspunktet havner dermed lenger bak
       * langs ruten, og re-søket har mer rom å rømme i. «Mistet felle» er da
       * ikke et tapt sikkerhetsvarsel — det er vaktbåndet som virker. Uten
       * `feilTH` og `naaddHavn` i rådataene kan ingen skille de to
       * forklaringene i ettertid.
       */
      const felleDetalj = {};
      for (const m of pakkede) {
        const dom = trapVerdict(
          {
            route: refRute,
            departEpochS,
            weather: m.field,
            mask,
            boat,
            harbours: INTERIM_BAILOUT_HARBOURS,
          },
          "pareto",
          1,
        );
        if (dom.felle) feller.push(m.id);
        if (dom.hardFeil) {
          felleDetalj[m.id] = {
            felle: dom.felle,
            grunn: dom.failure?.reason ?? null,
            feilTH: dom.failure === null ? null : dom.failure.tS / 3600,
            tilbaketrekkingTH:
              dom.verdict === null || dom.verdict.fromTS === null
                ? null
                : dom.verdict.fromTS / 3600,
            naaddHavn: dom.verdict?.reachedHarbour ?? null,
            vaktbandKn: m.field.maxDecodeErrorKn,
          };
        }
      }

      perKonfig[k.id] = {
        akse: k.akse,
        fast,
        egen: {
          ...egen,
          timer: egenRes.totals.durationS / 3600,
          distanceNm: egenRes.totals.distanceNm,
          reachesDestination: egenRes.safety.reachesDestination,
          safetyVerdict: egenRes.safety.verdict,
          korridorMotRefNm:
            egenRute.length > 1 && refRute.length > 1
              ? corridorDeviationNm(egenRute, refRute)
              : null,
        },
        felleSett: feller,
        felleDetalj,
      };
    }

    const ref = perKonfig["REF"];
    for (const k of konfigurasjoner) {
      const p = perKonfig[k.id];
      p.motRef = {
        fastGjennomfoerbarhetsdiff:
          p.fast.gjennomfoerbare - ref.fast.gjennomfoerbare,
        fastSammeHardFeil: settLik(p.fast.hardFeil, ref.fast.hardFeil),
        // DEN FARLIGE RETNINGEN: forkastelser REF har og pakken har mistet.
        tapteHardeForkastelser: mangler(ref.fast.hardFeil, p.fast.hardFeil),
        // Den konservative retningen: forkastelser pakken har lagt til.
        lagtTilHardeForkastelser: mangler(p.fast.hardFeil, ref.fast.hardFeil),
        egenGjennomfoerbarhetsdiff:
          p.egen.gjennomfoerbare - ref.egen.gjennomfoerbare,
        egenSammeHardFeil: settLik(p.egen.hardFeil, ref.egen.hardFeil),
        sammeFelleSett: settLik(p.felleSett, ref.felleSett),
        tapteFeller: mangler(ref.felleSett, p.felleSett),
        lagtTilFeller: mangler(p.felleSett, ref.felleSett),
        dTidEgenRel: relDiff(p.egen.timer, ref.egen.timer),
      };
      console.log(
        `P3 +${offsetS / H}t ${k.id.padEnd(11)} ` +
          `fast ${p.fast.gjennomfoerbare}/${felt.length} hard=[${p.fast.hardFeil}] ` +
          `egen ${p.egen.gjennomfoerbare}/${felt.length} feller=[${p.felleSett}]` +
          `${p.motRef.tapteHardeForkastelser.length > 0 ? `  ← TAPTE ${p.motRef.tapteHardeForkastelser}` : ""}` +
          `${p.motRef.lagtTilHardeForkastelser.length > 0 ? `  (+${p.motRef.lagtTilHardeForkastelser})` : ""}` +
          `${p.motRef.sammeFelleSett ? "" : "  ← FELLE-FLIPP"}`,
      );
    }

    ut.push({
      offsetH: offsetS / H,
      departEpochS,
      twsGrenseKn,
      medlemmer: felt.length,
      refRuteSteg: refRute.length,
      perKonfig,
    });
  }
  return ut;
}

// -------------------------------------- del 3: rangering (deskriptiv, P2b)

/**
 * Fullt Pareto-søk per medlem per avgang — det sterke instrumentet (§11
 * forbehold 2). Rapporteres **deskriptivt** (§13): en ΔP50 under
 * uavgjort-båndet på 6 % er uavgjort, ikke et funn.
 */
function rangering(konfigurasjoner, felt, domene, avganger, twsGrenseKn) {
  const boat = testBoat({ ignoreWaves: true, maxTwsKn: twsGrenseKn });
  const mask = rectMask({ noGo: SKAGERRAK_LAND });
  const ut = {
    metode: "fullt Pareto-søk per medlem (P2b)",
    uavgjortBand: UAVGJORT_BAND,
    offsetH: avganger.map((s) => s / H),
    perKonfig: {},
  };
  for (const k of konfigurasjoner) {
    const p50 = [];
    const p90 = [];
    const gjennomfoerbare = [];
    for (const offsetS of avganger) {
      const departEpochS = felt[0].validFromS + H + offsetS;
      const timer = [];
      for (const f of felt) {
        const w = k.spec === null ? f : packField(f, k.spec, domene).field;
        const r = planRoute({
          start: SKJAELOY,
          dest: SKAGEN,
          departEpochS,
          weather: w,
          mask,
          boat,
        });
        if (r.safety.reachesDestination) timer.push(r.totals.durationS / 3600);
      }
      p50.push(kvantil(timer, 0.5));
      p90.push(kvantil(timer, 0.9));
      gjennomfoerbare.push(timer.length);
      console.log(
        `RANG ${k.id.padEnd(11)} +${offsetS / H}t  ${timer.length}/${felt.length}  ` +
          `P50=${kvantil(timer, 0.5)?.toFixed(3)}`,
      );
    }
    ut.perKonfig[k.id] = {
      akse: k.akse,
      p50,
      p90,
      gjennomfoerbare,
      rangP50: rangeringAv(p50),
      rangP90: rangeringAv(p90),
    };
  }
  const ref = ut.perKonfig["REF"];
  for (const [id, r] of Object.entries(ut.perKonfig)) {
    const toppRef = ut.offsetH[ref.rangP50.indexOf(0)];
    const topp = ut.offsetH[r.rangP50.indexOf(0)];
    const maksD = Math.max(
      ...r.p50.map((v, i) =>
        v === null || ref.p50[i] === null ? 0 : Math.abs(relDiff(v, ref.p50[i])),
      ),
    );
    r.motRef = {
      toppAvgangH: topp,
      toppAvgangRefH: toppRef,
      sammeTopp: topp === toppRef,
      inversjonerP50: inversjoner(r.rangP50, ref.rangP50),
      maksDP50Rel: maksD,
      innenforUavgjortBand: maksD <= UAVGJORT_BAND,
      gjennomfoerbarhetsdiff: r.gjennomfoerbare.map(
        (v, i) => v - ref.gjennomfoerbare[i],
      ),
    };
    if (id !== "REF") {
      console.log(
        `  ↳ ${id.padEnd(11)} topp=${topp} t (REF ${toppRef} t) inv=${r.motRef.inversjonerP50} ` +
          `maksΔP50=${(maksD * 100).toFixed(2)} % ${maksD <= UAVGJORT_BAND ? "(uavgjort)" : "(over båndet)"}`,
      );
    }
  }
  return ut;
}

// ------------------------------------------------------------------ kjøring

function main() {
  const args = process.argv.slice(2);
  const flagg = (navn, standard) => {
    const i = args.indexOf(navn);
    return i >= 0 ? args[i + 1] : standard;
  };
  /**
   * Standard: ALLE flisene i pekeren. Flisoppdelingen er produsentens valg
   * (den endret seg fra 2°×2° til 1°×1° mellom to pakkebygg), og målingen
   * skal følge pakken, ikke en hardkodet liste.
   */
  const flisIder = flagg("--flis", "*")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const deler = flagg("--del", "feltprove,p3").split(",").map((s) => s.trim());
  const medlemmer = Number(flagg("--medlemmer", "30"));
  const twsGrense = Number(flagg("--tws-grense", "26"));
  const avganger = flagg("--avganger", "0,6,12,18")
    .split(",")
    .map((s) => Number(s.trim()) * H);
  const utMappe = resolve(
    flagg(
      "--ut",
      join(REPO, "docs/research/kvantisering-raadata/tillegg-ekte-flis"),
    ),
  );
  const konfigFilter = flagg("--konfig", "");
  /**
   * Metafila navngis etter delene som ble kjørt. Uten det overskriver en
   * `--del rangering`-kjøring provenansen (konfigurasjonsutvalg, avganger,
   * blob-hasher) til `--del feltprove,p3`-kjøringen i samme mappe, og
   * rådataene kan ikke lenger si hvilken pakke og hvilket utvalg de kom fra.
   * `--del ingen` kjører ingen del og skriver kun metafila — måten å
   * regenerere provenans på uten å kjøre målingen om igjen.
   */
  const metaSuffiks = flagg("--meta-suffiks", deler.join("-"));
  const valgt =
    konfigFilter.length > 0
      ? konfigFilter.split(",").map((s) => s.trim())
      : [...EKTE_FLIS_KONFIG];
  if (!valgt.includes("REF")) valgt.unshift("REF");
  const konfigurasjoner = KONFIGURASJONER.filter((k) => valgt.includes(k.id));

  const alleFliser = lesPeker().tiles.map((t) => t.tileId);
  const valgteFliser =
    flisIder.length === 1 && flisIder[0] === "*" ? alleFliser : flisIder;
  console.log(
    `Laster ekte fliser: ${valgteFliser.join(", ")} (${medlemmer} medlemmer)`,
  );
  const fliser = valgteFliser.map((id) => lastFlis(id, { medlemmer }));
  const felt = byggEkteFelt(fliser);
  const domene = ekteDomene(fliser);
  const byggrapport = lesByggrapport();
  const departEpochS = felt[0].validFromS + H;

  mkdirSync(utMappe, { recursive: true });

  const meta = {
    beskrivelse:
      "Kvantiseringsharnessen på EKTE fliser — §14 i docs/research/kvantiseringsmaaling-2026-09-01.md",
    deler,
    kilde: {
      pakke: "tools/weather-pack/out (kun lesing)",
      run: byggrapport.run,
      manglendeFelt: byggrapport.missingFields,
      fliser: fliser.map((f) => ({
        tileId: f.tileId,
        bbox: f.bbox,
        medlemmer: f.medlemmer.length,
        produsentStats: f.produsentStats,
        blobHasher: f.blobHasher,
      })),
    },
    domene,
    departEpochS,
    twsGrenseKn: twsGrense,
    avgangerH: avganger.map((s) => s / H),
    uavgjortBand: UAVGJORT_BAND,
    feltPerMedlem: felt.map((f, i) => ({
      medlem: i,
      maxTwsKn: f.maxTwsKn,
      validFromS: f.validFromS,
      validToS: f.validToS,
    })),
    konfigurasjoner: konfigurasjoner.map((k) => ({
      id: k.id,
      akse: k.akse,
      note: k.spec === null ? k.note : k.spec.note,
      spec: k.spec,
    })),
  };
  writeFileSync(
    join(utMappe, `meta-${metaSuffiks}.json`),
    JSON.stringify(meta, null, 1),
  );
  console.log(
    `Ekte felt: ${felt.length} medlemmer, maks TWS ${Math.max(...felt.map((f) => f.maxTwsKn)).toFixed(2)} kn, ` +
      `domene lat ${domene.latMin}–${domene.latMax}, lon ${domene.lonMin}–${domene.lonMax}`,
  );
  for (const f of fliser) {
    console.log(
      `  flis ${f.tileId}: maks subflis-spenn ${f.produsentStats.maksSubflisSpennKn.toFixed(2)} kn ` +
        `⇒ produsentens 8-bit-trinn ${f.produsentStats.maksSubflisTrinnKn.toFixed(4)} kn, ` +
        `vaktbånd ${f.produsentStats.produsentVaktbandKn.toFixed(4)} kn`,
    );
  }

  if (deler.includes("feltprove")) {
    const t0 = Date.now();
    const r = feltprove(konfigurasjoner, felt, domene, departEpochS);
    writeFileSync(join(utMappe, "feltprove-p1e.json"), JSON.stringify(r, null, 1));
    console.log(`\nFeltprøve ferdig på ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  if (deler.includes("p3")) {
    const t0 = Date.now();
    const r = p3(konfigurasjoner, felt, domene, avganger, twsGrense);
    writeFileSync(join(utMappe, "p3-flips.json"), JSON.stringify(r, null, 1));
    console.log(`\nP3 ferdig på ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  if (deler.includes("rangering")) {
    const t0 = Date.now();
    const r = rangering(konfigurasjoner, felt, domene, avganger, twsGrense);
    writeFileSync(join(utMappe, "rangering-p2b.json"), JSON.stringify(r, null, 1));
    console.log(`\nRangering ferdig på ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  console.log(`Rådata skrevet til ${utMappe}`);
}

main();
