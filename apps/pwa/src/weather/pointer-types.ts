/**
 * Klientens forståelse av pekerdokumentet (`docs/specs/vaerpakker.md` §5,
 * §14; `docs/specs/app-skjelett.md` §6.3 for hvorfor stien er
 * `/pointer/:name` og ikke `/api/weather/pointer`).
 *
 * Bevisst en STRUKTURELT kompatibel, egen kopi av
 * `tools/weather-pack/src/package-writer.ts`s `WeatherPointer`/
 * `PointerTileEntry`/`PointerFieldEntry` — samme mønster som
 * `packages/weather`s `WeatherFieldLike` speiler `@morild/routing`s
 * `WeatherField` (se `weather-field-adapter.ts`s toppkommentar):
 * produsent (`tools/weather-pack`) og konsument (denne appen) er ikke
 * hverandres avhengighet, de er enige om et JSON-skjema `vaerpakker.md`
 * §5/§14 definerer. Endres skjemaet der, oppdateres begge kopiene i samme
 * omgang.
 */
import type { PackageHeader } from "@morild/protocol";

export interface PointerFieldEntry {
  readonly field: string; // "wind" | "current" | "waves" | ...
  readonly member: number; // 0 for kontroll/felt uten ensemble
  readonly key: string;
  readonly hash: string;
  readonly header: PackageHeader;
}

/**
 * Et felt (eller ETT ensemblemedlem av et felt, når `member` er satt) som
 * produsenten bevisst IKKE skrev — med grunn. Brukes i dag til å telle
 * vindmedlemmer som ble utelatt for manglende data (§19 2026-09-29), slik at
 * nevneren «n av N» er ærlig også når medlemmet aldri kom i pekeren.
 */
export interface PointerMissingFieldEntry {
  readonly field: string;
  readonly member?: number;
  readonly sourceStatus: { readonly status: "degraded"; readonly reason: string };
}

export interface PointerTileEntry {
  readonly tileId: string;
  readonly bbox: readonly [west: number, south: number, east: number, north: number];
  readonly fields: readonly PointerFieldEntry[];
  readonly missingFields?: readonly PointerMissingFieldEntry[];
}

export interface WeatherPointer {
  readonly formatVersion: string;
  readonly tiles: readonly PointerTileEntry[];
}
