/**
 * MEPS' native grid er Lambert Conformal Conic (`projection_lambert` i
 * DAS-attributtene, verifisert live 2026-09-03: `grid_mapping_name
 * "lambert_conformal_conic"`, `standard_parallel 63.3, 63.3`,
 * `longitude_of_central_meridian 15.0`). `x_wind_10m`/`y_wind_10m` har
 * `standard_name "x_wind"`/`"y_wind"` — CF-konvensjonen definerer disse som
 * komponenter langs GRIDDENS EGNE x/y-akser, IKKE nødvendigvis sann
 * øst/nord (det ville vært `eastward_wind`/`northward_wind`). For et
 * regulært lat/lon-grid faller grid-akser og sanne akser sammen; for et
 * Lambert-projisert grid gjør de det KUN på sentralmeridianen (15°Ø her).
 *
 * **Dette er en reell, tidligere udokumentert konvensjonsfelle** (samme
 * kategori CLAUDE.md advarer om — "v1 hadde subtile konvensjonsfeller
 * her"), oppdaget under bølge 2A ved å inspisere DAS-attributtene til den
 * ekte kjøringen, IKKE en antakelse. Uten denne rotasjonen ville
 * `packages/weather::uvToWind` (som forutsetter u=sann øst, v=sann nord,
 * §3) fått en retningsskjevhet som VOKSER med avstand fra 15°Ø — i
 * Skjæløy–Skagen-bboxen (8,0–12,6°Ø) opptil ca. 6,3° ved vestkanten (målt
 * med formelen under, se `lambert-rotation.test.ts`).
 *
 * **Verifisert EMPIRISK at effekten er reell, men LITEN sammenlignet med
 * andre avvik:** et direkte punktsammenligning 2026-09-03 mot
 * api.met.no Locationforecast (som allerede leverer sann-nord-referert
 * vind) ved Skagen (57,7178°N, 10,5854°Ø) viste et STØRRE avvik (ca. 39°,
 * 215,6° rå vs. 255° Locationforecast) enn selve rotasjonskorreksjonen
 * alene forklarer (rotasjonen her flytter kun retningen fra 215,6° til
 * 211,7° — ca. 4° ved dette punktet, og BEVEGER seg bort fra, ikke mot,
 * Locationforecast-tallet). Konklusjon: hoveddelen av avviket mot
 * Locationforecast skyldes at Yr/Locationforecast er et etterbehandlet/
 * blandet produkt (nedskalert, mulig annen kjøring/blanding av modeller),
 * IKKE en feil i denne rotasjonsformelen — men selve rotasjonen er likevel
 * korrekt å gjøre, og var IKKE gjort før denne bølgen. Se
 * `docs/research/pakkestoerrelse-ekte-2026-09-03.md` for hele
 * utledningen og tallene.
 *
 * Formelen er den samme "meridian convergence"-formelen brukt i
 * WRF/NCL-økosystemet for å rotere LCC-projiserte vindkomponenter til sann
 * nord (`wrf-python`s `uvmet`, portert fra NCL `wrf_uvmet`) — ikke
 * MET-spesifikk, men en generell, veldokumentert kartprojeksjonsformel for
 * denne projeksjonstypen.
 */

export interface LccProjectionParams {
  /** `standard_parallel` (kan være likt for en tangent-kjegle, som MEPS). */
  readonly standardParallel1Deg: number;
  readonly standardParallel2Deg: number;
  /** `longitude_of_central_meridian`. */
  readonly centralMeridianDeg: number;
}

/** MEPS' faktiske projeksjonsparametre, verifisert via `.das`-oppslag 2026-09-03 (se filens header). */
export const MEPS_LCC_PARAMS: LccProjectionParams = {
  standardParallel1Deg: 63.3,
  standardParallel2Deg: 63.3,
  centralMeridianDeg: 15.0,
};

const DEG2RAD = Math.PI / 180;

/**
 * Kjeglekonstanten `n` for en Lambert Conformal Conic-projeksjon. For en
 * tangent-kjegle (samme standardparallell to ganger, som MEPS' 63,3/63,3)
 * er dette grenseverdien `sin(standardparallell)` av den generelle
 * to-standardparallell-formelen (som ellers gir 0/0).
 */
export function lccConeConstant(params: LccProjectionParams): number {
  const { standardParallel1Deg: p1, standardParallel2Deg: p2 } = params;
  if (p1 === p2) {
    return Math.sin(p1 * DEG2RAD);
  }
  const num = Math.log(Math.cos(p1 * DEG2RAD)) - Math.log(Math.cos(p2 * DEG2RAD));
  const den =
    Math.log(Math.tan((45 - Math.abs(p1) / 2) * DEG2RAD)) -
    Math.log(Math.tan((45 - Math.abs(p2) / 2) * DEG2RAD));
  return num / den;
}

/**
 * Meridiankonvergensvinkelen (radianer) — vinkelen mellom griddens nord og
 * sann nord ved en gitt lengdegrad. Null på sentralmeridianen, vokser
 * lineært med avstanden fra den (skalert med kjeglekonstanten).
 */
export function lccConvergenceAngleRad(lonDeg: number, params: LccProjectionParams): number {
  let diff = lonDeg - params.centralMeridianDeg;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  const cone = lccConeConstant(params);
  const hemisphereSign = params.standardParallel1Deg >= 0 ? 1 : -1;
  return diff * cone * DEG2RAD * hemisphereSign;
}

/**
 * Roterer et griddrelativt (u,v)-par (langs griddens x/y-akser) til sanne
 * øst/nord-komponenter. Bevarer alltid vektorlengden (fart) eksakt — kun
 * retningen endres. Formelen er identisk med WRF-python `uvmet`s rotasjon.
 */
export function rotateGridRelativeWindToTrueNorth(
  uGrid: number,
  vGrid: number,
  lonDeg: number,
  params: LccProjectionParams = MEPS_LCC_PARAMS,
): readonly [uTrue: number, vTrue: number] {
  const alpha = lccConvergenceAngleRad(lonDeg, params);
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const uTrue = uGrid * cosA + vGrid * sinA;
  const vTrue = vGrid * cosA - uGrid * sinA;
  return [uTrue, vTrue];
}
