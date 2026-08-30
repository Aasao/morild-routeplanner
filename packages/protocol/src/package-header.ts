/**
 * packages/protocol — delt pakkeformat-header for alle datapakker (vær,
 * kart, polar) som publiseres til R2, og semver-kompatibilitetssjekken
 * klienten bruker til å avgjøre om den tør lese en pakke.
 *
 * Grunnlag: docs/00-kravspek.md F2.3 ("Pakkeformat er versjonert (semver);
 * app avviser høyere major med forståelig melding; forrige generasjon
 * beholdes i R2") og F2.4 (alle felt bærer metadata + kildestatus).
 */

/**
 * Ærlig degradering (prinsipp 1 i CLAUDE.md / N2): hva pakken faktisk
 * inneholder, ikke bare hva den skulle inneholde.
 */
export type SourceStatus =
  | { readonly status: "ok" }
  | { readonly status: "degraded"; readonly reason: string };

/**
 * Header alle pakker (vær, kart, polar) deler. Selve nyttelasten er
 * pakke-spesifikk og defineres i den enkelte pakkes eget skjema
 * (packages/weather, packages/charts, packages/polar).
 */
export interface PackageHeader {
  /** Semver for selve pakkeformatet, f.eks. "1.2.0". */
  readonly formatVersion: string;
  /** ISO 8601-tidspunkt pakken ble produsert av batch-jobben. */
  readonly producedAt: string;
  /** Modell/datakilde, f.eks. "MEPS", "NorKyst-800", "Kartverket-N50". */
  readonly model: string;
  /** Modellens/datakildens init-tidspunkt (ISO 8601). */
  readonly init: string;
  /** Romlig oppløsning, f.eks. "2.5km", "500m", "5km" (ensemble). */
  readonly resolution: string;
  /** Hva som faktisk ble levert vs. forventet — vises i UI (N2). */
  readonly sourceStatus: SourceStatus;
}

interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parser en streng-versjon til {major, minor, patch}. Kaster på ugyldig input. */
export function parseSemver(version: string): Semver {
  const match = SEMVER_PATTERN.exec(version);
  const major = match?.[1];
  const minor = match?.[2];
  const patch = match?.[3];
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error(
      `Ugyldig semver "${version}" — forventet formatet MAJOR.MINOR.PATCH`,
    );
  }
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

export type CompatibilityResult =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly reason: string };

/**
 * Sjekker om en pakke med `packageVersion` kan leses trygt av en klient
 * bygget mot pakkeformat `clientFormatVersion`.
 *
 * Regel (F2.3): samme major aksepteres uansett minor/patch (formatet er
 * bakoverkompatibelt innenfor en major); ulik major avvises — klienten
 * kjenner ikke det nye (eller gamle) formatets skjema.
 */
export function checkCompatibility(
  clientFormatVersion: string,
  packageVersion: string,
): CompatibilityResult {
  const client = parseSemver(clientFormatVersion);
  const pkg = parseSemver(packageVersion);

  if (pkg.major !== client.major) {
    return {
      compatible: false,
      reason:
        `Pakkeformat ${packageVersion} (major ${pkg.major}) er ikke ` +
        `kompatibelt med klientens forventede major ${client.major} ` +
        `(klient bygget mot ${clientFormatVersion})`,
    };
  }
  return { compatible: true };
}
