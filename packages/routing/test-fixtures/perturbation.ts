/**
 * **Perturbasjonsfamilien** for E1′-fiksturene som ikke har egen fysikk
 * (S-1, S-2, S-4): måleplanens §2 — «kontrollfelt + seedede deterministiske
 * perturbasjoner (tidsskyv, rotasjon, skalering)».
 *
 * Tre parametre per medlem:
 *
 *  - **tidsskyv** — medlemmet leser kontrollfeltet `Δt` tidligere eller senere.
 *    På et felt som varierer i tid er det en fase-usikkerhet; på et konstant
 *    felt gjør den ingenting, og det er riktig (S-2 er per konstruksjon
 *    tidsuavhengig).
 *  - **rotasjon** — hele vindfeltet dreies. Det er den perturbasjonen som
 *    betyr mest for en seilbåt, og den som gir S-2 sin 20–30° dreining over
 *    medlemmene (måleplanens §2).
 *  - **skalering** — vindstyrken skaleres, og sjøen med den. Koblingen
 *    `hsSkala = fartSkala^1.5` er den grove empiriske sammenhengen mellom
 *    vindstyrke og fullt utviklet sjø; poenget er ikke presisjon, men at et
 *    medlem med mer vind ikke samtidig har mindre sjø.
 *
 * **Kjent begrensning, som skal stå i rapporten:** familien er *unimodal*.
 * Den kan ikke produsere den topologiske splitten som skiller variantene der
 * det gjelder mest — det er nettopp derfor S-7 finnes (måleplanens §6.2).
 *
 * Ren og deterministisk: tabellen bygges én gang fra `mulberry32` med fast
 * seed, og feltet er en funksjon uten tilstand.
 */
import type { WeatherField } from "../src/index.js";
import { norm360 } from "@morild/geo";
import { mulberry32 } from "./seeded-random.js";

export interface Perturbation {
  /** Sekunder. Positivt = medlemmet ser feltet slik det var senere. */
  readonly timeShiftS: number;
  /** Grader. Hele vindfeltet dreies med denne. */
  readonly rotationDeg: number;
  /** Multiplikator på vindstyrken. */
  readonly speedScale: number;
  /** Multiplikator på `Hs`. Utledet av `speedScale`. */
  readonly hsScale: number;
}

/**
 * Feltet et perturbert medlem ser.
 *
 * Gyldighetsvinduet flyttes **med** skyvet: et medlem som leser feltet 9 t
 * fram i tid, har 9 t mindre dekning i den enden. Vi later aldri som om et
 * skjøvet felt dekker mer enn kilden gjør (N2 — ærlig degradering).
 */
export function perturbedField(
  base: WeatherField,
  p: Perturbation,
): WeatherField {
  const shift = (epochS: number): number => epochS + p.timeShiftS;
  return {
    wind(lat, lon, epochS) {
      const w = base.wind(lat, lon, shift(epochS));
      if (w === undefined) return undefined;
      return {
        speedKn: w.speedKn * p.speedScale,
        fromDeg: norm360(w.fromDeg + p.rotationDeg),
      };
    },
    waves(lat, lon, epochS) {
      const s = base.waves(lat, lon, shift(epochS));
      if (s === undefined) return undefined;
      return {
        hsM: s.hsM * p.hsScale,
        ...(s.tpS === undefined ? {} : { tpS: s.tpS }),
        ...(s.fromDeg === undefined
          ? {}
          : { fromDeg: norm360(s.fromDeg + p.rotationDeg) }),
      };
    },
    current(lat, lon, epochS) {
      return base.current(lat, lon, shift(epochS));
    },
    maxTwsKn: base.maxTwsKn * p.speedScale,
    maxCurrentKn: base.maxCurrentKn,
    // Perturbasjonen skalerer vinden, ikke pakkeformatet: dekodefeilen er
    // basefeltets, skalert med samme faktor som farten den er en feil på.
    maxDecodeErrorKn: base.maxDecodeErrorKn * p.speedScale,
    validFromS: base.validFromS - p.timeShiftS,
    validToS: base.validToS - p.timeShiftS,
    header: base.header,
  };
}

export interface PerturbationSpread {
  /** Maks tidsskyv i timer (±). */
  readonly timeShiftH: number;
  /** Maks rotasjon i grader (±). */
  readonly rotationDeg: number;
  /** Maks relativ skalering (± rundt 1). */
  readonly speedScale: number;
}

/**
 * Medlemstabellen: `count` perturbasjoner fra én fast seed.
 *
 * Tabellen materialiseres **én gang** og er dermed data, ikke en generator —
 * to konstruksjoner gir bit-identiske medlemmer, som `ensembleDigest`-testene
 * krever. Ingen perturbasjon er identiteten: kontrollfeltet skal ikke ha et
 * medlem som er identisk med seg selv (`ensemble.ts`).
 */
export function perturbationTable(
  seed: number,
  count: number,
  spread: PerturbationSpread,
): readonly Perturbation[] {
  const rnd = mulberry32(seed);
  const out: Perturbation[] = [];
  for (let i = 0; i < count; i++) {
    // Trekk i [-1, 1], med et lite gulv på magnituden slik at ingen medlem
    // kollapser til kontrollfeltet.
    const pick = (): number => {
      const u = rnd() * 2 - 1;
      return Math.sign(u) * (0.15 + 0.85 * Math.abs(u));
    };
    const speedScale = 1 + pick() * spread.speedScale;
    out.push({
      timeShiftS: Math.round(pick() * spread.timeShiftH * 3600),
      rotationDeg: Math.round(pick() * spread.rotationDeg * 100) / 100,
      speedScale: Math.round(speedScale * 10000) / 10000,
      hsScale: Math.round(speedScale ** 1.5 * 10000) / 10000,
    });
  }
  return Object.freeze(out.map((p) => Object.freeze(p)));
}
