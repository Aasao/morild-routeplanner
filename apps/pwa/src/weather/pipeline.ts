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
 *
 * **Flere fliser per rute (review-funn fase 3 bølge 2, funn 2):** en rute
 * kan krysse en flisgrense (§7 — Skjæløy→Skagen krysser 58°N, fliser
 * 5_28/5_29). ALLE fliser som overlapper ruteboksen lastes nå, per medlem,
 * og gis videre til Workeren som syr dem sammen (`compositeWeatherField`,
 * `weather-routing.worker.ts`) — se `tile-select.ts`s toppkommentar.
 */
import { SKAGEN, SKJAELOY } from "@morild/routing/test-fixtures/golden-scenarios";
import { windMemberLayersFromBytes } from "@morild/weather";
import type { AppConfig } from "./config.js";
import { loadWeatherPointer, type PointerLoadResult } from "./pointer-client.js";
import { loadWeatherBlob } from "./blob-client.js";
import type { CacheStorageLike } from "./pack-cache.js";
import { tilesFor } from "./tile-select.js";
import { fieldPresenceStatuses, type FieldPresenceStatus } from "./field-status.js";
import {
  runEnsemble,
  type EnsembleCallbacks,
  type MemberJob,
  type MemberOutcome,
  type TileWindSource,
  type WorkerFactory,
} from "./ensemble.js";
import { fetchMetAlerts, type MetAlertsLoadResult } from "./metalerts-client.js";
import { filterAlertsForRoute, type RelevantAlert } from "./metalerts.js";
import type { PointerFieldEntry, PointerTileEntry } from "./pointer-types.js";

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
  readonly onFieldStatuses?: (
    statuses: readonly FieldPresenceStatus[],
    tiles: readonly PointerTileEntry[],
  ) => void;
  readonly onControlResult?: (outcome: MemberOutcome) => void;
  readonly onMemberResult?: EnsembleCallbacks["onMemberResult"];
  readonly onMetAlerts?: (result: MetAlertsLoadResult, relevant: readonly RelevantAlert[]) => void;
  readonly onError?: (message: string) => void;
}

/**
 * Peker på vind-medlemmenes felt-oppføringer i ÉN flis, sortert etter
 * medlemsindeks (0 = kontroll).
 */
function windEntries(tile: PointerTileEntry) {
  return tile.fields
    .filter((f) => f.field === "wind")
    .slice()
    .sort((a, b) => a.member - b.member);
}

interface TileFieldEntry {
  readonly tile: PointerTileEntry;
  readonly entry: PointerFieldEntry;
}

/**
 * Grupperer ALLE rutens flisers vind-oppføringer per medlemsindeks — en
 * flis kan mangle et medlem (§7), så gruppen kan ha færre elementer enn
 * `tiles.length`; kalleren avgjør hvor mange fliser som faktisk kreves
 * (kontroll: minst én, §"Pakken mangler et kontrollmedlem").
 */
function windEntriesByMember(tiles: readonly PointerTileEntry[]): Map<number, TileFieldEntry[]> {
  const byMember = new Map<number, TileFieldEntry[]>();
  for (const tile of tiles) {
    for (const entry of windEntries(tile)) {
      const list = byMember.get(entry.member) ?? [];
      list.push({ tile, entry });
      byMember.set(entry.member, list);
    }
  }
  return byMember;
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
  const tiles = tilesFor(pointerResult.pointer, points);
  const fieldStatuses = fieldPresenceStatuses(tiles, deps.nowEpochS);
  callbacks.onFieldStatuses?.(fieldStatuses, tiles);

  if (tiles.length === 0) {
    callbacks.onError?.("Ingen værflis i pekeren dekker Skjæløy–Skagen");
    return;
  }

  const byMember = windEntriesByMember(tiles);
  const controlSources = byMember.get(0);
  if (controlSources === undefined || controlSources.length === 0) {
    callbacks.onError?.("Pakken mangler et kontrollmedlem (member 0) for vind i noen av rutens fliser");
    return;
  }

  const blobDeps = { fetchImpl: deps.fetchImpl, cacheStorage: deps.cacheStorage };

  const controlBlobs = await Promise.all(
    controlSources.map((s) => loadWeatherBlob(deps.config, s.entry.key, blobDeps)),
  );
  // Pragmatisk MVP-valg (fase 3 bølge 2C, ikke spec-låst): avgangstidspunktet
  // settes til feltets FØRSTE tidssteg — lest fra FØRSTE flis' kontroll-
  // buffer (fliser fra samme pakkebygg deler `t0S` i praksis, §7/§5). En
  // ekte "velg avgangstidspunkt"-UI er fase 4/5s avgangstabell, ikke denne
  // bølgens ansvar.
  const departEpochS = windMemberLayersFromBytes(new Uint8Array(controlBlobs[0]!.buffer)).u.layer.geometry.t0S;
  const controlTiles: TileWindSource[] = controlSources.map((s, i) => ({
    tileId: s.tile.tileId,
    windHeader: s.entry.header,
    windBuffer: controlBlobs[i]!.buffer,
  }));

  const memberIndices = Array.from(byMember.keys())
    .filter((m) => m !== 0)
    .sort((a, b) => a - b);
  const memberSourcesByIndex = memberIndices.map((m) => byMember.get(m)!);
  const memberBlobsByIndex = await Promise.all(
    memberSourcesByIndex.map((sources) =>
      Promise.all(sources.map((s) => loadWeatherBlob(deps.config, s.entry.key, blobDeps))),
    ),
  );

  const jobs: MemberJob[] = [
    {
      memberIndex: 0,
      isControl: true,
      tiles: controlTiles,
      departEpochS,
    },
    ...memberIndices.map((memberIndex, i) => ({
      memberIndex,
      isControl: false,
      tiles: memberSourcesByIndex[i]!.map((s, j) => ({
        tileId: s.tile.tileId,
        windHeader: s.entry.header,
        windBuffer: memberBlobsByIndex[i]![j]!.buffer,
      })),
      departEpochS,
    })),
  ];

  // MetAlerts hentes PARALLELT med ensemble-beregningen (starter så snart
  // kontrollruten finnes, blokkerer ikke medlemmene), men pipelinen løser
  // seg først når også den jobben er ferdig. Før var den fire-and-forget
  // (`void`), og «pipelinen er ferdig» garanterte da IKKE at `onMetAlerts`
  // hadde gått — et kappløp mellom `Response.json()`s event-loop-hopp og
  // ensemblets synkrone `planRoute`: grønt på Node 24 lokalt, rødt på
  // Node 22 i CI (PR #1). `runMetAlertsForControl` fanger sine egne feil,
  // så denne await-en kan ikke kaste.
  let metAlertsDone: Promise<void> = Promise.resolve();
  const { outcomes } = await runEnsemble(jobs, deps.poolSize, deps.workerFactory, {
    onControlResult: (outcome) => {
      callbacks.onControlResult?.(outcome);
      if (outcome.result) {
        metAlertsDone = runMetAlertsForControl(deps, callbacks, outcome.result.steps);
      }
    },
    ...(callbacks.onMemberResult ? { onMemberResult: callbacks.onMemberResult } : {}),
  });
  await metAlertsDone;

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
