/**
 * Fliser og subfliser (`docs/specs/vaerpakker.md` §7, §9.4, §18 pkt. 3).
 *
 * Vind og bølger deler ETT rutenett: 2°×2°-fliser, ≤32×32-nodes subfliser
 * for skala/offset, forankret i samme heltallsorigo som kartflisene
 * (`lat mod 2 = 0`, `lon mod 2 = 0`). Strøm har sin EGEN, mindre flisstørrelse
 * (0,5°–1°, §9.6) og er bevisst IKKE denne modulens ansvar — se
 * `field.ts` for hvordan strømlaget bygges separat.
 *
 * Samme subflis-rutenett brukes til to ting (§9.4 punkt 5): kvantiseringens
 * skala/offset-enhet, og kystsone/utaskjærs-klassifiseringen. Denne
 * modulen eier geometrien; `field.ts` bruker den til det første,
 * `classifyCoastalZone` under er det andre.
 */

/** Værflisenes faste størrelse — låst 2026-09-02 (§18 pkt. 3). */
export const TILE_DEG = 2;

/** Maks nodeantall per subflis-akse — låst (§7, §9 krav 8). */
export const MAX_SUBTILE_NODES = 32;

/** Kystsone-terskelen (§9.4) — midlertidig (§9.8-status), men logikken er låst. */
export const KYSTSONE_THRESHOLD_NM = 20;

export interface TileOrigin {
  readonly latMin: number;
  readonly lonMin: number;
}

/**
 * Flisen en gitt posisjon faller i, forankret i heltallsorigo (§7: «hele
 * gradlinjer, `lat mod 2 = 0`, `lon mod 2 = 0`» — samme origo som
 * kartflisenes 0,5°×0,25°-rutenett).
 */
export function tileOrigin(lat: number, lon: number): TileOrigin {
  return {
    latMin: Math.floor(lat / TILE_DEG) * TILE_DEG,
    lonMin: Math.floor(lon / TILE_DEG) * TILE_DEG,
  };
}

export type CoastalZone = "kystsone" | "utaskjaers";

/**
 * Kystsonens operasjonelle definisjon (§9.4, låst logikk — 20 nm-terskelen
 * er selv midlertidig, se §9.8, men eksistensen av regelen er LÅST NÅ).
 *
 * `distanceToCoastNm` er en injisert funksjon (typisk et oppslag mot
 * `tools/chart-pack`s kystlinjevektordata, `docs/specs/farbarhetsmaske.md`
 * §3) — denne modulen kjenner ikke kartpakkene (arkitekturgrensen,
 * `packages/weather` importerer aldri `@morild/charts`). Returnerer den
 * `undefined` (ingen kystlinjedekning for subflisen), er standardretningen
 * `"kystsone"` — den dyrere, tryggere retningen (§9.4 punkt 4).
 */
export function classifyCoastalZone(
  centerLat: number,
  centerLon: number,
  distanceToCoastNm: (lat: number, lon: number) => number | undefined,
  thresholdNm: number = KYSTSONE_THRESHOLD_NM,
): CoastalZone {
  const distance = distanceToCoastNm(centerLat, centerLon);
  if (distance === undefined) return "kystsone";
  return distance <= thresholdNm ? "kystsone" : "utaskjaers";
}

/** Km per breddegrad — samme tall som `pack-degradation.ts` bruker. */
export const KM_PER_DEG_LAT = 111.32;

export function latStepDegForKm(km: number): number {
  return km / KM_PER_DEG_LAT;
}

/** Lengdegradsavstanden er breddeavhengig — regnes ved feltets senterbredde. */
export function lonStepDegForKm(km: number, atLatDeg: number): number {
  return km / (KM_PER_DEG_LAT * Math.cos((atLatDeg * Math.PI) / 180));
}

/**
 * Antall subfliser (per akse) et 2°-flis deles i for en gitt nodeavstand,
 * med ≤32 noder per subflis (§7). Siste subflis kan være mindre — denne
 * funksjonen svarer bare på ANTALLET, ikke størrelsen på den siste.
 */
export function subtileCountPerAxis(nodeStepDeg: number): number {
  const totalNodes = Math.ceil(TILE_DEG / nodeStepDeg);
  return Math.max(1, Math.ceil(totalNodes / MAX_SUBTILE_NODES));
}
