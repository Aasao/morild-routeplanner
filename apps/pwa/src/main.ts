/**
 * `apps/pwa` — bootstrap: kart (F1.8), disclaimer, "hello route"-beviset
 * for at rutemotoren kjører i en Web Worker (ADR-0002), og — fase 3
 * bølge 2C — den ekte værpakke-flyten (pakke-peker → cache → dekoding →
 * `planRoute` på ekte vær, ensemble-forberedelse, MetAlerts). Se
 * docs/specs/app-skjelett.md og docs/specs/vaerpakker.md §5/§14/§15.
 */
import "./style.css";
import { createMap, drawHelloRoute, drawWeatherRoute, whenMapReady } from "./map.js";
import { runHelloRoute } from "./hello-route.js";
import { DEFAULT_APP_CONFIG } from "./weather/config.js";
import { browserCacheStorage, memoryCacheStorage, requestPersistentStorage } from "./weather/pack-cache.js";
import { createRealWeatherWorker, defaultPoolSize } from "./weather/ensemble.js";
import {
  browserMeasurementEnvironment,
  buildEnsembleMeasurement,
  memberMeasurement,
  type MemberMeasurement,
} from "./weather/measurement.js";
import { runWeatherPipeline } from "./weather/pipeline.js";
import { allDisplayFlags } from "./weather/route-flags.js";
import type { FieldPresenceStatus } from "./weather/field-status.js";
import {
  renderControlResult,
  renderEnsembleSummary,
  renderFieldStatuses,
  renderFlags,
  renderMetAlerts,
  renderPointerStatus,
  renderTileSelection,
  renderMeasurement,
  renderSensitivity,
  renderDecision,
  renderBailout,
} from "./weather-ui.js";
import {
  FALLBACK,
  buildFirstPage,
  createPlanReceipt,
  deriveDecisionRule,
  realizeReceipt,
  type DecisionAdvice,
  type DepartureSummary,
  type SensitivityReport,
} from "@morild/robustness";
import type { BailoutProfile } from "@morild/routing";
import { renderFan, renderFirstPage, renderReceiptControls } from "./first-page-ui.js";

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => requestPersistentStorage())
      .catch((err: unknown) => {
        console.warn("Service worker-registrering feilet:", err);
      });
  });
}

function formatStatus(result: Awaited<ReturnType<typeof runHelloRoute>>): string {
  if (result.type === "error") {
    return `Hello-route feilet: ${result.message}`;
  }
  const reachedText = result.reached ? "nådde målet" : "nådde IKKE målet";
  const distance = result.totals.distanceNm.toFixed(1);
  const duration = (result.totals.durationS / 3600).toFixed(1);
  return `${result.scenario}: ${reachedText} — ${distance} nm, ${duration} t (syntetisk golden-fikstur, ikke ekte vær)`;
}

function runWeatherFlow(mapReady: Promise<void>, map: ReturnType<typeof createMap>): void {
  const pointerStatusEl = document.querySelector<HTMLDivElement>("#weather-pointer-status");
  const tileSelectionEl = document.querySelector<HTMLDivElement>("#weather-tile-selection");
  const fieldStatusEl = document.querySelector<HTMLDivElement>("#weather-field-status");
  const controlResultEl = document.querySelector<HTMLDivElement>("#weather-control-result");
  const flagsEl = document.querySelector<HTMLDivElement>("#weather-flags");
  const ensembleEl = document.querySelector<HTMLDivElement>("#weather-ensemble-summary");
  const metalertsEl = document.querySelector<HTMLDivElement>("#weather-metalerts");
  const measurementEl = document.querySelector<HTMLDivElement>("#weather-measurement");
  const sensitivityEl = document.querySelector<HTMLDivElement>("#weather-sensitivity");
  const bailoutEl = document.querySelector<HTMLDivElement>("#weather-bailout");
  const firstPageEl = document.querySelector<HTMLDivElement>("#weather-firstpage");
  const fanEl = document.querySelector<HTMLDivElement>("#weather-fan");
  const receiptEl = document.querySelector<HTMLDivElement>("#weather-receipt");

  // Førstesiden (§4.7) bygges på nytt ved hver ny bit informasjon — alt
  // kommer ferdig fra @morild/robustness; her holdes bare siste tilstand.
  const page: {
    departure: DepartureSummary | null;
    advice: DecisionAdvice | null;
    sensitivity: SensitivityReport | null | "ikke-beregnet";
    bailout: BailoutProfile | null;
  } = { departure: null, advice: null, sensitivity: "ikke-beregnet", bailout: null };
  const STALE_AFTER_S = 6 * 3600; // samme som packages/weather/age.ts
  function refreshFirstPage(): void {
    const d = page.departure;
    if (d === null || firstPageEl === null) return;
    const wind = lastFieldStatuses.find((f) => f.field === "wind");
    const feasible = d.members.filter((m) => m.kind === "feasible" && m.summary !== null);
    const thresholds = [
      {
        id: "moerke",
        label: "framme før mørket",
        k: feasible.filter((m) => m.summary?.daylightArrival === true).length,
        n: feasible.length,
      },
    ];
    const built = buildFirstPage({
      summary: d,
      advice: page.advice,
      sensitivity: page.sensitivity,
      bailout: page.bailout,
      packageAgeS: wind?.ageS ?? null,
      staleAfterS: STALE_AFTER_S,
      thresholds,
    });
    renderFirstPage(firstPageEl, built);
    if (fanEl) renderFan(fanEl, built.fan);
    if (receiptEl) {
      // Kvitteringen fryser også bail-out-tallet (§3.6) — uten profil er
      // planen ikke komplett nok til å kvittere på.
      const bailout = page.bailout;
      renderReceiptControls(receiptEl, {
        canPlan: d.complete && bailout !== null,
        onPlan: () =>
          d.complete && bailout !== null
            ? createPlanReceipt({
                plannedAtEpochS: Math.floor(Date.now() / 1000),
                summary: d,
                advice: page.advice ?? FALLBACK,
                bailout,
              })
            : null,
        onRealize: (receipt) =>
          realizeReceipt(receipt, { arrivalEpochS: Math.floor(Date.now() / 1000), aborted: false }),
      });
    }
  }
  const decisionEl = document.querySelector<HTMLDivElement>("#weather-decision");

  // Cache API finnes kun i secure context (https/localhost). Fra en
  // LAN-IP over http (nettbrett-røyktest) faller vi ærlig tilbake til
  // minne-cache: ruting virker, men ingen offline-lagring (N2-flagg).
  const persistent = browserCacheStorage();
  const cacheStorage = persistent ?? memoryCacheStorage();
  if (persistent === undefined && pointerStatusEl) {
    // Egen, varig stripe — pekerstatusen under overskrives av pipelinen.
    const warn = document.createElement("div");
    warn.className = "weather-warning";
    warn.textContent =
      "⚠ Offline-lager utilgjengelig (usikker kontekst — http uten localhost/https): " +
      "værpakken lastes uten cache og overlever ikke sideinnlasting.";
    pointerStatusEl.insertAdjacentElement("beforebegin", warn);
  }

  let lastFieldStatuses: readonly FieldPresenceStatus[] = [];
  // Nettbrett-måling (ADR-0005 port 1): veggklokke for ensemblet regnes fra
  // kontrollen er ferdig; medlemstallet hentes fra flisvalget.
  const poolSize = defaultPoolSize(navigator.hardwareConcurrency);
  let ensembleStartMs: number | undefined;
  let membersTotal = 0;
  // D10.2 (b): per-medlem-registrering til den kopierbare JSON-en.
  let controlMeasurement: MemberMeasurement | null = null;
  const memberMeasurements: MemberMeasurement[] = [];

  void runWeatherPipeline(
    {
      config: DEFAULT_APP_CONFIG,
      fetchImpl: fetch.bind(window),
      cacheStorage,
      workerFactory: createRealWeatherWorker,
      poolSize,
      perturbation: true,
      bailout: true,
      worstFirst: true,
      nowEpochS: Math.floor(Date.now() / 1000),
    },
    {
      onPointerStatus: (status) => {
        if (pointerStatusEl) renderPointerStatus(pointerStatusEl, status);
      },
      onTileSelection: (selection, rejections) => {
        if (tileSelectionEl) renderTileSelection(tileSelectionEl, selection, rejections);
      },
      onFieldStatuses: (statuses) => {
        lastFieldStatuses = statuses;
        if (fieldStatusEl) renderFieldStatuses(fieldStatusEl, statuses);
        refreshFirstPage();
      },
      onControlResult: (outcome, memberCount) => {
        ensembleStartMs = performance.now();
        membersTotal = memberCount;
        controlMeasurement = memberMeasurement(outcome, 0);
        memberMeasurements.length = 0;
        if (controlResultEl) renderControlResult(controlResultEl, outcome);
        if (bailoutEl) bailoutEl.textContent = "Nødhavn: beregner profil langs ruten …";
        page.bailout = null;
        refreshFirstPage();
        const result = outcome.result;
        if (result === undefined) return;
        if (flagsEl) {
          renderFlags(flagsEl, allDisplayFlags(result, lastFieldStatuses));
        }
        if (result.steps.length > 0) {
          mapReady
            .then(() => drawWeatherRoute(map, result.steps))
            .catch(() => {
              /* kartet er uansett ikke kritisk for at værpanelet skal vise tall */
            });
        }
      },
      onBailout: (profile, bailoutMs) => {
        // Havneboken i appen er ennå interim-fiksturen (robusthet.md §2: aldri
        // produksjonsdata) — det skal stå i selve linjen til F4.6-boken er reell.
        if (bailoutEl) {
          renderBailout(bailoutEl, profile, "FIKSTUR-HAVNEBOK — dybder og mørketrygghet er ikke reelle");
        }
        page.bailout = profile;
        if (controlMeasurement !== null) controlMeasurement = { ...controlMeasurement, bailoutMs };
        refreshFirstPage();
      },
      onSensitivity: (report) => {
        if (sensitivityEl) renderSensitivity(sensitivityEl, report);
        page.sensitivity = report;
        refreshFirstPage();
      },
      onMemberResult: (outcome, summary) => {
        const d = summary.departure;
        page.departure = d;
        if (d !== null && d.complete) {
          page.advice = deriveDecisionRule({
            control: d.control,
            members: d.members,
            complete: d.complete,
            nF: d.nF,
            nInf: d.nInf,
          });
          if (decisionEl) renderDecision(decisionEl, page.advice);
        }
        refreshFirstPage();
        if (outcome.isControl) return;
        memberMeasurements.push(memberMeasurement(outcome, memberMeasurements.length));
        const wallMs = ensembleStartMs === undefined ? undefined : performance.now() - ensembleStartMs;
        const membersDone = summary.totalMembers - 1;
        if (ensembleEl) {
          const timing = wallMs === undefined ? undefined : { wallMs, membersDone, membersTotal, poolSize };
          renderEnsembleSummary(ensembleEl, summary, timing);
        }
        if (measurementEl && membersDone >= membersTotal) {
          renderMeasurement(
            measurementEl,
            buildEnsembleMeasurement({
              env: browserMeasurementEnvironment(),
              poolSize,
              control: controlMeasurement,
              ensembleWallMs: wallMs ?? null,
              members: memberMeasurements,
            }),
          );
        }
      },
      onMetAlerts: (result, relevant) => {
        if (metalertsEl) renderMetAlerts(metalertsEl, result, relevant);
      },
      onError: (message) => {
        if (pointerStatusEl) pointerStatusEl.textContent = `Værflyt: ${message}`;
        console.warn("Værflyt feilet:", message);
      },
    },
  );
}

function main(): void {
  const container = document.querySelector<HTMLDivElement>("#map");
  if (!container) {
    throw new Error("Fant ikke #map i index.html");
  }
  const map = createMap(container);
  const mapReady = whenMapReady(map);
  const statusEl = document.querySelector<HTMLDivElement>("#hello-route-status");

  runHelloRoute()
    .then(async (result) => {
      // Status først: søkeresultatet skal ikke gisles av kartet. Laster
      // kartet aldri (2026-09-27: MapLibre-Worker 404), sto «Kjører
      // hello-route …» for alltid selv om søket var ferdig på sekunder.
      if (statusEl) {
        statusEl.textContent = formatStatus(result);
      }
      if (result.type === "hello-route-result") {
        // Rutemotor-Workeren og MapLibres stil-lasting løper parallelt og
        // uavhengig av hverandre — å tegne før stilen er klar feiler helt
        // stille (`getSource` returnerer `undefined`), se map.ts.
        await mapReady;
        drawHelloRoute(map, result.steps);
      }
    })
    .catch((err: unknown) => {
      if (statusEl) {
        statusEl.textContent = `Hello-route feilet: ${String(err)}`;
      }
    });

  registerServiceWorker();
  runWeatherFlow(mapReady, map);
}

main();
