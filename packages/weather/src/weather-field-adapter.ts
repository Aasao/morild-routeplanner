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
import { hasCertificate } from "./certificate.js";
import {
  computeObservedMaxSpeedKn,
  decodeCoastalMaskAt,
  decodeCurrentAt,
  decodeWavesAt,
  decodeWindAt,
  windLayerMaxDecodeErrorKn,
  type CoastalMaskLayer,
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
  /**
   * Speiling av `WeatherField.currentCoastal?` (`docs/specs/strom-produsent.md`
   * §4b, D15.2): sant når strømverdien i punktet er kystnær (kystmasken,
   * hjørneregelen). `false` når masken mangler.
   */
  currentCoastal?(lat: number, lon: number, epochS: number): boolean;
  /**
   * Speiling av `WeatherField.wavePointDistanceNm?` (`docs/specs/
   * punktbolge.md` §3): avstand i nm til nærmeste bølge-varselpunkt. Kun
   * felt med punktbølge (`withWavePoints`) har den.
   */
  wavePointDistanceNm?(lat: number, lon: number): number | undefined;
  readonly maxTwsKn: number;
  readonly maxCurrentKn: number;
  readonly maxDecodeErrorKn: number;
  /**
   * **Koordinering fase 3 bølge 3B (rutemotor-/klientagenten).** Per-flis
   * vaktbånd (D7.3) — `undefined` NÅR OG BARE NÅR `wind(lat,lon,epochS)`
   * selv er `undefined` (samme dekningslogikk, se `toWeatherField`).
   * Valgfri (`?`) fordi eldre/syntetiske `WeatherFieldLike`-implementasjoner
   * (test-fixtures, `packages/routing/test-fixtures/pack-degradation.ts`)
   * ikke nødvendigvis har den ennå — motoren skal derfor falle tilbake til
   * det globale `maxDecodeErrorKn` når denne mangler, ALDRI anta 0.
   */
  maxDecodeErrorKnAt?(lat: number, lon: number, epochS: number): number | undefined;
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
  /** Kystmasken for strømmen (D15.2) — valgfri; mangler den, er `currentCoastal` alltid `false`. */
  readonly currentCoastal?: CoastalMaskLayer;
  readonly waves?: WaveLayers;
  readonly windHeader: PackageHeader;
  readonly currentHeader?: PackageHeader;
  readonly wavesHeader?: PackageHeader;
}

export interface ToWeatherFieldOptions {
  /** Avgangstidspunktet — 48-timersgrensen for medlemmer regnes herfra, ikke fra feltets `t0S`. */
  readonly departEpochS: number;
  /**
   * Overstyrer kontroll-vs-medlem-avgjørelsen som ellers utledes av
   * `memberIndex === 0`. Lagt til i fase 3 bølge 2C: en progressiv
   * worker-pool (ADR-0005) dekoder ETT medlem per Worker-kall og bygger da
   * en `WeatherPackage` med `windMembers` av lengde 1 for HVERT kall — uten
   * denne overstyringen ville et hvilket som helst medlem (også medlem
   * 5, 12, …) blitt tolket som kontrollen bare fordi det står alene på
   * indeks 0 i sin egen ett-elements array, og dermed feilaktig fått FULL
   * horisont i stedet for 48 t-medlemsgrensen (§9.1 pkt. 4) — nøyaktig den
   * typen stille feilklassifisering N2 forbyr. Udefinert ⇒ uendret
   * standardoppførsel (`memberIndex === 0`), så eksisterende kallere (hele
   * pakken i én `WeatherPackage`) er upåvirket.
   */
  readonly isControl?: boolean;
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
  const isControl = opts.isControl ?? memberIndex === 0;
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
  // Koordinering fase 3 bølge 3B (D7.3/D7.4): sertifikatets tall skal
  // ALDRI kunne undergrave det selv-beregnede vaktbåndet — kun heve det,
  // aldri senke det (§9.10: sertifikatet er en byggetids-SPOTSJEKK, ikke
  // den autoritative kilden for skranken selv).
  const certifiedMaxDecodeErrorKn = hasCertificate(pkg.windHeader)
    ? pkg.windHeader.certificate.maxDecodeErrorKn
    : undefined;
  const maxDecodeErrorKnBand =
    certifiedMaxDecodeErrorKn === undefined
      ? maxDecodeErrorKn
      : Math.max(maxDecodeErrorKn, certifiedMaxDecodeErrorKn);

  const current = pkg.current;
  const coastalMask = pkg.currentCoastal;
  const waves = pkg.waves;

  return {
    wind(lat, lon, epochS) {
      if (epochS < validFromS || epochS > validToS) return undefined;
      return decodeWindAt(member, lat, lon, epochS);
    },
    maxDecodeErrorKnAt(lat, lon, epochS) {
      // Samme dekningslogikk som `wind()` over — bevisst dupli­sert
      // fremfor delt, slik at en fremtidig endring av `wind()`s
      // gyldighetssjekk ALDRI kan drifte fra denne uten at begge stedene
      // endres eksplisitt (ingen skjult avhengighet mellom de to).
      if (epochS < validFromS || epochS > validToS) return undefined;
      if (decodeWindAt(member, lat, lon, epochS) === undefined) return undefined;
      return maxDecodeErrorKnBand;
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
    currentCoastal(lat, lon) {
      // Statisk maske — tiden ignoreres (spec §3 invariant 6).
      if (coastalMask === undefined) return false;
      return decodeCoastalMaskAt(coastalMask, lat, lon);
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

/**
 * Sammensying av flere per-flis `WeatherFieldLike` til ETT felt (review-funn
 * fase 3 bølge 2, funn 2: `apps/pwa`s `tile-select.ts` brukte tidligere kun
 * FØRSTE overlappende flis — den ekte Skjæløy→Skagen-pakken har derimot TO
 * fliser, delt ved 58°N-grensen, `tools/weather-pack/src/
 * build-live-package.ts`s `TARGET_TILES`).
 *
 * Pekerens fliser deler origo og er 2°×2° (§7) — de overlapper IKKE i
 * praksis (kun berører hverandre langs en delt kant), så rekkefølgen
 * `fields` prøves i, avgjør aldri et reelt valg mellom to ULIKE svar for
 * samme punkt; den avgjør bare hvilken av to (tilnærmet identiske,
 * uavhengig kvantiserte) kantnoder som brukes rett på grensen. Første
 * felt med et definert svar vinner, per felt (vind/bølge/strøm hver for
 * seg — en flis kan mangle bølge/strøm mens en annen har det).
 *
 * Et punkt utenfor ALLE fliser gir `undefined`, akkurat som ett enkelt felt
 * gir `undefined` utenfor sin dekning. Det finnes bevisst INGEN egen
 * "utenfor pakkens dekning"-flaggmekanisme her: rutemotoren gjør allerede
 * `undefined`-svar synlige og ærlige (`search.ts::expandLabel` og
 * `reconstruct.ts`s sluttetappe-sjekk setter `weatherPartial`/avviser
 * sluttetappen — ALDRI en stille stopp, N2) — se `route-flags.ts::
 * coverageFlags` i `apps/pwa` for hvor det vises i UI-en.
 */
export function compositeWeatherField(fields: readonly WeatherFieldLike[]): WeatherFieldLike {
  if (fields.length === 0) {
    throw new Error("compositeWeatherField: minst ett felt kreves (tom liste er en programmeringsfeil hos kalleren)");
  }
  if (fields.length === 1) {
    return fields[0]!;
  }

  // Konservative maksverdier (§ `WeatherField`-kontraktens toppkommentar i
  // `contracts.ts`): en øvre skranke som gjelder UANSETT hvilken flis et
  // gitt punkt havner i, må være maksimum over ALLE fliser — et lavere tall
  // fra bare én flis ville ikke lenger vært en gyldig øvre skranke andre
  // steder i feltet.
  const maxTwsKn = Math.max(...fields.map((f) => f.maxTwsKn));
  const maxCurrentKn = Math.max(...fields.map((f) => f.maxCurrentKn));
  const maxDecodeErrorKn = Math.max(...fields.map((f) => f.maxDecodeErrorKn));

  // Tids-gyldighetsvinduet sjekkes i motoren FØR selve posisjonsoppslaget,
  // UAVHENGIG av posisjon (`search.ts`/`evaluate.ts`/`reconstruct.ts`). En
  // union (tidligste `validFromS`, seneste `validToS`) er den trygge
  // retningen: den avviser aldri et tidspunkt en ANNEN flis faktisk dekker.
  // Det er ikke en løgn om enkeltflisenes dekning — hvert `wind()`-kall
  // under sjekker uansett flisens EGEN `validFromS`/`validToS` internt
  // (`toWeatherField`), så unionen her utvider aldri hva som faktisk
  // returneres, kun hvor lenge motoren i det hele tatt SPØR. I praksis er
  // fliser fra samme pakkebygg identiske på dette punktet (samme
  // `departEpochS`/medlemshorisont for alle fliser i én kjøring).
  const validFromS = Math.min(...fields.map((f) => f.validFromS));
  const validToS = Math.max(...fields.map((f) => f.validToS));

  function firstDefined<T>(lookup: (f: WeatherFieldLike) => T | undefined): T | undefined {
    for (const f of fields) {
      const v = lookup(f);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  return {
    wind(lat, lon, epochS) {
      return firstDefined((f) => f.wind(lat, lon, epochS));
    },
    /**
     * **Koordinering fase 3 bølge 3B (D7.3):** IDENTISK iterasjonsrekkefølge
     * som `wind()` over — båndet skal komme fra NØYAKTIG samme flis som
     * vindsvaret, aldri fra en annen flis som tilfeldigvis også dekker
     * punktet. Kaller derfor `f.wind(...)` på nytt her (samme sjekk som
     * `firstDefined` gjør inni `wind()`) i stedet for en uavhengig
     * `firstDefined`-skanning etter `maxDecodeErrorKnAt` alene — to
     * uavhengige skanninger kunne i prinsippet plukket ulike fliser dersom
     * fliser noensinne fikk overlappende (ikke bare grensetilstøtende)
     * dekning.
     */
    maxDecodeErrorKnAt(lat, lon, epochS) {
      for (const f of fields) {
        if (f.wind(lat, lon, epochS) !== undefined) {
          return f.maxDecodeErrorKnAt?.(lat, lon, epochS) ?? f.maxDecodeErrorKn;
        }
      }
      return undefined;
    },
    waves(lat, lon, epochS) {
      return firstDefined((f) => f.waves(lat, lon, epochS));
    },
    current(lat, lon, epochS) {
      return firstDefined((f) => f.current(lat, lon, epochS));
    },
    /**
     * OR over flisene: en flis' maske er `false` utenfor egen dekning, så i
     * praksis svarer flisen som dekker punktet. På en delt kant er OR den
     * konservative retningen (heller merket enn umerket).
     */
    currentCoastal(lat, lon, epochS) {
      return fields.some((f) => f.currentCoastal?.(lat, lon, epochS) === true);
    },
    /**
     * Punktbølge (`punktbolge.md`) legges normalt på ETTER sammensyingen
     * (`withWavePoints`), men bærer et flisfelt den likevel, sendes første
     * definerte avstand videre — samme regel som `waves()` over.
     */
    wavePointDistanceNm(lat, lon) {
      return firstDefined((f) => f.wavePointDistanceNm?.(lat, lon));
    },
    maxTwsKn,
    maxCurrentKn,
    maxDecodeErrorKn,
    validFromS,
    validToS,
    // Samme begrunnelse som `toWeatherField`s `header`-felt: motorens
    // `WeatherField` bærer ÉN header. Fliser fra samme pakkebygg deler
    // modell/init for et gitt felt (§5); førsteflisens header er derfor
    // representativ, ikke en vilkårlig utvelgelse.
    header: fields[0]!.header,
  };
}
