/**
 * Statisk sjekk av import-linjer: packages/geo og packages/routing skal
 * aldri importere fetch/fs/node:-moduler eller andre pakker enn
 * @morild/geo og @morild/protocol.
 *
 * Grunnlag: docs/00-kravspek.md §5 (arkitektur: routing er ren og
 * deterministisk) og docs/01-prosjektplan.md fase 0 ("arkitekturgrense-
 * test: routing-pakken importerer aldri I/O").
 *
 * Bevisst enkel tekstsjekk (regex over import/require-spesifikatorer),
 * ikke en full TS-AST-analyse — nok til å fange feil retning tidlig, og
 * billig å kjøre i CI på hver push (`pnpm test:arch`).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Pakker disse to får lov til å importere fra hverandre/seg selv. */
export const ALLOWED_PACKAGE_IMPORTS: ReadonlySet<string> = new Set([
  "@morild/geo",
  "@morild/protocol",
]);

const FORBIDDEN_SPECIFIER_PATTERNS: readonly RegExp[] = [
  /^node:/,
  /^fs(\/.*)?$/,
  /^path(\/.*)?$/,
  /^http(s)?$/,
  /^child_process$/,
  /^worker_threads$/,
  /^node-fetch$/,
  /^cross-fetch$/,
];

function listTsSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsSourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Trekker ut alle import/require-modulspesifikatorer fra TS-kildekode. */
export function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern = /import\s+(?:type\s+)?(?:[^'";]+from\s+)?["']([^"']+)["']/g;
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const spec = match[1];
    if (spec) specifiers.push(spec);
  }
  for (const match of source.matchAll(requirePattern)) {
    const spec = match[1];
    if (spec) specifiers.push(spec);
  }
  return specifiers;
}

/**
 * Returnerer en feiltekst hvis spesifikatoren bryter grensen, ellers
 * `undefined`.
 *
 * `allowedPackages` lar kalleren parametrisere hvilke `@morild/*`-pakker
 * som er lov (default: geo + protocol, dagens grense for geo/routing/
 * weather). Relative/absolutte stier sjekkes aldri her — de kan likevel
 * fanges av `forbiddenPathFragments` i `checkPackageBoundary`.
 */
export function violatingReason(
  specifier: string,
  allowedPackages: ReadonlySet<string> = ALLOWED_PACKAGE_IMPORTS,
): string | undefined {
  // Relative importer innad i pakken er alltid greit.
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return undefined;
  }
  if (specifier === "fetch") {
    return "importerer fetch direkte";
  }
  for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) {
    if (pattern.test(specifier)) {
      return `importerer forbudt I/O-modul "${specifier}"`;
    }
  }
  if (specifier.startsWith("@morild/") && !allowedPackages.has(specifier)) {
    return `importerer pakke utenfor tillatt grense: "${specifier}"`;
  }
  return undefined;
}

/**
 * Bevisst tekstsjekk mot sti-fragmenter (§5.1, D8.8): fanger BÅDE relative
 * dypimporter (`../routing/src/corridor.js`) og pakkeimporter med dyp sti,
 * uavhengig av om selve pakken/modulen ellers er tillatt.
 */
function violatingFragment(
  specifier: string,
  forbiddenPathFragments: readonly string[],
): string | undefined {
  for (const fragment of forbiddenPathFragments) {
    if (specifier.includes(fragment)) {
      return `importerer forbudt sti-fragment "${fragment}" via "${specifier}"`;
    }
  }
  return undefined;
}

export interface PackageBoundaryOptions {
  /**
   * Default: geo + protocol (dagens grense for geo/routing/weather).
   * `"any"` slår av pakke-grensesjekken helt — brukes for `apps/pwa`, som
   * lovlig importerer mange `@morild/*`-pakker og der vi kun vil håndheve
   * `forbiddenPathFragments`.
   */
  readonly allowedPackages?: ReadonlySet<string> | "any";
  /** Sti-fragmenter som aldri skal forekomme i noen importspesifikator. */
  readonly forbiddenPathFragments?: readonly string[];
}

/**
 * Skanner alle .ts-filer (unntatt *.test.ts) under `srcDir` og returnerer
 * én tekstlinje per brudd (fil + årsak). Tom liste = ingen brudd.
 */
export function checkPackageBoundary(
  srcDir: string,
  options?: PackageBoundaryOptions,
): string[] {
  const allowedPackages = options?.allowedPackages ?? ALLOWED_PACKAGE_IMPORTS;
  const forbiddenPathFragments = options?.forbiddenPathFragments ?? [];
  const violations: string[] = [];
  for (const file of listTsSourceFiles(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const specifier of extractImportSpecifiers(source)) {
      if (allowedPackages !== "any") {
        const reason = violatingReason(specifier, allowedPackages);
        if (reason) {
          violations.push(`${file}: ${reason}`);
        }
      }
      const fragmentReason = violatingFragment(specifier, forbiddenPathFragments);
      if (fragmentReason) {
        violations.push(`${file}: ${fragmentReason}`);
      }
    }
  }
  return violations;
}
