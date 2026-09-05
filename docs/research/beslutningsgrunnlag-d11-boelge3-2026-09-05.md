# Beslutningsgrunnlag D11.1–D11.4 — funn fra fase 4a bølge 3

- Dato: 2026-09-05
- Status: grunnlag for fagagent-panelet (`/panel`). Simulerte
  fagperspektiver, ikke reelle personer.
- Kilder: `docs/specs/robusthet.md` §3.2 (tabell + «Åpent D11.1»), §3.3
  (`feasibleShare = nF/(nF+nInf)`), §4.2.3 (trafikklys, presisering
  D11.4), §7 D11.1–D11.4; `docs/decisions/ADR-0005-ensemble-mekanisme.md`
  («partial værdekning ⇒ INKONKLUSIV»); `apps/pwa/src/weather/ensemble.ts`
  (`conservativeCoverage`); `packages/robustness/src/traffic-light.ts`
  (`finalRow`, `certify`); `packages/routing/src/bailout.ts`
  (`r2SearchInput`), `search.ts` (`computeTubBound`, `tubMarginFrac`);
  `docs/specs/rutemotor.md` §5.5 (gapmåling D9.3: T\*/Tub maks 1,036,
  aldri > 1,25; S-7 omkjøringskostnad +59 % → +17 %).

## D11.1 «partial + nådd mål»

`coverage.weather === "partial"` settes både når værfeltet tok slutt i
tid (horisont) og når et felt mangler helt (dagens pakke: vind uten
strøm/bølger). §3.2-tabellen (vedtatt D8) gir `feasible` når målet ble
nådd, uansett dekning; ADR-0005 sier partial ⇒ inkonklusiv; fase 3s app
gjorde det siste (nettbrett-røyktesten: «30 medlemmer 100 % inkonklusive»).
Bølge 3 beholdt ADR-lesningen som overstyring i appen.

- (a) ADR-lesningen: all partial ⇒ inkonklusiv, grunn «dekning». Vind-
  only-pakker gir 100 % inkonklusivt til bølger/strøm er i pakken.
- (b) Tabellen bokstavelig: nådd mål ⇒ feasible; forbeholdet bæres av
  flaggene (`VAERDEKNING_BEGRENSET`, `SJOEGANG_DATA_MANGLER`, usikkert-
  gulv) — feasibleShare regnes da uten bølgedata.
- (c) Skill de to årsakene i motoren: horisont ⇒ inkonklusiv; manglende
  felt ⇒ feasible med flagg (eller egen grunn «dekning-felt»).

## D11.2 R2/bail-out uten Tub-bound

`r2SearchInput` nekter delt Tub og delt felt, men motoren regner egen
bound i re-søket; R2 har ingen ventil/omkjøring. `noTubBound` finnes nå.
(a) Bail-out-søk alltid `noTubBound: true` — «kan du komme deg i havn»
beskjæres aldri av et anslag (dyrere; F4.6 koster allerede 4–12 min per
medlem uten havnefelt). (b) Behold egen bound (gapmålingen: aldri > 1,25;
skrankekomplett rute etter D9.3).

## D11.3 `tubMarginFrac = 0,25` mot målt maks-gap 1,036

~7× slakk. (a) La stå til ekte-data-porten. (b) Stram til 0,10 etter
måling på ekte fliser (mer beskjæring, raskere søk, mindre margin).

## D11.4 Rødt dominerer gule rader

Review-funn: `certify` ga rødt fra D10.4-skranken (nevner hele
ensemblet), mens endelig lys brukte `s = nF/(nF+nInf)` og radene
«tynt-utvalg»/«usikkert-grunnlag» kom før rødt ⇒ rødt underveis kunne
bli gult ved complete (nF=5, nInf=22, nInc=2, nErr=1). Implementert
konservativt: rød/andel før alle gule rader unntatt «ingen avgjorte»;
sertifikat = `nInf > 0,3·N`; `gul/tid`-taket trekker fra nErr.
(a) Bekreft. (b) Behold tabellen bokstavelig, sertifikat kun når ingen
gul rad kan treffe (nesten aldri rødt før complete).

## Spørsmål

1. D11.1: er en «gjennomførbarhetsandel» regnet uten bølgedata et
   robusthetstall for en seilbåt — eller er det nettopp flaggene som skal
   bære det (som for kartdekning)?
2. D11.4: finnes et tilfelle der rød-før-gul er *mindre* ærlig?
3. D11.2/D11.3: sikkerhet vs kostnad.
