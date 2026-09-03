/**
 * Alder på et felt — vises alltid i UI (`docs/00-kravspek.md` F2.4,
 * `docs/specs/vaerpakker.md` §6). Ren funksjon: terskelen for `stale` er en
 * presentasjonsbeslutning, ikke denne pakkens — den returnerer bare tallet.
 */
import type { PackageHeader } from "@morild/protocol";

export interface FieldAge {
  readonly ageS: number;
  readonly stale: boolean;
}

/**
 * `staleAfterS` er en presentasjonsterskel som kalleren styrer (default 6 t
 * — MEPS' egen kjøringsfrekvens, en rimelig, men IKKE spec-låst, standard).
 */
export function ageAt(
  header: PackageHeader,
  nowEpochS: number,
  staleAfterS = 6 * 3600,
): FieldAge {
  const initEpochS = Date.parse(header.init) / 1000;
  const ageS = Math.max(0, nowEpochS - initEpochS);
  return { ageS, stale: ageS > staleAfterS };
}
