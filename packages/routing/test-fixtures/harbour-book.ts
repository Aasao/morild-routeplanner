/**
 * Interim **havnebok** for bail-out-profilen (F4.6, robusthet.md §3.5/§4.5).
 *
 * Bygget på `INTERIM_BAILOUT_HARBOURS` (posisjoner og eksponering derfra,
 * med sine forbehold i `docs/research/bailout-interim.md`) pluss de feltene
 * havneboken legger til: dybde ved kai og ankringsplass, og mørketrygghet.
 *
 * **Dybdene er fikstur, ikke fasit.** De er satt til nøkterne, realistiske
 * tall for besøkshavner av denne typen (3,5–7 m ved kai, litt mer på svai) og
 * er merket med kilde `"fikstur"` og dato `"2026-09-05"` slik at ingen kan
 * forveksle dem med loddede tall. Poenget her er å teste *gatene*, ikke å
 * påstå noe om Fjällbacka. Ekte tall føres inn i F4.6-boken i appen, per havn,
 * med kilde — det er hele grunnen til at `DepthRef` har `source` og `date`.
 *
 * **`nightApproachSafe` er `false` for alle åtte.** Det er ikke latskap: feltet
 * er en erfaring om innseilingen som bare Magnus kan skrive, og
 * sikkerhetsdefaulten er «nei» (§3.5). Konsekvensen er synlig i profilen —
 * nattetimene blir et hull — og det er den ærlige framstillingen fram til
 * boken er fylt ut.
 */
import type { HarbourBookEntry, DepthRef } from "../src/index.js";
import { INTERIM_BAILOUT_HARBOURS } from "./bailout-harbours.js";

/** Fast «skrevet»-tidspunkt: fiksturer leser aldri klokka. */
export const FIXTURE_BOOK_UPDATED_AT = 1_780_000_000;
export const FIXTURE_BOOK_DEVICE_ID = "fikstur";

function depth(valueM: number): DepthRef {
  return { valueM, source: "fikstur", date: "2026-09-05" };
}

/** Dybder per havn: [kai, ankringsplass] i meter. */
const FIXTURE_DEPTHS: Readonly<Record<string, readonly [number, number]>> = {
  Skjæløy: [3.5, 5.0],
  Fredrikstad: [4.5, 6.0],
  Strömstad: [5.0, 7.0],
  Fjällbacka: [3.5, 5.0],
  Smögen: [4.5, 8.0],
  Lysekil: [6.0, 10.0],
  Marstrand: [4.0, 7.0],
  Skagen: [6.5, 9.0],
};

/** Havn-id fra navn: ASCII-slug, stabil på tvers av kjøringer. */
export function harbourIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø|ö/g, "o")
    .replace(/å|ä/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const INTERIM_HARBOUR_BOOK: readonly HarbourBookEntry[] = Object.freeze(
  INTERIM_BAILOUT_HARBOURS.map((h) => {
    const d = FIXTURE_DEPTHS[h.name];
    return Object.freeze({
      ...h,
      id: harbourIdFromName(h.name),
      minDepthAtQuayM: d === undefined ? null : depth(d[0]),
      minDepthAtAnchorageM: d === undefined ? null : depth(d[1]),
      nightApproachSafe: false,
      updatedAt: FIXTURE_BOOK_UPDATED_AT,
      deviceId: FIXTURE_BOOK_DEVICE_ID,
      verified: false,
    });
  }),
);

/** Samme bok, men med dybdene fjernet for én havn (dekningstesten, §5.6). */
export function bookWithoutDepth(
  book: readonly HarbourBookEntry[],
  id: string,
): readonly HarbourBookEntry[] {
  return book.map((entry) =>
    entry.id === id
      ? { ...entry, minDepthAtQuayM: null, minDepthAtAnchorageM: null }
      : entry,
  );
}

/** Samme bok, men mørketrygg — for tester som vil isolere mørkegaten. */
export function bookNightSafe(
  book: readonly HarbourBookEntry[],
): readonly HarbourBookEntry[] {
  return book.map((entry) => ({ ...entry, nightApproachSafe: true }));
}
