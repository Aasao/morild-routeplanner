/**
 * Ekspansjonssteget (docs/specs/rutemotor.md §5.3).
 *
 * ADR-0004 avvik 4 krever at harde constraints og myke kostnader er **to
 * semantisk adskilte steg**: `checkHard*` returnerer bare avvisning eller
 * godkjenning og aldri et tall, og `accumulateSoft` returnerer bare
 * kostnadsbidrag og kan aldri avvise. Det er den strukturelle garantien for
 * at ingen kostnad, uansett størrelse, kan gjøre en no-go-passasje gyldig.
 *
 * Rekkefølgen på *forkastende* filtre i søkeløkka er en ren ytelsesdetalj —
 * å forkaste tidlig kan aldri gjøre en ugyldig kandidat gyldig. Det som
 * bærer semantikken er at **innsetting alltid er siste steg**.
 */
import type { LatLon } from "@morild/geo";
import { angDiff, isNightAt, norm360, stepLatLon } from "@morild/geo";
import type {
  BoatModel,
  CurrentSample,
  NavigabilityMask,
  WaveSample,
  WeatherField,
  WindSample,
} from "./contracts.js";
import type { CostVector } from "./cost.js";
import {
  FLAG_KRYSS,
  FLAG_MOTOR,
  FLAG_NATT,
  FLAG_TSS_LANGS,
  FLAG_VIND_MOT_STROM,
} from "./cost.js";
import { applyTssRule, type TssRuleParams } from "./tss.js";

/** Under denne farten regnes kandidaten som stillestående (v1s terskel). */
const MIN_SPEED_KN = 0.05;

export type HardCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

export const HARD_OK: HardCheck = Object.freeze({ ok: true });

function reject(reason: string): HardCheck {
  return { ok: false, reason };
}

/** Værtilstanden i én node, hentet én gang før kursløkken. */
export interface NodeEnvironment {
  readonly wind: WindSample;
  readonly waves: WaveSample | undefined;
  readonly current: CurrentSample | undefined;
  readonly isNight: boolean;
  readonly epochS: number;
  /**
   * Vind mot strøm. Utledet av `wind` og `current` alene, altså uavhengig av
   * kursen — derfor regnet én gang per node, ikke per kurs.
   */
  readonly windAgainstCurrent: boolean;
}

/**
 * Miljøet i én posisjon til én tid. **Én sannhet:** søket, evaluatoren og
 * rekonstruksjonens sluttetappe skal se nøyaktig samme vær i samme punkt, med
 * samme oppslagsrekkefølge og samme natt-/vind-mot-strøm-avledning.
 *
 * Ren: ingen sideeffekter. Kalleren avgjør selv hva det betyr at `waves` eller
 * `current` mangler (søket setter da `weatherPartial`).
 */
export function environmentAt(
  weather: WeatherField,
  pos: LatLon,
  epochS: number,
): NodeEnvironment | undefined {
  const wind: WindSample | undefined = weather.wind(pos.lat, pos.lon, epochS);
  if (wind === undefined) return undefined;
  const waves: WaveSample | undefined = weather.waves(
    pos.lat,
    pos.lon,
    epochS,
  );
  const current: CurrentSample | undefined = weather.current(
    pos.lat,
    pos.lon,
    epochS,
  );
  return {
    wind,
    waves,
    current,
    isNight: isNightAt(pos.lat, pos.lon, epochS),
    epochS,
    windAgainstCurrent: isWindAgainstCurrent(wind, current),
  };
}

/**
 * **Hard:** ytelsesgrensene i båtmodellen (F3.2). Brudd forkaster noden —
 * det er slik «ruten går rundt uvær» oppstår, uten at det er en kostnad noen
 * kan vekte seg forbi.
 */
export function checkHardNode(
  env: NodeEnvironment,
  boat: BoatModel,
): HardCheck {
  if (env.wind.speedKn > boat.maxTwsKn) {
    return reject(
      `TWS ${env.wind.speedKn.toFixed(1)} kn over båtens grense ${boat.maxTwsKn} kn`,
    );
  }
  if (env.waves !== undefined && env.waves.hsM > boat.maxHsM) {
    return reject(
      `Hs ${env.waves.hsM.toFixed(1)} m over båtens grense ${boat.maxHsM} m`,
    );
  }
  return HARD_OK;
}

/** Resultatet av fart-/strøm-regnestykket for én kurs. */
export interface StepKinematics {
  readonly headingDeg: number;
  readonly twaDeg: number;
  readonly bspKn: number;
  readonly sogKn: number;
  readonly sogDirDeg: number;
  readonly distanceNm: number;
  readonly next: LatLon;
  readonly motorOn: boolean;
}

/**
 * Fart gjennom vannet, strømaddisjon og neste posisjon for én kurs.
 * `undefined` = kandidaten står praktisk talt stille og forkastes.
 *
 * Konvensjoner (F2.5): vind FRA, bølge FRA, strøm MOT, kurs rettvisende.
 */
export function stepKinematics(
  from: LatLon,
  headingDeg: number,
  env: NodeEnvironment,
  boat: BoatModel,
  timeStepS: number,
): StepKinematics | undefined {
  const twaDeg = angDiff(env.wind.fromDeg, headingDeg);

  let waveF = 1;
  if (env.waves !== undefined) {
    // Bølgeretning når den er kjent, ellers vinden som proxy (v1-arv).
    const relDirDeg =
      env.waves.fromDeg === undefined
        ? twaDeg
        : angDiff(env.waves.fromDeg, headingDeg);
    waveF = boat.waveFactor(env.waves.hsM, env.waves.tpS, relDirDeg);
  }

  let bspKn = boat.boatSpeedKn(env.wind.speedKn, twaDeg) * waveF;
  let motorOn = false;
  if (boat.motorThresholdKn > 0 && bspKn < boat.motorThresholdKn) {
    bspKn = boat.motorSpeedKn * waveF;
    motorOn = true;
  }
  if (bspKn <= MIN_SPEED_KN) return undefined;

  const headingRad = (headingDeg * Math.PI) / 180;
  const cu = env.current?.u ?? 0;
  const cv = env.current?.v ?? 0;
  const su = bspKn * Math.sin(headingRad) + cu;
  const sv = bspKn * Math.cos(headingRad) + cv;
  const sogKn = Math.hypot(su, sv);
  if (sogKn <= MIN_SPEED_KN) return undefined;

  const sogDirDeg = norm360((Math.atan2(su, sv) * 180) / Math.PI);
  const distanceNm = (sogKn * timeStepS) / 3600;
  return {
    headingDeg,
    twaDeg,
    bspKn,
    sogKn,
    sogDirDeg,
    distanceNm,
    next: stepLatLon(from.lat, from.lon, sogDirDeg, distanceNm),
    motorOn,
  };
}

/** Bidragene til de myke kostnadene fra ett tidssteg. */
export interface SoftContribution {
  readonly dtS: number;
  readonly beatS: number;
  readonly motorS: number;
  readonly nightS: number;
  readonly flags: number;
}

/**
 * **Myk:** akkumulerer kostnadsbidragene fra ett tidssteg. Kan aldri avvise
 * noe — den returnerer bare tall.
 *
 * `Math.round` legges på hvert enkelt bidrag, aldri på summen: da er
 * totalen uavhengig av rekkefølgen bidragene kom i (§4.6).
 */
export function accumulateSoft(
  parent: CostVector,
  contribution: SoftContribution,
): CostVector {
  return {
    tS: parent.tS + Math.round(contribution.dtS),
    beatS: parent.beatS + Math.round(contribution.beatS),
    motorS: parent.motorS + Math.round(contribution.motorS),
    nightS: parent.nightS + Math.round(contribution.nightS),
  };
}

/** Bidragene fra ett steg, gitt kinematikk og miljø. */
export function softContribution(
  kin: StepKinematics,
  env: NodeEnvironment,
  timeStepS: number,
  penaltyS: number,
  beatTwaDeg: number,
): SoftContribution {
  const isBeat = kin.twaDeg < beatTwaDeg;
  let flags = 0;
  if (isBeat) flags |= FLAG_KRYSS;
  if (kin.motorOn) flags |= FLAG_MOTOR;
  if (env.isNight) flags |= FLAG_NATT;
  if (env.windAgainstCurrent) flags |= FLAG_VIND_MOT_STROM;
  return {
    dtS: timeStepS + penaltyS,
    // Straffen er ventetid, ikke seilt tid: kryss/motor/natt akkumulerer
    // bare over selve tidssteget.
    beatS: isBeat ? timeStepS : 0,
    motorS: kin.motorOn ? timeStepS : 0,
    nightS: env.isNight ? timeStepS : 0,
    flags,
  };
}

/**
 * Vind mot strøm (F3.2): strømmen setter mot mer enn 135° fra der vinden
 * blåser. Flagg, ikke kostnad — men det er nettopp den situasjonen som gir
 * kort, bratt sjø, og seileren skal se den.
 */
export function isWindAgainstCurrent(
  wind: WindSample,
  current: CurrentSample | undefined,
): boolean {
  if (current === undefined) return false;
  const currentKn = Math.hypot(current.u, current.v);
  if (currentKn < 0.5) return false;
  const currentTowardDeg = norm360(
    (Math.atan2(current.u, current.v) * 180) / Math.PI,
  );
  const windTowardDeg = norm360(wind.fromDeg + 180);
  return angDiff(currentTowardDeg, windTowardDeg) > 135;
}

/**
 * Kystbufferen bor i `clearance.ts` (R3, besluttet 2026-08-31): kravet
 * håndheves langs **hele korden**, ikke bare i endepunktet, og den samme
 * funksjonen brukes av søket, evaluatoren, konsolideringen, ettersjekken og
 * sluttetappen. Se `checkClearanceCorridor`.
 */

/** **Hard:** kan båten gå i rett linje fra a til b? Motorens dyreste sjekk. */
export function checkSegment(
  mask: NavigabilityMask | undefined,
  a: LatLon,
  b: LatLon,
): HardCheck {
  if (mask === undefined) return HARD_OK;
  const verdict = mask.segmentVerdict(a.lat, a.lon, b.lat, b.lon);
  if (!verdict.passable) {
    return reject(verdict.reason ?? "segmentet er ikke farbart");
  }
  return HARD_OK;
}

export interface TssStepResult {
  readonly check: HardCheck;
  readonly flags: number;
}

/** **Hard:** TSS-retningsregelen, per `tss.ts`. */
export function checkTssStep(
  mask: NavigabilityMask | undefined,
  a: LatLon,
  b: LatLon,
  params: TssRuleParams,
): TssStepResult {
  if (mask === undefined) return { check: HARD_OK, flags: 0 };
  const outcome = applyTssRule(
    mask.tssVerdict(a.lat, a.lon, b.lat, b.lon),
    params,
  );
  switch (outcome.kind) {
    case "ok":
      return { check: HARD_OK, flags: 0 };
    case "reject":
      return { check: reject(outcome.reason), flags: 0 };
    case "along-with-direction":
      return { check: HARD_OK, flags: FLAG_TSS_LANGS };
  }
}

export { MIN_SPEED_KN };
