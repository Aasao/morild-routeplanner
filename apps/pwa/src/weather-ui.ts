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
import type { DecisionAdvice, DepartureSummary, SensitivityReport } from "@morild/robustness";
import type { BailoutProfile } from "@morild/routing";
import type { RelevantAlert } from "./weather/metalerts.js";
import type { WaveText } from "./weather/wave-text.js";

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

export function renderFieldStatuses(
  el: HTMLElement,
  statuses: readonly FieldPresenceStatus[],
  opts: { readonly wavePointsInUse?: boolean } = {},
): void {
  el.replaceChildren();
  const list = document.createElement("ul");
  for (const s of statuses) {
    const li = document.createElement("li");
    if (!s.present && s.field === "waves" && opts.wavePointsInUse === true) {
      // punktbolge.md: bølge kommer fra punktvarselet via proxyen, ikke pakken.
      li.textContent = `${FIELD_LABEL_NO[s.field]}: ikke i pakken — punktvarsel via proxy (se bølgelinjen)`;
    } else if (!s.present) {
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

/** Punktbølgens degraderingstekst (punktbolge.md §4) — én linje, alltid synlig. */
export function renderWaveText(el: HTMLElement, wave: WaveText): void {
  el.textContent = `${wave.severity === "advarsel" ? "⚠" : "ℹ"} ${wave.text}`;
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
    // ADR-0008: to dekningsfelt — rutens steg (klassifiserer et nådd mål) og
    // hele søket (klassifiserer et ikke-nådd). Begge vises, aldri bare ett.
    `${(r.totals.durationS / 3600).toFixed(1)} t. Værdekning: rute ${r.coverage.weather}, søk ${r.coverage.searchWeather}. ` +
    `Kartdekning: ${r.coverage.mask}.` +
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

function progressText(timing: EnsembleTiming | undefined): string {
  if (timing === undefined) return "";
  return timing.membersDone < timing.membersTotal
    ? ` Fremdrift: ${timing.membersDone}/${timing.membersTotal} medlemmer på ${formatElapsed(timing.wallMs)} (${timing.poolSize} Workere).`
    : ` Ensemblet tok ${formatElapsed(timing.wallMs)} for ${timing.membersTotal} medlemmer (${timing.poolSize} Workere).`;
}

const LIGHT_LABEL: Record<DepartureSummary["light"]["color"], string> = {
  gronn: "GRØNT",
  gul: "GULT",
  rod: "RØDT",
  beregner: "beregner",
};

/**
 * Avgangssammendraget slik robusthet.md §4.2.2/§4.2.3 og D10.4 vil ha det:
 * tellinger og eksakte skranker, aldri prosent; «regn med inntil» (verste
 * gjennomførbare) + «typisk» (P50); ordet P90 vises ikke her; trafikklys
 * kun når det er avgjort (sertifikat eller komplett), provisoriske
 * terskler merket.
 */
export function renderDepartureText(d: DepartureSummary): string {
  const n = d.members.length;
  const expected = d.expectedMembers;
  const minK = Math.round(d.feasibleShareBounds.min * expected);
  const maxK = Math.round(d.feasibleShareBounds.max * expected);
  const counts =
    `${n} av ${expected} ferdig — ${d.nF} har gått, ${d.nInf} kom ikke fram, ` +
    `${d.nInc} inkonklusive, ${d.nErr} feil. Gjennomførbare av ${expected}: minst ${minK}, høyst ${maxK}.`;
  const light =
    d.light.color === "beregner"
      ? " Trafikklys: ikke avgjort ennå."
      : ` Trafikklys: ${LIGHT_LABEL[d.light.color]}${d.light.reason ? ` (${d.light.reason})` : ""}` +
        `${d.certificate !== null && !d.complete ? " — sertifikat før alle er ferdige" : ""}; provisoriske terskler.`;
  const times =
    d.durationWorstS !== null && d.durationP50S !== null
      ? ` Regn med inntil ${(d.durationWorstS / 3600).toFixed(1)} t, typisk ${(d.durationP50S / 3600).toFixed(1)} t` +
        `${d.nF < 12 ? ` (tynt utvalg: verste av ${d.nF} gjennomførbare)` : ""}.`
      : "";
  const wind = d.stamp.windMembers;
  // §19 2026-09-29: nevneren over er medlemmer MED vinddata — si ærlig hvor mange som mangler.
  const windText =
    wind !== undefined && wind.withData < wind.nominal
      ? ` Vinddata: ${wind.withData} av ${wind.nominal} medlemmer — utelatt uten brukbare data: ${wind.missing.join(", ")}.`
      : "";
  const horizon = d.horizonTooShort ? " ADVARSEL: >20 % inkonklusive — medlemshorisonten er trolig for kort." : "";
  const felt = d.members.filter((m) => m.inconclusiveReason === "dekning-felt").length;
  const feltText =
    felt > 0
      ? ` ${felt} kom fram uten fullt værfelt langs ruten (bølger og/eller strøm mangler), telles ikke som gjennomførbare (D11.1).`
      : "";
  const thin =
    d.light.reason === "tynt-grunnlag"
      ? ` Av ${d.nF + d.nInf} avgjorte kom ${d.nInf} ikke fram — for få til å tallfeste andelen.`
      : "";
  return `Ensemble (ADR-0005/§4.2): ${counts}${windText}${light}${thin}${times}${horizon}${feltText}`;
}

export function renderEnsembleSummary(
  el: HTMLElement,
  summary: EnsembleSummary,
  timing?: EnsembleTiming,
): void {
  const d = summary.departure;
  if (d !== null) {
    el.textContent = renderDepartureText(d) + progressText(timing);
    return;
  }
  // Fallback uten stempel/kontekst (tester, degradert flyt): de gamle tellingene.
  const p50 = summary.durationP50S !== undefined ? (summary.durationP50S / 3600).toFixed(1) : "–";
  const p90 = summary.durationP90S !== undefined ? (summary.durationP90S / 3600).toFixed(1) : "–";
  el.textContent =
    `Ensemble: ${summary.totalMembers} medlemmer kjørt. ` +
    `Gjennomførbar: ${summary.feasibleCount}. Inkonklusiv: ${summary.inconclusiveCount}` +
    `${summary.horizonTooShortWarning ? " — ADVARSEL: >20 %, medlemshorisonten er trolig for kort for denne seilasen" : ""}. ` +
    `Ugjennomførbar: ${summary.infeasibleCount}. Feil: ${summary.errorCount}. ` +
    `Varighet blant gjennomførbare — P50 ${p50} t, P90 ${p90} t.` +
    progressText(timing);
}

/**
 * Bail-out-linjen (§4.5, F4.6): «lengste strekk uten brukbart alternativ»
 * + dekning, alltid merket med basis. Tom bok/ingen dekning sier
 * «havnebok mangler dekning her» — aldri «ingen brukbart alternativ».
 */
export function renderBailout(el: HTMLElement, profile: BailoutProfile, bookLabel: string): void {
  const head = `Nødhavn (${bookLabel}; ${profile.label})`;
  if (profile.coverage === "none") {
    el.textContent = `${head}: havnebok mangler dekning her — ingen havn kunne vurderes.`;
    return;
  }
  const reached = profile.samples.filter((s) => s.status === "naadd").length;
  const gap =
    profile.longestGapS === null
      ? "ukjent"
      : profile.longestGapS >= profile.limitS
        ? `≥ ${(profile.limitS / 3600).toFixed(0)} t`
        : `${(profile.longestGapS / 3600).toFixed(1)} t`;
  const partial =
    profile.coverage === "partial"
      ? ` Dekning delvis — mangler dybde: ${profile.missingDepthHarbourIds.join(", ") || "–"}` +
        `${profile.missingFieldHarbourIds.length > 0 ? `; uten felt: ${profile.missingFieldHarbourIds.join(", ")}` : ""}.`
      : "";
  el.textContent =
    `${head}: lengste strekk uten brukbart alternativ ${gap}; ` +
    `${reached} av ${profile.samples.length} punkter langs ruten når en havn innen ${(profile.limitS / 3600).toFixed(0)} t ` +
    `(${profile.searchCount} nødhavnsøk, ${profile.fieldScreenedSamples} punkter silt av havnefeltet).${partial}`;
}

/** Følsomhetslinjen (§4.4): merket «basert på kontrollvær», aldri en del av trafikklyset. */
export function renderSensitivity(el: HTMLElement, report: SensitivityReport): void {
  const runText = report.runs
    .map((r) => {
      const s = r.outcome.summary;
      const t = r.outcome.kind === "feasible" && s !== null ? `${(s.durationS / 3600).toFixed(1)} t` : r.outcome.kind;
      const label = r.kind === "cruising" ? `fart ×${r.factor}` : `strøm ×${r.factor}`;
      return `${label}${r.basis === "verste-medlem" ? " (verste medlem)" : ""}: ${t}`;
    })
    .join("; ");
  const conflict = report.conflict
    ? " KONFLIKTSIGNAL: kontrollen kommer fram, men en perturbasjon gjør det ikke — se detaljer."
    : "";
  const most = report.mostSensitive === null ? "" : ` Mest følsom: ${report.mostSensitive === "cruising" ? "båtfart" : "strøm"}.`;
  el.textContent = `Følsomhet (${report.label}): ${runText || "ingen kjøringer"}.${most}${conflict}`;
}

/** Beslutningsregelen (§4.6) eller den alltid kodede fallbacken. */
export function renderDecision(el: HTMLElement, advice: DecisionAdvice): void {
  if (advice.kind === "fallback") {
    el.textContent = `Sjekkpunkt: ${advice.text}`;
    return;
  }
  const r = advice.rule;
  const when = new Date(r.checkEpochS * 1000).toISOString().slice(11, 16);
  el.textContent =
    `Sjekk selv kl. ${when} UTC ved ${r.position.lat.toFixed(3)}°N ${r.position.lon.toFixed(3)}°Ø: ` +
    `er du ${r.test} for punktet?${r.explanation ? ` (${r.explanation})` : ""} Hvis ikke — ${r.action} ` +
    `Skiller ${r.hitRate.k} av ${r.hitRate.n} utfall. ` +
    `Provisoriske terskler (2 nm, 0,75) — viften vises alltid ved siden av.`;
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
    `${measurement.hardwareConcurrency ?? "?"} kjerner, ${measurement.poolSize} Workere. ` +
    // D13.2 a: mangler API-et i Workerne, sies det rett ut — ingen null som ser ut som 0.
    (measurement.workerMemoryApi && measurement.maxWorkerHeapMB !== null
      ? `Største Worker-heap ${measurement.maxWorkerHeapMB.toFixed(1)} MB. `
      : "Worker-heap: ikke målbar (performance.memory finnes ikke i Workerne) — analytisk grense §6.2 gjelder. ") +
    "Kopier og send:";
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
