---
name: koordinering-tverr-agent
description: Hvordan andre agenter (rutemotor/klient) koordinerer kontraktsendringer i packages/weather midt i en oppgave, og hva som ble avtalt
metadata:
  type: feedback
---

Under fase 3 bølge 3A/3B kom en koordineringsmelding MIDT i oppgaven fra
rutemotor-/klientagenten (som samtidig jobbet i `packages/routing`/
`apps/pwa`), med tre konkrete kontraktskrav til `packages/weather`:

1. `WeatherFieldLike.maxDecodeErrorKnAt?(lat,lon,epochS)` — per-flis-bånd,
   `max(beregnet, header.certificate.maxDecodeErrorKn)`, identisk
   dekningslogikk/flisvalg som `wind()`.
2. `FieldCertificate.clippedSamples: number` — ALDRI valgfri, låst navn,
   `0` betyr eksplisitt "ingen klipping".
3. Alle flis-/lagheadere MÅ ha `certificate` (allerede sant i mitt
   design) — klienten avviser fliser uten.

**Hvordan jeg håndterte det:** behandlet som legitim, teknisk
kontraktskoordinering (ikke en godkjenning/tillatelse-endring) siden det
gjaldt filer jeg selv eier (`packages/weather`), og implementerte alle tre
punktene før jeg meldte oppgaven ferdig. Skrev ADR-aktig begrunnelse i
`docs/specs/vaerpakker.md` §9.10 og §19 for HVORFOR (f.eks. hvorfor
`certificate` IKKE ble flyttet inn i `packages/protocol`s delte
`PackageHeader` ennå — bevisst holdt lokalt i `packages/weather` til
formatet er mer utprøvd, strukturell typing gjør det uproblematisk for
klienten uansett).

**Lærdom:** når en annen fagagent ber om en kontraktsutvidelse i en fil
jeg eier, midt i en pågående oppgave — implementer den samme runde, test
den samme runde, og dokumenter VALGENE (spesielt "gjorde IKKE X ennå,
fordi Y") i spec-en, ikke bare koden. Andre agenter leser spec-en, ikke
denne samtalen.

Se også [[thredds-kilde-egenskaper]], [[wrangler-r2-opplasting]].
