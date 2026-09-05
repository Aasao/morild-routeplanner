# Nettbrett-målingen (ADR-0005 port 1) — oppskrift

- Dato: 2026-09-05
- Vedtak: D10.2 (b). Verktøyet er panelet i PWA-en; JSON-en bygges av
  `apps/pwa/src/weather/measurement.ts` (skjema
  `morild-nettbrett-maaling/1`) og forlater aldri enheten av seg selv.

## Slik kjører du

1. På PC-en, to terminaler fra repo-roten:
   - `pnpm --filter @morild/worker exec wrangler dev --remote`
   - `pnpm --filter @morild/pwa exec vite --host`
2. På nettbrettet: åpne `http://<PC-ens LAN-IP>:5173` i Chrome. Vent til
   panelet viser «Ensemblet tok X s for 30 medlemmer (N Workere)».
3. Nederst i panelet: **«Kopier måling»** → lim inn i chatten (eller
   marker tekstfeltet og kopier manuelt hvis knappen sier det).
4. Gjenta to ganger til (last siden på nytt mellom hver). Tre kjøringer
   fordi veggklokke ikke er reproduserbar (maaling-e1 §7.4).
5. Skriv i tillegg: nettbrettets modell, om det sto i lading, og om
   skjermen var på hele tiden (Chrome struper bakgrunnsfaner).

## Hva JSON-en inneholder

`hardwareConcurrency`, brukt pool, JS-heap (kun Chromium), Periodic
Background Sync-støtte (input til D10.6), kontrollens tider, ensemblets
veggklokke, og per medlem: `memberIndex`, ankomstrekkefølge, rundtur
(`elapsedMs`), tid i workeren delt i dekode/felt/søk, etiketter,
iterasjoner, realisert seilingstid, nådd mål. Det er nok til å skille
«for få kjerner», «små kjerner» og «dyrere etiketter på ARM» (panelet
D10, §1.2/§1.3), og til å regne orakel-treffsikkerhet når D10.5 kommer.

## Hva tallet avgjør

- Ensemble-veggklokke ≤ 60 s: F3.5-hypotesen holder på denne enheten;
  spak 4–6 utsettes til etter bølge 5 (D10.1).
- > 60 s: vise-versa-porten (D10.3) utløses *etter* at spak 4–6 er
  vurdert — utfallsmengden er F3.5-semantikk / medlemshorisont /
  avgangsvindu, ikke 12°.
- `searchMs`-median × 30 / pool vs faktisk veggklokke: gapet er
  worker-overhead/small-cores — det profilsøket (spak 4) skal se på.
