/**
 * Ende-til-ende-orkestrering (fase 3 bølge 2C): pakke-peker → cache →
 * dekoding → `planRoute` på ekte vær, pluss ensemble-forberedelse og
 * MetAlerts. `main.ts` kaller `runWeatherPipeline` og gir DOM-oppdatering
 * videre via callbacks — selve funksjonen her er testbar med mocket
 * fetch/cache/worker-fabrikk (ingen DOM involvert).
 *
 * **Dokumentert forenkling (progressiv NEDLASTING, ikke bare progressiv
 * BEREGNING):** alle 29 medlem-blobbene hentes parallelt (`Promise.all`)
 * FØR worker-poolen starter å beregne. Selve BEREGNINGEN er progressiv
 * (kontroll først, så pool-parallell, strømmede resultater — se
 * `ensemble.ts`), men nedlastingen er det ikke. Dagens budsjett (§8:
 * ≤ 30 MB totalt for 30 medlemmer) gjør dette uproblematisk i praksis;
 * en fullt strømmet "hent-og-kjør-per-medlem"-vei er ikke bygget her.
 */
import { SKAGEN, SKJAELOY } from "@morild/routing/test-fixtures/golden-scenarios";
import { windMemberLayersFromBytes } from "@morild/weather";
import type { AppConfig } from "./config.js";
import { loadWeatherPointer, type PointerLoadResult } from "./pointer-client.js";
import { loadWeatherBlob } from "./blob-client.js";
import type { CacheStorageLike } from "./pack-cache.js";
import { primaryTileFor } from "./tile-select.js";
import { fieldPresenceStatuses, type FieldPresenceStatus } from "./field-status.js";
import {
  runEnsemble,
  type EnsembleCallbacks,
  type MemberJob,
  type MemberOutcome,
  type WorkerFactory,
} from "./ensemble.js";
import { fetchMetAlerts, type MetAlertsLoadResult } from "./metalerts-client.js";
import { filterAlertsForRoute, type RelevantAlert } from "./metalerts.js";
import type { PointerTileEntry } from "./pointer-types.js";

export interface PipelineDeps {
  readonly config: AppConfig;
  readonly fetchImpl: typeof fetch;
  readonly cacheStorage: CacheStorageLike;
  readonly workerFactory: WorkerFactory;
  readonly poolSize: number;
  readonly nowEpochS: number;
}

export interface PipelineCallbacks {
  readonly onPointerStatus?: (status: PointerLoadResult) => void;
  readonly onFieldStatuses?: (statuses: readonly FieldPresenceStatus[], tile: PointerTileEntry | undefined) => void;
  readonly onControlResult?: (outcome: MemberOutcome) => void;
  readonly onMemberResult?: EnsembleCallbacks["onMemberResult"];
  readonly onMetAlerts?: (result: MetAlertsLoadResult, relevant: readonly RelevantAlert[]) => void;
  readonly onError?: (message: string) => void;
}

/**
 * Peker på vind-medlemmenes felt-oppføringer i en flis, sortert etter
 * medlemsindeks (0 = kontroll).
 */
function windEntries(tile: PointerTileEntry) {
  return tile.fields
    .filter((f) => f.field === "wind")
    .slice()
    .sort((a, b) => a.member - b.member);
}

export async function runWeatherPipeline(deps: PipelineDeps, callbacks: PipelineCallbacks = {}): Promise<void> {
  const pointerResult = await loadWeatherPointer(deps.config, {
    fetchImpl: deps.fetchImpl,
    cacheStorage: deps.cacheStorage,
  });
  callbacks.onPointerStatus?.(pointerResult);
  if (pointerResult.status !== "ok") {
    callbacks.onError?.(
      pointerResult.status === "incompatible"
        ? `Pekeren er ikke kompatibel med denne klienten: ${pointerResult.reason}`
        : pointerResult.reason,
    );
    return;
  }

  const points = [SKJAELOY, SKAGEN];
  const tile = primaryTileFor(pointerResult.pointer, points);
  const fieldStatuses = fieldPresenceStatuses(tile, deps.nowEpochS);
  callbacks.onFieldStatuses?.(fieldStatuses, tile);

  if (tile === undefined) {
    callbacks.onError?.("Ingen værflis i pekeren dekker Skjæløy–Skagen");
    return;
  }

  const winds = windEntries(tile);
  const controlEntry = winds.find((f) => f.member === 0);
  if (controlEntry === undefined) {
    callbacks.onError?.("Pakken mangler et kontrollmedlem (member 0) for vind");
    return;
  }

  const blobDeps = { fetchImpl: deps.fetchImpl, cacheStorage: deps.cacheStorage };
  const controlBlob = await loadWeatherBlob(deps.config, controlEntry.key, blobDeps);
  const controlLayers = windMemberLayersFromBytes(new Uint8Array(controlBlob.buffer));
  // Pragmatisk MVP-valg (fase 3 bølge 2C, ikke spec-låst): avgangstidspunktet
  // settes til feltets FØRSTE tidssteg. En ekte "velg avgangstidspunkt"-UI
  // er fase 4/5s avgangstabell, ikke denne bølgens ansvar.
  const departEpochS = controlLayers.u.layer.geometry.t0S;

  const memberEntries = winds.filter((f) => f.member !== 0);
  const memberBuffers = await Promise.all(
    memberEntries.map((entry) => loadWeatherBlob(deps.config, entry.key, blobDeps)),
  );

  const jobs: MemberJob[] = [
    {
      memberIndex: controlEntry.member,
      isControl: true,
      windHeader: controlEntry.header,
      windBuffer: controlBlob.buffer,
      departEpochS,
    },
    ...memberEntries.map((entry, i) => ({
      memberIndex: entry.member,
      isControl: false,
      windHeader: entry.header,
      windBuffer: memberBuffers[i]!.buffer,
      departEpochS,
    })),
  ];

  const { outcomes } = await runEnsemble(jobs, deps.poolSize, deps.workerFactory, {
    onControlResult: (outcome) => {
      callbacks.onControlResult?.(outcome);
      if (outcome.result) {
        void runMetAlertsForControl(deps, callbacks, outcome.result.steps);
      }
    },
    ...(callbacks.onMemberResult ? { onMemberResult: callbacks.onMemberResult } : {}),
  });

  if (outcomes.length === 0) {
    callbacks.onError?.("Ingen ensemble-medlemmer kunne beregnes");
  }
}

async function runMetAlertsForControl(
  deps: PipelineDeps,
  callbacks: PipelineCallbacks,
  steps: readonly { readonly lat: number; readonly lon: number }[],
): Promise<void> {
  try {
    const result = await fetchMetAlerts(deps.config, deps.fetchImpl);
    const relevant = filterAlertsForRoute(result.alerts, steps, SKJAELOY, SKAGEN);
    callbacks.onMetAlerts?.(result, relevant);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    callbacks.onError?.(`MetAlerts-henting feilet: ${message}`);
  }
}
