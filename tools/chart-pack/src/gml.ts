/**
 * tools/chart-pack — minimal, formåls-tilpasset GML-parser.
 *
 * IKKE en generell GML-parser: den kjenner kun de konkrete formene Kartverkets
 * "Sjøkart – Dybdedata"-WFS (GML 3.2, `app:`-navnerom) og Kystverkets
 * MapServer-WFS (GML 2/3.1.1, `ms:`-navnerom) faktisk returnerer, oppdaget
 * ved manuell utforskning i fase 1-bygging (se README.md, spike-seksjonen).
 * En full GML-bibliotek-avhengighet (f.eks. `ogr2ogr` via child_process)
 * ville vært tryggere for produksjon i full skala — dette er bevisst holdt
 * enkelt for én testflis. Se README "Avvik fra spec" for videre vurdering.
 *
 * Alle kildene returnerte koordinater som "lat lon"-par (bekreftet manuelt,
 * IKKE alltid det EPSG:4326-aksekonvensjonen offisielt tilsier) — parseren
 * konverterer eksplisitt til GeoJSON-konvensjonen `[lon, lat]`.
 */

export interface RawRing {
  readonly coords: readonly (readonly [number, number])[]; // [lon, lat]
  readonly closed: boolean;
}

/** Splitter en `gml:posList`-tekst i lat/lon-par og returnerer `[lon,lat]`. */
export function parsePosList(text: string): RawRing {
  const numbers = text.trim().split(/\s+/).map(Number);
  const coords: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const lat = numbers[i];
    const lon = numbers[i + 1];
    if (lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    coords.push([lon, lat]);
  }
  const first = coords[0];
  const last = coords[coords.length - 1];
  const closed =
    coords.length >= 4 &&
    !!first &&
    !!last &&
    Math.abs(first[0] - last[0]) < 1e-9 &&
    Math.abs(first[1] - last[1]) < 1e-9;
  return { coords, closed };
}

/** `gml:pos` er ett enkelt "lat lon"-par (brukt for Point-geometri). */
export function parsePos(text: string): readonly [number, number] | undefined {
  const numbers = text.trim().split(/\s+/).map(Number);
  const lat = numbers[0];
  const lon = numbers[1];
  if (lat === undefined || lon === undefined) return undefined;
  return [lon, lat];
}

function extractAll(source: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  return [...source.matchAll(pattern)].map((m) => m[1] ?? "");
}

function extractOne(source: string, tag: string): string | undefined {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  return pattern.exec(source)?.[1];
}

export interface DybdekurveFeature {
  readonly id: string;
  readonly dybdeM: number;
  readonly ring: RawRing;
}

/** Kartverket `app:Dybdekurve` — én `gml:posList` per feature (`app:grense`). */
export function parseDybdekurver(gml: string): DybdekurveFeature[] {
  const out: DybdekurveFeature[] = [];
  for (const member of extractMembers(gml, "app:Dybdekurve")) {
    const id = extractGmlId(member, "app:Dybdekurve");
    const dybdeStr = extractOne(member, "app:dybde");
    const posList = extractOne(member, "gml:posList");
    if (!id || dybdeStr === undefined || posList === undefined) continue;
    out.push({ id, dybdeM: Number(dybdeStr), ring: parsePosList(posList) });
  }
  return out;
}

export interface PointFeature {
  readonly id: string;
  readonly point: readonly [number, number];
  readonly dybdeM?: number;
}

/** Kartverket `app:Skjær`/`app:Grunne` — punkt under `app:posisjon`. */
export function parsePointFeatures(gml: string, elementName: string): PointFeature[] {
  const out: PointFeature[] = [];
  for (const member of extractMembers(gml, elementName)) {
    const id = extractGmlId(member, elementName);
    const posText = extractOne(member, "gml:pos");
    if (!id || posText === undefined) continue;
    const point = parsePos(posText);
    if (!point) continue;
    const dybdeStr = extractOne(member, "app:dybde");
    out.push({ id, point, ...(dybdeStr !== undefined ? { dybdeM: Number(dybdeStr) } : {}) });
  }
  return out;
}

export interface PolygonFeature {
  readonly id: string;
  readonly rings: readonly RawRing[]; // ring 0 = ytre, resten = hull
  readonly catzoc?: string;
}

/**
 * Kartverket `app:Tørrfall`/`app:Datakvalitet` — `gml:Polygon` med
 * `gml:exterior`/`gml:interior`, geometrien ligger under `app:område`.
 */
export function parsePolygonFeatures(gml: string, elementName: string): PolygonFeature[] {
  const out: PolygonFeature[] = [];
  for (const member of extractMembers(gml, elementName)) {
    const id = extractGmlId(member, elementName);
    if (!id) continue;
    const exteriorBlock = extractOne(member, "gml:exterior");
    const exteriorPosList = exteriorBlock !== undefined ? extractOne(exteriorBlock, "gml:posList") : undefined;
    if (exteriorPosList === undefined) continue;
    const rings: RawRing[] = [parsePosList(exteriorPosList)];
    for (const interiorBlock of extractAll(member, "gml:interior")) {
      const interiorPosList = extractOne(interiorBlock, "gml:posList");
      if (interiorPosList !== undefined) rings.push(parsePosList(interiorPosList));
    }
    const catzoc = extractOne(member, "app:catzoc");
    out.push({ id, rings, ...(catzoc !== undefined ? { catzoc } : {}) });
  }
  return out;
}

export interface KystverketLineFeature {
  readonly id: string;
  readonly ring: RawRing;
}

/** Kystverket `ms:layer_552` (Hovedled og biled) — `gml:LineString` under `ms:msGeometry`. */
export function parseKystverketLines(gml: string, elementName: string): KystverketLineFeature[] {
  const out: KystverketLineFeature[] = [];
  for (const member of extractMembers(gml, elementName)) {
    const id = extractGmlId(member, elementName);
    const posList = extractOne(member, "gml:posList");
    if (!id || posList === undefined) continue;
    out.push({ id, ring: parsePosList(posList) });
  }
  return out;
}

export interface KystverketPolygonFeature {
  readonly id: string;
  readonly polygons: readonly RawRing[][]; // MultiSurface -> flere polygoner, hver med ev. hull
}

/** Kystverket `ms:layer_554` (Farledsareal) — `gml:MultiSurface` med `gml:Polygon`-medlemmer. */
export function parseKystverketMultiSurface(gml: string, elementName: string): KystverketPolygonFeature[] {
  const out: KystverketPolygonFeature[] = [];
  for (const member of extractMembers(gml, elementName)) {
    const id = extractGmlId(member, elementName);
    if (!id) continue;
    const polygons: RawRing[][] = [];
    for (const surfaceMember of extractAll(member, "gml:surfaceMember")) {
      const exteriorBlock = extractOne(surfaceMember, "gml:exterior");
      const exteriorPosList = exteriorBlock !== undefined ? extractOne(exteriorBlock, "gml:posList") : undefined;
      if (exteriorPosList === undefined) continue;
      const rings: RawRing[] = [parsePosList(exteriorPosList)];
      for (const interiorBlock of extractAll(surfaceMember, "gml:interior")) {
        const interiorPosList = extractOne(interiorBlock, "gml:posList");
        if (interiorPosList !== undefined) rings.push(parsePosList(interiorPosList));
      }
      polygons.push(rings);
    }
    out.push({ id, polygons });
  }
  return out;
}

function extractMembers(gml: string, elementName: string): string[] {
  // Både wfs:member (WFS 2.0) og gml:featureMember (WFS 1.1.0) brukes,
  // avhengig av kilde.
  const pattern = new RegExp(`<${elementName}[^>]*>([\\s\\S]*?)</${elementName}>`, "g");
  return [...gml.matchAll(pattern)].map((m) => m[0]);
}

function extractGmlId(member: string, elementName: string): string | undefined {
  const pattern = new RegExp(`<${elementName}[^>]*gml:id="([^"]+)"`);
  return pattern.exec(member)?.[1];
}
