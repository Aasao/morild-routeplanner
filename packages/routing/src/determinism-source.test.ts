/**
 * Determinisme håndhevet **strukturelt**, ikke ved disiplin
 * (docs/specs/rutemotor.md §5.1 og §8.4, ADR-0004 «Bekreftelse» punkt 6).
 *
 * `tools/arch-tests` sjekker i dag *import*-grensen (ingen `node:`, ingen
 * fremmede pakker). Denne testen dekker det andre halve kravet i §8.4: at
 * kildekoden ikke inneholder klokke, tilfeldighet, timere eller `await`.
 *
 * Den bor her framfor i `tools/arch-tests` fordi den er en egenskap ved
 * *denne* pakken, og fordi den da kjører sammen med pakkens øvrige tester.
 * Skal den flyttes opp i arkitekturtestene senere, er regelsettet under det
 * som skal flyttes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = import.meta.dirname;
const GEO_SRC_DIR = join(SRC_DIR, "..", "..", "geo", "src");

/** Mønstre som bryter determinismen, med begrunnelse i feilmeldingen. */
const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bDate\s*\.\s*now\b/, why: "klokke (Date.now)" },
  { pattern: /\bnew\s+Date\b/, why: "klokke (new Date)" },
  { pattern: /\bperformance\s*\.\s*now\b/, why: "klokke (performance.now)" },
  { pattern: /\bMath\s*\.\s*random\b/, why: "tilfeldighet (Math.random)" },
  { pattern: /\bsetTimeout\b/, why: "timer (setTimeout)" },
  { pattern: /\bsetInterval\b/, why: "timer (setInterval)" },
  { pattern: /\bqueueMicrotask\b/, why: "planlegging (queueMicrotask)" },
  { pattern: /\bfetch\s*\(/, why: "I/O (fetch)" },
  { pattern: /\bcrypto\b/, why: "ikke-determinisme (crypto)" },
  { pattern: /\bglobalThis\b/, why: "global tilstand (globalThis)" },
  { pattern: /\bawait\b/, why: "asynkroni (await) — motoren yielder aldri" },
  { pattern: /\basync\s/, why: "asynkroni (async) — motoren yielder aldri" },
  { pattern: /\bfrom\s+["']node:/, why: "node:-import" },
  { pattern: /\bfor\s*\([^)]*\bin\b[^)]*\)/, why: "for…in (nøkkelrekkefølge)" },
];

/**
 * Alle .ts-filer under `dir` som er *motorkode*.
 *
 * Tester og målefiler er unntatt: de skal kunne bruke klokke og seedet
 * tilfeldighet — `perf.bench.ts` måler jo nettopp tid. Skillet er at intet
 * av dette havner på motorens kjørevei.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (extname(entry) !== ".ts") continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".bench.ts")) continue;
    out.push(full);
  }
  return out;
}

/**
 * Fjerner kommentarer og strenger før skanning, slik at ordet «klokka» i en
 * forklarende kommentar ikke feiler testen. Det er *kode* vi sjekker.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

function violationsIn(dir: string): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(dir)) {
    const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(code)) {
        found.push(
          `${file.replace(/\\/g, "/").split("/packages/")[1]}: ${why}`,
        );
      }
    }
  }
  return found;
}

describe("determinisme håndhevet på kildenivå", () => {
  it("packages/routing inneholder verken klokke, tilfeldighet, timere eller await", () => {
    expect(violationsIn(SRC_DIR)).toEqual([]);
  });

  it("packages/geo inneholder det samme", () => {
    expect(violationsIn(GEO_SRC_DIR)).toEqual([]);
  });

  it("skanneren fanger faktiske brudd", () => {
    // Bevis at testen kan feile: den skal reagere på ekte kode …
    const bad = stripCommentsAndStrings("const t = Date.now();");
    expect(FORBIDDEN.some((f) => f.pattern.test(bad))).toBe(true);

    // … og ikke på ordet i en kommentar eller en streng.
    const commented = stripCommentsAndStrings(
      "// aldri Date.now her\nconst s = 'Math.random';",
    );
    expect(FORBIDDEN.some((f) => f.pattern.test(commented))).toBe(false);
  });

  it("dekker faktisk kildefilene (ikke en tom mengde)", () => {
    expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(10);
    expect(sourceFiles(GEO_SRC_DIR).length).toBeGreaterThan(1);
  });
});
