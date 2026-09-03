/**
 * Verifiserer MEPS' FAKTISKE Lambert Conformal Conic-projeksjonsparametre
 * (`.das`-attributtene) mot de hardkodede konstantene `lambert-rotation.ts`
 * bruker for griddrelativt→sann-nord-rotasjonen.
 *
 * **Review-funn, fase 3 bølge 2:** `MEPS_LCC_PARAMS` var verifisert ved ETT
 * manuelt `.das`-oppslag 2026-09-03 og deretter frosset i kode.
 * `build-live-package.ts` hentet aldri DDS-en OG `.das`-en — kun DDS
 * (dimensjoner/medlemstelling). Skulle MET noen gang endre grid-definisjonen
 * (ny modellversjon, endret domene/projeksjon), ville pakken fortsatt blitt
 * bygget — med en rotasjon som er feil, en STILLE, voksende
 * retningsskjevhet bort fra sentralmeridianen (se `lambert-rotation.ts`s
 * toppkommentar) som ingen test eller UI-visning ville fanget opp i
 * etterkant. Ærlig degradering (CLAUDE.md-prinsipp 1) krever at dette
 * heller stopper bygget helt enn å levere en pakke med feil geometri.
 *
 * Denne modulen gjør INGEN nettverkskall selv — ren tekst-parsing og
 * sammenligning, kalt fra `build-live-package.ts` med `.das`-teksten den
 * har hentet via den delte `fetchText`/`fetchImpl`-injiseringen.
 */

export interface DasLccAttributes {
  readonly gridMappingName: "lambert_conformal_conic";
  /** `standard_parallel` som skrevet i DAS-en — 1 eller 2 verdier (2 for MEPS' tangent-kjegle, begge 63,3). */
  readonly standardParallelDeg: readonly number[];
  readonly longitudeOfCentralMeridianDeg: number;
  readonly latitudeOfProjectionOriginDeg: number;
  /** Sfærisk jordradius, hvis DAS-en oppgir en (MEPS gjør: 6 371 000 m). */
  readonly earthRadiusM?: number;
  /** Ellipsoide-form, hvis DAS-en oppgir en i stedet for `earth_radius` (ikke sett hos MEPS i dag, men et gyldig CF-alternativ). */
  readonly semiMajorAxisM?: number;
  readonly semiMinorAxisM?: number;
  readonly inverseFlattening?: number;
}

/**
 * DAS-attributt-containere er flate (ingen nested `{}` inni f.eks.
 * `projection_lambert { ... }`) — samme antakelse som resten av
 * `tools/weather-pack`s DAS/DDS-parsing gjør om det formatet MET faktisk
 * leverer (ikke en generell DAS-parser).
 */
const CONTAINER_PATTERN = /(\w+)\s*\{([^{}]*)\}/g;
const GRID_MAPPING_MARKER = /grid_mapping_name\s*"lambert_conformal_conic"/;

function parseFloat64List(block: string, attrName: string): number[] | undefined {
  const m = new RegExp(`Float64\\s+${attrName}\\s+([^;]+);`).exec(block);
  if (!m || m[1] === undefined) return undefined;
  const values = m[1].split(",").map((s) => Number(s.trim()));
  if (values.some((v) => Number.isNaN(v))) return undefined;
  return values;
}

function parseFloat64Scalar(block: string, attrName: string): number | undefined {
  return parseFloat64List(block, attrName)?.[0];
}

/**
 * Finner attributt-containeren med `grid_mapping_name
 * "lambert_conformal_conic"` i en `.das`-tekst og trekker ut LCC-
 * projeksjonsparametrene. Kaster hvis containeren ikke finnes, eller hvis
 * den finnes men mangler et av de påkrevde feltene (`standard_parallel`,
 * `longitude_of_central_meridian`, `latitude_of_projection_origin`) — en
 * container med RIKTIG `grid_mapping_name`, men uten disse, er like
 * uventet som å ikke finne containeren i det hele tatt.
 */
export function parseLccAttributesFromDas(dasText: string): DasLccAttributes {
  CONTAINER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONTAINER_PATTERN.exec(dasText)) !== null) {
    const block = match[2] ?? "";
    if (!GRID_MAPPING_MARKER.test(block)) continue;
    const standardParallelDeg = parseFloat64List(block, "standard_parallel");
    const longitudeOfCentralMeridianDeg = parseFloat64Scalar(block, "longitude_of_central_meridian");
    const latitudeOfProjectionOriginDeg = parseFloat64Scalar(block, "latitude_of_projection_origin");
    if (
      standardParallelDeg === undefined ||
      longitudeOfCentralMeridianDeg === undefined ||
      latitudeOfProjectionOriginDeg === undefined
    ) {
      throw new Error(
        'Fant en attributt-container med grid_mapping_name "lambert_conformal_conic" i .das, men den mangler ' +
          "standard_parallel/longitude_of_central_meridian/latitude_of_projection_origin — uventet DAS-format",
      );
    }
    const earthRadiusM = parseFloat64Scalar(block, "earth_radius");
    const semiMajorAxisM = parseFloat64Scalar(block, "semi_major_axis");
    const semiMinorAxisM = parseFloat64Scalar(block, "semi_minor_axis");
    const inverseFlattening = parseFloat64Scalar(block, "inverse_flattening");
    return {
      gridMappingName: "lambert_conformal_conic",
      standardParallelDeg,
      longitudeOfCentralMeridianDeg,
      latitudeOfProjectionOriginDeg,
      // `exactOptionalPropertyTypes`: kun sett feltet når verdien faktisk
      // finnes, ikke `undefined` eksplisitt.
      ...(earthRadiusM !== undefined ? { earthRadiusM } : {}),
      ...(semiMajorAxisM !== undefined ? { semiMajorAxisM } : {}),
      ...(semiMinorAxisM !== undefined ? { semiMinorAxisM } : {}),
      ...(inverseFlattening !== undefined ? { inverseFlattening } : {}),
    };
  }
  throw new Error(
    'Fant ingen attributt-container med grid_mapping_name "lambert_conformal_conic" i .das-teksten — ' +
      "kan ikke verifisere LCC-rotasjonsparametrene, NEKTER å anta at de hardkodede konstantene fortsatt stemmer",
  );
}

export interface LccDasExpectations {
  readonly standardParallelDeg: readonly [number, number];
  readonly longitudeOfCentralMeridianDeg: number;
  readonly latitudeOfProjectionOriginDeg: number;
  readonly earthRadiusM: number;
}

/**
 * Forventede verdier — de samme MEPS-projeksjonsparametrene som
 * `lambert-rotation.ts::MEPS_LCC_PARAMS` bruker for selve rotasjonen
 * (`standard_parallel`/`longitude_of_central_meridian`), pluss to felt
 * rotasjonsformelen selv ikke trenger, men som likevel verifiseres for å
 * fange enhver uventet endring i kildens grid-definisjon
 * (`latitude_of_projection_origin`, `earth_radius`) — verifisert manuelt
 * 2026-09-03, se `lambert-rotation.ts`s toppkommentar.
 */
export const MEPS_LCC_DAS_EXPECTATIONS: LccDasExpectations = {
  standardParallelDeg: [63.3, 63.3],
  longitudeOfCentralMeridianDeg: 15.0,
  latitudeOfProjectionOriginDeg: 63.3,
  earthRadiusM: 6_371_000.0,
};

const DEG_TOLERANCE = 1e-6;
const RADIUS_TOLERANCE_M = 1;

export interface LccDasVerificationResult {
  readonly ok: boolean;
  readonly parsed: DasLccAttributes;
  readonly mismatches: readonly string[];
}

/**
 * Sammenligner leste `.das`-attributter mot de hardkodede forventningene.
 * Returnerer ALLTID et resultat (kaster aldri selv) — kalleren
 * (`build-live-package.ts`) er ansvarlig for å stoppe bygget hardt ved
 * `ok: false` (ærlig degradering, ikke en advarsel som kan overses).
 */
export function verifyLccDasAttributes(
  parsed: DasLccAttributes,
  expected: LccDasExpectations = MEPS_LCC_DAS_EXPECTATIONS,
): LccDasVerificationResult {
  const mismatches: string[] = [];

  if (parsed.standardParallelDeg.length !== 2) {
    mismatches.push(
      `standard_parallel: forventet 2 verdier ${JSON.stringify(expected.standardParallelDeg)}, fikk ${JSON.stringify(parsed.standardParallelDeg)}`,
    );
  } else {
    const [p1, p2] = parsed.standardParallelDeg as [number, number];
    if (Math.abs(p1 - expected.standardParallelDeg[0]) > DEG_TOLERANCE) {
      mismatches.push(`standard_parallel[0]: forventet ${expected.standardParallelDeg[0]}, fikk ${p1}`);
    }
    if (Math.abs(p2 - expected.standardParallelDeg[1]) > DEG_TOLERANCE) {
      mismatches.push(`standard_parallel[1]: forventet ${expected.standardParallelDeg[1]}, fikk ${p2}`);
    }
  }

  if (Math.abs(parsed.longitudeOfCentralMeridianDeg - expected.longitudeOfCentralMeridianDeg) > DEG_TOLERANCE) {
    mismatches.push(
      `longitude_of_central_meridian: forventet ${expected.longitudeOfCentralMeridianDeg}, fikk ${parsed.longitudeOfCentralMeridianDeg}`,
    );
  }

  if (Math.abs(parsed.latitudeOfProjectionOriginDeg - expected.latitudeOfProjectionOriginDeg) > DEG_TOLERANCE) {
    mismatches.push(
      `latitude_of_projection_origin: forventet ${expected.latitudeOfProjectionOriginDeg}, fikk ${parsed.latitudeOfProjectionOriginDeg}`,
    );
  }

  if (parsed.earthRadiusM === undefined) {
    if (parsed.semiMajorAxisM === undefined) {
      mismatches.push(
        "earth_radius/ellipsoide: fant verken en sfærisk jordradius eller en ellipsoide-akse i .das-attributtene",
      );
    }
    // Ellipsoide-formen brukes ikke av `rotateGridRelativeWindToTrueNorth`
    // i dag (rotasjonsvinkelen avhenger kun av kjeglekonstanten og
    // lengdegrad-differansen, ikke jordform) — vi krever bare at ET
    // jordform-attributt finnes, som dokumentasjon av at antakelsen "MEPS
    // er en sfære" fortsatt er eksplisitt til stede i kilden.
  } else if (Math.abs(parsed.earthRadiusM - expected.earthRadiusM) > RADIUS_TOLERANCE_M) {
    mismatches.push(`earth_radius: forventet ${expected.earthRadiusM} m, fikk ${parsed.earthRadiusM} m`);
  }

  return { ok: mismatches.length === 0, parsed, mismatches };
}
