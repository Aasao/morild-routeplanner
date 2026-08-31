/**
 * packages/charts — `ChartSource`-implementasjonen (spec §3.6).
 *
 * Ren, deterministisk, ingen I/O: konstrueres med en allerede innlest
 * `ChartPackage` (JSON parset av kallerkoden, se §3.6-invariantene i
 * spec-en). `dato` er alltid eksplisitt input, aldri systemklokke.
 */
import type { LatLon } from "@morild/geo";
import { bearing, haversineNm } from "@morild/geo";
import {
  distanceToSegmentNm,
  nearestPolygonPoint,
  pointInAnyPolygon,
  pointInPolygon,
  segmentEntirelyWithinAnyPolygon,
  segmentIntersectsAnyPolygon,
  segmentIntersectsPolygon,
} from "./point-in-polygon.js";
import type {
  BufferedHazardPoint,
  ChartPackage,
  ChartTilePayload,
  DepthBand,
  ProtectedZone,
  TrustLevel,
} from "./pack-format.js";
import { tileIdForPoint, tileIdToString } from "./pack-format.js";

export interface HazardReason {
  readonly kind:
    | "grunnere-enn-sikkerhetskontur"
    | "torrfall"
    | "skjaer-buffer"
    | "for-lav-luftspenn"
    | "vernesone-aktiv"
    | "lav-datakvalitet"
    | "utenfor-farled-lav-tetthet"
    | "utenlandsk-kilde-lav-tillit"
    | "ukjent-eller-uegnet-datum"
    | "gammel-pakke"
    | "usikker-sondering-i-baand";
  readonly detail: string;
  readonly sourceLayer: string;
}

export interface TssAnnotation {
  readonly lane: string;
  readonly aksebæringGrader: number;
}

export type FarbarhetResultat =
  | {
      readonly dekning: "dekket";
      readonly nivaa: TrustLevel;
      readonly aarsaker: readonly HazardReason[];
      readonly tss?: TssAnnotation;
    }
  | { readonly dekning: "utenfor-pakke"; readonly grunn: string };

export interface ChartSource {
  farbar(
    punkt: LatLon,
    kravTilDybdeM: number,
    kravTilLuftspennM: number,
    dato: string,
  ): FarbarhetResultat;

  segmentTest(
    fra: LatLon,
    til: LatLon,
    kravTilDybdeM: number,
    kravTilLuftspennM: number,
    dato: string,
  ): FarbarhetResultat;

  nermesteFareAvstandNm(
    punkt: LatLon,
    kravTilDybdeM: number,
  ): { readonly avstandNm: number; readonly retningGrader: number } | null;
}

const TRUST_RANK: Record<TrustLevel, number> = { trygt: 0, usikkert: 1, "no-go": 2 };

function worstTrust(a: TrustLevel, b: TrustLevel): TrustLevel {
  return TRUST_RANK[a] >= TRUST_RANK[b] ? a : b;
}

/** "MM-DD" → dagnummer i året (grovt, ingen skuddårs-presisjon nødvendig for sesongsjekk). */
function monthDayToOrdinal(md: string): number {
  const [monthStr, dayStr] = md.split("-");
  return Number(monthStr) * 31 + Number(dayStr);
}

/**
 * Er `dato` (ISO, "YYYY-MM-DD...") innenfor det årlig gjentagende
 * intervallet [gyldigFraMD, gyldigTilMD]? Håndterer intervaller som ikke
 * krysser årsskiftet (se TODO.md for årsskifte-begrensningen).
 */
function isDateInSeason(dato: string, zone: ProtectedZone): boolean {
  const md = dato.slice(5, 10); // "YYYY-MM-DD" -> "MM-DD"
  const d = monthDayToOrdinal(md);
  const from = monthDayToOrdinal(zone.gyldigFraMD);
  const to = monthDayToOrdinal(zone.gyldigTilMD);
  if (from <= to) return d >= from && d <= to;
  // Sesong som krysser årsskiftet (f.eks. nov–feb).
  return d >= from || d <= to;
}

/**
 * §3.4: finn nærmeste kartlagte kurve ≥ k. Kandidatverdiene er ALLE
 * bånd-grensene (både nedre og øvre) — ikke bare øvre grenser — fordi en
 * flis' bånd-liste ikke nødvendigvis er sammenhengende fra 0 (f.eks. ekte
 * data der 2 m-kurven mangler i denne flisen, men 5–10 m-bandet finnes):
 * en nedre grense som ikke er 0 ER en kartlagt kurve i seg selv.
 */
function safetyContourFor(bands: readonly DepthBand[], kravTilDybdeM: number): number | undefined {
  let best: number | undefined;
  const consider = (value: number) => {
    if (value >= kravTilDybdeM && (best === undefined || value < best)) best = value;
  };
  for (const band of bands) {
    consider(band.upperBoundM);
    if (band.lowerBoundM > 0) consider(band.lowerBoundM);
  }
  return best;
}

function findBand(point: LatLon, bands: readonly DepthBand[]): DepthBand | undefined {
  return bands.find((b) => pointInAnyPolygon(point, b.polygons));
}

/** §3.5 — CATZOC A1/A2/B regnes som "god datakvalitet" for tillitsløftet i §3.4 steg 4. */
function hasGoodDataQuality(tile: ChartTilePayload, point: LatLon): boolean {
  return tile.dataQuality.some(
    (z) => (z.catzoc === "A1" || z.catzoc === "A2" || z.catzoc === "B") && pointInPolygon(point, z.polygon),
  );
}

/**
 * Sondering-guardrail (byggetids-QA-validator promotert til guardrail,
 * beslutning 2026-08-31 — se
 * `docs/research/beslutningsgrunnlag-r3-e1-2026-08-31.md` og
 * `docs/specs/farbarhetsmaske.md` §3.4 «Guardrail for feilklassifiserte
 * bånd»). Bånd-delpolygonet en flagget sondering geometrisk ligger i kan
 * ALDRI gi `trygt` — maks `usikkert` — fordi bånd-inndelingen der er bevist
 * upålitelig (503/3913 = 12,9 % i fase 1-bølge 2-fixturen). Selve
 * sonderingspunktet er i tillegg blokkert strengere/presist som en egen
 * VALSOU-punktfare (§4 steg 4a i `tools/chart-pack`, se
 * `buildSoundingGuardrails`) — denne sonen dekker resten av delpolygonet som
 * ingen punktfare når.
 */
function inSoundingGuardrailZone(tile: ChartTilePayload, point: LatLon): boolean {
  return pointInAnyPolygon(
    point,
    tile.soundingGuardrail.map((z) => z.polygon),
  );
}

function findTile(pkg: ChartPackage, point: LatLon): ChartTilePayload | undefined {
  const id = tileIdForPoint(point.lat, point.lon, pkg.header.tileGrid);
  return pkg.tiles.find((t) => tileIdToString(t.id) === tileIdToString(id));
}

const METERS_PER_NM = 1852;

/**
 * Ligger punktet innenfor punktfarens buffer?
 *
 * **Eksakt sirkel når kilden har senterpunkt** (funn 2, code-review runde 2
 * 2026-08-31): `polygon` er turfs *innskrevne* polygon-tilnærming av sirkelen
 * (§4.1) og under-dekker den derfor mellom hjørnene — i sliveren mellom en
 * korde i tilnærmingen og den sanne sirkelbuen ville et punkt innenfor
 * `bufferRadiusM` blitt sluppet gjennom. `segmentTest()` bruker allerede
 * eksakt sirkelgeometri (`distanceToSegmentNm` mot `bufferRadiusM`); at
 * `farbar()` samtidig brukte polygonet gjorde punkt- og segmenttesten
 * uenige om den samme faren — og punkttesten var den mildeste av de to.
 *
 * Polygon-fallback beholdes for eldre/håndbygde fikstyrer uten senter-felt
 * (feltene er valgfrie kun av den grunnen, se `BufferedHazardPoint`).
 */
function pointWithinHazardBuffer(point: LatLon, hz: BufferedHazardPoint): boolean {
  if (hz.centerLat === undefined || hz.centerLon === undefined) {
    return pointInPolygon(point, hz.polygon);
  }
  return (
    haversineNm(point, { lat: hz.centerLat, lon: hz.centerLon }) <=
    hz.bufferRadiusM / METERS_PER_NM
  );
}

/** Kjernevurderingen for ett enkelt punkt — §3.4 steg 1–4 + §3.5 luftspenn/vernesone. */
function evaluatePoint(
  tile: ChartTilePayload,
  point: LatLon,
  kravTilDybdeM: number,
  kravTilLuftspennM: number,
  dato: string,
): { readonly nivaa: TrustLevel; readonly aarsaker: HazardReason[]; readonly tss?: TssAnnotation } {
  const aarsaker: HazardReason[] = [];
  let nivaa: TrustLevel = "trygt";

  // Steg 2: tørrfall og skjær/grunne-buffer — presise farer, alltid no-go.
  for (const zone of tile.dryFall) {
    if (pointInPolygon(point, zone.polygon)) {
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "torrfall",
        detail: "Punktet ligger i et tørrfallsområde (tørrlagt ved lavvann).",
        sourceLayer: "torrfall",
      });
      break;
    }
  }
  for (const hz of tile.bufferedHazards) {
    // Eksakt sirkel når kilden har senterpunkt — se `pointWithinHazardBuffer`.
    if (!pointWithinHazardBuffer(point, hz)) continue;
    if (hz.kind === "skjaer") {
      // Skjær har aldri dybdeattributt i kildedataene (verifisert, se
      // pack-format.ts) og er en presis punktfare uavhengig av dypgang —
      // uendret fra tidligere: alltid no-go.
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "skjaer-buffer",
        detail: `Punktet ligger innenfor ${hz.bufferRadiusM} m buffer rundt et kartlagt skjær.`,
        sourceLayer: "skjaer",
      });
      break;
    }
    // kind === "grunne": VALSOU-modellen (E4, beslutning 2026-08-31, §3.4).
    // No-go KUN når dybdeattributt mangler eller er grunnere enn kravet ved
    // oppslag — ellers ingen blokkering fra dette punktet (en 30 m-grunne
    // skal ikke sperre en 2,6 m-krav-rute; det var nettopp den falske
    // sperringen som undergravde tilliten til masken under den gamle
    // blank-no-go-regelen).
    if (hz.dybdeM === undefined) {
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "skjaer-buffer",
        detail: `Punktet ligger innenfor ${hz.bufferRadiusM} m buffer rundt en kartlagt grunne uten kjent dybde — VALSOU-regelen blokkerer ved manglende dybdeattributt.`,
        sourceLayer: "grunne",
      });
      break;
    }
    if (hz.dybdeM < kravTilDybdeM) {
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "skjaer-buffer",
        detail: `Punktet ligger innenfor ${hz.bufferRadiusM} m buffer rundt en kartlagt grunne på ${hz.dybdeM} m, grunnere enn krav ${kravTilDybdeM} m.`,
        sourceLayer: "grunne",
      });
      break;
    }
    // hz.dybdeM >= kravTilDybdeM: grunnen er dyp nok for dette kravet —
    // ingen blokkering fra denne punktfaren. Vurderingen fortsetter til
    // steg 3/4 (dybdebånd/tillitsløft) som normalt.
  }

  // Steg 3: dybdebånd mot sikkerhetskontur. Merk: hvis INGEN kartlagt kurve
  // dekker kravet (`c === undefined`) — enten fordi flisen mangler
  // dybdedata helt, eller fordi kravet overstiger den dypeste kartlagte
  // kurven — gjelder no-go-regelen i §3.4 steg 3 ikke bokstavelig (den
  // forutsetter et bånd å sammenligne mot). Det faller i stedet til steg 4s
  // føre-var-sjekk (farled/datakvalitet), som allerede aldri gir `trygt`
  // uten dokumentert grunnlag.
  const c = safetyContourFor(tile.bands, kravTilDybdeM);
  const band = c !== undefined ? findBand(point, tile.bands) : undefined;
  if (band && band.upperBoundM <= (c as number)) {
    nivaa = worstTrust(nivaa, "no-go");
    aarsaker.push({
      kind: "grunnere-enn-sikkerhetskontur",
      detail: `Punktet ligger i båndet ${band.lowerBoundM}–${band.upperBoundM} m, grunnere enn sikkerhetskonturen ${c} m (krav ${kravTilDybdeM} m).`,
      sourceLayer: "dybdebaand",
    });
  } else {
    // Utenfor kartlagte grunne bånd (eller ingen sikkerhetskontur å måle
    // mot) — sjekk tillitsløft (steg 4).
    if (nivaa !== "no-go") {
      const inFarled = pointInAnyPolygon(
        point,
        tile.farled.map((f) => f.polygon),
      );
      const goodQuality = hasGoodDataQuality(tile, point);
      const guardrailed = inSoundingGuardrailZone(tile, point);
      if ((inFarled || goodQuality) && !guardrailed) {
        nivaa = worstTrust(nivaa, "trygt");
      } else if ((inFarled || goodQuality) && guardrailed) {
        // Guardrail-cap (beslutning 2026-08-31): dette delpolygonet ville
        // normalt fått tillitsløft (farled/god datakvalitet), men er flagget
        // av byggetids-QA-validatoren — kan aldri gi `trygt`.
        nivaa = worstTrust(nivaa, "usikkert");
        aarsaker.push({
          kind: "usikker-sondering-i-baand",
          detail:
            "Punktet ligger i et bånd-delpolygon der en dybdepunkt-sondering er grunnere enn båndets nedre grense (byggetids-QA-guardrail) — kan ikke gis trygt selv med tillitsløft.",
          sourceLayer: "dybdebaand",
        });
      } else {
        nivaa = worstTrust(nivaa, "usikkert");
        const hasAnyQualityZone = tile.dataQuality.some((z) => pointInPolygon(point, z.polygon));
        aarsaker.push({
          kind: hasAnyQualityZone ? "lav-datakvalitet" : "utenfor-farled-lav-tetthet",
          detail: hasAnyQualityZone
            ? "Punktet ligger i en sone med lav kartlagt datakvalitet (CATZOC C/D/U)."
            : "Punktet ligger utenfor farled og uten dokumentert datakvalitet — føre-var-regelen (F1.3).",
          sourceLayer: "datakvalitet",
        });
      }
    }
  }

  // §3.5 Luftspenn — uverifisert datum caps ved "usikkert" (se pack-format.ts).
  for (const zone of tile.airDraft) {
    if (pointInPolygon(point, zone.polygon)) {
      if (zone.friHoydeM < kravTilLuftspennM) {
        nivaa = worstTrust(nivaa, "usikkert");
        aarsaker.push({
          kind: "for-lav-luftspenn",
          detail: `${zone.navn}: oppgitt fri høyde ${zone.friHoydeM} m < krav ${kravTilLuftspennM} m, men datum (${zone.datum}) er uverifisert — kan ikke heves til no-go.`,
          sourceLayer: "luftspenn",
        });
      }
      if (zone.datum !== "K0") {
        aarsaker.push({
          kind: "ukjent-eller-uegnet-datum",
          detail: `${zone.navn}: vertikal referanse (${zone.datum}) er ikke bekreftet sjøkartnull.`,
          sourceLayer: "luftspenn",
        });
      }
    }
  }

  // §3.5 Vernesone.
  for (const zone of tile.protectedZones) {
    if (pointInPolygon(point, zone.polygon) && isDateInSeason(dato, zone)) {
      nivaa = worstTrust(nivaa, zone.regel === "no-go" ? "no-go" : "usikkert");
      aarsaker.push({
        kind: "vernesone-aktiv",
        detail: `${zone.navn} er aktiv (${zone.gyldigFraMD}–${zone.gyldigTilMD}), regel: ${zone.regel}.`,
        sourceLayer: "vernesone",
      });
    }
  }

  // §3.5 TSS — ingen trust-endring, kun annotasjon.
  let tss: TssAnnotation | undefined;
  for (const lane of tile.tss) {
    if (pointInPolygon(point, lane.polygon)) {
      tss = { lane: lane.navn, aksebæringGrader: lane.aksebæringGrader };
      break;
    }
  }

  return tss ? { nivaa, aarsaker, tss } : { nivaa, aarsaker };
}

/**
 * Eksakt segmentvis ettersjekk (§6.4, R1-fiks code-review 2026-08-31) — samme
 * struktur som `evaluatePoint`, men hvert lag testes med kordens
 * (`fra`→`til`) faktiske geometri i stedet for et enkeltpunkt:
 *
 * - Tørrfall/dybdebånd: segment-mot-polygon-skjæring (`segmentIntersectsPolygon`/
 *   `-AnyPolygon`) — treffer polygonet HVOR SOM HELST langs korden, ikke bare
 *   ved forhåndsvalgte prøvepunkter.
 * - Skjær/grunne (punktfarer): avstand fra korden til kildepunktets
 *   `centerLon`/`centerLat` mot `bufferRadiusM` — eksakt sirkelgeometri,
 *   mer presis OG mer konservativt enn å teste mot den ferdig-bufrede
 *   polygon-tilnærmingen (§4.1). Faller tilbake til
 *   `segmentIntersectsPolygon` mot den bufrede polygonen for eldre/håndbygde
 *   fikstyrer uten senter-felt (se `BufferedHazardPoint`-kommentaren).
 * - Steg 4 (tillitsløft): `segmentEntirelyWithinAnyPolygon` — hele korden må
 *   ligge i farled/god datakvalitet for `trygt`; ellers `usikkert` (samme
 *   føre-var-retning som §3.4 steg 4 for enkeltpunkt).
 *
 * VALSOU-regelen (E4) gjelder identisk med `evaluatePoint`: en `Grunne` med
 * `dybdeM >= kravTilDybdeM` blokkerer ikke.
 */
function evaluateChordAgainstTile(
  tile: ChartTilePayload,
  fra: LatLon,
  til: LatLon,
  kravTilDybdeM: number,
  kravTilLuftspennM: number,
  dato: string,
): { readonly nivaa: TrustLevel; readonly aarsaker: HazardReason[]; readonly tss?: TssAnnotation } {
  const aarsaker: HazardReason[] = [];
  let nivaa: TrustLevel = "trygt";

  // Steg 2: tørrfall.
  for (const zone of tile.dryFall) {
    if (segmentIntersectsPolygon(fra, til, zone.polygon)) {
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "torrfall",
        detail: "Segmentet krysser et tørrfallsområde (tørrlagt ved lavvann).",
        sourceLayer: "torrfall",
      });
      break;
    }
  }

  // Steg 2: skjær/grunne-buffer — presise punktfarer, eksakt avstandstest.
  for (const hz of tile.bufferedHazards) {
    const withinBuffer =
      hz.centerLat !== undefined && hz.centerLon !== undefined
        ? distanceToSegmentNm({ lat: hz.centerLat, lon: hz.centerLon }, fra, til) <=
          hz.bufferRadiusM / METERS_PER_NM
        : segmentIntersectsPolygon(fra, til, hz.polygon);
    if (!withinBuffer) continue;
    if (hz.kind === "skjaer") {
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "skjaer-buffer",
        detail: `Segmentet passerer innenfor ${hz.bufferRadiusM} m buffer rundt et kartlagt skjær.`,
        sourceLayer: "skjaer",
      });
      break;
    }
    // kind === "grunne": VALSOU-modellen — se `evaluatePoint`.
    if (hz.dybdeM === undefined) {
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "skjaer-buffer",
        detail: `Segmentet passerer innenfor ${hz.bufferRadiusM} m buffer rundt en kartlagt grunne uten kjent dybde — VALSOU-regelen blokkerer ved manglende dybdeattributt.`,
        sourceLayer: "grunne",
      });
      break;
    }
    if (hz.dybdeM < kravTilDybdeM) {
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "skjaer-buffer",
        detail: `Segmentet passerer innenfor ${hz.bufferRadiusM} m buffer rundt en kartlagt grunne på ${hz.dybdeM} m, grunnere enn krav ${kravTilDybdeM} m.`,
        sourceLayer: "grunne",
      });
      break;
    }
    // hz.dybdeM >= kravTilDybdeM: ingen blokkering fra denne punktfaren.
  }

  // Steg 3: dybdebånd mot sikkerhetskontur — segmentet blokkerer hvis det
  // krysser et bånd grunnere enn konturen HVOR SOM HELST langs korden.
  const c = safetyContourFor(tile.bands, kravTilDybdeM);
  let inShallowBand = false;
  if (c !== undefined) {
    for (const band of tile.bands) {
      if (band.upperBoundM <= (c as number) && segmentIntersectsAnyPolygon(fra, til, band.polygons)) {
        inShallowBand = true;
        nivaa = worstTrust(nivaa, "no-go");
        aarsaker.push({
          kind: "grunnere-enn-sikkerhetskontur",
          detail: `Segmentet krysser båndet opp til ${band.upperBoundM} m, grunnere enn sikkerhetskonturen ${c} m (krav ${kravTilDybdeM} m).`,
          sourceLayer: "dybdebaand",
        });
      }
    }
  }

  if (!inShallowBand && nivaa !== "no-go") {
    const trustLiftPolygons = [
      ...tile.farled.map((f) => f.polygon),
      ...tile.dataQuality
        .filter((z) => z.catzoc === "A1" || z.catzoc === "A2" || z.catzoc === "B")
        .map((z) => z.polygon),
    ];
    const wouldBeTrygt = segmentEntirelyWithinAnyPolygon(fra, til, trustLiftPolygons);
    const guardrailed = tile.soundingGuardrail.some((z) =>
      segmentIntersectsPolygon(fra, til, z.polygon),
    );
    if (wouldBeTrygt && !guardrailed) {
      nivaa = worstTrust(nivaa, "trygt");
    } else if (wouldBeTrygt && guardrailed) {
      // Guardrail-cap (beslutning 2026-08-31) — se `evaluatePoint`.
      nivaa = worstTrust(nivaa, "usikkert");
      aarsaker.push({
        kind: "usikker-sondering-i-baand",
        detail:
          "Segmentet krysser et bånd-delpolygon der en dybdepunkt-sondering er grunnere enn båndets nedre grense (byggetids-QA-guardrail) — kan ikke gis trygt selv med tillitsløft.",
        sourceLayer: "dybdebaand",
      });
    } else {
      nivaa = worstTrust(nivaa, "usikkert");
      const hasAnyQualityZone = tile.dataQuality.some((z) => segmentIntersectsPolygon(fra, til, z.polygon));
      aarsaker.push({
        kind: hasAnyQualityZone ? "lav-datakvalitet" : "utenfor-farled-lav-tetthet",
        detail: hasAnyQualityZone
          ? "Segmentet krysser (helt eller delvis) en sone med lav kartlagt datakvalitet (CATZOC C/D/U)."
          : "Segmentet ligger (helt eller delvis) utenfor farled og uten dokumentert datakvalitet — føre-var-regelen (F1.3).",
        sourceLayer: "datakvalitet",
      });
    }
  }

  // §3.5 Luftspenn.
  for (const zone of tile.airDraft) {
    if (segmentIntersectsPolygon(fra, til, zone.polygon)) {
      if (zone.friHoydeM < kravTilLuftspennM) {
        nivaa = worstTrust(nivaa, "usikkert");
        aarsaker.push({
          kind: "for-lav-luftspenn",
          detail: `${zone.navn}: oppgitt fri høyde ${zone.friHoydeM} m < krav ${kravTilLuftspennM} m, men datum (${zone.datum}) er uverifisert — kan ikke heves til no-go.`,
          sourceLayer: "luftspenn",
        });
      }
      if (zone.datum !== "K0") {
        aarsaker.push({
          kind: "ukjent-eller-uegnet-datum",
          detail: `${zone.navn}: vertikal referanse (${zone.datum}) er ikke bekreftet sjøkartnull.`,
          sourceLayer: "luftspenn",
        });
      }
    }
  }

  // §3.5 Vernesone.
  for (const zone of tile.protectedZones) {
    if (segmentIntersectsPolygon(fra, til, zone.polygon) && isDateInSeason(dato, zone)) {
      nivaa = worstTrust(nivaa, zone.regel === "no-go" ? "no-go" : "usikkert");
      aarsaker.push({
        kind: "vernesone-aktiv",
        detail: `${zone.navn} er aktiv (${zone.gyldigFraMD}–${zone.gyldigTilMD}), regel: ${zone.regel}.`,
        sourceLayer: "vernesone",
      });
    }
  }

  // §3.5 TSS — ingen trust-endring, kun annotasjon.
  let tss: TssAnnotation | undefined;
  for (const lane of tile.tss) {
    if (segmentIntersectsPolygon(fra, til, lane.polygon)) {
      tss = { lane: lane.navn, aksebæringGrader: lane.aksebæringGrader };
      break;
    }
  }

  return tss ? { nivaa, aarsaker, tss } : { nivaa, aarsaker };
}

/**
 * Finner alle fliser korden (fra→til) faktisk krysser (ikke bare
 * endepunktenes fliser) — R1/R2-analog for oppslagstidspunktet: et langt
 * segment kan krysse flere fliser i rutenettet (§3.1), og hver av dem må
 * bidra sine egne lag til den eksakte ettersjekken.
 *
 * Metode: finn alle parameterverdier `t` der korden krysser en rutenett-
 * grenselinje (lengde- eller breddegrad), sorter dem, og slå opp flisen for
 * midtpunktet av hvert delintervall. Dette gir de eksakte flisene korden
 * passerer gjennom (ikke en over-approksimasjon via bounding box), med et
 * antall oppslag proporsjonalt med antall fliser krysset — typisk 1-3 for
 * et rutesegment, aldri et helt rutenett.
 *
 * `allCovered: false` betyr minst én del av korden mangler flisdekning —
 * fail-closed (§5): hele segmentet regnes da som `utenfor-pakke`, selv om
 * andre deler er dekket (samme prinsipp som det gamle sample-baserte
 * short-circuit-oppslaget).
 */
function tilesAlongSegment(
  pkg: ChartPackage,
  fra: LatLon,
  til: LatLon,
): { readonly tiles: readonly ChartTilePayload[]; readonly allCovered: boolean } {
  const grid = pkg.header.tileGrid;
  const dLon = til.lon - fra.lon;
  const dLat = til.lat - fra.lat;
  const breakpoints = new Set<number>([0, 1]);

  const addCrossings = (from: number, to: number, delta: number, step: number) => {
    if (delta === 0) return;
    const idxLo = Math.floor(Math.min(from, to) / step);
    const idxHi = Math.floor(Math.max(from, to) / step);
    for (let i = idxLo + 1; i <= idxHi; i++) {
      const t = (i * step - from) / delta;
      if (t > 0 && t < 1) breakpoints.add(t);
    }
  };
  addCrossings(fra.lon, til.lon, dLon, grid.lonStepDeg);
  addCrossings(fra.lat, til.lat, dLat, grid.latStepDeg);

  const sorted = [...breakpoints].sort((x, y) => x - y);
  const tiles = new Map<string, ChartTilePayload>();
  let allCovered = true;
  for (let i = 0; i < sorted.length - 1; i++) {
    const tLo = sorted[i] as number;
    const tHi = sorted[i + 1] as number;
    const tMid = (tLo + tHi) / 2;
    const midPoint: LatLon = { lat: fra.lat + dLat * tMid, lon: fra.lon + dLon * tMid };
    const tile = findTile(pkg, midPoint);
    if (tile) {
      tiles.set(tileIdToString(tile.id), tile);
    } else {
      allCovered = false;
    }
  }
  return { tiles: [...tiles.values()], allCovered };
}

export function createChartSource(pkg: ChartPackage): ChartSource {
  function farbar(
    punkt: LatLon,
    kravTilDybdeM: number,
    kravTilLuftspennM: number,
    dato: string,
  ): FarbarhetResultat {
    const tile = findTile(pkg, punkt);
    if (!tile) {
      return { dekning: "utenfor-pakke", grunn: `Ingen flis dekker (${punkt.lat}, ${punkt.lon}).` };
    }
    const { nivaa, aarsaker, tss } = evaluatePoint(
      tile,
      punkt,
      kravTilDybdeM,
      kravTilLuftspennM,
      dato,
    );
    return tss
      ? { dekning: "dekket", nivaa, aarsaker, tss }
      : { dekning: "dekket", nivaa, aarsaker };
  }

  /**
   * Eksakt segmentvis ettersjekk (§6.4, §2 — «autoritativ», R1-fiks
   * code-review 2026-08-31). Erstatter den tidligere 20-punkts samplingen:
   * en smal fare plassert mellom to gamle prøvepunkter kunne tidligere
   * passere uoppdaget (se `segmentTest — smal fare mellom prøvepunkter`-
   * testen i `index.test.ts`). Nå testes korden mot den faktiske
   * polygongeometrien (`evaluateChordAgainstTile`) i ALLE fliser den
   * faktisk krysser (`tilesAlongSegment`), ikke bare et fast antall
   * stikkprøver.
   */
  function segmentTest(
    fra: LatLon,
    til: LatLon,
    kravTilDybdeM: number,
    kravTilLuftspennM: number,
    dato: string,
  ): FarbarhetResultat {
    const { tiles, allCovered } = tilesAlongSegment(pkg, fra, til);
    if (!allCovered || tiles.length === 0) {
      return {
        dekning: "utenfor-pakke",
        grunn: `Minst én del av segmentet fra (${fra.lat}, ${fra.lon}) til (${til.lat}, ${til.lon}) mangler flisdekning.`,
      };
    }

    let nivaa: TrustLevel = "trygt";
    const aarsakerMap = new Map<string, HazardReason>();
    let tss: TssAnnotation | undefined;
    for (const tile of tiles) {
      const result = evaluateChordAgainstTile(tile, fra, til, kravTilDybdeM, kravTilLuftspennM, dato);
      nivaa = worstTrust(nivaa, result.nivaa);
      for (const reason of result.aarsaker) {
        aarsakerMap.set(`${reason.kind}:${reason.sourceLayer}`, reason);
      }
      if (result.tss) tss = result.tss;
    }
    const aarsaker = [...aarsakerMap.values()];
    return tss ? { dekning: "dekket", nivaa, aarsaker, tss } : { dekning: "dekket", nivaa, aarsaker };
  }

  function nermesteFareAvstandNm(
    punkt: LatLon,
    kravTilDybdeM: number,
  ): { readonly avstandNm: number; readonly retningGrader: number } | null {
    const tile = findTile(pkg, punkt);
    if (!tile) return null;

    let best: { readonly avstandNm: number; readonly retningGrader: number } | null = null;
    const consider = (candidate: { readonly avstandNm: number; readonly retningGrader: number } | null) => {
      if (candidate && (!best || candidate.avstandNm < best.avstandNm)) best = candidate;
    };

    // Tørrfall: polygonet ER den sanne faregeometrien (ikke en sirkel-
    // tilnærming) — edge-basert nærmeste-punkt er derfor korrekt og
    // konservativitets-trygt (§4.1, «Konservativitets-garanti»-avsnittet).
    for (const zone of tile.dryFall) {
      consider(nearestPolygonPoint(punkt, zone.polygon));
    }
    // Skjær/grunne: eksakt sirkelavstand (senter − radius) når kilden har
    // senter-felt — konsistent med `pointWithinHazardBuffer`/`segmentTest`.
    // Polygonet (innskrevet tilnærming, §4.1) UNDER-dekker den sanne
    // sirkelen, så avstand-til-polygon ville OVERESTIMERT avstand til
    // fare — kontraktsbrudd fikset her (konservativitets-garanti,
    // beslutning 2026-08-31). Polygon-fallback kun for eldre/håndbygde
    // fikstyrer uten senter-felt.
    for (const hz of tile.bufferedHazards) {
      if (hz.centerLat !== undefined && hz.centerLon !== undefined) {
        const center: LatLon = { lat: hz.centerLat, lon: hz.centerLon };
        const avstandNm = Math.max(
          0,
          haversineNm(punkt, center) - hz.bufferRadiusM / METERS_PER_NM,
        );
        consider({ avstandNm, retningGrader: bearing(punkt, center) });
      } else {
        consider(nearestPolygonPoint(punkt, hz.polygon));
      }
    }
    const c = safetyContourFor(tile.bands, kravTilDybdeM);
    if (c !== undefined) {
      for (const band of tile.bands) {
        if (band.upperBoundM <= c) {
          for (const poly of band.polygons) {
            consider(nearestPolygonPoint(punkt, poly));
          }
        }
      }
    }
    return best;
  }

  return { farbar, segmentTest, nermesteFareAvstandNm };
}
