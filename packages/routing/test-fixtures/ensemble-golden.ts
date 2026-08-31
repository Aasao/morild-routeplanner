/**
 * **S-1, S-2 og S-4** som ensembler (måleplanens §2).
 *
 * De tre scenarioene finnes allerede som golden-fiksturer — samme geometri,
 * maske, båt og felt. Det som mangler for E1′ er medlemmene, og de lages her
 * med perturbasjonsfamilien i `perturbation.ts`. Vi bygger altså **ikke** nye
 * scenarier: vi gjenbruker den frosne inputen golden-testene allerede vokter,
 * slik at et avvik i målingen ikke kan komme av at fiksturen har flyttet seg.
 *
 * | fikstur | golden-scenario | hva ensemblet skal fange |
 * |---|---|---|
 * | S-1 | `skjaeloy-skagen-apent` | baseline, kjent slør-regime |
 * | S-2 | `ren-kryssetappe` | ikke-monotont kryssregime, 20–30° dreining |
 * | S-4 | `bohuslan-trange-sund` | sektor-/etikettregimet i skjærgård |
 *
 * Spredningen er valgt per scenario, ikke felles: S-2 er per konstruksjon
 * tidsuavhengig (konstant felt), så der er rotasjonen hele historien, mens
 * S-1 og S-4 har felt som varierer i både tid og rom.
 *
 * Ingen av de tre har harde forkastelser — de måler ankomst, myke dimensjoner
 * og topologi. Feller måles i S-3 og S-8.
 */
import type { EnsembleFixture, EnsembleMember } from "./ensemble.js";
import { memberId } from "./ensemble.js";
import { goldenScenarios } from "./golden-scenarios.js";
import { perturbationTable, perturbedField } from "./perturbation.js";
import type { PerturbationSpread } from "./perturbation.js";

const MEMBER_COUNT = 30;

interface GoldenEnsembleSpec {
  readonly name: string;
  readonly scenario: string;
  readonly purpose: string;
  readonly seed: number;
  readonly spread: PerturbationSpread;
}

const SPECS: readonly GoldenEnsembleSpec[] = Object.freeze([
  {
    name: "s1-slor-referanse",
    scenario: "skjaeloy-skagen-apent",
    purpose:
      "Baseline: v1s referansestrekk over åpent Skagerrak i slør. Ensemblet " +
      "er perturbasjoner av golden-feltet — det regimet vi kjenner best, og " +
      "det variantene minst av alt har lov til å være uenige om.",
    seed: 51_0001,
    spread: { timeShiftH: 9, rotationDeg: 25, speedScale: 0.22 },
  },
  {
    name: "s2-ren-kryssetappe",
    scenario: "ren-kryssetappe",
    purpose:
      "Målet rett mot vinden. Med ±28° dreining over medlemmene bytter " +
      "gunstig halseside side mellom medlemmene — det ikke-monotone regimet " +
      "måleplanens §2 ber om. Motoren er av (golden-fiksturens eget valg).",
    seed: 52_0002,
    spread: { timeShiftH: 6, rotationDeg: 28, speedScale: 0.25 },
  },
  {
    name: "s4-bohuslan-skjaergard",
    scenario: "bohuslan-trange-sund",
    purpose:
      "Smale sund mellom skjær. Her er tilstandsrommet trangest, kystbuffer " +
      "og sektorer binder, og et billigere søk har mest å tape. Spredningen " +
      "er moderat med vilje: fiksturen skal måle søkerommet, ikke om " +
      "medlemmene i det hele tatt kommer gjennom.",
    seed: 54_0004,
    spread: { timeShiftH: 6, rotationDeg: 20, speedScale: 0.2 },
  },
]);

function buildFromSpec(spec: GoldenEnsembleSpec): EnsembleFixture {
  const scenario = goldenScenarios().find((s) => s.name === spec.scenario);
  if (scenario === undefined) {
    throw new Error(`ukjent golden-scenario: ${spec.scenario}`);
  }
  const input = scenario.input;
  const table = perturbationTable(spec.seed, MEMBER_COUNT, spec.spread);

  /**
   * Avgangen flyttes fram med hele tidsskyv-spredningen.
   *
   * Golden-feltene er gyldige fra én time før *sin* avgang. Et medlem med
   * tidsskyv −9 t leser feltet ni timer tidligere enn kalenderen, og uten
   * denne forskyvningen ville det medlemmet stått uten værdata ved avgang —
   * altså blitt en degraderingstest i stedet for en spredningstest. Med
   * forskyvningen ligger hele perturbasjonsfamilien innenfor kildens
   * gyldighetsvindu, og skyvet kan være symmetrisk.
   */
  const departEpochS = input.departEpochS + spec.spread.timeShiftH * 3600;

  const members: EnsembleMember[] = table.map((p, index) => ({
    id: memberId(index),
    index,
    params: {
      timeShiftH: Math.round((p.timeShiftS / 3600) * 100) / 100,
      rotationDeg: p.rotationDeg,
      speedScale: p.speedScale,
      hsScale: p.hsScale,
    },
    weather: perturbedField(input.weather, p),
  }));

  return {
    name: spec.name,
    purpose: spec.purpose,
    start: input.start,
    dest: input.dest,
    departEpochS,
    mask: input.mask!,
    boat: input.boat,
    options: input.options ?? {},
    control: input.weather,
    members,
    // Perturbasjonsfamilien skalerer vinden med maks ~1,25 og sjøen med
    // ~1,4 — godt under båtens grenser i alle tre scenarioene.
    hardRejectionMemberIds: [],
  };
}

export function s1SlorEnsemble(): EnsembleFixture {
  return buildFromSpec(SPECS[0]!);
}

export function s2BeatEnsemble(): EnsembleFixture {
  return buildFromSpec(SPECS[1]!);
}

export function s4BohuslanEnsemble(): EnsembleFixture {
  return buildFromSpec(SPECS[2]!);
}
