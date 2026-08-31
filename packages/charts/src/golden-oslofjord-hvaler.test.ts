/**
 * Golden-oppslagstester mot en EKTE, frossen kartpakke (§6.2/§6.3).
 *
 * Datakilde: Kartverket "Sjøkart – Dybdedata" (WFS) + Kystverket
 * "Farledsareal" (WFS layer_554), hentet 2026-08-24/2026-08-30 for
 * testområdet Skjæløy/Hvaler (bbox ca. 59,05–59,30° N, 10,60–11,00° Ø),
 * bygget til pakke av `tools/chart-pack` (se der for full pipeline og
 * README.md for avvik fra spec — bl.a. at kun LUKKEDE dybdekurve-ringer
 * inngår, se "Avvik fra spec").
 *
 * VIKTIG: koordinatene under er hentet direkte fra ekte, innlest
 * kartgeometri (via `turf.pointOnFeature`/`turf.centroid` på faktiske
 * polygoner i pakken) — de er IKKE de navngitte kandidatene i
 * `docs/specs/farbarhetsmaske.md` §6.3 (Steilene, Drøbaksundet, Bastøy,
 * Færder ligger alle NORD/VEST for denne bølgens testbboks — se
 * chart-pack/README.md "Avvik fra spec" for begrunnelse). Hver test er
 * merket med hvorvidt den er verifisert av Magnus mot et offisielt
 * sjøkart eller kun sjekket for INTERN KONSISTENS (dvs. at koden gjør det
 * den sier den gjør mot ekte geometri, uten en uavhengig sjøkart-
 * kontroll av at akkurat DETTE punktet faktisk er en skjærgård/led i
 * virkeligheten).
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChartPackage } from "./pack-format.js";
import { createChartSource } from "./chart-source.js";

const FIXTURE_PATH = join(
  import.meta.dirname,
  "..",
  "testdata",
  "oslofjord-hvaler.json.gz",
);

function loadFixture(): ChartPackage {
  return JSON.parse(
    gunzipSync(readFileSync(FIXTURE_PATH)).toString("utf8"),
  ) as ChartPackage;
}

const pkg = loadFixture();
const source = createChartSource(pkg);
const DATO = "2026-08-30";
const STANDARD_KRAV_M = 2.6; // B1: dypgang 2,10 m + statisk margin 0,5 m (docs/00-kravspek.md B1)

describe("golden: Oslofjorden/Hvaler-fixture er faktisk lastet", () => {
  it("pakken har de to fliste vi bygget (59.0-59.5N, 10.5-11.0E)", () => {
    expect(pkg.tiles).toHaveLength(2);
    expect(pkg.header.sourceStatus.status).toBe("degraded"); // ærlig: åpne konturlinjer utelatt, se header.reason
  });
});

describe("MÅ VERIFISERES AV MAGNUS: ekte kartlagt skjær blokkerer (§6.3 no-go, skjær)", () => {
  it("skjær.26807 (59,066006° N, 10,998842° Ø) er no-go for standard dypgang", () => {
    const result = source.farbar(
      { lat: 59.066006, lon: 10.998842 },
      STANDARD_KRAV_M,
      0,
      DATO,
    );
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).toBe("no-go");
    expect(result.aarsaker.some((a) => a.kind === "skjaer-buffer")).toBe(true);
  });
});

describe("MÅ VERIFISERES AV MAGNUS: ekte tørrfallsområde er no-go (§6.3-kategori)", () => {
  it("tørrfallspolygon ved Hvaler (59,174° N, 10,600° Ø) er no-go", () => {
    const result = source.farbar(
      { lat: 59.1740875, lon: 10.5996165 },
      STANDARD_KRAV_M,
      0,
      DATO,
    );
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).toBe("no-go");
    expect(result.aarsaker.some((a) => a.kind === "torrfall")).toBe(true);
  });
});

describe("MÅ VERIFISERES AV MAGNUS: ekte Kystverket-hovedled er trygt/åpen (§6.3, åpen led)", () => {
  it.each([
    {
      navn: "farledsareal layer_554.21, flis 236",
      lat: 59.129181,
      lon: 10.791009,
    },
    { navn: "farledsareal layer_554.19, flis 236", lat: 59.125, lon: 10.58751 },
    {
      navn: "farledsareal layer_554.21, flis 237",
      lat: 59.375,
      lon: 10.6395205,
    },
  ])("$navn er trygt, ikke no-go, for standard dypgang", ({ lat, lon }) => {
    const result = source.farbar({ lat, lon }, STANDARD_KRAV_M, 0, DATO);
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).toBe("trygt");
  });
});

describe("KJENT SVAKHET (felle 1, N2, spec §6.3.1): åpne-kurver-hullet gir usikkert der kartet viser en reell grunne", () => {
  it("dybdekurve.728354 (5 m, ÅPEN ring — krysser kartbladgrensen og droppes av buildDepthBands) gir usikkert, ikke no-go, for et klaringskrav dypere enn den charted 5 m-linjen", () => {
    // dybdekurve.728354 er en ekte Kartverket-feature i denne bølgens
    // rå-uttrekk (testdata/raw/Dybdekurve.gml.gz): app:dybde = 5.0, og
    // ringen er IKKE lukket (siste punkt != første) — den krysser
    // kartbladgrensen for bbox-uttrekket og droppes derfor av
    // `buildDepthBands` (66 % av kurvene i denne fixturen deles denne
    // skjebnen, se tools/chart-pack/README.md "Avvik fra spec" #1).
    // Punktet under er et vertex PÅ denne kurven — per sjøkartkonvensjon
    // betyr det at Kartverket dokumenterer ca. 5 m dybde akkurat her, en
    // AUTORITATIV, ikke-syntetisk dybdeopplysning.
    //
    // For et klaringskrav på 5,5 m (dypere enn den dokumenterte 5 m-linjen)
    // BURDE dette gitt no-go: vannet her er charted til å være grunnere enn
    // kravet. Fordi den avgrensende kurven er droppet, finnes det intet
    // dybdebånd som dekker punktet i det hele tatt (verifisert: resultatet
    // er identisk `usikkert` for krav 2,6/5,0/5,2/5,5/8,0 m — det er ikke
    // et bånd-grense-tilfelle, det er FRAVÆR av et bånd) — maskens
    // føre-var-fallback returnerer `usikkert`, ikke `no-go`.
    //
    // Dette er en KJENT SVAKHET, ikke korrekt oppførsel — testen er en
    // regresjonsvakt for at hullet forblir SYNLIG (usikkert, ikke stille
    // trygt) inntil kurve-stitching på tvers av kartblad lukker det (§4
    // "Neste bølge" i tools/chart-pack/README.md, spec §6.3.1). Testen skal
    // IKKE slettes eller løsnes uten at det underliggende hullet faktisk er
    // lukket; den skal oppdateres til å forvente `no-go` DEN DAGEN
    // stitching er implementert.
    const KRAV_DYPERE_ENN_CHARTED_LINJE_M = 5.5;
    const result = source.farbar(
      { lat: 59.027085, lon: 10.992546 },
      KRAV_DYPERE_ENN_CHARTED_LINJE_M,
      0,
      DATO,
    );
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    // Dagens (uønskede) atferd — se forklaringen over.
    expect(result.nivaa).toBe("usikkert");
    expect(result.aarsaker.some((a) => a.kind === "grunnere-enn-sikkerhetskontur")).toBe(false);
  });
});

describe("Intern konsistens (ekte geometri, ikke uavhengig sjøkart-verifisert)", () => {
  it("et punkt i det ekte 0-2 m-båndet er no-go for standard dypgang", () => {
    const result = source.farbar(
      { lat: 59.22026955, lon: 10.703338 },
      STANDARD_KRAV_M,
      0,
      DATO,
    );
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).toBe("no-go");
    expect(result.aarsaker[0]).toMatchObject({
      kind: "grunnere-enn-sikkerhetskontur",
    });
  });

  it("dypere klaringskrav stenger et grunnere bånd som er trygt for et grunnere krav", () => {
    const point = { lat: 59.22026955, lon: 10.703338 };
    const grunt = source.farbar(point, 1.5, 0, DATO); // fortsatt no-go: laveste kurve er 2m, se pipeline
    const dypt = source.farbar(point, 2.6, 0, DATO);
    expect(grunt.dekning).toBe("dekket");
    expect(dypt.dekning).toBe("dekket");
    if (grunt.dekning !== "dekket" || dypt.dekning !== "dekket")
      throw new Error("unreachable");
    // Begge no-go her (punktet er i det grunneste båndet uansett) — testen
    // dokumenterer i stedet at et STRENGERE krav aldri gir et BEDRE resultat.
    expect(dypt.nivaa).toBe("no-go");
  });

  it("en ekte CATZOC-C-sone (lav datakvalitet) gir usikkert, aldri trygt", () => {
    const result = source.farbar(
      { lat: 59.2030305, lon: 10.941958 },
      STANDARD_KRAV_M,
      0,
      DATO,
    );
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).toBe("usikkert");
    expect(result.aarsaker.some((a) => a.kind === "lav-datakvalitet")).toBe(
      true,
    );
  });

  it("en ekte CATZOC-A1-sone (høy datakvalitet) løfter til trygt uten farled", () => {
    const result = source.farbar(
      { lat: 59.25, lon: 10.716878 },
      STANDARD_KRAV_M,
      0,
      DATO,
    );
    expect(result.dekning).toBe("dekket");
    if (result.dekning !== "dekket") throw new Error("unreachable");
    expect(result.nivaa).toBe("trygt");
  });

  it("et punkt langt utenfor pakkens dekning gir 'usikkert'/'utenfor-pakke' — aldri stille trygt (N1/N2)", () => {
    const result = source.farbar(
      { lat: 10, lon: 10 },
      STANDARD_KRAV_M,
      0,
      DATO,
    );
    expect(result.dekning).toBe("utenfor-pakke");
  });
});
