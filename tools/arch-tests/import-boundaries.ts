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
 */
export function violatingReason(specifier: string): string | undefined {
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
  if (specifier.startsWith("@morild/") && !ALLOWED_PACKAGE_IMPORTS.has(specifier)) {
    return `importerer pakke utenfor tillatt grense: "${specifier}"`;
  }
  return undefined;
}

/**
 * Skanner alle .ts-filer (unntatt *.test.ts) under `srcDir` og returnerer
 * én tekstlinje per brudd (fil + årsak). Tom liste = ingen brudd.
 */
export function checkPackageBoundary(srcDir: string): string[] {
  const violations: string[] = [];
  for (const file of listTsSourceFiles(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const specifier of extractImportSpecifiers(source)) {
      const reason = violatingReason(specifier);
      if (reason) {
        violations.push(`${file}: ${reason}`);
      }
    }
  }
  return violations;
}
