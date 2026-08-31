import { describe, expect, it } from "vitest";
import { mulberry32 } from "../test-fixtures/seeded-random.js";
import { LabelArena, type LabelInit } from "./arena.js";
import type { CostVector } from "./cost.js";
import { NEUTRAL_SEARCH_WEIGHTS } from "./cost.js";
import { stateKeyOf } from "./domain.js";
import { LabelStore, UNCAPPED } from "./label-store.js";

const CAPS = { maxLabelsPerState: 4, maxLabelsPerCell: 12 };

function init(
  cost: CostVector,
  cellKey = 1000,
  sector = 0,
  overrides: Partial<LabelInit> = {},
): LabelInit {
  return {
    lat: 59,
    lon: 10,
    cost,
    headingDeg: 90,
    sector,
    tack: 0,
    parent: -1,
    flags: 0,
    cellKey,
    stateKey: stateKeyOf(cellKey, sector),
    remainingNm: 10,
    twsKn: 10,
    twdDeg: 270,
    bspKn: 6,
    hsM: 0,
    ...overrides,
  };
}

const c = (tS: number, beatS = 0, motorS = 0, nightS = 0): CostVector => ({
  tS,
  beatS,
  motorS,
  nightS,
});

function newStore(caps = CAPS): { arena: LabelArena; store: LabelStore } {
  const arena = new LabelArena(10_000);
  return {
    arena,
    store: new LabelStore(arena, caps, NEUTRAL_SEARCH_WEIGHTS),
  };
}

describe("LabelStore.insert", () => {
  it("forkaster en etikett som domineres av en eksisterende", () => {
    const { store } = newStore();
    expect(store.insert(init(c(1000, 0, 0, 0))).kind).toBe("inserted");
    expect(store.insert(init(c(2000, 100, 100, 100))).kind).toBe("dominated");
  });

  it("forkaster duplikater — den først funne vinner", () => {
    const { store, arena } = newStore();
    const first = store.insert(init(c(1000, 60, 0, 0)));
    expect(first.kind).toBe("inserted");
    expect(store.insert(init(c(1000, 60, 0, 0))).kind).toBe("dominated");
    expect(store.activeInState(stateKeyOf(1000, 0))).toEqual([
      first.kind === "inserted" ? first.index : -1,
    ]);
    expect(arena.count).toBe(1);
  });

  it("beholder ikke-dominerte avveininger side om side", () => {
    const { store } = newStore();
    store.insert(init(c(1000, 600, 0, 0)));
    store.insert(init(c(2000, 0, 0, 0)));
    expect(store.activeInState(stateKeyOf(1000, 0)).length).toBe(2);
  });

  it("deaktiverer eksisterende etiketter som den nye dominerer", () => {
    const { store, arena } = newStore();
    const old = store.insert(init(c(3000, 300, 300, 300)));
    if (old.kind !== "inserted") throw new Error("forventet innsetting");
    store.insert(init(c(1000, 0, 0, 0)));
    expect(store.isActive(old.index)).toBe(false);
    // Etiketten er borte fra den aktive listen, men lever i arenaen slik at
    // allerede ekspanderte barn beholder en gyldig forelderpeker.
    expect(arena.count).toBe(2);
    expect(arena.costOf(old.index).tS).toBe(3000);
  });

  it("sammenligner aldri etiketter i ulike tilstander", () => {
    const { store } = newStore();
    // Samme celle, ulik sektor: klart dominerende kostnad skal ikke fjerne
    // etiketten i den andre sektoren.
    const a = store.insert(init(c(5000, 500, 500, 500), 1000, 0));
    const b = store.insert(init(c(1000, 0, 0, 0), 1000, 3));
    if (a.kind !== "inserted" || b.kind !== "inserted") {
      throw new Error("forventet innsetting");
    }
    expect(store.isActive(a.index)).toBe(true);
    expect(store.isActive(b.index)).toBe(true);
  });

  it("holder antikjede-invarianten under vilkårlige innsettingssekvenser", () => {
    const rnd = mulberry32(4711);
    const { store } = newStore(UNCAPPED);
    for (let i = 0; i < 400; i++) {
      const cell = 1000 + Math.floor(rnd() * 3);
      const sector = Math.floor(rnd() * 8);
      store.insert(
        init(
          c(
            Math.floor(rnd() * 8) * 900,
            Math.floor(rnd() * 5) * 600,
            Math.floor(rnd() * 5) * 600,
            Math.floor(rnd() * 4) * 600,
          ),
          cell,
          sector,
        ),
      );
      store.assertAntichain();
    }
  });

  it("håndhever taket per tilstand", () => {
    const { store } = newStore();
    // Fem gjensidig ikke-dominerte etiketter → taket på 4 må bite.
    store.insert(init(c(1000, 4000, 4000, 4000)));
    store.insert(init(c(2000, 3000, 4000, 4000)));
    store.insert(init(c(3000, 2000, 4000, 4000)));
    store.insert(init(c(4000, 1000, 4000, 4000)));
    store.insert(init(c(5000, 0, 4000, 4000)));
    expect(store.activeInState(stateKeyOf(1000, 0)).length).toBe(4);
    expect(store.prunedCapEvicted).toBe(1);
  });

  it("kaster ut deterministisk — samme sekvens gir alltid samme utfall", () => {
    const run = (): readonly number[] => {
      const { store, arena } = newStore();
      for (let i = 0; i < 12; i++) {
        store.insert(init(c(1000 + i * 500, (11 - i) * 500, 0, 0)));
      }
      return store
        .activeInState(stateKeyOf(1000, 0))
        .map((index) => arena.costOf(index).tS);
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(run()).toEqual(first);
    expect(first.length).toBe(4);
  });

  it("håndhever taket per celle på tvers av sektorer", () => {
    const { store } = newStore({ maxLabelsPerState: 4, maxLabelsPerCell: 6 });
    for (let sector = 0; sector < 8; sector++) {
      store.insert(init(c(1000 + sector * 100, 0, 0, 0), 1000, sector));
    }
    expect(store.activeInCell(1000).length).toBe(6);
  });

  it("uten tak (referansemodus) beholdes alle ikke-dominerte etiketter", () => {
    const { store } = newStore(UNCAPPED);
    for (let i = 0; i < 20; i++) {
      store.insert(init(c(1000 + i * 500, (19 - i) * 500, 0, 0)));
    }
    expect(store.activeInState(stateKeyOf(1000, 0)).length).toBe(20);
  });

  it("melder labelCap når arenaen er full", () => {
    const arena = new LabelArena(2);
    const store = new LabelStore(arena, UNCAPPED, NEUTRAL_SEARCH_WEIGHTS);
    expect(store.insert(init(c(1000, 900, 0, 0))).kind).toBe("inserted");
    expect(store.insert(init(c(2000, 500, 0, 0))).kind).toBe("inserted");
    expect(store.insert(init(c(3000, 100, 0, 0))).kind).toBe("labelCap");
  });

  it("svekker ikke senere beskjæring når en dominert etikett fjernes", () => {
    const { store } = newStore(UNCAPPED);
    store.insert(init(c(3000, 300, 300, 300)));
    store.insert(init(c(1000, 100, 100, 100)));
    // Alt den fjernede ville beskåret, beskjærer den nye minst like hardt.
    expect(store.insert(init(c(3000, 300, 300, 300))).kind).toBe("dominated");
    expect(store.insert(init(c(2500, 250, 250, 250))).kind).toBe("dominated");
  });
});

describe("LabelStore.assertAntichain", () => {
  it("fanger et konstruert brudd", () => {
    const arena = new LabelArena(10);
    const store = new LabelStore(arena, UNCAPPED, NEUTRAL_SEARCH_WEIGHTS);
    store.insert(init(c(1000, 0, 0, 0)));
    // Vi jukser forbi insert() og setter en dominert etikett rett i arenaen,
    // for å vise at harnessen faktisk fanger et brudd.
    const sneaked = arena.push(init(c(2000, 100, 100, 100)));
    const list = store.activeInState(stateKeyOf(1000, 0)) as number[];
    list.push(sneaked);
    expect(() => store.assertAntichain()).toThrow(/Antikjede brutt/);
  });
});
