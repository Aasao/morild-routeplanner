/**
 * **Værpakke-degradering** — modellen kvantiseringsmålingen måler med
 * (`docs/research/steg3-plan-2026-08-31.md` §«Kvantisering FØR formatlåsing»).
 *
 * Fiksturenes værfelt er *analytiske funksjoner*. En ekte værpakke er noe helt
 * annet: produsenten sampler modellen på et **rutenett**, kvantiserer verdiene
 * til et fast antall bit med skala/offset per flis, og klienten dekoder og
 * **interpolerer** tilbake. Denne filen er nettopp den kjeden — bygget som en
 * `WeatherField`-innpakning, slik at rutemotoren ikke vet at den kjører på et
 * degradert felt og målingen dermed måler *ruteeffekt*, ikke felt-RMSE.
 *
 * ```
 *   analytisk felt → gridsampling → kvantisering (flis-skala) → dekoding
 *                  → bilineær i rom + lineær i tid → WeatherField
 * ```
 *
 * ## Fire valg som er bevisste, og hvorfor
 *
 * 1. **Referansen er selv en pakke.** Alle akser måles mot `REF`-pakken
 *    (Float32, 2,5 km, 1 t, 0,8 km strøm), ikke mot det analytiske feltet.
 *    Ellers hadde hver akse båret hele gridsamplingsfeilen på toppen av sin
 *    egen, og ingen akse kunne isoleres. Gapet analytisk → `REF` rapporteres
 *    som egen kolonne, fordi det er den eneste måten å vite om referansen selv
 *    er lossy.
 * 2. **Interpolasjonen er identisk i alle konfigurasjoner.** Vind blir alltid
 *    interpolert som **vektor** (u/v), også når den er *lagret* som fart +
 *    retning. Da er det bare kvantiseringsfeilens *struktur* som skiller de to
 *    lagringsformene — ikke interpolasjonssemantikken. Uten det ville
 *    «u/v vs. fart+retning» målt to ting samtidig.
 * 3. **`maxTwsKn`/`maxCurrentKn` arves urørt fra kildefeltet.** De går inn i
 *    A\*-feltets Vmax-skranke (`search.ts` §computeVmax), og hadde de blitt
 *    justert per konfigurasjon, ville pruningen endret seg av noe annet enn
 *    feltverdiene. At den dekodede vinden *kan* overstige den arvede skranken
 *    er i stedet noe målingen **teller** (`PackProbe.twsOverDeclared`) — og et
 *    krav til spec-en, ikke en fri parameter her.
 * 4. **Tidsnettet ankres i feltets egen `validFromS`, ikke i epoken.**
 *    Fiksturene er gyldige fra én time før avgang; et epoke-ankret 3-timersnett
 *    ville flyttet første skive til *etter* avgang og gjort hele målingen til
 *    en dekningstest. Pakkens gyldighet trimmes i den andre enden
 *    (`validToS` rundes ned til siste hele skive) — vi later aldri som om
 *    pakken dekker mer enn skivene sine (N2).
 *
 * Ren og deterministisk som resten av fikstur-grunnlaget: ingen I/O, ingen
 * klokke, ingen RNG. Flis-cachen er ren memoisering — den kan ikke endre et
 * eneste returnert tall, bare hvor mange ganger kildefeltet spørres.
 */
import { norm360 } from "@morild/geo";
import type {
  CurrentSample,
  WaveSample,
  WeatherField,
  WindSample,
} from "../src/index.js";

// ------------------------------------------------------------------ geometri

/** Km per breddegrad. Samme tall som `packages/geo` bruker implisitt. */
export const KM_PER_DEG_LAT = 111.32;

/**
 * Breddegraden gridets lengdegradsavstand regnes ved. Fiksturene ligger alle
 * mellom 57,4 og 59,4° N, og et rutenett med *fast* lengdegradsavstand er
 * dessuten det MEPS-uttrekk pleier å bli når de reprojiseres til lat/lon.
 */
export const PACK_REF_LAT_DEG = 58.5;

export function latStepDegFor(km: number): number {
  return km / KM_PER_DEG_LAT;
}

export function lonStepDegFor(km: number): number {
  return km / (KM_PER_DEG_LAT * Math.cos((PACK_REF_LAT_DEG * Math.PI) / 180));
}

export interface PackDomain {
  readonly latMin: number;
  readonly latMax: number;
  readonly lonMin: number;
  readonly lonMax: number;
}

// -------------------------------------------------------------- kvantisering

/**
 * `nearest` er vanlig avrunding. `opp` runder **alltid oppover**, slik at den
 * dekodede nodeverdien er ≥ den sanne — det konservative valget for felt som
 * går inn i harde avvisninger (Hs mot `maxHsM`).
 *
 * Merk hva `opp` *ikke* garanterer: konservatismen gjelder **nodeverdiene**.
 * Mellom nodene er den bilineære rekonstruksjonen fortsatt utsatt for
 * gridsamplingsfeil, som kan gå begge veier. `opp` fjerner kvantiseringens
 * bidrag til en for lav Hs, ikke oppløsningens.
 */
export type Rounding = "nearest" | "opp";

/**
 * `flis` = skala/offset regnes fra min/maks i flisen (det typiske
 * pakkeformat-valget). `global` = én fast skala for hele feltet, utledet av
 * feltets deklarerte grenser — billigere header, grovere trinn.
 */
export type ScaleMode = "flis" | "global";

export interface QuantSpec {
  /** `null` = ingen kvantisering (Float32-referansen). */
  readonly bits: number | null;
  readonly rounding: Rounding;
  readonly scale: ScaleMode;
}

export const FLOAT32: QuantSpec = Object.freeze({
  bits: null,
  rounding: "nearest" as const,
  scale: "flis" as const,
});

export function quant(
  bits: number,
  rounding: Rounding = "nearest",
  scale: ScaleMode = "flis",
): QuantSpec {
  return Object.freeze({ bits, rounding, scale });
}

// ------------------------------------------------------------- pakkespesifik

export type WindStorage = "uv" | "fart-retning";

/**
 * `grid` = strømmen samples fra kildefeltet som alle andre felt.
 * `tidevann-hoved` = pakken bærer bare hovedkomponenten: **all romlig
 * struktur er borte**, og det som står igjen er domenegjennomsnittet per
 * tidsskive. Det er den grove klassen «kun tidevanns-hovedkomponent», og den
 * er med for å vise hva som faktisk går tapt når kyststrømmen ikke leveres som
 * felt.
 */
export type CurrentMode = "grid" | "tidevann-hoved";

export interface PackSpec {
  readonly id: string;
  readonly note: string;
  /** Horisontal nodeavstand for vind, km. */
  readonly windKm: number;
  /** Horisontal nodeavstand for bølger, km. */
  readonly waveKm: number;
  /** Horisontal nodeavstand for strøm, km. */
  readonly currentKm: number;
  readonly timeStepS: number;
  readonly windStorage: WindStorage;
  /** Gjelder u/v (uv-modus) eller farten (fart-retning-modus). */
  readonly windQuant: QuantSpec;
  /** Retningskanaler: vindretning i fart-retning-modus, og bølgeretning. */
  readonly dirQuant: QuantSpec;
  readonly hsQuant: QuantSpec;
  readonly tpQuant: QuantSpec;
  readonly currentQuant: QuantSpec;
  readonly currentMode: CurrentMode;
  /** Flisstørrelse i noder per akse. Skala/offset regnes per flis og skive. */
  readonly tileNodes: number;
}

/**
 * Referansepakken. Alle akser måles som **én endring** fra denne.
 *
 * 2,5 km / 1 t er MEPS-klassen; 0,8 km er NorKyst-klassen. Float32 er
 * «ingen kvantisering» — det som en gang lå i v1s felt før noen tenkte på
 * pakkeformat.
 */
export const REF_PACK: PackSpec = Object.freeze({
  id: "REF",
  note: "Float32, 2,5 km vind/bølge, 0,8 km strøm, 1 t. Referanse for alle akser.",
  windKm: 2.5,
  waveKm: 2.5,
  currentKm: 0.8,
  timeStepS: 3600,
  windStorage: "uv" as const,
  windQuant: FLOAT32,
  dirQuant: FLOAT32,
  hsQuant: FLOAT32,
  tpQuant: FLOAT32,
  currentQuant: FLOAT32,
  currentMode: "grid" as const,
  tileNodes: 32,
});

export function withPack(id: string, note: string, over: Partial<PackSpec>): PackSpec {
  return Object.freeze({ ...REF_PACK, ...over, id, note });
}

// ------------------------------------------------------------------- griddet

type ChannelKind = "lineær" | "vinkel";

interface Channel {
  readonly kind: ChannelKind;
  readonly quant: QuantSpec;
  /** Fast område for `scale: "global"`. Ignorert i flis-modus. */
  readonly globalMin: number;
  readonly globalMax: number;
}

/**
 * Kartet fra **dekodede kanalverdier** til **interpolasjonsrommet**.
 *
 * Dette er punkt 2 i filens toppkommentar, gjort konkret: en node lagret som
 * fart + retning må bli til en *vektor* før noe blandes, ellers ville
 * lagringsformen også endret interpolasjonssemantikken og aksen målt to ting
 * på én gang. Vinkler blir til (sin, cos) av samme grunn — en middelverdi av
 * 359° og 1° er 0°, ikke 180°.
 */
type InterpMap = (decoded: Float64Array, at: number, out: Float64Array, to: number) => void;

export interface PackStats {
  /** Antall oppslag i kildefeltet (= gridnoder som er materialisert). */
  baseSamples: number;
  /** Antall fliser som er bygget og kvantisert. */
  tiles: number;
  /** Oppslag i det ferdige feltet. */
  lookups: number;
}

const NEG = -Infinity;

/**
 * Ett lazy, flisdelt og kvantisert grid.
 *
 * Flisen er kvantiseringsenheten: skala/offset regnes fra min/maks **i
 * flisen og skiven**, akkurat slik et flisbasert pakkeformat gjør det. Flisen
 * bygges første gang noen ber om en node i den, og memoiseres. Memoiseringen
 * er ren: en flis er en funksjon av (indeks, kildefelt, spec).
 */
class TiledGrid {
  private readonly cache = new Map<number, Float64Array>();

  constructor(
    private readonly sample: (
      lat: number,
      lon: number,
      epochS: number,
    ) => readonly number[] | undefined,
    private readonly channels: readonly Channel[],
    private readonly toInterp: InterpMap,
    private readonly stride: number,
    private readonly latStep: number,
    private readonly lonStep: number,
    private readonly t0S: number,
    private readonly dtS: number,
    private readonly tileNodes: number,
    private readonly stats: PackStats,
  ) {}

  /** Flisnøkkel som tall — Map med strengnøkler er unødvendig dyrt her. */
  private key(ti: number, tj: number, k: number): number {
    return ((k + 4096) * 8192 + (ti + 4096)) * 8192 + (tj + 4096);
  }

  private tile(ti: number, tj: number, k: number): Float64Array {
    const key = this.key(ti, tj, k);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    const n = this.tileNodes;
    const c = this.channels.length;
    const raw = new Float64Array(n * n * c);
    const epochS = this.t0S + k * this.dtS;

    // Pass 1: rå nodeverdier fra kildefeltet.
    for (let a = 0; a < n; a++) {
      const lat = (ti * n + a) * this.latStep;
      for (let b = 0; b < n; b++) {
        const lon = (tj * n + b) * this.lonStep;
        this.stats.baseSamples++;
        const v = this.sample(lat, lon, epochS);
        const base = (a * n + b) * c;
        if (v === undefined) {
          for (let ch = 0; ch < c; ch++) raw[base + ch] = Number.NaN;
        } else {
          for (let ch = 0; ch < c; ch++) raw[base + ch] = v[ch] ?? Number.NaN;
        }
      }
    }

    // Pass 2: kvantiser per kanal (flis-skala krever min/maks over flisen).
    for (let ch = 0; ch < c; ch++) {
      const channel = this.channels[ch]!;
      const q = channel.quant;
      if (q.bits === null) {
        // Float32-referansen: verdiene rundes til Float32, ikke noe annet.
        for (let idx = ch; idx < raw.length; idx += c) {
          raw[idx] = Math.fround(raw[idx]!);
        }
        continue;
      }
      const levels = 2 ** q.bits - 1;
      if (channel.kind === "vinkel") {
        // Sykliske kanaler har ingen min/maks — de kvantiseres alltid globalt
        // over [0, 360) med wraparound. Trinn = 360/2^bits.
        const steps = 2 ** q.bits;
        for (let idx = ch; idx < raw.length; idx += c) {
          const x = raw[idx]!;
          if (Number.isNaN(x)) continue;
          const qi = ((Math.round((x / 360) * steps) % steps) + steps) % steps;
          raw[idx] = (qi * 360) / steps;
        }
        continue;
      }
      let lo: number;
      let hi: number;
      if (q.scale === "global") {
        lo = channel.globalMin;
        hi = channel.globalMax;
      } else {
        lo = Infinity;
        hi = NEG;
        for (let idx = ch; idx < raw.length; idx += c) {
          const x = raw[idx]!;
          if (Number.isNaN(x)) continue;
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
        if (lo === Infinity) continue; // hele flisen mangler data
      }
      const step = (hi - lo) / levels;
      if (!(step > 0)) {
        for (let idx = ch; idx < raw.length; idx += c) {
          const x = raw[idx]!;
          if (!Number.isNaN(x)) raw[idx] = lo;
        }
        continue;
      }
      for (let idx = ch; idx < raw.length; idx += c) {
        const x = raw[idx]!;
        if (Number.isNaN(x)) continue;
        const t = (x - lo) / step;
        const qi = Math.max(
          0,
          Math.min(levels, q.rounding === "opp" ? Math.ceil(t) : Math.round(t)),
        );
        raw[idx] = lo + qi * step;
      }
    }

    // Pass 3: over i interpolasjonsrommet (fart+retning → vektor, vinkel →
    // enhetsvektor). Det er her lagringsformen slutter å bety noe.
    const out = new Float64Array(n * n * this.stride);
    for (let node = 0; node < n * n; node++) {
      this.toInterp(raw, node * c, out, node * this.stride);
    }

    this.stats.tiles++;
    this.cache.set(key, out);
    return out;
  }

  private node(i: number, j: number, k: number, into: Float64Array): void {
    const n = this.tileNodes;
    const ti = Math.floor(i / n);
    const tj = Math.floor(j / n);
    const tile = this.tile(ti, tj, k);
    const a = i - ti * n;
    const b = j - tj * n;
    const base = (a * n + b) * this.stride;
    for (let w = 0; w < this.stride; w++) into[w] = tile[base + w]!;
  }

  /**
   * Bilineært i rom, lineært i tid, over interpolasjonsrommet.
   * Mangler én av de åtte nodene en kanal, mangler kanalen i svaret —
   * vi ekstrapolerer aldri (N2).
   */
  at(lat: number, lon: number, epochS: number): Float64Array | undefined {
    const fi = lat / this.latStep;
    const fj = lon / this.lonStep;
    const fk = (epochS - this.t0S) / this.dtS;
    const i0 = Math.floor(fi);
    const j0 = Math.floor(fj);
    const k0 = Math.floor(fk);
    const wi = fi - i0;
    const wj = fj - j0;
    const wk = fk - k0;

    const out = new Float64Array(this.stride);
    const tmp = new Float64Array(this.stride);
    for (let dk = 0; dk <= 1; dk++) {
      const tw = dk === 0 ? 1 - wk : wk;
      if (tw === 0) continue;
      for (let di = 0; di <= 1; di++) {
        const iw = di === 0 ? 1 - wi : wi;
        if (iw === 0) continue;
        for (let dj = 0; dj <= 1; dj++) {
          const jw = dj === 0 ? 1 - wj : wj;
          if (jw === 0) continue;
          this.node(i0 + di, j0 + dj, k0 + dk, tmp);
          const w = tw * iw * jw;
          for (let c = 0; c < this.stride; c++) out[c] = out[c]! + tmp[c]! * w;
        }
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------- pakking

/** Globale kvantiseringsområder for `scale: "global"`. */
const HS_GLOBAL_MAX_M = 12;
const TP_GLOBAL_MAX_S = 25;

function windTowardUV(speedKn: number, fromDeg: number): [number, number] {
  const rad = (fromDeg * Math.PI) / 180;
  return [-speedKn * Math.sin(rad), -speedKn * Math.cos(rad)];
}

function uvToWind(u: number, v: number): WindSample {
  return {
    speedKn: Math.hypot(u, v),
    fromDeg: norm360((Math.atan2(-u, -v) * 180) / Math.PI),
  };
}

export interface Pack {
  readonly field: WeatherField;
  readonly spec: PackSpec;
  readonly stats: PackStats;
}

/**
 * Pakker `base` som en værpakke etter `spec` og leverer den tilbake som et
 * `WeatherField` motoren ikke kan skille fra et vanlig felt.
 */
export function packField(
  base: WeatherField,
  spec: PackSpec,
  domain: PackDomain,
): Pack {
  const stats: PackStats = { baseSamples: 0, tiles: 0, lookups: 0 };
  const dt = spec.timeStepS;
  const t0 = base.validFromS;
  // Pakkens gyldighet er unionen av skivene den faktisk bærer.
  const validToS = t0 + Math.floor((base.validToS - t0) / dt) * dt;

  const twsCap = Math.max(base.maxTwsKn, 1);
  const curCap = Math.max(base.maxCurrentKn, 0.1);

  // --- vind
  const windChannels: readonly Channel[] =
    spec.windStorage === "uv"
      ? [
          { kind: "lineær", quant: spec.windQuant, globalMin: -twsCap, globalMax: twsCap },
          { kind: "lineær", quant: spec.windQuant, globalMin: -twsCap, globalMax: twsCap },
        ]
      : [
          { kind: "lineær", quant: spec.windQuant, globalMin: 0, globalMax: twsCap },
          { kind: "vinkel", quant: spec.dirQuant, globalMin: 0, globalMax: 360 },
        ];

  /**
   * Begge lagringsformer havner i det **samme** interpolasjonsrommet (u, v).
   * Fart+retning-formen konverteres per node etter dekoding, slik at det
   * eneste som skiller de to er kvantiseringsfeilens struktur.
   */
  const windInterp: InterpMap =
    spec.windStorage === "uv"
      ? (raw, at, out, to) => {
          out[to] = raw[at]!;
          out[to + 1] = raw[at + 1]!;
        }
      : (raw, at, out, to) => {
          const [u, v] = windTowardUV(raw[at]!, raw[at + 1]!);
          out[to] = u;
          out[to + 1] = v;
        };

  const windGrid = new TiledGrid(
    (lat, lon, epochS) => {
      const w = base.wind(lat, lon, epochS);
      if (w === undefined) return undefined;
      return spec.windStorage === "uv"
        ? windTowardUV(w.speedKn, w.fromDeg)
        : [w.speedKn, norm360(w.fromDeg)];
    },
    windChannels,
    windInterp,
    2,
    latStepDegFor(spec.windKm),
    lonStepDegFor(spec.windKm),
    t0,
    dt,
    spec.tileNodes,
    stats,
  );

  // --- bølger: Hs, Tp, retning
  const waveChannels: readonly Channel[] = [
    { kind: "lineær", quant: spec.hsQuant, globalMin: 0, globalMax: HS_GLOBAL_MAX_M },
    { kind: "lineær", quant: spec.tpQuant, globalMin: 0, globalMax: TP_GLOBAL_MAX_S },
    { kind: "vinkel", quant: spec.dirQuant, globalMin: 0, globalMax: 360 },
  ];
  const waveGrid = new TiledGrid(
    (lat, lon, epochS) => {
      const s = base.waves(lat, lon, epochS);
      if (s === undefined) return undefined;
      return [s.hsM, s.tpS ?? Number.NaN, s.fromDeg ?? Number.NaN];
    },
    waveChannels,
    (raw, at, out, to) => {
      out[to] = raw[at]!;
      out[to + 1] = raw[at + 1]!;
      const rad = (raw[at + 2]! * Math.PI) / 180;
      out[to + 2] = Math.sin(rad);
      out[to + 3] = Math.cos(rad);
    },
    4,
    latStepDegFor(spec.waveKm),
    lonStepDegFor(spec.waveKm),
    t0,
    dt,
    spec.tileNodes,
    stats,
  );

  // --- strøm
  const currentChannels: readonly Channel[] = [
    { kind: "lineær", quant: spec.currentQuant, globalMin: -curCap, globalMax: curCap },
    { kind: "lineær", quant: spec.currentQuant, globalMin: -curCap, globalMax: curCap },
  ];
  const currentGrid = new TiledGrid(
    (lat, lon, epochS) => {
      const c = base.current(lat, lon, epochS);
      if (c === undefined) return undefined;
      return [c.u, c.v];
    },
    currentChannels,
    (raw, at, out, to) => {
      out[to] = raw[at]!;
      out[to + 1] = raw[at + 1]!;
    },
    2,
    latStepDegFor(spec.currentKm),
    lonStepDegFor(spec.currentKm),
    t0,
    dt,
    spec.tileNodes,
    stats,
  );

  /**
   * «Kun tidevanns-hovedkomponent»-klassen: én vektor per tidsskive for hele
   * domenet. Gjennomsnittet tas over et fast 16×16-gitter — deterministisk, og
   * uavhengig av hvor ruten går.
   */
  const tidalCache = new Map<number, [number, number] | null>();
  const tidalAtSlice = (k: number): [number, number] | null => {
    const hit = tidalCache.get(k);
    if (hit !== undefined) return hit;
    const epochS = t0 + k * dt;
    let su = 0;
    let sv = 0;
    let n = 0;
    for (let a = 0; a < 16; a++) {
      const lat = domain.latMin + ((domain.latMax - domain.latMin) * a) / 15;
      for (let b = 0; b < 16; b++) {
        const lon = domain.lonMin + ((domain.lonMax - domain.lonMin) * b) / 15;
        stats.baseSamples++;
        const c = base.current(lat, lon, epochS);
        if (c === undefined) continue;
        su += c.u;
        sv += c.v;
        n++;
      }
    }
    const out: [number, number] | null = n === 0 ? null : [su / n, sv / n];
    tidalCache.set(k, out);
    return out;
  };

  const inTime = (epochS: number): boolean =>
    epochS >= t0 && epochS <= validToS;

  const field: WeatherField = {
    wind(lat, lon, epochS) {
      stats.lookups++;
      if (!inTime(epochS)) return undefined;
      const v = windGrid.at(lat, lon, epochS);
      if (v === undefined || Number.isNaN(v[0]!) || Number.isNaN(v[1]!)) {
        return undefined;
      }
      return uvToWind(v[0]!, v[1]!);
    },
    waves(lat, lon, epochS) {
      stats.lookups++;
      if (!inTime(epochS)) return undefined;
      const v = waveGrid.at(lat, lon, epochS);
      if (v === undefined || Number.isNaN(v[0]!)) return undefined;
      const out: { hsM: number; tpS?: number; fromDeg?: number } = {
        hsM: Math.max(0, v[0]!),
      };
      if (!Number.isNaN(v[1]!)) out.tpS = v[1]!;
      if (!Number.isNaN(v[2]!) && !Number.isNaN(v[3]!)) {
        out.fromDeg = norm360((Math.atan2(v[2]!, v[3]!) * 180) / Math.PI);
      }
      return out as WaveSample;
    },
    current(lat, lon, epochS) {
      stats.lookups++;
      if (!inTime(epochS)) return undefined;
      if (spec.currentMode === "tidevann-hoved") {
        const fk = (epochS - t0) / dt;
        const k0 = Math.floor(fk);
        const w = fk - k0;
        const a = tidalAtSlice(k0);
        const b = w === 0 ? a : tidalAtSlice(k0 + 1);
        if (a === null || b === null) return undefined;
        return { u: a[0] * (1 - w) + b[0] * w, v: a[1] * (1 - w) + b[1] * w };
      }
      const v = currentGrid.at(lat, lon, epochS);
      if (v === undefined || Number.isNaN(v[0]!) || Number.isNaN(v[1]!)) {
        return undefined;
      }
      return { u: v[0]!, v: v[1]! } satisfies CurrentSample;
    },
    // Arves urørt — se filens toppkommentar, punkt 3.
    maxTwsKn: base.maxTwsKn,
    maxCurrentKn: base.maxCurrentKn,
    validFromS: t0,
    validToS,
    header: base.header,
  };

  return { field, spec, stats };
}

// -------------------------------------------------------------- feltdiagnose

/**
 * Feltnær diagnose (kontekstkolonne, **ikke** beslutningsgrunnlaget): hvor mye
 * feltverdiene flytter seg, og om den dekodede vinden/strømmen bryter feltets
 * egen deklarerte skranke.
 *
 * Målingens beslutninger tas på *ruteeffekt*. Denne funksjonen finnes for at
 * en uventet ruteeffekt skal kunne forklares — og for at fravær av ruteeffekt
 * ikke skal forveksles med fravær av feltfeil.
 */
export interface PackProbe {
  readonly samples: number;
  readonly maxTwsErrKn: number;
  readonly rmsTwsErrKn: number;
  readonly maxDirErrDeg: number;
  readonly rmsDirErrDeg: number;
  readonly maxHsErrM: number;
  readonly rmsHsErrM: number;
  /** Verste negative Hs-feil (dekodet lavere enn sant) — den farlige retningen. */
  readonly worstHsUnderM: number;
  readonly maxCurrentErrKn: number;
  readonly rmsCurrentErrKn: number;
  /** Antall punkter der dekodet TWS > feltets deklarerte `maxTwsKn`. */
  readonly twsOverDeclared: number;
  readonly maxTwsOverKn: number;
  readonly currentOverDeclared: number;
  readonly maxCurrentOverKn: number;
  /** Punkter der referansen har data og pakken ikke (dekningstap). */
  readonly coverageLoss: number;
}

export function probePack(
  reference: WeatherField,
  packed: WeatherField,
  domain: PackDomain,
  departEpochS: number,
  hours: readonly number[] = [0, 3, 6, 9, 12, 15, 18],
  lattice = 21,
): PackProbe {
  let samples = 0;
  let maxTws = 0;
  let sumTws = 0;
  let maxDir = 0;
  let sumDir = 0;
  let maxHs = 0;
  let sumHs = 0;
  let worstUnder = 0;
  let maxCur = 0;
  let sumCur = 0;
  let overTws = 0;
  let maxOverTws = 0;
  let overCur = 0;
  let maxOverCur = 0;
  let coverageLoss = 0;

  for (const h of hours) {
    const epochS = departEpochS + h * 3600;
    for (let a = 0; a < lattice; a++) {
      const lat = domain.latMin + ((domain.latMax - domain.latMin) * a) / (lattice - 1);
      for (let b = 0; b < lattice; b++) {
        const lon =
          domain.lonMin + ((domain.lonMax - domain.lonMin) * b) / (lattice - 1);
        const wr = reference.wind(lat, lon, epochS);
        const wp = packed.wind(lat, lon, epochS);
        if (wr === undefined) continue;
        if (wp === undefined) {
          coverageLoss++;
          continue;
        }
        samples++;
        const dS = Math.abs(wp.speedKn - wr.speedKn);
        if (dS > maxTws) maxTws = dS;
        sumTws += dS * dS;
        const dD = Math.abs(
          ((((wp.fromDeg - wr.fromDeg) % 360) + 540) % 360) - 180,
        );
        if (dD > maxDir) maxDir = dD;
        sumDir += dD * dD;
        if (wp.speedKn > packed.maxTwsKn) {
          overTws++;
          maxOverTws = Math.max(maxOverTws, wp.speedKn - packed.maxTwsKn);
        }

        const sr = reference.waves(lat, lon, epochS);
        const sp = packed.waves(lat, lon, epochS);
        if (sr !== undefined && sp !== undefined) {
          const d = sp.hsM - sr.hsM;
          if (Math.abs(d) > maxHs) maxHs = Math.abs(d);
          sumHs += d * d;
          if (d < worstUnder) worstUnder = d;
        }

        const cr = reference.current(lat, lon, epochS);
        const cp = packed.current(lat, lon, epochS);
        if (cr !== undefined && cp !== undefined) {
          const d = Math.hypot(cp.u - cr.u, cp.v - cr.v);
          if (d > maxCur) maxCur = d;
          sumCur += d * d;
          const mag = Math.hypot(cp.u, cp.v);
          if (mag > packed.maxCurrentKn) {
            overCur++;
            maxOverCur = Math.max(maxOverCur, mag - packed.maxCurrentKn);
          }
        }
      }
    }
  }

  const n = Math.max(1, samples);
  return {
    samples,
    maxTwsErrKn: maxTws,
    rmsTwsErrKn: Math.sqrt(sumTws / n),
    maxDirErrDeg: maxDir,
    rmsDirErrDeg: Math.sqrt(sumDir / n),
    maxHsErrM: maxHs,
    rmsHsErrM: Math.sqrt(sumHs / n),
    worstHsUnderM: worstUnder,
    maxCurrentErrKn: maxCur,
    rmsCurrentErrKn: Math.sqrt(sumCur / n),
    twsOverDeclared: overTws,
    maxTwsOverKn: maxOverTws,
    currentOverDeclared: overCur,
    maxCurrentOverKn: maxOverCur,
    coverageLoss,
  };
}

/** Domenet rundt et strekk, med margin — pakkens utstrekning. */
export function domainAround(
  points: readonly { readonly lat: number; readonly lon: number }[],
  marginDeg = 0.6,
): PackDomain {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    latMin: Math.min(...lats) - marginDeg,
    latMax: Math.max(...lats) + marginDeg,
    lonMin: Math.min(...lons) - marginDeg,
    lonMax: Math.max(...lons) + marginDeg,
  };
}
