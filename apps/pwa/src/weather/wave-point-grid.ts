/**
 * Punktgitteret for punktbølgen (`docs/specs/punktbolge.md` §3 «Punktvalg»,
 * D16.1): et fast gitter med `WAVE_POINT_SPACING_NM` (10 nm) over
 * **samme korridor som flisvalget** — A*-vannavstandsfeltets rekkevidde
 * (D7.2, `tile-select.ts`). Et gitterpunkt tas med når feltcellen det ligger
 * i er nåbart vann (endelig feltverdi); punkter på land ville uansett gitt
 * «no data» hos MET og bare brukt av delforespørsels-budsjettet.
 *
 * Ren og deterministisk: samme felt ⇒ samme punktliste i samme rekkefølge
 * (sør→nord, vest→øst), så alle medlemmer og alle avganger i kjøringen —
 * og neste kjøring over samme korridor — spør om nøyaktig de samme
 * punktene. Det er også det klientbufferet nøkles på.
 *
 * Uten felt (fallback, som flisvalget): endepunkt-bboksen utvidet med
 * 0,5°, alle gitterpunkter (vi vet ikke hva som er vann).
 */
import type { LatLon } from "@morild/geo";
import { FALLBACK_TILE_PAD_DEG, type DistanceField } from "@morild/routing";
import { WAVE_POINT_SPACING_NM, WAVE_POINTS_MAX } from "@morild/weather";

export interface WavePointGrid {
  readonly points: readonly LatLon[];
  /** Hvilken korridor gitteret ble lagt over — bæres til diagnostikken. */
  readonly rule: "a-star-felt" | "endepunkt-bbox";
  readonly spacingNm: number;
  /** `points.length > WAVE_POINTS_MAX` — proxyen ville avvist listen (ærlig, aldri stille avkortet). */
  readonly exceedsMax: boolean;
}

/** 4 desimaler — samme avrunding som proxyen gjør (MET-vilkårene), så klient og proxy ser samme punkt. */
function round4(v: number): number {
  return Number(v.toFixed(4));
}

function gridOver(
  south: number,
  north: number,
  west: number,
  east: number,
  spacingNm: number,
  keep: (lat: number, lon: number) => boolean,
): LatLon[] {
  const dLat = spacingNm / 60;
  const midLat = (south + north) / 2;
  const dLon = spacingNm / (60 * Math.cos((midLat * Math.PI) / 180));
  const rows = Math.max(1, Math.floor((north - south) / dLat));
  const cols = Math.max(1, Math.floor((east - west) / dLon));
  const out: LatLon[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = south + (r + 0.5) * dLat;
    for (let c = 0; c < cols; c++) {
      const lon = west + (c + 0.5) * dLon;
      if (keep(lat, lon)) out.push({ lat: round4(lat), lon: round4(lon) });
    }
  }
  return out;
}

export function wavePointGrid(
  field: DistanceField | undefined,
  endpoints: readonly LatLon[],
  spacingNm: number = WAVE_POINT_SPACING_NM,
): WavePointGrid {
  let points: LatLon[];
  let rule: WavePointGrid["rule"];
  if (field !== undefined) {
    const d = field.data;
    points = gridOver(
      d.lat0,
      d.lat0 + d.height * d.cellDeg,
      d.lon0,
      d.lon0 + d.width * d.cellDeg,
      spacingNm,
      (lat, lon) => field.at(lat, lon) !== undefined,
    );
    rule = "a-star-felt";
  } else {
    const lats = endpoints.map((p) => p.lat);
    const lons = endpoints.map((p) => p.lon);
    points = gridOver(
      Math.min(...lats) - FALLBACK_TILE_PAD_DEG,
      Math.max(...lats) + FALLBACK_TILE_PAD_DEG,
      Math.min(...lons) - FALLBACK_TILE_PAD_DEG,
      Math.max(...lons) + FALLBACK_TILE_PAD_DEG,
      spacingNm,
      () => true,
    );
    rule = "endepunkt-bbox";
  }
  return { points, rule, spacingNm, exceedsMax: points.length > WAVE_POINTS_MAX };
}

/** `lat,lon;lat,lon;…` med 4 desimaler — proxyens `points`-parameter og klientbufferets korridornøkkel. */
export function pointsParam(points: readonly LatLon[]): string {
  return points.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(";");
}
