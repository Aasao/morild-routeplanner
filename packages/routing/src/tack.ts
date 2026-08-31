/**
 * Bautstraff (docs/specs/rutemotor.md §5.3.1, ADR-0004 avvik 3).
 *
 * v1 hadde en flat `+90 s` ved kursendring > 15°. v2 skiller manøver fra
 * halsbytte: en 30°-justering på samme hals koster ikke det samme som en
 * bautt gjennom vinden.
 *
 * Kalibrering: `tackBaseS = 60` + `manoeuvreBaseS · f(90°) = 30` gir
 * nøyaktig **90 s** for v1s typiske tilfelle (en 90°-bautt). Det er bevisst,
 * slik at golden-diffene mot v1 blir tolkbare i stedet for å drukne i en ny
 * konstant.
 */
import { angDiff, norm180 } from "@morild/geo";

/** Halseside: -1 babord, +1 styrbord, 0 = ikke bidevind. */
export type Tack = -1 | 0 | 1;

export interface TackPenaltyParams {
  /** Kursendringer under denne regnes som ren styring, ikke manøver. */
  readonly minorCourseChangeDeg: number;
  /** Grunnkost for selve manøveren, skalert med |Δkurs|. */
  readonly manoeuvreBaseS: number;
  /** Tillegg når halsen skifter (babord ↔ styrbord). */
  readonly tackBaseS: number;
}

export const DEFAULT_TACK_PARAMS: TackPenaltyParams = Object.freeze({
  minorCourseChangeDeg: 15,
  manoeuvreBaseS: 30,
  tackBaseS: 60,
});

/**
 * Halsesiden gitt kurs og vindretning (FRA).
 *
 * `tack = sign(norm180(heading − (windFrom + 180)))` — altså hvilken side av
 * vindaksen båten ligger på. Utenfor bidevind (TWA ≥ `beatTwaDeg`) er halsen
 * 0: da er den ikke en meningsfull tilstandsegenskap for straffen.
 *
 * Halsen er bevisst **ikke** en nøkkeldimensjon (§4.4) — den er en
 * deterministisk funksjon av kurs og vind, og å nøkle på den ville duplisert
 * tilstander uten å skille dem.
 */
export function tackOf(
  headingDeg: number,
  windFromDeg: number,
  beatTwaDeg: number,
): Tack {
  const twa = angDiff(windFromDeg, headingDeg);
  if (twa >= beatTwaDeg) return 0;
  const rel = norm180(headingDeg - (windFromDeg + 180));
  if (rel > 0) return 1;
  if (rel < 0) return -1;
  return 0;
}

/**
 * Straffen i sekunder for å gå fra `fromHeadingDeg` til `toHeadingDeg`.
 *
 * `twsKn` er med i signaturen fordi bauting i lite vind koster mer fart enn
 * i frisk bris. **Koblingen er ikke aktivert i v2.0** (faktor 1,0): vi har
 * ikke kalibreringsdata for den ennå (F3.3-loggene). Parameteren står der
 * for at kalibreringsbølgen skal slippe å endre kallsteder.
 */
export function tackPenaltyS(
  fromHeadingDeg: number,
  toHeadingDeg: number,
  fromTack: Tack,
  toTack: Tack,
  twsKn: number,
  params: TackPenaltyParams = DEFAULT_TACK_PARAMS,
): number {
  void twsKn;
  const delta = angDiff(fromHeadingDeg, toHeadingDeg);
  if (delta <= params.minorCourseChangeDeg) return 0;
  // f(x) = x/90, avkortet til [0, 2]: 180° koster dobbelt av 90°.
  const shape = Math.min(2, Math.max(0, delta / 90));
  const manoeuvre = params.manoeuvreBaseS * shape;
  const tackChange = fromTack !== 0 && toTack !== 0 && fromTack !== toTack;
  return Math.round(manoeuvre + (tackChange ? params.tackBaseS : 0));
}
