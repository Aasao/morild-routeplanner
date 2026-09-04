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
 *    `maxDecodeErrorKn` arves derimot **ikke**: den er pakkens egen
 *    kvantiseringsskranke (`packTwsDecodeErrorKn`) og bærer TWS-vaktbåndet i
 *    `expand.ts::twsExceedsHardLimit` (`docs/specs/vaerpakker.md` §9.5). Et
 *    kvantisert felt som arvet basefeltets `0` ville nettopp skjult den
 *    nedrundede vinden vaktbåndet finnes for.
 * 4. **Tidsnettet ankres i feltets egen `validFromS`, ikke i epoken.**
 *    Fiksturene er gyldige fra én time før avgang; et epoke-ankret 3-timersnett
 *    ville flyttet første skive til *etter* avgang og gjort hele målingen til
 *    en dekningstest. Pakkens gyldighet trimmes i den andre enden
 *    (`validToS` rundes ned til siste hele skive) — vi later aldri som om
 *    pakken dekker mer enn skivene sine (N2).
 *
 * 5. **Fast fysisk LSB er en egen skalamodus** (lagt til 2026-09-03 for D6-C,
 *    målt i rapportens §9.2). Der `flis` og `global` utleder trinnet av
 *    dataene, er `fast-lsb` et tall i spec-en — og da blir `maxDecodeErrorKn`
 *    en formatkonstant i stedet for en funksjon av flisinnholdet. Bitbredden
 *    snus tilsvarende fra parameter til *måling* (`PackStats.fixedLsb*`), og
 *    klipping mot kanalens deklarerte område telles, fordi klipping er det ene
 *    som gjør skranken ugyldig.
 *
 * Ren og deterministisk som resten av fikstur-grunnlaget: ingen I/O, ingen
 * klokke, ingen RNG. Flis-cachen er ren memoisering — den kan ikke endre et
 * eneste returnert tall, bare hvor mange ganger kildefeltet spørres.
 */
import { norm360 } from "@morild/geo";
import type { PackageHeader } from "@morild/protocol";
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
 * `fast-lsb` = trinnet er **oppgitt fysisk** (kn, m, s) og bitbredden er en
 * konsekvens, ikke et valg; se `FixedLsbOffset` og `fastLsb()`.
 */
export type ScaleMode = "flis" | "global" | "fast-lsb";

/**
 * Hvor nullpunktet i det heltallige kodefeltet ligger, når trinnet er fast
 * (`scale: "fast-lsb"`).
 *
 * - `ingen`: koden er `round(x / lsb)` — gitteret er ankret i **fysisk null**
 *   og er dermed *det samme overalt*. To like sanne verdier dekoder likt
 *   uansett hvilken flis de ligger i, og null er representerbart eksakt.
 *   Kodefeltet må dekke hele kanalens deklarerte område, så bredden er
 *   `⌈log2(2·⌈grense/lsb⌉ + 1)⌉` bit.
 * - `flis`: koden er `round((x − min i flisen)/lsb)` med et **eksakt**
 *   (ikke gitter-justert) flis-minimum i headeren. Kodene blir små — bredden
 *   er `⌈log2(spenn/lsb + 1)⌉` — men gitteret *flytter seg mellom fliser*,
 *   og to like sanne verdier på hver sin side av en flisgrense kan dekode
 *   forskjellig. Det er nettopp den sømmen målingen skal se etter.
 *
 * Merk den tredje muligheten, som **ikke** trenger å måles fordi den kan
 * bevises: et flis-offset som selv ligger på gitteret (`⌊min/lsb⌋·lsb`) gir
 * `anker + round((x − anker)/lsb)·lsb = round(x/lsb)·lsb` for alle `x`, altså
 * *bit-identiske dekodede verdier* med `ingen`. Kun bitbredden skiller dem.
 * Enhetstesten «gitter-justert flis-offset er identisk med ingen offset»
 * fastholder det.
 */
export type FixedLsbOffset = "flis" | "ingen";

export interface QuantSpec {
  /** `null` = ingen kvantisering (Float32-referansen). */
  readonly bits: number | null;
  readonly rounding: Rounding;
  readonly scale: ScaleMode;
  /**
   * Fast fysisk trinn i kanalens egen enhet — kun for `scale: "fast-lsb"`,
   * `null` ellers. Bitbredden er da ikke oppgitt, men **målt**
   * (`PackStats.fixedLsbMaxSpanCodes`/`fixedLsbMaxAbsCode`).
   */
  readonly lsb: number | null;
  readonly lsbOffset: FixedLsbOffset;
}

export const FLOAT32: QuantSpec = Object.freeze({
  bits: null,
  rounding: "nearest" as const,
  scale: "flis" as const,
  lsb: null,
  lsbOffset: "ingen" as const,
});

export function quant(
  bits: number,
  rounding: Rounding = "nearest",
  scale: ScaleMode = "flis",
): QuantSpec {
  return Object.freeze({ bits, rounding, scale, lsb: null, lsbOffset: "ingen" as const });
}

/**
 * **Fast fysisk LSB** (D6-C-kandidaten): trinnet er et tall i spec-en, ikke en
 * funksjon av dataene i flisen.
 *
 * Poenget er ikke båndbredde — det er at `maxDecodeErrorKn` blir en
 * **formatkonstant** (`√2·lsb/2` for u/v) som kan verifiseres i spec-en og i
 * en test, i stedet for en størrelse som avhenger av hva som tilfeldigvis lå i
 * flisen. `bits` er derfor `null`: bredden er en konsekvens av `lsb`, offset-
 * valget og feltets område, og måles av harnessen.
 */
export function fastLsb(
  lsb: number,
  lsbOffset: FixedLsbOffset = "ingen",
  rounding: Rounding = "nearest",
): QuantSpec {
  if (!(lsb > 0)) throw new Error("fastLsb krever et positivt trinn");
  return Object.freeze({
    bits: null,
    rounding,
    scale: "fast-lsb" as const,
    lsb,
    lsbOffset,
  });
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
  /**
   * **Bitbredde-regnskapet for fast LSB** (`scale: "fast-lsb"`), målt i
   * *koder* relativt fysisk null, uavhengig av offset-valget:
   *
   * - `fixedLsbMaxSpanCodes` = største `maksKode − minKode` i én flis og
   *   skive ⇒ et flis-offset trenger `⌈log2(spenn + 1)⌉` bit.
   * - `fixedLsbMaxAbsCode` = største `|kode|` ⇒ uten offset trengs
   *   `⌈log2(2·|kode| + 1)⌉` bit for å dekke det som faktisk forekom (og
   *   kanalens deklarerte grense for det som *kan* forekomme).
   *
   * Begge er nuller for alle andre skalamoduser.
   */
  fixedLsbMaxSpanCodes: number;
  fixedLsbMaxAbsCode: number;
  /**
   * Noder der koden måtte klippes til kanalens deklarerte område.
   * **Klipping bryter vaktbåndet** — feilen er da ikke lenger begrenset av
   * `lsb/2` — så dette tallet skal være 0, og målingen sjekker det.
   */
  fixedLsbClamped: number;
  /**
   * **Det adaptive regnskapet** (lagt til 2026-09-04, tillegg §14): for
   * `scale: "flis"`/`"global"` er trinnet ikke oppgitt, men utledet —
   * `(maks − min i flisen og skiven)/(2^bits − 1)`. Her måles det som faktisk
   * ble brukt: største spenn i én flis og skive (`adaptiveMaxSpan`) og
   * største trinn (`adaptiveMaxStep`), i kanalens egen enhet, som maksimum
   * over **alle lineære kanaler** i pakken.
   *
   * Tallet er det som skiller et syntetisk felt fra et ekte: fiksturenes
   * verste flisspenn er 21,7 kn, en ekte Skagerrak-flis' er over det dobbelte
   * — og siden trinnet er en funksjon av spennet, er også kvantiseringsfeilen
   * det. For fliser som kun bærer vind (den ekte pakken) er «alle lineære
   * kanaler» nøyaktig u og v. Nuller for `fast-lsb` og Float32.
   */
  adaptiveMaxSpan: number;
  adaptiveMaxStep: number;
}

/** Bit som trengs for å representere heltallene `0 … codes`. */
export function bitsForCodes(codes: number): number {
  return codes <= 0 ? 1 : Math.ceil(Math.log2(codes + 1));
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
      if (q.scale === "fast-lsb") {
        this.fastLsbChannel(raw, ch, c, channel);
        continue;
      }
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
      if (hi - lo > this.stats.adaptiveMaxSpan) this.stats.adaptiveMaxSpan = hi - lo;
      if (step > this.stats.adaptiveMaxStep) this.stats.adaptiveMaxStep = step;
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

  /**
   * **Fast fysisk LSB.** Trinnet kommer fra spec-en, ikke fra dataene: ingen
   * min/maks-avledet skala per flis og skive. Det er hele forskjellen — og
   * grunnen til at `maxDecodeErrorKn` blir en formatkonstant.
   *
   * Kodene telles alltid **relativt fysisk null** i statistikken, uavhengig av
   * offset-modus, slik at bitbredde-regnskapet for begge offset-valgene kan
   * leses av samme kjøring.
   */
  private fastLsbChannel(
    raw: Float64Array,
    ch: number,
    c: number,
    channel: Channel,
  ): void {
    const q = channel.quant;
    if (channel.kind === "vinkel") {
      // En syklisk kanal har ingen fysisk nullpunkt-skala å feste et fast
      // trinn i; 360/2^bits er dens egen faste LSB. Å late som noe annet
      // ville vært en stille feil.
      throw new Error("fast-lsb er ikke definert for sykliske kanaler");
    }
    const lsb = q.lsb;
    if (lsb === null || !(lsb > 0)) {
      throw new Error("fast-lsb krever et positivt trinn (lsb)");
    }

    let anchor = 0;
    if (q.lsbOffset === "flis") {
      let lo = Infinity;
      for (let idx = ch; idx < raw.length; idx += c) {
        const x = raw[idx]!;
        if (!Number.isNaN(x) && x < lo) lo = x;
      }
      if (lo === Infinity) return; // hele flisen mangler data
      anchor = lo;
    }
    const loCode = Math.round(channel.globalMin / lsb);
    const hiCode = Math.round(channel.globalMax / lsb);

    let codeLo = Infinity;
    let codeHi = NEG;
    for (let idx = ch; idx < raw.length; idx += c) {
      const x = raw[idx]!;
      if (Number.isNaN(x)) continue;
      const zeroCode = Math.round(x / lsb);
      if (zeroCode < codeLo) codeLo = zeroCode;
      if (zeroCode > codeHi) codeHi = zeroCode;
      const t = (x - anchor) / lsb;
      let qi = q.rounding === "opp" ? Math.ceil(t) : Math.round(t);
      if (q.lsbOffset === "ingen") {
        // Uten offset er kodefeltet ankret i null og må dekke kanalens
        // deklarerte område. Klipping utenfor er en ekte formatgrense — den
        // teller, den skjules ikke.
        if (qi < loCode) {
          qi = loCode;
          this.stats.fixedLsbClamped++;
        } else if (qi > hiCode) {
          qi = hiCode;
          this.stats.fixedLsbClamped++;
        }
      }
      raw[idx] = anchor + qi * lsb;
    }
    if (codeHi >= codeLo) {
      const span = codeHi - codeLo;
      if (span > this.stats.fixedLsbMaxSpanCodes) {
        this.stats.fixedLsbMaxSpanCodes = span;
      }
      const abs = Math.max(Math.abs(codeLo), Math.abs(codeHi));
      if (abs > this.stats.fixedLsbMaxAbsCode) {
        this.stats.fixedLsbMaxAbsCode = abs;
      }
    }
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
 * **Pakkens vaktbånd på TWS** (`docs/specs/vaerpakker.md` §9.5): en øvre
 * skranke for hvor mye kvantiseringen alene kan flytte den dekodede vindfarten
 * — og dermed hvor langt ned den harde grensen må flyttes for at en sann
 * over-grense-vind ikke skal kunne slippe gjennom.
 *
 * Utledningen, i den rekkefølgen den holder:
 *
 * 1. **Per kanal.** Trinnet er `(hi − lo)/(2^bits − 1)`. Med flis-skala er
 *    `hi − lo` flisens eget spenn, som aldri er større enn det globale
 *    området — vi regner derfor alltid med det globale, som er en gyldig
 *    (og billig, flisuavhengig) øvre skranke. `nearest` gir feil ≤ trinn/2,
 *    `opp` gir ensidig feil ≤ trinn.
 * 2. **Fra kanal til fart.** For u/v-lagring er farten `hypot(u,v)`, og
 *    `|‖x+d‖ − ‖x‖| ≤ ‖d‖` (omvendt trekantulikhet), altså ≤ `hypot(e,e)
 *    = √2·e`. For fart+retning-lagring er farten sin egen kanal og
 *    retningskvantiseringen endrer den ikke: skranken er `e`.
 * 3. **Gjennom interpolasjonen.** Bilineær/lineær interpolasjon er en
 *    konveks kombinasjon av nodene, og en konveks kombinasjon av vektorer
 *    med norm ≤ e har selv norm ≤ e. Skranken overlever altså oppslaget.
 *
 * Merk hva den **ikke** dekker: grid- og tidsoppløsningens feil. Den er
 * kvantiseringens skranke, akkurat slik §9.5 definerer `maxDecodeErrorKn` —
 * forsvaret mot oppløsningsfeilen er §9.2 (1 t) og §9.1 (2,5 km).
 */
export function packTwsDecodeErrorKn(spec: PackSpec, twsCapKn: number): number {
  const q = spec.windQuant;
  /**
   * **Fast fysisk LSB** — punkt 1 i utledningen over, men uten steg null:
   * trinnet er `lsb`, oppgitt i spec-en, og *ikke* utledet av `hi − lo`.
   * Skranken blir dermed uavhengig av feltet, av flisstørrelsen og av hva som
   * tilfeldigvis lå i flisen: `√2·lsb/2` for u/v, `lsb/2` for fart+retning
   * (nearest). Punkt 2 og 3 gjelder ordrett som før.
   *
   * Forutsetningen som ikke er gratis: **ingen klipping**. Klippes en kode mot
   * kanalens deklarerte område, er feilen ikke lenger begrenset av trinnet, og
   * skranken under er ikke gyldig. `PackStats.fixedLsbClamped` teller nettopp
   * det, og målingen krever at den er 0.
   */
  if (q.scale === "fast-lsb") {
    const lsb = q.lsb;
    if (lsb === null || !(lsb > 0)) {
      throw new Error("fast-lsb krever et positivt trinn (lsb)");
    }
    const oneSided = q.rounding === "opp" ? 1 : 0.5;
    return spec.windStorage === "uv"
      ? Math.SQRT2 * oneSided * lsb
      : oneSided * lsb;
  }
  if (q.bits === null) return 0; // Float32-referansen kvantiserer ikke.
  const levels = 2 ** q.bits - 1;
  const oneSided = q.rounding === "opp" ? 1 : 0.5;
  if (spec.windStorage === "uv") {
    const step = (2 * twsCapKn) / levels;
    return Math.SQRT2 * oneSided * step;
  }
  return (oneSided * twsCapKn) / levels;
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
  const stats: PackStats = {
    baseSamples: 0,
    tiles: 0,
    lookups: 0,
    fixedLsbMaxSpanCodes: 0,
    fixedLsbMaxAbsCode: 0,
    fixedLsbClamped: 0,
    adaptiveMaxSpan: 0,
    adaptiveMaxStep: 0,
  };
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
    // …men dekodefeilen er pakkens egen, og skal IKKE arves: den er hele
    // forskjellen på et kvantisert og et ukvantisert felt (§9.5).
    maxDecodeErrorKn: packTwsDecodeErrorKn(spec, twsCap),
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

// ------------------------------------------------- ekte flis som referansefelt

/**
 * **Ett dekodet, regelmessig vindgitter** — inngangen til `gridWindWeatherField`.
 *
 * Dette er formen en *ekte* værflis har etter at klienten har dekodet den:
 * u/v i knop på et lat/lon/tid-gitter. Typen er bevisst **naken** (tall og
 * typede arrayer, ingen `@morild/weather`-typer): arkitekturgrensen
 * (`tools/arch-tests`) tillater ikke at `packages/routing` importerer
 * `@morild/weather`, og fiksturen skal dessuten kunne mates fra hva som helst
 * som kan produsere et gitter. Selve lesingen av `.bin`-blobene — den eneste
 * I/O-en i kjeden — lever i `tools/kvantisering/ekte-flis.mjs`.
 *
 * Indeksering: `(i · nodesLon + j) · timeSteps + k`, `i` langs lat fra
 * `latMin`, `j` langs lon fra `lonMin`, `k` langs tid fra `t0S`. `NaN` =
 * manglende node (sentinel), og en manglende nabo gjør hele oppslaget
 * `undefined` — vi ekstrapolerer aldri (N2).
 */
export interface WindGrid {
  readonly latMin: number;
  readonly lonMin: number;
  readonly latStepDeg: number;
  readonly lonStepDeg: number;
  readonly nodesLat: number;
  readonly nodesLon: number;
  readonly t0S: number;
  readonly dtS: number;
  readonly timeSteps: number;
  /** u mot øst, knop. */
  readonly u: Float32Array | Float64Array;
  /** v mot nord, knop. */
  readonly v: Float32Array | Float64Array;
}

export interface GridWindFieldOptions {
  readonly header: PackageHeader;
  /**
   * Feltets egen dekodefeil. **Standard 0**, og det er et bevisst valg: dette
   * feltet spiller rollen som *sannheten* i målingen (`ANALYTISK`/`REF`-
   * kolonnen), på nøyaktig samme måte som de analytiske fiksturfeltene, og de
   * oppgir 0. At kilden i virkeligheten selv er 8-bit kvantisert av
   * produsenten er et forbehold som hører hjemme i rapporten, ikke et tall
   * som skal blandes inn i vaktbåndsregnskapet for *re*-kvantiseringen.
   */
  readonly maxDecodeErrorKn?: number;
  /** Overstyrer det utledede gyldighetsvinduet (snittet av gitrene). */
  readonly validFromS?: number;
  readonly validToS?: number;
}

function gridWindAt(
  g: WindGrid,
  lat: number,
  lon: number,
  epochS: number,
): readonly [number, number] | undefined {
  const fi = (lat - g.latMin) / g.latStepDeg;
  const fj = (lon - g.lonMin) / g.lonStepDeg;
  const fk = (epochS - g.t0S) / g.dtS;
  if (!(fi >= 0) || fi > g.nodesLat - 1) return undefined;
  if (!(fj >= 0) || fj > g.nodesLon - 1) return undefined;
  if (!(fk >= 0) || fk > g.timeSteps - 1) return undefined;
  const i0 = Math.floor(fi);
  const j0 = Math.floor(fj);
  const k0 = Math.floor(fk);
  const wi = fi - i0;
  const wj = fj - j0;
  const wk = fk - k0;

  let u = 0;
  let v = 0;
  for (let dk = 0; dk <= 1; dk++) {
    const tw = dk === 0 ? 1 - wk : wk;
    if (tw === 0) continue;
    for (let di = 0; di <= 1; di++) {
      const iw = di === 0 ? 1 - wi : wi;
      if (iw === 0) continue;
      for (let dj = 0; dj <= 1; dj++) {
        const jw = dj === 0 ? 1 - wj : wj;
        if (jw === 0) continue;
        const idx = ((i0 + di) * g.nodesLon + (j0 + dj)) * g.timeSteps + (k0 + dk);
        const w = tw * iw * jw;
        u += w * (g.u[idx] ?? Number.NaN);
        v += w * (g.v[idx] ?? Number.NaN);
      }
    }
  }
  if (Number.isNaN(u) || Number.isNaN(v)) return undefined;
  return [u, v];
}

/**
 * **Referansefelt bygget av ekte, dekodede værfliser.**
 *
 * Interpolasjonen er *identisk* med pakkemodellens egen (bilineær i rom,
 * lineær i tid, i u/v-komponentrommet, `uvToWind` som aller siste steg) — det
 * er en forutsetning for at `packField(gridWindWeatherField(...))` skal måle
 * **re-kvantiseringen** og ikke en forskjell i interpolasjonssemantikk.
 *
 * Flere gitre sys sammen som i `@morild/weather::compositeWeatherField`:
 * første gitter med et definert svar vinner. Pekerens fliser er 2°×2° og
 * berører hverandre bare langs kanten, så rekkefølgen avgjør aldri et reelt
 * valg mellom to ulike svar — kun hvilken av to kantnoder som brukes på
 * grensen.
 *
 * `maxTwsKn` regnes på **de dekodede verdiene** (kontraktens krav i
 * `contracts.ts`), altså som observert maksimum over alle noder i alle gitre —
 * ikke fra en kilde vi ikke kan verifisere.
 *
 * Bølger og strøm er `undefined`: den ekte pakken bærer dem ikke ennå
 * (`tools/weather-pack/out/build-report.json` §`missingFields`), og å dikte
 * dem opp ville gjort feltet syntetisk igjen. Ærlig degradering, ikke gjettede
 * verdier (N2).
 */
export function gridWindWeatherField(
  grids: readonly WindGrid[],
  opts: GridWindFieldOptions,
): WeatherField {
  if (grids.length === 0) {
    throw new Error("gridWindWeatherField: minst ett gitter kreves");
  }
  let maxTwsKn = 0;
  for (const g of grids) {
    const n = g.u.length;
    for (let idx = 0; idx < n; idx++) {
      const u = g.u[idx]!;
      const v = g.v[idx]!;
      if (Number.isNaN(u) || Number.isNaN(v)) continue;
      const s = Math.hypot(u, v);
      if (s > maxTwsKn) maxTwsKn = s;
    }
  }
  const validFromS =
    opts.validFromS ?? Math.max(...grids.map((g) => g.t0S));
  const validToS =
    opts.validToS ??
    Math.min(...grids.map((g) => g.t0S + (g.timeSteps - 1) * g.dtS));

  return {
    wind(lat, lon, epochS) {
      if (epochS < validFromS || epochS > validToS) return undefined;
      for (const g of grids) {
        const uv = gridWindAt(g, lat, lon, epochS);
        if (uv !== undefined) return uvToWind(uv[0], uv[1]);
      }
      return undefined;
    },
    waves() {
      return undefined;
    },
    current() {
      return undefined;
    },
    maxTwsKn,
    maxCurrentKn: 0,
    maxDecodeErrorKn: opts.maxDecodeErrorKn ?? 0,
    validFromS,
    validToS,
    header: opts.header,
  };
}
