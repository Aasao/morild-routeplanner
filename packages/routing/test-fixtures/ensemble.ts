/**
 * Felles form på ensemble-fiksturene til E1′-målingen
 * (`docs/research/maaleplan-e1-2026-08-31.md`).
 *
 * En ensemble-fikstur er **én geometri, én maske, én båt og N værfelt** —
 * medlemmene. Medlemstabellen er en fast, håndskrevet parametertabell uten
 * RNG: måleplanens §6.3 krever at felle-settet ikke er en sammenhengende
 * terskel-blokk, og det får man ikke av en seedet perturbasjonsfamilie.
 *
 * Fiksturene bor i `test-fixtures/` og ikke i `src/`: de er måle- og
 * testgrunnlag, ikke produksjonskode. Motoren selv vet ikke at ensembler
 * finnes (`contracts.ts`: «Motoren vet ikke at det finnes andre medlemmer»).
 */
import type { LatLon } from "@morild/geo";
import type {
  BoatModel,
  NavigabilityMask,
  RouteInput,
  RouteOptions,
  WeatherField,
} from "../src/index.js";

export interface EnsembleMember {
  /** `m00` … `m29`. Stabil identitet — felle-settet rapporteres med disse. */
  readonly id: string;
  readonly index: number;
  /** Tabellraden medlemmet kommer fra. Rapporteres sammen med resultatet. */
  readonly params: Readonly<Record<string, number | string>>;
  readonly weather: WeatherField;
}

export interface EnsembleFixture {
  readonly name: string;
  /** Hva fiksturen skal fange — leses av den som får et uventet tall. */
  readonly purpose: string;
  readonly start: LatLon;
  readonly dest: LatLon;
  readonly departEpochS: number;
  readonly mask: NavigabilityMask;
  readonly boat: BoatModel;
  readonly options: Partial<RouteOptions>;
  /**
   * Kontrollfeltet kandidatruten søkes i. Det er **ikke** ett av medlemmene:
   * kandidatruten skal ikke ha hjemmebanefordel i noe medlem.
   */
  readonly control: WeatherField;
  readonly members: readonly EnsembleMember[];
  /**
   * Medlemmer som per konstruksjon møter en **hard** forkastelse et sted i
   * feltet (positiv kontroll, måleplanens §6.3). Om forkastelsen faktisk
   * treffer ruten — og om den blir en felle etter R2 — er noe som **måles**,
   * ikke noe denne listen påstår.
   */
  readonly hardRejectionMemberIds: readonly string[];
}

export function memberId(index: number): string {
  return `m${String(index).padStart(2, "0")}`;
}

/** Søkeinput for kontrollruten (kandidatruten alle medlemmene måles mot). */
export function controlInput(fixture: EnsembleFixture): RouteInput {
  return {
    start: fixture.start,
    dest: fixture.dest,
    departEpochS: fixture.departEpochS,
    weather: fixture.control,
    mask: fixture.mask,
    boat: fixture.boat,
    options: fixture.options,
  };
}

/** Søkeinput for ett medlem — identisk med kontrollen bortsett fra været. */
export function memberInput(
  fixture: EnsembleFixture,
  member: EnsembleMember,
  overrides: Partial<RouteOptions> = {},
): RouteInput {
  return {
    start: fixture.start,
    dest: fixture.dest,
    departEpochS: fixture.departEpochS,
    weather: member.weather,
    mask: fixture.mask,
    boat: fixture.boat,
    options: { ...fixture.options, ...overrides },
  };
}

/**
 * Kompakt, sammenlignbart bilde av medlemstabellen: parameterrader og et
 * fast rutenett med værsamples. Determinismetestene sammenligner denne
 * strengen — den fanger både at tabellen er uendret og at feltene faktisk
 * gir samme tall to ganger på rad.
 */
export function ensembleDigest(fixture: EnsembleFixture): string {
  const lines: string[] = [];
  for (const member of fixture.members) {
    lines.push(`${member.id} ${JSON.stringify(member.params)}`);
    for (const hours of [0, 4, 8, 12]) {
      const epochS = fixture.departEpochS + hours * 3600;
      for (const f of [0, 0.5, 1]) {
        const lat = fixture.start.lat + (fixture.dest.lat - fixture.start.lat) * f;
        const lon = fixture.start.lon + (fixture.dest.lon - fixture.start.lon) * f;
        const w = member.weather.wind(lat, lon, epochS);
        const s = member.weather.waves(lat, lon, epochS);
        const c = member.weather.current(lat, lon, epochS);
        lines.push(
          `  t=${hours} f=${f} ` +
            `tws=${w === undefined ? "-" : w.speedKn.toFixed(4)} ` +
            `twd=${w === undefined ? "-" : w.fromDeg.toFixed(4)} ` +
            `hs=${s === undefined ? "-" : s.hsM.toFixed(4)} ` +
            `tp=${s?.tpS === undefined ? "-" : s.tpS.toFixed(4)} ` +
            `wdir=${s?.fromDeg === undefined ? "-" : s.fromDeg.toFixed(4)} ` +
            `cu=${c === undefined ? "-" : c.u.toFixed(4)} ` +
            `cv=${c === undefined ? "-" : c.v.toFixed(4)}`,
        );
      }
    }
  }
  return lines.join("\n");
}
