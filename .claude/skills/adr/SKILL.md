---
name: adr
description: Skriv en arkitekturbeslutning (ADR) etter prosjektets mal. Bruk når en beslutning med varig konsekvens tas, eller når en tidligere beslutning endres/erstattes.
---

# ADR-skriving for RoutePlanner v2

1. Finn neste nummer: list `docs/decisions/ADR-*.md`, ta høyeste + 1
   (fire sifre, f.eks. ADR-0004).
2. Bruk `docs/decisions/TEMPLATE.md` som mal: Kontekst / Beslutning /
   Konsekvenser / Status (Foreslått | Godkjent | Erstattet av ADR-XXXX).
3. Filnavn: `ADR-<nnnn>-<kort-kebab-tittel>.md`. Norsk språk.
4. Kontekst skal referere kilden til behovet (kravspek-punkt, spike-rapport,
   review-funn) med filsti. Konsekvenser skal inkludere det vi gir avkall på.
5. Beslutninger som endrer sikkerhetssemantikk (farbarhet, marginer,
   tillitsnivåer) eller koster penger: status «Foreslått» og legg frem for
   Magnus — aldri selvgodkjenn disse.
6. Erstattes en ADR: sett gammel til «Erstattet av ADR-XXXX», aldri slett.
7. Oppdater referanser i kravspek/prosjektplan hvis de peker på beslutningen.
