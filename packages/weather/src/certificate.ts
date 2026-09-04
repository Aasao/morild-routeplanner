/**
 * Sertifikat i pakkeheaderen (D7.4, `docs/research/ekspertpanel-d7-vaerpakkeformat-
 * 2026-09-04.md` — syntesens vilkår (6): "sertifisert maks feil per flis i
 * header — billig (verifyRoundTrip måler alt allerede)"). Se
 * `docs/specs/vaerpakker.md` §9.10 for den ordrette semantikken.
 *
 * **Prinsipp:** en klient skal ALDRI måtte stole på at produsentens
 * kvantisering var korrekt — den skal kunne LESE en garanti fra headeren
 * (`header.certificate`), og avvise en flis som mangler den (§9.10 —
 * "flis uten sertifikat er en flis klienten ikke kan stole på, aldri en
 * flis den antar er 'sikkert god nok'"). Dette er samme designfilosofi som
 * §9.6s sentinel: fravær av garanti er alltid eksplisitt, aldri stille.
 *
 * `maxDecodeErrorKn`/`maxDirectionErrorDeg` er **analytiske øvre skranker**
 * regnet fra subflisenes faktiske skala (§9.5s vaktbånd,
 * `windLayerMaxDecodeErrorKn`/`layerMaxDecodeError`) — IKKE et sample-basert
 * estimat. `verifyRoundTrip` (`tools/weather-pack/src/build-live-package.ts`)
 * er en byggetids-SPOTSJEKK som bekrefter at den analytiske skranken faktisk
 * holder mot noen kjente noder — den utvider ALDRI skranken, den kan kun
 * (ved brudd) stoppe bygget (§9.10 — se `build-live-package.ts`s hard-feil).
 */
import type { PackageHeader } from "@morild/protocol";

export interface FieldCertificate {
  /**
   * Maks |dekodet − rå| for fart (knop), analytisk skranke over ALLE noder
   * og tidssteg flisen faktisk bærer for dette feltet (§9.5s
   * `√2·skala/2`-utledning for u/v-lagret vind; direkte `skala/2`
   * (nearest) eller `skala` (opp/ned) for skalarfelt). `undefined` for felt
   * uten en meningsfull fart-skranke (f.eks. et rent retningsfelt).
   */
  readonly maxDecodeErrorKn?: number;
  /**
   * Maks retningsavvik (grader), utledet fra `maxDecodeErrorKn` og feltets
   * faktiske fartsfordeling (`direction-budget.ts::maxDirectionErrorDeg`,
   * ekskludert punkter der retning er dårlig definert ved lav fart — se
   * dens dokumentasjon). `undefined` for felt uten retningsbegrep (strøm
   * lagres kun som komponenter, §9.5).
   */
  readonly maxDirectionErrorDeg?: number;
  /**
   * Hs' énsidige garanti (§9.3): `decode(encode(hs)) >= hs` alltid, så
   * dette tallet er den maksimale POSITIVE avstanden (aldri negativ) —
   * kun til stede for bølgefelt.
   */
  readonly maxHsErrorM?: number;
  /**
   * **Låst navn (koordinering fase 3 bølge 3B, rutemotor-/klientagenten):**
   * antall verdier byggeren observerte klippet utenfor `[lo,hi]` under
   * kvantisering (§9.6/§9.10 punkt 4, `buildLayer`s `onClip`-hook) —
   * ALLTID satt (aldri valgfri), `0` betyr eksplisitt "ingen klipping
   * observert", ikke "ikke undersøkt". Klienten skal ALDRI tolke fravær av
   * dette feltet som "uklippet" — et sertifikat uten `clippedSamples` er et
   * ugyldig sertifikat (se `hasCertificate`). Strukturelt forventes denne
   * ALLTID å være 0 for et bygg som faktisk ble skrevet (et klipp-funn er
   * en hard-feil i `tools/weather-pack/src/build-live-package.ts`, bygget
   * stanser før filen skrives) — feltet er likevel ekte, byggetids-talt,
   * ikke en hardkodet konstant, slik at fremtidige byggeveier som IKKE
   * hard-feiler (f.eks. et fremtidig "bygg likevel, men degradert"-spor)
   * rapporterer et sant tall.
   */
  readonly clippedSamples: number;
  /** Modellens/datakildens init-tidspunkt sertifikatet ble regnet mot (ISO 8601) — samme verdi som `PackageHeader.init` for denne flisen, gjentatt her slik at sertifikatet er selvstendig lesbart uten headerens øvrige felt. */
  readonly referenceInit: string;
  /** Når byggeren faktisk kjørte verifiseringen (ISO 8601, batch-jobbens klokke — IKKE modellens init). */
  readonly verifiedAt: string;
}

/** En `PackageHeader` som ALLTID bærer et sertifikat — se toppkommentaren for hvorfor `certificate` ikke er valgfri her. */
export interface CertifiedPackageHeader extends PackageHeader {
  readonly certificate: FieldCertificate;
}

/** Ren type guard — sant kun hvis `header.certificate` faktisk finnes (§9.10: klienten skal aldri anta det). */
export function hasCertificate(header: PackageHeader): header is CertifiedPackageHeader {
  const cert = (header as { certificate?: unknown }).certificate;
  return (
    typeof cert === "object" &&
    cert !== null &&
    // `clippedSamples` er ALDRI valgfri (se `FieldCertificate`s dokumentasjon)
    // — et sertifikat uten det er ugyldig, ikke bare "ufullstendig".
    typeof (cert as { clippedSamples?: unknown }).clippedSamples === "number"
  );
}

/**
 * Kaster en beskrivende feil hvis `header` mangler sertifikat (§9.10:
 * "flis uten sertifikat skal klienten avvise" — denne funksjonen er
 * hjelperen den avvisningen skal bruke, slik at ordlyden er konsistent
 * uansett hvilket kallsted i klienten som gjør avvisningen).
 */
export function requireCertificate(header: PackageHeader, context: string): CertifiedPackageHeader {
  if (!hasCertificate(header)) {
    throw new Error(
      `Avviser ${context}: pakkeheaderen mangler et sertifikat (header.certificate) — ` +
        "§9.10 krever at klienten aldri stoler på en usertifisert flis.",
    );
  }
  return header;
}
