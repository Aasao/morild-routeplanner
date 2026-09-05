/**
 * Trafikklys og sertifikater (`docs/specs/robusthet.md` §4.2.3, D10.4).
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`.
 */

export interface ThresholdSpec {
  /** F.eks. "moerke", "tidsbudsjett". */
  readonly id: string;
  /** F.eks. «framme før mørket». */
  readonly label: string;
  readonly passes: (m: { readonly durationS: number; readonly daylightArrival: boolean }) => boolean;
}

/**
 * `TrafficLight.reason`. `"usikkert-grunnlag"` er ny (§3.2 «Konsekvens for
 * nevneren», vedtatt sammen med D9.2): når `nInc + nErr` er stor nok til at
 * `feasibleShare` ikke lenger kan leses som «andel av alle 30 medlemmer som
 * er gjennomførbare», skal trafikklyset si det i stedet for å late som
 * andelen betyr det den ikke gjør.
 */
export type TrafficLightReason =
  | "andel"
  | "tid"
  | "inkonklusiv"
  | "tynt-utvalg"
  | "ingen-kontrollrute"
  | "usikkert-grunnlag"
  /**
   * Rødt på for tynt grunnlag (D11.4, matematikeren): `s < 0,7` blant de
   * avgjorte, men `nF + nInf < 12` eller `nInc + nErr > N/3` — fargen
   * mykes aldri (N2), men begrunnelsen påstår ikke en andel
   * datamaterialet ikke bærer (N1). Teksten sier «av k avgjorte kom m
   * ikke fram — for få til å tallfeste».
   */
  | "tynt-grunnlag"
  | null;

export interface TrafficLight {
  readonly color: "gronn" | "gul" | "rod" | "beregner";
  readonly reason: TrafficLightReason;
  readonly kOfN: { readonly k: number; readonly n: number };
  /** DA6-stempel: tersklene som brukes er provisoriske (§4.2.3). */
  readonly provisionalThresholds: true;
}

/**
 * Bevis om det fulle ensemblet, utledet fra en delmengde (§4.2.3, D10.4).
 * Deterministisk og kun i advarselsretning — grønn kan aldri sertifiseres.
 */
export interface Certificate {
  readonly color: "rod" | "gul";
  readonly reason: "andel" | "tid";
}

/**
 * D10.4 — eksakte skranker på andelen av HELE ensemblet (ikke
 * `feasibleShare`, som har en annen, krympende nevner — se
 * `computeTrafficLight`s toppkommentar) som ender gjennomførbar.
 *
 * Etter `k` klassifiserte (alle `OutcomeKind`) med `j` gjennomførbare:
 * `min = j / expectedMembers`, `max = (j + expectedMembers − k) / expectedMembers`
 * (verste/beste fall: alle uklassifiserte ender gjennomførbare for `max`,
 * ingen for `min`).
 */
export interface FeasibleShareBounds {
  readonly min: number;
  readonly max: number;
}

export interface FeasibleShareBoundsInput {
  readonly nF: number;
  readonly nInf: number;
  readonly nInc: number;
  readonly nErr: number;
  readonly expectedMembers: number;
}

/** D10.4s eksakte skranker. `expectedMembers` generaliserer spec-tekstens `30`. */
export function computeFeasibleShareBounds(input: FeasibleShareBoundsInput): FeasibleShareBounds {
  const { nF, nInf, nInc, nErr, expectedMembers } = input;
  if (expectedMembers === 0) return { min: 0, max: 0 };
  const classified = nF + nInf + nInc + nErr;
  const min = nF / expectedMembers;
  const max = (nF + expectedMembers - classified) / expectedMembers;
  return { min, max };
}

export interface ThresholdRate {
  readonly id: string;
  /** Antall gjennomførbare (så langt) som består terskelen. */
  readonly k: number;
  /** Antall gjennomførbare (så langt), dvs. `nF`. */
  readonly n: number;
}

export interface TrafficLightInput {
  readonly complete: boolean;
  readonly expectedMembers: number;
  readonly nF: number;
  readonly nInf: number;
  readonly nInc: number;
  readonly nErr: number;
  /** `nF / (nF + nInf)`; `null` når `nF + nInf === 0`. */
  readonly feasibleShare: number | null;
  /** `nInc / expectedMembers`. */
  readonly inconclusiveShare: number;
  /** Terskeltellinger blant gjennomførbare SÅ LANGT (§4.2.2/§4.2.4). */
  readonly thresholdRates: readonly ThresholdRate[];
}

export interface TrafficLightResult {
  readonly light: TrafficLight;
  readonly certificate: Certificate | null;
}

function mkLight(
  color: TrafficLight["color"],
  reason: TrafficLightReason,
  kOfN: TrafficLight["kOfN"],
): TrafficLight {
  return { color, reason, kOfN, provisionalThresholds: true };
}

/** `t = min over tersklene av k/n` (1 hvis ingen terskler er definert). */
function minThresholdRate(thresholdRates: readonly ThresholdRate[]): number {
  if (thresholdRates.length === 0) return 1;
  let min = 1;
  for (const { k, n } of thresholdRates) {
    if (n === 0) continue;
    min = Math.min(min, k / n);
  }
  return min;
}

/**
 * Tabellen i §4.2.3, rad for rad — første treff vinner. Beregnes kun når
 * `complete`. Rekkefølgen «nevner-regelen» (`usikkert-grunnlag`) settes inn
 * på (D9.2/§3.2 gir ikke en eksakt radposisjon — **valg** dokumentert her):
 * ETTER de tre dekningsrelaterte radene (inkonklusiv/tynt-utvalg, som er
 * sanne uavhengig av om nevneren i `feasibleShare` er til å stole på), og
 * FØR radene som leser `s = feasibleShare` som «andel gjennomførbare»
 * (grønn/rød/gul-andel/gul-tid) — fordi det er nettopp DE radene
 * nevner-regelen advarer mot å stole på når `nInc + nErr` er stor.
 */
function finalRow(input: TrafficLightInput, kOfN: TrafficLight["kOfN"]): TrafficLight {
  const { nF, nInf, nInc, nErr, feasibleShare, inconclusiveShare, expectedMembers, thresholdRates } = input;

  if (nF + nInf === 0) return mkLight("gul", "inkonklusiv", kOfN);
  // Rødt dominerer alle gule rader (review-funn bølge 3, D11.4 — konservativ
  // presisering av §4.2.3-tabellens rekkefølge, venter Magnus' vedtak): er
  // andelen blant de avgjorte under 0,7, skal verken «horisont for kort»,
  // «tynt utvalg» eller «usikkert grunnlag» mykne et rødt lys til gult —
  // og sertifikatet `rod/andel` (nInf > 0,3·N) ville ellers kunne motsies
  // av det endelige lyset. Et varsel som stille mykes opp er like ille som
  // ett som stille forsvinner (N2).
  const sEarly = feasibleShare ?? 0;
  if (sEarly < 0.7) {
    const thin = nF + nInf < 12 || (expectedMembers > 0 && nInc + nErr > expectedMembers / 3);
    return mkLight("rod", thin ? "tynt-grunnlag" : "andel", kOfN);
  }
  if (inconclusiveShare > 0.2) return mkLight("gul", "inkonklusiv", kOfN);
  if (nF < 12) return mkLight("gul", "tynt-utvalg", kOfN);
  // §3.2 «Konsekvens for nevneren»: nevneren i s er ikke lenger «andel
  // gjennomførbare» når mer enn 1/3 av ensemblet er inkonklusivt/feilet.
  if (expectedMembers > 0 && nInc + nErr > expectedMembers / 3) {
    return mkLight("gul", "usikkert-grunnlag", kOfN);
  }

  const s = feasibleShare ?? 0; // nF + nInf > 0 er garantert her (raden over).
  const t = minThresholdRate(thresholdRates);
  if (s >= 0.9 && t >= 0.9) return mkLight("gronn", null, kOfN);
  // `s < 0,7` er allerede tatt over (rødt dominerer) — ingen død rad her.
  if (s < 0.9) return mkLight("gul", "andel", kOfN);
  return mkLight("gul", "tid", kOfN);
}

/**
 * Sertifikat før `complete` (§4.2.3, D10.4): kun i advarselsretning, aldri
 * grønn.
 *
 * **rod/andel:** §4.2.3s sertifikat `nInf > 0,3 · expectedMembers`. Det er
 * sunt for det endelige lyset fordi `s = nF/(nF + nInf)` (§3.3) da er
 * ≤ 1 − nInf/expectedMembers < 0,7 uansett hvordan resten klassifiseres
 * (inkonklusive/feil er ikke i nevneren, og kan bare gjøre s mindre).
 * D10.4s skranker (`bounds`) har en ANNEN nevner (hele ensemblet, med
 * inkonklusive/feil) og er derfor ikke et sertifikat for `s` — review-funn
 * bølge 3: `bounds.max < 0,7` kunne gi rødt sertifikat der det endelige
 * lyset ble gult (nF=5, nInf=1, nInc=24). Skrankene vises som tellinger;
 * sertifikatet følger spec-formelen.
 *
 * **gul/tid:** §4.2.3s formel — for en terskel der antall gjennomførbare
 * (så langt) som allerede bryter terskelen er `≥ nF_max − ⌈0,9 · nF_max⌉ + 1`
 * for ENHVER mulig `nF_max` fra dagens `nF` og opp til taket
 * `expectedMembers − nInf − nInc − nErr` (feilede medlemmer kan aldri bli
 * gjennomførbare; spec-teksten utelot `nErr`, review-funn 2 bølge 3).
 */
function certify(input: TrafficLightInput): Certificate | null {
  const { nF, nInf, nInc, nErr, expectedMembers, thresholdRates } = input;
  if (expectedMembers > 0 && nInf > 0.3 * expectedMembers) {
    return { color: "rod", reason: "andel" };
  }

  const cap = expectedMembers - nInf - nInc - nErr;
  if (cap >= nF) {
    for (const rate of thresholdRates) {
      const failing = rate.n - rate.k;
      let required = -Infinity;
      for (let nFMax = nF; nFMax <= cap; nFMax++) {
        const r = nFMax - Math.ceil(0.9 * nFMax) + 1;
        if (r > required) required = r;
      }
      if (required !== -Infinity && failing >= required) {
        return { color: "gul", reason: "tid" };
      }
    }
  }
  return null;
}

/**
 * Trafikklys + sertifikat (§4.2.3, D10.4). Beregnes kun når `complete`
 * eller et sertifikat foreligger; ellers `beregner` med `kOfN` = klassifisert
 * av forventet.
 */
export function computeTrafficLight(input: TrafficLightInput): TrafficLightResult {
  const classified = input.nF + input.nInf + input.nInc + input.nErr;
  const kOfN = { k: classified, n: input.expectedMembers };

  if (input.complete) {
    return { light: finalRow(input, kOfN), certificate: null };
  }

  const certificate = certify(input);
  if (certificate !== null) {
    return { light: mkLight(certificate.color, certificate.reason, kOfN), certificate };
  }
  return { light: mkLight("beregner", null, kOfN), certificate: null };
}
