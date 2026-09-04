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
import {
  goldenScenarios,
  SKAGEN,
  SKJAELOY,
} from "@morild/routing/test-fixtures/golden-scenarios";
import {
  buildDistanceField,
  maskAsEdgeGate,
  OPEN_EDGE_GATE,
  type DistanceField,
} from "@morild/routing";
import { windMemberLayersFromBytes } from "@morild/weather";
import type { AppConfig } from "./config.js";
import { loadWeatherPointer, type PointerLoadResult } from "./pointer-client.js";
import { loadWeatherBlob } from "./blob-client.js";
import type { CacheStorageLike } from "./pack-cache.js";
import { selectTilesForRoute, type TileSelection } from "./tile-select.js";
import { acceptTileHeader, type TileRejection } from "./tile-certificate.js";
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

/**
 * Samme golden-scenario som `weather-routing.worker.ts` planlegger med —
 * maske og endepunkter må være de samme her og der, ellers velger klienten
 * fliser for én geometri og søker i en annen (se `routeDistanceField`).
 */
const ROUTE_SCENARIO_NAME = "skjaeloy-skagen-apent";

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
  /**
   * Hvilken flisvalgregel som ble brukt, hvilke fliser den ba om, hvilke
   * pekeren manglet, og hvilke som ble avvist av sertifikat-asserten (D7.2).
   * Alt sammen synlig i UI — ingen av delene skal kunne skje stille.
   */
  readonly onTileSelection?: (
    selection: TileSelection,
    rejections: readonly TileRejection[],
  ) => void;
  readonly onFieldStatuses?: (
    statuses: readonly FieldPresenceStatus[],
    tiles: readonly PointerTileEntry[],
  ) => void;
  /** `memberCount` = antall ensemblemedlemmer UTEN kontrollen som skal kjøres etterpå (nettbrett-målingens nevner). */
  readonly onControlResult?: (outcome: MemberOutcome, memberCount: number) => void;
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
/**
 * **A\*-vannavstandsfeltet for flisvalget** (D7.2). Bygget med SAMME maske og
 * samme endepunkter som Workeren senere kjører `planRoute` med
 * (`skjaeloy-skagen-apent`, se `weather-routing.worker.ts`) og med motorens
 * egne standardvalg for oppløsning — flissettet skal utledes av nøyaktig den
 * geometrien søket faktisk er begrenset av, ikke av en grovere tilnærming som
 * kunne stengt et smalt sund og dermed utelatt en flis.
 *
 * Feltet er væruavhengig (§5.5) og kan derfor bygges her, før noen værdata er
 * lastet — det er hele forutsetningen for at regelen kan brukes til å velge
 * hvilke værfliser vi i det hele tatt skal laste ned.
 *
 * `undefined` (målet utenfor feltboksen, eller ingen scenario funnet) ⇒
 * kalleren faller tilbake på endepunkt-bboksen + 0,5°.
 */
function routeDistanceField(): DistanceField | undefined {
  const scenario = goldenScenarios().find(
    (candidate) => candidate.name === ROUTE_SCENARIO_NAME,
  );
  const mask = scenario?.input.mask;
  return buildDistanceField(
    SKJAELOY,
    SKAGEN,
    mask === undefined ? OPEN_EDGE_GATE : maskAsEdgeGate(mask),
  );
}

export interface TileScreening {
  /** Fliser der ALLE vind-oppføringer har gyldig sertifikat uten klipping. */
  readonly tiles: readonly PointerTileEntry[];
  readonly rejections: readonly TileRejection[];
}

/**
 * **Klippe- og sertifikat-asserten** (D7.2 vilkår (iv), se
 * `tile-certificate.ts`): en flis uten sertifikat — eller med rapportert
 * klipping — brukes ikke. Avvisningen skjer FØR nedlasting, og grunnen
 * bæres ut til UI-et; en flis forsvinner aldri stille.
 *
 * Avvisningen er per felt-oppføring (flis × felt × medlem), men rammer hele
 * flisen: motoren får ett sammensydd felt, og en flis der ett medlem ikke er
 * sertifisert er ikke en flis vi kan si noe verifisert om.
 */
export function screenTiles(tiles: readonly PointerTileEntry[]): TileScreening {
  const accepted: PointerTileEntry[] = [];
  const rejections: TileRejection[] = [];
  for (const tile of tiles) {
    let tileOk = true;
    for (const entry of tile.fields) {
      const verdict = acceptTileHeader(entry.header);
      if (!verdict.accepted) {
        tileOk = false;
        rejections.push({
          tileId: tile.tileId,
          field: entry.field,
          member: entry.member,
          reason: verdict.reason,
        });
      }
    }
    if (tileOk) accepted.push(tile);
  }
  return { tiles: accepted, rejections };
}

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
  // D7.2: flissettet kommer fra A*-feltets rekkevidde, ikke fra
  // endepunkt-bboksen. `selectTilesForRoute` faller selv tilbake på
  // bbox + 0,5° hvis feltet ikke kunne bygges.
  const selection = selectTilesForRoute(
    pointerResult.pointer,
    points,
    routeDistanceField(),
  );
  const screened = screenTiles(selection.tiles);
  callbacks.onTileSelection?.(selection, screened.rejections);

  const tiles = screened.tiles;
  const fieldStatuses = fieldPresenceStatuses(tiles, deps.nowEpochS);
  callbacks.onFieldStatuses?.(fieldStatuses, tiles);

  if (tiles.length === 0) {
    callbacks.onError?.(
      screened.rejections.length > 0
        ? `Ingen brukbar værflis for Skjæløy–Skagen: ${screened.rejections.length} flis(er) avvist (${screened.rejections[0]!.reason})`
        : "Ingen værflis i pekeren dekker Skjæløy–Skagen",
    );
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
      callbacks.onControlResult?.(outcome, memberIndices.length);
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
