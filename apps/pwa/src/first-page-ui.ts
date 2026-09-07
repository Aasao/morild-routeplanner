/**
 * Førstesiden (robusthet.md §4.7, D8.11) — DOM-en for det rene
 * `buildFirstPage`-resultatet fra `@morild/robustness`: linjer i spec-ens
 * rekkefølge, vær-langs-ruten-viften som SVG, «bak trykket» som
 * `<details>`, og kvitteringsknappen (§3.6, D8.12).
 *
 * Ingen tall regnes her — alt kommer ferdig fra robusthetspakken. Det som
 * lever i denne filen er kun rendering og den lokale kvitteringsloggen
 * (`localStorage`, per enhet; LWW-synk over D1 er fase 4b).
 */
import type { FanBand, FirstPage, PlanReceipt } from "@morild/robustness";

const SEVERITY_CLASS: Record<FirstPage["lines"][number]["severity"], string> = {
  info: "fp-info",
  advarsel: "fp-advarsel",
  kritisk: "fp-kritisk",
};

export function renderFirstPage(el: HTMLElement, page: FirstPage): void {
  el.replaceChildren();
  for (const line of page.lines) {
    const div = document.createElement("div");
    div.className = `fp-line fp-${line.kind} ${SEVERITY_CLASS[line.severity]}`;
    div.textContent = line.text;
    el.append(div);
  }
  if (page.behindTap.length > 0) {
    const details = document.createElement("details");
    details.className = "fp-behind";
    const summary = document.createElement("summary");
    summary.textContent = "Detaljer (statistikk, følsomhet, stempel)";
    details.append(summary);
    for (const item of page.behindTap) {
      const row = document.createElement("div");
      row.className = "fp-behind-row";
      const label = document.createElement("strong");
      label.textContent = `${item.label}: `;
      row.append(label, document.createTextNode(item.text));
      details.append(row);
    }
    el.append(details);
  }
}

/**
 * Viften (§4.7 pkt. 7): x = timer etter avgang, y = signert tverravstand
 * fra kontrollruten i nm. Bånd min–maks (lys), P10–P90 (mørkere), P50
 * som linje, kontrollen som null-linjen. Ren SVG, ingen bibliotek.
 */
interface FanPoint {
  readonly h: number;
  readonly min: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly max: number;
  readonly nMembers: number;
}

function hasStats(p: FanBand["hours"][number]): p is FanBand["hours"][number] & FanPoint {
  return p.min !== null && p.p10 !== null && p.p50 !== null && p.p90 !== null && p.max !== null;
}

export function renderFan(el: HTMLElement, fan: FanBand | null): void {
  el.replaceChildren();
  // Timer med < 3 medlemmer har null-statistikk (§4.7) og tegnes ikke —
  // viften viser bare det den faktisk vet.
  const hours: readonly FanPoint[] = fan === null ? [] : fan.hours.filter(hasStats);
  const totalHours = fan === null ? 0 : fan.hours.length;
  if (hours.length === 0) {
    el.textContent = "Vifte: ikke nok medlemmer med posisjon ennå.";
    return;
  }
  const W = 400;
  const H = 120;
  const padL = 34;
  const padB = 18;
  const padT = 8;
  const hMax = Math.max(1, hours[hours.length - 1]!.h);
  const extent = Math.max(
    1,
    ...hours.flatMap((p) => [Math.abs(p.min), Math.abs(p.max)]),
  );
  const x = (h: number): number => padL + ((W - padL - 4) * h) / hMax;
  const y = (nm: number): number => padT + ((H - padT - padB) * (extent - nm)) / (2 * extent);
  const area = (top: (p: FanPoint) => number, bottom: (p: FanPoint) => number): string => {
    const up = hours.map((p) => `${x(p.h).toFixed(1)},${y(top(p)).toFixed(1)}`);
    const down = [...hours].reverse().map((p) => `${x(p.h).toFixed(1)},${y(bottom(p)).toFixed(1)}`);
    return `M${up.join(" L")} L${down.join(" L")} Z`;
  };
  const line = (v: (p: FanPoint) => number): string =>
    hours.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.h).toFixed(1)},${y(v(p)).toFixed(1)}`).join(" ");

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "fp-fan");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Vifte: medlemmenes tverravvik fra kontrollruten per time");
  const add = (tag: string, attrs: Record<string, string>, text?: string): void => {
    const node = document.createElementNS(svgNs, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
  };
  add("path", { d: area((p) => p.max, (p) => p.min), class: "fp-fan-outer" });
  add("path", { d: area((p) => p.p90, (p) => p.p10), class: "fp-fan-inner" });
  add("path", { d: line((p) => p.p50), class: "fp-fan-p50" });
  add("line", { x1: String(padL), x2: String(W - 4), y1: y(0).toFixed(1), y2: y(0).toFixed(1), class: "fp-fan-control" });
  add("text", { x: "2", y: (padT + 10).toFixed(1), class: "fp-fan-label" }, `+${extent.toFixed(0)} nm`);
  add("text", { x: "2", y: (H - padB).toFixed(1), class: "fp-fan-label" }, `−${extent.toFixed(0)} nm`);
  for (const h of [0, Math.round(hMax / 2), hMax]) {
    add("text", { x: x(h).toFixed(1), y: String(H - 4), class: "fp-fan-label", "text-anchor": "middle" }, `${h} t`);
  }
  el.append(svg);
  const caption = document.createElement("div");
  caption.className = "fp-fan-caption";
  const truncated =
    hours.length < totalHours
      ? ` Vist for ${hours.length} av ${totalHours} timer — resten har færre enn 3 medlemmer med posisjon.`
      : "";
  caption.textContent =
    "Vifte: tverravvik fra kontrollruten (0-linjen) per time — lyst bånd min–maks, mørkt P10–P90, strek typisk (P50). " +
    `Medlemmer med posisjon: ${Math.min(...hours.map((p) => p.nMembers))}–${Math.max(...hours.map((p) => p.nMembers))}.` +
    truncated;
  el.append(caption);
}

// ------------------------------------------------------------- kvittering

const RECEIPTS_KEY = "morild.plan-receipts.v1";

export function loadReceipts(): PlanReceipt[] {
  try {
    const raw = localStorage.getItem(RECEIPTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlanReceipt[]) : [];
  } catch {
    return [];
  }
}

export function saveReceipts(receipts: readonly PlanReceipt[]): boolean {
  try {
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
    return true;
  } catch {
    return false;
  }
}

/**
 * Kvitteringsknappene (D8.12): «Seil på denne planen» fryser kvitteringen;
 * «Registrer faktisk ankomst» fyller `realized` én gang. Loggen ligger i
 * `localStorage` på denne enheten — reliability-analysen ved sesongslutt
 * leser den (fase 4b flytter den til D1 med LWW).
 */
export function renderReceiptControls(
  el: HTMLElement,
  args: {
    readonly canPlan: boolean;
    readonly onPlan: () => PlanReceipt | null;
    readonly onRealize: (receipt: PlanReceipt) => PlanReceipt;
  },
): void {
  el.replaceChildren();
  const receipts = loadReceipts();
  const status = document.createElement("div");
  status.className = "fp-receipt-status";
  const open = receipts.filter((r) => r.realized === undefined);
  status.textContent =
    receipts.length === 0
      ? "Ingen kvitteringer på denne enheten ennå."
      : `${receipts.length} kvittering(er) lagret, ${open.length} uten registrert ankomst.`;

  const plan = document.createElement("button");
  plan.type = "button";
  plan.textContent = "Seil på denne planen (skriv kvittering)";
  plan.disabled = !args.canPlan;
  plan.addEventListener("click", () => {
    const receipt = args.onPlan();
    if (receipt === null) {
      status.textContent = "Kvittering ikke skrevet: avgangen er ikke ferdig beregnet.";
      return;
    }
    const ok = saveReceipts([...loadReceipts(), receipt]);
    status.textContent = ok
      ? `Kvittering skrevet ${new Date(receipt.plannedAtEpochS * 1000).toISOString()} — fryst.`
      : "Kvittering kunne ikke lagres (localStorage utilgjengelig).";
    renderReceiptControls(el, args);
  });

  const realize = document.createElement("button");
  realize.type = "button";
  realize.textContent = "Registrer faktisk ankomst nå (siste kvittering)";
  realize.disabled = open.length === 0;
  realize.addEventListener("click", () => {
    const all = loadReceipts();
    const idx = all.map((r) => r.realized === undefined).lastIndexOf(true);
    if (idx < 0) return;
    try {
      all[idx] = args.onRealize(all[idx]!);
      saveReceipts(all);
    } catch (err) {
      status.textContent = `Ankomst ikke registrert: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    renderReceiptControls(el, args);
  });

  el.append(status, plan, realize);
}
