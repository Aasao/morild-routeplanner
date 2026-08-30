# RoutePlanner v2 «Morild»

Personlig værruter og seilasplanlegger for Dufour 41 «Morild» — Skandinavia,
Android (PWA/TWA), hostet på Cloudflare. Etterfølger av v1-prototypen i
`C:\RoutePlanner` (skrivebeskyttet fasit).

## Status

Kravspesifikasjonen ble **godkjent 2026-08-30** (v1.0). Fase 0 (fundament +
spikes) er i gang — se prosjektplanen.

## Dokumentkart

- [docs/00-kravspek.md](docs/00-kravspek.md) — kravene (GODKJENT v1.0)
- [docs/01-prosjektplan.md](docs/01-prosjektplan.md) — faser, agenter, exit-kriterier
- [docs/03-modellruting.md](docs/03-modellruting.md) — hvilken modell til hva (kost/nytte)
- [docs/research/](docs/research/) — v1-analyse, marked, kartdata, værdata/ensemble, plattform
- `docs/decisions/` — ADR-er (kommer i fase 0)
- `docs/specs/` — spesifikasjoner per komponent (kommer per fase)
- `docs/legal/` — lisens- og vilkårsdokumentasjon per datakilde

## Kommandoer

```
pnpm install     # installer avhengigheter (Node 22+, pnpm via corepack)
pnpm check       # tsc -b (strict) + eslint
pnpm test        # vitest run — alle pakker
pnpm test:arch   # arkitekturgrense: geo/routing importerer aldri I/O
```

Se `CLAUDE.md` for full kommandoliste og hvilke som fortsatt mangler.
