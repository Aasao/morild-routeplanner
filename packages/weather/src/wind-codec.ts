/**
 * Vind: fysisk konvensjon FRA, byteformat u/v (`docs/specs/vaerpakker.md`
 * §3, §9.1). Dette er stedet FRA→komponent-konverteringen lever — det
 * dekodede API-et (`WindSample`, `field.ts`) kaller kun `uvToWind` som
 * *siste* steg, etter all romlig/tidsmessig interpolasjon (§3 punkt 5).
 *
 * Typeskillet mot strøm (MOT, ingen konvertering) er bevisst IKKE en delt
 * "VectorSample" — se `samples.ts` for hvorfor det er en kompileringsfeil,
 * ikke bare en kjøretidsfeil, å bytte dem om.
 */
import { norm360 } from "@morild/geo";
import type { RoundingMode } from "./quantize.js";

/** `fromDeg=0` (nordavind) ⇒ vinden blåser MOT sør ⇒ `(u,v) = (0, -speed)`. */
export function windToUV(speedKn: number, fromDeg: number): readonly [number, number] {
  const rad = (fromDeg * Math.PI) / 180;
  return [-speedKn * Math.sin(rad), -speedKn * Math.cos(rad)];
}

export interface DecodedWind {
  readonly speedKn: number;
  readonly fromDeg: number;
}

/**
 * `atan2(-u, -v)`: vinden kommer FRA den retningen den blåser MOT pluss
 * 180° — komponentene peker dit vinden er på vei, FRA-retningen er det
 * motsatte. Denne funksjonen (og bare denne) skal noensinne kalles på
 * *vind*-komponenter. Kall den aldri på strømkomponenter (§3 punkt 3) —
 * det er nøyaktig ombyttingsbuggen spec-en advarer mot.
 */
export function uvToWind(u: number, v: number): DecodedWind {
  return {
    speedKn: Math.hypot(u, v),
    fromDeg: norm360((Math.atan2(-u, -v) * 180) / Math.PI),
  };
}

/**
 * **TWS-vaktbåndets utledning** (`docs/specs/vaerpakker.md` §9.5).
 * Skranken for hvor mye kvantiseringen alene kan flytte den dekodede
 * vindfarten, gitt trinnet (`scale`) til hver av de to u/v-kanalene:
 *
 * 1. Per kanal: `nearest` gir feil ≤ `scale/2`, `up`/`down` gir ensidig
 *    feil ≤ `scale` (samme fortegn i hele kanalen — konservativt regnet
 *    som verste tilfelle her, selv om vind aldri bruker `up`/`down`, kun
 *    `nearest` — §9.5).
 * 2. Fra kanal til fart: `hypot(u,v)` og omvendt trekantulikhet gir
 *    `hypot(uFeil, vFeil)` som skranke på farten (u- og v-feilene er
 *    uavhengige trinnfeil — se `combineChannelDecodeErrorsKn` under, som
 *    er den ENE bindende utledningen brukt overalt i pakken, inkludert
 *    `field.ts::windLayerMaxDecodeErrorKn`). Dette er strammere enn, men
 *    aldri mindre konservativt enn, den symmetriske `√2 · e`-formelen som
 *    kun gjelder når begge kanaler tilfeldigvis har samme trinn
 *    (`hypot(e,e) = √2·e`) — se `packages/routing/test-fixtures/pack-degradation.ts`
 *    som fortsatt bruker den symmetriske varianten for sitt eget,
 *    enkeltskala test-fixture-formål.
 * 3. Interpolasjon (bilineær rom, lineær tid) er en konveks kombinasjon av
 *    noder — normen til en konveks kombinasjon av vektorer med norm ≤ e er
 *    selv ≤ e, så skranken overlever oppslaget uendret. Dette er grunnen
 *    til at `hypot`-varianten fortsatt er gyldig etter interpolasjon: den
 *    er en skranke på selve kanal-feil-VEKTOREN (uFeil, vFeil), og
 *    interpolasjon opererer lineært/konveks på nøyaktig den vektoren.
 */
export function combineChannelDecodeErrorsKn(
  uChannelErrKn: number,
  vChannelErrKn: number,
): number {
  return Math.hypot(uChannelErrKn, vChannelErrKn);
}

/**
 * Spesialtilfelle av `combineChannelDecodeErrorsKn` når u- og v-kanalen har
 * SAMME trinn (`scale`) — da er `hypot(e,e) = √2·e`. Ikke brukt av
 * produksjonskoden (som alltid har separate per-kanal trinn), beholdt for
 * API-symmetri og som en direkte, testbar sjekk av spesialtilfellet.
 */
export function windComponentDecodeErrorKn(
  scale: number,
  roundingMode: RoundingMode,
): number {
  const oneSided = roundingMode === "nearest" ? 0.5 : 1;
  const channelErr = oneSided * scale;
  return combineChannelDecodeErrorsKn(channelErr, channelErr);
}
