/**
 * Legal-gate (`docs/specs/vaerpakker.md` §16, N3/N4): `tools/weather-pack`
 * skal IKKE gjøre ekte kall mot MET/THREDDS før
 * `docs/legal/met-norway-*.md` finnes og er markert verifisert. En tredje
 * agent skriver dokumentet parallelt med denne bølgen — denne fila er
 * porten `--live` går gjennom, ikke et sted som antar dokumentets innhold.
 *
 * "Verifisert" gjenkjennes som en linje av formen `Status: verifisert`
 * (samme mønster som andre `docs/legal/*.md`-filer bruker for status —
 * se f.eks. `docs/legal/kartverket-sjokart-raster-wmts.md`s
 * "Status: verifisert..."-linje). Filnavnet er ikke hardkodet til ett
 * eksakt navn — vi leter etter en fil som matcher `met-norway*.md` i
 * `docs/legal/`, siden agenten som skriver den kan velge eksakt navn.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface LegalGateResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly matchedFile: string | undefined;
}

const STATUS_VERIFIED_PATTERN = /status\s*:\s*.*verifisert/i;

/**
 * `docsLegalDir` er `docs/legal/`-mappen (injisert, ikke hardkodet
 * repo-rot-antakelse — gjør funksjonen testbar med en midlertidig mappe).
 */
export function checkLegalGate(docsLegalDir: string): LegalGateResult {
  let entries: string[];
  try {
    entries = readdirSync(docsLegalDir);
  } catch {
    return { ok: false, reason: `Fant ikke mappen ${docsLegalDir}`, matchedFile: undefined };
  }
  const candidate = entries.find((f) => /^met-norway.*\.md$/i.test(f));
  if (!candidate) {
    return {
      ok: false,
      reason:
        "docs/legal/met-norway-*.md finnes ikke ennå — --live nektes inntil MET Norway-vilkårsdokumentet er skrevet (§16)",
      matchedFile: undefined,
    };
  }
  const content = readFileSync(join(docsLegalDir, candidate), "utf8");
  if (!STATUS_VERIFIED_PATTERN.test(content)) {
    return {
      ok: false,
      reason: `${candidate} finnes, men er ikke markert "Status: verifisert" ennå — --live nektes`,
      matchedFile: candidate,
    };
  }
  return { ok: true, reason: `${candidate} funnet og verifisert`, matchedFile: candidate };
}
