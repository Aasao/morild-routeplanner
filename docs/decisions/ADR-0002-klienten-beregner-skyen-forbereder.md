# ADR-0002: Klienten beregner, skyen forbereder

- Status: godkjent 2026-08-30 (dekket av kravspek v1.0-godkjenningen, §5 og F1.8/F6.3)
- Dato: 2026-08-30
- Besluttet av: agent-forslag som venter (Magnus bekrefter)

## Kontekst

Isokron-rutesøket kjører 150–210 ganger per kveldsplanlegging (scenario S1,
kravspek F3.5) og skal etter hvert kjøre et helt værensemble (fase 4).
Spørsmålet er hvor denne beregningen skal skje: i en Cloudflare Worker,
eller på klienten (telefon/nettbrett). `docs/research/plattform-android-cloudflare.md`
§6 konkluderer at klientberegning fortsatt er riktig arkitektur, med tre
begrunnelser: enkelhet/robusthet (ingen serverrundtur når data allerede er
hentet ned), CPU-grensen er ikke lenger avgjørende (Workers har 30 s–5 min
CPU på betalt plan, langt mer enn tidligere antatt), og ytelse (WASM er
nær-native i moderne mobilnettlesere) — med eksplisitt forbehold om at dette
verifiseres empirisk (fase 0, spike 2). Appen skal også virke frakoblet med
sist synkede data (CLAUDE.md, prinsipp 4), noe som i praksis utelukker en
arkitektur der selve ruteberegningen krever en levende serverforbindelse.

## Beslutning

Ruteberegning (isokron-søk i fase 2, ensemble i fase 4) kjører alltid på
klienten, i en Web Worker (WASM vurderes hvis målingene i spike 2 krever
det). Cloudflare-siden sitt ansvar er å hente, transformere og cache data —
værensembler, farbarhetsmaske, strømfelt — og publisere dem som
versjonerte, uforanderlige pakker i R2 (jf. ADR-0001, prinsipp 4 i
CLAUDE.md). Klienten pinner én pakke per økt og kjører hele søket lokalt,
uten serverrundtur.

## Alternativer vurdert

- **Ruteberegning i en Cloudflare Worker (on-demand):** vraket som
  hovedvei — introduserer nettverksavhengighet og latens for en app brukt
  til sjøs med ustabil dekning, og bryter «klienten beregner»-prinsippet
  unødig nå som CPU-grensen ikke lenger tvinger dette valget. Beholdes som
  dokumentert fallback (se Konsekvenser) hvis isokron-søket viser seg for
  tungt på eldre Android-nettbrett.
- **Durable Object som beregningsmotor:** vraket — samme
  nettverksavhengighet som Worker on-demand, i tillegg til unødig
  kompleksitet for en enbrukerapp uten sanntids-samtidighet i selve
  ruteberegningen (sanntid trengs for GPS/track i fase 6, ikke for
  isokron-søket).
- **Hybrid (kontrollmedlem server-side, ensemble klient-side):** vraket for
  v2.0 — splitter beregningslogikken i to kjøretidsmiljøer med duplisert
  domenekode, mot researchens anbefaling om én kjøretidsvei for
  rutemotoren.

## Konsekvenser

- Positivt: appen kan planlegge en hel kveld uten nett så snart pakkene er
  synket; ingen serverkostnad eller -kø ved 150–210 kjøringer per økt;
  `packages/routing` forblir ren og deterministisk (testbar uten
  mock-server).
- Negativt: minneansvaret flyttes til klienten — F3.5s minnemodell
  (per-medlem transferable ArrayBuffers) og N6s 500 MB-heap-tak må
  overholdes i praksis, ikke bare i spec; dette er ikke verifisert før
  spike 2 er kjørt.
- Blir vanskeligere senere hvis klientytelsen ikke holder: fallback-veien
  (Worker med 5 min CPU-tak som on-demand-reserve, jf. researchens
  "Fallback-alternativer") krever at rutemotoren allerede er skrevet uten
  DOM-/nettleser-spesifikke avhengigheter — sikret ved at
  `packages/routing` og `packages/geo` aldri importerer I/O.

## Bekreftelse

`packages/routing` og `packages/geo` har ingen avhengighet til `fetch`,
`fs` eller andre `node:`-moduler — håndhevet av `tools/arch-tests` og kjørt
via `pnpm test:arch`. Web Worker-oppsettet i `apps/pwa` kommer i fase 1/2
og skal referere til denne ADR-en i kommentarer der ruteberegningen kalles.
