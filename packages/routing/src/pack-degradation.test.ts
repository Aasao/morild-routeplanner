/**
 * Enhetstester for værpakke-degraderingen
 * (`test-fixtures/pack-degradation.ts`) — modellen kvantiseringsmålingen
 * 2026-09-01 hviler på.
 *
 * Testene sikrer de egenskapene *målingen* trenger for å være gyldig:
 * determinisme, at Float32-referansen faktisk rekonstruerer feltet, at flere
 * bit gir mindre feil enn færre, at konservativ avrunding er konservativ, og
 * at pakken aldri later som om den dekker mer enn skivene sine.
 */
import { describe, expect, it } from "vitest";
import { environmentAt, twsExceedsHardLimit } from "./expand.js";
import { testBoat } from "../test-fixtures/test-boat.js";
import {
  bitsForCodes,
  domainAround,
  fastLsb,
  FLOAT32,
  latStepDegFor,
  lonStepDegFor,
  packField,
  probePack,
  quant,
  REF_PACK,
  withPack,
} from "../test-fixtures/pack-degradation.js";
import type { FixedLsbOffset } from "../test-fixtures/pack-degradation.js";
import {
  constantWeather,
  syntheticField,
} from "../test-fixtures/synthetic-weather.js";
import { SKAGEN, SKJAELOY } from "../test-fixtures/golden-scenarios.js";
import { s8WindAgainstCurrentEnsemble } from "../test-fixtures/ensemble-s8-wind-current.js";

const T0 = 1_781_668_800;
const DOMAIN = domainAround([SKJAELOY, SKAGEN]);

function field() {
  return syntheticField({
    seed: 20260615,
    baseSpeedKn: 12,
    baseFromDeg: 240,
    speedVariationKn: 4,
    dirVariationDeg: 35,
    baseHsM: 1.0,
    validFromS: T0 - 3600,
    validToS: T0 + 8 * 24 * 3600,
  });
}

const PROBE_HOURS = [0, 6, 12] as const;

function probe(spec = REF_PACK) {
  const base = field();
  const packed = packField(base, spec, DOMAIN).field;
  return probePack(base, packed, DOMAIN, T0, PROBE_HOURS, 11);
}

describe("pakkedegradering: determinisme", () => {
  it("to pakker av samme felt og spec gir bit-identiske samples", () => {
    const spec = withPack("Q8", "8-bit u/v", { windQuant: quant(8) });
    const a = packField(field(), spec, DOMAIN).field;
    const b = packField(field(), spec, DOMAIN).field;
    const rows: string[] = [];
    for (const h of [0, 5, 11]) {
      for (let i = 0; i < 7; i++) {
        const lat = 57.9 + i * 0.2;
        const lon = 10.1 + i * 0.11;
        const t = T0 + h * 3600 + 917;
        rows.push(
          JSON.stringify([
            a.wind(lat, lon, t),
            a.waves(lat, lon, t),
            a.current(lat, lon, t),
          ]),
        );
        expect(
          JSON.stringify([
            b.wind(lat, lon, t),
            b.waves(lat, lon, t),
            b.current(lat, lon, t),
          ]),
        ).toBe(rows[rows.length - 1]);
      }
    }
    // Flis-cachen er ren memoisering: andre oppslag gir samme tall.
    for (let i = 0; i < 7; i++) {
      const lat = 57.9 + i * 0.2;
      const lon = 10.1 + i * 0.11;
      expect(JSON.stringify(a.wind(lat, lon, T0 + 917))).toBe(
        JSON.stringify(a.wind(lat, lon, T0 + 917)),
      );
    }
  });
});

describe("pakkedegradering: Float32-referansen rekonstruerer feltet", () => {
  it("2,5 km/1 t uten kvantisering ligger tett på det analytiske feltet", () => {
    const p = probe();
    // Det som står igjen er ren gridsamplingsfeil — den skal være liten, men
    // ikke null: det er nettopp derfor referansen selv er en pakke.
    expect(p.maxTwsErrKn).toBeLessThan(0.05);
    expect(p.maxDirErrDeg).toBeLessThan(0.5);
    expect(p.maxHsErrM).toBeLessThan(0.01);
    expect(p.coverageLoss).toBe(0);
  });

  it("grovere grid gir større feil enn finere", () => {
    const fin = probe();
    const grov = probe(
      withPack("S4", "10 km", { windKm: 10, waveKm: 10, currentKm: 3.2 }),
    );
    expect(grov.maxTwsErrKn).toBeGreaterThan(fin.maxTwsErrKn);
    expect(grov.maxDirErrDeg).toBeGreaterThan(fin.maxDirErrDeg);
  });

  it("3 t tidssteg gir større feil enn 1 t", () => {
    const t1 = probe();
    const t3 = probe(withPack("T3", "3 t", { timeStepS: 3 * 3600 }));
    expect(t3.maxTwsErrKn).toBeGreaterThan(t1.maxTwsErrKn);
  });
});

describe("pakkedegradering: bitdybde", () => {
  it("flere bit gir mindre vindfeil", () => {
    const b8 = probe(withPack("W8", "8-bit u/v", { windQuant: quant(8) }));
    const b10 = probe(withPack("W10", "10-bit u/v", { windQuant: quant(10) }));
    const b12 = probe(withPack("W12", "12-bit u/v", { windQuant: quant(12) }));
    expect(b10.rmsTwsErrKn).toBeLessThan(b8.rmsTwsErrKn);
    expect(b12.rmsTwsErrKn).toBeLessThan(b10.rmsTwsErrKn);
  });

  it("global skala er grovere enn skala per flis ved samme bitdybde", () => {
    const flis = probe(withPack("W8", "8-bit, flis", { windQuant: quant(8) }));
    const glob = probe(
      withPack("W8g", "8-bit, global", {
        windQuant: quant(8, "nearest", "global"),
      }),
    );
    expect(glob.rmsTwsErrKn).toBeGreaterThan(flis.rmsTwsErrKn);
  });

  it("8-bit retning gir feil under det halve trinnet 360/256", () => {
    const p = probe(
      withPack("D8", "fart+retning, 8-bit", {
        windStorage: "fart-retning",
        windQuant: quant(8),
        dirQuant: quant(8),
      }),
    );
    // Halve retningstrinnet er 0,70°; bilineær blanding av naboer kan ikke
    // gjøre feilen større enn kildens egen variasjon over en gridcelle pluss
    // det halve trinnet.
    expect(p.maxDirErrDeg).toBeLessThan(1.5);
  });
});

describe("pakkedegradering: konservativ avrunding av Hs", () => {
  it("«opp» dekoder aldri Hs lavere enn sant i en gridnode", () => {
    const base = field();
    const spec = withPack("H8u", "Hs 8-bit opp", {
      hsQuant: quant(8, "opp"),
    });
    const packed = packField(base, spec, DOMAIN).field;
    const latStep = latStepDegFor(spec.waveKm);
    const lonStep = lonStepDegFor(spec.waveKm);
    let checked = 0;
    for (let i = 0; i < 20; i++) {
      const lat = Math.round(58.0 / latStep + i) * latStep;
      for (let j = 0; j < 20; j++) {
        const lon = Math.round(10.4 / lonStep + j) * lonStep;
        const t = base.validFromS + 5 * 3600;
        const r = base.waves(lat, lon, t);
        const p = packed.waves(lat, lon, t);
        expect(r).toBeDefined();
        expect(p).toBeDefined();
        expect(p!.hsM).toBeGreaterThanOrEqual(r!.hsM - 1e-12);
        checked++;
      }
    }
    expect(checked).toBe(400);
  });

  it("«nearest» kan dekode Hs for lavt — det er hele forskjellen", () => {
    const p = probe(withPack("H8n", "Hs 8-bit nearest", { hsQuant: quant(8) }));
    expect(p.worstHsUnderM).toBeLessThan(0);
    const opp = probe(
      withPack("H8u", "Hs 8-bit opp", { hsQuant: quant(8, "opp") }),
    );
    expect(opp.worstHsUnderM).toBeGreaterThanOrEqual(p.worstHsUnderM);
  });
});

/**
 * **Sikkerhetsegenskapen kvantiseringsmålingen 2026-09-01 hviler på**
 * (`docs/research/kvantiseringsmaaling-2026-09-01.md` §8).
 *
 * S-8s medlem `m26` har verste Hs 4,069 m mot `testBoat().maxHsM = 4,0` —
 * 6,9 cm margin. Målingen viste at kvantisering med vanlig avrunding *sletter*
 * den harde forkastelsen (112 av 123 punkter over grensen forsvant ved 19 cm
 * trinn, 3 av 123 ved 4,7 cm), mens avrunding **opp** ikke mister ett eneste
 * punkt.
 *
 * Testen er skrevet slik at den har **tenner**: den krever både at opp-varianten
 * bevarer alle overskridelser *og* at nearest-varianten mister minst én. Uten
 * den andre halvdelen ville testen bestått selv om kvantiseringen sluttet å
 * virke i det hele tatt.
 *
 * Egenskapen måles på selve feltet og ikke gjennom et søk: det er feltets
 * kontrakt som skal holde, og en felttest er både raskere og mer presis enn å
 * lete etter den samme sannheten gjennom en rute.
 *
 * **Hva testen IKKE påstår.** S-8s bølgefelt er statisk i tid og glatt i
 * bredde, så testen isolerer *kvantiseringsfeilen*. Konservativ avrunding
 * beskytter ikke mot at lineær interpolasjon undervurderer en Hs-topp mellom
 * skivene — målt til −0,117 m allerede ved 1 t tidssteg uten noen
 * kvantisering, og −0,576 m ved 3 t (rapportens §8.4). Det er tidssteget som
 * er forsvaret mot den, ikke avrundingen.
 */
describe("pakkedegradering: konservativ Hs sletter aldri en hard forkastelse", () => {
  function tellOverskridelser(hsSpec: ReturnType<typeof quant>) {
    const fx = s8WindAgainstCurrentEnsemble();
    const domain = domainAround([fx.start, fx.dest]);
    const member = fx.members.find((m) => m.id === "m26");
    expect(member, "S-8 må ha medlemmet m26").toBeDefined();
    const packed = packField(
      member!.weather,
      withPack("X", "Hs-test", { hsQuant: hsSpec }),
      domain,
    ).field;

    let over = 0;
    let tapt = 0;
    let verstUnderM = 0;
    for (let a = 0; a <= 200; a++) {
      const lat = 57.8 + (58.7 - 57.8) * (a / 200);
      for (const h of [0, 3.7, 8.3]) {
        const t = fx.departEpochS + h * 3600;
        const sant = member!.weather.waves(lat, 10.8, t);
        const dekodet = packed.waves(lat, 10.8, t);
        if (sant === undefined || dekodet === undefined) continue;
        verstUnderM = Math.min(verstUnderM, dekodet.hsM - sant.hsM);
        if (sant.hsM > fx.boat.maxHsM) {
          over++;
          if (dekodet.hsM <= fx.boat.maxHsM) tapt++;
        }
      }
    }
    return { over, tapt, verstUnderM };
  }

  it("m26 har faktisk punkter over båtens Hs-grense (ellers måler testen ingenting)", () => {
    expect(tellOverskridelser(FLOAT32).over).toBeGreaterThan(50);
  });

  it("avrunding OPP mister ingen overskridelse, selv med 19 cm trinn", () => {
    for (const bits of [6, 8]) {
      const r = tellOverskridelser(quant(bits, "opp", "global"));
      expect(r.tapt, `${bits}-bit opp mistet ${r.tapt} av ${r.over}`).toBe(0);
      expect(r.verstUnderM).toBe(0);
    }
  });

  it("vanlig avrunding mister overskridelser — også ved 4,7 cm trinn", () => {
    const grov = tellOverskridelser(quant(6, "nearest", "global"));
    expect(grov.tapt).toBeGreaterThan(0);
    expect(grov.verstUnderM).toBeLessThan(-0.05);

    const fin = tellOverskridelser(quant(8, "nearest", "global"));
    expect(
      fin.tapt,
      "8-bit global med vanlig avrunding er ikke trygg — den er bare mindre utrygg",
    ).toBeGreaterThan(0);
    expect(fin.tapt).toBeLessThan(grov.tapt);
  });
});

/**
 * **TWS-vaktbåndet** (`docs/specs/vaerpakker.md` §9.5, målingens §10 krav 6).
 *
 * Hs har en konservativ retning (avrund opp, §9.3). Vind har ikke det: den
 * lagres som u/v-komponenter, og en kvantiseringsfeil kan like gjerne gjøre
 * dekodet TWS **lavere** som høyere enn sant. Målingen fant nøyaktig dette på
 * `W-UV8G` (8-bit u/v med én global skala): dekodet vind lå opptil
 * **+0,09 kn** over feltets deklarerte maksimum — et halvt kvantiseringstrinn
 * — og like mye under i den andre retningen. Er det den *lave* siden som
 * treffer et punkt der den sanne vinden så vidt er over `boat.maxTwsKn`,
 * forsvinner en hard forkastelse uten spor.
 *
 * Vernet er `twsExceedsHardLimit`: grensen flyttes ned med feltets
 * dokumenterte `maxDecodeErrorKn`. Testen har **tenner** i begge ender — den
 * krever at den nakne sammenligningen faktisk mister forkastelser på dette
 * feltet, og at vaktbåndet ikke mister én eneste.
 *
 * **Sammenligningsgrunnlaget er referansepakken, ikke det analytiske feltet.**
 * Det er samme metodikk som resten av målingen (fikstur-filens punkt 1):
 * `maxDecodeErrorKn` er en skranke på *kvantiseringen*, ikke på grid- og
 * tidsoppløsningens feil — de har sine egne forsvar (§9.1, §9.2). Måler man
 * mot det analytiske feltet, måler man alle tre og tester noe annet enn
 * vaktbåndet.
 */
describe("pakkedegradering: TWS-vaktbånd mot nedrundet vind (§9.5)", () => {
  /** Ett eneste akseskille fra `REF_PACK`: vindkvantiseringen. */
  const GLOBAL8 = withPack("W-UV8G", "8-bit u/v, én global skala", {
    windQuant: quant(8, "nearest", "global"),
  });

  function par() {
    const base = field();
    return {
      base,
      referanse: packField(base, REF_PACK, DOMAIN).field,
      kvantisert: packField(base, GLOBAL8, DOMAIN).field,
    };
  }

  it("det kvantiserte feltet oppgir et vaktbånd, referansen oppgir null", () => {
    const { referanse, kvantisert } = par();
    expect(referanse.maxDecodeErrorKn).toBe(0);
    // Halve trinnet på u/v-kanalen, i fartsrommet: √2 · (2·17,2/255)/2.
    expect(kvantisert.maxDecodeErrorKn).toBeGreaterThan(0.05);
    expect(kvantisert.maxDecodeErrorKn).toBeLessThan(0.15);
  });

  it("den målte dekodefeilen (~0,09 kn-klassen) ligger innenfor vaktbåndet", () => {
    const { referanse, kvantisert } = par();
    const p = probePack(referanse, kvantisert, DOMAIN, T0, PROBE_HOURS, 11);
    // Feilen er reell — ellers måler testen ingenting …
    expect(p.maxTwsErrKn).toBeGreaterThan(0.02);
    // … og vaktbåndet er en ærlig skranke over den.
    expect(p.maxTwsErrKn).toBeLessThanOrEqual(kvantisert.maxDecodeErrorKn);
    // Samme halve trinn peker også oppover, forbi feltets deklarerte maks
    // (målingens §10 krav 6 — grunnen til at deklarerte skranker skal regnes
    // på de DEKODEDE verdiene). Merk hva denne linjen ER: en skranke-sjekk,
    // ikke et bevis. På dette prøvegitteret er overskridelsen 0 kn (feltets
    // maksvind treffes ikke av lattice-punktene), så assertionen er svak her
    // — den fanger en fremtidig regresjon der overskridelsen vokser forbi
    // vaktbåndet, og ikke noe mer.
    expect(p.maxTwsOverKn).toBeLessThanOrEqual(kvantisert.maxDecodeErrorKn);
  });

  it("naken sammenligning mister harde forkastelser — vaktbåndet mister ingen", () => {
    const { referanse, kvantisert } = par();
    // Grensen legges midt i feltets vindspenn, slik at terskelen faktisk
    // krysses mange steder. Alt annet ved båten er uten betydning her.
    const boat = testBoat({ maxTwsKn: 13 });

    let over = 0;
    let taptNakent = 0;
    let taptMedVaktband = 0;
    for (const h of [0, 4, 9]) {
      const t = T0 + h * 3600;
      for (let a = 0; a <= 60; a++) {
        const lat = 58.0 + (59.0 - 58.0) * (a / 60);
        for (let b = 0; b <= 60; b++) {
          const lon = 10.3 + (11.1 - 10.3) * (b / 60);
          const pos = { lat, lon };
          const sant = environmentAt(referanse, pos, t);
          const dekodet = environmentAt(kvantisert, pos, t);
          if (sant === undefined || dekodet === undefined) continue;
          if (sant.wind.speedKn <= boat.maxTwsKn) continue;
          over++;
          if (dekodet.wind.speedKn <= boat.maxTwsKn) taptNakent++;
          if (!twsExceedsHardLimit(dekodet, boat, kvantisert)) taptMedVaktband++;
        }
      }
    }

    // Målt ved skrivetidspunktet: 905 punkter over grensen, 12 av dem tapt av
    // den nakne sammenligningen, 0 tapt med vaktbånd (vaktbånd 0,095 kn,
    // største målte dekodefeil 0,074 kn).
    expect(over, "grensen må faktisk krysses i feltet").toBeGreaterThan(100);
    expect(
      taptNakent,
      "uten vaktbånd skal kvantiseringen sluke minst én forkastelse",
    ).toBeGreaterThan(0);
    expect(
      taptMedVaktband,
      `vaktbåndet mistet ${taptMedVaktband} av ${over} forkastelser`,
    ).toBe(0);
  });

  it("vaktbåndet er inert for ukvantiserte felt (golden-garantien)", () => {
    const { referanse } = par();
    const boat = testBoat({ maxTwsKn: 13 });
    let sjekket = 0;
    for (let a = 0; a <= 40; a++) {
      const pos = { lat: 58.0 + a / 40, lon: 10.7 };
      const env = environmentAt(referanse, pos, T0 + 3 * 3600);
      if (env === undefined) continue;
      expect(twsExceedsHardLimit(env, boat, referanse)).toBe(
        env.wind.speedKn > boat.maxTwsKn,
      );
      sjekket++;
    }
    expect(sjekket).toBeGreaterThan(30);
  });
});

/**
 * **Fast fysisk LSB** — kandidaten Magnus har besluttet (D6-C) å vurdere som
 * nytt vindformat, målt i tillegget §9.2 til kvantiseringsmålingen.
 *
 * Egenskapen som skal testes er ikke «gir små feil» — det gjør 8-bit flis-
 * skala også. Det er at **vaktbåndet blir en formatkonstant**: `√2·lsb/2`
 * avhenger verken av feltet, flisstørrelsen eller hva som tilfeldigvis lå i
 * flisen, og kan derfor skrives i spec-en og verifiseres. Testene under
 * fastholder de fire leddene den påstanden hviler på:
 *
 * 1. båndet er felt-uavhengig (der flis-/global skala ikke er det),
 * 2. den faktisk målte dekodefeilen ligger under båndet,
 * 3. båndet **fanger overskridelsene** — ingen hard TWS-forkastelse går tapt
 *    der den nakne sammenligningen mister flere,
 * 4. forutsetningen båndet hviler på (ingen klipping) er sann på feltene vi
 *    måler, og brytes synlig — ikke stille — når den ikke er det.
 */
describe("pakkedegradering: fast fysisk LSB (D6-C)", () => {
  const LSB_KN = [0.25, 0.5] as const;

  function fastSpec(lsb: number, offset: FixedLsbOffset) {
    return withPack(
      `F-LSB${lsb}-${offset}`,
      `u/v fast LSB ${lsb} kn, offset «${offset}»`,
      { windQuant: fastLsb(lsb, offset) },
    );
  }

  it("vaktbåndet er en formatkonstant — samme tall for to ulike felt", () => {
    // To felt med helt ulikt vindspenn. Flis- og global skala gir hver sitt
    // vaktbånd her; fast LSB gir det samme.
    const svakt = field();
    const kraftig = syntheticField({
      seed: 20260615,
      baseSpeedKn: 30,
      baseFromDeg: 240,
      speedVariationKn: 12,
      dirVariationDeg: 35,
      baseHsM: 1.0,
      validFromS: T0 - 3600,
      validToS: T0 + 8 * 24 * 3600,
    });
    expect(kraftig.maxTwsKn).toBeGreaterThan(2 * svakt.maxTwsKn);

    for (const lsb of LSB_KN) {
      const spec = fastSpec(lsb, "ingen");
      const a = packField(svakt, spec, DOMAIN).field.maxDecodeErrorKn;
      const b = packField(kraftig, spec, DOMAIN).field.maxDecodeErrorKn;
      expect(a).toBeCloseTo(Math.SQRT2 * (lsb / 2), 12);
      expect(b).toBe(a);
      // Offsetvalget kan ikke flytte skranken: trinnet er det samme.
      expect(
        packField(svakt, fastSpec(lsb, "flis"), DOMAIN).field.maxDecodeErrorKn,
      ).toBe(a);
    }

    // Kontrasten: dagens globale 8-bit-skala arver feltets spenn.
    const g8 = withPack("G8", "8-bit global", {
      windQuant: quant(8, "nearest", "global"),
    });
    expect(packField(kraftig, g8, DOMAIN).field.maxDecodeErrorKn).toBeGreaterThan(
      2 * packField(svakt, g8, DOMAIN).field.maxDecodeErrorKn,
    );
  });

  it("uten offset ligger dekodede u/v på ett globalt gitter", () => {
    const base = field();
    const lsb = 0.25;
    const packed = packField(base, fastSpec(lsb, "ingen"), DOMAIN).field;
    // Gridnodene ligger på multipler av nodeavstanden (samme indeksering som
    // `TiledGrid`), og tidsskivene på hele timer fra feltets `validFromS`.
    // Treffer vi en node eksakt, er svaret nodeverdien.
    const dLat = latStepDegFor(REF_PACK.windKm);
    const dLon = lonStepDegFor(REF_PACK.windKm);
    let sjekket = 0;
    for (let a = 0; a < 6; a++) {
      const lat = Math.round((58.2 + a * 0.1) / dLat) * dLat;
      for (let b = 0; b < 6; b++) {
        const lon = Math.round((10.4 + b * 0.1) / dLon) * dLon;
        const w = packed.wind(lat, lon, base.validFromS + 4 * 3600);
        if (w === undefined) continue;
        const rad = (w.fromDeg * Math.PI) / 180;
        for (const komp of [
          -w.speedKn * Math.sin(rad),
          -w.speedKn * Math.cos(rad),
        ]) {
          expect(Math.abs(komp / lsb - Math.round(komp / lsb))).toBeLessThan(1e-6);
        }
        sjekket++;
      }
    }
    expect(sjekket).toBeGreaterThan(30);
  });

  it("gitter-justert flis-offset er identisk med ingen offset (bevist, ikke målt)", () => {
    /**
     * Den tredje offset-varianten et format kan velge: et flis-offset som
     * selv ligger på LSB-gitteret. Da er
     * `anker + round((x − anker)/lsb)·lsb = round(x/lsb)·lsb` for alle `x`,
     * fordi ankeret er et helt antall trinn. Den varianten trenger derfor
     * ingen egen måling — den ER «ingen offset», med færre bit.
     */
    for (const lsb of LSB_KN) {
      const verdier = [-17.2, -4.13, -0.126, 0, 0.124, 3.77, 12.5, 16.99];
      const anker = Math.floor(Math.min(...verdier) / lsb) * lsb;
      for (const x of verdier) {
        const medAnker = anker + Math.round((x - anker) / lsb) * lsb;
        const utenAnker = Math.round(x / lsb) * lsb;
        expect(medAnker).toBeCloseTo(utenAnker, 12);
      }
    }
  });

  it("den målte dekodefeilen er reell og ligger innenfor vaktbåndet", () => {
    const base = field();
    const referanse = packField(base, REF_PACK, DOMAIN).field;
    for (const lsb of LSB_KN) {
      for (const offset of ["ingen", "flis"] as const) {
        const kvantisert = packField(base, fastSpec(lsb, offset), DOMAIN).field;
        const p = probePack(referanse, kvantisert, DOMAIN, T0, PROBE_HOURS, 11);
        // Feilen må være reell, ellers måler testen ingenting …
        expect(p.maxTwsErrKn).toBeGreaterThan(lsb / 10);
        // … og båndet er en ærlig skranke over den, også over det som stikker
        // forbi feltets deklarerte maksvind.
        expect(p.maxTwsErrKn).toBeLessThanOrEqual(kvantisert.maxDecodeErrorKn);
        expect(p.maxTwsOverKn).toBeLessThanOrEqual(kvantisert.maxDecodeErrorKn);
      }
    }
  });

  it("naken sammenligning mister harde forkastelser — vaktbåndet mister ingen", () => {
    const base = field();
    const referanse = packField(base, REF_PACK, DOMAIN).field;
    const boat = testBoat({ maxTwsKn: 13 });

    for (const lsb of LSB_KN) {
      const kvantisert = packField(base, fastSpec(lsb, "ingen"), DOMAIN).field;
      let over = 0;
      let taptNakent = 0;
      let taptMedVaktband = 0;
      for (const h of [0, 4, 9]) {
        const t = T0 + h * 3600;
        for (let a = 0; a <= 60; a++) {
          const lat = 58.0 + (59.0 - 58.0) * (a / 60);
          for (let b = 0; b <= 60; b++) {
            const lon = 10.3 + (11.1 - 10.3) * (b / 60);
            const pos = { lat, lon };
            const sant = environmentAt(referanse, pos, t);
            const dekodet = environmentAt(kvantisert, pos, t);
            if (sant === undefined || dekodet === undefined) continue;
            if (sant.wind.speedKn <= boat.maxTwsKn) continue;
            over++;
            if (dekodet.wind.speedKn <= boat.maxTwsKn) taptNakent++;
            if (!twsExceedsHardLimit(dekodet, boat, kvantisert)) taptMedVaktband++;
          }
        }
      }
      expect(over, "grensen må faktisk krysses i feltet").toBeGreaterThan(100);
      expect(
        taptNakent,
        `LSB ${lsb} kn uten vaktbånd skal sluke minst én forkastelse`,
      ).toBeGreaterThan(0);
      expect(
        taptMedVaktband,
        `LSB ${lsb} kn: vaktbåndet mistet ${taptMedVaktband} av ${over}`,
      ).toBe(0);
    }
  });

  it("ingen koder klippes på fiksturfeltet — og klipping telles når den skjer", () => {
    const base = field();
    for (const lsb of LSB_KN) {
      for (const offset of ["ingen", "flis"] as const) {
        const pakke = packField(base, fastSpec(lsb, offset), DOMAIN);
        // Materialiser fliser (pakken er lat).
        probePack(base, pakke.field, DOMAIN, T0, PROBE_HOURS, 11);
        expect(pakke.stats.fixedLsbClamped).toBe(0);
      }
    }

    // Positiv kontroll: et felt som under-deklarerer sin egen maksvind. Da må
    // koder klippes, og da er `√2·lsb/2` IKKE lenger en gyldig skranke — hele
    // grunnen til at klippingen telles i stedet for å skjules.
    const underdeklarert = { ...field(), maxTwsKn: 5 };
    const pakke = packField(underdeklarert, fastSpec(0.25, "ingen"), DOMAIN);
    const p = probePack(base, pakke.field, DOMAIN, T0, PROBE_HOURS, 11);
    expect(pakke.stats.fixedLsbClamped).toBeGreaterThan(0);
    expect(p.maxTwsErrKn).toBeGreaterThan(pakke.field.maxDecodeErrorKn);
  });

  it("offset per flis kjøper bit, ikke nøyaktighet", () => {
    const base = field();
    for (const lsb of LSB_KN) {
      const pakke = packField(base, fastSpec(lsb, "flis"), DOMAIN);
      probePack(base, pakke.field, DOMAIN, T0, PROBE_HOURS, 11);
      const medOffset = bitsForCodes(pakke.stats.fixedLsbMaxSpanCodes);
      const utenOffset = bitsForCodes(2 * Math.round(base.maxTwsKn / lsb));
      expect(pakke.stats.fixedLsbMaxSpanCodes).toBeGreaterThan(0);
      expect(medOffset).toBeLessThan(utenOffset);
    }
  });
});

describe("pakkedegradering: ærlig dekning", () => {
  it("gyldighetsvinduet trimmes ned til siste hele tidsskive", () => {
    const base = constantWeather({
      speedKn: 10,
      fromDeg: 180,
      hsM: 1,
      validFromS: T0,
      validToS: T0 + 10 * 3600,
    });
    const packed = packField(
      base,
      withPack("T3", "3 t", { timeStepS: 3 * 3600 }),
      DOMAIN,
    ).field;
    expect(packed.validFromS).toBe(T0);
    expect(packed.validToS).toBe(T0 + 9 * 3600);
    expect(packed.wind(58, 10.6, T0 + 9 * 3600 + 1)).toBeUndefined();
    expect(packed.wind(58, 10.6, T0 + 9 * 3600)).toBeDefined();
  });

  it("mangler én av interpolasjonsnodene, mangler svaret", () => {
    const base = syntheticField({
      seed: 7,
      baseSpeedKn: 11,
      baseFromDeg: 270,
      speedVariationKn: 3,
      dirVariationDeg: 20,
      validFromS: T0,
      validToS: T0 + 6 * 3600,
      bbox: { latMin: 58.2, latMax: 59.0, lonMin: 10.2, lonMax: 11.0 },
    });
    const packed = packField(base, REF_PACK, DOMAIN).field;
    // Godt inne i boksen: data. Utenfor: ingen data, ingen ekstrapolasjon.
    expect(packed.wind(58.6, 10.6, T0 + 3600)).toBeDefined();
    expect(packed.wind(57.9, 10.6, T0 + 3600)).toBeUndefined();
    expect(packed.wind(59.4, 10.6, T0 + 3600)).toBeUndefined();
  });
});

describe("pakkedegradering: strømklassene", () => {
  it("«tidevann-hoved» fjerner all romlig struktur", () => {
    const base = field();
    const packed = packField(
      base,
      withPack("CT", "kun hovedkomponent", { currentMode: "tidevann-hoved" }),
      DOMAIN,
    ).field;
    const a = packed.current(58.0, 10.4, T0 + 3600);
    const b = packed.current(58.9, 11.2, T0 + 3600);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.u).toBe(b!.u);
    expect(a!.v).toBe(b!.v);
    // Referansen har derimot struktur — ellers målte testen ingenting.
    const r1 = base.current(58.0, 10.4, T0 + 3600)!;
    const r2 = base.current(58.9, 11.2, T0 + 3600)!;
    expect(Math.hypot(r1.u - r2.u, r1.v - r2.v)).toBeGreaterThan(0.05);
  });

  it("grovere strømgrid gir større strømfeil", () => {
    const c1 = probe();
    const c4 = probe(withPack("C4", "3,2 km strøm", { currentKm: 3.2 }));
    expect(c4.maxCurrentErrKn).toBeGreaterThanOrEqual(c1.maxCurrentErrKn);
  });
});

describe("pakkedegradering: lagringsformen for vind", () => {
  it("konstant felt gjenskapes eksakt i begge lagringsformer uten kvantisering", () => {
    const base = constantWeather({
      speedKn: 13.7,
      fromDeg: 217.5,
      validFromS: T0,
      validToS: T0 + 12 * 3600,
    });
    for (const storage of ["uv", "fart-retning"] as const) {
      const packed = packField(
        base,
        withPack("X", "float32", {
          windStorage: storage,
          windQuant: FLOAT32,
          dirQuant: FLOAT32,
        }),
        DOMAIN,
      ).field;
      const w = packed.wind(58.3, 10.7, T0 + 4321)!;
      expect(w.speedKn).toBeCloseTo(13.7, 4);
      expect(w.fromDeg).toBeCloseTo(217.5, 3);
    }
  });
});
