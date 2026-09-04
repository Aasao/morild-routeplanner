/**
 * **Flisvalg-sikkerhetsregelen** (D7.2, vedtatt av Magnus 2026-09-04 etter
 * `/panel` — `docs/research/ekspertpanel-d7-vaerpakkeformat-2026-09-04.md`,
 * syntesens punkt 1; `docs/00-kravspek.md`-endringsloggen 2026-09-04).
 *
 * **Problemet panelet fant:** klienten valgte værfliser fra endepunktenes
 * bbox. Medlemsrutene i ensemblet bulker 9,6–17,6 nm ut fra luftlinjen, og
 * med 1°-fliser (≈ 33 nm) betyr det at en flis ruten faktisk trenger godt kan
 * ligge utenfor endepunkt-boksen. Mangler flisen, får motoren `undefined` fra
 * værfeltet, etiketten forkastes — og **søket styres da stille av
 * flisdekningen** i stedet for av været. Det er en sikkerhetsegenskap, ikke en
 * ytelsesdetalj: ruten kan bli en annen enn den beste uten at noe sier fra.
 *
 * **Regelen:** flissettet utledes fra **A\*-vannavstandsfeltets rekkevidde**
 * (§5.5) — feltet er væruavhengig, bygges før søket og er nøyaktig den
 * geometrien søket kan bevege seg innenfor. Er feltet utilgjengelig, faller
 * klienten tilbake på endepunkt-bboksen utvidet med minst
 * `FALLBACK_TILE_PAD_DEG` (`weatherTilesForBounds`), og en manglende flis
 * skal uansett gi flagget `VAERDEKNING_BEGRENSET` (`search.ts` teller
 * `pruned.noWeatherInWindow`, `reconstruct.ts` setter flagget) — forsvar i
 * dybden: valgregelen skal gjøre hullet usannsynlig, flagget skal gjøre det
 * umulig å skjule.
 *
 * Rent geometrisk og deterministisk, som resten av motoren: ingen I/O, ingen
 * kunnskap om pekere, blober eller nedlasting. Kalleren (`apps/pwa`s
 * `tile-select.ts`) slår flis-ID-ene opp i pekeren.
 */
import type { DistanceField } from "./distance-field.js";

/**
 * Flis-ID-konvensjonen fra `docs/specs/vaerpakker.md` §7, speilet her
 * (samme `Math.floor(v / steg)`-aritmetikk og samme `lonIndex_latIndex`-
 * streng som `tools/weather-pack/src/grid.ts`). Bevisst en speiling og ikke
 * en import: `packages/routing` importerer aldri byggeverktøy eller
 * værpakke-kode (arkitekturgrensen, `pnpm test:arch`). Endres konvensjonen i
 * §7, oppdateres begge i samme omgang — nøyaktig samme avtale som
 * `packages/weather`s `WeatherFieldLike`-speiling av `WeatherField`.
 */
export interface WeatherTileRef {
  /** `"{lonIndex}_{latIndex}"`, f.eks. `"5_28"` (§7). */
  readonly id: string;
  readonly lonIndex: number;
  readonly latIndex: number;
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface LonLatBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * Minste utvidelse av endepunkt-bboksen i fallback-regelen (D7.2). 0,5° er
 * ≈ 30 nm i bredde og ≈ 15 nm i lengde på 60°N — panelets «kontrollrute
 * + ≥ 30 nm»-krav, uttrykt i den enheten flisrutenettet bruker.
 */
export const FALLBACK_TILE_PAD_DEG = 0.5;

function tileRef(
  lonIndex: number,
  latIndex: number,
  tileSizeDeg: number,
): WeatherTileRef {
  return {
    id: `${lonIndex}_${latIndex}`,
    lonIndex,
    latIndex,
    west: lonIndex * tileSizeDeg,
    south: latIndex * tileSizeDeg,
    east: (lonIndex + 1) * tileSizeDeg,
    north: (latIndex + 1) * tileSizeDeg,
  };
}

function assertTileSize(tileSizeDeg: number): void {
  if (!Number.isFinite(tileSizeDeg) || tileSizeDeg <= 0) {
    throw new Error(
      `tileSizeDeg må være et positivt tall, fikk ${String(tileSizeDeg)}`,
    );
  }
}

/** Deterministisk rekkefølge: lengdeindeks, så breddeindeks. */
function sortRefs(refs: WeatherTileRef[]): readonly WeatherTileRef[] {
  refs.sort((a, b) =>
    a.lonIndex !== b.lonIndex
      ? a.lonIndex - b.lonIndex
      : a.latIndex - b.latIndex,
  );
  return refs;
}

/**
 * Alle fliser som overlapper en lon/lat-boks. Fallback-regelen i D7.2:
 * kalleren utvider endepunkt-bboksen med minst `FALLBACK_TILE_PAD_DEG` først
 * (se `padBounds`).
 */
export function weatherTilesForBounds(
  bounds: LonLatBounds,
  tileSizeDeg: number,
): readonly WeatherTileRef[] {
  assertTileSize(tileSizeDeg);
  const lonMin = Math.floor(bounds.west / tileSizeDeg);
  const lonMax = Math.floor(bounds.east / tileSizeDeg);
  const latMin = Math.floor(bounds.south / tileSizeDeg);
  const latMax = Math.floor(bounds.north / tileSizeDeg);
  const out: WeatherTileRef[] = [];
  for (let lonIndex = lonMin; lonIndex <= lonMax; lonIndex++) {
    for (let latIndex = latMin; latIndex <= latMax; latIndex++) {
      out.push(tileRef(lonIndex, latIndex, tileSizeDeg));
    }
  }
  return sortRefs(out);
}

/** Utvider en boks med minst `FALLBACK_TILE_PAD_DEG` (D7.2s fallback-regel). */
export function padBounds(
  bounds: LonLatBounds,
  padDeg: number = FALLBACK_TILE_PAD_DEG,
): LonLatBounds {
  const pad = Math.max(padDeg, FALLBACK_TILE_PAD_DEG);
  return {
    west: bounds.west - pad,
    south: bounds.south - pad,
    east: bounds.east + pad,
    north: bounds.north + pad,
  };
}

/**
 * Tidsskranken søket beskjærer med (§5.3 steg 10), oversatt til den
 * distanseskranken flisvalget kan bruke.
 */
export interface FieldTileBound {
  /**
   * Tub-bounden i sekunder (`RouteDiagnostics.tubBoundS`). `null` ⇒ ingen
   * tidsskranke: hele feltets nåbare vann tas med, som er den konservative
   * retningen (flere fliser, aldri færre).
   */
  readonly tubBoundS: number | null;
  /** Øvre fartsskranke i knop (`RouteDiagnostics.vmaxKn`, §5.5). */
  readonly vmaxKn: number;
  /** Som `RouteOptions.boundSlack` (standard 1,09). */
  readonly boundSlack?: number;
  /** Som `RouteOptions.tubMarginFrac` (standard 0,25). */
  readonly tubMarginFrac?: number;
}

/**
 * Største gjenværende feltdistanse (nm) en etikett kan ha og fortsatt
 * overleve Tub-beskjæringen.
 *
 * Søkets test (§5.3 steg 10) forkaster når
 * `tS + D·3600/(boundSlack·Vmax) > Tub·(1 + tubMarginFrac)`. Med `tS ≥ 0` er
 * `D ≤ boundSlack·Vmax·Tub·(1 + tubMarginFrac)/3600` en **nødvendig**
 * betingelse for at en etikett i cellen i det hele tatt kan overleve — altså
 * er flissettet vi utleder av den en overmengde av det søket kan trenge.
 * Nøyaktig den retningen sikkerhetsregelen krever.
 */
export function tubReachNm(bound: FieldTileBound): number {
  if (bound.tubBoundS === null || !Number.isFinite(bound.tubBoundS)) {
    return Infinity;
  }
  if (!Number.isFinite(bound.vmaxKn) || bound.vmaxKn <= 0) return Infinity;
  const slack = bound.boundSlack ?? 1.09;
  const margin = bound.tubMarginFrac ?? 0.25;
  return (slack * bound.vmaxKn * bound.tubBoundS * (1 + margin)) / 3600;
}

/**
 * **Flissettet ruten kan trenge**, utledet av A\*-feltets rekkevidde.
 *
 * En celle teller med når feltverdien er endelig (nåbart vann) og — når en
 * Tub-bound er oppgitt — innenfor `tubReachNm`. Hver medregnet celle utvides
 * med **én cellebredde** i alle retninger før flisene slås opp: søket
 * aksepterer en posisjon hvis `atOrNear` finner en endelig verdi i
 * 3×3-nabolaget (v1s `atNear`, §5.5), så en ekspandert node kan ligge én
 * celle utenfor den endelige cellen — og der gjør motoren et væroppslag.
 *
 * Returnerer flisene i deterministisk rekkefølge (lengdeindeks, så
 * breddeindeks).
 */
export function weatherTilesForField(
  field: DistanceField,
  bound: FieldTileBound | null,
  tileSizeDeg: number,
): readonly WeatherTileRef[] {
  assertTileSize(tileSizeDeg);
  const { lat0, lon0, cellDeg, width, height, d } = field.toData();
  const reachNm = bound === null ? Infinity : tubReachNm(bound);

  const seen = new Set<number>();
  const out: WeatherTileRef[] = [];
  for (let iy = 0; iy < height; iy++) {
    for (let ix = 0; ix < width; ix++) {
      const v = d[iy * width + ix]!;
      if (!Number.isFinite(v) || v > reachNm) continue;
      // Cellens utstrekning, utvidet med én celle for `atNear` (se over).
      const west = lon0 + (ix - 1) * cellDeg;
      const east = lon0 + (ix + 2) * cellDeg;
      const south = lat0 + (iy - 1) * cellDeg;
      const north = lat0 + (iy + 2) * cellDeg;
      const lonMin = Math.floor(west / tileSizeDeg);
      const lonMax = Math.floor(east / tileSizeDeg);
      const latMin = Math.floor(south / tileSizeDeg);
      const latMax = Math.floor(north / tileSizeDeg);
      for (let lonIndex = lonMin; lonIndex <= lonMax; lonIndex++) {
        for (let latIndex = latMin; latIndex <= latMax; latIndex++) {
          // Nøkkelen er ren heltallsaritmetikk (ingen strengbygging i den
          // varme løkken): indeksene er små tall for jordas rutenett.
          const key = (lonIndex + 720) * 4096 + (latIndex + 720);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(tileRef(lonIndex, latIndex, tileSizeDeg));
        }
      }
    }
  }
  return sortRefs(out);
}
