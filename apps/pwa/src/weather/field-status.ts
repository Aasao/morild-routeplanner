/**
 * Ærlig degradering for pakke-metadata (N2, F2.4): alder, init-tidspunkt og
 * kildestatus PER FELT — og, like viktig, at et felt som mangler HELT
 * (ingen `PointerFieldEntry` for det i det hele tatt, f.eks. strøm/bølge i
 * dagens vind-only dry-run-pakke) vises som en eksplisitt, synlig
 * "mangler"-tilstand, aldri stille utelates fra UI-en.
 *
 * Rutemotorens EGNE per-steg-flagg (`FLAG_SJOEGANG_DATA_MANGLER` når
 * bølgedata mangler i et punkt) er noe ANNET enn dette — dette er
 * PAKKE-nivå («har vi i det hele tatt lastet ned et bølgefelt for dette
 * området/tidsvinduet»), routing-flagget er PUNKT-nivå («manglet feltet
 * akkurat her, akkurat nå, selv om pakken generelt har bølgedata»). Begge
 * vises — se `route-flags.ts`.
 */
import { ageAt } from "@morild/weather";
import type { PointerTileEntry } from "./pointer-types.js";

export type KnownField = "wind" | "current" | "waves";

export const KNOWN_FIELDS: readonly KnownField[] = ["wind", "current", "waves"];

export interface FieldPresenceStatus {
  readonly field: KnownField;
  readonly present: boolean;
  readonly ageS?: number;
  readonly stale?: boolean;
  /** `"ok"` eller den forklarende degraderingsgrunnen (§12: "06Z manglet — dette er 00Z"-klassen). */
  readonly sourceStatus?: string;
  readonly init?: string;
}

/**
 * Kontrollmedlemmet (`member === 0`) representerer feltets alder/init i
 * UI-en — medlemmer har samme `init` som kontrollen for et gitt felt i
 * praksis (§5: én `PackageHeader` per FELT, ikke per medlem), og
 * kontrollen er alltid til stede når feltet er det.
 */
export function fieldPresenceStatuses(
  tile: PointerTileEntry | undefined,
  nowEpochS: number,
): readonly FieldPresenceStatus[] {
  return KNOWN_FIELDS.map((field) => {
    const entry = tile?.fields.find((f) => f.field === field && f.member === 0);
    if (entry === undefined) {
      return { field, present: false };
    }
    const age = ageAt(entry.header, nowEpochS);
    const sourceStatus =
      entry.header.sourceStatus.status === "ok" ? "ok" : entry.header.sourceStatus.reason;
    return {
      field,
      present: true,
      ageS: age.ageS,
      stale: age.stale,
      sourceStatus,
      init: entry.header.init,
    };
  });
}

/** Norske korte etiketter for feltene, brukt i statuspanelet. */
export const FIELD_LABEL_NO: Record<KnownField, string> = {
  wind: "Vind",
  current: "Strøm",
  waves: "Bølger",
};
