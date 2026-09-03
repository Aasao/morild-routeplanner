/**
 * Dry-run-modus: en syntetisk `FetchLike`-implementasjon (`opendap-client.ts`)
 * som ALDRI gjør et ekte nettverkskall, men returnerer plausible,
 * deterministiske `.dods`-buffere formet akkurat som ekte OPeNDAP index-
 * range-svar (samme URL-mønster som `buildAllMembersDodsUrl` bygger).
 *
 * Brukt av `cli.ts` når `--live` IKKE er satt (standard) og av
 * `pipeline.test.ts` for å teste hele fetch->subset->encode->skriv-kjeden
 * uten nettverk og uten å avhenge av `docs/legal/met-norway-*.md` (§16:
 * ingen ekte kall før legal-gaten åpner).
 *
 * IKKE en erstatning for `packages/weather/fixtures/`s "frosne, EKTE
 * MEPS-testpakke" (§3 punkt 6, §17 pkt. 6) — den skal aldri være syntetisk.
 * Dette er kun weather-packs eget offline utviklings-/CI-spor.
 */
import { encodeSingleVariableDods } from "./dap2.js";
import type { FetchLike } from "./opendap-client.js";

interface ParsedDim {
  readonly start: number;
  readonly stride: number;
  readonly stop: number;
  readonly length: number;
}

const DIM_PATTERN = /\[(\d+):(\d+):(\d+)\]/g;

function parseDims(query: string): ParsedDim[] {
  const dims: ParsedDim[] = [];
  for (const m of query.matchAll(DIM_PATTERN)) {
    const start = Number(m[1]);
    const stride = Number(m[2]);
    const stop = Number(m[3]);
    dims.push({ start, stride, stop, length: Math.floor((stop - start) / stride) + 1 });
  }
  return dims;
}

/**
 * MEPS-lignende akserekkefølge for et 10m-vindfelt: [time][height=1][member][y][x].
 * Genererer en glatt, fysisk plausibel syntetisk verdi per (t,member,y,x) —
 * IKKE tilfeldig støy, slik at interpolasjons-/kvantiseringstester på
 * dry-run-output er meningsfulle (deterministisk gitt samme indekser).
 */
function syntheticWindComponent(
  variable: "x_wind_10m" | "y_wind_10m",
  dims: readonly ParsedDim[],
): number[] {
  const [timeDim, , memberDim, yDim, xDim] = dims;
  if (!timeDim || !memberDim || !yDim || !xDim) {
    throw new Error(`Uventet dimensjonsantall for ${variable}: ${dims.length}`);
  }
  const values: number[] = [];
  for (let ti = 0; ti < timeDim.length; ti++) {
    for (let mi = 0; mi < memberDim.length; mi++) {
      const memberIndex = memberDim.start + mi * memberDim.stride;
      for (let yi = 0; yi < yDim.length; yi++) {
        const yIndex = yDim.start + yi * yDim.stride;
        for (let xi = 0; xi < xDim.length; xi++) {
          const xIndex = xDim.start + xi * xDim.stride;
          const spread = memberIndex === 0 ? 0 : Math.sin(memberIndex * 0.7 + xIndex * 0.05) * 1.5;
          const timeDrift = ti * 0.1;
          const base =
            variable === "x_wind_10m"
              ? 5 + 3 * Math.sin(yIndex * 0.15 + timeDrift)
              : 4 + 3 * Math.cos(xIndex * 0.15 + timeDrift);
          values.push(base + spread);
        }
      }
    }
  }
  return values;
}

export interface DryRunFetchOptions {
  /** Antall medlemmer å simulere (default 30, matcher produksjon). */
  readonly memberCount?: number;
}

/**
 * Bygger en `FetchLike` som svarer på URL-er av formen
 * `<dataset>.dods?<variabel>[t0:1:t1][h0:1:h1][m0:1:m1][y0:1:y1][x0:1:x1]`
 * med en syntetisk `.dods`-buffer i riktig størrelse. Kaster på ukjent
 * variabelnavn (bevisst — dry-run skal ikke late som den dekker felt vi
 * ikke har designet et syntetisk mønster for ennå).
 */
export function createDryRunFetch(options: DryRunFetchOptions = {}): FetchLike {
  // `memberCount` styres i praksis av URL-ens medlemsdimensjon (bygget av
  // `buildAllMembersDodsUrl` — se `syntheticWindComponent`), ikke av denne
  // opsjonen direkte. Feltet finnes i grensesnittet for fremtidig bruk
  // (f.eks. å validere at forespurt antall matcher forventet), ikke fordi
  // det trengs for å generere dataene i denne bølgen.
  void options;
  return async (url: string) => {
    const [, query = ""] = url.split(".dods?");
    const decoded = decodeURIComponent(query);
    const variableMatch = /^([a-zA-Z0-9_]+)/.exec(decoded);
    const variable = variableMatch?.[1];
    const dims = parseDims(decoded);
    if (variable !== "x_wind_10m" && variable !== "y_wind_10m") {
      throw new Error(`Dry-run-fixture har ikke et syntetisk mønster for variabel "${variable}"`);
    }
    const values = syntheticWindComponent(variable, dims);
    const ddsText = `Dataset { Float32 ${variable}[synthetic = ${values.length}]; } ${variable};\n`;
    const buffer = encodeSingleVariableDods(ddsText, values, "Float32");
    return {
      status: 200,
      ok: true,
      // `.slice` på en frisk, ikke-delt Uint8Array gir alltid en ArrayBuffer i praksis —
      // castet trengs kun fordi TS' DOM-lib-typer tillater SharedArrayBuffer generelt.
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    };
  };
}
