/**
 * Korridorsammenligning for golden-testene (spec §8.2).
 *
 * Golden-rutene sammenlignes **ikke** bit-eksakt på geometri: `Math.sin`,
 * `cos` og `atan2` er implementasjonsdefinerte på tvers av V8-versjoner, og
 * en bit-eksakt geometritest ville feilet ved neste Node-oppgradering uten
 * at noe var galt. I stedet krever vi at den nye ruten holder seg innenfor
 * en korridor rundt referansesporet, målt begge veier — slik at verken en
 * omvei eller en snarvei slipper gjennom.
 */
export interface TrackPoint {
  readonly lat: number;
  readonly lon: number;
}

/** Lokal flat projeksjon i nautiske mil rundt et referansepunkt. */
function project(p: TrackPoint, lat0: number): { x: number; y: number } {
  return {
    x: p.lon * 60 * Math.cos((lat0 * Math.PI) / 180),
    y: p.lat * 60,
  };
}

/** Korteste avstand fra punkt til linjestykke, i nm. */
function pointToSegmentNm(
  p: TrackPoint,
  a: TrackPoint,
  b: TrackPoint,
  lat0: number,
): number {
  const pp = project(p, lat0);
  const pa = project(a, lat0);
  const pb = project(b, lat0);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(pp.x - pa.x, pp.y - pa.y);
  let t = ((pp.x - pa.x) * dx + (pp.y - pa.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pp.x - (pa.x + t * dx), pp.y - (pa.y + t * dy));
}

/** Største avstand fra et punkt i `track` til nærmeste punkt på `reference`. */
export function maxDeviationNm(
  track: readonly TrackPoint[],
  reference: readonly TrackPoint[],
): number {
  if (track.length === 0 || reference.length === 0) return Infinity;
  const lat0 = reference[0]!.lat;
  let worst = 0;
  for (const p of track) {
    let best = Infinity;
    for (let i = 1; i < reference.length; i++) {
      const d = pointToSegmentNm(p, reference[i - 1]!, reference[i]!, lat0);
      if (d < best) best = d;
    }
    if (reference.length === 1) {
      best = pointToSegmentNm(p, reference[0]!, reference[0]!, lat0);
    }
    if (best > worst) worst = best;
  }
  return worst;
}

/**
 * Symmetrisk korridoravvik: verste avvik målt i begge retninger. En rute som
 * kutter en sving ville hatt lite avvik den ene veien og mye den andre.
 */
export function corridorDeviationNm(
  a: readonly TrackPoint[],
  b: readonly TrackPoint[],
): number {
  return Math.max(maxDeviationNm(a, b), maxDeviationNm(b, a));
}
