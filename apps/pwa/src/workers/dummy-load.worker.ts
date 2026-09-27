/**
 * Dummy-last for måleprogrammet (robusthet.md §6.4 pkt. 3, D13.5 bolk 1).
 * Gjør INGEN ruting — den eneste jobben er å belaste enheten på én av tre
 * måter mens kontrollmedlemmet søkes alene på en annen Worker, så
 * analysen kan skille mekanismene bak ~44 vs ~95 µs/etikett:
 *
 * - `spin`: ren regnesløyfe uten minnebruk (sprang ved k ≥ 2 ⇒ store kjerner oppbrukt)
 * - `stream`: leser gjennom en `Float64Array` på 64 MB i løkke (⇒ minnebåndbredde)
 * - `alloc`: lager og kaster små objekter i løkke (⇒ GC-trykk)
 *
 * Svarer `dummy-ready` når lasten er satt opp (for `stream`: etter at
 * matrisen er fylt), og går deretter i en uendelig løkke til hovedtråden
 * kaller `terminate()`. Meldingen leveres selv om denne tråden aldri gir
 * fra seg kontrollen igjen — `postMessage` køes i mottakerens løkke.
 *
 * Meldingstypene er strukturelle kopier av `../maaleprogram/runner.ts`
 * (egne TS-prosjekter, samme begrunnelse som `weather-routing.worker.ts`).
 */

type DummyVariant = "spin" | "stream" | "alloc";

interface StartDummyMessage {
  readonly type: "start-dummy";
  readonly variant: DummyVariant;
  readonly streamBytes: number;
}

interface DummyReadyMessage {
  readonly type: "dummy-ready";
  readonly variant: DummyVariant;
}

/** Resultatet skrives hit så JIT-en ikke kan fjerne løkkene som død kode. */
let sink = 0;

function spin(): never {
  let x = 1.0001;
  for (let i = 0; ; i += 1) {
    x = x * 1.0000001 + 1e-9;
    if (x > 2) x -= 1;
    if ((i & 0xffffff) === 0) sink = x;
  }
}

function stream(bytes: number): () => never {
  const a = new Float64Array(Math.max(1, Math.floor(bytes / 8)));
  for (let i = 0; i < a.length; i += 1) a[i] = i & 0xff;
  return () => {
    for (;;) {
      let sum = 0;
      for (let i = 0; i < a.length; i += 1) sum += a[i]!;
      sink = sum;
    }
  };
}

function alloc(): never {
  // Ring av 1024 plasser: hvert nytt objekt gjør et gammelt til søppel, så
  // det lever kort (ung generasjon) og GC-en jobber hele tiden.
  const ring: ({ a: number; b: number[] } | null)[] = new Array<{ a: number; b: number[] } | null>(1024).fill(null);
  for (let i = 0; ; i += 1) {
    ring[i & 1023] = { a: i, b: [i, i + 1, i + 2] };
    if ((i & 0xfffff) === 0) sink = ring[(i + 1) & 1023]?.a ?? sink;
  }
}

self.addEventListener("message", (event: MessageEvent<StartDummyMessage>) => {
  const msg = event.data;
  if (msg.type !== "start-dummy") return;
  const run: () => never =
    msg.variant === "stream" ? stream(msg.streamBytes) : msg.variant === "alloc" ? alloc : spin;
  self.postMessage({ type: "dummy-ready", variant: msg.variant } satisfies DummyReadyMessage);
  run();
});

// `sink` leses aldri — eksportert tom verdi holder filen som modul.
export {};
void sink;
