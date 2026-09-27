/**
 * Måleprogrammets konstanter (robusthet.md §6.4, D13.5 bolk 1) — ALLE i
 * denne ene filen, slik at programmet som kjørte kan leses av JSON-en
 * (`constants`-feltet) og endres ett sted. Filen har ingen DOM- eller
 * Node-avhengigheter: Vite-mellomvaren (`dev-server/`) importerer skjemaet og
 * katalogen herfra, så klient og mottaker aldri kan være uenige.
 */

/** Skjema for resultat-JSON-en OG for fremdriften i `localStorage`. */
export const PROGRAM_SCHEMA = "morild-maaleprogram/1";

/** `localStorage`-nøkkel for fremdriften (spec-en: `morild-maaleprogram/1`). */
export const PROGRESS_STORAGE_KEY = "morild-maaleprogram/1";
/** Pekerdokumentet programmet startet med — gjenopptak bruker SAMME pakke. */
export const POINTER_STORAGE_KEY = "morild-maaleprogram/1:peker";

/** `?maaleprogram=1` åpner modusen. */
export const QUERY_PARAM = "maaleprogram";

/** 1. Poolsveip: pool-størrelser og kjøringer per størrelse (vekselvis rekkefølge). */
export const POOL_SIZES: readonly number[] = [4, 5, 6, 7];
export const POOL_REPEATS = 5;

/** 2. Solo: kontrollmedlemmet (medlem 0) alene på én Worker. */
export const SOLO_REPEATS = 10;

/** 3. Solo + dummy-last: k samtidige dummy-Workere × variant × gjentak. */
export const DUMMY_COUNTS: readonly number[] = [1, 2, 3, 4, 5];
export const DUMMY_VARIANTS = ["spin", "stream", "alloc"] as const;
export type DummyVariant = (typeof DUMMY_VARIANTS)[number];
export const DUMMY_REPEATS = 3;
/** `stream`-variantens `Float64Array` (64 MB). */
export const DUMMY_STREAM_BYTES = 64 * 1024 * 1024;
/**
 * Innsvingning etter at alle dummy-Workerne har meldt «kjører» og før
 * målesøket starter — så OS-et har rukket å fordele dem på kjerner.
 */
export const DUMMY_SETTLE_MS = 1_000;

/**
 * Avbrudd på samme kjøring før den hoppes over. En kjøring som selv tar ned
 * fanen (minne), ville ellers gjenopptas i det uendelige.
 */
export const MAX_INTERRUPTIONS_PER_RUN = 2;

/** 4. Termisk hvile mellom kjøringer — ikke medregnet i noe tall. */
export const PAUSE_MS = 15_000;

/** Dev-only Vite-mellomvare som tar imot resultatet (`vite.config.ts`). */
export const SAVE_ENDPOINT = "/__morild/maaleprogram";
/** Katalogen mellomvaren skriver til, relativt til repo-roten. */
export const RAW_DATA_DIR = "docs/research/maaleprogram-raadata";
/** Øvre grense for kroppen mellomvaren leser (ca. 100 kjøringer × 30 medlemmer er langt under). */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
/**
 * Maks filer mottaket skriver per `vite dev`-levetid. `vite --host` gjør
 * mottaket synlig på hele LAN-et; uten tak kan hvem som helst der fylle
 * `docs/research/` (én programkjøring gir én fil).
 */
export const MAX_SAVED_FILES = 20;

/** Snapshot til JSON-en: hvilket program som faktisk kjørte. */
export const PROGRAM_CONSTANTS = {
  poolSizes: POOL_SIZES,
  poolRepeats: POOL_REPEATS,
  soloRepeats: SOLO_REPEATS,
  dummyCounts: DUMMY_COUNTS,
  dummyVariants: DUMMY_VARIANTS,
  dummyRepeats: DUMMY_REPEATS,
  dummyStreamBytes: DUMMY_STREAM_BYTES,
  dummySettleMs: DUMMY_SETTLE_MS,
  pauseMs: PAUSE_MS,
  maxInterruptionsPerRun: MAX_INTERRUPTIONS_PER_RUN,
} as const;
