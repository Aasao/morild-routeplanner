/**
 * Syntetiske NorKyst-lignende gitter for strømtestene (`current-*.test.ts`).
 * IKKE brukt av produksjonskoden.
 *
 * `polarStereoGrid` lager et ekte (sfærisk) polarstereografisk gitter med
 * NorKysts parametre — sentralmeridian 70°Ø, sann skala ved 60°N, 800 m
 * celler — slik at gitteraksene står ~60° dreid mot lat/lon i Skagerrak,
 * akkurat som den målte rotasjonen i geometrispiken (−59…−60°).
 */
import type { NativeGrid } from "./current-geometry.js";

const R = 6_371_000;
const LAMBDA0_DEG = 70;
const K0 = (1 + Math.sin((60 * Math.PI) / 180)) / 2;
const DEG = Math.PI / 180;

export function stereoForward(lat: number, lon: number): { x: number; y: number } {
  const rho = 2 * R * K0 * Math.tan(Math.PI / 4 - (lat * DEG) / 2);
  const dl = (lon - LAMBDA0_DEG) * DEG;
  return { x: rho * Math.sin(dl), y: -rho * Math.cos(dl) };
}

export function stereoInverse(x: number, y: number): { lat: number; lon: number } {
  const rho = Math.hypot(x, y);
  const lat = (Math.PI / 2 - 2 * Math.atan(rho / (2 * R * K0))) / DEG;
  const lon = LAMBDA0_DEG + Math.atan2(x, -y) / DEG;
  return { lat, lon };
}

/**
 * `yCount × xCount` noder, 800 m celle, sentrert på (lat0, lon0). Row-major
 * `y*xCount+x`. Projeksjonens x/y-akser er gitterets akser — i Skagerrak
 * står de ~60° dreid mot øst/nord.
 */
export function polarStereoGrid(lat0: number, lon0: number, yCount: number, xCount: number, cellM = 800): NativeGrid {
  const c = stereoForward(lat0, lon0);
  const lat = new Float64Array(yCount * xCount);
  const lon = new Float64Array(yCount * xCount);
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const p = stereoInverse(c.x + (x - (xCount - 1) / 2) * cellM, c.y + (y - (yCount - 1) / 2) * cellM);
      lat[y * xCount + x] = p.lat;
      lon[y * xCount + x] = p.lon;
    }
  }
  return { yCount, xCount, lat, lon };
}

/** Deterministisk PRNG (mulberry32) — samme seed, samme tall. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
