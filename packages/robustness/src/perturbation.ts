/**
 * Perturbasjon og følsomhet (`docs/specs/robusthet.md` §3.4, §4.4, D8.4 c).
 *
 * Denne pakken leverer kun REN planlegging (`perturbationPlan`) og REN
 * aggregering av allerede kjørte resultater (`summarizeSensitivity`).
 * Selve søkene — å bygge en `RouteInput` per plan-oppføring og kjøre
 * `planRoute`/`createSearch` — er appens ansvar (§4.4: «Søkene kjøres av
 * appen»). Ren og deterministisk: ingen I/O, ingen klokke, ingen
 * `Math.random`.
 *
 * ## Hvordan planen mappes på `RouteInput` (§4.4) — og hva motoren mangler
 *
 * `packages/routing/src/search.ts`s `RouteInput` har `boat: BoatModel` og
 * `weather: WeatherField`, men INGEN `cruisingFactor`- eller
 * `currentScale`-parameter noe sted i `RouteOptions`/`RouteInput`
 * (`packages/routing/src/{contracts,options,search}.ts` er lest i sin
 * helhet for denne leveransen). `BoatModel.boatSpeedKn` er dokumentert som
 * «allerede skalert med cruising-faktor og seilvalg» — cruising-faktoren
 * er altså ment å ligge INNE i `BoatModel`-implementasjonen, ikke som en
 * søkeparameter motoren tar imot.
 *
 * **`packages/polar` er per i dag et uimplementert plassholderpakke**
 * (`export const POLAR_PACKAGE_PLACEHOLDER`, `packages/polar/src/index.ts`)
 * — det finnes ingen fabrikkfunksjon å parametrisere med cruising-faktor
 * ennå. For at et `{ kind: "cruising", factor }`-oppføring i planen skal
 * kunne kjøres, må enten:
 *  1. `packages/polar` bygge en `BoatModel`-fabrikk som tar cruising-
 *     faktoren som parameter og skalerer `boatSpeedKn`s returverdi med
 *     den, ELLER
 *  2. `apps/pwa` (inntil polar-pakken finnes) dekorere den eksisterende
 *     `BoatModel`-instansen: `{ ...boat, boatSpeedKn: (tws, twa) =>
 *     factor * boat.boatSpeedKn(tws, twa) }`.
 *
 * For `{ kind: "current", factor }` finnes tilsvarende ingen skaleringsvei
 * i `WeatherField`-kontrakten: `current(lat, lon, epochS)` returnerer
 * `{ u, v }` direkte fra kilden. Appen må dekorere `RouteInput.weather`
 * med en `WeatherField` som viderefører `wind`/`waves`/alle andre felt
 * uendret, men multipliserer `current(...)`s `u` og `v` med faktoren (0,8
 * eller 1,2) før den returneres — `undefined` (utenfor dekning) skal
 * forbli `undefined`, ikke skaleres.
 *
 * Ingen av disse to dekoratorene finnes i `packages/routing` eller
 * `packages/polar` i dag — de er en forutsetning for at appen faktisk kan
 * KJØRE planen `perturbationPlan` returnerer, og bør bygges før D8.4
 * kobles inn i `apps/pwa`. Denne pakken tar ikke stilling til hvor de skal
 * bo (routing vs. polar vs. apps/pwa) — det er et valg for rutemotor-/
 * plattform-agenten.
 */
import type { MemberOutcome } from "./outcome.js";

/** Cruising-faktorer på kontrollen (§4.4). */
const CONTROL_CRUISING_FACTORS: readonly number[] = [0.85, 0.9, 0.95];
/** Strømskalering på kontrollen (§4.4). */
const CONTROL_CURRENT_FACTORS: readonly number[] = [0.8, 1.2];
/** Cruising-faktor på verste gjennomførbare medlem (kommutasjonsargumentet, §4.4). */
const WORST_MEMBER_CRUISING_FACTOR = 0.85;

export interface PerturbationPlanEntry {
  readonly kind: "cruising" | "current";
  readonly factor: number;
  readonly basis: "kontroll" | "verste-medlem";
}

/**
 * Bygger perturbasjonsplanen for valgt avgang (D8.4 c): fire søk på
 * kontrollen (cruising {0,85; 0,90; 0,95}, strøm {0,8; 1,2}) pluss — når
 * det finnes et gjennomførbart medlem — ett søk med cruising 0,85 på det
 * VERSTE gjennomførbare medlemmet (`worstFeasible`). `control` tas imot
 * for API-symmetri med `PerturbationRun` (som bærer `outcome` per kjøring)
 * og for framtidig bruk (f.eks. å utelate en faktor kontrollen selv
 * allerede er klassifisert med) — selve planen (kind/faktor/basis) er i
 * dag uavhengig av kontrollens faktiske verdier, kun av hvilke faktorer
 * §4.4 fastsetter.
 *
 * `worstFeasible: null` (ingen gjennomførbare medlemmer i ensemblet, eller
 * ikke funnet ennå) ⇒ planen har kun de fire kontroll-oppføringene.
 */
export function perturbationPlan(
  control: MemberOutcome,
  worstFeasible: MemberOutcome | null,
): readonly PerturbationPlanEntry[] {
  const plan: PerturbationPlanEntry[] = [];
  for (const factor of CONTROL_CRUISING_FACTORS) {
    plan.push({ kind: "cruising", factor, basis: "kontroll" });
  }
  for (const factor of CONTROL_CURRENT_FACTORS) {
    plan.push({ kind: "current", factor, basis: "kontroll" });
  }
  if (worstFeasible !== null) {
    plan.push({ kind: "cruising", factor: WORST_MEMBER_CRUISING_FACTOR, basis: "verste-medlem" });
  }
  return plan;
}

export interface PerturbationRun {
  readonly kind: "cruising" | "current";
  readonly factor: number;
  readonly basis: "kontroll" | "verste-medlem";
  readonly outcome: MemberOutcome;
}

export interface SensitivityReport {
  readonly runs: readonly PerturbationRun[];
  /** Kontroll gjennomførbar og MINST ÉN kontroll-basert perturbasjon ikke (§4.4, §3.4). */
  readonly conflict: boolean;
  readonly mostSensitive: "cruising" | "current" | null;
  readonly label: "basert på kontrollvær";
}

/**
 * Relativ spredning i `durationS` blant kjøringene av én `kind`
 * (`(maks − min) / min`), som mål på hvor følsomt utfallet er for akkurat
 * den perturbasjonstypen.
 *
 * **Valg (spec underspesifisert):** §4.4/§3.4 sier `mostSensitive` skal
 * være «kind med størst relativ endring i durationS vs basis», men
 * funksjonssignaturen (`summarizeSensitivity(runs, controlFeasible)`) gir
 * ingen egen referanse-/basisverdi å sammenligne MOT (kontrollens egen
 * uperturberte `durationS` er ikke et av argumentene). Tolket derfor som
 * «hvor mye SPRER utfallet seg innad i denne perturbasjonstypen» —
 * spredningen mellom kjøringene av samme `kind` ER nettopp det følsomhet
 * for den parameteren betyr når ingen ekstern basislinje er tilgjengelig.
 * `null` når færre enn to kjøringer av typen har et resultat (feilede
 * kjøringer uten `summary` telles ikke), eller når minste verdi er 0.
 */
function relativeChangeForKind(runs: readonly PerturbationRun[], kind: "cruising" | "current"): number | null {
  const durations: number[] = [];
  for (const run of runs) {
    if (run.kind !== kind) continue;
    // Kun gjennomførbare kjøringer har en seilingstid å sammenligne — en
    // inkonklusiv/ugjennomførbar `durationS` er ikke en ankomst (målt i
    // appen 2026-09-07: alle perturbasjoner inkonklusive ga «mest følsom:
    // båtfart» av ren støy).
    if (run.outcome.kind !== "feasible" || run.outcome.summary === null) continue;
    durations.push(run.outcome.summary.durationS);
  }
  if (durations.length < 2) return null;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  if (min === 0) return null;
  return (max - min) / min;
}

/**
 * Aggregerer perturbasjonskjøringene til en `SensitivityReport` (§3.4).
 * Perturbasjoner påvirker ALDRI trafikklyset — denne funksjonen produserer
 * kun presentasjonsdata for følsomhetslinjen.
 *
 * `conflict`: kontrollen er gjennomførbar, og minst én av de
 * KONTROLL-baserte perturbasjonene (`basis: "kontroll"`) er det ikke.
 * Verste-medlem-kjøringen telles bevisst ikke her — den tester en annen
 * hypotese (kommutasjonsargumentet: tåler den langsomste allerede
 * gjennomførbare båten enda lavere fart), ikke kontrollens egen robusthet.
 */
export function summarizeSensitivity(runs: readonly PerturbationRun[], controlFeasible: boolean): SensitivityReport {
  const conflict =
    controlFeasible && runs.some((run) => run.basis === "kontroll" && run.outcome.kind !== "feasible");

  const cruisingChange = relativeChangeForKind(runs, "cruising");
  const currentChange = relativeChangeForKind(runs, "current");
  let mostSensitive: "cruising" | "current" | null = null;
  if (cruisingChange !== null && currentChange !== null) {
    mostSensitive = cruisingChange >= currentChange ? "cruising" : "current";
  } else if (cruisingChange !== null) {
    mostSensitive = "cruising";
  } else if (currentChange !== null) {
    mostSensitive = "current";
  }

  return { runs, conflict, mostSensitive, label: "basert på kontrollvær" };
}
