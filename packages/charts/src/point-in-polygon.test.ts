/**
 * Direkte enhetstester for geometriprimitivene (funn 3, code-review runde 2
 * 2026-08-31).
 *
 * `segmentsIntersect`, `segmentIntersectsPolygon`,
 * `segmentEntirelyWithinAnyPolygon` og `distanceToSegmentNm` ble innført med
 * R1-fiksen og var kun dekket *indirekte*, gjennom `segmentTest()`. Det er for
 * tynt for kode som avgjør om et rutesegment er farbart: en degenerasjon
 * (kollineær overlapp, berøring i et endepunkt, tangering, punkt-segment) gir
 * ikke nødvendigvis utslag på et fikstur-nivå, men kan avgjøre svaret på ekte
 * kartgeometri. Testene under pinner hvert grensetilfelle eksplisitt, med den
 * valgte konvensjonen skrevet ut — «berøring teller som treff» er et
 * føre-var-valg (F1.3), ikke en tilfeldighet.
 *
 * Merk at primitivene opererer på rå `[lon, lat]`-grader (se
 * presisjonsmerknaden i `point-in-polygon.ts`); koordinatene under er derfor
 * valgt som enkle tall, ikke som realistiske posisjoner, unntatt der
 * avstanden i nautiske mil er selve poenget.
 */
import { describe, expect, it } from "vitest";
import type { PackedPolygon, Ring } from "./pack-format.js";
import {
  distanceToSegmentNm,
  pointInPolygon,
  segmentEntirelyWithinAnyPolygon,
  segmentIntersectsAnyPolygon,
  segmentIntersectsPolygon,
  segmentsIntersect,
} from "./point-in-polygon.js";

/** `[west, south, east, north]` → lukket ring, `[lon, lat]`-par. */
function rect(west: number, south: number, east: number, north: number): Ring {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

function poly(ring: Ring, ...holes: Ring[]): PackedPolygon {
  return { rings: [ring, ...holes] };
}

describe("segmentsIntersect", () => {
  it("finner ordinær kryssing på tvers", () => {
    expect(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
  });

  it("sier nei til to segmenter som ikke møtes", () => {
    expect(segmentsIntersect([0, 0], [1, 1], [5, 5], [6, 6])).toBe(false);
  });

  it("sier nei til parallelle, ikke-kollineære segmenter", () => {
    expect(segmentsIntersect([0, 0], [10, 0], [0, 1], [10, 1])).toBe(false);
  });

  it("sier nei til kollineære segmenter uten overlapp", () => {
    // Samme linje, men disjunkte intervaller.
    expect(segmentsIntersect([0, 0], [1, 0], [2, 0], [3, 0])).toBe(false);
  });

  describe("kollineær overlapp", () => {
    it("delvis overlapp teller som kryssing", () => {
      expect(segmentsIntersect([0, 0], [10, 0], [5, 0], [15, 0])).toBe(true);
    });

    it("full inneslutning teller som kryssing", () => {
      expect(segmentsIntersect([0, 0], [10, 0], [3, 0], [7, 0])).toBe(true);
      // …og symmetrisk, med argumentene byttet.
      expect(segmentsIntersect([3, 0], [7, 0], [0, 0], [10, 0])).toBe(true);
    });

    it("berøring i ett felles endepunkt teller som kryssing", () => {
      expect(segmentsIntersect([0, 0], [5, 0], [5, 0], [9, 0])).toBe(true);
    });

    it("gjelder også på skrå linjer", () => {
      expect(segmentsIntersect([0, 0], [4, 4], [2, 2], [6, 6])).toBe(true);
    });
  });

  describe("endepunkt på det andre segmentet (T-form)", () => {
    it("endepunkt midt på det andre segmentet teller som kryssing", () => {
      expect(segmentsIntersect([5, 0], [5, 5], [0, 0], [10, 0])).toBe(true);
    });

    it("endepunkt like ved, men ikke på, gir ingen kryssing", () => {
      expect(segmentsIntersect([5, 0.001], [5, 5], [0, 0], [10, 0])).toBe(
        false,
      );
    });
  });

  describe("degenererte segmenter (punkt)", () => {
    it("et punkt som ligger på segmentet teller som kryssing", () => {
      expect(segmentsIntersect([5, 0], [5, 0], [0, 0], [10, 0])).toBe(true);
    });

    it("et punkt utenfor segmentet gjør det ikke", () => {
      expect(segmentsIntersect([5, 1], [5, 1], [0, 0], [10, 0])).toBe(false);
      // Kollineært, men utenfor intervallet.
      expect(segmentsIntersect([11, 0], [11, 0], [0, 0], [10, 0])).toBe(false);
    });

    it("to like punkter møtes bare hvis de er samme punkt", () => {
      expect(segmentsIntersect([2, 3], [2, 3], [2, 3], [2, 3])).toBe(true);
      expect(segmentsIntersect([2, 3], [2, 3], [2, 4], [2, 4])).toBe(false);
    });
  });
});

describe("segmentIntersectsPolygon", () => {
  const square = poly(rect(0, 0, 10, 10));

  it("finner en kord som går tvers gjennom", () => {
    expect(
      segmentIntersectsPolygon({ lat: 5, lon: -5 }, { lat: 5, lon: 15 }, square),
    ).toBe(true);
  });

  it("finner en kord som starter inni og slutter utenfor", () => {
    expect(
      segmentIntersectsPolygon({ lat: 5, lon: 5 }, { lat: 5, lon: 15 }, square),
    ).toBe(true);
  });

  it("finner en kord som ligger helt inni (ingen kantkryssing)", () => {
    expect(
      segmentIntersectsPolygon({ lat: 3, lon: 3 }, { lat: 7, lon: 7 }, square),
    ).toBe(true);
  });

  it("sier nei til en kord som passerer helt utenom", () => {
    expect(
      segmentIntersectsPolygon(
        { lat: 20, lon: -5 },
        { lat: 20, lon: 15 },
        square,
      ),
    ).toBe(false);
  });

  it("tangent-berøring av et hjørne teller som treff (føre-var)", () => {
    // Korden går gjennom hjørnet (10, 10) uten å komme inn i arealet.
    expect(
      segmentIntersectsPolygon(
        { lat: 12, lon: 8 },
        { lat: 8, lon: 12 },
        square,
      ),
    ).toBe(true);
  });

  it("tangent langs en kant teller som treff (føre-var)", () => {
    // Korden ligger oppå toppkanten y = 10, kollineært med den.
    expect(
      segmentIntersectsPolygon(
        { lat: 10, lon: -5 },
        { lat: 10, lon: 15 },
        square,
      ),
    ).toBe(true);
  });

  it("returnerer false for et polygon uten ringer", () => {
    expect(
      segmentIntersectsPolygon({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, {
        rings: [],
      }),
    ).toBe(false);
  });

  describe("degenerert kord (punkt)", () => {
    it("et punkt inni polygonet er et treff", () => {
      expect(
        segmentIntersectsPolygon({ lat: 5, lon: 5 }, { lat: 5, lon: 5 }, square),
      ).toBe(true);
    });

    it("et punkt utenfor er det ikke", () => {
      expect(
        segmentIntersectsPolygon(
          { lat: 50, lon: 50 },
          { lat: 50, lon: 50 },
          square,
        ),
      ).toBe(false);
    });
  });

  describe("polygon med hull", () => {
    // Ytre 0..10, hull 4..6 — det fylte arealet er ringen mellom dem.
    const donut = poly(rect(0, 0, 10, 10), rect(4, 4, 6, 6));

    it("forutsetning: hullet er ikke en del av det fylte arealet", () => {
      expect(pointInPolygon({ lat: 5, lon: 5 }, donut)).toBe(false);
      expect(pointInPolygon({ lat: 1, lon: 1 }, donut)).toBe(true);
    });

    it("kord helt inne i hullet gir ingen treff", () => {
      expect(
        segmentIntersectsPolygon(
          { lat: 5, lon: 4.5 },
          { lat: 5, lon: 5.5 },
          donut,
        ),
      ).toBe(false);
    });

    it("kord som går fra hullet og ut gjennom det fylte arealet er et treff", () => {
      expect(
        segmentIntersectsPolygon({ lat: 5, lon: 5 }, { lat: 5, lon: 15 }, donut),
      ).toBe(true);
    });

    it("kord som bare berører hullkanten er et treff (dokumentert føre-var)", () => {
      // Kollineær med hullets nordkant (y = 6), inne i det fylte arealet på
      // begge sider — den dokumenterte tilnærmingen i
      // `segmentIntersectsPolygon` behandler hullkant-kryssing som treff.
      expect(
        segmentIntersectsPolygon(
          { lat: 6, lon: 4.5 },
          { lat: 6, lon: 5.5 },
          donut,
        ),
      ).toBe(true);
    });

    it("kord tvers over hele smultringen er et treff", () => {
      expect(
        segmentIntersectsPolygon({ lat: 5, lon: -5 }, { lat: 5, lon: 15 }, donut),
      ).toBe(true);
    });
  });

  describe("segmentIntersectsAnyPolygon", () => {
    it("er sann hvis minst ett polygon treffes", () => {
      const far = poly(rect(100, 100, 110, 110));
      expect(
        segmentIntersectsAnyPolygon(
          { lat: 5, lon: -5 },
          { lat: 5, lon: 15 },
          [far, square],
        ),
      ).toBe(true);
    });

    it("er usann for en tom liste", () => {
      expect(
        segmentIntersectsAnyPolygon({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, []),
      ).toBe(false);
    });
  });
});

describe("segmentEntirelyWithinAnyPolygon", () => {
  const square = poly(rect(0, 0, 10, 10));

  it("er sann når hele korden ligger inni ett polygon", () => {
    expect(
      segmentEntirelyWithinAnyPolygon(
        { lat: 2, lon: 2 },
        { lat: 8, lon: 8 },
        [square],
      ),
    ).toBe(true);
  });

  it("er usann når ett endepunkt ligger utenfor", () => {
    expect(
      segmentEntirelyWithinAnyPolygon(
        { lat: 5, lon: 5 },
        { lat: 5, lon: 15 },
        [square],
      ),
    ).toBe(false);
  });

  it("er usann når begge endepunktene er inne, men korden går ut og inn igjen", () => {
    // To adskilte kvadrater; korden hopper over gapet mellom dem.
    const west = poly(rect(0, 0, 4, 10));
    const east = poly(rect(6, 0, 10, 10));
    expect(
      segmentEntirelyWithinAnyPolygon(
        { lat: 5, lon: 2 },
        { lat: 5, lon: 8 },
        [west, east],
      ),
    ).toBe(false);
  });

  it("er usann når korden berører kanten (dokumentert falskt «usikkert»)", () => {
    // Endepunktene ligger inne, men korden er kollineær med sørkanten y = 0.
    // Den konservative regelen («ingen ringkant får krysses») slår inn — et
    // falskt «ikke helt innenfor», aldri et falskt «helt innenfor». Se §2.
    expect(
      segmentEntirelyWithinAnyPolygon(
        { lat: 0, lon: 2 },
        { lat: 0, lon: 8 },
        [square],
      ),
    ).toBe(false);
  });

  it("er usann når korden går gjennom et hull i polygonet", () => {
    const donut = poly(rect(0, 0, 10, 10), rect(4, 4, 6, 6));
    expect(
      segmentEntirelyWithinAnyPolygon(
        { lat: 5, lon: 1 },
        { lat: 5, lon: 9 },
        [donut],
      ),
    ).toBe(false);
  });

  it("er usann for en tom polygonliste", () => {
    expect(
      segmentEntirelyWithinAnyPolygon(
        { lat: 5, lon: 5 },
        { lat: 6, lon: 6 },
        [],
      ),
    ).toBe(false);
  });

  describe("degenerert kord (punkt)", () => {
    it("et punkt godt inne i polygonet er «helt innenfor»", () => {
      expect(
        segmentEntirelyWithinAnyPolygon(
          { lat: 5, lon: 5 },
          { lat: 5, lon: 5 },
          [square],
        ),
      ).toBe(true);
    });

    it("et punkt utenfor er det ikke", () => {
      expect(
        segmentEntirelyWithinAnyPolygon(
          { lat: 50, lon: 50 },
          { lat: 50, lon: 50 },
          [square],
        ),
      ).toBe(false);
    });
  });
});

/**
 * Referansemålestokken: ett bueminutt breddegrad. Per definisjon 1 nm, men
 * `haversineNm` bruker en middeljordradius, så tallet blir 1,00067 nm — vi
 * sammenligner derfor mot to desimaler og skriver avviket ut i stedet for å
 * late som det ikke finnes.
 */
const ONE_ARCMINUTE_NM = 1.0;

describe("distanceToSegmentNm", () => {
  it("måler vinkelrett avstand til segmentets indre", () => {
    const a = { lat: 59.0, lon: 10.0 };
    const b = { lat: 59.0, lon: 10.2 };
    // Ett bueminutt nord for segmentet, midt imellom endepunktene.
    const p = { lat: 59.0 + 1 / 60, lon: 10.1 };
    expect(distanceToSegmentNm(p, a, b)).toBeCloseTo(ONE_ARCMINUTE_NM, 2);
  });

  it("klipper til endepunktet når punktet ligger forbi segmentet", () => {
    const a = { lat: 59.0, lon: 10.0 };
    const b = { lat: 59.0, lon: 10.2 };
    // Rett vest for a — altså utenfor segmentets parameterintervall.
    const p = { lat: 59.0, lon: 10.0 - 1 / 60 / Math.cos((59 * Math.PI) / 180) };
    expect(distanceToSegmentNm(p, a, b)).toBeCloseTo(ONE_ARCMINUTE_NM, 2);
  });

  it("er null for et punkt som ligger på segmentet", () => {
    const a = { lat: 59.0, lon: 10.0 };
    const b = { lat: 59.0, lon: 10.2 };
    expect(distanceToSegmentNm({ lat: 59.0, lon: 10.1 }, a, b)).toBeCloseTo(
      0,
      9,
    );
  });

  it("er null i hvert av endepunktene", () => {
    const a = { lat: 59.0, lon: 10.0 };
    const b = { lat: 59.1, lon: 10.2 };
    expect(distanceToSegmentNm(a, a, b)).toBeCloseTo(0, 9);
    expect(distanceToSegmentNm(b, a, b)).toBeCloseTo(0, 9);
  });

  describe("degenerert segment (punkt)", () => {
    it("faller tilbake til rett punkt-til-punkt-avstand", () => {
      const a = { lat: 59.0, lon: 10.0 };
      const p = { lat: 59.0 + 1 / 60, lon: 10.0 };
      expect(distanceToSegmentNm(p, a, a)).toBeCloseTo(ONE_ARCMINUTE_NM, 2);
      expect(distanceToSegmentNm(a, a, a)).toBeCloseTo(0, 9);
    });
  });

  it("er symmetrisk i segmentets retning", () => {
    const a = { lat: 58.9, lon: 10.4 };
    const b = { lat: 59.1, lon: 10.7 };
    const p = { lat: 59.05, lon: 10.4 };
    expect(distanceToSegmentNm(p, a, b)).toBeCloseTo(
      distanceToSegmentNm(p, b, a),
      9,
    );
  });
});
