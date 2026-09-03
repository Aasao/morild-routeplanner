/**
 * Engangsmåling — IKKE en del av `pnpm test` (for tung til å kjøre på hver
 * testkjøring; se `pipeline.test.ts` for en liten, rask smoke-test av
 * samme kodesti). Bygger en EKTE, kvantisert (`buildLayer`), delta-kodet
 * og gzippet vind-medlems-pakke for HELE Skjæløy→Skagen-bboxen på §9s
 * låste oppløsning (2,5 km, 48 t, 30 medlemmer) og rapporterer faktiske
 * byte-tall — dette er det FØRSTE datapunktet for §8s budsjettregel som
 * kommer fra en ekte bygget pakke, ikke bare en formel
 * (`packages/weather/src/budget.ts`, §17 pkt. 7).
 *
 * Kjøres manuelt: `pnpm --filter @morild/weather-pack measure-full-size`.
 *
 * **Data er SYNTETISK** (`dry-run-fixtures.ts`s glatte, analytiske mønster
 * — samme som `cli.ts`s demo), IKKE ekte MEPS. Tallet er derfor en
 * indikasjon, ikke en garanti: et glatt syntetisk felt komprimerer
 * sannsynligvis BEDRE enn et ekte MEPS-felt (mer høyfrekvent,
 * mindre-korrelert romlig/tidsmessig struktur) — se README.md og
 * `docs/specs/vaerpakker.md` §8 for hvordan tallet er merket der.
 *
 * Bboxen er identisk med `packages/weather/src/budget.test.ts`s
 * `SKJAELOY_SKAGEN_BBOX` (§7/§8s eget referansepunkt), slik at det
 * formel-baserte estimatet og denne ekte målingen er direkte
 * sammenlignbare.
 */
import { gzipSync } from "node:zlib";
import { serializeLayer } from "@morild/weather";
import { createDryRunFetch } from "./dry-run-fixtures.js";
import { buildUserAgent } from "./opendap-client.js";
import { buildWindMemberLayers, fetchWindComponents, type WindGridDims } from "./pipeline.js";

/** [west, south, east, north] — samme tall som `packages/weather/src/budget.test.ts`. */
const SKJAELOY_SKAGEN_BBOX: readonly [number, number, number, number] = [8.0, 57.4, 12.6, 59.7];

const RESOLUTION_KM = 2.5; // §9.1: kontroll OG alle 30 medlemmer på 2,5 km
const MEMBER_COUNT = 30; // §9.1 pkt. 4
const HORIZON_H = 48; // §9.1 pkt. 4: medlemshorisont
const TIME_STEP_H = 1; // §9.2: harde felt (TWS) er 1 t
const KM_PER_DEG_LAT = 111.32; // samme konstant som `packages/weather/src/tiles.ts`

function gridDims(bbox: readonly [number, number, number, number], resolutionKm: number): {
  readonly yCount: number;
  readonly xCount: number;
} {
  const [west, south, east, north] = bbox;
  const midLat = (south + north) / 2;
  const latSpanKm = (north - south) * KM_PER_DEG_LAT;
  const lonStepDeg = resolutionKm / (KM_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180));
  const yCount = Math.ceil(latSpanKm / resolutionKm) + 1;
  const xCount = Math.ceil((east - west) / lonStepDeg) + 1;
  return { yCount, xCount };
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function main(): Promise<void> {
  const timeCount = Math.floor(HORIZON_H / TIME_STEP_H) + 1; // 49
  const { yCount, xCount } = gridDims(SKJAELOY_SKAGEN_BBOX, RESOLUTION_KM);
  console.log(
    `=== Skjæløy→Skagen, ${RESOLUTION_KM} km / ${HORIZON_H} t / ${MEMBER_COUNT} medlemmer (vind, SYNTETISK felt) ===`,
  );
  console.log(`Rutenett: ${yCount} × ${xCount} noder, ${timeCount} tidssteg`);

  const window = { yStart: 0, yEnd: yCount - 1, xStart: 0, xEnd: xCount - 1 };
  const fetchImpl = createDryRunFetch();
  const userAgent = buildUserAgent("0.0.0-measure-full-size", "maasao@gmail.com");

  const components = await fetchWindComponents({
    datasetUrl: "https://thredds.met.no/thredds/dodsC/mepslatest/meps-measure",
    window,
    timeCount,
    memberCount: MEMBER_COUNT,
    userAgent,
    fetchImpl,
  });
  const dims: WindGridDims = components.dims;
  console.log(`Hentet: ${dims.timeCount}×${dims.memberCount}×${dims.yCount}×${dims.xCount} (t×medlem×y×x)`);

  let rawBytesTotal = 0;
  let gzipNoDeltaTotal = 0; // baseline: gzip direkte på rå kvantiserte byte, uten delta
  let gzipDeltaTotal = 0; // §8s "delta+gzip"

  for (let member = 0; member < MEMBER_COUNT; member++) {
    const { uLayer, vLayer } = buildWindMemberLayers({
      components,
      memberIndex: member,
      bbox: SKJAELOY_SKAGEN_BBOX,
      t0S: 0,
      dtS: TIME_STEP_H * 3600,
      bitsPerSample: 8,
    });
    const rawBytes = uLayer.payload.byteLength + vLayer.payload.byteLength;

    const plainU = serializeLayer(uLayer, { deltaCoded: false });
    const plainV = serializeLayer(vLayer, { deltaCoded: false });
    const deltaU = serializeLayer(uLayer, { deltaCoded: true });
    const deltaV = serializeLayer(vLayer, { deltaCoded: true });

    const plainCombined = new Uint8Array(plainU.length + plainV.length);
    plainCombined.set(plainU, 0);
    plainCombined.set(plainV, plainU.length);
    const deltaCombined = new Uint8Array(deltaU.length + deltaV.length);
    deltaCombined.set(deltaU, 0);
    deltaCombined.set(deltaV, deltaU.length);

    const gzipNoDelta = gzipSync(plainCombined).length;
    const gzipDelta = gzipSync(deltaCombined).length;

    rawBytesTotal += rawBytes;
    gzipNoDeltaTotal += gzipNoDelta;
    gzipDeltaTotal += gzipDelta;

    console.log(
      `  medlem ${member}: rått=${rawBytes}, gzip(uten delta)=${gzipNoDelta}, gzip(delta)=${gzipDelta}`,
    );
  }

  console.log("--- Sum, vind-medlemmer (30), u+v ---");
  console.log(`Rått (kvantiserte koder, ingen header/indeks): ${formatMB(rawBytesTotal)}`);
  console.log(
    `Etter gzip UTEN delta (baseline): ${formatMB(gzipNoDeltaTotal)} ` +
      `(faktor ${(rawBytesTotal / gzipNoDeltaTotal).toFixed(2)}×)`,
  );
  console.log(
    `Etter delta+gzip (§8s regnskapspost): ${formatMB(gzipDeltaTotal)} ` +
      `(faktor ${(rawBytesTotal / gzipDeltaTotal).toFixed(2)}×)`,
  );
  console.log(
    "\nMERK: delta-transformen endrer IKKE byte-ANTALLET (samme antall byte som rått, kun " +
      "byte-VERDIENE endres for å gjøre serien gzip-vennlig) — hele gevinsten kommer fra " +
      "gzip-tallet over, ikke fra et eget \"etter delta\"-mellomtall.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
