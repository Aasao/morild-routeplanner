/**
 * Minimal binærheap for Dijkstra-oppbyggingen av vannavstandsfeltet.
 *
 * Portert fra v1 (`hPush`/`hPop`), med én endring: uavgjort på prioritet
 * brytes på verdien (celleindeksen), slik at pop-rekkefølgen er **total** og
 * ikke avhenger av heapens interne omorganisering. Det påvirker ikke det
 * ferdige feltet — Dijkstra gir samme avstander uansett tie-break — men det
 * gjør kjøringen byte-deterministisk, som er kravet i §5.1.
 *
 * Parallelle typede arrays framfor `[pri, val]`-par: ingen allokering per
 * innsetting.
 */
export class MinHeap {
  private priority: Float64Array;
  private value: Int32Array;
  private size = 0;

  constructor(initialCapacity = 1024) {
    const n = Math.max(1, initialCapacity);
    this.priority = new Float64Array(n);
    this.value = new Int32Array(n);
  }

  get length(): number {
    return this.size;
  }

  private ensure(n: number): void {
    if (n <= this.priority.length) return;
    const next = Math.max(n, this.priority.length * 2);
    const p = new Float64Array(next);
    p.set(this.priority);
    const v = new Int32Array(next);
    v.set(this.value);
    this.priority = p;
    this.value = v;
  }

  /** Er a strengt før b i heap-rekkefølgen? Total ordning. */
  private before(ai: number, bi: number): boolean {
    const pa = this.priority[ai]!;
    const pb = this.priority[bi]!;
    if (pa !== pb) return pa < pb;
    return this.value[ai]! < this.value[bi]!;
  }

  private swap(a: number, b: number): void {
    const p = this.priority[a]!;
    this.priority[a] = this.priority[b]!;
    this.priority[b] = p;
    const v = this.value[a]!;
    this.value[a] = this.value[b]!;
    this.value[b] = v;
  }

  push(priority: number, value: number): void {
    this.ensure(this.size + 1);
    let i = this.size++;
    this.priority[i] = priority;
    this.value[i] = value;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Popper laveste prioritet. Kaster hvis heapen er tom. */
  pop(): { priority: number; value: number } {
    if (this.size === 0) throw new Error("pop på tom heap");
    const top = { priority: this.priority[0]!, value: this.value[0]! };
    this.size--;
    if (this.size > 0) {
      this.priority[0] = this.priority[this.size]!;
      this.value[0] = this.value[this.size]!;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.size && this.before(left, smallest)) smallest = left;
        if (right < this.size && this.before(right, smallest)) smallest = right;
        if (smallest === i) break;
        this.swap(smallest, i);
        i = smallest;
      }
    }
    return top;
  }
}
