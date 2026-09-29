/**
 * Pipeline-orkestrator: fetch -> subset -> felt-i-minnet -> encode -> skriv
 * (`docs/specs/vaerpakker.md` §7, §8, §9, §11). Hvert steg er en egen,
 * testbar funksjon.
 *
 * **`@morild/weather`-integrasjonen er fullført** (§19, endringslogg
 * 2026-09-03: "weather-pack bytter til @morild/weather") — encode-siden
 * (skala/offset per subflis, sentinel, TWS-vaktbånd, delta-koding) har nå
 * ÉN implementasjon (`@morild/weather`), ikke en lokal kopi her.
 * Kvantiseringen skjer ved at `buildWindMemberLayers` bygger ekte
 * `Layer`-objekter via `buildLayer`, og `buildWindMemberPackage` skriver
 * dem til disk-formatet via `serializeLayer` (§9.9/§9.7-kontrakten
 * `@morild/weather` eier).
 *
 * Denne bølgen wirer opp VIND-feltet fullt ut (kontroll + alle medlemmer,
 * §4.1) — det mest komplette speced feltet (u/v-lagring, TWS-vaktbånd,
 * lagged-ensemble). Strøm/bølge/tidevann/MetAlerts følger samme
 * step-mønster (samme `FetchLike`/`PackageSink`-grensesnitt) men er IKKE
 * fullt wiret opp i denne bølgen — se README "Hva venter".
 */
import { findDataSectionOffset, decodeDodsArray } from "./dap2.js";
import type { IndexWindow } from "./grid.js";
import { selectEnsembleRun, type EnsembleRun, type LaggedEnsembleOptions } from "./lagged-ensemble.js";
import {
  buildAllMembersDodsUrl,
  fetchWithBackoff,
  windowToDimRanges,
  type BackoffOptions,
  type FetchLike,
} from "./opendap-client.js";
import {
  buildLayer,
  buildLayerLookup,
  MAX_SUBTILE_NODES,
  serializeLayer,
  windLayerMaxDecodeErrorKn,
  type ClippedSample,
  type CertifiedPackageHeader,
  type FieldCertificate,
  type Layer,
  type LayerGeometry,
  type RoundingMode,
} from "@morild/weather";
import { contentHash, r2Key, type PointerFieldEntry } from "./package-writer.js";
import { combineSourceStatuses, ensembleFellBackToOlderRun, noUsableEnsemble, STATUS_OK } from "./source-status.js";
import { MEPS_LCC_PARAMS, rotateGridRelativeWindToTrueNorth, type LccProjectionParams } from "./lambert-rotation.js";
import { fieldMaxDirectionErrorDeg } from "./direction-budget.js";
import type { PackageHeader } from "@morild/protocol";

export interface WindGridDims {
  readonly timeCount: number;
  readonly memberCount: number;
  readonly yCount: number;
  readonly xCount: number;
}

/** Flat-indeksering [time][member][y][x] — matcher `dry-run-fixtures.ts` og ekte MEPS-aksrekkefølge (height-dimensjonen er alltid lengde 1 og hoppes over). */
export function flatIndex(dims: WindGridDims, t: number, m: number, y: number, x: number): number {
  return ((t * dims.memberCount + m) * dims.yCount + y) * dims.xCount + x;
}

export interface FetchedWindComponents {
  readonly dims: WindGridDims;
  readonly u: Float64Array;
  readonly v: Float64Array;
}

/**
 * **Enhet, m/s inn — IKKE konvertert her (§19, 2026-09-03-funn).** MEPS'
 * `x_wind_10m`/`y_wind_10m` leveres i **m/s** (bekreftet via `.das`-oppslag
 * live 2026-09-03: `String units "m/s"`), mens `docs/specs/vaerpakker.md`
 * §3s tabell krever **knop** for det lagrede u/v-formatet. Denne funksjonen
 * returnerer verdiene UKONVERTERT (samme enhet som kilden ga) — kalleren
 * (`build-live-package.ts`) MÅ kalle `convertWindComponentsToKnots` FØR
 * `buildWindMemberLayers`/`buildWindMemberPackage`. Dry-run-banen
 * (`dry-run-fixtures.ts`, `pipeline.test.ts`, `measure-full-size.ts`)
 * konverterer bevisst IKKE — de syntetiske fixture-verdiene ER allerede
 * definert i knop-skala (testene sammenligner mot dem uendret), og har
 * aldri representert en fysisk m/s-kilde. **Dette var en reell,
 * udetektert enhetsfeil frem til denne bølgen:** ingen kode konverterte
 * m/s→knop noe sted, og synthetic-fixturenes enhetsløshet skjulte det
 * fullstendig — se `docs/research/pakkestoerrelse-ekte-2026-09-03.md` for
 * hvordan det ble oppdaget (rundtur-verifisering mot ekte data ga et
 * konsistent avvik på nøyaktig m/s→knop-faktoren, 1,9438×).
 *
 * Henter x_wind_10m og y_wind_10m for ALLE medlemmer i ETT kall hver
 * (§7 punkt 2). `window` er allerede løst (grid-indeks-cache er kallerens
 * ansvar via `resolveIndexWindow`, §7 punkt 1).
 */
export async function fetchWindComponents(args: {
  readonly datasetUrl: string;
  readonly window: IndexWindow;
  readonly timeCount: number;
  readonly memberCount: number;
  readonly userAgent: string;
  readonly fetchImpl: FetchLike;
  readonly backoff?: BackoffOptions;
}): Promise<FetchedWindComponents> {
  const { y, x } = windowToDimRanges(args.window);
  const dims = [{ start: 0, stop: args.timeCount - 1 }, { start: 0, stop: 0 }, { start: 0, stop: 0 }, y, x];
  const yCount = args.window.yEnd - args.window.yStart + 1;
  const xCount = args.window.xEnd - args.window.xStart + 1;
  const outDims: WindGridDims = { timeCount: args.timeCount, memberCount: args.memberCount, yCount, xCount };

  async function fetchOne(variable: "x_wind_10m" | "y_wind_10m"): Promise<Float64Array> {
    const url = buildAllMembersDodsUrl(args.datasetUrl, variable, dims, 2, args.memberCount);
    const { buffer } = await fetchWithBackoff(url, args.userAgent, args.fetchImpl, args.backoff);
    const bytes = new Uint8Array(buffer);
    const dataOffset = findDataSectionOffset(bytes);
    return decodeDodsArray(bytes, dataOffset, "Float32").values;
  }

  const [u, v] = await Promise.all([fetchOne("x_wind_10m"), fetchOne("y_wind_10m")]);
  return { dims: outDims, u, v };
}

// --- Manglende vindverdier: fyllverdi, ikke-endelig, fysisk umulig ---------
//
// Funn 2026-09-29 (vaerpakker.md §19): i MEPS' lagged-ensemble var
// medlemmene 9, 10, 11, 24, 25, 26 fyllverdi (float `_FillValue` ≈ 9,969e36)
// i ALLE fliser/noder/tidssteg. Uten håndtering ble fyllverdien kvantisert
// som et tall (skala ~1,5e33), sertifikatet fikk `maxDecodeErrorKn` ~1e33
// med `clippedSamples` 0, og klienten slapp det gjennom. Reglene under gjør
// en manglende verdi til NaN (⇒ sentinel i `encodeLinear`, aldri et tall),
// og et medlem som i hovedsak mangler skrives ikke til pekeren.

/**
 * Fysisk plausibilitetsgrense for én vindkomponent, m/s. Høyeste målte
 * vindkast på jorden er ~113 m/s (Barrow Island 1996); 10 m-middelvind i
 * MEPS kommer aldri i nærheten. 150 m/s er dermed «umulig», ikke «sterk» —
 * grensen skal fange fyll-/søppelverdier, ikke klippe ekstremvær.
 */
export const WIND_PLAUSIBLE_MAX_MS = 150;

/**
 * Et medlem der MER ENN denne andelen av nodene × tidsstegene i flisen
 * mangler, skrives ikke til pekeren. Begrunnelse: et medlem som stort sett
 * er hull, er ikke en representativ trekning fra ensemblet — søket i det
 * ville vært formet av dekningshullene, og medlemmet ville tatt plass i
 * nevneren som «inkonklusiv/feil» uten å bære værinformasjon. Under grensen
 * blir enkeltvise hull sentinel, som motoren ser som `noWeatherInWindow`
 * (synlig `VAERDEKNING_BEGRENSET`). Det observerte feilmønsteret er 100 %
 * mangler, så valget er ikke følsomt for det; 50 % er «flertallet mangler».
 */
export const WIND_MEMBER_MAX_MISSING_FRACTION = 0.5;

/** Fyll-/manglende-verdier fra `.das` (`_FillValue` og `missing_value`) per vindkomponent. */
export interface WindMissingValueSpec {
  readonly x: readonly number[];
  readonly y: readonly number[];
}

function dasVariableBlock(dasText: string, variable: string): string {
  const start = dasText.search(new RegExp(`(^|\\n)\\s*${variable}\\s*\\{`));
  if (start < 0) throw new Error(`MEPS-.das mangler variabelen "${variable}"`);
  const end = dasText.indexOf("}", start);
  return dasText.slice(start, end < 0 ? undefined : end);
}

function dasNumericAttribute(block: string, attr: string): number[] {
  const m = new RegExp(`\\b${attr}\\s+([^;]+);`).exec(block);
  if (!m || m[1] === undefined) return [];
  return m[1]
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
}

/**
 * Leser `_FillValue`/`missing_value` for `x_wind_10m`/`y_wind_10m` fra
 * `.das`. Fravær av attributtene er lov (tom liste) — plausibilitetsgrensen
 * fanger NetCDF-standardfyllverdien uansett; mangler selve variabelen i
 * `.das`, er noe grunnleggende galt, og det kastes.
 */
export function parseWindMissingValuesFromDas(dasText: string): WindMissingValueSpec {
  const read = (variable: string): number[] => {
    const block = dasVariableBlock(dasText, variable);
    return [...dasNumericAttribute(block, "_FillValue"), ...dasNumericAttribute(block, "missing_value")];
  };
  return { x: read("x_wind_10m"), y: read("y_wind_10m") };
}

export type WindMissingCause = "fill" | "nonFinite" | "implausible";

/**
 * Er en rå kildeverdi (m/s, Float32 dekodet til Float64) «mangler»?
 * Fyllverdien sammenlignes i Float32-presisjon: `.das` skriver den med
 * 6 sifre (`9.96921e+36`), dataene bærer den eksakte Float32-verdien.
 */
export function windValueMissingCause(value: number, fills: readonly number[]): WindMissingCause | undefined {
  if (!Number.isFinite(value)) return "nonFinite";
  const f32 = Math.fround(value);
  if (fills.some((f) => Math.fround(f) === f32)) return "fill";
  if (Math.abs(value) > WIND_PLAUSIBLE_MAX_MS) return "implausible";
  return undefined;
}

export interface WindMemberMissingStats {
  readonly member: number;
  /** Noder × tidssteg der u ELLER v mangler. */
  readonly missing: number;
  readonly total: number;
  readonly causes: Readonly<Record<WindMissingCause, number>>;
}

/**
 * **Må kalles på RÅ m/s-verdier, FØR `convertWindComponentsToKnots` og
 * LCC-rotasjonen** (fyllverdien er bare gjenkjennelig uskalert, og
 * rotasjonen blander u og v). Setter u OG v til NaN i-place der én av dem
 * mangler — en halv vektor er ingen vektor. NaN overlever skalering og
 * rotasjon og blir sentinel i `encodeLinear` (§9.6). Returnerer tellinger
 * per medlem.
 */
export function maskMissingWindValues(
  components: FetchedWindComponents,
  spec: WindMissingValueSpec,
): WindMemberMissingStats[] {
  const { timeCount, memberCount, yCount, xCount } = components.dims;
  const stats = Array.from({ length: memberCount }, (_, member) => ({
    member,
    missing: 0,
    total: timeCount * yCount * xCount,
    causes: { fill: 0, nonFinite: 0, implausible: 0 } as Record<WindMissingCause, number>,
  }));
  for (let t = 0; t < timeCount; t++) {
    for (let m = 0; m < memberCount; m++) {
      const s = stats[m]!;
      for (let y = 0; y < yCount; y++) {
        for (let x = 0; x < xCount; x++) {
          const idx = flatIndex(components.dims, t, m, y, x);
          const causeU = windValueMissingCause(components.u[idx] ?? Number.NaN, spec.x);
          const causeV = windValueMissingCause(components.v[idx] ?? Number.NaN, spec.y);
          const cause = causeU ?? causeV;
          if (cause === undefined) continue;
          s.missing++;
          s.causes[cause]++;
          components.u[idx] = Number.NaN;
          components.v[idx] = Number.NaN;
        }
      }
    }
  }
  return stats;
}

export interface ExcludedWindMember {
  readonly member: number;
  readonly missingFraction: number;
  readonly reason: string;
}

export interface WindMemberAssessment {
  /** Medlemmer som skrives til pekeren, stigende (0 = kontroll, alltid med). */
  readonly included: readonly number[];
  readonly excluded: readonly ExcludedWindMember[];
  /** `ok` når ingen er utelatt; ellers `degraded` med «n av N medlemmer har data». */
  readonly sourceStatus: PackageHeader["sourceStatus"];
}

function describeCauses(causes: Readonly<Record<WindMissingCause, number>>): string {
  const parts: string[] = [];
  if (causes.fill > 0) parts.push("fyllverdi");
  if (causes.nonFinite > 0) parts.push("ikke-endelig");
  if (causes.implausible > 0) parts.push(`fysisk umulig (|u|/|v| > ${WIND_PLAUSIBLE_MAX_MS} m/s)`);
  return parts.join("/");
}

/**
 * Hvilke medlemmer har brukbare vinddata i denne flisen? Kontrollen
 * (medlem 0) uten data ⇒ **kaster**: uten kontroll finnes ingen pakke å
 * bygge, og det skal aldri se ut som et vellykket bygg (N2).
 */
export function assessWindMembers(
  stats: readonly WindMemberMissingStats[],
  maxMissingFraction: number = WIND_MEMBER_MAX_MISSING_FRACTION,
): WindMemberAssessment {
  const included: number[] = [];
  const excluded: ExcludedWindMember[] = [];
  for (const s of stats) {
    const missingFraction = s.total === 0 ? 1 : s.missing / s.total;
    if (missingFraction > maxMissingFraction) {
      excluded.push({
        member: s.member,
        missingFraction,
        reason:
          `medlem ${s.member}: ${(missingFraction * 100).toFixed(1)} % av noder × tidssteg mangler ` +
          `(${describeCauses(s.causes)}) — over grensen ${(maxMissingFraction * 100).toFixed(0)} %, utelatt`,
      });
    } else {
      included.push(s.member);
    }
  }
  const control = excluded.find((e) => e.member === 0);
  if (control !== undefined) {
    throw new Error(`Kontrollen (medlem 0) har ikke brukbare vinddata — bygget stoppes: ${control.reason}`);
  }
  const sourceStatus: PackageHeader["sourceStatus"] =
    excluded.length === 0
      ? STATUS_OK
      : {
          status: "degraded",
          reason:
            `${included.length} av ${stats.length} medlemmer har vinddata — utelatt: ` +
            excluded.map((e) => e.member).join(", ") +
            ` (${describeCauses(mergeCauses(stats.filter((s) => excluded.some((e) => e.member === s.member))))})`,
        };
  return { included, excluded, sourceStatus };
}

function mergeCauses(stats: readonly WindMemberMissingStats[]): Record<WindMissingCause, number> {
  const out: Record<WindMissingCause, number> = { fill: 0, nonFinite: 0, implausible: 0 };
  for (const s of stats) {
    out.fill += s.causes.fill;
    out.nonFinite += s.causes.nonFinite;
    out.implausible += s.causes.implausible;
  }
  return out;
}

/**
 * m/s → knop. 1 knop = 1852 m / 3600 s (definisjonen av det internasjonale
 * nautiske mil) ⇒ 1 m/s = 3600/1852 knop ≈ 1,9438 knop.
 */
export const METERS_PER_SECOND_TO_KNOTS = 3600 / 1852;

/**
 * Konverterer `components.u`/`components.v` **i-place** fra m/s til knop
 * (§3s lagringskontrakt). Ren enhetsskalering — endrer verken retning
 * (skalering med en positiv konstant roterer ingenting) eller den relative
 * strukturen i feltet, kun tallverdien. MÅ kalles FØR
 * `applyLccRotationToWindComponents`/`buildWindMemberLayers` for ekte
 * MEPS-data (se `fetchWindComponents`s dokumentasjon for hvorfor dette
 * ikke gjøres der). Rekkefølge i forhold til LCC-rotasjonen er i seg selv
 * likegyldig (skalering og rotasjon kommuterer), men konvensjonen her er
 * "konverter enhet FØRST, roter dernest".
 */
export function convertWindComponentsToKnots(components: FetchedWindComponents): void {
  for (let i = 0; i < components.u.length; i++) {
    components.u[i] = (components.u[i] ?? 0) * METERS_PER_SECOND_TO_KNOTS;
    components.v[i] = (components.v[i] ?? 0) * METERS_PER_SECOND_TO_KNOTS;
  }
}

/**
 * **Griddrelativt → sann nord** (`lambert-rotation.ts`, §19 2026-09-03).
 * MEPS' `x_wind_10m`/`y_wind_10m` er komponenter langs det Lambert-
 * projiserte griddets EGNE x/y-akser (CF `standard_name "x_wind"`/
 * `"y_wind"`, `grid_mapping "projection_lambert"` — bekreftet via ekte
 * `.das`-oppslag), IKKE sann øst/nord slik `@morild/weather::uvToWind`
 * (§3) forutsetter. Denne funksjonen roterer `components.u`/`components.v`
 * **i-place** til sanne øst/nord-komponenter, node for node, FØR
 * `buildWindMemberLayers` kalles — rotasjonsvinkelen avhenger kun av
 * lengdegrad (samme vinkel for alle tidssteg/medlemmer på samme (y,x)).
 *
 * `lonAtNode(y, x)` er kildens EKTE lengdegrad for noden (fra grid-probe-
 * oppslaget, IKKE den lineære lat/lon-tilnærmingen `windLayerGeometry`
 * ellers bruker for byte-regnskapet — rotasjonen bruker alltid den ekte
 * projiserte lengdegraden, siden feil lengdegrad her ville gitt feil
 * rotasjonsvinkel, ikke bare feil geometri).
 *
 * IKKE brukt i dry-run/syntetiske baner (fixturens (u,v) er allerede
 * definert som "sann øst/nord" per konstruksjon der) — kun kallerens
 * ansvar bak `--live`.
 */
export function applyLccRotationToWindComponents(
  components: FetchedWindComponents,
  lonAtNode: (y: number, x: number) => number,
  params: LccProjectionParams = MEPS_LCC_PARAMS,
): void {
  const { timeCount, memberCount, yCount, xCount } = components.dims;
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const lon = lonAtNode(y, x);
      for (let t = 0; t < timeCount; t++) {
        for (let m = 0; m < memberCount; m++) {
          const idx = flatIndex(components.dims, t, m, y, x);
          const uGrid = components.u[idx] ?? 0;
          const vGrid = components.v[idx] ?? 0;
          const [uTrue, vTrue] = rotateGridRelativeWindToTrueNorth(uGrid, vGrid, lon, params);
          components.u[idx] = uTrue;
          components.v[idx] = vTrue;
        }
      }
    }
  }
}

export interface WindLayerGeometryInput {
  readonly bbox: readonly [west: number, south: number, east: number, north: number];
  readonly dims: WindGridDims;
  readonly t0S: number;
  readonly dtS: number;
}

/**
 * Bygger `LayerGeometry` (`@morild/weather`) for ett vind-medlems u/v-lag
 * fra det hentede indeksvinduets dimensjoner + bboxen kalleren oppgir.
 *
 * **Dokumentert forenkling** (§7, §9.1 — reprojeksjon er gjenstående
 * arbeid, se README "Hva venter"): MEPS' native rutenett er en Lambert-
 * projeksjon, ikke et jevnt lat/lon-rutenett. Denne funksjonen behandler
 * det hentede indeksvinduets (y,x)-noder som om de er jevnt fordelt over
 * `bbox` i lat/lon. Det er korrekt for BYTE-REGNSKAPET (antall noder og
 * byte per node/tidssteg er identisk uansett hvilken projeksjon nodene
 * faktisk representerer geografisk) og gjør at `buildLayer`/
 * `serializeLayer` kan kjøres ende-til-ende i denne bølgen — men er IKKE
 * geografisk nøyaktig for et ekte uttrekk. Ekte reprojeksjon til et
 * regulært lat/lon-rutenett (eller kartflisenes eget rutenett) er ikke
 * bygget her, samme forbehold som `grid.ts::classifyCoastalZone`s
 * injiserte avstandsfunksjon.
 */
export function windLayerGeometry(input: WindLayerGeometryInput): LayerGeometry {
  const [west, south, east, north] = input.bbox;
  const { yCount, xCount } = input.dims;
  return {
    latMin: south,
    lonMin: west,
    latStepDeg: yCount > 1 ? (north - south) / (yCount - 1) : 0,
    lonStepDeg: xCount > 1 ? (east - west) / (xCount - 1) : 0,
    nodesLat: yCount,
    nodesLon: xCount,
    tileNodes: MAX_SUBTILE_NODES,
    t0S: input.t0S,
    dtS: input.dtS,
    timeSteps: input.dims.timeCount,
  };
}

function nearestIndex(value: number, min: number, stepDeg: number): number {
  if (stepDeg === 0) return 0;
  return Math.round((value - min) / stepDeg);
}

/**
 * Kobler et allerede hentet, flatt (y,x)-rutenett til `buildLayer`s
 * `sample(lat,lon,epochS)`-grensesnitt for ETT medlem, ÉN kanal (u ELLER
 * v). Siden `geometry` er bygget FRA nettopp dette vinduet/bboxen
 * (`windLayerGeometry`), er `nearestIndex` en eksakt invers av
 * `buildLayer`s egen `lat = latMin + i*latStepDeg`-formel (opp til
 * flyttallsavrunding) — ingen ekte romlig interpolasjon skjer her, bare et
 * indeksoppslag i det som allerede ER rutenettet.
 */
function sampleFromFetchedGrid(
  values: Float64Array,
  dims: WindGridDims,
  memberIndex: number,
  geometry: LayerGeometry,
): (lat: number, lon: number, epochS: number) => number | undefined {
  return (lat, lon, epochS) => {
    const t = Math.round((epochS - geometry.t0S) / geometry.dtS);
    const y = nearestIndex(lat, geometry.latMin, geometry.latStepDeg);
    const x = nearestIndex(lon, geometry.lonMin, geometry.lonStepDeg);
    if (t < 0 || t >= dims.timeCount || y < 0 || y >= dims.yCount || x < 0 || x >= dims.xCount) {
      return undefined;
    }
    const value = values[flatIndex(dims, t, memberIndex, y, x)];
    // Manglende (NaN fra `maskMissingWindValues`) eller ikke-endelig ⇒
    // `undefined` ⇒ sentinel. Aldri et tall inn i skala/offset (§19 2026-09-29).
    return value !== undefined && Number.isFinite(value) ? value : undefined;
  };
}

export interface WindMemberLayerBuild {
  readonly geometry: LayerGeometry;
  readonly uLayer: Layer;
  readonly vLayer: Layer;
}

/**
 * Bygger ETT medlems u/v-lag som ekte `Layer`-objekter via `buildLayer`
 * (`@morild/weather`) — erstatter den forrige, ad-hoc subflis-løkken som
 * skrev en lokal, ikke-spec-eid serialisering (§19, 2026-09-03:
 * "pipeline-trinnene skriver nå ekte pakkelag via buildLayer/
 * serializeLayer"). `bitsPerSample` er 8 (§9.1 — normaldrift for
 * kontroll+medlemmer), `roundingMode` er `"nearest"` (§9.5 — ingen
 * triviell konservativ retning for vind; TWS-vaktbåndet dekker det i
 * stedet, se `windLayerMaxDecodeErrorKn` under).
 */
export function buildWindMemberLayers(args: {
  readonly components: FetchedWindComponents;
  readonly memberIndex: number;
  readonly bbox: readonly [west: number, south: number, east: number, north: number];
  readonly t0S: number;
  readonly dtS: number;
  readonly bitsPerSample?: 8 | 10;
  readonly roundingMode?: RoundingMode;
  /** D7.4 klippe-assert (§9.6) — se `ClippedSample`s dokumentasjon i `@morild/weather`. Kalt separat for u- og v-kanalen, se `channel`-feltet på `info`. */
  readonly onClip?: (channel: "u" | "v", info: ClippedSample) => void;
}): WindMemberLayerBuild {
  const bitsPerSample = args.bitsPerSample ?? 8;
  const roundingMode = args.roundingMode ?? "nearest";
  const geometry = windLayerGeometry({
    bbox: args.bbox,
    dims: args.components.dims,
    t0S: args.t0S,
    dtS: args.dtS,
  });
  const uLayer = buildLayer({
    sample: sampleFromFetchedGrid(args.components.u, args.components.dims, args.memberIndex, geometry),
    geometryBase: geometry,
    bitsPerSample,
    roundingMode,
    channelKind: "linear",
    ...(args.onClip ? { onClip: (info: ClippedSample) => args.onClip!("u", info) } : {}),
  });
  const vLayer = buildLayer({
    sample: sampleFromFetchedGrid(args.components.v, args.components.dims, args.memberIndex, geometry),
    geometryBase: geometry,
    bitsPerSample,
    roundingMode,
    channelKind: "linear",
    ...(args.onClip ? { onClip: (info: ClippedSample) => args.onClip!("v", info) } : {}),
  });
  return { geometry, uLayer, vLayer };
}

/** Fart (knop) for ETT medlem, alle noder × tidssteg — kilden til sertifikatets `maxDirectionErrorDeg` (D7.4). `components.u/v` skal allerede være konvertert til knop og rotert til sann nord (kallerens ansvar, samme forutsetning som `buildWindMemberLayers`). */
function* windMemberSpeedsKn(components: FetchedWindComponents, memberIndex: number): Generator<number> {
  const { timeCount, yCount, xCount } = components.dims;
  for (let t = 0; t < timeCount; t++) {
    for (let y = 0; y < yCount; y++) {
      for (let x = 0; x < xCount; x++) {
        const idx = flatIndex(components.dims, t, memberIndex, y, x);
        const u = components.u[idx];
        const v = components.v[idx];
        if (u === undefined || v === undefined || !Number.isFinite(u) || !Number.isFinite(v)) continue;
        yield Math.hypot(u, v);
      }
    }
  }
}

export interface WindTilePackageResult {
  readonly header: CertifiedPackageHeader;
  readonly payload: Uint8Array;
  readonly hash: string;
  readonly key: string;
  readonly maxDecodeErrorKn: number;
  readonly pointerEntry: PointerFieldEntry;
  /** Rå (før delta/gzip) byte-tall for u+v til sammen — for §8s budsjettregnskap (§19). */
  readonly rawPayloadBytes: number;
}

/**
 * Full fetch->subset->encode->skriv-kjede for vindfeltet på ÉN flis, ETT
 * medlem (kalleren løkker over 0..N-1 for kontroll+ensemble — holdt
 * separat fra "alle medlemmer i ett fetch-kall" (§7 punkt 2) fordi
 * KVANTISERINGEN er per medlem, mens HENTINGEN er delt; å blande dem i én
 * funksjon ville skjult akkurat det skillet spec-en presiserer).
 *
 * `deltaCoded` (default `true`) kobler inn §8s "delta+gzip"-transformen
 * (`serializeLayer`s `deltaCoded`-opsjon, `@morild/weather`) FØR skriving —
 * gzippingen selv er kallerens ansvar (denne funksjonen returnerer den
 * ukomprimerte, evt. delta-kodede, byte-payloaden; `cli.ts`s dry-run gjør
 * selve gzip-målingen).
 */
export function buildWindMemberPackage(args: {
  readonly formatVersion: string;
  readonly producedAt: string;
  readonly init: string;
  readonly resolution: string;
  readonly components: FetchedWindComponents;
  readonly memberIndex: number;
  readonly bbox: readonly [west: number, south: number, east: number, north: number];
  readonly tileId: string;
  readonly t0S?: number;
  readonly dtS?: number;
  readonly bitsPerSample?: 8 | 10;
  readonly deltaCoded?: boolean;
  readonly sourceStatusOverride?: PackageHeader["sourceStatus"];
  /** D7.4 klippe-assert — se `buildWindMemberLayers`. Kalleren (`build-live-package.ts`) kaster umiddelbart ved brudd (§9.10). */
  readonly onClip?: (channel: "u" | "v", info: ClippedSample) => void;
}): WindTilePackageResult {
  const t0S = args.t0S ?? 0;
  const dtS = args.dtS ?? 3600; // §9.2: 1 t for harde felt (TWS er hardt), også for vind for øvrig i normaldrift
  const deltaCoded = args.deltaCoded ?? true; // §8: budsjettregnskapet forutsetter delta+gzip

  // D7.4/koordinering bølge 3B: `clippedSamples` i sertifikatet er ALDRI
  // valgfri (§9.10) — telles her UANSETT om kalleren ga en `onClip`
  // (kallerens variant kan hard-feile bygget, men skal ikke være
  // FORUTSETNINGEN for at telletallet finnes).
  let clippedSamples = 0;
  const countingOnClip = (channel: "u" | "v", info: ClippedSample): void => {
    clippedSamples++;
    args.onClip?.(channel, info);
  };

  const { uLayer, vLayer } = buildWindMemberLayers({
    components: args.components,
    memberIndex: args.memberIndex,
    bbox: args.bbox,
    t0S,
    dtS,
    ...(args.bitsPerSample !== undefined ? { bitsPerSample: args.bitsPerSample } : {}),
    onClip: countingOnClip,
  });

  const maxDecodeErrorKn = windLayerMaxDecodeErrorKn({
    u: buildLayerLookup(uLayer),
    v: buildLayerLookup(vLayer),
  });

  const rawPayloadBytes = uLayer.payload.byteLength + vLayer.payload.byteLength;

  // Nyttelast: u-lagets serialiserte bytes, deretter v-lagets — ekte
  // pakkelag (`@morild/weather::serializeLayer`), ikke en lokal ad-hoc
  // serialisering (§19, 2026-09-03).
  const uBytes = serializeLayer(uLayer, { deltaCoded });
  const vBytes = serializeLayer(vLayer, { deltaCoded });
  const payload = new Uint8Array(uBytes.length + vBytes.length);
  payload.set(uBytes, 0);
  payload.set(vBytes, uBytes.length);

  // D7.4 — sertifikat (§9.10): `maxDecodeErrorKn` er den analytiske
  // vaktbånd-skranken (§9.5, regnet fra NØYAKTIG denne serialiserte
  // flisens skala/offset, ikke et globalt/antatt tall — se
  // `windLayerMaxDecodeErrorKn`s dokumentasjon). `maxDirectionErrorDeg`
  // skanner denne KONKRETE medlemmets faktiske fartsfordeling (samme
  // kilde som ble matet inn i `buildLayer` over), IKKE et verste-fall som
  // ignorerer at lav-fart-punkter ikke har en meningsfull retning (§9.5).
  const certificate: FieldCertificate = {
    maxDecodeErrorKn,
    maxDirectionErrorDeg: fieldMaxDirectionErrorDeg(
      windMemberSpeedsKn(args.components, args.memberIndex),
      maxDecodeErrorKn,
    ),
    clippedSamples,
    referenceInit: args.init,
    verifiedAt: args.producedAt,
  };

  const header: CertifiedPackageHeader = {
    formatVersion: args.formatVersion,
    producedAt: args.producedAt,
    model: "MEPS",
    init: args.init,
    resolution: args.resolution,
    sourceStatus: args.sourceStatusOverride ?? STATUS_OK,
    certificate,
  };
  const hash = contentHash(payload);
  const key = r2Key(args.formatVersion, hash);
  return {
    header,
    payload,
    hash,
    key,
    maxDecodeErrorKn,
    rawPayloadBytes,
    pointerEntry: { field: "wind", member: args.memberIndex, key, hash, header },
  };
}

// --- Lagged-ensemble-integrasjon (§11) --------------------------------------

export interface EnsembleResolutionResult {
  readonly selection: ReturnType<typeof selectEnsembleRun>;
  readonly sourceStatus: PackageHeader["sourceStatus"];
}

/** Kombinerer §11s kjøringsvalg med §12s kildestatus-ordlyd, for bruk i `PackageHeader`. */
export function resolveEnsembleSourceStatus(
  runs: readonly EnsembleRun[],
  options?: LaggedEnsembleOptions,
): EnsembleResolutionResult {
  const selection = selectEnsembleRun(runs, options);
  if (selection.outcome === "complete") {
    const status =
      selection.runsBack === 0 ? STATUS_OK : ensembleFellBackToOlderRun(selection.run.memberCount, selection.run.init);
    return { selection, sourceStatus: combineSourceStatuses([selection.sourceStatus, status]) };
  }
  return { selection, sourceStatus: noUsableEnsemble(selection.sourceStatus.reason) };
}
