---
name: panel
description: Re-etabler og hør fagagent-panelet (simulerte fagperspektiver) før et beslutningspunkt legges frem for Magnus. Bruk ved hvert beslutningspunkt med reell konsekvens — ADR-utkast, kravspek-endringer, algoritmevalg, målingsdesign, sikkerhetssemantikk.
when_to_use: «hør panelet», «hva sier fagagentene», «stresstest dette», før nummererte beslutningspunkter (V/E/M/D) presenteres, ved spec-/ADR-review.
argument-hint: [tema eller sti til beslutningsgrunnlag]
---

# Fagagent-panelet

Magnus vil at anbefalinger er stresstestet av uavhengige perspektiver før
de når ham. Runde 1 (2026-08-31) viste at «konsensus» delvis var felles
framing; utfordrerrunden endret E1 substansielt, og forhåndsregistrert
måling snudde deretter panelets kostnadspremiss. Derfor: aldri bare én
runde, og aldri panelet uten utfordrere.

**Panelet er simulert.** Skriv det eksplisitt i alle dokumenter
(«Simulerte fagperspektiver, ikke reelle personer»). Verdien er uavhengig
lesning av samme grunnlag fra ulike ståsted — ikke autoritet.

## Rollene

Fageksperter (rolleprompt: «Du er <rolle>. Les grunnlaget fra ditt
ståsted; vurder, anbefal, og si hva du ville avvist. Vær konkret og
uenig der du er uenig.»):

| Rolle | Ståsted | Typisk bruk |
|---|---|---|
| Matematiker | Professor i multiobjektiv stioptimering / korteste vei | Isokron/A*-korrekthet, Pareto, dominans, kompleksitet |
| Værruting-utvikler | Produksjonsutvikler i PredictWind-type produkt | Hva som faktisk virker for seilere, polar/derating, UI-forventninger |
| Ytelsesingeniør | Storskala ruting, Google Maps-type | Datastrukturer, minne på nettbrett, WASM, batch/pack-format |
| Marinkartolog | Erfaren sjøkartolog/ECDIS | Farbarhet, marginer, faretolkning, S-57/Kartverket-semantikk |
| Fysikere (ved behov) | Beregningsastrofysiker, kvantefysiker | Feltmetoder, baklengs-felt, numerikk — med feasibility-filter |
| Meteorolog (ved behov) | Operativ marin meteorolog | Ensemble-tolkning, MEPS/WAM-egenskaper, usikkerhet |

Utfordrere (alltid med i runde 2):

| Rolle | Oppdrag |
|---|---|
| Djevelens advokat | Angrip grunnantakelsene; hva er felles framing forkledd som konsensus? |
| Lateral tenker | Retninger utenfor panelets liste; hva har ingen vurdert? |
| Pragmatiker | Kost/nytte og rekkefølge for énpersonsprosjekt på Android-nettbrett |

Presedens og tidligere rolleprompter: `docs/research/ekspertpanel-*.md`,
`docs/research/beslutningsgrunnlag-*.md`. Les runde 1/2-dokumentene før
panelet re-etableres, så rollene får sin egen historikk.

## Prosedyre

1. **Grunnlag.** Samle beslutningsgrunnlaget i én tekst (eller pek på
   fil: `$ARGUMENTS`): spørsmålet, alternativene, relevant kode/spec/ADR
   med filstier, målinger. Samme grunnlag til alle.
2. **Runde 1 — råd.** Spawn hver relevant fagekspert som egen
   `general-purpose`-agent med rolleprompt + grunnlag. Parallelt. Be om:
   vurdering, anbefaling, hva de ville avvist, og hva de trenger målt.
3. **Runde 2 — utfordring.** Spawn de tre utfordrerne med runde 1-svarene.
4. **Tilsvar.** Send utfordringene tilbake til runde 1-agentene via
   SendMessage (de beholder kontekst innen sesjonen). Agent-ID-er lever kun
   i én sesjon — i ny sesjon re-etableres rollene fra dokumentene.
5. **Votering.** Hver agent avgir per alternativ: GODKJENN / ENDRE (med
   hva) / AVVIS (med hvorfor).
6. **Dokumenter** i `docs/research/ekspertpanel-<tema>-<dato>.md`: metode,
   hver rolles råd, utfordringer, tilsvar, votering, og hovedsesjonens
   syntese nederst. Uenighet bevares — ikke glatt over.
7. **Legg frem for Magnus** som nummererte punkter med 2–3 alternativer,
   pro/contra og én anbefaling, med voteringen referert. Han svarer
   «anbefalinger besluttet» (evt. med avvik); vedtaket skrives til
   kravspek-endringslogg/ADR før implementasjon.

Regler: panelet forsinker aldri sikkerhetsmerking — usikkerhet vises i UI
uansett. Panelet godkjenner ikke; Magnus vedtar. Bruk sonnet for rollene
(docs/03-modellruting.md) og opus kun der matematikk/korrekthet er kjernen.
