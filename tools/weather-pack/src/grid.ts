/**
 * Fliser og subsetting-geometri (`docs/specs/vaerpakker.md` §7, §9.4).
 *
 * To rutenett, samme heltallsorigo:
 * - Værflisen: 2°x2° (§7, §18 pkt. 3) — samme origo-aritmetikk
 *   (`Math.floor(verdi / steg)`) som kartflisenes 0,5°x0,25°-rutenett
 *   (`packages/charts/src/pack-format.ts`), slik at begge alltid deler
 *   gradlinjer uten en egen oppslagstabell.
 * - Subflisen: <=32x32 NODER (§9 krav 8) på kildens native indeksgrid —
 *   IKKE en gradstørrelse. Brukes til (a) skala/offset-kvantisering per
 *   subflis og (b) kystsone/utaskjærs-klassifisering (§9.4) — samme geometri,
 *   to bruksområder, aldri to rutenett som kan komme i utakt.
 */

/**
 * **1° (fase 3 bølge 3A, D7.1 — endret fra 2°).** Ekspertpanelets D7-syntese
 * (`docs/research/ekspertpanel-d7-vaerpakkeformat-2026-09-04.md`) vedtok
 * dagens adaptive 8-bit-kvantisering ("format E") for bølge 3, men med
 * MINDRE fliser enn de opprinnelige 2° — halverer per-flis overhead ved
 * flisgrense (relevant for korridor-ruter som krysser 1-3 fliser) uten å
 * endre selve kvantiseringen. Fortsatt EN parameter (ingen kode andre
 * steder antar 2° hardkodet — `tileIdForLonLat`/`tilesOverlapping` tar
 * `tileSizeDeg` som eksplisitt parameter nettopp for at dette skulle være
 * én linje å endre, se historikken i `docs/specs/vaerpakker.md` §19).
 */
export const WEATHER_TILE_DEG = 1;
export const SUBTILE_MAX_NODES = 32;
/** §9.4: subflis klassifiseres kystsone hvis senterpunktet er <= 20 nm fra land. */
export const COASTAL_ZONE_THRESHOLD_NM = 20;

export interface WeatherTileId {
  readonly lonIndex: number;
  readonly latIndex: number;
}

export interface Bounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * Samme `Math.floor(v / steg)`-aritmetikk som kartflisene — delt origo (§7).
 * `tileSizeDeg` er en eksplisitt parameter (default `WEATHER_TILE_DEG`, §D6-C
 * 2026-09-03: kompresjonsspiken målte hvor mye en 1°-flisstørrelse ville
 * spare for Skjæløy–Skagen-korridoren, `docs/research/kompresjonsmaaling-
 * 2026-09-03.md` §2 — men LÅSER IKKE et nytt standardtall her. Å bytte
 * standard flisstørrelse er fortsatt bevisst én linje unna (endre
 * `WEATHER_TILE_DEG` selv), ikke gjort av denne bølgen).
 */
export function tileIdForLonLat(
  lon: number,
  lat: number,
  tileSizeDeg: number = WEATHER_TILE_DEG,
): WeatherTileId {
  return {
    lonIndex: Math.floor(lon / tileSizeDeg),
    latIndex: Math.floor(lat / tileSizeDeg),
  };
}

export function tileBounds(id: WeatherTileId, tileSizeDeg: number = WEATHER_TILE_DEG): Bounds {
  return {
    west: id.lonIndex * tileSizeDeg,
    south: id.latIndex * tileSizeDeg,
    east: (id.lonIndex + 1) * tileSizeDeg,
    north: (id.latIndex + 1) * tileSizeDeg,
  };
}

export function tileIdToString(id: WeatherTileId): string {
  return `${id.lonIndex}_${id.latIndex}`;
}

/** Alle fliser (§7, standardstørrelse `WEATHER_TILE_DEG`, se `tileIdForLonLat`) hvis grenser overlapper en gitt bbox (klientens rute-bbox eller batch-jobbens domene). */
export function tilesOverlapping(bbox: Bounds, tileSizeDeg: number = WEATHER_TILE_DEG): WeatherTileId[] {
  const lonMin = Math.floor(bbox.west / tileSizeDeg);
  const lonMax = Math.floor(bbox.east / tileSizeDeg);
  const latMin = Math.floor(bbox.south / tileSizeDeg);
  const latMax = Math.floor(bbox.north / tileSizeDeg);
  const out: WeatherTileId[] = [];
  for (let latIndex = latMin; latIndex <= latMax; latIndex++) {
    for (let lonIndex = lonMin; lonIndex <= lonMax; lonIndex++) {
      out.push({ lonIndex, latIndex });
    }
  }
  return out;
}

/** Et indeksvindu på kildens native (y,x)-grid — inklusive grenser, som OPeNDAPs `[start:stride:stop]`. */
export interface IndexWindow {
  readonly yStart: number;
  readonly yEnd: number; // inklusiv
  readonly xStart: number;
  readonly xEnd: number; // inklusiv
}

export interface SubtileWindow extends IndexWindow {
  readonly subtileRow: number;
  readonly subtileCol: number;
}

/**
 * Deler et indeksvindu i <=32x32-nodes subfliser (§7, §9 krav 8). Siste
 * rad/kolonne kan være mindre der bredden ikke deler jevnt — det er
 * eksplisitt tillatt i spec-en, ikke en feil å håndtere bort.
 */
export function computeSubtiles(
  window: IndexWindow,
  maxNodes: number = SUBTILE_MAX_NODES,
): SubtileWindow[] {
  if (maxNodes <= 0) {
    throw new Error(`maxNodes må være positivt, fikk ${maxNodes}`);
  }
  const out: SubtileWindow[] = [];
  let subtileRow = 0;
  for (let yStart = window.yStart; yStart <= window.yEnd; yStart += maxNodes) {
    const yEnd = Math.min(yStart + maxNodes - 1, window.yEnd);
    let subtileCol = 0;
    for (let xStart = window.xStart; xStart <= window.xEnd; xStart += maxNodes) {
      const xEnd = Math.min(xStart + maxNodes - 1, window.xEnd);
      out.push({ yStart, yEnd, xStart, xEnd, subtileRow, subtileCol });
      subtileCol++;
    }
    subtileRow++;
  }
  return out;
}

export type CoastalZone = "coastal" | "offshore";

/**
 * §9.4: en subflis er kystsone hvis avstanden fra senterpunktet til nærmeste
 * kystlinje (i `tools/chart-pack`s vektordata) er <= 20 nm. Mangler
 * kystlinjedekning for punktet (returnerer `undefined`), er standardretningen
 * KYSTSONE (§9.4 punkt 4) — den dyrere, tryggere retningen ved usikkerhet.
 *
 * `distanceToCoastNm` er injisert (ikke en direkte avhengighet på
 * chart-pack-geometri her) slik at denne funksjonen forblir en ren,
 * testbar klassifiseringsregel — den faktiske avstandsberegningen mot ekte
 * kystlinjevektordata er kallerens ansvar (byggetids-integrasjon med
 * `tools/chart-pack`).
 */
export function classifyCoastalZone(
  distanceToCoastNm: number | undefined,
  thresholdNm: number = COASTAL_ZONE_THRESHOLD_NM,
): CoastalZone {
  if (distanceToCoastNm === undefined) return "coastal";
  return distanceToCoastNm <= thresholdNm ? "coastal" : "offshore";
}

/** Senterpunkt (lon,lat) for en subflis, gitt kildens grid-til-lonlat-oppslag (`lookup`). */
export function subtileCenterLonLat(
  window: SubtileWindow,
  lookup: (yIndex: number, xIndex: number) => { readonly lon: number; readonly lat: number },
): { readonly lon: number; readonly lat: number } {
  const yMid = Math.floor((window.yStart + window.yEnd) / 2);
  const xMid = Math.floor((window.xStart + window.xEnd) / 2);
  return lookup(yMid, xMid);
}
