import { describe, expect, it } from "vitest";
import {
  MEPS_LCC_DAS_EXPECTATIONS,
  parseLccAttributesFromDas,
  verifyLccDasAttributes,
} from "./das-verification.js";

/**
 * Trimmet, men strukturelt ekte utdrag av `.das`-formatet MEPS faktisk
 * returnerer (`tools/spikes/thredds/out-meps-latest.das`, hentet
 * 2026-09-03) — flat attributt-container-syntaks, ingen nesting inni hver
 * `navn { ... }`-blokk.
 */
function realMepsDasFixture(overrides: {
  readonly standardParallel?: string;
  readonly centralMeridian?: string;
  readonly projectionOrigin?: string;
  readonly earthRadius?: string | null;
} = {}): string {
  const standardParallel = overrides.standardParallel ?? "63.3, 63.3";
  const centralMeridian = overrides.centralMeridian ?? "15.0";
  const projectionOrigin = overrides.projectionOrigin ?? "63.3";
  const earthRadiusLine =
    overrides.earthRadius === null
      ? ""
      : `        Float64 earth_radius ${overrides.earthRadius ?? "6371000.0"};\n`;
  return `Attributes {
    time {
        String long_name "time";
        String standard_name "time";
        String units "seconds since 1970-01-01 00:00:00 +00:00";
        UInt32 _ChunkSizes 512;
    }
    ensemble_member {
        String long_name "ensemble run number";
        String standard_name "realization";
    }
    projection_lambert {
        String grid_mapping_name "lambert_conformal_conic";
        Float64 standard_parallel ${standardParallel};
        Float64 longitude_of_central_meridian ${centralMeridian};
        Float64 latitude_of_projection_origin ${projectionOrigin};
${earthRadiusLine}    }
    x {
        String long_name "x-coordinate in Cartesian system";
        String units "m";
        String standard_name "projection_x_coordinate";
        String grid_mapping "projection_lambert";
    }
}
`;
}

describe("parseLccAttributesFromDas", () => {
  it("parser standard_parallel/longitude_of_central_meridian/latitude_of_projection_origin/earth_radius fra en ekte-formet .das", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture());
    expect(attrs.gridMappingName).toBe("lambert_conformal_conic");
    expect(attrs.standardParallelDeg).toEqual([63.3, 63.3]);
    expect(attrs.longitudeOfCentralMeridianDeg).toBe(15.0);
    expect(attrs.latitudeOfProjectionOriginDeg).toBe(63.3);
    expect(attrs.earthRadiusM).toBe(6_371_000.0);
  });

  it("kaster hvis DAS-en ikke har noen lambert_conformal_conic-container i det hele tatt", () => {
    const noProjection = `Attributes {
    time {
        String standard_name "time";
    }
}
`;
    expect(() => parseLccAttributesFromDas(noProjection)).toThrow(/lambert_conformal_conic/);
  });

  it("kaster hvis containeren finnes, men mangler et påkrevd felt", () => {
    const missingMeridian = `Attributes {
    projection_lambert {
        String grid_mapping_name "lambert_conformal_conic";
        Float64 standard_parallel 63.3, 63.3;
        Float64 latitude_of_projection_origin 63.3;
    }
}
`;
    expect(() => parseLccAttributesFromDas(missingMeridian)).toThrow(/mangler/);
  });

  it("earth_radius er valgfri i parseren selv (verifiseringen, ikke parsingen, krever et jordform-attributt)", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture({ earthRadius: null }));
    expect(attrs.earthRadiusM).toBeUndefined();
  });
});

describe("verifyLccDasAttributes — match", () => {
  it("er ok:true og uten mismatches for verdier identiske med MEPS_LCC_DAS_EXPECTATIONS", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture());
    const result = verifyLccDasAttributes(attrs);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("bruker default-forventningene (MEPS_LCC_DAS_EXPECTATIONS) når ingen eksplisitt forventning oppgis", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture());
    const result = verifyLccDasAttributes(attrs, MEPS_LCC_DAS_EXPECTATIONS);
    expect(result.ok).toBe(true);
  });
});

describe("verifyLccDasAttributes — mismatch (hard-feil-grunnlaget)", () => {
  it("oppdager avvikende longitude_of_central_meridian", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture({ centralMeridian: "20.0" }));
    const result = verifyLccDasAttributes(attrs);
    expect(result.ok).toBe(false);
    expect(result.mismatches.some((m) => m.includes("longitude_of_central_meridian"))).toBe(true);
  });

  it("oppdager avvikende standard_parallel (asymmetrisk kjegle — ikke lenger MEPS' tangent-kjegle)", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture({ standardParallel: "60.0, 66.0" }));
    const result = verifyLccDasAttributes(attrs);
    expect(result.ok).toBe(false);
    expect(result.mismatches.some((m) => m.includes("standard_parallel"))).toBe(true);
  });

  it("oppdager avvikende latitude_of_projection_origin", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture({ projectionOrigin: "65.0" }));
    const result = verifyLccDasAttributes(attrs);
    expect(result.ok).toBe(false);
    expect(result.mismatches.some((m) => m.includes("latitude_of_projection_origin"))).toBe(true);
  });

  it("oppdager avvikende earth_radius", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture({ earthRadius: "6378137.0" }));
    const result = verifyLccDasAttributes(attrs);
    expect(result.ok).toBe(false);
    expect(result.mismatches.some((m) => m.includes("earth_radius"))).toBe(true);
  });

  it("flagger manglende jordform (verken earth_radius eller semi_major_axis) som et avvik", () => {
    const attrs = parseLccAttributesFromDas(realMepsDasFixture({ earthRadius: null }));
    const result = verifyLccDasAttributes(attrs);
    expect(result.ok).toBe(false);
    expect(result.mismatches.some((m) => m.includes("earth_radius/ellipsoide"))).toBe(true);
  });

  it("samler ALLE avvik i én rapport, ikke bare det første", () => {
    const attrs = parseLccAttributesFromDas(
      realMepsDasFixture({ centralMeridian: "20.0", projectionOrigin: "65.0" }),
    );
    const result = verifyLccDasAttributes(attrs);
    expect(result.ok).toBe(false);
    expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
  });

  it("toleranse: mikroskopiske flyttallsavvik (langt under 1e-6°) er IKKE et mismatch", () => {
    const attrs = parseLccAttributesFromDas(
      realMepsDasFixture({ centralMeridian: String(15.0 + 1e-9) }),
    );
    const result = verifyLccDasAttributes(attrs);
    expect(result.ok).toBe(true);
  });
});
