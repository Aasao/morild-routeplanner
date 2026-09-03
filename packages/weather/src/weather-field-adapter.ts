/**
 * Adapter fra `WeatherPackage` til rutemotorens `WeatherField`-kontrakt
 * (`packages/routing/src/contracts.ts`, `docs/specs/rutemotor.md` §4.2).
 *
 * **Arkitekturgrensen** (`tools/arch-tests`, samme regel for `packages/geo`
 * og `packages/routing`, utvidet hit): `packages/weather` importerer ALDRI
 * `@morild/routing`. `WeatherFieldLike` under er en bevisst, strukturelt
 * kompatibel SPEILING av `WeatherField` — ikke en import. TypeScripts
 * strukturelle typing gjør et objekt formet slik tildelbart til routing sin
 * `WeatherField` der begge pakker faktisk er importert (f.eks.
 * `apps/pwa`/`apps/worker`), uten at noen av pakkene avhenger av den andre.
 * Endres `WeatherField`-kontrakten i routing, skal denne speilingen
 * oppdateres i samme omgang — de to er ment å drifte sammen, aldri hver
 * for seg (kommentaren i `contracts.ts` sier det samme om den fremtidige
 * farbarhetsmaske-adapteren).
 */
import type { PackageHeader } from "@morild/protocol";
import {
  computeObservedMaxSpeedKn,
  decodeCurrentAt,
  decodeWavesAt,
  decodeWindAt,
  windLayerMaxDecodeErrorKn,
  type CurrentLayers,
  type WaveLayers,
  type WindMemberLayers,
} from "./field.js";
import type { CurrentSample, WaveSample, WindSample } from "./samples.js";

/** Speiling av `packages/routing/src/contracts.ts::WeatherField` — se filens toppkommentar. */
export interface WeatherFieldLike {
  wind(lat: number, lon: number, epochS: number): WindSample | undefined;
  waves(lat: number, lon: number, epochS: number): WaveSample | undefined;
  current(lat: number, lon: number, epochS: number): CurrentSample | undefined;
  readonly maxTwsKn: number;
  readonly maxCurrentKn: number;
  readonly maxDecodeErrorKn: number;
  readonly validFromS: number;
  readonly validToS: number;
  readonly header: PackageHeader;
}

/** Medlemshorisont — låst (§9.1 pkt. 4): 48 t for medlemmer, full horisont for kontroll. */
export const MEMBER_HORIZON_S = 48 * 3600;

export interface WeatherPackage {
  /** Indeks 0 = kontroll (deterministisk, full horisont). 1..29 = medlemmer, 48 t. */
  readonly windMembers: readonly WindMemberLayers[];
  /** Medlemsuavhengig (§4.2) — samme instans brukes for alle 30 `WeatherField`. */
  readonly current?: CurrentLayers;
  readonly waves?: WaveLayers;
  readonly windHeader: PackageHeader;
  readonly currentHeader?: PackageHeader;
  readonly wavesHeader?: PackageHeader;
}

export interface ToWeatherFieldOptions {
  /** Avgangstidspunktet — 48-timersgrensen for medlemmer regnes herfra, ikke fra feltets `t0S`. */
  readonly departEpochS: number;
}

/**
 * Bygger ett `WeatherField`-kompatibelt objekt for ETT ensemble-medlem.
 * Kalles én gang per medlem ved lasting — de dyre delene (`maxTwsKn`/
 * `maxCurrentKn`/`maxDecodeErrorKn`) regnes her, ikke per oppslag.
 */
export function toWeatherField(
  pkg: WeatherPackage,
  memberIndex: number,
  opts: ToWeatherFieldOptions,
): WeatherFieldLike {
  const member = pkg.windMembers[memberIndex];
  if (member === undefined) {
    throw new Error(
      `toWeatherField: ukjent medlemsindeks ${memberIndex} (pakken har ${pkg.windMembers.length} medlemmer)`,
    );
  }

  const g = member.u.layer.geometry;
  const layerValidFromS = g.t0S;
  const layerValidToS = g.t0S + (g.timeSteps - 1) * g.dtS;
  const isControl = memberIndex === 0;
  const validToS = isControl
    ? layerValidToS
    : Math.min(layerValidToS, opts.departEpochS + MEMBER_HORIZON_S);
  const validFromS = Math.min(layerValidFromS, validToS);

  const maxTwsKn = computeObservedMaxSpeedKn(member.u.layer, member.v.layer);
  const maxCurrentKn =
    pkg.current === undefined
      ? 0
      : computeObservedMaxSpeedKn(pkg.current.u.layer, pkg.current.v.layer);
  const maxDecodeErrorKn = windLayerMaxDecodeErrorKn(member);

  const current = pkg.current;
  const waves = pkg.waves;

  return {
    wind(lat, lon, epochS) {
      if (epochS < validFromS || epochS > validToS) return undefined;
      return decodeWindAt(member, lat, lon, epochS);
    },
    waves(lat, lon, epochS) {
      // Bevisst IKKE avhengig av vindens validToS — bølgelaget kan ha sin
      // egen, uavhengige dekning (§5: én PackageHeader per felt, ulik
      // init/dekning kan gjelde samtidig).
      if (waves === undefined) return undefined;
      return decodeWavesAt(waves, lat, lon, epochS);
    },
    current(lat, lon, epochS) {
      if (current === undefined) return undefined;
      return decodeCurrentAt(current, lat, lon, epochS);
    },
    maxTwsKn,
    maxCurrentKn,
    maxDecodeErrorKn,
    validFromS,
    validToS,
    // Motorens `WeatherField` bærer ÉN header (`contracts.ts`), men §5
    // krever én `PackageHeader` PER FELT. Vinden — feltet som varierer per
    // medlem og driver ensemblet — er den representative headeren her;
    // `pkg.currentHeader`/`pkg.wavesHeader` finnes på pakken for alt som
    // trenger per-felt-detalj (f.eks. UI-alder per felt, §6) utover det
    // motorens ene `header`-felt kan uttrykke.
    header: pkg.windHeader,
  };
}
