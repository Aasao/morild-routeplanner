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
import { WAVE_POINTS_MAX, windMemberLayersFromBytes } from "@morild/weather";
import type { AppConfig } from "./config.js";
import { loadWeatherPointer, type PointerLoadResult } from "./pointer-client.js";
import { loadWeatherBlob } from "./blob-client.js";
import type { CacheStorageLike } from "./pack-cache.js";
import { selectTilesForRoute, type TileSelection } from "./tile-select.js";
import {
  acceptSharedFieldHeader,
  acceptTileHeader,
  CURRENT_COASTAL_FIELD,
  CURRENT_FIELD,
  windMemberRejectionText,
  type TileRejection,
} from "./tile-certificate.js";
import { fieldPresenceStatuses, type FieldPresenceStatus } from "./field-status.js";
import {
  runEnsemble,
  type EnsembleCallbacks,
  type MemberJob,
  type MemberOutcome,
  type TileWindSource,
  type WorkerFactory,
  type EnsembleContext,
} from "./ensemble.js";
import { WAVE_GREEN_CAP_STAMP, type RobustnessStamp } from "@morild/robustness";
import { wavePointGrid, type WavePointGrid } from "./wave-point-grid.js";
import { frozenSet, loadWavePoints, type WavePointLoad } from "./wave-points-client.js";
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
  /** D10.5 verste-først via S1b-orakel; standard på i appen, av i tester uten orakel-mock. */
  readonly worstFirst?: boolean | undefined;
  /** Kjør perturbasjonene (§4.4) etter ensemblet — fem ekstra søk. Av i tester. */
  readonly perturbation?: boolean | undefined;
  /** Be om bail-out-profil etter kontrollen (§4.5). Av i tester uten havnebok. */
  readonly bailout?: boolean | undefined;
  readonly nowEpochS: number;
  /**
   * Er `cacheStorage` ekte Cache Storage (overlever sideinnlasting)? `false`
   * når appen kjører på minnecachen (usikker kontekst) — punktbølgens
   * klientbuffer sier det da ærlig. Udefinert ⇒ antatt `true`.
   */
  readonly persistentCache?: boolean | undefined;
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
  /**
   * Punktbølgen (`docs/specs/punktbolge.md`): hentet ÉN gang før kontrollen
   * og fryst for hele kjøringen. Kalles også når bølge mangler — da med
   * grunnen (`kind: "mangler"`), aldri stille.
   */
  readonly onWavePoints?: (load: WavePointLoad, grid: WavePointGrid) => void;
  /** `memberCount` = antall ensemblemedlemmer UTEN kontrollen som skal kjøres etterpå (nettbrett-målingens nevner). */
  readonly onControlResult?: (outcome: MemberOutcome, memberCount: number) => void;
  readonly onMemberResult?: EnsembleCallbacks["onMemberResult"];
  readonly onMetAlerts?: (result: MetAlertsLoadResult, relevant: readonly RelevantAlert[]) => void;
  readonly onSensitivity?: EnsembleCallbacks["onSensitivity"];
  readonly onBailout?: EnsembleCallbacks["onBailout"];
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

export interface TileFieldEntry {
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
  /**
   * Fliser der kontrollens vind har gyldig sertifikat uten klipping. Avviste
   * vindmedlemmer (≠ 0) er fjernet fra ALLE fliser — se `excludedWindMembers`.
   */
  readonly tiles: readonly PointerTileEntry[];
  readonly rejections: readonly TileRejection[];
  /** Vindmedlemmer (≠ 0) avvist av sertifikat-/plausibilitetssjekken, stigende. */
  readonly excludedWindMembers: readonly number[];
}

/**
 * **Klippe- og sertifikat-asserten** (D7.2 vilkår (iv), se
 * `tile-certificate.ts`): en flis uten sertifikat — eller med rapportert
 * klipping — brukes ikke. Avvisningen skjer FØR nedlasting, og grunnen
 * bæres ut til UI-et; en flis forsvinner aldri stille.
 *
 * Avvisningen er per felt-oppføring (flis × felt × medlem). **Vind avvises
 * per medlem** (§19 2026-09-29): et ikke-kontroll-medlem med ugyldig/umulig
 * sertifikat tas ut av ensemblet i ALLE fliser (et medlem er ett sammensydd
 * felt — halvt medlem finnes ikke), og nevneren blir synlig færre. Før ble
 * hele flisen avvist, slik at seks fyllverdi-medlemmer ville tatt med seg
 * alle de 24 friske. **Kontrollens** avvisning fjerner fortsatt flisen: uten
 * kontroll finnes ingen referanse å si noe verifisert om i den flisen.
 * Andre felt enn vind/strøm avviser også hele flisen, som før.
 */
export function screenTiles(tiles: readonly PointerTileEntry[]): TileScreening {
  const accepted: PointerTileEntry[] = [];
  const rejections: TileRejection[] = [];
  const excludedWind = new Set<number>();
  for (const tile of tiles) {
    let tileOk = true;
    const tileExcludedWind: number[] = [];
    // Strøm og kystmaske (strom-produsent.md) screenes for seg: et avvist
    // strømlag fjerner STRØMMEN fra flisen (⇒ `current()` undefined ⇒ delvis
    // dekning, synlig), ikke hele flisen. Strøm uten kystmaske brukes ikke:
    // da ville kystnære punkter stille stått umerket (D15.2).
    const currentEntries = tile.fields.filter((f) => f.field === CURRENT_FIELD || f.field === CURRENT_COASTAL_FIELD);
    let currentOk = currentEntries.length > 0;
    for (const entry of currentEntries) {
      const verdict = acceptSharedFieldHeader(entry.header, entry.field);
      if (!verdict.accepted) {
        currentOk = false;
        rejections.push({ tileId: tile.tileId, field: entry.field, member: entry.member, reason: verdict.reason });
      }
    }
    const hasCurrent = currentEntries.some((f) => f.field === CURRENT_FIELD && f.member === 0);
    const hasMask = currentEntries.some((f) => f.field === CURRENT_COASTAL_FIELD && f.member === 0);
    if (currentOk && hasCurrent !== hasMask) {
      currentOk = false;
      rejections.push({
        tileId: tile.tileId,
        field: hasCurrent ? CURRENT_FIELD : CURRENT_COASTAL_FIELD,
        member: 0,
        reason: hasCurrent
          ? "strømlag uten kystmaske — kystnære strømpunkter kunne ikke merkes (D15.2), strøm brukes ikke"
          : "kystmaske uten strømlag — ignorert",
      });
    }
    for (const entry of tile.fields) {
      if (entry.field === CURRENT_FIELD || entry.field === CURRENT_COASTAL_FIELD) continue;
      const verdict = acceptTileHeader(entry.header);
      if (!verdict.accepted) {
        const memberOnly = entry.field === "wind" && entry.member !== 0;
        if (memberOnly) tileExcludedWind.push(entry.member);
        else tileOk = false;
        rejections.push({
          tileId: tile.tileId,
          field: entry.field,
          member: entry.member,
          reason: memberOnly ? windMemberRejectionText(entry.member, verdict.reason) : verdict.reason,
        });
      }
    }
    if (!tileOk) continue;
    for (const m of tileExcludedWind) excludedWind.add(m);
    accepted.push(
      currentOk || currentEntries.length === 0
        ? tile
        : { ...tile, fields: tile.fields.filter((f) => f.field !== CURRENT_FIELD && f.field !== CURRENT_COASTAL_FIELD) },
    );
  }
  const tilesOut =
    excludedWind.size === 0
      ? accepted
      : accepted.map((tile) => ({
          ...tile,
          fields: tile.fields.filter((f) => !(f.field === "wind" && excludedWind.has(f.member))),
        }));
  return { tiles: tilesOut, rejections, excludedWindMembers: [...excludedWind].sort((a, b) => a - b) };
}

/** «n av N» for vind (§19 2026-09-29), kontrollen inkludert i begge tall. */
export interface WindMemberCensus {
  /** Medlemmer produsenten kjente til: i pekeren ELLER meldt utelatt i `missingFields`. */
  readonly nominal: number;
  /** Medlemmer med brukbare vinddata etter screeningen. */
  readonly withData: number;
  /** Medlemmer uten brukbare data (produsent-utelatt eller klient-avvist), stigende. */
  readonly missingMembers: readonly number[];
}

/**
 * Teller vindmedlemmene ærlig: nevneren er det produsenten kjente til
 * (`selected`, før screening — inkl. `missingFields` med `member`), ikke
 * bare det som overlevde. Da blir «24 av 30» synlig i stedet for «24».
 */
export function windMemberCensus(
  selected: readonly PointerTileEntry[],
  screened: readonly PointerTileEntry[],
): WindMemberCensus {
  const known = new Set<number>();
  for (const tile of selected) {
    for (const f of tile.fields) if (f.field === "wind") known.add(f.member);
    for (const m of tile.missingFields ?? []) if (m.field === "wind" && m.member !== undefined) known.add(m.member);
  }
  const withData = new Set<number>();
  for (const tile of screened) for (const f of tile.fields) if (f.field === "wind") withData.add(f.member);
  const missingMembers = [...known].filter((m) => !withData.has(m)).sort((a, b) => a - b);
  return { nominal: known.size, withData: withData.size, missingMembers };
}

/** Flisens delte strøm + kystmaske, lastet én gang og delt av alle medlemmene. */
export interface TileCurrentSource {
  readonly currentHeader: PointerFieldEntry["header"];
  readonly currentBuffer: ArrayBuffer;
  readonly coastalBuffer: ArrayBuffer;
}

/**
 * Laster strøm og kystmaske (member 0, `docs/specs/strom-produsent.md`) for
 * hver flis som har begge etter screeningen. Fliser uten strøm mangler i
 * kartet — `current()` er da `undefined` der, som gir delvis dekning.
 */
async function loadCurrentByTile(
  tiles: readonly PointerTileEntry[],
  load: (key: string) => Promise<ArrayBuffer>,
): Promise<ReadonlyMap<string, TileCurrentSource>> {
  const out = new Map<string, TileCurrentSource>();
  for (const tile of tiles) {
    const current = tile.fields.find((f) => f.field === CURRENT_FIELD && f.member === 0);
    const coastal = tile.fields.find((f) => f.field === CURRENT_COASTAL_FIELD && f.member === 0);
    if (current === undefined || coastal === undefined) continue;
    const [currentBuffer, coastalBuffer] = await Promise.all([load(current.key), load(coastal.key)]);
    out.set(tile.tileId, { currentHeader: current.header, currentBuffer, coastalBuffer });
  }
  return out;
}

/** Legger flisens delte strøm (om den finnes) på en vindkilde. */
function withCurrent(source: TileWindSource, currentByTile: ReadonlyMap<string, TileCurrentSource>): TileWindSource {
  const current = currentByTile.get(source.tileId);
  return current === undefined ? source : { ...source, ...current };
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

/**
 * Alt ensemblet trenger, hentet og dekodet ÉN gang: jobbliste (kontroll
 * først), kontekst for avgangssammendraget og nok om pakken til å
 * identifisere den. Delt mellom appens værflyt (`runWeatherPipeline`) og
 * måleprogrammet (robusthet.md §6.4), som henter pakken én gang og kjører
 * mange ensembler på den — samme pipeline, ingen egen vei.
 *
 * NB: `jobs[*].tiles[*].windBuffer` overføres (transfer) når de sendes til
 * en Worker. Den som vil kjøre flere ganger på samme input, må klone
 * bufferne først (`cloneJobs` i måleprogrammet).
 */
export interface EnsembleInputs {
  readonly jobs: readonly MemberJob[];
  readonly context: EnsembleContext;
  /** Antall medlemmer UTEN kontrollen. */
  readonly memberCount: number;
  /** Vind-oppføringene per medlem — perturbasjonsfasen leser flisene på nytt herfra. */
  readonly byMember: ReadonlyMap<number, readonly TileFieldEntry[]>;
  /** Innholds-hashene (§5) til alle blobber jobbene er bygget av, sortert — pakkens identitet. */
  readonly blobHashes: readonly string[];
  /** Pakkens init-tid (ISO) fra kontrollens header. */
  readonly packageInit: string;
  /** Delt strøm + kystmaske per flis — perturbasjonsfasen legger dem på igjen. */
  readonly currentByTile: ReadonlyMap<string, TileCurrentSource>;
  /** Punktbølgen slik den ble hentet — settet (om noe) ligger fryst på hver jobb. */
  readonly waveLoad: WavePointLoad;
  readonly waveGrid: WavePointGrid;
  /** «n av N» vindmedlemmer med brukbare data (§19 2026-09-29). */
  readonly windMembers: WindMemberCensus;
}

export async function prepareEnsembleInputs(
  deps: Pick<PipelineDeps, "config" | "fetchImpl" | "cacheStorage" | "nowEpochS" | "persistentCache">,
  callbacks: Pick<
    PipelineCallbacks,
    "onPointerStatus" | "onTileSelection" | "onFieldStatuses" | "onWavePoints" | "onError"
  > = {},
): Promise<EnsembleInputs | null> {
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
    return null;
  }

  const points = [SKJAELOY, SKAGEN];
  // D7.2: flissettet kommer fra A*-feltets rekkevidde, ikke fra
  // endepunkt-bboksen. `selectTilesForRoute` faller selv tilbake på
  // bbox + 0,5° hvis feltet ikke kunne bygges.
  const field = routeDistanceField();
  const selection = selectTilesForRoute(pointerResult.pointer, points, field);
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
    return null;
  }

  const windMembers = windMemberCensus(selection.tiles, tiles);
  const byMember = windEntriesByMember(tiles);
  const controlSources = byMember.get(0);
  if (controlSources === undefined || controlSources.length === 0) {
    callbacks.onError?.("Pakken mangler et kontrollmedlem (member 0) for vind i noen av rutens fliser");
    return null;
  }

  const blobDeps = { fetchImpl: deps.fetchImpl, cacheStorage: deps.cacheStorage };

  const controlBlobs = await Promise.all(
    controlSources.map((s) => loadWeatherBlob(deps.config, s.entry.key, blobDeps)),
  );
  // Pragmatisk MVP-valg (fase 3 bølge 2C, ikke spec-låst): avgang = den
  // SENESTE av feltets første tidssteg (lest fra første flis' kontrollbuffer;
  // fliser fra samme bygg deler `t0S`, §7/§5) og nåtid rundet opp til hel
  // time. Før 2026-09-29 var avgangen alltid `t0S` — typisk 3–8 t i fortiden
  // når pakken er noen timer gammel. Med punktbølge (Oceanforecast starter
  // ved nåtid) ga det bølgeløse første timer og dermed «partial» for ALLE
  // medlemmer. Ingen planlegger en avgang i fortiden. En ekte «velg
  // avgangstidspunkt»-UI er fase 4/5s avgangstabell.
  const windT0S = windMemberLayersFromBytes(new Uint8Array(controlBlobs[0]!.buffer)).u.layer.geometry.t0S;
  const departEpochS = Math.max(windT0S, Math.ceil(deps.nowEpochS / 3600) * 3600);
  const currentByTile = await loadCurrentByTile(
    tiles,
    async (key) => (await loadWeatherBlob(deps.config, key, blobDeps)).buffer,
  );
  const controlTiles: TileWindSource[] = controlSources.map((s, i) =>
    withCurrent({ tileId: s.tile.tileId, windHeader: s.entry.header, windBuffer: controlBlobs[i]!.buffer }, currentByTile),
  );

  const memberIndices = Array.from(byMember.keys())
    .filter((m) => m !== 0)
    .sort((a, b) => a - b);
  const memberSourcesByIndex = memberIndices.map((m) => byMember.get(m)!);
  const memberBlobsByIndex = await Promise.all(
    memberSourcesByIndex.map((sources) =>
      Promise.all(sources.map((s) => loadWeatherBlob(deps.config, s.entry.key, blobDeps))),
    ),
  );

  // Punktbølgen (punktbolge.md §3, ADR-0007): ÉN henting, FØR kontrollen,
  // over samme korridor som flisvalget (samme A*-felt). Settet fryses her og
  // legges som samme objekt på hver jobb — kontroll, medlemmer, orakel og
  // (via kontrolljobben) perturbasjon. Ingen nye kall under kjøringen.
  const waveGrid = wavePointGrid(field, points);
  const waveLoad = await loadWavePoints(deps.config, waveGrid.points, WAVE_POINTS_MAX, {
    fetchImpl: deps.fetchImpl,
    cacheStorage: deps.cacheStorage,
    persistentBuffer: deps.persistentCache !== false,
  });
  callbacks.onWavePoints?.(waveLoad, waveGrid);
  const wavePoints = frozenSet(waveLoad);
  const waveJobPart = wavePoints === undefined ? {} : { wavePoints };

  const jobs: MemberJob[] = [
    {
      memberIndex: 0,
      isControl: true,
      tiles: controlTiles,
      departEpochS,
      ...waveJobPart,
    },
    ...memberIndices.map((memberIndex, i) => ({
      memberIndex,
      isControl: false,
      tiles: memberSourcesByIndex[i]!.map((s, j) =>
        withCurrent(
          { tileId: s.tile.tileId, windHeader: s.entry.header, windBuffer: memberBlobsByIndex[i]![j]!.buffer },
          currentByTile,
        ),
      ),
      departEpochS,
      ...waveJobPart,
    })),
  ];

  // Stempelet (§3.6): hva tallene ble regnet på. Maskeversjonen er golden-
  // scenarioets navn til farbarhetsmasken får egen versjon (app-skjelett.md
  // §2); opsjons-hashen er en konstant for motorens standardopsjoner til
  // RouteOptions faktisk kan velges i UI.
  const initEpochS = Math.floor(Date.parse(controlSources[0]!.entry.header.init) / 1000);
  const stamp: RobustnessStamp = {
    maskVersion: "golden:skjaeloy-skagen-apent",
    packageId: controlSources.map((s) => `${s.tile.tileId}:${s.entry.hash.slice(0, 8)}`).join(","),
    packageInitEpochS: initEpochS,
    memberAgesS: memberIndices.map(() => Math.max(0, deps.nowEpochS - initEpochS)),
    optionsHash: "route-options-default-v1",
    estimator: "naermeste-rang-v1",
    thresholds: { gronn: 0.9, rod: 0.7, inkonklusiv: 0.2, konkordans: 0.75 },
    // punktbolge.md §4.1: taket 1,0 m stemplet «foreløpig»; Oceanforecast har
    // ingen periode (D14.1). Settets hash/tid stemples (fryseregelen).
    waveGreenCap: WAVE_GREEN_CAP_STAMP,
    wavePeriodKnown: false,
    wavePoints: wavePoints === undefined ? null : { hash: wavePoints.hash, fetchedAtEpochS: wavePoints.fetchedAtEpochS },
    // Nevneren «expectedMembers» under er medlemmene MED data; stempelet
    // bærer i tillegg hvor mange produsenten kjente til, så UI kan si «n av N».
    windMembers: { withData: windMembers.withData, nominal: windMembers.nominal, missing: windMembers.missingMembers },
  };
  const context: EnsembleContext = { expectedMembers: memberIndices.length, departEpochS, stamp };
  const currentHashes = tiles.flatMap((t) =>
    currentByTile.has(t.tileId)
      ? t.fields.filter((f) => f.field === CURRENT_FIELD || f.field === CURRENT_COASTAL_FIELD).map((f) => f.hash)
      : [],
  );
  const blobHashes = [...[controlSources, ...memberSourcesByIndex].flatMap((sources) => sources.map((s) => s.entry.hash)), ...currentHashes].sort();
  return {
    jobs,
    context,
    memberCount: memberIndices.length,
    byMember,
    blobHashes,
    packageInit: controlSources[0]!.entry.header.init,
    currentByTile,
    waveLoad,
    waveGrid,
    windMembers,
  };
}

export async function runWeatherPipeline(deps: PipelineDeps, callbacks: PipelineCallbacks = {}): Promise<void> {
  const inputs = await prepareEnsembleInputs(deps, callbacks);
  if (inputs === null) return;
  const { jobs, context, byMember, currentByTile } = inputs;
  const blobDeps = { fetchImpl: deps.fetchImpl, cacheStorage: deps.cacheStorage };

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
      callbacks.onControlResult?.(outcome, inputs.memberCount);
      if (outcome.result) {
        metAlertsDone = runMetAlertsForControl(deps, callbacks, outcome.result.steps);
      }
    },
    ...(callbacks.onMemberResult ? { onMemberResult: callbacks.onMemberResult } : {}),
    ...(callbacks.onSensitivity ? { onSensitivity: callbacks.onSensitivity } : {}),
    ...(callbacks.onBailout ? { onBailout: callbacks.onBailout } : {}),
  }, {
    worstFirst: deps.worstFirst === true,
    bailout: deps.bailout === true,
    context,
    ...(deps.perturbation === true
      ? {
          perturbation: {
            // Flisene leses fra cachen på nytt: de opprinnelige bufferne ble
            // overført til poolen. Cache API kloner ved `arrayBuffer()`.
            tilesFor: async (memberIndex: number): Promise<readonly TileWindSource[]> => {
              const sources = byMember.get(memberIndex);
              if (sources === undefined) throw new Error(`perturbasjon: medlem ${memberIndex} finnes ikke i pakken`);
              const blobs = await Promise.all(
                sources.map((s) => loadWeatherBlob(deps.config, s.entry.key, blobDeps)),
              );
              return sources.map((s, i) =>
                withCurrent(
                  { tileId: s.tile.tileId, windHeader: s.entry.header, windBuffer: blobs[i]!.buffer },
                  currentByTile,
                ),
              );
            },
          },
        }
      : {}),
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
