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
  el.textContent =
    `Kontroll (ekte vær): ${r.safety.reachesDestination ? "nådde målet" : "nådde IKKE målet"} — ` +
    `ankomst ${arrival}, ${r.totals.distanceNm.toFixed(1)} nm, ` +
    `${(r.totals.durationS / 3600).toFixed(1)} t. Værdekning: ${r.coverage.weather}. Kartdekning: ${r.coverage.mask}.`;
}

export function renderEnsembleSummary(el: HTMLElement, summary: EnsembleSummary): void {
  const p50 = summary.durationP50S !== undefined ? (summary.durationP50S / 3600).toFixed(1) : "–";
  const p90 = summary.durationP90S !== undefined ? (summary.durationP90S / 3600).toFixed(1) : "–";
  el.textContent =
    `Ensemble: ${summary.totalMembers} medlemmer kjørt. ` +
    `Gjennomførbar: ${(summary.feasibleFraction * 100).toFixed(0)} %. ` +
    `Inkonklusiv (partial vær-dekning, ADR-0005): ${(summary.inconclusiveFraction * 100).toFixed(0)} %` +
    `${summary.horizonTooShortWarning ? " — ADVARSEL: >20 %, medlemshorisonten er trolig for kort for denne seilasen" : ""}. ` +
    `Ugjennomførbar: ${summary.infeasibleCount}. Feil: ${summary.errorCount}. ` +
    `Varighet blant gjennomførbare — P50 ${p50} t, P90 ${p90} t.`;
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
