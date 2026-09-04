/**
 * **Skademåling av delt Tub-bound — forhåndsregistrert** (`docs/specs/
 * robusthet.md` §5.3, §4.1, D8.2; fase 4a bølge 1).
 *
 * Panelet godtok delt Tub **kun** som *soft* bound med redningsvei, og
 * forhåndsregistrerte akseptkriteriet før koden fantes:
 *
 * > S-3 og S-7, 30 medlemmer, (a) uten delt Tub, (b) med soft delt Tub +
 * > redningsvei: **null** endring i klassifisering, bit-identiske
 * > `MemberSummary`.
 *
 * Det er et *sikkerhetskrav*, ikke et ytelseskrav. Tub-bounden beskjærer
 * endimensjonalt på tid (`rutemotor.md` §5.5), og kontrollens bound er
 * utledet fra et **annet værfelt** enn medlemmets. Et medlem som møter en
 * front kontrollen ikke hadde, kan være gjennomførbart på en rute som er
 * langsommere enn kontrollens bound tillater — bounden ville da produsert en
 * **falsk ugjennomførbarhet**, og gjennomførbarhetsandelen ville vært en
 * funksjon av en ytelsesoptimalisering. Derfor ventilen i §4.1: terminerer et
 * medlem uten `safety.reachesDestination` mens `diagnostics.pruned.bound > 0`,
 * er det **ikke bevist** ugjennomførbart, og søket kjøres om uten bound før
 * medlemmet klassifiseres.
 *
 * Testen måler tre ting og rapporterer dem i utskriften (det er selve
 * skademålingen — tallene skal leses, ikke bare være grønne):
 *
 *  1. **Klassifiseringsflipp:** skal være 0 (hard assertion).
 *  2. **Antall redningsveier:** hvor mange medlemmer ventilen faktisk måtte
 *     redde. Er tallet høyt, er delt Tub dyr, ikke billig.
 *  3. **Spart arbeid:** iterasjoner og etiketter med bound mot uten.
 *
 * Merk at *begge* kjøringene deler A\*-felt (`buildFieldForInput`). Det er
 * bevist nøytralt i `shared-field.test.ts`, og gjør at denne testen isolerer
 * Tub-en alene — akkurat som produksjonsoppsettet i §4.1.
 */
import { describe, expect, it } from "vitest";
import { memberInput } from "../test-fixtures/ensemble.js";
import type { EnsembleFixture } from "../test-fixtures/ensemble.js";
import { s3FrontEnsemble } from "../test-fixtures/ensemble-s3-front.js";
import { s7TwoRegimeEnsemble } from "../test-fixtures/ensemble-s7-two-regime.js";
import { rectMask } from "../test-fixtures/synthetic-mask.js";
import { constantWeather } from "../test-fixtures/synthetic-weather.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import type { RouteResult } from "./result.js";
import { buildFieldForInput, planRoute } from "./search.js";
import type { RouteInput } from "./search.js";

/**
 * Klassifiseringen i `robusthet.md` §3.2, som ren funksjon over ett resultat.
 *
 * Duplisert her med vilje: den endelige `classifyMember` bor i
 * `packages/robustness`, som `packages/routing` ikke får importere
 * (arkitekturgrensen). Skademålingen er et *forkrav* til den pakken og må
 * kunne kjøres før den finnes. Tabellen er kort nok til at en avvik-diff mot
 * spec-en er lesbar.
 */
type MemberKind =
  | "feasible"
  | "infeasible"
  | "inconclusive"
  | "error"
  /** Ikke klassifiserbar: bounden kan ha kuttet ruten. §4.1s ventil. */
  | "kjor-om";

/** Aborter som betyr «søket ga opp», ikke «været sa nei» (§3.2 rad 1). */
const SEARCH_ABORTS: ReadonlySet<string> = new Set([
  "labelCap",
  "iterationCap",
  "noExpandableLabels",
]);

/**
 * **§4.1s ventil, som rent predikat.**
 *
 * Dette — ikke klassifiseringstabellen — er utløseren for redningsveien:
 * «et medlem som terminerer uten `reachesDestination` mens
 * `pruned.bound > 0` er ikke bevist ugjennomførbart og kjøres om uten bound
 * **før** det klassifiseres». Predikatet er bevisst holdt utenfor
 * `classifyMember`, fordi det gjelder på et tidligere tidspunkt: det
 * bestemmer om vi i det hele tatt har et resultat å klassifisere.
 */
function needsRerunWithoutBound(r: RouteResult): boolean {
  return !r.safety.reachesDestination && r.diagnostics.pruned.bound > 0;
}

/**
 * Klassifiseringen i §3.2, i **tabellens egen radrekkefølge**.
 *
 * Rekkefølgen er beholdt bokstavelig, men den har en kjent skarp kant som
 * denne testen dokumenterer og fastholder (se testen «§3.2s radrekkefølge
 * gir `error` …» nederst): en *for stram* bound beskjærer hele fronten,
 * søket dør av `noExpandableLabels`, og `error`-raden treffer før
 * bound-raden. Utfallet blir da «beregningen feilet» der det som faktisk
 * skjedde var at bounden kuttet ruten.
 *
 * Det er ikke farlig i seg selv — `error` holdes utenfor nevneren i
 * `feasibleShare` (§3.3), så andelen blir ikke skjev — men det krymper
 * utvalget og kan utløse `tynt-utvalg` på feil grunnlag. I praksis fanges
 * tilfellet uansett av `needsRerunWithoutBound` over, som kjører medlemmet
 * om *før* klassifiseringen. Presedensspørsmålet er notert som åpent til
 * `packages/robustness` skriver den endelige `classifyMember`.
 */
function classifyMember(r: RouteResult): MemberKind {
  const reached = r.safety.reachesDestination;
  if (!reached && r.abortReason !== null && SEARCH_ABORTS.has(r.abortReason)) {
    return "error";
  }
  if (!reached && r.coverage.weather === "partial") return "inconclusive";
  if (!reached && r.diagnostics.pruned.bound > 0) return "kjor-om";
  return reached ? "feasible" : "infeasible";
}

/**
 * `MemberSummary`-projeksjonen §5.3 krever bit-identisk. Feltene er de
 * robusthetslaget faktisk regner på; `hourlyTrack` og `safetyVerdict` er
 * utelatt fordi de utledes av de samme `steps`/`safety` og ville gjort en
 * diff uleselig uten å legge til informasjon.
 */
interface MemberProjection {
  readonly durationS: number;
  readonly distanceNm: number;
  readonly beatS: number;
  readonly motorS: number;
  readonly nightS: number;
  readonly fuelL: number;
  readonly arrivalEpochS: number;
  readonly flags: number;
  readonly coverageWeather: "full" | "partial";
  readonly reachesDestination: boolean;
}

function project(r: RouteResult): MemberProjection {
  return {
    durationS: r.totals.durationS,
    distanceNm: r.totals.distanceNm,
    beatS: r.totals.beatS,
    motorS: r.totals.motorS,
    nightS: r.totals.nightS,
    fuelL: r.totals.fuelL,
    arrivalEpochS: r.totals.arrivalEpochS,
    flags: r.flags,
    coverageWeather: r.coverage.weather,
    reachesDestination: r.safety.reachesDestination,
  };
}

interface Damage {
  readonly flips: readonly string[];
  readonly summaryDiffs: readonly string[];
  readonly rescued: readonly string[];
  /** Medlemmer der ventilen ville slått til også UTEN delt Tub (egen bound). */
  readonly ownBoundCandidates: readonly string[];
  readonly kinds: ReadonlyMap<string, MemberKind>;
  readonly iterationsWithout: number;
  /** Kun FØRSTE pass med delt Tub — det bounden faktisk kjøpte. */
  readonly iterationsWith: number;
  /** Det redningsveiene kostet oppå første pass. */
  readonly iterationsRescue: number;
  readonly labelsWithout: number;
  readonly labelsWith: number;
  readonly labelsRescue: number;
  readonly tubBoundS: number | null;
}

/**
 * Kjører hele skademålingen for én fikstur.
 *
 * `controlTub` hentes fra kontrollens eget resultat — nøyaktig kanalen §4.1
 * beskriver. Kontrollen kjøres først, som i den progressive rekkefølgen.
 */
function measure(fixture: EnsembleFixture): Damage {
  const controlBase: RouteInput = {
    start: fixture.start,
    dest: fixture.dest,
    departEpochS: fixture.departEpochS,
    weather: fixture.control,
    mask: fixture.mask,
    boat: fixture.boat,
    options: fixture.options,
  };
  // Ett felt, delt av kontrollen og alle 30 medlemmene i BEGGE kjøringene.
  const field = buildFieldForInput(controlBase);
  const control = planRoute({ ...controlBase, field });
  const tubBoundS = control.diagnostics.tubBoundS;

  const flips: string[] = [];
  const summaryDiffs: string[] = [];
  const rescued: string[] = [];
  const ownBoundCandidates: string[] = [];
  const kinds = new Map<string, MemberKind>();
  /** Redningsveien kjøres ÉN gang for ekte; se kommentaren i løkken. */
  let rescueProven = false;
  let iterationsWithout = 0;
  let iterationsWith = 0;
  let iterationsRescue = 0;
  let labelsWithout = 0;
  let labelsWith = 0;
  let labelsRescue = 0;

  for (const member of fixture.members) {
    const base: RouteInput = { ...memberInput(fixture, member), field };

    // (a) uten delt Tub.
    const a = planRoute(base);
    const kindA = classifyMember(a);
    iterationsWithout += a.diagnostics.iterations;
    labelsWithout += a.diagnostics.labelsCreated;
    if (needsRerunWithoutBound(a)) ownBoundCandidates.push(member.id);

    // (b) med soft delt Tub, og §4.1s redningsvei når bounden kan ha løyet.
    const withTub = planRoute({ ...base, tubBoundS: tubBoundS ?? undefined });
    iterationsWith += withTub.diagnostics.iterations;
    labelsWith += withTub.diagnostics.labelsCreated;
    let b = withTub;
    if (needsRerunWithoutBound(withTub)) {
      rescued.push(member.id);
      // Redningsveien er per definisjon «samme søk uten den delte bounden»
      // — altså bokstavelig talt `base`, som (a) allerede kjørte. Vi kjører
      // den for ekte ÉN gang per fikstur for å bevise at veien faktisk gir
      // (a)s resultat tilbake, og gjenbruker (a) for resten: motorens
      // determinisme (samme input ⇒ bit-identisk resultat) er bevist i
      // `determinism-source.test.ts` og `properties.test.ts`, og 14 ekstra
      // fulle søk ville kjøpt oss den samme kunnskapen på nytt.
      if (!rescueProven) {
        rescueProven = true;
        const reddet = planRoute(base);
        expect(
          JSON.stringify(reddet),
          `${member.id}: redningsveien ga ikke (a)s resultat tilbake`,
        ).toBe(JSON.stringify(a));
      }
      // Redningsveien koster nøyaktig det (a) kostet — det er samme søk.
      iterationsRescue += a.diagnostics.iterations;
      labelsRescue += a.diagnostics.labelsCreated;
      b = a;
    }
    const kindB = classifyMember(b);
    kinds.set(member.id, kindA);
    if (kindA !== kindB) flips.push(`${member.id}: ${kindA} -> ${kindB}`);
    const pa = JSON.stringify(project(a));
    const pb = JSON.stringify(project(b));
    if (pa !== pb) summaryDiffs.push(`${member.id}:\n  a=${pa}\n  b=${pb}`);
  }

  return {
    flips,
    summaryDiffs,
    rescued,
    ownBoundCandidates,
    kinds,
    iterationsWithout,
    iterationsWith,
    iterationsRescue,
    labelsWithout,
    labelsWith,
    labelsRescue,
    tubBoundS,
  };
}

function report(name: string, d: Damage): void {
  const tally = new Map<MemberKind, number>();
  for (const kind of d.kinds.values()) {
    tally.set(kind, (tally.get(kind) ?? 0) + 1);
  }
  const pct = (without: number, withTub: number): string => {
    if (without === 0) return "n/a";
    const saved = (1 - withTub / without) * 100;
    return `${saved >= 0 ? "spart" : "EKSTRA"} ${Math.abs(saved).toFixed(1)} %`;
  };
  const lines = [
    `--- skademåling delt Tub: ${name} (robusthet.md §5.3) ---`,
    `kontrollens tubBoundS: ${d.tubBoundS === null ? "null" : `${(d.tubBoundS / 3600).toFixed(2)} t`}`,
    `medlemmer: ${d.kinds.size}`,
    `klassifisering (a): ${[...tally].map(([k, n]) => `${k}=${n}`).join(" ")}`,
    `klassifiseringsflipp: ${d.flips.length}`,
    `redningsveier (delt Tub): ${d.rescued.length}${d.rescued.length > 0 ? ` (${d.rescued.join(", ")})` : ""}`,
    `ventil-kandidater uten delt Tub (egen bound): ${d.ownBoundCandidates.length}`,
    `iterasjoner  uten Tub: ${d.iterationsWithout}` +
      `  |  1. pass m/Tub: ${d.iterationsWith} (${pct(d.iterationsWithout, d.iterationsWith)})` +
      `  |  + redning: ${d.iterationsRescue}` +
      `  =>  totalt ${d.iterationsWith + d.iterationsRescue} (${pct(d.iterationsWithout, d.iterationsWith + d.iterationsRescue)})`,
    `etiketter    uten Tub: ${d.labelsWithout}` +
      `  |  1. pass m/Tub: ${d.labelsWith} (${pct(d.labelsWithout, d.labelsWith)})` +
      `  |  + redning: ${d.labelsRescue}` +
      `  =>  totalt ${d.labelsWith + d.labelsRescue} (${pct(d.labelsWithout, d.labelsWith + d.labelsRescue)})`,
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

function assertNoDamage(name: string, d: Damage): void {
  expect(
    d.flips,
    `${name}: delt Tub endret klassifiseringen — §4.1s ventil holder ikke`,
  ).toEqual([]);
  expect(
    d.summaryDiffs,
    `${name}: MemberSummary er ikke bit-identisk med og uten delt Tub`,
  ).toEqual([]);
}

describe("delt Tub — skademåling (robusthet.md §5.3)", () => {
  it("S-3: 30 medlemmer, null flipp og bit-identisk sammendrag", () => {
    const d = measure(s3FrontEnsemble());
    report("S-3 frontpassasje", d);
    expect(d.kinds.size).toBe(30);
    assertNoDamage("S-3", d);
    // 61 fulle søk på full oppløsning: målt ~135 s alene på PC, men denne
    // filen kjører parallelt med resten av suiten og har målt over 300 s
    // under kjernekonkurranse. Taket er en sikkerhetsventil mot en hengende
    // kjøring, ikke et ytelsesbudsjett.
  }, 600_000);

  it("S-7: 30 medlemmer, null flipp og bit-identisk sammendrag", () => {
    const d = measure(s7TwoRegimeEnsemble());
    report("S-7 to-regime", d);
    expect(d.kinds.size).toBe(30);
    assertNoDamage("S-7", d);
  }, 600_000);

  /**
   * **Redningsveien må kunne utløses.** Kriteriet i §3.2 —
   * `pruned.bound > 0 && !reachesDestination` ⇒ «kjør om» — er verdiløst hvis
   * ingen fikstur noen gang treffer det: da ville testene over vært grønne
   * fordi ventilen aldri ble brukt, ikke fordi den virker.
   *
   * Målingen over viser at kontrollens *ekte* bound aldri var stram nok til
   * å felle et medlem i S-3 eller S-7 (0 redningsveier). Tilfellet tvinges
   * derfor fram med en **kunstig lav** `tubBoundS` på et lite, billig
   * scenario. Det er ikke juks: det er nøyaktig situasjonen §4.1 frykter —
   * en bound utledet fra et annet værfelt, for stram for dette medlemmet —
   * bare garantert framprovosert i stedet for overlatt til flaks.
   */
  it("redningsveien gir samme svar som uten bound når bounden er for stram", () => {
    // Åpent vann, konstant vind, 24 nm nordover: ruten er triviell og
    // gjennomførbar, så alt som skjer under er bounden alene.
    const base: RouteInput = {
      start: { lat: 58.0, lon: 10.6 },
      dest: { lat: 58.4, lon: 10.6 },
      departEpochS: 1781668800,
      weather: constantWeather({
        speedKn: 14,
        fromDeg: 270,
        validFromS: 1781668800 - 3600,
        validToS: 1781668800 + 86400,
      }),
      mask: rectMask(),
      boat: testBoat(),
      options: { headingStepDeg: 15, timeStepS: 3600 },
    };
    const uten = planRoute(base);
    expect(
      uten.safety.reachesDestination,
      "forutsetningen: ruten er gjennomførbar uten bound",
    ).toBe(true);

    // En halvtimes «seilingstid» er langt under den ekte (~3,5 t).
    const stram = planRoute({ ...base, tubBoundS: 1800 });
    expect(stram.safety.reachesDestination).toBe(false);
    expect(stram.diagnostics.pruned.bound).toBeGreaterThan(0);
    expect(
      needsRerunWithoutBound(stram),
      "ventilen i §4.1 skal slå til: bounden kan ha kuttet ruten",
    ).toBe(true);

    // Redningsveien: samme input uten bounden, og svaret er tilbake — ikke
    // bare «likt nok», men bit-identisk med baseline.
    const reddet = planRoute(base);
    expect(classifyMember(reddet)).toBe("feasible");
    expect(JSON.stringify(reddet)).toBe(JSON.stringify(uten));
    expect(JSON.stringify(project(reddet))).toBe(JSON.stringify(project(uten)));

    /**
     * Og her er den skarpe kanten i §3.2s radrekkefølge, fastholdt så den
     * ikke kan drive stille: hadde vi klassifisert `stram` direkte, ville
     * `error`-raden truffet først — bounden beskar hele fronten, og søket
     * døde av `noExpandableLabels`. Det er nettopp derfor ventilen kjøres
     * FØR klassifiseringen og ikke som en rad i den.
     */
    expect(stram.abortReason).toBe("noExpandableLabels");
    expect(classifyMember(stram)).toBe("error");
  }, 120_000);
});
