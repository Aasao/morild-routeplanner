/**
 * **Havneboken og gatene foran et bail-out-søk** (`docs/specs/robusthet.md`
 * §3.5 og §4.5, D8.6 (b); `docs/specs/rutemotor.md` §5.14).
 *
 * `BailoutHarbour` (bailout.ts) er *måleplanens* havn: posisjon og
 * eksponering, nok til å svare på «tåler havnen dette været». F4.6-boken
 * legger til det en seiler faktisk trenger for å tørre å gå inn i mørket i
 * kuling: **dybde ved kai og ankringsplass**, og om anløpet er forsvarlig
 * uten dagslys.
 *
 * Tre ting er bevisste, og alle tre peker samme vei:
 *
 *  1. **`null` dybde er ikke «sannsynligvis dypt nok».** En havn uten
 *     dybdetall EKSKLUDERES fra R2 og flagges «mangler dybde» (§3.5).
 *     D7.3-feilklassen — ukjent presentert som trygt — er nettopp det denne
 *     regelen finnes for å hindre.
 *  2. **`nightApproachSafe` er `false` til Magnus sier noe annet.** Det er
 *     ikke en beregnet egenskap; det er en erfaring om innseilingen.
 *  3. **Gatene er rene funksjoner uten søk.** De kjøres FØR det dyre
 *     R2-søket (§4.5 pkt. 2) og kan derfor spare de fleste søkene — men de
 *     kan bare avvise, aldri godkjenne: at en havn passerer dybde og mørke
 *     sier ingenting om at det finnes farbar vei dit.
 *
 * Ren og deterministisk: ingen I/O, ingen klokke.
 */
import { sunEventsUtc } from "@morild/geo";
import type { BailoutHarbour } from "./bailout.js";
import type { BoatModel } from "./contracts.js";
import { DAYLIGHT_MARGIN_S, daylightArrival } from "./daylight.js";

/**
 * Et dybdetall med opphav. Kilde og dato er ikke pynt: et tall fra en
 * havneguide fra 2011 og et tall Magnus loddet i fjor skal kunne skilles i
 * ettertid uten å gjette.
 */
export interface DepthRef {
  readonly valueM: number;
  /** F.eks. "havneguide 2024", "egen lodding", "Kartverket dybdepunkt". */
  readonly source: string;
  /** ISO-dato (YYYY-MM-DD) for observasjonen/utgaven. */
  readonly date: string;
}

/**
 * Havneboken (F4.6). `updatedAt`/`deviceId` er LWW-feltene fra F6.1: boken
 * synkes mellom telefon og nettbrett, og siste skriving per felt vinner.
 */
export interface HarbourBookEntry extends BailoutHarbour {
  readonly id: string;
  /** `null` ⇒ havnen ekskluderes fra R2 og flagges «mangler dybde». */
  readonly minDepthAtQuayM: DepthRef | null;
  readonly minDepthAtAnchorageM: DepthRef | null;
  /** Default `false`: ikke mørketrygt før Magnus sier det. */
  readonly nightApproachSafe: boolean;
  readonly updatedAt: number;
  readonly deviceId: string;
  readonly tideNote?: string;
  readonly notes?: string;
  readonly verified?: boolean;
}

/** Gatene, i den rekkefølgen §4.5 kjører dem. */
export type BailoutGateKind = "mangler-dybde" | "dybde" | "moerke" | "vaer";

export type GateVerdict =
  | { readonly passed: true; readonly reason: string }
  | {
      readonly passed: false;
      readonly gate: BailoutGateKind;
      readonly reason: string;
    };

/**
 * Morilds dypgang (kravspek B1) og den statiske marginen (F1.2). Brukes kun
 * som **fallback** når båtmodellen ikke oppgir tallene selv — se
 * `requiredHarbourDepthM`.
 */
export const MORILD_DRAUGHT_M = 2.1;
export const STATIC_DEPTH_MARGIN_M = 0.5;

/**
 * Dybdekravet i en nødhavn: dypgang + klaring under kjølen.
 *
 * **Hvorfor det er en fallback her og ikke bare et felt i `BoatModel`.**
 * `BoatModel` er polarpakkens kontrakt og hadde fram til nå ingen
 * skrogdimensjoner — motoren har aldri trengt dem (farbarhetsmasken er
 * bygget for én dypgang i byggetid, F1.0/F1.1). `draughtM`/`depthClearanceM`
 * er lagt til som **valgfrie** felt slik at en fyldigere båtmodell
 * overstyrer, uten at eksisterende implementasjoner (og alle fiksturer)
 * brytes. Fallbacken er kravspekens B1-tall for Morild, altså 2,6 m — samme
 * tall `packages/charts` bygger sikkerhetskonturen med.
 *
 * Dette er en **kjent skarp kant**: en annen båt med større dypgang, plugget
 * inn i en modell uten `draughtM`, ville fått Morilds krav. Den dagen v2 får
 * flere båter må feltet bli obligatorisk. Notert i rutemotor.md §5.14.
 */
export function requiredHarbourDepthM(boat: BoatModel): number {
  // D12.2: feltene er obligatoriske i typen — ingen fallback her lenger.
  const draught = boat.draughtM;
  const clearance = boat.depthClearanceM;
  return draught + clearance;
}

/**
 * **Dybdegaten.** Mangler ett av de to tallene, er havnen ute med
 * `mangler-dybde`. Finnes begge, kreves `min(kai, ankring) ≥ krav`.
 *
 * `min` og ikke `max` er med vilje strengere enn nødvendig (det holder i
 * prinsippet at *én* av liggemulighetene er dyp nok): et bail-out-anløp i
 * kuling og mørke ender ofte på svai fordi kaia er full, og valget mellom de
 * to tas ikke av ruteren. Kravet er derfor at begge holder. Noteres som
 * åpent spørsmål i rutemotor.md §5.14.
 */
export function depthGate(
  entry: HarbourBookEntry,
  requiredDepthM: number,
): GateVerdict {
  const quay = entry.minDepthAtQuayM;
  const anchorage = entry.minDepthAtAnchorageM;
  if (quay === null || anchorage === null) {
    const missing =
      quay === null && anchorage === null
        ? "kai og ankringsplass"
        : quay === null
          ? "kai"
          : "ankringsplass";
    return {
      passed: false,
      gate: "mangler-dybde",
      reason: `${entry.name}: dybde ved ${missing} er ikke ført i havneboken`,
    };
  }
  const shallowest = Math.min(quay.valueM, anchorage.valueM);
  if (shallowest < requiredDepthM) {
    return {
      passed: false,
      gate: "dybde",
      reason:
        `${entry.name}: grunneste liggedybde ${shallowest.toFixed(1)} m ` +
        `under kravet ${requiredDepthM.toFixed(1)} m`,
    };
  }
  return {
    passed: true,
    reason: `${shallowest.toFixed(1)} m ≥ ${requiredDepthM.toFixed(1)} m`,
  };
}

/**
 * **Mørkegaten, etter søket:** ankomsttiden er kjent, og svaret er endelig.
 */
export function darknessGate(
  entry: HarbourBookEntry,
  arrivalEpochS: number,
  marginS: number = DAYLIGHT_MARGIN_S,
): GateVerdict {
  if (entry.nightApproachSafe) {
    return { passed: true, reason: `${entry.name} er merket mørketrygg` };
  }
  const verdict = daylightArrival(
    entry.position.lat,
    entry.position.lon,
    arrivalEpochS,
    marginS,
  );
  if (verdict.isDaylight) return { passed: true, reason: "ankomst i dagslys" };
  return {
    passed: false,
    gate: "moerke",
    reason:
      `${entry.name}: ankomst utenfor dagslys (${verdict.kind}) og ` +
      "innseilingen er ikke merket mørketrygg",
  };
}

/**
 * Finnes det dagslys et sted i `[fromEpochS, toEpochS]` på stedet?
 *
 * Eksakt, ikke samplet: dagslysvinduet regnes per UTC-døgn med
 * `sunEventsUtc` (samme kilde som `daylightArrival`) og snittes mot
 * intervallet. Midnattssol ⇒ hele døgnet teller som dagslys, mørketid ⇒
 * ingenting.
 */
export function hasDaylightWithin(
  lat: number,
  lon: number,
  fromEpochS: number,
  toEpochS: number,
  marginS: number = DAYLIGHT_MARGIN_S,
): boolean {
  if (toEpochS < fromEpochS) return false;
  const DAY_S = 86_400;
  // Ett døgn ekstra i hver ende: vinduet kan starte før soloppgang på det
  // ene døgnet og slutte etter solnedgang på det neste.
  for (let t = fromEpochS - DAY_S; t <= toEpochS + DAY_S; t += DAY_S) {
    const events = sunEventsUtc(lat, lon, t);
    if (events.polar === "day") return true;
    if (events.polar === "night") continue;
    const rise = events.sunriseEpochS;
    const set = events.sunsetEpochS;
    if (rise === undefined || set === undefined) continue;
    const winFrom = rise + marginS;
    const winTo = set - marginS;
    if (winTo < winFrom) continue;
    if (winFrom <= toEpochS && winTo >= fromEpochS) return true;
  }
  return false;
}

/**
 * **Mørkegaten, før søket.** Ankomsttiden er ikke kjent enda, men den ligger
 * i `[epochS + earliestS, epochS + limitS]`: tidligst når den admissible
 * nedre skranken tillater, senest når skranken går ut.
 *
 * Gaten avviser **kun** når hele det vinduet er utenfor dagslys — da er
 * ankomst i mørket sikker uansett hvilken vei søket måtte finne, og søket kan
 * spares. Er det dagslys et sted i vinduet, passerer havnen her og avgjøres
 * av `darknessGate` på den faktiske ankomsttiden. Retningen er den samme som
 * havnefeltets: gaten kan bare spare arbeid, aldri utelukke en havn som kunne
 * vært nådd i lyset.
 */
export function darknessPreGate(
  entry: HarbourBookEntry,
  earliestArrivalEpochS: number,
  latestArrivalEpochS: number,
  marginS: number = DAYLIGHT_MARGIN_S,
): GateVerdict {
  if (entry.nightApproachSafe) {
    return { passed: true, reason: `${entry.name} er merket mørketrygg` };
  }
  if (
    hasDaylightWithin(
      entry.position.lat,
      entry.position.lon,
      earliestArrivalEpochS,
      latestArrivalEpochS,
      marginS,
    )
  ) {
    return { passed: true, reason: "dagslys mulig i ankomstvinduet" };
  }
  return {
    passed: false,
    gate: "moerke",
    reason:
      `${entry.name}: hele ankomstvinduet er utenfor dagslys og ` +
      "innseilingen er ikke merket mørketrygg",
  };
}
