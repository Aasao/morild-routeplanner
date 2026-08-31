import { describe, expect, it } from "vitest";
import type {
  ChartPackage,
  ChartTilePayload,
  DepthBand,
  PackedPolygon,
  Ring,
} from "./index.js";
import { createChartSource, pointInPolygon, tileIdForPoint } from "./index.js";

const GRID = { lonStepDeg: 0.5, latStepDeg: 0.25 } as const;

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

function emptyTile(overrides: Partial<ChartTilePayload> = {}): ChartTilePayload {
  return {
    id: { lonIndex: 21, latIndex: 236 }, // dekker ca. 10.5-11.0E, 59.0-59.25N
    bands: [],
    dryFall: [],
    bufferedHazards: [],
    farled: [],
    dataQuality: [],
    airDraft: [],
    tss: [],
    protectedZones: [],
    ...overrides,
  };
}

function packageOf(tiles: ChartTilePayload[]): ChartPackage {
  return {
    header: {
      formatVersion: "1.0.0",
      producedAt: "2026-08-30T00:00:00Z",
      model: "test-fixture",
      init: "2026-08-30T00:00:00Z",
      resolution: "0.5x0.25",
      sourceStatus: { status: "ok" },
      boundingBox: [10.5, 59.0, 11.0, 59.25],
      tileGrid: GRID,
      tiles: tiles.map((t) => t.id),
      layers: [],
    },
    tiles,
  };
}

const DATO = "2026-08-30";

describe("tileIdForPoint / rutenettet (§3.1)", () => {
  it("plasserer et punkt i riktig flis gitt 0,5°x0,25°-rutenettet", () => {
    expect(tileIdForPoint(59.1, 10.7, GRID)).toEqual({ lonIndex: 21, latIndex: 236 });
    // 59.30N krysser til neste breddeflis (236*0.25=59.0, 237*0.25=59.25).
    expect(tileIdForPoint(59.3, 10.7, GRID)).toEqual({ lonIndex: 21, latIndex: 237 });
  });
});

describe("pointInPolygon med hull", () => {
  it("finner punkt i ytre ring, men ikke i hull", () => {
    const p = poly(rect(0, 0, 10, 10), rect(4, 4, 6, 6));
    expect(pointInPolygon({ lat: 1, lon: 1 }, p)).toBe(true);
    expect(pointInPolygon({ lat: 5, lon: 5 }, p)).toBe(false); // i hullet
    expect(pointInPolygon({ lat: 20, lon: 20 }, p)).toBe(false); // utenfor
  });
});

describe("§3.4 nøkkeltest: manglende mellomliggende kurve tvinger no-go", () => {
  it("3 m-sondering uten kurve mellom 2,6 og 5 m gir no-go for krav 2,6 m", () => {
    // Vi har KUN en 5 m-kurve kartlagt (ingen 2- eller 3 m-kurve). Bandet
    // [0,5] dekker derfor hele området — inkludert stedet der en 3 m-
    // sondering tilfeldigvis ligger. 3 m > 2,6 m i seg selv, men siden
    // nærmeste kartlagte kurve ≥ 2,6 m er 5 m-kurven, skal dette bli no-go.
    const band: DepthBand = { lowerBoundM: 0, upperBoundM: 5, polygons: [poly(rect(10.6, 59.05, 10.7, 59.15))] };
    const tile = emptyTile({ bands: [band] });
    const source = createChartSource(packageOf([tile]));

    const soundingLocation = { lat: 59.1, lon: 10.65 }; // inne i bandet, hvor 3 m ble målt
    const result = source.farbar(soundingLocation, 2.6, 0, DATO);

    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).toBe("no-go");
    expect(result.aarsaker.some((a) => a.kind === "grunnere-enn-sikkerhetskontur")).toBe(true);
  });

  it("samme punkt er trygt/usikkert (ikke no-go) for et krav dypere kurven ikke dekker", () => {
    // Krav på 4 m: 5 m-kurven er fortsatt nærmeste ≥ 4 m -> fortsatt no-go
    // (samme logikk). Testen dokumenterer grensen: kravet må være ≤ selve
    // kurveverdien pluss at punktet ligger UTENFOR bandet for å slippe unna.
    const band: DepthBand = { lowerBoundM: 5, upperBoundM: 10, polygons: [poly(rect(10.6, 59.05, 10.7, 59.15))] };
    const farled = { navn: "Test-led", polygon: poly(rect(10.6, 59.05, 10.7, 59.15)) };
    const tile = emptyTile({ bands: [band], farled: [farled] });
    const source = createChartSource(packageOf([tile]));

    const result = source.farbar({ lat: 59.1, lon: 10.65 }, 2.6, 0, DATO);
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    // Bandet er 5-10 m og sikkerhetskonturen for 2,6 m-krav finnes ikke i
    // dette bandet (upperBoundM=10 > ingen kartlagt kurve ≥ 2,6 finnes under
    // 10) — punktet er dypere enn kravet og løftes av farled til trygt.
    expect(result.nivaa).toBe("trygt");
  });
});

describe("tørrfall (§5, §3.4 steg 2)", () => {
  it("gir alltid no-go, uavhengig av klaringskrav", () => {
    const tile = emptyTile({ dryFall: [{ polygon: poly(rect(10.6, 59.05, 10.61, 59.06)) }] });
    const source = createChartSource(packageOf([tile]));
    const result = source.farbar({ lat: 59.055, lon: 10.605 }, 0.1, 0, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "no-go" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker[0]?.kind).toBe("torrfall");
  });
});

describe("skjær-buffer (§4 steg 4, standard 20 m)", () => {
  const bufferPolygon = poly(rect(10.6, 59.05, 10.6006, 59.0518)); // ~30x100 m boks rundt et punkt
  const tile = emptyTile({
    bufferedHazards: [{ kind: "skjaer", bufferRadiusM: 20, polygon: bufferPolygon }],
  });

  it("punkt innenfor buffer gir no-go", () => {
    const source = createChartSource(packageOf([tile]));
    const result = source.farbar({ lat: 59.051, lon: 10.6003 }, 2.6, 0, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "no-go" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker.some((a) => a.kind === "skjaer-buffer")).toBe(true);
  });

  it("punkt godt utenfor buffer er upåvirket av skjæret", () => {
    const source = createChartSource(packageOf([tile]));
    const result = source.farbar({ lat: 59.2, lon: 10.9 }, 2.6, 0, DATO);
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    // Ingen dybdebånd, ingen farled, ingen datakvalitet i fixturen -> usikkert
    // (føre-var), men aldri no-go fra skjæret.
    expect(result.aarsaker.some((a) => a.kind === "skjaer-buffer")).toBe(false);
  });
});

describe("tillitsløft: farled og datakvalitet (§3.4 steg 4)", () => {
  it("punkt i farled-polygon uten grunt bånd blir trygt", () => {
    const tile = emptyTile({ farled: [{ navn: "Hovedled", polygon: poly(rect(10.6, 59.05, 10.9, 59.2)) }] });
    const source = createChartSource(packageOf([tile]));
    const result = source.farbar({ lat: 59.1, lon: 10.7 }, 2.6, 0, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "trygt" });
  });

  it("god CATZOC-klasse (A1/A2/B) løfter til trygt uten farled", () => {
    const tile = emptyTile({
      dataQuality: [{ catzoc: "A1", polygon: poly(rect(10.6, 59.05, 10.9, 59.2)) }],
    });
    const source = createChartSource(packageOf([tile]));
    const result = source.farbar({ lat: 59.1, lon: 10.7 }, 2.6, 0, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "trygt" });
  });

  it("lav CATZOC-klasse (C/D/U) gir usikkert med riktig årsak", () => {
    const tile = emptyTile({
      dataQuality: [{ catzoc: "U", polygon: poly(rect(10.6, 59.05, 10.9, 59.2)) }],
    });
    const source = createChartSource(packageOf([tile]));
    const result = source.farbar({ lat: 59.1, lon: 10.7 }, 2.6, 0, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "usikkert" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker[0]?.kind).toBe("lav-datakvalitet");
  });

  it("ingen farled og ingen datakvalitet-dekning gir usikkert (føre-var, F1.3)", () => {
    const source = createChartSource(packageOf([emptyTile()]));
    const result = source.farbar({ lat: 59.1, lon: 10.7 }, 2.6, 0, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "usikkert" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker[0]?.kind).toBe("utenfor-farled-lav-tetthet");
  });
});

describe("dekning utenfor pakken (§5 fail-closed)", () => {
  it("punkt utenfor alle fliser gir 'utenfor-pakke', aldri stille 'trygt'", () => {
    const source = createChartSource(packageOf([emptyTile()]));
    const result = source.farbar({ lat: 10, lon: 10 }, 2.6, 0, DATO);
    expect(result.dekning).toBe("utenfor-pakke");
  });
});

describe("vernesone (§3.5, sesongbasert)", () => {
  const zone = {
    navn: "Sälskyddsområde (syntetisk)",
    regel: "no-go" as const,
    gyldigFraMD: "04-01",
    gyldigTilMD: "07-31",
    polygon: poly(rect(10.6, 59.05, 10.7, 59.1)),
  };

  it("no-go i sesong", () => {
    const source = createChartSource(packageOf([emptyTile({ protectedZones: [zone] })]));
    const result = source.farbar({ lat: 59.07, lon: 10.65 }, 2.6, 0, "2026-05-15");
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "no-go" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker.some((a) => a.kind === "vernesone-aktiv")).toBe(true);
  });

  it("utenfor sesong: som om laget ikke fantes (kun føre-var usikkert)", () => {
    const source = createChartSource(packageOf([emptyTile({ protectedZones: [zone] })]));
    const result = source.farbar({ lat: 59.07, lon: 10.65 }, 2.6, 0, "2026-12-24");
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "usikkert" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker.some((a) => a.kind === "vernesone-aktiv")).toBe(false);
  });
});

describe("TSS-krysningsvinkel (§3.5) — ingen trust-endring", () => {
  it("gir tssAnnotasjon med riktig lane, uten å endre no-go/trust", () => {
    const lane = { navn: "Skagen TSS (syntetisk)", aksebæringGrader: 45, polygon: poly(rect(10.6, 59.05, 10.9, 59.2)) };
    const tile = emptyTile({ tss: [lane], farled: [{ navn: "Hovedled", polygon: poly(rect(10.6, 59.05, 10.9, 59.2)) }] });
    const source = createChartSource(packageOf([tile]));

    const onAxis = source.farbar({ lat: 59.1, lon: 10.7 }, 2.6, 0, DATO);
    expect(onAxis.dekning).toBe("dekket");
    if (onAxis.dekning !== "dekket") throw new Error("unreachable");
    expect(onAxis.nivaa).toBe("trygt");
    expect(onAxis.tss).toEqual({ lane: "Skagen TSS (syntetisk)", aksebæringGrader: 45 });
  });
});

describe("luftspenn med uverifisert datum (§8, beslutning 2026-08-30)", () => {
  it("for lav klaring gir maks 'usikkert', aldri no-go, når datum ikke er K0", () => {
    const zone = {
      navn: "Sotenkanalens bru (syntetisk)",
      friHoydeM: 18,
      datum: "ukjent" as const,
      polygon: poly(rect(10.6, 59.05, 10.7, 59.1)),
    };
    const tile = emptyTile({
      airDraft: [zone],
      farled: [{ navn: "Hovedled", polygon: poly(rect(10.6, 59.05, 10.7, 59.1)) }],
    });
    const source = createChartSource(packageOf([tile]));
    const result = source.farbar({ lat: 59.07, lon: 10.65 }, 2.6, 20, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "usikkert" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker.some((a) => a.kind === "for-lav-luftspenn")).toBe(true);
  });

  it("moderne høybru (kontroll) med god klaring endrer ikke nivået", () => {
    const zone = {
      navn: "Svinesundsbroen (syntetisk kontroll)",
      friHoydeM: 45,
      datum: "K0" as const,
      polygon: poly(rect(10.6, 59.05, 10.7, 59.1)),
    };
    const tile = emptyTile({
      airDraft: [zone],
      farled: [{ navn: "Hovedled", polygon: poly(rect(10.6, 59.05, 10.7, 59.1)) }],
    });
    const source = createChartSource(packageOf([tile]));
    const result = source.farbar({ lat: 59.07, lon: 10.65 }, 2.6, 20, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "trygt" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker.some((a) => a.kind === "for-lav-luftspenn")).toBe(false);
  });
});

describe("segmentTest — strengeste nivå + union av årsaker", () => {
  it("et segment som krysser en no-go-sone rapporterer no-go for hele segmentet", () => {
    const hazard = { kind: "skjaer" as const, bufferRadiusM: 20, polygon: poly(rect(10.69, 59.09, 10.71, 59.11)) };
    const tile = emptyTile({
      bufferedHazards: [hazard],
      farled: [{ navn: "Hovedled", polygon: poly(rect(10.6, 59.05, 10.9, 59.2)) }],
    });
    const source = createChartSource(packageOf([tile]));

    const result = source.segmentTest({ lat: 59.06, lon: 10.61 }, { lat: 59.15, lon: 10.85 }, 2.6, 0, DATO);
    expect(result).toMatchObject({ dekning: "dekket", nivaa: "no-go" });
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.aarsaker.some((a) => a.kind === "skjaer-buffer")).toBe(true);
  });
});

describe("nermesteFareAvstandNm", () => {
  it("returnerer null når ingen fare er registrert innenfor flisen", () => {
    const source = createChartSource(packageOf([emptyTile()]));
    expect(source.nermesteFareAvstandNm({ lat: 59.1, lon: 10.7 }, 2.6)).toBeNull();
  });

  it("finner nærmeste skjær-buffer med avstand og peiling", () => {
    const hazard = { kind: "skjaer" as const, bufferRadiusM: 20, polygon: poly(rect(10.7, 59.1, 10.71, 59.11)) };
    const source = createChartSource(packageOf([emptyTile({ bufferedHazards: [hazard] })]));
    const result = source.nermesteFareAvstandNm({ lat: 59.09, lon: 10.7 }, 2.6);
    expect(result).not.toBeNull();
    expect(result?.avstandNm).toBeGreaterThan(0);
  });
});
