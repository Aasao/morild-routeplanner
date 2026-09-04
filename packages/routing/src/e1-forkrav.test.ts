/**
 * **Forkravene til E1′-kjøringen** — måleplanens §8.2, vedtatt av Magnus
 * kvelden 2026-08-31. Alle seks skal være grønne *før* matrisen kjøres; en
 * rød test her stopper målingen, den justerer den ikke.
 *
 * 1. Navigasjonsfelle-medlem i S-3 (det eneste medlemmet som kan skille
 *    variant B fra fasiten).
 * 2. S-5 avgangsvindu der rangeringen faktisk vipper.
 * 3. Paritetsrøyktest på degradert data (uten Hs) gjennom søk, evaluator og
 *    re-søk.
 * 4. Abort-paritet: algoritmisk abort og vær-ugjennomførbarhet klassifiseres
 *    likt i alle tre variantene.
 * 5. Backoff-sanity: halvert tidssteg skal ikke endre felle-settet.
 * 6. Variant-isolasjon: ingen avledet tilstand krysser variantgrensen.
 *
 * Testene måler **fiksturene og målemekanikken**, ikke variantene. Selve E1′-
 * kjøringen er `tools/e1-maaling/maaling.mjs`.
 */
import { describe, expect, it } from "vitest";
import type { LatLon } from "@morild/geo";
import { INTERIM_BAILOUT_HARBOURS } from "../test-fixtures/bailout-harbours.js";
import { memberOutcome, trapVerdict } from "../test-fixtures/e1-outcome.js";
import { s4BohuslanEnsemble } from "../test-fixtures/ensemble-golden.js";
import {
  s3FrontEnsemble,
  S3_NAV_TRAP_ID,
} from "../test-fixtures/ensemble-s3-front.js";
import {
  s5DepartureWindowEnsemble,
  S5_DEPARTURE_OFFSETS_S,
} from "../test-fixtures/ensemble-s5-departure.js";
import type { EnsembleFixture } from "../test-fixtures/ensemble.js";
import { SKAGERRAK_LAND } from "../test-fixtures/golden-scenarios.js";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import { harbourApproachable } from "./bailout.js";
import type { WeatherField } from "./contracts.js";
import { distanceToRouteNm } from "./corridor.js";
import {
  FLAG_SJOEGANG_DATA_MANGLER,
  FLAG_SJOEGANGS_MARGIN_OVERSKREDET,
  FLAG_USIKKER_TILLIT,
} from "./cost.js";
import { evaluateRoute } from "./evaluate.js";
import { planRoute } from "./search.js";
import { applyTssRule } from "./tss.js";

const HARBOURS = INTERIM_BAILOUT_HARBOURS;
const TUBE_NM = 4;

function kvantil(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

function controlRoute(
  fixture: EnsembleFixture,
  departEpochS = fixture.departEpochS,
): readonly LatLon[] {
  const r = planRoute({
    start: fixture.start,
    dest: fixture.dest,
    departEpochS,
    weather: fixture.control,
    mask: fixture.mask,
    boat: fixture.boat,
    options: fixture.options,
  });
  expect(r.reached, `${fixture.name}: kontrollruten når ikke fram`).toBe(true);
  return r.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
}

// ============================================================ 1. navigasjonsfelle

describe("§8.2 forkrav 1 — navigasjonsfellen i S-3", () => {
  const fixture = s3FrontEnsemble();
  const route = controlRoute(fixture);
  const member = fixture.members.find((m) => m.id === S3_NAV_TRAP_ID)!;
  const felles = {
    route,
    departEpochS: fixture.departEpochS,
    weather: member.weather,
    mask: fixture.mask,
    boat: fixture.boat,
    options: fixture.options,
    harbours: HARBOURS,
    tubeNm: TUBE_NM,
  };

  it("er et eget medlem med egen mekanisme, og ensemblet er fortsatt 30", () => {
    expect(fixture.members).toHaveLength(30);
    expect(member.params["mekanisme"]).toBe("navigasjonsfelle");
    expect(fixture.hardRejectionMemberIds).toContain(S3_NAV_TRAP_ID);
    // Fortsatt 30 forskjellige parameterrader.
    expect(
      new Set(fixture.members.map((m) => JSON.stringify(m.params))).size,
    ).toBe(30);
  });

  /**
   * Leden er lagt **langs** kandidatruten, og skal derfor være inert for alt
   * S-3 gjorde før. Uten denne regresjonen ville navigasjonsfellen kunne ha
   * flyttet fasiten under føttene på hele fiksturen.
   */
  it("TSS-leden endrer ikke kontrollruten", () => {
    const utenLed = planRoute({
      start: fixture.start,
      dest: fixture.dest,
      departEpochS: fixture.departEpochS,
      weather: fixture.control,
      mask: rectMask({ noGo: SKAGERRAK_LAND }),
      boat: fixture.boat,
      options: fixture.options,
    });
    expect(utenLed.steps.map((s) => [s.lat, s.lon])).toEqual(
      route.map((p) => [p.lat, p.lon]),
    );
  }, 120_000);

  it("gir en hard forkastelse på sjøgang langs kandidatruten", () => {
    const e = evaluateRoute({
      waypoints: route,
      departEpochS: fixture.departEpochS,
      weather: member.weather,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
    });
    expect(e.feasible).toBe(false);
    expect(e.rejection?.kind).toBe("boatLimits");
    expect(e.rejection?.reason).toContain("Hs");
    // Forkastelsen kommer tidlig, mens båten fortsatt er nord i Skagerrak.
    expect(e.rejection!.tS / 3600).toBeLessThan(3);
    expect(e.rejection!.lat).toBeGreaterThan(58.9);
  }, 60_000);

  it("diskvalifiserer de nærmeste havnene, men ikke utveien", () => {
    const dom = trapVerdict(felles, "pareto");
    const tid = fixture.departEpochS + dom.verdict!.fromTS! + 3600;
    const havn = (navn: string) =>
      harbourApproachable(
        HARBOURS.find((h) => h.name === navn)!,
        member.weather,
        tid,
      );
    // Nærmeste (5,9 nm) og nest nærmeste (10,5 nm) er værdiskvalifisert.
    expect(havn("Skjæløy").approachable).toBe(false);
    expect(havn("Strömstad").approachable).toBe(false);
    expect(havn("Fjällbacka").approachable).toBe(false);
    // Fredrikstad er den eneste anløpbare — og den ligger bak restriksjonen.
    expect(havn("Fredrikstad").approachable).toBe(true);
  }, 120_000);

  /**
   * Den navigasjonsmessige sperren: rett nordkurs mot havnene er «langs leden,
   * mot trafikkretningen» og dermed hard avvisning, mens tvers over er lovlig.
   * Det er dette som gjør utveien til en omvei og ikke en rett linje.
   */
  it("stenger den direkte veien nordover med TSS-retningsregelen", () => {
    const p = { lat: 59.0, lon: 10.85 };
    const nord = fixture.mask.tssVerdict(p.lat, p.lon, p.lat + 0.08, p.lon);
    expect(nord.kind).toBe("along");
    expect(applyTssRule(nord).kind).toBe("reject");
    // Tvers over leden er lovlig — utveien finnes, den er bare ikke rett fram.
    const tvers = fixture.mask.tssVerdict(p.lat, p.lon, p.lat, p.lon + 0.12);
    expect(applyTssRule(tvers).kind).toBe("ok");
    // Og med trafikkretningen, som kandidatruten selv seiler, er det lovlig.
    const langs = fixture.mask.tssVerdict(p.lat, p.lon, p.lat - 0.08, p.lon - 0.03);
    expect(applyTssRule(langs).kind).toBe("along-with-direction");
  }, 60_000);

  it("FASIT: fullt Pareto-re-søk finner utveien innen 6 t-skranken", () => {
    const dom = trapVerdict(felles, "pareto");
    expect(dom.hardFeil).toBe(true);
    expect(dom.felle, "fasiten skal finne utveien").toBe(false);
    expect(dom.verdict!.reachedHarbour).toBe("Fredrikstad");
    const naadd = dom.verdict!.attempts.find((a) => a.outcome === "naadd")!;
    expect(naadd.durationS! / 3600).toBeLessThan(6);
  }, 120_000);

  /**
   * Diskrimineringskraften §8.2 ber om: utveien er en omvei som *starter med å
   * seile bort fra havnen*, og som ligger mer enn variant Bs rørbredde unna
   * rettlinjen. Uten dette medlemmet er felle-kriteriet i §4 tomt.
   */
  it("VARIANT B: korridorbegrenset re-søk finner den ikke — settene skiller lag", () => {
    const fasit = trapVerdict(felles, "pareto");
    const korridor = trapVerdict(felles, "korridor-skalar");
    expect(korridor.hardFeil).toBe(true);
    expect(korridor.felle).toBe(true);
    expect(korridor.felle).not.toBe(fasit.felle);
    // Feilpunktet er delt — det er re-søket som skiller, ikke deteksjonen.
    expect(korridor.failure!.tS).toBe(fasit.failure!.tS);
  }, 180_000);

  it("dokumenterer geometrien: utveien ligger utenfor et 4 nm rør", () => {
    const dom = trapVerdict(felles, "pareto");
    const fra = dom.verdict!.from!;
    const havn = HARBOURS.find((h) => h.name === "Fredrikstad")!;
    const flukt = planRoute({
      start: fra,
      dest: havn.position,
      departEpochS: fixture.departEpochS + dom.verdict!.fromTS!,
      weather: member.weather,
      mask: fixture.mask,
      boat: fixture.boat,
      options: {
        ...fixture.options,
        maxIterations: 7,
        requireDaylightArrival: false,
      },
    });
    expect(flukt.safety.reachesDestination).toBe(true);
    const rettlinje = [fra, havn.position];
    const maksAvvik = Math.max(
      ...flukt.steps.map((s) => distanceToRouteNm(rettlinje, s)),
    );
    expect(
      maksAvvik,
      `utveien avviker bare ${maksAvvik.toFixed(2)} nm fra rettlinjen — ` +
        `da får den plass i variant Bs rør, og medlemmet diskriminerer ikke`,
    ).toBeGreaterThan(TUBE_NM);
    // Omveien går først ØSTOVER, bort fra havnen som ligger i nord.
    const forsteSteg = flukt.steps[1]!;
    expect(forsteSteg.lon).toBeGreaterThan(fra.lon);
  }, 120_000);

  /**
   * **Regresjonsvakt for tilleggsmålingens hovedfunn** (rapportens §6.2,
   * datert 2026-09-01): med 12° kursoppløsning i re-søket — F3.5s planlagte
   * medlemsoppløsning — finner fasitens mekanikk fortsatt utveien, og m24 er
   * fortsatt **ikke** en felle.
   *
   * Den er verdt en test fordi den er et *sikkerhetsresultat*: hele
   * felle-kriteriets diskrimineringskraft hviler på dette ene medlemmet, og
   * hvis en senere endring gjør utveien uoppnåelig ved 12°, endrer den
   * samtidig konklusjonen målingen ble brukt til. Da skal denne bli rød.
   *
   * Testen fastholder også at `searchOptions` **kun** treffer re-søket:
   * feilpunktet er identisk med fasitens, fordi feildeteksjonen er delt
   * (måleplanens §6.1).
   */
  it("VARIANT F12: 12° kursoppløsning i re-søket finner fortsatt utveien", () => {
    const fasit = trapVerdict(felles, "pareto");
    const grov = trapVerdict(felles, "pareto", undefined, {
      headingStepDeg: 12,
    });
    expect(grov.hardFeil).toBe(true);
    expect(grov.felle, "m24 skal ikke bli en felle av grovere kursnett").toBe(
      false,
    );
    expect(grov.verdict!.reachedHarbour).toBe("Fredrikstad");
    const naadd = grov.verdict!.attempts.find((a) => a.outcome === "naadd")!;
    expect(naadd.durationS! / 3600).toBeLessThan(6);
    // Delt feildeteksjon: `searchOptions` rører ikke evalueringen.
    expect(grov.failure!.tS).toBe(fasit.failure!.tS);
    expect(grov.verdict!.fromTS).toBe(fasit.verdict!.fromTS);
  }, 180_000);

  it("uten `searchOptions` er dommen bit-identisk med kjøringen 2026-08-31", () => {
    const utenOverstyring = trapVerdict(felles, "pareto");
    const eksplisittUdefinert = trapVerdict(
      felles,
      "pareto",
      undefined,
      undefined,
    );
    expect(JSON.stringify(eksplisittUdefinert)).toBe(
      JSON.stringify(utenOverstyring),
    );
  }, 180_000);
});

// ================================================================ 2. S-5-vippet

describe("§8.2 forkrav 2 — S-5s avgangsvindu vipper", () => {
  it("har naboavganger innenfor toleransebåndet, og en topp som avhenger av statistikken", () => {
    const fixture = s5DepartureWindowEnsemble();
    const p50: number[] = [];
    const p90: number[] = [];
    for (const offset of S5_DEPARTURE_OFFSETS_S) {
      const departEpochS = fixture.departEpochS + offset;
      const route = controlRoute(fixture, departEpochS);
      const timer: number[] = [];
      for (const m of fixture.members) {
        const e = evaluateRoute({
          waypoints: route,
          departEpochS,
          weather: m.weather,
          mask: fixture.mask,
          boat: fixture.boat,
          options: fixture.options,
        });
        expect(e.feasible, `${m.id} skal være gjennomførbar i S-5`).toBe(true);
        timer.push(e.cost.tS / 3600);
      }
      p50.push(kvantil(timer, 0.5));
      p90.push(kvantil(timer, 0.9));
    }
    expect(p50).toHaveLength(5);

    // (a) Minst ett naboskap ligger innenfor §4s ±2 %-bånd.
    const naboAvvik = p50
      .slice(0, -1)
      .map((v, i) => (Math.abs(v - p50[i + 1]!) / ((v + p50[i + 1]!) / 2)) * 100);
    const tettest = Math.min(...naboAvvik);
    expect(
      tettest,
      `tetteste naboavstand er ${tettest.toFixed(3)} % — vinduet vipper ikke`,
    ).toBeLessThan(1);

    // (b) Toppavgangen er ikke robust: P50 og P90 peker på hver sin avgang.
    const toppP50 = p50.indexOf(Math.min(...p50));
    const toppP90 = p90.indexOf(Math.min(...p90));
    expect(
      toppP50,
      "P50 og P90 peker på samme avgang — rangeringen er da robust, ikke vippende",
    ).not.toBe(toppP90);
  }, 300_000);
});

// =================================================== 3. paritet på degradert data

/** Samme felt, men uten bølgedata i det hele tatt (måleplanens §8.2 plaster a). */
function withoutWaves(base: WeatherField): WeatherField {
  return {
    wind: (lat, lon, t) => base.wind(lat, lon, t),
    waves: () => undefined,
    current: (lat, lon, t) => base.current(lat, lon, t),
    maxTwsKn: base.maxTwsKn,
    maxCurrentKn: base.maxCurrentKn,
    maxDecodeErrorKn: base.maxDecodeErrorKn,
    validFromS: base.validFromS,
    validToS: base.validToS,
    header: base.header,
  };
}

const DEGRADERINGSFLAGG =
  FLAG_SJOEGANG_DATA_MANGLER |
  FLAG_SJOEGANGS_MARGIN_OVERSKREDET |
  FLAG_USIKKER_TILLIT;

function degraderingsflagg(steps: readonly { readonly flags: number }[]): number {
  let union = 0;
  for (const s of steps) union |= s.flags;
  return union & DEGRADERINGSFLAGG;
}

describe("§8.2 forkrav 3 — paritetsrøyktest på degradert data (uten Hs)", () => {
  const base = s4BohuslanEnsemble();
  const fixture: EnsembleFixture = {
    ...base,
    control: withoutWaves(base.control),
    members: base.members.map((m) => ({ ...m, weather: withoutWaves(m.weather) })),
  };
  const route = controlRoute(fixture);

  it("setter faktisk degraderingsflagget — ellers måler testen ingenting", () => {
    const r = planRoute({
      start: fixture.start,
      dest: fixture.dest,
      departEpochS: fixture.departEpochS,
      weather: fixture.control,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
    });
    expect(degraderingsflagg(r.steps) & FLAG_SJOEGANG_DATA_MANGLER).not.toBe(0);
  }, 60_000);

  it("gir identisk gjennomførbarhet og identiske degraderingsflagg i A, B og F", () => {
    for (const m of fixture.members) {
      const felles = {
        start: fixture.start,
        dest: fixture.dest,
        departEpochS: fixture.departEpochS,
        weather: m.weather,
        mask: fixture.mask,
        boat: fixture.boat,
        options: fixture.options,
        route,
        harbours: HARBOURS,
        tubeNm: TUBE_NM,
      } as const;
      const a = memberOutcome({ ...felles, variant: "A" });
      const b = memberOutcome({ ...felles, variant: "B" });
      const f = memberOutcome({ ...felles, variant: "F" });
      expect(
        [a.gjennomfoerbar, b.gjennomfoerbar],
        `${m.id}: variantene er uenige om gjennomførbarhet i degradert regime`,
      ).toEqual([f.gjennomfoerbar, f.gjennomfoerbar]);

      // Flaggsettene måles på degraderingsflaggene: A og F seiler sine egne
      // ruter, så KRYSS/MOTOR kan og skal variere. Det testen gjelder, er om
      // manglende sjøgangsdata behandles likt.
      const flaggA = degraderingsflagg(
        planRouteSteps(fixture, m.weather, true),
      );
      const flaggF = degraderingsflagg(
        planRouteSteps(fixture, m.weather, false),
      );
      const flaggB = degraderingsflagg(
        evaluateRoute({
          waypoints: route,
          departEpochS: fixture.departEpochS,
          weather: m.weather,
          mask: fixture.mask,
          boat: fixture.boat,
          options: fixture.options,
        }).steps,
      );
      expect([flaggA, flaggB], `${m.id}: ulike degraderingsflagg`).toEqual([
        flaggF,
        flaggF,
      ]);
    }
  }, 600_000);

  /**
   * Re-søksbeinet. Uten Hs-data kan sjøgang ikke lenger felle noe, så
   * fiksturen får en båt med lavere vindgrense for at en **hard** feil
   * (`boatLimits` på TWS) i det hele tatt skal oppstå. Alt annet er S-4s egen
   * fikstur.
   */
  it("behandler manglende sjøgangsdata likt i re-søket i alle tre mekanikkene", () => {
    // 11 kn er valgt målt, ikke gjettet: kontrollruten kommer fortsatt fram,
    // og 15 av 30 medlemmer får en hard `boatLimits`-feil på TWS.
    const svakBaat = testBoat({ maxTwsKn: 11 });
    const degradert = { ...fixture, boat: svakBaat };
    const degradertRoute = controlRoute(degradert);
    let hardeFeil = 0;
    for (const m of degradert.members) {
      const felles = {
        route: degradertRoute,
        departEpochS: degradert.departEpochS,
        weather: m.weather,
        mask: degradert.mask,
        boat: svakBaat,
        options: degradert.options,
        harbours: HARBOURS,
        tubeNm: TUBE_NM,
      };
      const doms = (["pareto", "skalar", "korridor-skalar"] as const).map((mode) =>
        trapVerdict(felles, mode),
      );
      // Feildeteksjonen er delt og skal være identisk.
      expect(doms.map((d) => d.hardFeil)).toEqual([
        doms[0]!.hardFeil,
        doms[0]!.hardFeil,
        doms[0]!.hardFeil,
      ]);
      if (!doms[0]!.hardFeil) continue;
      hardeFeil++;
      expect(doms.map((d) => d.failure!.tS)).toEqual([
        doms[0]!.failure!.tS,
        doms[0]!.failure!.tS,
        doms[0]!.failure!.tS,
      ]);
      // Ingen mekanikk får finne på å diskvalifisere en havn på sjøgang når
      // det ikke finnes sjøgangsdata — det ville vært oppdiktet fare.
      for (const d of doms) {
        for (const a of d.verdict!.attempts) {
          expect(a.reason).not.toContain("Hs");
        }
      }
    }
    expect(hardeFeil, "ingen harde feil ⇒ re-søket ble aldri utøvd").toBeGreaterThan(
      0,
    );
  }, 600_000);
});

function planRouteSteps(
  fixture: EnsembleFixture,
  weather: WeatherField,
  scalar: boolean,
): readonly { readonly flags: number }[] {
  return planRoute({
    start: fixture.start,
    dest: fixture.dest,
    departEpochS: fixture.departEpochS,
    weather,
    mask: fixture.mask,
    boat: fixture.boat,
    options: { ...fixture.options, scalarSearchMode: scalar },
  }).steps;
}

// ============================================================== 4. abort-paritet

describe("§8.2 forkrav 4 — abort-paritet", () => {
  const base = s4BohuslanEnsemble();
  const route = controlRoute(base);
  const member = base.members[0]!;

  function utfall(variant: "A" | "B" | "F", overrides: object, boat = base.boat) {
    return memberOutcome({
      variant,
      start: base.start,
      dest: base.dest,
      departEpochS: base.departEpochS,
      weather: member.weather,
      mask: base.mask,
      boat,
      options: { ...base.options, ...overrides },
      route,
      harbours: HARBOURS,
      tubeNm: TUBE_NM,
    });
  }

  it("teller labelCap som algoritmisk abort i begge søkevariantene", () => {
    const kvelende = { maxTotalLabels: 150 };
    for (const variant of ["A", "F"] as const) {
      const u = utfall(variant, kvelende);
      expect(u.gjennomfoerbar, `${variant} kom fram tross labelCap`).toBe(false);
      expect(u.avbrudd).toBe("labelCap");
      expect(u.algoritmiskAbort, `${variant} teller ikke labelCap`).toBe(true);
    }
  }, 60_000);

  /**
   * Den strukturelle asymmetrien, skrevet ned fordi den er måleresultat i seg
   * selv: variant B kjører **ikke noe medlemssøk**, og kan derfor per
   * konstruksjon ikke få en algoritmisk søkeabort. Kravet «null algoritmiske
   * aborter» er dermed trivielt oppfylt for B, og det skal stå i rapporten i
   * stedet for å bli lest som en styrke.
   */
  it("variant B har ikke noe medlemssøk, og kan ikke få en søkeabort", () => {
    const u = utfall("B", { maxTotalLabels: 150 });
    expect(u.sok).toBe(0);
    expect(u.algoritmiskAbort).toBe(false);
  }, 60_000);

  it("teller vær-ugjennomførbarhet likt — og aldri som abort — i alle tre", () => {
    // Båten tåler ingenting: hvert eneste steg er over grensen.
    const skjoerBaat = testBoat({ maxTwsKn: 0.5 });
    for (const variant of ["A", "B", "F"] as const) {
      const u = utfall(variant, {}, skjoerBaat);
      expect(u.gjennomfoerbar, `${variant} kom fram i umulig vær`).toBe(false);
      expect(
        u.algoritmiskAbort,
        `${variant} vasker vær-ugjennomførbarhet til en algoritmisk abort`,
      ).toBe(false);
    }
  }, 120_000);
});

// ============================================================= 5. backoff-sanity

describe("§8.2 forkrav 5 — backoff-sanity på halvert tidssteg", () => {
  /**
   * Backoffen er definert i **fysisk tid**, `min(Δt, 1800 s)`
   * (ADR-0005, erstattet steg-definisjonen 2026-09-04 — `bailout.ts`s
   * `backoffS`). Nettopp derfor er denne testen fortsatt et stoppkriterium
   * og ikke en detalj: hele poenget med den fysiske definisjonen er at
   * felle-settet IKKE skal være følsomt for oppløsningen. Endrer settet seg
   * mellom 3600 s og 1800 s, er enten definisjonen eller fiksturen feil, og
   * det skal avgjøres før tallet brukes til noe — ikke etterpå.
   *
   * Merk at testen nå måler noe strengere enn før: med steg-definisjonen var
   * backoffen «ett steg» i begge kjøringene og dermed *ulik fysisk tid* i de
   * to, så en likhet kunne like gjerne skyldes at feilpunktet lå langt fra
   * grensen. Nå er backoffen 1800 s i begge, og likheten er en reell
   * diskretiseringsuavhengighet.
   */
  function felleSett(timeStepS: number, mode: "pareto" | "korridor-skalar") {
    const fixture = s3FrontEnsemble();
    const options = { ...fixture.options, timeStepS };
    const r = planRoute({
      start: fixture.start,
      dest: fixture.dest,
      departEpochS: fixture.departEpochS,
      weather: fixture.control,
      mask: fixture.mask,
      boat: fixture.boat,
      options,
    });
    expect(r.reached).toBe(true);
    const route = r.steps.map((s) => ({ lat: s.lat, lon: s.lon }));
    const feller: string[] = [];
    for (const m of fixture.members) {
      const dom = trapVerdict(
        {
          route,
          departEpochS: fixture.departEpochS,
          weather: m.weather,
          mask: fixture.mask,
          boat: fixture.boat,
          options,
          harbours: HARBOURS,
          tubeNm: TUBE_NM,
        },
        mode,
      );
      if (dom.felle) feller.push(m.id);
    }
    return feller;
  }

  it("gir samme felle-sett under fasiten med 1800 s som med 3600 s", () => {
    expect(felleSett(1800, "pareto")).toEqual(felleSett(3600, "pareto"));
  }, 900_000);

  it("bevarer også diskrimineringen mot variant B ved halvert tidssteg", () => {
    const grovt = felleSett(3600, "korridor-skalar");
    const fint = felleSett(1800, "korridor-skalar");
    expect(fint).toEqual(grovt);
    // Og navigasjonsfellen skiller fortsatt B fra fasiten.
    expect(grovt).toContain(S3_NAV_TRAP_ID);
    expect(felleSett(3600, "pareto")).not.toContain(S3_NAV_TRAP_ID);
  }, 900_000);
});

// ========================================================== 6. variant-isolasjon

describe("§8.2 forkrav 6 — variant-isolasjon", () => {
  /**
   * Delt A\*-felt og delt Tub-bound er de to eneste avledede størrelsene
   * `planRoute` i det hele tatt kan ta imot utenfra (`RouteInput.field`,
   * `RouteInput.tubBoundS`). Målescriptet sender dem aldri, og
   * `e1-outcome.ts` har ingen kanal for dem. Testen beviser konsekvensen: en
   * fasit-kjøring gir samme svar uansett hva som er kjørt før den.
   */
  it("gir bit-identisk fasit uansett hva som er kjørt før", () => {
    const fixture = s4BohuslanEnsemble();
    const route = controlRoute(fixture);
    const member = fixture.members[3]!;
    const felles = {
      start: fixture.start,
      dest: fixture.dest,
      departEpochS: fixture.departEpochS,
      weather: member.weather,
      mask: fixture.mask,
      boat: fixture.boat,
      options: fixture.options,
      route,
      harbours: HARBOURS,
      tubeNm: TUBE_NM,
    } as const;

    const foer = JSON.stringify(memberOutcome({ ...felles, variant: "F" }));
    memberOutcome({ ...felles, variant: "A" });
    memberOutcome({ ...felles, variant: "B" });
    trapVerdict(felles, "korridor-skalar");
    trapVerdict(felles, "skalar");
    const etter = JSON.stringify(memberOutcome({ ...felles, variant: "F" }));
    expect(etter).toBe(foer);
  }, 120_000);
});
