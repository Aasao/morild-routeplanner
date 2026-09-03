/**
 * **Kvantiseringsmålingen** — steg 3-planens «Kvantisering FØR formatlåsing».
 *
 * Spørsmålet er *ikke* hvor mye feltverdiene flytter seg (felt-RMSE), men hvor
 * grovt værfeltene kan pakkes før **rutingen** endrer seg: rutediff, ankomsttid
 * innenfor N5s ±2 %, avgangsrangering, og — det diskvalifiserende — om
 * gjennomførbarhet eller felle-sett flipper.
 *
 * Kjør:
 *   node tools/kvantisering/maaling.mjs [--ut <mappe>] [--del p1,p2,p3,p2b]
 *                                       [--konfig W-UV8,R-4X] [--fikstur S-3]
 *
 * Scriptet er rent og deterministisk: ingen RNG, ingen nett, og ingen klokke i
 * noe som havner i rådataene. Kostnad rapporteres med **deterministiske
 * tellere** (søk, evalueringer, gridnoder, fliser), ikke millisekunder —
 * samme valg som E1′-kjøringen 2026-09-01 landet på.
 *
 * ## Tre protokoller, tre spørsmål
 *
 *  - **P1 rutediff** (fullt søk per scenario): endrer pakken *ruten*?
 *    Sammenligningsregelen er golden-testenes egen (§8.2): eksakt på de
 *    diskrete feltene, ±2 % på tid/distanse, ≤ 0,5 nm korridor.
 *  - **P2 avgangsrangering** (S-5): endrer pakken *anbefalingen*? Billig
 *    variant for hele matrisen (kontrollsøk + evaluering, samme oppskrift som
 *    S-5-vinduet selv ble målt med), full-søk-variant for de konfigurasjonene
 *    beslutningen faktisk står på (`FULLE_SOK_KONFIG`).
 *  - **P3 flips** (S-3 og S-8): flipper pakken *gjennomførbarhet eller
 *    felle-sett*? Måles på to måter: (a) **fast rute** — REF-rutene holdes
 *    fast og bare medlemsfeltene degraderes, slik at en flipp entydig kommer
 *    fra feltverdiene og ikke fra at planen ble en annen; (b) **egen rute** —
 *    hele kjeden degradert, som i produksjon.
 *
 * Referansen i alle tre er **REF-pakken**, ikke det analytiske feltet:
 * ellers ville hver akse båret gridsamplingsfeilen på toppen av sin egen.
 * `ANALYTISK` er med som egen kolonne for å måle nettopp den feilen.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateRoute,
  isHardRejection,
  planRoute,
} from "../../packages/routing/dist/src/index.js";
import { INTERIM_BAILOUT_HARBOURS } from "../../packages/routing/dist/test-fixtures/bailout-harbours.js";
import { trapVerdict } from "../../packages/routing/dist/test-fixtures/e1-outcome.js";
import {
  s1SlorEnsemble,
  s4BohuslanEnsemble,
} from "../../packages/routing/dist/test-fixtures/ensemble-golden.js";
import { s3FrontEnsemble } from "../../packages/routing/dist/test-fixtures/ensemble-s3-front.js";
import {
  s5DepartureWindowEnsemble,
  S5_DEPARTURE_OFFSETS_S,
} from "../../packages/routing/dist/test-fixtures/ensemble-s5-departure.js";
import {
  S8_OPTIONS,
  s8WindAgainstCurrentEnsemble,
} from "../../packages/routing/dist/test-fixtures/ensemble-s8-wind-current.js";
import {
  goldenScenarios,
  SKAGEN,
  SKAGERRAK_LAND,
  SKJAELOY,
  GOLDEN_DEPART_S,
} from "../../packages/routing/dist/test-fixtures/golden-scenarios.js";
import {
  bitsForCodes,
  domainAround,
  FLOAT32,
  packField,
  probePack,
  withPack,
} from "../../packages/routing/dist/test-fixtures/pack-degradation.js";
import { rectMask } from "../../packages/routing/dist/test-fixtures/synthetic-mask.js";
import { testBoat } from "../../packages/routing/dist/test-fixtures/test-boat.js";
import { corridorDeviationNm } from "../../packages/routing/dist/test-fixtures/track-compare.js";
import { windAgainstCurrentWeather } from "../../packages/routing/dist/test-fixtures/wind-current-weather.js";
import { KONFIGURASJONER, FULLE_SOK_KONFIG } from "./konfigurasjoner.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const H = 3600;

/** N5: ±2 % på tid. Samme tall som golden-testene bruker. */
const TID_TOLERANSE = 0.02;
/** Korridorkravet fra golden-testene. */
const KORRIDOR_NM = 0.5;

/**
 * Timene feltsonden sampler på.
 *
 * **Skjeve med vilje** (review-funn under kjøringen 2026-09-01): sampler man
 * på hele timer, treffer man tidsskivene eksakt i 1 t-, 30 min- og
 * 15 min-pakkene, og den tidsmessige interpolasjonsfeilen — hele poenget med
 * tidsaksen — blir usynlig. Tallene her ligger mellom skivene i alle
 * tidsoppløsningene vi måler.
 */
const SONDE_TIMER = [0.37, 2.13, 4.71, 7.29, 9.83, 12.41, 15.07, 17.63];

// ------------------------------------------------------------------ verktøy

const TOM_TELLING = () => ({
  sok: 0,
  evalueringer: 0,
  baseSamples: 0,
  fliser: 0,
  oppslag: 0,
  // Fast-LSB-regnskapet (tillegg §9.2). Spenn/abs er MAKS over pakkene, ikke
  // sum: de er bitbredde-krav, og kravet er det verste som forekom.
  lsbSpennKoder: 0,
  lsbAbsKode: 0,
  lsbKlippet: 0,
});

let telling = TOM_TELLING();

function nullstill() {
  telling = TOM_TELLING();
}

function tellPakke(pakke) {
  telling.baseSamples += pakke.stats.baseSamples;
  telling.fliser += pakke.stats.tiles;
  telling.oppslag += pakke.stats.lookups;
  telling.lsbSpennKoder = Math.max(
    telling.lsbSpennKoder,
    pakke.stats.fixedLsbMaxSpanCodes ?? 0,
  );
  telling.lsbAbsKode = Math.max(
    telling.lsbAbsKode,
    pakke.stats.fixedLsbMaxAbsCode ?? 0,
  );
  telling.lsbKlippet += pakke.stats.fixedLsbClamped ?? 0;
}

const INGEN_STATS = {
  stats: {
    baseSamples: 0,
    tiles: 0,
    lookups: 0,
    fixedLsbMaxSpanCodes: 0,
    fixedLsbMaxAbsCode: 0,
    fixedLsbClamped: 0,
  },
};

/** Pakker et felt etter konfigurasjonen. `spec === null` ⇒ feltet urørt. */
function pakk(felt, k, domene) {
  if (k.spec === null) return { field: felt, ...INGEN_STATS };
  return packField(felt, k.spec, domene);
}

function sok(input) {
  telling.sok++;
  return planRoute(input);
}

function evaluer(input) {
  telling.evalueringer++;
  return evaluateRoute(input);
}

function spor(result) {
  return result.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
}

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

/** Kendall-τ-b — samme implementasjon som E1′-målingen. */
function kendallTau(a, b) {
  const n = a.length;
  if (n < 2) return null;
  let c = 0;
  let d = 0;
  let ta = 0;
  let tb = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = Math.sign(a[i] - a[j]);
      const db = Math.sign(b[i] - b[j]);
      if (da === 0 && db === 0) {
        ta++;
        tb++;
      } else if (da === 0) ta++;
      else if (db === 0) tb++;
      else if (da === db) c++;
      else d++;
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const nevner = Math.sqrt((n0 - ta) * (n0 - tb));
  return nevner === 0 ? null : (c - d) / nevner;
}

/** Antall parvise inversjoner mellom to rangeringer. */
function inversjoner(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      if (Math.sign(a[i] - a[j]) !== Math.sign(b[i] - b[j])) n++;
    }
  }
  return n;
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

// ------------------------------------------------------- P1: rutescenarioene

/**
 * S-8-sonden med **smalt** strømbånd.
 *
 * S-8s eget bånd er 0,35° halvbredde (~39 km) og dermed godt oppløst selv på
 * 10 km. Kyststrøm er ikke det. Sondene her krymper båndet til ~9 km og ~3,3 km
 * halvbredde og svarer på det spec-en faktisk trenger: **hvor smal må
 * strømstrukturen være før nedtynningen flytter ruten?** Sondene er lagt til
 * 2026-09-01 og er ikke forhåndsregistrerte fiksturer — de er merket som
 * sonder i rapporten.
 */
function s8Sonde(halfWidthDeg, currentKn) {
  const departEpochS = GOLDEN_DEPART_S;
  return {
    start: SKJAELOY,
    dest: SKAGEN,
    departEpochS,
    weather: windAgainstCurrentWeather({
      windSpeedKn: 24,
      windFromDeg: 45,
      bandCenterLat: 58.2,
      bandHalfWidthDeg: halfWidthDeg,
      currentKn,
      currentTowardDeg: 60,
      validFromS: departEpochS - H,
      validToS: departEpochS + 3 * 24 * H,
    }),
    mask: rectMask({ noGo: SKAGERRAK_LAND }),
    boat: testBoat({ steepnessDerating: true }),
    options: S8_OPTIONS,
  };
}

function p1Scenarioer() {
  const ut = goldenScenarios().map((s) => ({
    id: s.name,
    kilde: "golden",
    purpose: s.purpose,
    input: s.input,
  }));

  const s3 = s3FrontEnsemble();
  ut.push({
    id: "s3-front-kontroll",
    kilde: "E1′",
    purpose: "S-3s kontrollfelt (kaldfront, lull + krysshav).",
    input: {
      start: s3.start,
      dest: s3.dest,
      departEpochS: s3.departEpochS,
      weather: s3.control,
      mask: s3.mask,
      boat: s3.boat,
      options: s3.options,
    },
  });

  const s8 = s8WindAgainstCurrentEnsemble();
  ut.push({
    id: "s8-vind-mot-strom-kontroll",
    kilde: "E1′",
    purpose: "S-8s kontrollfelt (strømbånd mot vind, bratthetsderating).",
    input: {
      start: s8.start,
      dest: s8.dest,
      departEpochS: s8.departEpochS,
      weather: s8.control,
      mask: s8.mask,
      boat: s8.boat,
      options: s8.options,
    },
  });

  ut.push({
    id: "sonde-stromband-9km",
    kilde: "sonde",
    purpose: "Strømbånd med ~9 km halvbredde — kyststrøm-klassen.",
    input: s8Sonde(0.08, 2.1),
  });
  ut.push({
    id: "sonde-stromband-3km",
    kilde: "sonde",
    purpose: "Strømbånd med ~3,3 km halvbredde — trang kyststrøm/sund.",
    input: s8Sonde(0.03, 2.1),
  });

  return ut;
}

function p1(konfigurasjoner) {
  const scenarioer = p1Scenarioer();
  const rader = [];
  for (const sc of scenarioer) {
    const domene = domainAround([sc.input.start, sc.input.dest]);
    const perKonfig = {};
    let ref = null;
    for (const k of konfigurasjoner) {
      nullstill();
      const pakke = pakk(sc.input.weather, k, domene);
      const r = sok({ ...sc.input, weather: pakke.field });
      tellPakke(pakke);
      const sonde =
        k.spec === null
          ? null
          : probePack(
              sc.input.weather,
              pakke.field,
              domene,
              sc.input.departEpochS,
              SONDE_TIMER,
            );
      /**
       * **Vaktbånd-verifikasjonen** (tillegg §9.2, 2026-09-03).
       *
       * Feltsonden over måler pakken mot det *analytiske* feltet og bærer
       * dermed grid- og tidsfeilen i tillegg til kvantiseringens — den kan
       * ikke brukes til å teste `maxDecodeErrorKn`, som per definisjon er en
       * skranke på kvantiseringen alene (§9.5). Her bygges derfor en pakke med
       * **nøyaktig samme grid, flisgeometri og tidsnett, men Float32 vind**,
       * og pakken måles mot den. Da er differansen ren kvantiseringsfeil, og
       * spørsmålet «fanger vaktbåndet overskridelsene?» blir målbart —
       * ikke bare «ble rutene like?».
       */
      const vaktband =
        k.spec === null || k.spec.windQuant === FLOAT32
          ? null
          : (() => {
              const reinSpec = withPack(
                `${k.id}-F32VIND`,
                "samme pakke, men Float32 vind — instrument, ikke konfigurasjon",
                { ...k.spec, windQuant: FLOAT32, dirQuant: FLOAT32 },
              );
              const rein = packField(sc.input.weather, reinSpec, domene);
              const pr = probePack(
                rein.field,
                pakke.field,
                domene,
                sc.input.departEpochS,
                SONDE_TIMER,
              );
              const band = pakke.field.maxDecodeErrorKn;
              const lsb = k.spec.windQuant.lsb ?? null;
              const twsCap = Math.max(sc.input.weather.maxTwsKn, 1);
              return {
                bandKn: band,
                lsbKn: lsb,
                deklarertMaksTwsKn: sc.input.weather.maxTwsKn,
                maksKvantiseringsfeilKn: pr.maxTwsErrKn,
                rmsKvantiseringsfeilKn: pr.rmsTwsErrKn,
                innenfor: pr.maxTwsErrKn <= band,
                maksOverDeklarertKn: pr.maxTwsOverKn,
                overDeklarertFanget: pr.maxTwsOverKn <= band,
                // Fast LSB: bitbredden er en konsekvens, ikke et valg.
                klippedeKoder: pakke.stats.fixedLsbClamped,
                spennKoder: pakke.stats.fixedLsbMaxSpanCodes,
                absKode: pakke.stats.fixedLsbMaxAbsCode,
                bitMedFlisOffset:
                  lsb === null ? null : bitsForCodes(pakke.stats.fixedLsbMaxSpanCodes),
                bitUtenOffsetRealisert:
                  lsb === null ? null : bitsForCodes(2 * pakke.stats.fixedLsbMaxAbsCode),
                bitUtenOffsetDeklarert:
                  lsb === null ? null : bitsForCodes(2 * Math.round(twsCap / lsb)),
              };
            })();

      const rad = {
        konfig: k.id,
        akse: k.akse,
        eksakt: {
          reached: r.reached,
          abortReason: r.abortReason,
          safetyVerdict: r.safety.verdict,
          reachesDestination: r.safety.reachesDestination,
          recheckPassed: r.safety.recheckPassed,
          failingSegments: r.safety.failingSegments.length,
          weatherCoverage: r.coverage.weather,
          fieldUsed: r.coverage.fieldUsed,
          finalLegStatus: r.finalLeg.status,
          daylightArrival: r.totals.daylightArrival,
        },
        timer: r.totals.durationS / 3600,
        distanceNm: r.totals.distanceNm,
        beatH: r.totals.beatS / 3600,
        motorH: r.totals.motorS / 3600,
        nightH: r.totals.nightS / 3600,
        steg: r.steps.length,
        telling: { ...telling },
        feltsonde: sonde,
        vaktband,
      };
      const t = spor(r);

      /**
       * **Kryssevaluering — det tallet formatvalget faktisk står på.**
       *
       * «Ruten flyttet seg» er ikke i seg selv en kostnad. Spørsmålet er om
       * planen pakken anbefaler fortsatt er god *i virkeligheten*. Derfor
       * seiles hver degradert rute gjennom det **analytiske** feltet
       * (sannheten), med samme evaluator, og sammenlignes med REF-rutens tid i
       * det samme feltet. Differansen er ekte anger (regret); differansen
       * mellom rutens tid i sitt eget degraderte felt og under sannheten er
       * pakkens **optimisme**.
       */
      const sannhet = evaluer({
        waypoints: t,
        departEpochS: sc.input.departEpochS,
        weather: sc.input.weather,
        mask: sc.input.mask,
        boat: sc.input.boat,
        options: sc.input.options,
      });
      rad.underSannhet = {
        feasible: sannhet.feasible,
        timer: sannhet.cost.tS / 3600,
        veipunkterNaadd: sannhet.waypointsReached,
        avvisning:
          sannhet.rejection === null
            ? null
            : {
                kind: sannhet.rejection.kind,
                reason: sannhet.rejection.reason,
                tH: sannhet.rejection.tS / 3600,
              },
      };
      // Positiv optimisme = virkeligheten er verre enn planen lovet.
      rad.optimismeRel = relDiff(sannhet.cost.tS / 3600, rad.timer);

      if (k.id === "REF") ref = { rad, spor: t };
      perKonfig[k.id] = { rad, spor: t };
    }
    if (ref === null) throw new Error("REF må være med i konfigurasjonsutvalget");

    for (const k of konfigurasjoner) {
      const { rad, spor: t } = perKonfig[k.id];
      const eksaktLik =
        JSON.stringify(rad.eksakt) === JSON.stringify(ref.rad.eksakt);
      const dTid = relDiff(rad.timer, ref.rad.timer);
      const dDist = relDiff(rad.distanceNm, ref.rad.distanceNm);
      const korridorNm =
        t.length > 1 && ref.spor.length > 1
          ? corridorDeviationNm(t, ref.spor)
          : null;
      /**
       * Anger måles bare der begge rutene faktisk *kommer fram* under
       * sannheten. På `uoppnaelig-mal` og `hull-i-vaerfeltet` er «tid» ikke en
       * ankomsttid, men hvor langt den beste delruten rakk — å regne prosent
       * på den ville vært å måle støy og kalle det ruteeffekt.
       */
      const angerMaalbar =
        rad.underSannhet.feasible && ref.rad.underSannhet.feasible;
      rad.motRef = {
        eksaktLik,
        dTidRel: dTid,
        dDistRel: dDist,
        korridorNm,
        ankomstScenario: ref.rad.eksakt.reachesDestination,
        angerRel: angerMaalbar
          ? relDiff(rad.underSannhet.timer, ref.rad.underSannhet.timer)
          : null,
        angerMistetGjennomfoerbarhet:
          ref.rad.underSannhet.feasible && !rad.underSannhet.feasible,
        n5Ok:
          eksaktLik &&
          Math.abs(dTid) <= TID_TOLERANSE &&
          (korridorNm === null || korridorNm <= KORRIDOR_NM),
      };
      rader.push({ scenario: sc.id, kilde: sc.kilde, ...rad });
      console.log(
        `P1 ${sc.id.padEnd(28)} ${k.id.padEnd(11)} ` +
          `${rad.timer.toFixed(3)} t  Δt=${(dTid * 100).toFixed(2)} %  ` +
          `korridor=${korridorNm === null ? "-" : korridorNm.toFixed(3)} nm  ` +
          `anger=${rad.motRef.angerRel === null ? "-" : `${(rad.motRef.angerRel * 100).toFixed(2)} %`}  ` +
          `optimisme=${(rad.optimismeRel * 100).toFixed(2)} %  ` +
          `${rad.motRef.n5Ok ? "ok" : "BRUDD"}${eksaktLik ? "" : " [diskret endring]"}` +
          `${rad.motRef.angerMistetGjennomfoerbarhet ? "  ← PLANEN HOLDER IKKE UNDER SANNHETEN" : ""}` +
          `${
            rad.vaktband === null
              ? ""
              : `  vaktbånd=${rad.vaktband.bandKn.toFixed(3)} kn (målt ${rad.vaktband.maksKvantiseringsfeilKn.toFixed(3)})${
                  rad.vaktband.innenfor ? "" : "  ← VAKTBÅND SPRENGT"
                }${rad.vaktband.klippedeKoder > 0 ? `  ← ${rad.vaktband.klippedeKoder} KLIPPEDE KODER` : ""}`
          }`,
      );
    }
  }
  return { scenarioer: scenarioer.map((s) => ({ id: s.id, kilde: s.kilde, purpose: s.purpose })), rader };
}

// ------------------------------------------------ P2: avgangsrangering (S-5)

/**
 * Billig rangering: ett kontrollsøk per avgang på det pakkede kontrollfeltet,
 * så evaluering av de 30 pakkede medlemsfeltene. Det er nøyaktig oppskriften
 * S-5-vinduet selv ble målt med (`ensemble-s5-departure.ts`), og derfor den
 * rangeringen fiksturens forhåndsregistrerte tall er sammenlignbare med.
 */
function p2Billig(konfigurasjoner) {
  const ut = { metode: "kontrollsøk + evaluering (billig)", perKonfig: {} };
  for (const k of konfigurasjoner) {
    nullstill();
    const p50 = [];
    const p90 = [];
    const gjennomfoerbare = [];
    for (const offsetS of S5_DEPARTURE_OFFSETS_S) {
      const fx = s5DepartureWindowEnsemble();
      const domene = domainAround([fx.start, fx.dest]);
      const departEpochS = fx.departEpochS + offsetS;
      const kontroll = pakk(fx.control, k, domene);
      const rute = sok({
        start: fx.start,
        dest: fx.dest,
        departEpochS,
        weather: kontroll.field,
        mask: fx.mask,
        boat: fx.boat,
        options: fx.options,
      });
      tellPakke(kontroll);
      const waypoints = spor(rute);
      const timer = [];
      for (const m of fx.members) {
        const pakke = pakk(m.weather, k, domene);
        const e = evaluer({
          waypoints,
          departEpochS,
          weather: pakke.field,
          mask: fx.mask,
          boat: fx.boat,
          options: fx.options,
        });
        tellPakke(pakke);
        if (e.feasible) timer.push(e.cost.tS / 3600);
      }
      p50.push(kvantil(timer, 0.5));
      p90.push(kvantil(timer, 0.9));
      gjennomfoerbare.push(timer.length);
    }
    ut.perKonfig[k.id] = {
      akse: k.akse,
      offsetH: S5_DEPARTURE_OFFSETS_S.map((s) => s / 3600),
      p50,
      p90,
      gjennomfoerbare,
      rangP50: rangeringAv(p50),
      rangP90: rangeringAv(p90),
      telling: { ...telling },
    };
    console.log(
      `P2 ${k.id.padEnd(11)} P50=[${p50.map((x) => (x === null ? "-" : x.toFixed(3))).join(" ")}] ` +
        `topp=${S5_DEPARTURE_OFFSETS_S[rangeringAv(p50).indexOf(0)] / 3600} t`,
    );
  }
  return medRangeringsdiff(ut);
}

/** Full Pareto per medlem — dyrt, men det er der rangeringen faktisk avgjøres. */
function p2Fullt(konfigurasjoner) {
  const ut = { metode: "fullt Pareto-søk per medlem (dyrt)", perKonfig: {} };
  for (const k of konfigurasjoner) {
    if (!FULLE_SOK_KONFIG.includes(k.id)) continue;
    nullstill();
    const p50 = [];
    const p90 = [];
    const gjennomfoerbare = [];
    for (const offsetS of S5_DEPARTURE_OFFSETS_S) {
      const fx = s5DepartureWindowEnsemble();
      const domene = domainAround([fx.start, fx.dest]);
      const departEpochS = fx.departEpochS + offsetS;
      const timer = [];
      for (const m of fx.members) {
        const pakke = pakk(m.weather, k, domene);
        const r = sok({
          start: fx.start,
          dest: fx.dest,
          departEpochS,
          weather: pakke.field,
          mask: fx.mask,
          boat: fx.boat,
          options: fx.options,
        });
        tellPakke(pakke);
        if (r.safety.reachesDestination) timer.push(r.totals.durationS / 3600);
      }
      p50.push(kvantil(timer, 0.5));
      p90.push(kvantil(timer, 0.9));
      gjennomfoerbare.push(timer.length);
      console.log(
        `P2b ${k.id.padEnd(11)} +${offsetS / 3600}t  ${timer.length}/30  P50=${kvantil(timer, 0.5)?.toFixed(3)}`,
      );
    }
    ut.perKonfig[k.id] = {
      akse: k.akse,
      offsetH: S5_DEPARTURE_OFFSETS_S.map((s) => s / 3600),
      p50,
      p90,
      gjennomfoerbare,
      rangP50: rangeringAv(p50),
      rangP90: rangeringAv(p90),
      telling: { ...telling },
    };
  }
  return medRangeringsdiff(ut);
}

function medRangeringsdiff(ut) {
  const ref = ut.perKonfig["REF"];
  if (ref === undefined) return ut;
  for (const [id, r] of Object.entries(ut.perKonfig)) {
    const toppRef = ref.offsetH[ref.rangP50.indexOf(0)];
    const topp = r.offsetH[r.rangP50.indexOf(0)];
    r.motRef = {
      toppAvgangH: topp,
      toppAvgangRefH: toppRef,
      sammeTopp: topp === toppRef,
      inversjonerP50: inversjoner(r.rangP50, ref.rangP50),
      inversjonerP90: inversjoner(r.rangP90, ref.rangP90),
      kendallP50: kendallTau(r.rangP50, ref.rangP50),
      maksDP50Rel: Math.max(
        ...r.p50.map((v, i) =>
          v === null || ref.p50[i] === null ? 0 : Math.abs(relDiff(v, ref.p50[i])),
        ),
      ),
      maksDP90Rel: Math.max(
        ...r.p90.map((v, i) =>
          v === null || ref.p90[i] === null ? 0 : Math.abs(relDiff(v, ref.p90[i])),
        ),
      ),
      gjennomfoerbarhetsdiff: r.gjennomfoerbare.map((v, i) => v - ref.gjennomfoerbare[i]),
    };
    if (id !== "REF") {
      console.log(
        `  ↳ ${id.padEnd(11)} topp=${topp} t (REF ${toppRef} t) inv=${r.motRef.inversjonerP50} ` +
          `maksΔP50=${(r.motRef.maksDP50Rel * 100).toFixed(2)} %`,
      );
    }
  }
  return ut;
}

// -------------------------------------- P3: gjennomførbarhets- og felle-flips

/** Konfigurasjoner som ALLTID får full R2-felledom, uansett om settet flyttet seg. */
const ALLTID_R2 = new Set([
  "REF",
  "K-ANBEFALT",
  "K-ANB-KYST",
  "K-ANB-UTASKJAERS",
  "K-VERSTE",
  "H-8G",
  "H-8N",
  "H-8O",
  "H-6G",
  "H-6GO",
  // Tillegg §9.2 (fast fysisk LSB): formatkandidater får alltid full
  // felledom, uansett om hardfeil-settet flyttet seg — det er nettopp den
  // dommen beslutningen skal hvile på.
  "F-LSB025",
  "F-LSB025O",
  "F-LSB050",
  "F-LSB050O",
  "K-KYST-F025",
  "K-KYST-F050",
  "F-LSB010",
  "F-LSB010O",
  "K-KYST-F010",
]);

function p3(konfigurasjoner, fiksturFilter) {
  const matrise = [
    { id: "S-3", bygg: s3FrontEnsemble, avganger: [0, 2 * H, 4 * H, 6 * H, 8 * H] },
    { id: "S-8", bygg: s8WindAgainstCurrentEnsemble, avganger: [0, 3 * H, 6 * H] },
    /**
     * **S-1 og S-4** (lagt til 2026-09-03, tillegg §9.2).
     *
     * De to har `hardRejectionMemberIds: []` — ingen medlemmer møter en hard
     * forkastelse per konstruksjon — og de er derfor ikke en test på *tapte*
     * forkastelser, men på den motsatte feilen: at en pakke **finner på** en
     * forkastelse eller mister gjennomførbarhet der fasiten ikke har noen.
     * Felledommen er billig her (`trapVerdict` returnerer uten re-søk når det
     * ikke finnes noen hard feil), så prisen for å ha dem med er lav og
     * dekningen — åpent slørstrekk og trang skjærgård — er den bredden
     * formatbeslutningen mangler i S-3/S-8 alene.
     */
    { id: "S-1", bygg: s1SlorEnsemble, avganger: [0, 3 * H] },
    { id: "S-4", bygg: s4BohuslanEnsemble, avganger: [0, 3 * H] },
  ].filter((m) => fiksturFilter.length === 0 || fiksturFilter.includes(m.id));

  const ut = [];
  for (const spec of matrise) {
    for (const offsetS of spec.avganger) {
      const fxRef = spec.bygg();
      const domene = domainAround([fxRef.start, fxRef.dest]);
      const departEpochS = fxRef.departEpochS + offsetS;

      // REF-ruten alle «fast rute»-kolonnene måles på.
      const refKonfig = konfigurasjoner.find((k) => k.id === "REF");
      const refKontroll = pakk(fxRef.control, refKonfig, domene);
      const refRute = spor(
        sok({
          start: fxRef.start,
          dest: fxRef.dest,
          departEpochS,
          weather: refKontroll.field,
          mask: fxRef.mask,
          boat: fxRef.boat,
          options: fxRef.options,
        }),
      );

      const perKonfig = {};
      let refHard = null;
      for (const k of konfigurasjoner) {
        nullstill();
        const fx = spec.bygg();
        const pakkede = fx.members.map((m) => {
          const p = pakk(m.weather, k, domene);
          return { id: m.id, params: m.params, field: p.field, pakke: p };
        });

        // (a) fast rute: kun feltverdiene er degradert.
        const fast = { gjennomfoerbare: 0, hardFeil: [], avvisning: {} };
        for (const m of pakkede) {
          const e = evaluer({
            waypoints: refRute,
            departEpochS,
            weather: m.field,
            mask: fx.mask,
            boat: fx.boat,
            options: fx.options,
          });
          if (e.feasible) fast.gjennomfoerbare++;
          if (isHardRejection(e.rejection)) {
            fast.hardFeil.push(m.id);
            fast.avvisning[m.id] = {
              kind: e.rejection.kind,
              reason: e.rejection.reason,
              tH: e.rejection.tS / 3600,
            };
          } else if (e.rejection !== null) {
            fast.avvisning[m.id] = {
              kind: e.rejection.kind,
              reason: e.rejection.reason,
              tH: e.rejection.tS / 3600,
            };
          }
        }

        // (b) egen rute: hele kjeden degradert, som i produksjon.
        const kontroll = pakk(fx.control, k, domene);
        const egenRuteRes = sok({
          start: fx.start,
          dest: fx.dest,
          departEpochS,
          weather: kontroll.field,
          mask: fx.mask,
          boat: fx.boat,
          options: fx.options,
        });
        tellPakke(kontroll);
        const egenRute = spor(egenRuteRes);
        const egen = { gjennomfoerbare: 0, hardFeil: [] };
        for (const m of pakkede) {
          const e = evaluer({
            waypoints: egenRute,
            departEpochS,
            weather: m.field,
            mask: fx.mask,
            boat: fx.boat,
            options: fx.options,
          });
          if (e.feasible) egen.gjennomfoerbare++;
          if (isHardRejection(e.rejection)) egen.hardFeil.push(m.id);
        }

        for (const m of pakkede) tellPakke(m.pakke);

        perKonfig[k.id] = {
          akse: k.akse,
          fast,
          egen: {
            ...egen,
            timer: egenRuteRes.totals.durationS / 3600,
            korridorMotRefNm:
              egenRute.length > 1 && refRute.length > 1
                ? corridorDeviationNm(egenRute, refRute)
                : null,
          },
          telling: { ...telling },
          _fx: fx,
          _pakkede: pakkede,
        };
        if (k.id === "REF") refHard = fast.hardFeil;
      }

      // Felle-dommen (R2, fullt Pareto-re-søk) på den FASTE ruten — gated.
      for (const k of konfigurasjoner) {
        const p = perKonfig[k.id];
        const flyttetSeg =
          JSON.stringify([...p.fast.hardFeil].sort()) !==
          JSON.stringify([...(refHard ?? [])].sort());
        if (!ALLTID_R2.has(k.id) && !flyttetSeg) {
          p.felleSett = null;
          p.felleGrunn = "ikke kjørt: identisk hardfeil-sett med REF";
          continue;
        }
        const feller = [];
        for (const m of p._pakkede) {
          const dom = trapVerdict(
            {
              route: refRute,
              departEpochS,
              weather: m.field,
              mask: p._fx.mask,
              boat: p._fx.boat,
              options: p._fx.options,
              harbours: INTERIM_BAILOUT_HARBOURS,
            },
            "pareto",
            1,
          );
          if (dom.felle) feller.push(m.id);
        }
        p.felleSett = feller;
        p.felleGrunn = flyttetSeg ? "hardfeil-settet flyttet seg" : "alltid";
      }

      const ref = perKonfig["REF"];
      for (const k of konfigurasjoner) {
        const p = perKonfig[k.id];
        delete p._fx;
        delete p._pakkede;
        p.motRef = {
          fastGjennomfoerbarhetsdiff:
            p.fast.gjennomfoerbare - ref.fast.gjennomfoerbare,
          fastSammeHardFeil:
            JSON.stringify([...p.fast.hardFeil].sort()) ===
            JSON.stringify([...ref.fast.hardFeil].sort()),
          egenGjennomfoerbarhetsdiff:
            p.egen.gjennomfoerbare - ref.egen.gjennomfoerbare,
          egenSammeHardFeil:
            JSON.stringify([...p.egen.hardFeil].sort()) ===
            JSON.stringify([...ref.egen.hardFeil].sort()),
          sammeFelleSett:
            p.felleSett === null || ref.felleSett === null
              ? null
              : JSON.stringify([...p.felleSett].sort()) ===
                JSON.stringify([...ref.felleSett].sort()),
          dTidEgenRel: relDiff(p.egen.timer, ref.egen.timer),
        };
        console.log(
          `P3 ${spec.id} +${offsetS / 3600}t ${k.id.padEnd(11)} ` +
            `fast ${p.fast.gjennomfoerbare}/${30} hard=[${p.fast.hardFeil}] ` +
            `egen ${p.egen.gjennomfoerbare}/30 ` +
            `feller=${p.felleSett === null ? "(ikke kjørt)" : `[${p.felleSett}]`}` +
            `${p.motRef.fastSammeHardFeil ? "" : "  ← FLIPP"}`,
        );
      }

      ut.push({
        fikstur: spec.id,
        offsetH: offsetS / 3600,
        medlemmer: 30,
        refRuteSteg: refRute.length,
        perKonfig,
      });
    }
  }
  return ut;
}

// ------------------------------------------------------------------- kjøring

function main() {
  const args = process.argv.slice(2);
  const flagg = (navn, standard) => {
    const i = args.indexOf(navn);
    return i >= 0 ? args[i + 1] : standard;
  };
  const utMappe = resolve(
    flagg("--ut", join(REPO, "docs/research/kvantisering-raadata")),
  );
  const deler = flagg("--del", "p1,p2,p3").split(",").map((s) => s.trim());
  const konfigFilter = flagg("--konfig", "");
  const fiksturFilter = flagg("--fikstur", "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let konfigurasjoner = KONFIGURASJONER;
  if (konfigFilter.length > 0) {
    const valgt = konfigFilter.split(",").map((s) => s.trim());
    if (!valgt.includes("REF")) valgt.unshift("REF");
    konfigurasjoner = KONFIGURASJONER.filter((k) => valgt.includes(k.id));
  }
  mkdirSync(utMappe, { recursive: true });

  const meta = {
    beskrivelse:
      "Kvantiseringsmåling 2026-09-01 — se docs/research/kvantiseringsmaaling-2026-09-01.md",
    referanse: "REF",
    tidToleranse: TID_TOLERANSE,
    korridorNm: KORRIDOR_NM,
    konfigurasjoner: konfigurasjoner.map((k) => ({
      id: k.id,
      akse: k.akse,
      note: k.spec === null ? k.note : k.spec.note,
      spec: k.spec,
    })),
  };
  writeFileSync(join(utMappe, "meta.json"), JSON.stringify(meta, null, 1));

  if (deler.includes("p1")) {
    const t0 = Date.now();
    const r = p1(konfigurasjoner);
    writeFileSync(join(utMappe, "p1-rutediff.json"), JSON.stringify(r, null, 1));
    console.log(`\nP1 ferdig på ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  if (deler.includes("p2")) {
    const t0 = Date.now();
    const r = p2Billig(konfigurasjoner);
    writeFileSync(join(utMappe, "p2-rangering-billig.json"), JSON.stringify(r, null, 1));
    console.log(`\nP2 ferdig på ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  if (deler.includes("p2b")) {
    const t0 = Date.now();
    const r = p2Fullt(konfigurasjoner);
    writeFileSync(join(utMappe, "p2-rangering-fulle-sok.json"), JSON.stringify(r, null, 1));
    console.log(`\nP2b ferdig på ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  if (deler.includes("p3")) {
    const t0 = Date.now();
    const r = p3(konfigurasjoner, fiksturFilter);
    writeFileSync(join(utMappe, "p3-flips.json"), JSON.stringify(r, null, 1));
    console.log(`\nP3 ferdig på ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  console.log(`Rådata skrevet til ${utMappe}`);
}

main();
