/**
 * **Navigasjonsfellen i S-3** — måleplanens §8.2 (M2, vedtatt av Magnus kvelden
 * 2026-08-31, FØR kjøring).
 *
 * Begrunnelsen for at dette medlemmet må finnes, er skarp: felle-settet i S-3
 * slik det stod, oppstod utelukkende via **delt kode** (`checkHardNode` →
 * `boatLimits` → alle havner utenfor rekkevidde). Alle tre målevariantene
 * kaller den samme koden, så «identisk felle-sett» hadde null
 * diskrimineringskraft — kriteriet ville vært oppfylt uansett hvor dårlig en
 * variant var. Dette medlemmet gjør kriteriet skarpt: her er **utveien**, ikke
 * feilen, det variantene er uenige om.
 *
 * ## Konstruksjonen
 *
 * Medlemmet er en sørvestlig full storm over Skagerrak, uten front:
 *
 *  - **Vind:** 32 kn fra 250°, homogent. Under båtens `maxTwsKn = 35`, så
 *    forkastelsen er utvetydig sjøgang — som i resten av S-3.
 *  - **Sjø:** `Hs` vokser sørover gjennom en logistisk overgang sentrert på
 *    58,99° N. Terskelen `Hs = 4,0 m` (båtens `maxHsM`) ligger på **58,93° N**,
 *    altså like sør for det andre punktet på kandidatruten. Båten møter veggen
 *    etter ~2,2 t og står da på 59,01° N.
 *  - **Le bak Hvaler:** en gaussisk skjerming med 3 nm radius rundt
 *    Fredrikstad. Fysisk er det Glomma-osen innenfor skjærgården; matematisk er
 *    det det som gjør at Fredrikstad (`maxHsM = 2,0`) er den **eneste** havnen
 *    som ikke diskvalifiseres av sjøen.
 *
 * Værmessig står da dette igjen (målt, ikke antatt — se
 * `ensemble-fixtures.test.ts`):
 *
 * | havn | avstand fra feilpunktet | dom |
 * |---|---|---|
 * | Skjæløy | 5,9 nm | Hs 3,25 m > 2,5 m **og** pålandsvind 32 kn > 30 kn |
 * | Fredrikstad | 12,2 nm | anløpbar (Hs 0,73 m; 250° utenfor 145–235°) |
 * | Strömstad | 10,5 nm | Hs 3,98 m > 2,5 m **og** pålandsvind 32 > 30 kn |
 * | Fjällbacka | 28,0 nm | Hs 4,98 m > 2,5 m |
 * | resten | ≥ 41 nm | for langt / innelåst i land |
 *
 * ## Den navigasjonsmessige sperren
 *
 * `SKAGERRAK_LANE` er en syntetisk trafikkseparasjon som ligger **langs**
 * kandidatruten (ledakse 200°, altså SSV mot Skagen). Den er per konstruksjon
 * inert for alt S-3 gjorde før: kandidatruten seiler 190–200°, altså *med*
 * trafikkretningen, og både kontrollruten og felle-settet {m04, m09, m14} er
 * bit-identiske med og uten leden (verifisert 2026-08-31, `variants.test.ts`).
 *
 * Men den er ikke inert for **utveien**. TSS-regelen (`tss.ts`) tillater bare
 * to ting inne i leden: å følge den med retningen (kurs innenfor ±45° av 200°)
 * eller å krysse den på minst 60° mot ledaksen. Å snu nordover mot Skjæløy og
 * Fredrikstad er «langs leden, mot trafikkretningen» — **hard avvisning**.
 * Nødhavnen ligger altså rett nord, og den rette linjen dit er stengt av en
 * regel, ikke av vær.
 *
 * ## Utveien (målt, fullt Pareto-re-søk, 2026-08-31)
 *
 * Fra (59,011° N, 10,868° Ø) kl. 1,2 t etter avgang:
 *
 * ```
 *  t=0,00  59,011 10,868  —          (feilpunktets siste lovlige tilstand)
 *  t=1,00  59,011 11,062  kurs 090°  ← krysser leden på tvers, ØSTOVER, bort fra havnen
 *  t=2,00  59,076 11,211  kurs 050°  ← ut av leden, videre nordøst i renna mot Bohuslän
 *  t=3,01  59,160 11,116  kurs 330°  ← nord for leden: nå er nordkurs lovlig
 *  t=4,01  59,231 11,000  kurs 320°
 *  t=4,35  59,210 10,950  kurs 231°  ← inn til Fredrikstad, siste stykke på kryss
 * ```
 *
 * 25,4 nm og **4,35 t** — innenfor 6 t-skranken med 1,65 t margin. Utveien er
 * ikke opplagt: den går først **østover, vekk fra havnen**, og det største
 * avviket fra rettlinjen feilpunkt→Fredrikstad er **9,56 nm**. Variant Bs rør
 * er 4 nm; utveien får ikke plass i det, og B dømmer medlemmet som felle mens
 * fasiten ikke gjør det. Det er nøyaktig den diskrimineringskraften §8.2 ber
 * om.
 *
 * Utvei-margin (§8.1s deskriptive kolonne): minste avstand til den harde
 * grensen langs fluktruten er **0,34 m Hs** (3,66 m mot taket på 4,0 m).
 *
 * Rent og deterministisk som resten av testgrunnlaget: ingen RNG, ingen
 * klokke, ingen I/O.
 */
import type { LatLon } from "@morild/geo";
import type { WeatherField } from "../src/index.js";
import type { TssCorridor } from "./synthetic-mask.js";
import { SYNTHETIC_HEADER } from "./synthetic-weather.js";

/**
 * Syntetisk trafikkseparasjon langs Skjæløy→Skagen. Ledaksen 200° er
 * kandidatrutens egen kurs, slik at ruten seiler med trafikken; utveien
 * nordover gjør det ikke.
 *
 * Østgrensen 11,10° Ø er valgt bevisst: renna mellom leden og Bohuslän-kysten
 * (11,35° Ø) er da 7,7 nm bred — bred nok til at det *finnes* en utvei, smal
 * nok til at den ligger langt utenfor et 4 nm rør rundt rettlinjen.
 */
export const SKAGERRAK_LANE: TssCorridor = Object.freeze({
  latMin: 58.6,
  latMax: 59.15,
  lonMin: 10.6,
  lonMax: 11.1,
  axisDeg: 200,
  reason: "Skagerrak-led (syntetisk TSS)",
});

/** Fredrikstad — den eneste anløpbare havnen i dette medlemmet. */
const FREDRIKSTAD: LatLon = Object.freeze({ lat: 59.21, lon: 10.95 });

/** Vindstyrke og retning i medlemmet. Under båtens `maxTwsKn`. */
export const NAV_TRAP_WIND = Object.freeze({ speedKn: 32, fromDeg: 250 });

/** Logistikkens senter i breddegrad; `Hs = 4,0 m` treffer på 58,931° N. */
const HS_CENTER_LAT = 58.99;
const HS_SCALE_DEG = 0.18;
const HS_FLOOR_M = 2.2;
const HS_RANGE_M = 3.1;
/** Skjermingens radius rundt Fredrikstad i nm, og hvor mye den demper. */
const SHELTER_RADIUS_NM = 3;
const SHELTER_DEPTH = 0.75;

/** Flat avstand i nm — samme metrikk som resten av testgrunnlaget. */
function flatNm(a: LatLon, b: LatLon): number {
  const north = (b.lat - a.lat) * 60;
  const east = (b.lon - a.lon) * 60 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(north, east);
}

/** Signifikant bølgehøyde i punktet. Eksponert fordi testene må påvise den. */
export function navTrapHsM(lat: number, lon: number): number {
  const base =
    HS_FLOOR_M + HS_RANGE_M / (1 + Math.exp((lat - HS_CENTER_LAT) / HS_SCALE_DEG));
  const shelter =
    1 -
    SHELTER_DEPTH *
      Math.exp(-((flatNm({ lat, lon }, FREDRIKSTAD) / SHELTER_RADIUS_NM) ** 2));
  return base * shelter;
}

export interface NavTrapWeatherOptions {
  readonly validFromS: number;
  readonly validToS: number;
}

export function navTrapWeather(o: NavTrapWeatherOptions): WeatherField {
  const inTime = (epochS: number): boolean =>
    epochS >= o.validFromS && epochS <= o.validToS;
  return {
    wind: (_lat, _lon, epochS) =>
      inTime(epochS)
        ? { speedKn: NAV_TRAP_WIND.speedKn, fromDeg: NAV_TRAP_WIND.fromDeg }
        : undefined,
    waves: (lat, lon, epochS) =>
      inTime(epochS)
        ? { hsM: navTrapHsM(lat, lon), tpS: 7, fromDeg: NAV_TRAP_WIND.fromDeg }
        : undefined,
    current: () => undefined,
    maxTwsKn: NAV_TRAP_WIND.speedKn,
    maxCurrentKn: 0,
    validFromS: o.validFromS,
    validToS: o.validToS,
    header: SYNTHETIC_HEADER,
  };
}
