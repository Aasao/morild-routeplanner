/**
 * Tekstene for punktbølgen (`docs/specs/punktbolge.md` §4, §4.1
 * «Diagnostikk»). Rene funksjoner — DOM-en lever i `weather-ui.ts`.
 *
 * **Én degraderingstekst** (D14.1, D14.2): tidsstempel, avstandskategori og
 * «bølgeperiode ukjent» i samme setning, alltid synlig der ruten leses — i
 * tillegg eventuelt «frakoblet, fra kl. HH:MM», «nær land, mulig skjermet»
 * (steg i strømmens kystmaske, n2) og «mangler på deler av ruten».
 * Kildestatus (feilede punkter) går i diagnostikken og som rute-flagg.
 */
import {
  FLAG_BOLGE_PUNKT_5_20NM,
  FLAG_BOLGE_PUNKT_OVER_20NM,
  FLAG_BOLGE_PUNKT_UNDER_5NM,
  FLAG_STROM_KYSTSONE,
  type RouteStep,
} from "@morild/routing";
import { WAVE_POINT_MAX_DISTANCE_NM, wavePointDistanceStats, type WavePointSet } from "@morild/weather";
import type { DisplayFlag } from "./route-flags.js";
import type { WavePointGrid } from "./wave-point-grid.js";
import type { WavePointLoad } from "./wave-points-client.js";

const DEFAULT_TIME_ZONE = "Europe/Oslo";

/** Ordlyd låst i punktbolge.md §4 (n2) — aldri en påstand om hvor mye skjermet. */
export const WAVE_COASTAL_TEXT =
  "nær land, mulig skjermet — punktvarselet fanger ikke le, refleksjon eller krysssjø";

export function formatClock(epochS: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("nb-NO", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(epochS * 1000),
  );
}

/** Verste (lengste) avstandskategori langs ruten, fra motorens per-steg-flagg. */
export function worstWaveCategory(steps: readonly RouteStep[]): "< 5 nm" | "5–20 nm" | "> 20 nm" | null {
  let or = 0;
  for (const s of steps) or |= s.flags;
  if ((or & FLAG_BOLGE_PUNKT_OVER_20NM) !== 0) return "> 20 nm";
  if ((or & FLAG_BOLGE_PUNKT_5_20NM) !== 0) return "5–20 nm";
  if ((or & FLAG_BOLGE_PUNKT_UNDER_5NM) !== 0) return "< 5 nm";
  return null;
}

export interface WaveText {
  readonly text: string;
  readonly severity: "info" | "advarsel";
}

/**
 * Degraderingsteksten (§4-tabellen). `steps` = kontrollrutens steg når de
 * finnes (før kontrollen er ferdig: `null` — kategori sies da «beregnes»).
 */
export function waveDegradationText(
  load: WavePointLoad,
  steps: readonly RouteStep[] | null,
  timeZone: string = DEFAULT_TIME_ZONE,
): WaveText {
  if (load.kind === "mangler") {
    if (load.reason === "krever-nett") {
      return {
        text: "Bølgedata krever nett — ingen tidligere hentet punktvarsel for denne ruten; ruten er regnet uten bølge.",
        severity: "advarsel",
      };
    }
    return {
      text: `Bølgedata mangler (${load.detail}) — ruten er regnet uten bølge.`,
      severity: "advarsel",
    };
  }

  const set = load.set;
  const clock = formatClock(set.fetchedAtEpochS, timeZone);
  const category = steps === null ? null : worstWaveCategory(steps);
  const categoryText = steps === null ? "nærmeste punkt: beregnes" : category === null ? "intet varselpunkt i nærheten" : `nærmeste punkt ${category}`;
  let text = `Bølger fra punktvarsel kl. ${clock} (${categoryText}) — bølgeperiode ukjent, konservativt anslag`;
  let warn = category !== null && category !== "< 5 nm";

  if (load.kind === "buffer") {
    text += load.offline
      ? ` (frakoblet, fra kl. ${clock})`
      : ` (punktvarselet kunne ikke hentes nå: ${load.reason}; bruker det fra kl. ${clock})`;
    warn = true;
  }
  if (steps !== null && steps.some((s) => (s.flags & FLAG_STROM_KYSTSONE) !== 0)) {
    text += `; ${WAVE_COASTAL_TEXT}`;
    warn = true;
  }
  text += ".";
  if (steps !== null) {
    const stats = wavePointDistanceStats(set, steps);
    if (stats === null || stats.beyondLimit > 0) {
      text += " Bølgedata mangler på deler av ruten (ingen varselpunkt i nærheten).";
      warn = true;
    }
  }
  return { text, severity: warn ? "advarsel" : "info" };
}

/** Kildestatus som rute-flagg (§4-tabellen «Proxy/MET feiler»). */
export function waveSourceFlags(load: WavePointLoad, timeZone: string = DEFAULT_TIME_ZONE): readonly DisplayFlag[] {
  if (load.kind === "mangler") {
    return [
      {
        code: "BOLGE_DATA_MANGLER",
        label:
          load.reason === "krever-nett"
            ? "Bølgedata krever nett — ruten er regnet uten bølge"
            : `Bølgedata mangler (${load.detail}) — ruten er regnet uten bølge`,
        severity: "warning",
      },
    ];
  }
  const flags: DisplayFlag[] = [];
  if (load.kind === "buffer") {
    flags.push({
      code: "BOLGE_FRA_BUFFER",
      label: `Bølge fra lagret punktvarsel (kl. ${formatClock(load.set.fetchedAtEpochS, timeZone)}) — ${load.offline ? "frakoblet" : load.reason}`,
      severity: "warning",
    });
  }
  if (load.set.sourceStatus !== "ok") {
    flags.push({
      code: "BOLGE_KILDE_DEGRADERT",
      label: `Punktvarsel for bølge delvis utilgjengelig: ${load.set.sourceReason ?? "ukjent årsak"} — der mangler bølge`,
      severity: "warning",
    });
  }
  return flags;
}

function statusCounts(set: WavePointSet): string {
  const count = (s: string): number => set.points.filter((p) => p.status === s).length;
  return `${count("ok")} med data, ${count("ingen-data")} uten data (land), ${count("feilet")} feilet`;
}

function nm(v: number): string {
  return v.toFixed(1).replace(".", ",");
}

/**
 * «Datakilder og diagnostikk» (§4.1): kilde, punkter, hash, buffer — og
 * `wavePointDistanceNm` for kontrollrutens steg (maks og median) **alltid**,
 * ikke bare ved brudd.
 */
export function waveDiagnosticsText(
  load: WavePointLoad,
  grid: WavePointGrid,
  steps: readonly RouteStep[] | null,
): string {
  const corridor = grid.rule === "a-star-felt" ? "A*-feltets korridor" : "endepunkt-bbox + 0,5° (A*-feltet manglet)";
  const head = `Punktbølge (MET Oceanforecast via proxy): ${grid.points.length} varselpunkter à ${grid.spacingNm} nm over ${corridor}.`;
  const buffer = load.persistentBuffer
    ? "Klientbuffer: Cache Storage."
    : "Klientbuffer: kun minne (usikker kontekst) — overlever ikke sideinnlasting, frakoblet bruk får ikke bølge.";
  if (load.kind === "mangler") {
    return `${head} Ingen bølge i beregningen: ${load.detail}. ${buffer}`;
  }
  const set = load.set;
  const source =
    `${load.kind === "nett" ? "Hentet nå" : "Fra buffer"}: ${statusCounts(set)}; kilde ${set.sourceStatus}` +
    `${set.sourceReason !== null ? ` (${set.sourceReason})` : ""}; hentet ${new Date(set.fetchedAtEpochS * 1000).toISOString()}; hash ${set.hash.slice(0, 12)}.`;
  let distance = "Avstand til nærmeste varselpunkt langs kontrollruten: beregnes.";
  if (steps !== null) {
    const stats = wavePointDistanceStats(set, steps);
    distance =
      stats === null
        ? "Avstand til nærmeste varselpunkt langs kontrollruten: ingen varselpunkter med data."
        : `Avstand til nærmeste varselpunkt langs kontrollruten: maks ${nm(stats.maxNm)} nm, median ${nm(stats.medianNm)} nm ` +
          `(grense ${WAVE_POINT_MAX_DISTANCE_NM} nm${stats.beyondLimit > 0 ? `; ${stats.beyondLimit} steg over grensen — bølge mangler der` : ""}).`;
  }
  return `${head} ${source} ${distance} ${buffer}`;
}
