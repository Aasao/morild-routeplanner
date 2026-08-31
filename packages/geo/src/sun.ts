/**
 * Solgeometri — NOAA-algoritmen, ren matematikk.
 *
 * Ingen `Date`, ingen klokke, ingen I/O: all tid kommer inn som
 * epoke-sekunder (UTC) fra kalleren. Det er forutsetningen for at
 * rutemotoren kan bruke natt/dagslys som kostnad og constraint uten å
 * bryte determinismen (docs/specs/rutemotor.md §3 og §5.1).
 *
 * Kilde: NOAA Solar Calculator (regnearkformlene fra Global Monitoring
 * Laboratory), samme formelsett som er standard i solposisjonskode.
 * Nøyaktighet er ~±1 minutt på soloppgang/solnedgang for våre breddegrader,
 * som er innenfor spec-ens ±2 min-krav.
 */

const SECONDS_PER_DAY = 86400;
const MINUTES_PER_DAY = 1440;

/**
 * Solhøyden der øvre solrand står i horisonten (inkludert middels
 * refraksjon). Under denne er det natt, per docs/specs/rutemotor.md §3.
 */
export const HORIZON_ALT_DEG = -0.833;

const degToRad = (deg: number): number => (deg * Math.PI) / 180;
const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Julianske århundrer siden J2000.0 for et gitt epoke-sekund (UTC). */
function julianCenturies(epochS: number): number {
  const julianDay = epochS / SECONDS_PER_DAY + 2440587.5;
  return (julianDay - 2451545) / 36525;
}

interface SolarParams {
  /** Solens deklinasjon i grader. */
  readonly declDeg: number;
  /** Tidsligningen i minutter. */
  readonly eqTimeMin: number;
}

/** NOAAs deklinasjon + tidsligning for et gitt julianske århundre `t`. */
function solarParams(t: number): SolarParams {
  const meanLongDeg = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomDeg = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const anomRad = degToRad(meanAnomDeg);
  const eqCentreDeg =
    Math.sin(anomRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * anomRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * anomRad) * 0.000289;

  const trueLongDeg = meanLongDeg + eqCentreDeg;
  const omegaDeg = 125.04 - 1934.136 * t;
  const appLongDeg =
    trueLongDeg - 0.00569 - 0.00478 * Math.sin(degToRad(omegaDeg));

  const meanObliqDeg =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliqCorrDeg = meanObliqDeg + 0.00256 * Math.cos(degToRad(omegaDeg));

  const declDeg = radToDeg(
    Math.asin(
      Math.sin(degToRad(obliqCorrDeg)) * Math.sin(degToRad(appLongDeg)),
    ),
  );

  const varY = Math.tan(degToRad(obliqCorrDeg / 2)) ** 2;
  const meanLongRad = degToRad(meanLongDeg);
  const eqTimeMin =
    4 *
    radToDeg(
      varY * Math.sin(2 * meanLongRad) -
        2 * eccent * Math.sin(anomRad) +
        4 * eccent * varY * Math.sin(anomRad) * Math.cos(2 * meanLongRad) -
        0.5 * varY * varY * Math.sin(4 * meanLongRad) -
        1.25 * eccent * eccent * Math.sin(2 * anomRad),
    );

  return { declDeg, eqTimeMin };
}

/** Minutter siden midnatt UTC, uten `Date` (negative epoker håndteres). */
function utcMinutesOfDay(epochS: number): number {
  const secondsOfDay =
    ((epochS % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  return secondsOfDay / 60;
}

/** Starten (midnatt UTC) på døgnet som inneholder `epochS`. */
export function utcDayStartS(epochS: number): number {
  return Math.floor(epochS / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

/**
 * Solens høyde over horisonten i grader (uten refraksjonskorreksjon —
 * refraksjonen ligger i terskelen `HORIZON_ALT_DEG`, ikke i formelen).
 */
export function sunAltitudeDeg(
  lat: number,
  lon: number,
  epochS: number,
): number {
  const t = julianCenturies(epochS);
  const { declDeg, eqTimeMin } = solarParams(t);

  // Sann soltid i minutter; 4 min per lengdegrad.
  const trueSolarMin = utcMinutesOfDay(epochS) + eqTimeMin + 4 * lon;
  // Timevinkel: 0 i sann middag. Ingen normalisering trengs — cos er
  // 360°-periodisk og partall, så vinkelen kan gå utenfor [-180, 180].
  const hourAngleRad = degToRad(trueSolarMin / 4 - 180);

  const latRad = degToRad(lat);
  const declRad = degToRad(declDeg);
  const cosZenith =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  return 90 - radToDeg(Math.acos(Math.max(-1, Math.min(1, cosZenith))));
}

/** Soloppgang/solnedgang i epoke-sekunder for døgnet som inneholder `epochS`. */
export interface SunEvents {
  /** undefined ved midnattssol/mørketid. */
  readonly sunriseEpochS: number | undefined;
  /** undefined ved midnattssol/mørketid. */
  readonly sunsetEpochS: number | undefined;
  /** "none" = vanlig døgn, "day" = midnattssol, "night" = mørketid. */
  readonly polar: "none" | "day" | "night";
}

/**
 * Soloppgang og solnedgang (øvre solrand i horisonten, `HORIZON_ALT_DEG`)
 * for UTC-døgnet som inneholder `epochS`.
 *
 * Ved midnattssol/mørketid finnes ingen løsning på timevinkelen; da
 * returneres `undefined` for begge tidspunktene og `polar` sier hvilket
 * av tilfellene det er. Vi later aldri som vi har et tidspunkt vi ikke har
 * (N2, ærlig degradering).
 */
export function sunEventsUtc(
  lat: number,
  lon: number,
  epochS: number,
): SunEvents {
  const dayStartS = utcDayStartS(epochS);
  // Parametrene evalueres ved sann middag på stedet — NOAAs egen framgangsmåte.
  const noonGuessS = dayStartS + (12 * 60 - 4 * lon) * 60;
  const { declDeg, eqTimeMin } = solarParams(julianCenturies(noonGuessS));

  const latRad = degToRad(lat);
  const declRad = degToRad(declDeg);
  const cosHourAngle =
    Math.cos(degToRad(90 - HORIZON_ALT_DEG)) /
      (Math.cos(latRad) * Math.cos(declRad)) -
    Math.tan(latRad) * Math.tan(declRad);

  if (cosHourAngle > 1) {
    return { sunriseEpochS: undefined, sunsetEpochS: undefined, polar: "night" };
  }
  if (cosHourAngle < -1) {
    return { sunriseEpochS: undefined, sunsetEpochS: undefined, polar: "day" };
  }

  const hourAngleDeg = radToDeg(Math.acos(cosHourAngle));
  const sunriseMin = 720 - 4 * (lon + hourAngleDeg) - eqTimeMin;
  const sunsetMin = 720 - 4 * (lon - hourAngleDeg) - eqTimeMin;

  return {
    sunriseEpochS: refineHorizonCrossing(
      lat,
      lon,
      dayStartS + sunriseMin * 60,
      true,
    ),
    sunsetEpochS: refineHorizonCrossing(
      lat,
      lon,
      dayStartS + sunsetMin * 60,
      false,
    ),
    polar: "none",
  };
}

/**
 * NOAAs lukkede uttrykk evaluerer deklinasjon og tidsligning ved sann
 * middag, ikke i selve horisontpasseringen. Restfeilen er ~0,1° i solhøyde,
 * som ved høy breddegrad i juni er flere minutter i tid. Vi refinerer derfor
 * med ren bisekt på `sunAltitudeDeg` til horisontpasseringen er eksakt.
 *
 * Bisekt er valgt framfor Newton fordi den er ubetinget konvergent og har
 * fast antall iterasjoner — determinisme uten avhengighet av startgjettet.
 */
function refineHorizonCrossing(
  lat: number,
  lon: number,
  guessS: number,
  rising: boolean,
): number {
  const windowS = 3600;
  const f = (t: number): number =>
    (rising ? 1 : -1) * (sunAltitudeDeg(lat, lon, t) - HORIZON_ALT_DEG);

  let lo = guessS - windowS;
  let hi = guessS + windowS;
  if (f(lo) > 0 || f(hi) < 0) {
    // Ingen tegnskifte i vinduet — behold NOAA-estimatet i stedet for å
    // returnere et tall vi ikke kan begrunne.
    return guessS;
  }
  // 24 halveringer av 7200 s gir under 0,5 ms oppløsning.
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Er det mørkt (solhøyde under horisonten) i punktet på tidspunktet? */
export function isNightAt(
  lat: number,
  lon: number,
  epochS: number,
): boolean {
  return sunAltitudeDeg(lat, lon, epochS) < HORIZON_ALT_DEG;
}

export { MINUTES_PER_DAY, SECONDS_PER_DAY };
