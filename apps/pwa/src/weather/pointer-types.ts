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

export interface PointerTileEntry {
  readonly tileId: string;
  readonly bbox: readonly [west: number, south: number, east: number, north: number];
  readonly fields: readonly PointerFieldEntry[];
}

export interface WeatherPointer {
  readonly formatVersion: string;
  readonly tiles: readonly PointerTileEntry[];
}
