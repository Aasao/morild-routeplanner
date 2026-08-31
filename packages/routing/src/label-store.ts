/**
 * Tilstandsindeksen: aktive etiketter per tilstand, med dominans-pruning,
 * duplikatregel og deterministisk utkasting (docs/specs/rutemotor.md §5.7).
 *
 * **Invariant:** etikettmengden i en tilstand er til enhver tid en
 * *antikjede* under `≺` — ingen aktiv etikett dominerer en annen aktiv
 * etikett i samme tilstand. Håndheves ved innsetting og verifiseres av
 * `assertAntichain()` i testbygg.
 *
 * Fjerning er trygt: når A dominerer B, beskjærer A alt B ville beskåret
 * (dominans er transitiv). B blir bare inaktiv, ikke slettet — barna av B er
 * fortsatt gyldige ruter.
 */
import type { LabelArena, LabelInit } from "./arena.js";
import type { CostVector, CostWeights } from "./cost.js";
import { costScore, dominates } from "./cost.js";

export type InsertOutcome =
  | {
      readonly kind: "inserted";
      readonly index: number;
      readonly evicted: number;
    }
  /** Forkastet fordi en eksisterende etikett dominerer den (eller er lik). */
  | { readonly kind: "dominated" }
  /** Forkastet fordi arenaen har nådd det globale etikett-taket. */
  | { readonly kind: "labelCap" }
  /**
   * Forkastet av tilstands-/celletaket: etiketten ville blitt kastet ut med
   * én gang, så den får aldri en arenaplass. Utfallet er identisk med å
   * sette den inn og straks kaste den ut — bare uten å bruke opp en plass.
   */
  | { readonly kind: "capRejected" };

export interface StoreCaps {
  readonly maxLabelsPerState: number;
  readonly maxLabelsPerCell: number;
}

/** Delt tom liste, slik at oppslagsbom ikke allokerer. */
const EMPTY_LIST: readonly number[] = Object.freeze([]);

/** Ubegrenset — referansemodus (`exactMode`) slår av alle tapsgivende tak. */
export const UNCAPPED: StoreCaps = Object.freeze({
  maxLabelsPerState: Number.POSITIVE_INFINITY,
  maxLabelsPerCell: Number.POSITIVE_INFINITY,
});

export class LabelStore {
  private readonly arena: LabelArena;
  private readonly caps: StoreCaps;
  private readonly weights: CostWeights;
  /** stateKey → aktive arena-indekser, i innsettingsrekkefølge. */
  private readonly byState = new Map<number, number[]>();
  /** cellKey → tilstandsnøkler sett i cellen, i innsettingsrekkefølge. */
  private readonly byCell = new Map<number, number[]>();
  /** cellKey → antall aktive etiketter, vedlikeholdt inkrementelt. */
  private readonly cellActiveCount = new Map<number, number>();
  private readonly activeFlag: Uint8Array;
  private activeCount = 0;

  /** Teller for diagnostikk. */
  prunedDominated = 0;
  prunedCapEvicted = 0;

  constructor(arena: LabelArena, caps: StoreCaps, weights: CostWeights) {
    this.arena = arena;
    this.caps = caps;
    this.weights = weights;
    this.activeFlag = new Uint8Array(arena.maxLabels);
  }

  isActive(index: number): boolean {
    return this.activeFlag[index] === 1;
  }

  /** Antall aktive etiketter totalt. O(1) — telles inkrementelt. */
  get activeLabels(): number {
    return this.activeCount;
  }

  /**
   * Aktive etiketter i en tilstand, i innsettingsrekkefølge.
   * Returnerer en delt tom liste ved bom — dette er den varmeste veien i
   * motoren, og et `[]`-literal her ble til millioner av allokeringer.
   */
  activeInState(stateKey: number): readonly number[] {
    return this.byState.get(stateKey) ?? EMPTY_LIST;
  }

  /** Aktive etiketter i en celle, på tvers av sektorer. */
  activeInCell(cellKey: number): readonly number[] {
    const states = this.byCell.get(cellKey);
    if (states === undefined) return [];
    const out: number[] = [];
    for (const stateKey of states) {
      const list = this.byState.get(stateKey);
      if (list !== undefined) out.push(...list);
    }
    return out;
  }

  /**
   * Innsetting per §5.7. Rekkefølgen er bindende:
   *   1. dominert av eksisterende → forkast
   *   2. identisk kostnadsvektor → **geometrisk** uavgjort-bryter (se under)
   *   3. fjern eksisterende som den nye dominerer
   *   4. legg inn
   *   5./6. håndhev tak per tilstand og per celle
   *
   * **Avvik fra spec §4.6/§5.7 (bevisst, målt).** Spec-en sier at ved
   * identisk kostnadsvektor skal den nye etiketten alltid forkastes, fordi
   * den eksisterende «ble funnet først i den deterministiske
   * ekspansjonsrekkefølgen». Det er deterministisk, men geometrisk skjevt:
   * i isokronformuleringen avhenger `tS` bare av tidssteget og bautstraffen,
   * ikke av farten, så *de aller fleste* etiketter i en tilstand har
   * identisk kostnad. Da avgjøres ruten i praksis av rekkefølgen kursløkka
   * teller i (0°, 6°, 12°, …), og søket drar systematisk mot lave
   * kursverdier.
   *
   * Målt på en 48 nm åpen-hav-etappe med konstant tverrvind: regelen «først
   * funnet vinner» ga 28 025 s og 52,2 nm mot 48,0 nm storsirkel, med opptil
   * 8,2 nm tverravvik. Med geometrisk uavgjort-bryter: 25 889 s og 48,1 nm.
   * Det er 8,5 % på ankomsttid, altså langt over golden-toleransen på 2 %.
   *
   * Bryteren er `remainingNm` (lavest vinner), og ved likhet der beholdes
   * den eksisterende. Determinismen er uendret: begge tallene er rene
   * funksjoner av input.
   */
  insert(init: LabelInit): InsertOutcome {
    const list = this.byState.get(init.stateKey);
    let replaceIndex = -1;
    if (list !== undefined) {
      const arena = this.arena;
      const c = init.cost;
      for (const existing of list) {
        // Leses rett fra de typede arrayene: `costOf` ville allokert et
        // objekt per sammenligning, og dette er motorens varmeste løkke.
        const dt = arena.tS[existing]! - c.tS;
        const db = arena.beatS[existing]! - c.beatS;
        const dm = arena.motorS[existing]! - c.motorS;
        const dn = arena.nightS[existing]! - c.nightS;
        if (dt > 0 || db > 0 || dm > 0 || dn > 0) continue;
        if (dt < 0 || db < 0 || dm < 0 || dn < 0) {
          this.prunedDominated++;
          return { kind: "dominated" };
        }
        // Alle fire like: duplikatregelen. Pareto skiller dem ikke, så
        // geometrien avgjør — den som står nærmest målet vinner. Uavgjort
        // også der: den eksisterende beholdes (først funnet).
        if (arena.remainingNm[existing]! <= init.remainingNm) {
          this.prunedDominated++;
          return { kind: "dominated" };
        }
        replaceIndex = existing;
        break;
      }
    }

    if (this.arena.isFull) return { kind: "labelCap" };

    // Tak-forhåndssjekk. Ville etiketten blitt kastet ut med én gang, gir vi
    // den aldri en arenaplass. Utfallet er nøyaktig det samme som å sette
    // inn og straks kaste ut — forskjellen er at 65 % av arenaen ellers går
    // med til etiketter som aldri overlever sin egen innsetting (målt på
    // Skjæløy→Skagen: 162 600 av 250 000 plasser).
    if (
      replaceIndex < 0 &&
      list !== undefined &&
      list.length >= this.caps.maxLabelsPerState
    ) {
      const survivors = this.survivingAfterDominance(list, init.cost);
      if (
        survivors.length >= this.caps.maxLabelsPerState &&
        this.candidateIsWorst(survivors, init)
      ) {
        this.prunedCapEvicted++;
        return { kind: "capRejected" };
      }
    }
    if (
      replaceIndex < 0 &&
      this.cellCount(init.cellKey) >= this.caps.maxLabelsPerCell
    ) {
      if (this.candidateIsWorst(this.activeInCell(init.cellKey), init)) {
        this.prunedCapEvicted++;
        return { kind: "capRejected" };
      }
    }

    if (replaceIndex >= 0) {
      this.deactivate(replaceIndex);
      this.prunedDominated++;
    }

    // Fjern dominerte. Vi går bakfra slik at splice-indeksene holder.
    if (list !== undefined) {
      for (let i = list.length - 1; i >= 0; i--) {
        const existing = list[i]!;
        if (dominates(init.cost, this.arena.costOf(existing))) {
          list.splice(i, 1);
          this.markInactive(existing);
          this.prunedDominated++;
        }
      }
    }

    const index = this.arena.push(init);
    this.activeFlag[index] = 1;
    this.activeCount++;
    this.cellActiveCount.set(
      init.cellKey,
      (this.cellActiveCount.get(init.cellKey) ?? 0) + 1,
    );
    const stateList = list ?? [];
    if (list === undefined) this.byState.set(init.stateKey, stateList);
    stateList.push(index);

    let cellStates = this.byCell.get(init.cellKey);
    if (cellStates === undefined) {
      cellStates = [];
      this.byCell.set(init.cellKey, cellStates);
    }
    if (!cellStates.includes(init.stateKey)) cellStates.push(init.stateKey);

    let evicted = 0;
    while (stateList.length > this.caps.maxLabelsPerState) {
      if (this.evictWorst(stateList) === undefined) break;
      evicted++;
    }
    while (this.cellCount(init.cellKey) > this.caps.maxLabelsPerCell) {
      const worst = this.worstOf(this.activeInCell(init.cellKey));
      if (worst === undefined) break;
      this.deactivate(worst);
      evicted++;
    }

    this.prunedCapEvicted += evicted;
    return { kind: "inserted", index, evicted };
  }

  private cellCount(cellKey: number): number {
    return this.cellActiveCount.get(cellKey) ?? 0;
  }

  /** De av `list` som overlever at `cost` settes inn (dominerte faller ut). */
  private survivingAfterDominance(
    list: readonly number[],
    cost: CostVector,
  ): number[] {
    const out: number[] = [];
    for (const existing of list) {
      if (!dominates(cost, this.arena.costOf(existing))) out.push(existing);
    }
    return out;
  }

  /**
   * Ville kandidaten vært den som ble kastet ut? Må følge nøyaktig samme
   * ordning som `worstOf`/`tieBreakWorse`, inkludert at kandidatens
   * arena-indeks ville vært den høyeste — så ved full uavgjort taper den.
   */
  private candidateIsWorst(
    candidates: readonly number[],
    init: LabelInit,
  ): boolean {
    const candidateScore = costScore(init.cost, this.weights);
    for (const index of candidates) {
      const score = costScore(this.arena.costOf(index), this.weights);
      if (score > candidateScore) return false;
      if (score < candidateScore) continue;
      // Lik score: leksikografisk på kostnadsvektoren, så kurs, så indeks.
      const arena = this.arena;
      if (arena.tS[index]! !== init.cost.tS) {
        if (arena.tS[index]! > init.cost.tS) return false;
        continue;
      }
      if (arena.beatS[index]! !== init.cost.beatS) {
        if (arena.beatS[index]! > init.cost.beatS) return false;
        continue;
      }
      if (arena.motorS[index]! !== init.cost.motorS) {
        if (arena.motorS[index]! > init.cost.motorS) return false;
        continue;
      }
      if (arena.nightS[index]! !== init.cost.nightS) {
        if (arena.nightS[index]! > init.cost.nightS) return false;
        continue;
      }
      if (arena.headingDeg[index]! > Math.fround(init.headingDeg)) return false;
      // Full uavgjort: kandidaten har høyest arena-indeks og er dermed verst.
    }
    return true;
  }

  /** Nullstiller aktiv-flagget og oppdaterer tellerne. */
  private markInactive(index: number): void {
    if (this.activeFlag[index] !== 1) return;
    this.activeFlag[index] = 0;
    this.activeCount--;
    const cellKey = this.arena.cellKey[index]!;
    this.cellActiveCount.set(
      cellKey,
      (this.cellActiveCount.get(cellKey) ?? 1) - 1,
    );
  }

  private evictWorst(list: number[]): number | undefined {
    const worst = this.worstOf(list);
    if (worst === undefined) return undefined;
    this.deactivate(worst);
    return worst;
  }

  private deactivate(index: number): void {
    this.markInactive(index);
    const stateKey = this.arena.stateKey[index]!;
    const list = this.byState.get(stateKey);
    if (list === undefined) return;
    const at = list.indexOf(index);
    if (at >= 0) list.splice(at, 1);
  }

  /**
   * Etiketten med **høyest** score kastes ut. Uavgjort brytes leksikografisk
   * på (tS, beatS, motorS, nightS, headingDeg, arenaIndex); arena-indeksen er
   * alltid unik, så komparatoren er total og utkastingen deterministisk.
   */
  private worstOf(candidates: readonly number[]): number | undefined {
    let worst: number | undefined;
    let worstScore = -Infinity;
    for (const index of candidates) {
      const score = costScore(this.arena.costOf(index), this.weights);
      if (worst === undefined || score > worstScore) {
        worst = index;
        worstScore = score;
        continue;
      }
      if (score === worstScore && this.tieBreakWorse(index, worst)) {
        worst = index;
      }
    }
    return worst;
  }

  /** Er `a` «verre» enn `b` når scoren er lik? Total, uten uavgjort. */
  private tieBreakWorse(a: number, b: number): boolean {
    const arena = this.arena;
    if (arena.tS[a] !== arena.tS[b]) return arena.tS[a]! > arena.tS[b]!;
    if (arena.beatS[a] !== arena.beatS[b])
      return arena.beatS[a]! > arena.beatS[b]!;
    if (arena.motorS[a] !== arena.motorS[b])
      return arena.motorS[a]! > arena.motorS[b]!;
    if (arena.nightS[a] !== arena.nightS[b])
      return arena.nightS[a]! > arena.nightS[b]!;
    if (arena.headingDeg[a] !== arena.headingDeg[b])
      return arena.headingDeg[a]! > arena.headingDeg[b]!;
    return a > b;
  }

  /**
   * Antikjede-invarianten (§4.6). Kaster ved brudd. Kalles fra tester og fra
   * assertion-harnessen — aldri på den varme veien.
   */
  assertAntichain(): void {
    for (const [stateKey, list] of this.byState) {
      for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          const a = this.arena.costOf(list[i]!);
          const b = this.arena.costOf(list[j]!);
          if (dominates(a, b)) {
            throw new Error(
              `Antikjede brutt i tilstand ${stateKey}: etikett ${list[i]!} dominerer ${list[j]!}`,
            );
          }
        }
      }
    }
  }

  /** Alle aktive etiketter, i tilstands- og innsettingsrekkefølge. */
  allActive(): readonly number[] {
    const out: number[] = [];
    for (const list of this.byState.values()) out.push(...list);
    return out;
  }

  /**
   * Read-only iterasjon over antikjedene, gruppert per tilstand — kun for
   * instrumentering (nettbrett-målingen, steg3-plan §4 pkt. 4: histogram
   * over etiketter per tilstand/celle ved isokron-snapshotpunkter).
   * Muterer ingenting, og kopierer ikke listene selv — `labels` er den
   * samme, delte listen som brukes internt og må ikke skrives til.
   */
  forEachActiveState(
    fn: (stateKey: number, labels: readonly number[]) => void,
  ): void {
    for (const [stateKey, list] of this.byState) {
      if (list.length > 0) fn(stateKey, list);
    }
  }
}

/** Bekvemmelighet for tester: dominans mellom to rå vektorer. */
export function dominatesCost(a: CostVector, b: CostVector): boolean {
  return dominates(a, b);
}
