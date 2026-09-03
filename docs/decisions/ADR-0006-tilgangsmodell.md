# ADR-0006: Tilgangsmodell — offentlig speil uten Access, personlige data på egen binding

- Status: vedtatt 2026-09-03 av Magnus (D1 i fase 3 bølge 1-beslutningene,
  etter djevelens-advokat-review av `docs/specs/app-skjelett.md`)
- Dato: 2026-09-03
- Besluttet av: Magnus

## Kontekst

Kravspeken B6/F6.4 ber om en ADR for tilgangsmodellen og advarer mot
«Access-fellen»: Cloudflare Access foran API-ruter appen kaller gir
HTML-redirect i stedet for JSON og knekker klienten stille.
`docs/specs/app-skjelett.md` §7 løste dette som «foreslått default»: ingen
Access foran de offentlige GET-rutene (`/pointer`, `/blob`,
`/proxy/metalerts`, `/healthz`), fordi de kun serverer åpne-data-speil
(MET/Kartverket-avledede pakker). Review-funn (2026-09-03): «reversibel
default» er feil ord — fencen er én prefiksliste i samme Worker/binding
med CORS `*`, og når F6.1-synk kommer (ruter, analyser, innstillinger,
F4.6-havneboken med planlagte avganger — dvs. når båten står ubevoktet og
hvor den er neste natt) er minste motstands vei å legge `routes/` til
listen og servere personlige data gjennom samme åpne front. Spec-ens eget
Access-argument gjelder like sterkt for synk-rutene.

## Beslutning

To-lags tilgangsmodell, fastlagt før noe personlig finnes:

1. **Offentlig speil:** åpne-data-avledede pakker (vær, kart, MetAlerts-
   proxy) serveres uten Access fra egen R2-binding/prefiks. Åpenhet
   verifiseres per KILDE i `docs/legal/` (ikke per sti) — DDM/EMODnet-
   avledede masker må ha egen legal-fil før de legges under `charts/`.
2. **Personlige data:** ruter, analyser, innstillinger, havnebok og alt
   F6.1-synk lagres på en ANNEN binding (egen R2-bøtte eller D1) som
   `/blob/` strukturelt ikke kan nå — ikke bare prefiks-filtrert. Tilgang
   via API-nøkkel eller Cloudflare Access **service token** i header;
   aldri interaktiv Access foran noe appen kaller (fellen).
3. **Opphav og CORS:** Worker eksponeres under Pages-domenet (`/api/*`),
   slik at CORS `*` bortfaller; `*` tolereres kun som interim for det
   rene speilet til domenet er satt opp.
4. **Misbruksvern på proxyer:** proxy-ruter mot tredjepart under Morilds
   User-Agent-identitet skal ikke ha klientstyrte cache-bustere (D2:
   MetAlerts hentes Skandinavia-vidt per TTL, filtreres i klient) og skal
   ha én Cloudflare rate-limit-regel — METs blokkering rammer Magnus'
   kontakt, og Workers-gratiskvoten er selv-DoS-flaten.

## Alternativer vurdert

- **Access foran alle Worker-ruter:** vraket — fellen fra F6.4 (HTML-
  redirect knekker JSON-klienten); kjerneinnsikten i app-skjelett §7 står.
- **Én binding + prefiksliste (dagens skjelett) som varig modell:** vraket
  — vane-risikoen over; prefiks er ikke en sikkerhetsgrense.
- **API-nøkkel på alt, også speilet:** vraket — unødig for åpne data og
  hindrer enkel caching/CDN; nøkkel hører til det personlige laget.

## Konsekvenser

- Bølge 2 setter opp to bindinger i `wrangler.toml`/Pages-domene før
  første offentlige deploy; MetAlerts-proxyen skrives om (D2).
- Fase 5 (synk) arver et ferdig sted for personlige data — ingen
  ad hoc-utvidelse av `/blob/`.
- Vi gir avkall på enkelheten i «én Worker, én bøtte». Ombestemmelse er
  billig før fase 5, dyr etter.

## Bekreftelse

- `apps/worker`: ingen rute leser fra den personlige bindingen uten
  autentisering; `ALLOWED_BLOB_PREFIXES` peker kun på speil-bindingen.
  Test: forsøk på `routes/`-nøkkel via `/blob/` gir 404, ikke data.
- `docs/legal/` har fil for hver kilde som ligger under speilet.
- Rate-limit-regel og fravær av `bbox`-passthrough i MetAlerts-proxyen
  er testet.
