/**
 * Seedet PRNG for **testfiksturer**, aldri for motoren.
 *
 * Motoren inneholder ingen `Math.random` (håndhevet av arkitekturtesten og
 * av `src/determinism-source.test.ts`). Når golden-fiksturene trenger
 * «tilfeldige» værfelt, skal tilfeldigheten ligge her — seedet, reproduserbar
 * og utenfor det som pakkes.
 *
 * mulberry32: liten, rask, og med samme sekvens i enhver JS-motor fordi den
 * kun bruker heltallsoperasjoner på 32 bit.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
