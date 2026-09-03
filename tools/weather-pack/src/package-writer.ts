/**
 * Pakkeskriving: innholdsadressert sti + pekere (`docs/specs/vaerpakker.md`
 * §5, §7.3 "Kompatibilitet"). Rene funksjoner for hashing/sti-bygging her;
 * selve I/O-en (skriving til R2 / lokal disk i dry-run) lever i
 * `pipeline.ts`/`cli.ts` bak en injisert `PackageSink`.
 */
import { createHash } from "node:crypto";
import type { PackageHeader, SourceStatus } from "@morild/protocol";

/** SHA-256 av den ferdig kvantiserte byte-payloaden (§5 — FØR evt. gzip). */
export function contentHash(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

/** R2-nøkkel: `weather/<formatVersion-major>/<contentHash>.bin` (§5). */
export function r2Key(formatVersion: string, hash: string): string {
  const major = formatVersion.split(".")[0];
  if (major === undefined || !/^\d+$/.test(major)) {
    throw new Error(`Ugyldig formatVersion "${formatVersion}" — forventet semver`);
  }
  return `weather/${major}/${hash}.bin`;
}

export interface PointerFieldEntry {
  readonly field: string; // "wind" | "current" | "waves" | ...
  readonly member: number; // 0 for kontroll/felt uten ensemble
  readonly key: string;
  readonly hash: string;
  readonly header: PackageHeader;
}

/**
 * Et felt bevisst IKKE inkludert i denne flisen (§12/N2 — "manglende data
 * vises, aldri skjules"). IKKE en tom/gjettet `PointerFieldEntry` — det
 * finnes ingen blob å referere til, kun en dokumentert grunn. Klienten kan
 * lese denne lista og vise "strøm: ikke tilgjengelig" i stedet for å anta
 * fravær av oppføring betyr "alt er ok".
 */
export interface PointerMissingFieldEntry {
  readonly field: string; // "current" | "waves" | ...
  readonly sourceStatus: Extract<SourceStatus, { status: "degraded" }>;
}

export interface PointerTileEntry {
  readonly tileId: string;
  readonly bbox: readonly [west: number, south: number, east: number, north: number];
  readonly fields: readonly PointerFieldEntry[];
  /** Se `PointerMissingFieldEntry` — valgfri, tom/utelatt betyr "ingen kjente hull". */
  readonly missingFields?: readonly PointerMissingFieldEntry[];
}

export interface WeatherPointer {
  readonly formatVersion: string;
  readonly tiles: readonly PointerTileEntry[];
}

/** Bygger pekerdokumentet fra en liste med allerede skrevne (flis, felt, medlem)-oppføringer (§5). */
export function buildPointer(formatVersion: string, tiles: readonly PointerTileEntry[]): WeatherPointer {
  return { formatVersion, tiles };
}

// --- §5: arkivpolitikk — 7 døgns rullerende R2-arkiv ------------------------

export const ARCHIVE_WINDOW_DAYS = 7;

export interface ArchivedObject {
  readonly key: string;
  readonly producedAt: string; // ISO 8601
}

/**
 * Hvilke arkiverte objekter er eldre enn arkivvinduet (§5, §18 pkt. 4) og
 * dermed kandidater for opprydding — ALDRI objekter pekeren fortsatt
 * refererer (kalleren skal filtrere de bort FØR sletting, se pipeline.ts).
 */
export function objectsOlderThanArchiveWindow(
  objects: readonly ArchivedObject[],
  nowEpochMs: number,
  windowDays: number = ARCHIVE_WINDOW_DAYS,
): ArchivedObject[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return objects.filter((o) => nowEpochMs - Date.parse(o.producedAt) > windowMs);
}
