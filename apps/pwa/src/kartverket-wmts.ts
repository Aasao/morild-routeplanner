/**
 * Kartverket WMTS ("sjokartraster", docs/specs/app-skjelett.md §5.2) — KVP
 * GetTile-URL-bygging og en MapLibre `addProtocol`-adapter.
 *
 * WMTS-en bruker null-utfylte to-sifrede `TileMatrix`-identifikatorer for
 * zoom 0-9 (`"00"`..`"09"`), deretter vanlige tall fra 10 og opp
 * (`"10"`..`"18"`) — bekreftet mot den faktiske `GetCapabilities`
 * 2026-09-03. MapLibres `{z}/{x}/{y}`-tile-URL-mal støtter ikke betinget
 * nullutfylling, så vi registrerer en `kvwmts://`-protokoll som fanger opp
 * den allerede-substituerte URL-en, parser ut z/x/y, og bygger den ekte
 * KVP `GetTile`-URL-en selv.
 *
 * Ingen mellomlagring her (docs/legal/kartverket-sjokart-raster-wmts.md):
 * dette er en ren klient-side URL-oversettelse, ikke en proxy. Kartverkets
 * CDN sender selv `access-control-allow-origin: *` (verifisert 2026-09-03),
 * så et rent nettleser-`fetch` fungerer uten Worker-innblanding.
 */

const KARTVERKET_WMTS_BASE = "https://cache.kartverket.no/v1/service";
export const KARTVERKET_LAYER = "sjokartraster";
export const KARTVERKET_TILEMATRIXSET = "webmercator";
export const KARTVERKET_MAX_ZOOM = 18;

/** Registrert MapLibre-protokollnavn brukt i kildens `tiles`-mal. */
export const KVWMTS_PROTOCOL = "kvwmts";
export const KVWMTS_TILE_TEMPLATE = `${KVWMTS_PROTOCOL}://tile/{z}/{x}/{y}`;

const KVWMTS_URL_PATTERN = /^kvwmts:\/\/tile\/(\d+)\/(\d+)\/(\d+)$/;

export interface TileCoords {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/**
 * WMTS-ens TileMatrix-identifikator for et gitt zoomnivå: to sifre
 * null-utfylt for 0-9, deretter tallet uendret.
 */
export function tileMatrixId(z: number): string {
  return z < 10 ? `0${z}` : `${z}`;
}

/** Parser koordinatene ut av en allerede MapLibre-substituert kvwmts-URL. */
export function parseKvwmtsUrl(url: string): TileCoords {
  const match = KVWMTS_URL_PATTERN.exec(url);
  const zStr = match?.[1];
  const xStr = match?.[2];
  const yStr = match?.[3];
  if (zStr === undefined || xStr === undefined || yStr === undefined) {
    throw new Error(`Uventet ${KVWMTS_PROTOCOL}-URL: "${url}"`);
  }
  return { z: Number(zStr), x: Number(xStr), y: Number(yStr) };
}

/** Bygger den ekte Kartverket WMTS KVP GetTile-URL-en for en flis. */
export function kartverketTileUrl({ z, x, y }: TileCoords): string {
  const params = new URLSearchParams({
    service: "WMTS",
    request: "GetTile",
    version: "1.0.0",
    layer: KARTVERKET_LAYER,
    style: "default",
    format: "image/png",
    tilematrixset: KARTVERKET_TILEMATRIXSET,
    tilematrix: tileMatrixId(z),
    tilerow: String(y),
    tilecol: String(x),
  });
  return `${KARTVERKET_WMTS_BASE}?${params.toString()}`;
}

/** Signaturen MapLibre GL JS' `addProtocol` faktisk har (ikke importert her — se merknad nederst). */
export type AddProtocolFn = (
  name: string,
  handler: (
    params: { readonly url: string },
    abortController: AbortController,
  ) => Promise<{ readonly data: ArrayBuffer }>,
) => void;

/**
 * Registrerer `kvwmts://`-protokollen. Kalles én gang, før kartet
 * opprettes (`map.ts`). Tar `addProtocol` som parameter i stedet for å
 * importere `maplibre-gl` direkte her — holder denne modulens rene
 * URL-/parse-logikk (`tileMatrixId`, `parseKvwmtsUrl`, `kartverketTileUrl`)
 * testbar uten et WebGL/DOM-miljø.
 */
export function registerKartverketProtocol(addProtocol: AddProtocolFn): void {
  addProtocol(KVWMTS_PROTOCOL, async (params, abortController) => {
    const coords = parseKvwmtsUrl(params.url);
    const response = await fetch(kartverketTileUrl(coords), {
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`Kartverket WMTS svarte ${response.status} for ${params.url}`);
    }
    return { data: await response.arrayBuffer() };
  });
}
