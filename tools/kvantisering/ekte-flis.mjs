/**
 * **Ekte værflis som referansefelt for kvantiseringsharnessen** (D7.5 vilkår
 * vi, tillegg §14 i `docs/research/kvantiseringsmaaling-2026-09-01.md`).
 *
 * Harnessen har til nå kun kjørt på analytiske fiksturfelt. Det er et reelt
 * hull: et fiksturfelt har et *verste målt flisspenn på 21,7 kn*, mens en ekte
 * Skagerrak-flis har vesentlig større spenn — og siden dagens format utleder
 * trinnet av spennet (`(maks − min i flisen og skiven)/255`), er både
 * kvantiseringsfeilen og vaktbåndet **funksjoner av data harnessen aldri har
 * sett**. Denne filen lukker hullet: den leser en ekte, bygget værpakke fra
 * `tools/weather-pack/out/`, dekoder den, og leverer den som et vanlig
 * `WeatherField` som `packField` kan re-kvantisere.
 *
 * ```
 *   ekte .bin (MWL1, 8-bit, delta) → deserializeLayer → dekodede u/v-gitre
 *          → gridWindWeatherField (Float32-referanse)
 *          → packField (re-kvantisering: E / fast LSB)   → målingen
 * ```
 *
 * **All I/O lever her**, ikke i fiksturen: `gridWindWeatherField` i
 * `packages/routing/test-fixtures/pack-degradation.ts` tar bare nakne gitre
 * (typede arrayer og tall), slik arkitekturgrensen krever — `packages/routing`
 * importerer verken `@morild/weather` eller `node:fs`.
 *
 * **Kun lesing.** Denne filen skriver aldri til `tools/weather-pack/`.
 *
 * Tre forbehold som hører med hver eneste bruk av dette feltet:
 *
 * 1. **Referansen er selv 8-bit.** Den ekte pakken er allerede kvantisert av
 *    produsenten (målt vaktbånd 0,107–0,120 kn per flis). Det vi måler er
 *    derfor *re*-kvantisering av et allerede kvantisert felt. Det er riktig
 *    for spørsmålet som stilles — «hva gjør trinnvalget med ruten på ekte
 *    spenn?» — men det betyr at «Float32-referansen» ikke er sannheten fra
 *    MEPS, bare sannheten slik klienten faktisk ser den i dag.
 * 2. **Pakken bærer kun vind.** Strøm (NorKyst) og bølge (WAM800) mangler helt
 *    i denne kjøringen (`build-report.json` §`missingFields`). Feltet
 *    returnerer derfor `undefined` for begge — ærlig, men det betyr at
 *    Hs-drevne harde forkastelser ikke finnes her. De harde forkastelsene i
 *    §14 er TWS-drevne, som er den rette mekanismen når det er
 *    *vind*-kvantiseringen som måles.
 * 3. **Én modellkjøring, ett vær.** Init 2026-09-03 04Z. Spennene er ekte, men
 *    de er ett værbilde — ikke en storm, og ikke en klimatologi.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
/**
 * Hvor den bygde pakken ligger. `tools/weather-pack/out/` er *ferskvare* og
 * gitignorert: en annen agent bygger den om med jevne mellomrom, og blobene
 * er innholdsadresserte, så de gamle forsvinner. En måling som strekker seg
 * over mer enn ett pakkebygg vil da blande to værbilder uten å si fra.
 *
 * `MORILD_VAERPAKKE` peker derfor målingen på en **frossen kopi** (pointer +
 * build-report + de blobene pekeren refererer), slik at alle deler av én
 * kjøring garantert måler samme pakke. Uten variabelen brukes den levende
 * mappa, som er riktig for et raskt blikk og galt for en rapport.
 */
const PAKKE_ROT = process.env.MORILD_VAERPAKKE
  ? resolve(process.env.MORILD_VAERPAKKE)
  : join(REPO, "tools/weather-pack/out");

const weather = await import(
  pathToFileURL(join(REPO, "packages/weather/dist/index.js")).href
);
const routingFixtures = await import(
  pathToFileURL(
    join(REPO, "packages/routing/dist/test-fixtures/pack-degradation.js"),
  ).href
);

export const EKTE_PAKKE_ROT = PAKKE_ROT;

/** Peker-JSON-en fra den ekte pakkebyggingen (kun lesing). */
export function lesPeker() {
  return JSON.parse(
    readFileSync(join(PAKKE_ROT, "pointer-vaer-skandinavia.json"), "utf8"),
  );
}

export function lesByggrapport() {
  return JSON.parse(readFileSync(join(PAKKE_ROT, "build-report.json"), "utf8"));
}

/**
 * Dekoder ETT lag helt ut til et tett `Float32Array`, indeksert
 * `(i·nodesLon + j)·timeSteps + k` — samme indeksering som
 * `WindGrid` i fiksturen. `undefined` (sentinel) blir `NaN`.
 *
 * Full dekoding er med vilje: harnessen slår opp millioner av ganger, og en
 * lazy per-oppslag-dekoding ville gjort målingen til en profilering av
 * dekoderen i stedet for av kvantiseringen.
 */
function dekodLagHelt(lookup) {
  const g = lookup.layer.geometry;
  const ut = new Float32Array(g.nodesLat * g.nodesLon * g.timeSteps);
  let n = 0;
  for (let i = 0; i < g.nodesLat; i++) {
    for (let j = 0; j < g.nodesLon; j++) {
      const base = (i * g.nodesLon + j) * g.timeSteps;
      for (let k = 0; k < g.timeSteps; k++) {
        const v = weather.decodeLayerNode(lookup.layer, lookup.layout, i, j, k);
        ut[base + k] = v === undefined ? Number.NaN : v;
        n++;
      }
    }
  }
  return { data: ut, noder: n };
}

/**
 * Statistikk om produsentens EGEN kvantisering av flisen — den som gir
 * §14 sitt utgangspunkt: hva er det ekte flisspennet, og hvilket trinn gir
 * dagens adaptive 8-bit på det?
 */
function flisStatistikk(member) {
  const g = member.u.layer.geometry;
  let maksSpennKn = 0;
  let maksTrinnKn = 0;
  let verste = null;
  for (const [kanal, lk] of [
    ["u", member.u],
    ["v", member.v],
  ]) {
    const nivaaer = 2 ** lk.layer.bitsPerSample - 1;
    for (let sr = 0; sr < lk.layout.subtileRows; sr++) {
      for (let sc = 0; sc < lk.layout.subtileCols; sc++) {
        for (let k = 0; k < g.timeSteps; k++) {
          const p = lk.layer.subtileParams[sr][sc][k];
          const spenn = p.scale * nivaaer;
          if (spenn > maksSpennKn) {
            maksSpennKn = spenn;
            verste = { kanal, sr, sc, k };
          }
          if (p.scale > maksTrinnKn) maksTrinnKn = p.scale;
        }
      }
    }
  }
  return {
    maksSubflisSpennKn: maksSpennKn,
    maksSubflisTrinnKn: maksTrinnKn,
    versteSubflis: verste,
    produsentVaktbandKn: weather.windLayerMaxDecodeErrorKn(member),
    bitsPerSample: member.u.layer.bitsPerSample,
  };
}

/**
 * Laster ÉN flis: alle 30 medlemmer (indeks 0 = kontroll) dekodet til gitre.
 *
 * `medlemmer` begrenser hvor mange som lastes (minne: ett medlem er ~2 MB per
 * flis som Float32; 30 medlemmer × 2 fliser ≈ 120 MB).
 */
export function lastFlis(tileId, { medlemmer = Infinity } = {}) {
  const peker = lesPeker();
  const flis = peker.tiles.find((t) => t.tileId === tileId);
  if (flis === undefined) {
    throw new Error(
      `ukjent flis "${tileId}" — pekeren har ${peker.tiles.map((t) => t.tileId).join(", ")}`,
    );
  }
  const vindfelt = flis.fields
    .filter((f) => f.field === "wind")
    .sort((a, b) => a.member - b.member)
    .slice(0, medlemmer === Infinity ? undefined : medlemmer);

  const ut = [];
  let stats = null;
  for (const f of vindfelt) {
    const bytes = new Uint8Array(readFileSync(join(PAKKE_ROT, f.key)));
    const member = weather.windMemberLayersFromBytes(bytes);
    if (stats === null) stats = flisStatistikk(member);
    else {
      const s = flisStatistikk(member);
      if (s.maksSubflisSpennKn > stats.maksSubflisSpennKn) stats = s;
      // vaktbåndet rapporteres som maks over medlemmene
      stats.produsentVaktbandKn = Math.max(
        stats.produsentVaktbandKn,
        s.produsentVaktbandKn,
      );
    }
    const g = member.u.layer.geometry;
    const u = dekodLagHelt(member.u);
    const v = dekodLagHelt(member.v);
    ut.push({
      member: f.member,
      header: f.header,
      grid: {
        latMin: g.latMin,
        lonMin: g.lonMin,
        latStepDeg: g.latStepDeg,
        lonStepDeg: g.lonStepDeg,
        nodesLat: g.nodesLat,
        nodesLon: g.nodesLon,
        t0S: g.t0S,
        dtS: g.dtS,
        timeSteps: g.timeSteps,
        u: u.data,
        v: v.data,
      },
    });
  }
  return {
    tileId,
    bbox: flis.bbox,
    medlemmer: ut,
    produsentStats: stats,
    // Innholdsadresserte hasher for hvert medlem — pakken bygges om av en
    // annen agent med jevne mellomrom (og blobene er innholdsadresserte, så
    // de gamle forsvinner). Uten hashene her ville en rådatafil ikke kunne
    // si HVILKEN pakke den ble målt på.
    blobHasher: vindfelt.map((f) => ({ member: f.member, hash: f.hash })),
  };
}

/**
 * Bygger `WeatherField` per medlem av én eller flere fliser.
 *
 * Med flere fliser sys gitrene sammen per medlem — samme regel som
 * `@morild/weather::compositeWeatherField`: første flis med et definert svar
 * vinner, og fliser fra samme pakkebygg berører hverandre bare langs kanten.
 */
export function byggEkteFelt(fliser) {
  const antall = Math.min(...fliser.map((f) => f.medlemmer.length));
  const felt = [];
  for (let m = 0; m < antall; m++) {
    const gitre = fliser.map((f) => f.medlemmer[m].grid);
    felt.push(
      routingFixtures.gridWindWeatherField(gitre, {
        header: fliser[0].medlemmer[m].header,
      }),
    );
  }
  return felt;
}

/**
 * Snittet av flisenes lat/lon-bokser, krympet med `margDeg` slik at
 * feltprøvens gitter aldri havner utenfor dekningen (der ville hvert eneste
 * punkt telt som dekningstap og målingen sagt ingenting om kvantisering).
 */
export function ekteDomene(fliser, margDeg = 0.05) {
  const bokser = fliser.map((f) => ({
    lonMin: f.bbox[0],
    latMin: f.bbox[1],
    lonMax: f.bbox[2],
    latMax: f.bbox[3],
  }));
  return {
    latMin: Math.min(...bokser.map((b) => b.latMin)) + margDeg,
    latMax: Math.max(...bokser.map((b) => b.latMax)) - margDeg,
    lonMin: Math.min(...bokser.map((b) => b.lonMin)) + margDeg,
    lonMax: Math.max(...bokser.map((b) => b.lonMax)) - margDeg,
  };
}
