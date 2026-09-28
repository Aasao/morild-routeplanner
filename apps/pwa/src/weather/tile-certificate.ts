/**
 * **Klippe- og sertifikat-asserten på klientsiden** (D7.2 vilkår (iv), vedtatt
 * 2026-09-04 — `docs/research/ekspertpanel-d7-vaerpakkeformat-2026-09-04.md`,
 * lateral tenkers forslag 3, enstemmig «GODKJENN NÅ» fra værruting-agenten).
 *
 * Byggeren (`tools/weather-pack`) sertifiserer maks dekodefeil per flis og
 * felt i lagheaderen, målt mot det timevise råfeltet. Klienten **nekter** å
 * bruke en flis uten sertifikat: uten det er `maxDecodeErrorKn` — altså
 * TWS-vaktbåndet motoren håndhever den harde vindgrensen med
 * (`packages/routing/src/expand.ts::twsExceedsHardLimit`) — en påstand ingen
 * har verifisert. Da er «trygt» heller ikke verifiserbart, og vi later ikke
 * som (N2).
 *
 * Det samme gjelder **rapportert klipping**: en flis der kvantiseringen har
 * mettet, har en feil som ikke lenger er begrenset av et halvt trinn. Da er
 * hele vaktbånd-resonnementet ugyldig, og flisen kan ikke brukes.
 *
 * Rene funksjoner — ingen I/O. `pipeline.ts` kaller dem før den laster ned
 * blobene, slik at en flis uten sertifikat aldri koster båndbredde.
 */
import type { PackageHeader } from "@morild/protocol";

/**
 * Sertifikatet slik klienten leser det.
 *
 * Bevisst en **strukturell** lesing (`parseCertificate` under) og ikke en
 * import av produsentens type: `PackageHeader` i `@morild/protocol` eies av
 * værpakke-siden, og feltet legges på der. Samme mønster som
 * `pointer-types.ts` — vi er enige om et JSON-skjema, ikke om en klasse.
 */
export interface TileCertificate {
  /** Verifisert maks |dekodet − sann| på vindfart, knop. Motorens vaktbånd. */
  readonly maxDecodeErrorKn: number;
  /** Verifisert maks retningsfeil, grader. */
  readonly maxDirectionErrorDeg: number;
  /** Verifisert maks Hs-feil, meter (kun for bølgefelt). */
  readonly maxHsErrorM?: number;
  /** Init-tidspunktet råfeltet ble verifisert mot (ISO 8601). */
  readonly referenceInit: string;
  /** Når verifikasjonen ble kjørt (ISO 8601). */
  readonly verifiedAt: string;
  /**
   * Rapportert klipping i kvantiseringen.
   *
   * **Navneavklaring gjenstår** med weather-format-agenten (se rapporten):
   * parseren godtar både et boolsk `clipped` og et telleverk
   * `clippedSamples`, og behandler begge som klipping. Er ingen av dem til
   * stede, tolkes flisen som uklippet — byggeren MÅ derfor rapportere
   * klipping eksplisitt for at asserten skal bite.
   */
  readonly clipped?: boolean;
  readonly clippedSamples?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Leser sertifikatet ut av en header. `undefined` når det mangler **eller**
 * er ufullstendig: et halvt sertifikat er ikke et sertifikat, og den
 * konservative retningen er å behandle det som fravær.
 */
export function parseCertificate(header: PackageHeader): TileCertificate | undefined {
  const raw = (header as unknown as Record<string, unknown>)["certificate"];
  if (!isRecord(raw)) return undefined;
  const maxDecodeErrorKn = finiteNumber(raw["maxDecodeErrorKn"]);
  const maxDirectionErrorDeg = finiteNumber(raw["maxDirectionErrorDeg"]);
  const referenceInit = nonEmptyString(raw["referenceInit"]);
  const verifiedAt = nonEmptyString(raw["verifiedAt"]);
  if (
    maxDecodeErrorKn === undefined ||
    maxDecodeErrorKn < 0 ||
    maxDirectionErrorDeg === undefined ||
    maxDirectionErrorDeg < 0 ||
    referenceInit === undefined ||
    verifiedAt === undefined
  ) {
    return undefined;
  }
  const maxHsErrorM = finiteNumber(raw["maxHsErrorM"]);
  const clippedSamples = finiteNumber(raw["clippedSamples"]);
  const clipped = typeof raw["clipped"] === "boolean" ? raw["clipped"] : undefined;
  return {
    maxDecodeErrorKn,
    maxDirectionErrorDeg,
    ...(maxHsErrorM === undefined ? {} : { maxHsErrorM }),
    referenceInit,
    verifiedAt,
    ...(clipped === undefined ? {} : { clipped }),
    ...(clippedSamples === undefined ? {} : { clippedSamples }),
  };
}

/** Rapporterer sertifikatet klipping i kvantiseringen? */
export function reportsClipping(cert: TileCertificate): boolean {
  return cert.clipped === true || (cert.clippedSamples ?? 0) > 0;
}

export type TileAcceptance =
  | { readonly accepted: true; readonly certificate: TileCertificate }
  | { readonly accepted: false; readonly reason: string };

/**
 * Kan denne flisens felt brukes? Avvisningsgrunnen er **synlig tekst** som
 * går rett til UI-et — ikke en stille `false`.
 */
export function acceptTileHeader(header: PackageHeader): TileAcceptance {
  const certificate = parseCertificate(header);
  if (certificate === undefined) {
    return {
      accepted: false,
      reason:
        "flis uten sertifikat — byggeren har ikke verifisert maks dekodefeil " +
        "for denne flisen, og TWS-vaktbåndet kan ikke stoles på (D7.2)",
    };
  }
  if (reportsClipping(certificate)) {
    return {
      accepted: false,
      reason:
        "flis rapporterer klipping — kvantiseringen har mettet, og dekodefeilen " +
        "er da ikke lenger begrenset av sertifikatet (D7.2)",
    };
  }
  return { accepted: true, certificate };
}

/** Felt som deles av alle medlemmer og har eget sertifikatkrav (`docs/specs/strom-produsent.md`). */
export const CURRENT_FIELD = "current";
export const CURRENT_COASTAL_FIELD = "current-coastal";

/**
 * Sertifikatkravet for strøm og kystmaske. Vindens `parseCertificate`
 * krever `maxDirectionErrorDeg`, som strøm bevisst IKKE har (spec §3: strøm
 * lagres kun som komponenter) — vindregelen ville avvist hver strømflis.
 * Kravene her er likevel ikke svakere der de betyr noe:
 * - begge: `referenceInit`, `verifiedAt` og et TALL for `clippedSamples`
 *   (fravær = ugyldig, §9.10) som må være 0;
 * - strøm i tillegg: endelig `maxDecodeErrorKn ≥ 0`.
 */
export type SharedFieldAcceptance =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string };

export function acceptSharedFieldHeader(header: PackageHeader, field: string): SharedFieldAcceptance {
  const raw = (header as unknown as Record<string, unknown>)["certificate"];
  const reject = (reason: string): SharedFieldAcceptance => ({ accepted: false, reason });
  if (!isRecord(raw)) return reject(`${field}-lag uten sertifikat (§9.10) — brukes ikke`);
  const referenceInit = nonEmptyString(raw["referenceInit"]);
  const verifiedAt = nonEmptyString(raw["verifiedAt"]);
  const clippedSamples = finiteNumber(raw["clippedSamples"]);
  if (referenceInit === undefined || verifiedAt === undefined || clippedSamples === undefined) {
    return reject(`${field}-lag med ufullstendig sertifikat (mangler referenceInit/verifiedAt/clippedSamples) — brukes ikke`);
  }
  if (clippedSamples > 0 || raw["clipped"] === true) {
    return reject(`${field}-lag rapporterer klipping — dekodefeilen er ikke begrenset av sertifikatet`);
  }
  const maxDecodeErrorKn = finiteNumber(raw["maxDecodeErrorKn"]);
  if (field === CURRENT_FIELD && (maxDecodeErrorKn === undefined || maxDecodeErrorKn < 0)) {
    return reject("strømlag uten gyldig maxDecodeErrorKn i sertifikatet — brukes ikke");
  }
  return { accepted: true };
}

export interface TileRejection {
  readonly tileId: string;
  readonly field: string;
  readonly member: number;
  readonly reason: string;
}
