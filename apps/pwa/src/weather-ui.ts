/**
 * Tynt DOM-lag for værpanelet (fase 3 bølge 2C). Ren rendering — ingen
 * logikk her utover tekstformatering; all domenelogikk (klassifisering,
 * aggregering, flagg) lever i `weather/*.ts` og er testet der. Denne fila
 * er bevisst IKKE enhetstestet i denne bølgen (DOM-manipulering, lav
 * risiko, høy kostnad å teste meningsfullt uten et fullt jsdom-oppsett) —
 * se rapporten for hva som gjenstår.
 */
import type { PointerLoadResult } from "./weather/pointer-client.js";
import type { TileSelection } from "./weather/tile-select.js";
import type { TileRejection } from "./weather/tile-certificate.js";
import type { FieldPresenceStatus } from "./weather/field-status.js";
import { FIELD_LABEL_NO } from "./weather/field-status.js";
import type { EnsembleSummary, MemberOutcome } from "./weather/ensemble.js";
import type { DisplayFlag } from "./weather/route-flags.js";
import type { MetAlertsLoadResult } from "./weather/metalerts-client.js";
import type { EnsembleMeasurement } from "./weather/measurement.js";
import type { RelevantAlert } from "./weather/metalerts.js";

export function renderPointerStatus(el: HTMLElement, status: PointerLoadResult): void {
  if (status.status === "ok") {
    el.textContent = `Værpeker lastet (${status.source === "network" ? "nett" : "cache — frakoblet"}).`;
  } else if (status.status === "incompatible") {
    el.textContent = status.fallback
      ? `Værpeker inkompatibel (${status.reason}) — bruker sist synkede lokale pakke.`
      : `Værpeker inkompatibel (${status.reason}) — ingen lokal pakke å falle tilbake på.`;
  } else {
    el.textContent = `Ingen værdata tilgjengelig: ${status.reason}`;
  }
}

/**
 * Flisvalget (D7.2): hvilken regel som ble brukt, hvilke fliser pekeren
 * manglet, og hvilke som ble avvist av sertifikat-asserten. Alt tre er
 * ærlig degradering (N2) — de skal stå i UI-et, ikke bare i konsollen.
 */
export function renderTileSelection(
  el: HTMLElement,
  selection: TileSelection,
  rejections: readonly TileRejection[],
): void {
  el.replaceChildren();
  const rule =
    selection.rule === "a-star-felt"
      ? "A*-feltets rekkevidde"
      : selection.rule === "endepunkt-bbox"
        ? "endepunkt-bbox + 0,5° (fallback — A*-feltet manglet)"
        : "bbox-overlapp (pekeren har ikke et gjenkjennelig flisrutenett)";
  const head = document.createElement("div");
  head.textContent =
    `Flisvalg: ${rule}. ${selection.tiles.length} flis(er) i bruk` +
    `${selection.tileSizeDeg === undefined ? "" : ` (${selection.tileSizeDeg}°-rutenett)`}.`;
  el.appendChild(head);

  if (selection.missingTileIds.length === 0 && rejections.length === 0) return;
  const list = document.createElement("ul");
  if (selection.missingTileIds.length > 0) {
    const li = document.createElement("li");
    li.textContent =
      `⚠ Pekeren mangler ${selection.missingTileIds.length} flis(er) ruten kan trenge: ` +
      selection.missingTileIds.join(", ");
    list.appendChild(li);
  }
  for (const r of rejections) {
    const li = document.createElement("li");
    li.textContent = `⚠ Flis ${r.tileId} (${r.field}, medlem ${r.member}) avvist: ${r.reason}`;
    list.appendChild(li);
  }
  el.appendChild(list);
}

export function renderFieldStatuses(el: HTMLElement, statuses: readonly FieldPresenceStatus[]): void {
  el.replaceChildren();
  const list = document.createElement("ul");
  for (const s of statuses) {
    const li = document.createElement("li");
    if (!s.present) {
      li.textContent = `${FIELD_LABEL_NO[s.field]}: MANGLER i pakken`;
    } else {
      const ageH = s.ageS !== undefined ? (s.ageS / 3600).toFixed(1) : "?";
      li.textContent =
        `${FIELD_LABEL_NO[s.field]}: init ${s.init ?? "?"}, alder ${ageH} t` +
        `${s.stale ? " (foreldet)" : ""}, kilde: ${s.sourceStatus}`;
    }
    list.appendChild(li);
  }
  el.appendChild(list);
}

export function renderFlags(el: HTMLElement, flags: readonly DisplayFlag[]): void {
  el.replaceChildren();
  if (flags.length === 0) {
    el.textContent = "Ingen flagg registrert for denne ruten.";
    return;
  }
  const list = document.createElement("ul");
  for (const f of flags) {
    const li = document.createElement("li");
    li.textContent = `${f.severity === "warning" ? "⚠" : "ℹ"} ${f.label}`;
    list.appendChild(li);
  }
  el.appendChild(list);
}

export function renderControlResult(el: HTMLElement, outcome: MemberOutcome): void {
  const r = outcome.result;
  if (!r) {
    el.textContent = `Kontrollmedlemmet feilet: ${outcome.errorMessage ?? "ukjent feil"}`;
    return;
  }
  const arrival = new Date(r.totals.arrivalEpochS * 1000).toISOString();
  const elapsed = outcome.elapsedMs !== undefined ? ` Beregnet på ${formatElapsed(outcome.elapsedMs)}.` : "";
  el.textContent =
    `Kontroll (ekte vær): ${r.safety.reachesDestination ? "nådde målet" : "nådde IKKE målet"} — ` +
    `ankomst ${arrival}, ${r.totals.distanceNm.toFixed(1)} nm, ` +
    `${(r.totals.durationS / 3600).toFixed(1)} t. Værdekning: ${r.coverage.weather}. Kartdekning: ${r.coverage.mask}.` +
    elapsed;
}

/** «4,2 s» / «1 min 12 s» — beregningstid til nettbrett-målingen (ADR-0005 port 1). */
export function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const min = Math.floor(s / 60);
  return `${min} min ${Math.round(s - min * 60)} s`;
}

export interface EnsembleTiming {
  /** Veggklokke fra kontrollen var ferdig til siste medlem kom inn (ms). */
  readonly wallMs: number;
  /** Antall medlemmer (uten kontroll) som er ferdige så langt. */
  readonly membersDone: number;
  readonly membersTotal: number;
  readonly poolSize: number;
}

export function renderEnsembleSummary(
  el: HTMLElement,
  summary: EnsembleSummary,
  timing?: EnsembleTiming,
): void {
  const p50 = summary.durationP50S !== undefined ? (summary.durationP50S / 3600).toFixed(1) : "–";
  const p90 = summary.durationP90S !== undefined ? (summary.durationP90S / 3600).toFixed(1) : "–";
  const progress =
    timing === undefined
      ? ""
      : timing.membersDone < timing.membersTotal
        ? ` Fremdrift: ${timing.membersDone}/${timing.membersTotal} medlemmer på ${formatElapsed(timing.wallMs)} (${timing.poolSize} Workere).`
        : ` Ensemblet tok ${formatElapsed(timing.wallMs)} for ${timing.membersTotal} medlemmer (${timing.poolSize} Workere).`;
  el.textContent =
    `Ensemble: ${summary.totalMembers} medlemmer kjørt. ` +
    `Gjennomførbar: ${(summary.feasibleFraction * 100).toFixed(0)} %. ` +
    `Inkonklusiv (partial vær-dekning, ADR-0005): ${(summary.inconclusiveFraction * 100).toFixed(0)} %` +
    `${summary.horizonTooShortWarning ? " — ADVARSEL: >20 %, medlemshorisonten er trolig for kort for denne seilasen" : ""}. ` +
    `Ugjennomførbar: ${summary.infeasibleCount}. Feil: ${summary.errorCount}. ` +
    `Varighet blant gjennomførbare — P50 ${p50} t, P90 ${p90} t.` +
    progress;
}

/**
 * Nettbrett-målingen (D10.2 b): JSON i et skrivebeskyttet tekstfelt + knapp
 * som kopierer til utklippstavlen (Magnus limer den inn i chatten). Ingen
 * nettverkssending — målingen forlater aldri enheten av seg selv.
 */
export function renderMeasurement(el: HTMLElement, measurement: EnsembleMeasurement): void {
  const json = JSON.stringify(measurement, null, 1);
  el.replaceChildren();
  const title = document.createElement("div");
  const wall = measurement.ensembleWallMs !== null ? formatElapsed(measurement.ensembleWallMs) : "–";
  title.textContent =
    `Nettbrett-måling (ADR-0005 port 1): ${measurement.members.length} medlemmer på ${wall}, ` +
    `${measurement.hardwareConcurrency ?? "?"} kjerner, ${measurement.poolSize} Workere. Kopier og send:`;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Kopier måling";
  button.addEventListener("click", () => {
    const done = (): void => {
      button.textContent = "Kopiert ✓";
    };
    const fallback = (): void => {
      area.select();
      button.textContent = "Marker og kopier manuelt";
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(done, fallback);
    } else {
      fallback();
    }
  });
  const area = document.createElement("textarea");
  area.readOnly = true;
  area.value = json;
  area.rows = 6;
  area.setAttribute("aria-label", "Nettbrett-måling som JSON");
  el.append(title, button, area);
}

export function renderMetAlerts(
  el: HTMLElement,
  result: MetAlertsLoadResult,
  relevant: readonly RelevantAlert[],
): void {
  el.replaceChildren();
  const meta = `(hentet ${result.fetchedAt ?? "ukjent tidspunkt"}, kilde: ${result.sourceStatus ?? "ukjent"})`;
  if (relevant.length === 0) {
    el.textContent = `Ingen relevante MetAlerts-varsler for ruten ${meta}.`;
    return;
  }
  const heading = document.createElement("div");
  heading.textContent = `${relevant.length} relevante MetAlerts-varsel for ruten ${meta}:`;
  el.appendChild(heading);
  const list = document.createElement("ul");
  for (const r of relevant) {
    const li = document.createElement("li");
    const name = r.feature.properties.title ?? r.feature.properties.event ?? "Varsel";
    const where = r.containsEndpoint ? "dekker start- eller målpunktet" : `${r.minDistanceNm.toFixed(1)} nm fra ruten`;
    li.textContent = `${name} — ${where}`;
    list.appendChild(li);
  }
  el.appendChild(list);
}
