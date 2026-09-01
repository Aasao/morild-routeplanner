# Rådata — E1′-målingen (hovedkjøringen 2026-08-31/09-01, varianter A/B/F)

> **Se også** `../maaling-e1-raadata-2026-09-01/` — det daterte tillegget med
> variantene F12/A12 (grovere kursoppløsning) og den deterministiske
> kostnadsmålingen. F og A der er bit-identiske med F og A her.

Skrevet av `tools/e1-maaling/maaling.mjs`. Rapporten som tolker dem er
`../maaling-e1-2026-08-31.md`; planen som låste kriteriene er
`../maaleplan-e1-2026-08-31.md`.

- `s-1.json` … `s-8.json` — én fil per fikstur, med **hele** medlemstabellen:
  `avganger[].varianter[A|B|F].utfall[medlemId]` (gjennomførbarhet, ankomst,
  beat/motor/natt, avbruddsårsak, algoritmisk abort) og `r2Sok` (antall
  re-søk per medlem).
- `sammendrag.json` — samme struktur uten medlemstabellene, pluss
  rangeringen per fikstur. Det er denne `rapporter.mjs` leser.

Nøkler verdt å kjenne:

| felt | betydning |
|---|---|
| `felleSett` | medlemmene som er **feller** under variantens R2-mekanikk, backoff 1 |
| `backoffSensitivitet.backoff0/2` | fasitens felle-sett ved backoff 0 og 2 (§8.1s deskriptive kolonne) |
| `utveiMargin` | minste avstand til hard grense langs fluktruten, per medlem fasiten fant utvei for |
| `motFasit.medianDiffH` / `iqrDiffH` | **paret** per-medlem-differanse mot fasiten — medlemmene er parede, fordelingsoverlapp brukes aldri (§3 punkt 6) |
| `motFasit.annenTopologi` | medlemmer med korridoravvik > 0,5 nm mot fasitens rute |
| `spredningH` | fasitens medlemsspredning P90 − P10, nevneren i §4s 20 %-terskel |
| `ms` | kjøretid på PC. Nettbrett-multiplikatoren er ikke målt. |

Kjør på nytt: `node tools/e1-maaling/maaling.mjs` (hele matrisen, ~25 min) —
eller `node tools/e1-maaling/maaling.mjs S-3` for én fikstur. Krever at
`packages/routing/dist` er bygget (`tsc -b`). Kjøringen er deterministisk:
samme kode gir bit-identiske tall, bortsett fra `ms`-kolonnen.
