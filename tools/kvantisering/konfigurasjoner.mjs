/**
 * Konfigurasjonsmatrisen for kvantiseringsmålingen (steg 3-planens
 * «Kvantisering FØR formatlåsing»).
 *
 * Hver konfigurasjon er **én endring** fra `REF_PACK`, slik at en målt effekt
 * kan attribueres til én akse. De to `K-`-konfigurasjonene er de eneste
 * kombinerte, og de er med nettopp fordi enkeltakser kan være uskyldige hver
 * for seg og skadelige sammen.
 *
 * `ANALYTISK` er ikke en pakke — det er fiksturfeltet urørt. Den kolonnen
 * finnes for å måle referansepakkens *egen* gridsamplingsfeil; uten den vet vi
 * ikke om referansen er lossy, og da er alle andre tall udefinerte.
 */
import {
  fastLsb,
  quant,
  REF_PACK,
  withPack,
} from "../../packages/routing/dist/test-fixtures/pack-degradation.js";

const H = 3600;

/** `null` spec = det analytiske fiksturfeltet, uten pakking. */
export const KONFIGURASJONER = [
  { id: "ANALYTISK", akse: "baseline", spec: null, note: "Fiksturfeltet urørt — måler referansepakkens egen gridfeil." },
  { id: "REF", akse: "baseline", spec: REF_PACK, note: REF_PACK.note },

  // --- akse 1: vind-kvantisering
  {
    id: "W-UV8",
    akse: "vind",
    spec: withPack("W-UV8", "u/v 8-bit, skala/offset per flis", {
      windQuant: quant(8),
    }),
  },
  {
    id: "W-UV10",
    akse: "vind",
    spec: withPack("W-UV10", "u/v 10-bit per flis", { windQuant: quant(10) }),
  },
  {
    id: "W-UV12",
    akse: "vind",
    spec: withPack("W-UV12", "u/v 12-bit per flis", { windQuant: quant(12) }),
  },
  {
    id: "W-UV8G",
    akse: "vind",
    spec: withPack("W-UV8G", "u/v 8-bit, ÉN global skala (±maxTws)", {
      windQuant: quant(8, "nearest", "global"),
    }),
  },
  {
    id: "W-SD8",
    akse: "vind",
    spec: withPack("W-SD8", "fart 8-bit per flis + retning 8-bit (1,41°)", {
      windStorage: "fart-retning",
      windQuant: quant(8),
      dirQuant: quant(8),
    }),
  },
  {
    id: "W-SD10",
    akse: "vind",
    spec: withPack("W-SD10", "fart 10-bit + retning 10-bit (0,35°)", {
      windStorage: "fart-retning",
      windQuant: quant(10),
      dirQuant: quant(10),
    }),
  },

  /**
   * **Fast fysisk LSB** (lagt til 2026-09-03, tillegg §9.2). Magnus' beslutning
   * D6-C: fast LSB er kandidat til nytt vindformat, men skal låses **først**
   * etter at harnessen er kjørt på den — det er sikkerhetssemantikk, ikke
   * båndbredde.
   *
   * Forskjellen fra `W-UV8`/`W-UV8G` er ikke finheten, men **hvor trinnet kommer
   * fra**: her er det et tall i spec-en (0,25 eller 0,5 kn), ikke `(maks −
   * min)/255` i flisen og skiven. Konsekvensen er at `maxDecodeErrorKn` blir en
   * formatkonstant (`√2·lsb/2`) som kan verifiseres, i stedet for en størrelse
   * som avhenger av hva som lå i flisen. Prisen er at bitbredden blir en
   * konsekvens og ikke et valg — harnessen måler den.
   *
   * To offset-varianter, fordi de skiller seg på **gitterets sømmer**:
   * `-O` har et eksakt flis-minimum som nullpunkt (gitteret flytter seg mellom
   * fliser), de andre er ankret i fysisk null (ett gitter for hele feltet). Den
   * tredje varianten — gitter-justert flis-offset — er *bevist* identisk med
   * «ingen offset» i enhetstesten og trenger ingen egen kjøring.
   */
  {
    id: "F-LSB025",
    akse: "vind",
    spec: withPack("F-LSB025", "u/v fast LSB 0,25 kn, ankret i fysisk null (ingen offset)", {
      windQuant: fastLsb(0.25, "ingen"),
    }),
  },
  {
    id: "F-LSB025O",
    akse: "vind",
    spec: withPack("F-LSB025O", "u/v fast LSB 0,25 kn, offset = eksakt flis-minimum", {
      windQuant: fastLsb(0.25, "flis"),
    }),
  },
  {
    id: "F-LSB050",
    akse: "vind",
    spec: withPack("F-LSB050", "u/v fast LSB 0,5 kn, ankret i fysisk null (ingen offset)", {
      windQuant: fastLsb(0.5, "ingen"),
    }),
  },
  {
    id: "F-LSB050O",
    akse: "vind",
    spec: withPack("F-LSB050O", "u/v fast LSB 0,5 kn, offset = eksakt flis-minimum", {
      windQuant: fastLsb(0.5, "flis"),
    }),
  },

  /**
   * **Finhetskontrollen** (2026-09-03). P1 viste at `F-LSB025` og `F-LSB025O`
   * — *samme* trinn, ulikt gitter-anker — havner på hver sin gren på
   * `skjaeloy-skagen-apent` (0,08 % mot 2,80 % anger). Er det anker-lotteriet
   * §11 forbehold 1 beskriver, skal et **finere** fast trinn legge begge
   * ankere tilbake på referansens gren. Er det i stedet noe fast-LSB-formen
   * gjør uansett finhet, skal effekten overleve. Kontrollen er ikke en
   * formatkandidat: 0,1 kn er ikke byte-vennlig i noen ende.
   */
  {
    id: "F-LSB010",
    akse: "vind",
    spec: withPack("F-LSB010", "u/v fast LSB 0,1 kn, ingen offset (finhetskontroll)", {
      windQuant: fastLsb(0.1, "ingen"),
    }),
  },
  {
    id: "F-LSB010O",
    akse: "vind",
    spec: withPack("F-LSB010O", "u/v fast LSB 0,1 kn, offset per flis (finhetskontroll)", {
      windQuant: fastLsb(0.1, "flis"),
    }),
  },
  /**
   * Finhetskontrollen **i helheten**. P2b viste at `K-KYST-F025` mister S-5s
   * +4 t-gren (13,84 t → 14,31 t) der `K-ANB-KYST` med 8-bit flis-skala
   * beholder den, mens `F-LSB025` *alene* på Float32-bunn ikke gjør det. Er
   * årsaken at 0,25 kn er grovere enn det flis-skalaen faktisk leverer på
   * disse feltene (~0,05–0,08 kn), skal et finere fast trinn i den samme
   * helheten få grenen tilbake. Det er den eneste måten å skille «fast LSB er
   * feil form» fra «0,25 kn er for grovt».
   */
  {
    id: "K-KYST-F010",
    akse: "kombinasjon",
    spec: withPack(
      "K-KYST-F010",
      "K-ANB-KYST med vind på fast LSB 0,1 kn (ingen offset); ellers identisk",
      {
        windQuant: fastLsb(0.1, "ingen"),
        windKm: 2.5,
        waveKm: 2.5,
        timeStepS: 3600,
        currentKm: 0.8,
        currentQuant: quant(8),
        hsQuant: quant(8, "opp"),
        tpQuant: quant(8),
        dirQuant: quant(8),
      },
    ),
  },

  /**
   * **Helheten**, ikke bare aksen. §9.1 slo fast at «skade er ikke monoton i
   * grovhet», og at anbefalingen derfor må måles som den pakken den skal
   * implementeres som. Disse to er `K-ANB-KYST` med vinden byttet til fast LSB
   * — alt annet likt — slik at en effekt kan attribueres til byttet alene.
   */
  {
    id: "K-KYST-F025",
    akse: "kombinasjon",
    spec: withPack(
      "K-KYST-F025",
      "K-ANB-KYST med vind på fast LSB 0,25 kn (ingen offset); ellers identisk",
      {
        windQuant: fastLsb(0.25, "ingen"),
        windKm: 2.5,
        waveKm: 2.5,
        timeStepS: 3600,
        currentKm: 0.8,
        currentQuant: quant(8),
        hsQuant: quant(8, "opp"),
        tpQuant: quant(8),
        dirQuant: quant(8),
      },
    ),
  },
  {
    id: "K-KYST-F050",
    akse: "kombinasjon",
    spec: withPack(
      "K-KYST-F050",
      "K-ANB-KYST med vind på fast LSB 0,5 kn (ingen offset); ellers identisk",
      {
        windQuant: fastLsb(0.5, "ingen"),
        windKm: 2.5,
        waveKm: 2.5,
        timeStepS: 3600,
        currentKm: 0.8,
        currentQuant: quant(8),
        hsQuant: quant(8, "opp"),
        tpQuant: quant(8),
        dirQuant: quant(8),
      },
    ),
  },

  /**
   * **Konvergenskonfigurasjoner** (lagt til 2026-09-01 etter første kjøring).
   *
   * Første kjøring viste at REF-pakken *selv* flytter S-5s P50 opptil 2 % mot
   * det analytiske feltet. Da er 2,5 km/1 t ikke en referanse man kan måle
   * mot uten videre — det er en hypotese om at oppløsningen holder. Disse
   * finere pakkene finnes for å teste den: konvergerer tallene mot
   * `ANALYTISK` når nettet finnes, ligger feilen i oppløsningen; gjør de det
   * ikke, ligger den et annet sted.
   */
  { id: "T-30M", akse: "konvergens", spec: withPack("T-30M", "30 min tidssteg", { timeStepS: 1800 }) },
  { id: "T-15M", akse: "konvergens", spec: withPack("T-15M", "15 min tidssteg", { timeStepS: 900 }) },
  {
    id: "R-HALV",
    akse: "konvergens",
    spec: withPack("R-HALV", "1,25 km vind/bølge", { windKm: 1.25, waveKm: 1.25 }),
  },
  {
    id: "FIN-ALT",
    akse: "konvergens",
    spec: withPack("FIN-ALT", "1,25 km + 15 min + 0,4 km strøm, Float32", {
      windKm: 1.25,
      waveKm: 1.25,
      currentKm: 0.4,
      timeStepS: 900,
    }),
  },

  // --- akse 2: romlig oppløsning (vind + bølge)
  {
    id: "R-2X",
    akse: "rom",
    spec: withPack("R-2X", "5 km vind/bølge (2× nedtynnet)", {
      windKm: 5,
      waveKm: 5,
    }),
  },
  {
    id: "R-4X",
    akse: "rom",
    spec: withPack("R-4X", "10 km vind/bølge (4× nedtynnet)", {
      windKm: 10,
      waveKm: 10,
    }),
  },

  // --- akse 3: tidsoppløsning
  { id: "T-3H", akse: "tid", spec: withPack("T-3H", "3 t tidssteg", { timeStepS: 3 * H }) },
  { id: "T-6H", akse: "tid", spec: withPack("T-6H", "6 t tidssteg", { timeStepS: 6 * H }) },

  // --- akse 4: strøm
  { id: "C-2X", akse: "strøm", spec: withPack("C-2X", "1,6 km strøm (2×)", { currentKm: 1.6 }) },
  { id: "C-4X", akse: "strøm", spec: withPack("C-4X", "3,2 km strøm (4×)", { currentKm: 3.2 }) },
  {
    id: "C-8X",
    akse: "strøm",
    spec: withPack("C-8X", "6,4 km strøm (8×)", { currentKm: 6.4 }),
  },
  {
    id: "C-TID",
    akse: "strøm",
    spec: withPack("C-TID", "kun tidevanns-hovedkomponent (ingen romlig struktur)", {
      currentMode: "tidevann-hoved",
    }),
  },
  {
    id: "C-8B",
    akse: "strøm",
    spec: withPack("C-8B", "strøm u/v 8-bit per flis, full oppløsning", {
      currentQuant: quant(8),
    }),
  },

  // --- akse 5: bølge-kvantisering (Hs går inn i HARDE avvisninger)
  {
    id: "H-8N",
    akse: "bølge",
    spec: withPack("H-8N", "Hs/Tp 8-bit per flis, vanlig avrunding", {
      hsQuant: quant(8),
      tpQuant: quant(8),
    }),
  },
  {
    id: "H-8O",
    akse: "bølge",
    spec: withPack("H-8O", "Hs 8-bit per flis, avrundet OPP (konservativt)", {
      hsQuant: quant(8, "opp"),
      tpQuant: quant(8),
    }),
  },
  {
    id: "H-8G",
    akse: "bølge",
    spec: withPack("H-8G", "Hs 8-bit GLOBAL skala 0–12 m (trinn 4,7 cm)", {
      hsQuant: quant(8, "nearest", "global"),
      tpQuant: quant(8, "nearest", "global"),
    }),
  },
  {
    id: "H-8GO",
    akse: "bølge",
    spec: withPack("H-8GO", "Hs 8-bit global, avrundet OPP; Tp global 8-bit", {
      hsQuant: quant(8, "opp", "global"),
      tpQuant: quant(8, "nearest", "global"),
    }),
  },
  {
    id: "H-6G",
    akse: "bølge",
    spec: withPack("H-6G", "Hs 6-bit global (trinn 19 cm) — stresstest", {
      hsQuant: quant(6, "nearest", "global"),
      tpQuant: quant(6, "nearest", "global"),
    }),
  },
  /**
   * Kontrolleksperimentet for anbefalingen «Hs rundes OPP».
   *
   * `H-6G` (6-bit global, 19 cm trinn, vanlig avrunding) *mistet* den harde
   * forkastelsen i S-8s marginale medlem m26 (Hs 4,069 m mot båtens 4,0 —
   * 6,9 cm margin). Hvis mekanismen er avrundingsretningen og ikke
   * trinnstørrelsen, skal den samme grove kvantiseringen med avrunding
   * **opp** beholde forkastelsen. Ellers er anbefalingen feil.
   */
  {
    id: "H-6GO",
    akse: "bølge",
    spec: withPack("H-6GO", "Hs 6-bit global, avrundet OPP (kontrolleksperiment)", {
      hsQuant: quant(6, "opp", "global"),
      tpQuant: quant(6, "nearest", "global"),
    }),
  },
  {
    id: "P-8G",
    akse: "bølge",
    spec: withPack("P-8G", "kun Tp 8-bit global (trinn 0,098 s)", {
      tpQuant: quant(8, "nearest", "global"),
    }),
  },

  // --- kombinasjoner
  {
    id: "K-ANBEFALT",
    akse: "kombinasjon",
    spec: withPack(
      "K-ANBEFALT",
      "u/v 10-bit flis, 2,5 km/1 t, strøm 1,6 km 10-bit, Hs 8-bit flis OPP, Tp 8-bit flis",
      {
        windQuant: quant(10),
        currentKm: 1.6,
        currentQuant: quant(10),
        hsQuant: quant(8, "opp"),
        tpQuant: quant(8),
        dirQuant: quant(10),
      },
    ),
  },
  /**
   * **Helhetsmålingen av den faktisk anbefalte pakken** (lagt til 2026-09-01
   * etter fagagent-review av rapporten, §8.5-tillegget).
   *
   * Review-funnet: `K-ANBEFALT` over er *ikke* konfigurasjonen §10 anbefaler.
   * Den ble målt med strøm på 1,6 km (§9s eget forbehold) og med 10-bit u/v,
   * mens ytelses-reviewen har valgt **byte-alignet 8 bit**. Og `T-3H`/`T-6H`
   * viste at skade **ikke** er monoton i grovhet — «finere er trygt» kan
   * derfor ikke antas, heller ikke for bit-bredde. Anbefalingen må måles som
   * den helheten den er.
   *
   * §10 har to tillatte punkter langs romaksen (2,5 km i kystsonen, 5 km
   * utaskjærs med flagg) og to langs strømaksen (800 m i kystsonen, 1,6 km
   * utaskjærs). Pakkemodellen har **én** nodeavstand per felt og kan ikke
   * representere et sonevarierende nett; derfor måles begge endene av
   * konvolutten som hver sin konfigurasjon. Består begge, består enhver
   * sonedeling mellom dem *på ruteeffekt* — men merk at det er en
   * interpolasjon i argumentet, ikke en måling (se rapportens forbehold).
   */
  {
    id: "K-ANB-KYST",
    akse: "kombinasjon",
    spec: withPack(
      "K-ANB-KYST",
      "ANBEFALT, kystsone: u/v 8-bit flis, 2,5 km vind/bølge, 1 t, strøm 0,8 km 8-bit flis, Hs 8-bit flis OPP, Tp 8-bit flis, retning 8-bit",
      {
        windQuant: quant(8),
        windKm: 2.5,
        waveKm: 2.5,
        timeStepS: 1 * H,
        currentKm: 0.8,
        currentQuant: quant(8),
        hsQuant: quant(8, "opp"),
        tpQuant: quant(8),
        dirQuant: quant(8),
      },
    ),
  },
  {
    id: "K-ANB-UTASKJAERS",
    akse: "kombinasjon",
    spec: withPack(
      "K-ANB-UTASKJAERS",
      "ANBEFALT, utaskjærs-enden: samme som K-ANB-KYST, men 5 km vind/bølge og 1,6 km strøm (det §10 tillater med flagg)",
      {
        windQuant: quant(8),
        windKm: 5,
        waveKm: 5,
        timeStepS: 1 * H,
        currentKm: 1.6,
        currentQuant: quant(8),
        hsQuant: quant(8, "opp"),
        tpQuant: quant(8),
        dirQuant: quant(8),
      },
    ),
  },
  {
    id: "K-VERSTE",
    akse: "kombinasjon",
    spec: withPack(
      "K-VERSTE",
      "u/v 8-bit global, 10 km, 3 t, strøm 6,4 km 8-bit, Hs 8-bit global nearest",
      {
        windQuant: quant(8, "nearest", "global"),
        dirQuant: quant(8),
        windKm: 10,
        waveKm: 10,
        timeStepS: 3 * H,
        currentKm: 6.4,
        currentQuant: quant(8, "nearest", "global"),
        hsQuant: quant(8, "nearest", "global"),
        tpQuant: quant(8, "nearest", "global"),
      },
    ),
  },
];

export function konfig(id) {
  const k = KONFIGURASJONER.find((k) => k.id === id);
  if (k === undefined) throw new Error(`ukjent konfigurasjon: ${id}`);
  return k;
}

/** Konfigurasjonene rangeringsmålingen kjører med FULLE søk (dyr, §P2b). */
export const FULLE_SOK_KONFIG = [
  "ANALYTISK",
  "REF",
  "R-4X",
  "T-3H",
  "K-ANBEFALT",
  // Helhetsmålingen 2026-09-01 (§8.5): den anbefalte pakken må måles med det
  // instrumentet formatbeslutninger faktisk kan hvile på — P2a er for svakt
  // (rapportens forbehold 2).
  "K-ANB-KYST",
  "K-ANB-UTASKJAERS",
  // Attribusjonskjøring: `K-ANB-UTASKJAERS` flippet toppavgangen i P2b.
  // `R-2X` er den samme 5 km-nedtynningen UTEN kvantisering — kjøres for å
  // skille «5 km» fra «8 bit» som årsak.
  "R-2X",
  // Tillegg §9.2 (fast fysisk LSB, 2026-09-03): formatvalg skal hvile på det
  // sterke rangeringsinstrumentet (§11 forbehold 2), ikke på P2a.
  "F-LSB025",
  "F-LSB025O",
  "F-LSB050",
  "F-LSB050O",
  "K-KYST-F025",
  "K-KYST-F050",
  "K-KYST-F010",
  "F-LSB010",
];
