---
name: spec
description: Skriv eller oppdater en spesifikasjon i docs/specs før implementasjon. Bruk når en fase-leveranse skal bygges og spec mangler eller er uklar.
---

# Spec-skriving for RoutePlanner v2

Beslutningshierarkiet er `00-kravspek.md` → ADR-er → specs → kode.
En spec implementerer krav; den finner ikke opp nye. Nye krav → revider
kravspeken med datert endringslogg først.

Struktur for `docs/specs/<navn>.md`:

1. **Formål og kravsporing** — hvilke F-/N-punkter i kravspeken dekkes.
2. **Avgrensning** — hva denne spec-en bevisst IKKE dekker.
3. **Datamodell/kontrakter** — typer, formater, invarianter (f.eks.
   retningskonvensjoner: vind FRA, strøm MOT — alltid eksplisitt).
4. **Adferd** — normalflyt + degraderingsadferd (ærlig degradering er
   obligatorisk seksjon: hva vises når data mangler/er gamle).
5. **Testkrav** — enhetstester, fasit-punkter, golden-ruter; hva som er
   bevis for at spec-en er oppfylt.
6. **Ytelses-/størrelsesbudsjett** der relevant (værpakke ≤ 30 MB,
   heap < 500 MB, osv. — arv fra kravspek N6/F2.2/F3.5).
7. **Åpne spørsmål** — det som må avklares med Magnus før/under bygging.

Endringer i eksisterende spec: datert endringslogg nederst, aldri stille
omskriving. Sikkerhetssemantikk (farbarhet, marginer) endres aldri i en
spec uten ADR.
