/**
 * Måleprogrammets side (robusthet.md §6.4, D13.5 bolk 1), åpnet med
 * `?maaleprogram=1`. Tynt skall: planen (`plan.ts`), fremdriften
 * (`progress.ts`) og kjøringen (`runner.ts`) er rene/injiserte; her bor
 * bare DOM, nettleserglobaler og limet mellom dem.
 *
 * Én knapp starter. Programmet holder skjermlås mens det går (nettbrettet
 * kan stå på lader), lagrer fremdrift etter hver kjøring og fortsetter av
 * seg selv etter en omlasting. Til slutt: «Lagre på PC» (POST til den
 * dev-only Vite-mellomvaren) og «Kopier» som reserve.
 */
import { DEFAULT_APP_CONFIG, apiUrl } from "../weather/config.js";
import { browserCacheStorage, memoryCacheStorage } from "../weather/pack-cache.js";
import { createRealWeatherWorker } from "../weather/ensemble.js";
import { prepareEnsembleInputs, type EnsembleInputs } from "../weather/pipeline.js";
import { browserScreenLockDeps, createScreenLock, screenLockStatusText, type ScreenLockEvent } from "../screen-lock.js";
import { POINTER_STORAGE_KEY, QUERY_PARAM, SAVE_ENDPOINT } from "./constants.js";
import { buildRunPlan, type RunSpec } from "./plan.js";
import {
  appendEvent,
  buildProgramResult,
  clearProgress,
  isCrashLooping,
  loadProgress,
  packageCheck,
  packageFingerprint,
  recordRun,
  resumeFrom,
  saveProgress,
  startProgress,
  type DeviceInfo,
  type ProgramEvent,
  type ProgramProgress,
  type RunRecord,
  type StorageLike,
} from "./progress.js";
import { pause, runOne, type DummyWorkerLike, type RunnerDeps } from "./runner.js";

/** `?maaleprogram=1` (ren — testet). */
export function isMeasurementProgramRequested(search: string): boolean {
  return new URLSearchParams(search).get(QUERY_PARAM) === "1";
}

/**
 * `fetch` som låser pekerdokumentet: første gang hentes det fra nettet og
 * gis til `onFetched` (lagres); ved gjenopptak serveres den lagrede
 * teksten, så programmet fortsetter på SAMME pakke selv om cron har byttet
 * pekeren i mellomtiden. Blobbene er innholdsadresserte og uforanderlige.
 */
export function pinnedPointerFetch(
  base: typeof fetch,
  pointerUrl: string,
  pinned: string | null,
  onFetched: (text: string) => void,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== pointerUrl) return base(input, init);
    if (pinned !== null) {
      return new Response(pinned, { status: 200, headers: { "content-type": "application/json" } });
    }
    const res = await base(input, init);
    if (res.ok) onFetched(await res.clone().text());
    return res;
  };
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function browserStorage(): { readonly storage: StorageLike; readonly persistent: boolean } {
  try {
    const s = window.localStorage;
    s.getItem("");
    return { storage: s, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

function deviceInfo(): DeviceInfo {
  const nav = navigator as Navigator & { readonly deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : null,
    deviceMemoryGB: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
  };
}

function createDummyWorker(): DummyWorkerLike {
  // Samme duck-typede cast som `createRealWeatherWorker` (se der).
  return new Worker(new URL("../workers/dummy-load.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as DummyWorkerLike;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className !== undefined) e.className = className;
  return e;
}

function describeSpec(spec: RunSpec): string {
  switch (spec.kind) {
    case "pool":
      return `poolsveip, pool ${spec.pool} (gjentak ${spec.repeat + 1})`;
    case "solo":
      return `solo, medlem 0 på én Worker (gjentak ${spec.repeat + 1})`;
    case "dummy":
      return `solo + ${spec.k} dummy-Worker(e) «${spec.variant}» (gjentak ${spec.repeat + 1})`;
  }
}

function lockEventToProgram(e: ScreenLockEvent, at: string): ProgramEvent {
  switch (e.kind) {
    case "acquired":
      return { at, kind: "wake-lock-acquired" };
    case "released":
      return { at, kind: "wake-lock-released", detail: e.by === "app" ? "sluppet av appen" : "sluppet av systemet" };
    case "denied":
      return { at, kind: "wake-lock-denied", detail: e.message };
    case "visibility":
      return { at, kind: "visibility", detail: e.state };
  }
}

export function startMeasurementProgram(root: HTMLElement): void {
  const now = (): string => new Date().toISOString();
  const plan = buildRunPlan();
  const { storage, persistent } = browserStorage();

  // ---- DOM
  root.replaceChildren();
  const page = el("main", undefined, "maaleprogram");
  const title = el("h1", "Måleprogram — nettbrett (robusthet.md §6.4)");
  const intro = el(
    "p",
    `${plan.length} kjøringer: poolsveip, solo og solo + dummy-last, med 15 s pause mellom hver ` +
      "(ca. 45 min på Tab S7 FE). Programmet holder skjermen på, lagrer fremdrift etter hver kjøring og " +
      "fortsetter av seg selv om siden lastes på nytt. Sett nettbrettet på lader og gå fra det.",
  );
  const secure = el(
    "p",
    window.isSecureContext
      ? "Sikker kontekst: ja (skjermlås og offline-lager er tilgjengelig)."
      : "⚠ Usikker kontekst (http over LAN-IP): skjermlås og offline-lager er utilgjengelige. " +
          "Sett Chrome-flagget #unsafely-treat-insecure-origin-as-secure — se oppskriften.",
    window.isSecureContext ? undefined : "weather-warning",
  );
  const storageWarn = persistent
    ? null
    : el("p", "⚠ localStorage er utilgjengelig: fremdriften overlever ikke en omlasting.", "weather-warning");
  const lockEl = el("div", screenLockStatusText("idle"));
  const statusEl = el("div", "Klar.");
  const lastEl = el("div");
  const buttons = el("div");
  const startBtn = el("button", "Start måleprogrammet");
  startBtn.type = "button";
  const resetBtn = el("button", "Nullstill fremdrift");
  resetBtn.type = "button";
  const resultEl = el("div");
  const logEl = el("pre");
  logEl.style.whiteSpace = "pre-wrap";
  logEl.style.fontSize = "0.8em";
  buttons.append(startBtn, resetBtn);
  page.append(title, intro, secure, ...(storageWarn ? [storageWarn] : []), lockEl, statusEl, lastEl, buttons, resultEl, logEl);
  root.append(page);

  // ---- tilstand
  let current: ProgramProgress | null = null;
  let pendingEvents: ProgramEvent[] = [];
  let hiddenSinceLast = false;
  let running = false;

  const renderLog = (): void => {
    const events = current?.events ?? pendingEvents;
    logEl.textContent = events
      .slice(-12)
      .map((e) => `${e.at}  ${e.kind}${e.detail ? ` — ${e.detail}` : ""}`)
      .join("\n");
  };

  const persist = (): void => {
    if (current === null) return;
    if (!saveProgress(storage, current)) {
      current = appendEvent(current, { at: now(), kind: "storage-error", detail: "localStorage nektet å lagre fremdrift" });
    }
    renderLog();
  };

  const addEvent = (e: ProgramEvent): void => {
    if (current === null) pendingEvents.push(e);
    else current = appendEvent(current, e);
    persist();
    renderLog();
  };

  const screenLock = createScreenLock({
    ...browserScreenLockDeps(),
    onState: (state) => {
      lockEl.textContent = screenLockStatusText(state);
    },
    onEvent: (e) => {
      if (e.kind === "visibility" && e.state !== "visible") hiddenSinceLast = true;
      // Logg bare mens programmet går — etterpå er det ikke måledata.
      if (running) addEvent(lockEventToProgram(e, now()));
    },
  });

  const renderResult = (progress: ProgramProgress): void => {
    const result = buildProgramResult(progress);
    const json = JSON.stringify(result);
    resultEl.replaceChildren();
    const summary = el(
      "div",
      `${result.runs.length}/${result.plannedRuns} kjøringer, ${result.interruptions} avbrudd, pakke ${result.package.hash}. ` +
        (result.workerMemoryApi && result.maxWorkerHeapMB !== null
          ? `Største Worker-heap ${result.maxWorkerHeapMB.toFixed(1)} MB.`
          : "Worker-heap: ikke målbar (performance.memory finnes ikke i Workerne) — analytisk grense §6.2 gjelder."),
    );
    const saveBtn = el("button", "Lagre på PC");
    saveBtn.type = "button";
    const copyBtn = el("button", "Kopier");
    copyBtn.type = "button";
    const saveStatus = el("div");
    const area = el("textarea");
    area.readOnly = true;
    area.rows = 6;
    area.value = json;
    area.setAttribute("aria-label", "Måleprogrammets resultat som JSON");
    saveBtn.addEventListener("click", () => {
      saveStatus.textContent = "Lagrer …";
      fetch(SAVE_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: json })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as { ok?: boolean; path?: string; error?: string } | null;
          saveStatus.textContent =
            res.ok && body?.ok === true
              ? `Lagret på PC-en: ${body.path ?? "(ukjent sti)"}`
              : `Lagring feilet (${body?.error ?? `HTTP ${res.status}`}) — mellomvaren finnes bare i vite dev. Bruk «Kopier».`;
        })
        .catch((err: unknown) => {
          saveStatus.textContent = `Lagring feilet (${String(err)}) — bruk «Kopier».`;
        });
    });
    copyBtn.addEventListener("click", () => {
      const fallback = (): void => {
        area.select();
        copyBtn.textContent = "Marker og kopier manuelt";
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(json).then(() => {
          copyBtn.textContent = "Kopiert ✓";
        }, fallback);
      } else {
        fallback();
      }
    });
    resultEl.append(summary, saveBtn, copyBtn, saveStatus, area);
  };

  const renderLastRun = (run: RunRecord): void => {
    lastEl.textContent =
      `Siste: ${run.id} — ${(run.wallMs / 1000).toFixed(1)} s` +
      (run.controlMs !== null ? `, kontroll ${(run.controlMs / 1000).toFixed(1)} s` : "") +
      (run.errors > 0 ? `, ${run.errors} feil` : "") +
      (run.hiddenDuringRun ? " (siden var skjult underveis)" : "");
  };

  async function loadInputs(): Promise<EnsembleInputs | null> {
    let pinned: string | null;
    try {
      pinned = storage.getItem(POINTER_STORAGE_KEY);
    } catch {
      pinned = null;
    }
    const pointerUrl = apiUrl(DEFAULT_APP_CONFIG, `/pointer/${DEFAULT_APP_CONFIG.weatherPointerName}`);
    const fetchImpl = pinnedPointerFetch(fetch.bind(window), pointerUrl, pinned, (text) => {
      try {
        storage.setItem(POINTER_STORAGE_KEY, text);
      } catch {
        addEvent({ at: now(), kind: "storage-error", detail: "pekeren kunne ikke lagres — gjenopptak kan få en annen pakke" });
      }
    });
    let error: string | null = null;
    const inputs = await prepareEnsembleInputs(
      {
        config: DEFAULT_APP_CONFIG,
        fetchImpl,
        cacheStorage: browserCacheStorage() ?? memoryCacheStorage(),
        nowEpochS: Math.floor(Date.now() / 1000),
      },
      {
        onError: (message) => {
          error = message;
        },
      },
    );
    if (inputs === null) statusEl.textContent = `Kunne ikke hente pakken: ${error ?? "ukjent feil"}`;
    return inputs;
  }

  const deps: RunnerDeps = {
    workerFactory: createRealWeatherWorker,
    dummyFactory: createDummyWorker,
    clockMs: () => performance.now(),
    now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    takeHiddenFlag: () => {
      const h = hiddenSinceLast || document.visibilityState !== "visible";
      hiddenSinceLast = false;
      return h;
    },
  };

  async function run(resumed: ProgramProgress | null): Promise<void> {
    running = true;
    startBtn.disabled = true;
    resetBtn.disabled = true;
    resultEl.replaceChildren();
    current = resumed;
    await screenLock.acquire();
    try {
      statusEl.textContent = "Henter peker og pakke (én gang) …";
      const inputs = await loadInputs();
      if (inputs === null) return;
      const pkg = packageFingerprint({
        blobHashes: inputs.blobHashes,
        init: inputs.packageInit,
        memberCount: inputs.memberCount,
      });
      if (current === null) {
        const started = startProgress({ now: now(), device: deviceInfo(), pkg, plan });
        // Hendelser fra før pakken var hentet (skjermlås) kom først — behold tidsrekkefølgen.
        current = { ...started, events: [...pendingEvents, ...started.events] };
        pendingEvents = [];
      } else if (packageCheck(current, pkg) === "mismatch") {
        // Aldri bland data fra to pakker (spec-en: «samme pakke gjennom hele programmet»).
        addEvent({ at: now(), kind: "package-mismatch", detail: `lagret ${current.package.hash}, hentet ${pkg.hash}` });
        statusEl.textContent =
          "Stoppet: pakken ved gjenopptak er ikke den programmet startet med. Lagre det som finnes, og nullstill.";
        renderResult(current);
        return;
      } else {
        current = appendEvent(current, { at: now(), kind: "resume", detail: `fra kjøring ${current.nextIndex}` });
      }
      persist();

      for (let i = current.nextIndex; i < plan.length; i += 1) {
        const spec = plan[i]!;
        statusEl.textContent = `Kjøring ${i + 1}/${plan.length}: ${describeSpec(spec)} …`;
        const failed = (message: string): RunRecord => {
          addEvent({ at: now(), kind: "run-error", detail: `${spec.id}: ${message}` });
          return {
            index: i,
            id: spec.id,
            kind: spec.kind,
            pool: spec.kind === "pool" ? spec.pool : null,
            k: spec.kind === "dummy" ? spec.k : null,
            variant: spec.kind === "dummy" ? spec.variant : null,
            repeat: spec.repeat,
            startedAt: now(),
            wallMs: 0,
            controlMs: null,
            ensembleWallMs: null,
            control: null,
            members: [],
            errors: 1,
            hiddenDuringRun: deps.takeHiddenFlag(),
          };
        };
        let record: RunRecord;
        if (isCrashLooping(current)) {
          // Samme kjøring har tatt ned fanen gjentatte ganger — hopp over
          // den i stedet for en evig omlastingsløkke (manglende data vises).
          record = failed(
            `hoppet over etter ${current.interruptionsAtNext ?? 0} avbrudd på denne kjøringen (tar trolig ned fanen)`,
          );
        } else {
          try {
            record = await runOne(spec, i, inputs, deps);
          } catch (err) {
            record = failed(err instanceof Error ? err.message : String(err));
          }
        }
        current = recordRun(current, record, now());
        persist();
        renderLastRun(record);
        if (i + 1 < plan.length) {
          statusEl.textContent = `Kjøring ${i + 1}/${plan.length} ferdig — termisk pause 15 s …`;
          await pause(deps);
        }
      }
      statusEl.textContent = "Ferdig. Lagre resultatet på PC-en (eller kopier).";
      renderResult(current);
    } finally {
      await screenLock.release();
      running = false;
      resetBtn.disabled = false;
      // Uten påbegynt program (pakken kunne ikke hentes) kan man prøve igjen.
      startBtn.disabled = current !== null;
    }
  }

  startBtn.addEventListener("click", () => {
    void run(null);
  });
  resetBtn.addEventListener("click", () => {
    clearProgress(storage, [POINTER_STORAGE_KEY]);
    current = null;
    pendingEvents = [];
    resultEl.replaceChildren();
    lastEl.textContent = "";
    logEl.textContent = "";
    statusEl.textContent = "Fremdrift nullstilt. Klar.";
    startBtn.disabled = false;
  });

  // ---- oppstart: gjenoppta, vis ferdig resultat, eller vent på knappen
  const decision = resumeFrom(loadProgress(storage), plan, now());
  switch (decision.kind) {
    case "none":
      startBtn.disabled = false;
      break;
    case "done":
      current = decision.progress;
      startBtn.disabled = true;
      statusEl.textContent = "Programmet er ferdig (lagret fremdrift). Lagre resultatet, eller nullstill for å starte på nytt.";
      renderResult(decision.progress);
      renderLog();
      break;
    case "plan-changed":
      current = decision.progress;
      startBtn.disabled = true;
      statusEl.textContent =
        "Lagret fremdrift er fra en annen kjøreplan (konstantene er endret) og kan ikke gjenopptas. Lagre det som finnes, og nullstill.";
      renderResult(decision.progress);
      renderLog();
      break;
    case "resume":
      statusEl.textContent = "Gjenopptar etter avbrudd …";
      void run(decision.progress);
      break;
  }
}
