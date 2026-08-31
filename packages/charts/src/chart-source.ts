/**
 * packages/charts — `ChartSource`-implementasjonen (spec §3.6).
 *
 * Ren, deterministisk, ingen I/O: konstrueres med en allerede innlest
 * `ChartPackage` (JSON parset av kallerkoden, se §3.6-invariantene i
 * spec-en). `dato` er alltid eksplisitt input, aldri systemklokke.
 */
import type { LatLon } from "@morild/geo";
import {
  distanceToPolygonNm,
  nearestRingPoint,
  pointInAnyPolygon,
  pointInPolygon,
} from "./point-in-polygon.js";
import type {
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
    | "gammel-pakke";
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

function findTile(pkg: ChartPackage, point: LatLon): ChartTilePayload | undefined {
  const id = tileIdForPoint(point.lat, point.lon, pkg.header.tileGrid);
  return pkg.tiles.find((t) => tileIdToString(t.id) === tileIdToString(id));
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
    if (pointInPolygon(point, hz.polygon)) {
      nivaa = worstTrust(nivaa, "no-go");
      aarsaker.push({
        kind: "skjaer-buffer",
        detail: `Punktet ligger innenfor ${hz.bufferRadiusM} m buffer rundt et kartlagt ${hz.kind === "skjaer" ? "skjær" : "grunne"}.`,
        sourceLayer: hz.kind,
      });
      break;
    }
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
      if (inFarled || goodQuality) {
        nivaa = worstTrust(nivaa, "trygt");
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

  function segmentTest(
    fra: LatLon,
    til: LatLon,
    kravTilDybdeM: number,
    kravTilLuftspennM: number,
    dato: string,
    /** Antall interne prøvepunkter — enkel, deterministisk tilnærming for
     * v2.0 (ekte kant-mot-kant polygonoverlapp er en senere forbedring). */
    samples = 20,
  ): FarbarhetResultat {
    let nivaa: TrustLevel = "trygt";
    const aarsakerMap = new Map<string, HazardReason>();
    let tss: TssAnnotation | undefined;
    let dekket = false;

    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point: LatLon = {
        lat: fra.lat + (til.lat - fra.lat) * t,
        lon: fra.lon + (til.lon - fra.lon) * t,
      };
      const result = farbar(point, kravTilDybdeM, kravTilLuftspennM, dato);
      if (result.dekning === "utenfor-pakke") {
        return result;
      }
      dekket = true;
      nivaa = worstTrust(nivaa, result.nivaa);
      for (const reason of result.aarsaker) {
        aarsakerMap.set(`${reason.kind}:${reason.sourceLayer}`, reason);
      }
      if (result.tss) tss = result.tss;
    }

    if (!dekket) {
      return { dekning: "utenfor-pakke", grunn: "Tomt segment." };
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

    for (const zone of tile.dryFall) {
      consider(nearestRingPoint(punkt, zone.polygon.rings[0] ?? []));
    }
    for (const hz of tile.bufferedHazards) {
      consider(nearestRingPoint(punkt, hz.polygon.rings[0] ?? []));
    }
    const c = safetyContourFor(tile.bands, kravTilDybdeM);
    if (c !== undefined) {
      for (const band of tile.bands) {
        if (band.upperBoundM <= c) {
          for (const poly of band.polygons) {
            const d = distanceToPolygonNm(punkt, poly);
            const ring = poly.rings[0];
            if (ring) consider({ avstandNm: d, retningGrader: nearestRingPoint(punkt, ring)?.retningGrader ?? 0 });
          }
        }
      }
    }
    return best;
  }

  return { farbar, segmentTest, nermesteFareAvstandNm };
}
