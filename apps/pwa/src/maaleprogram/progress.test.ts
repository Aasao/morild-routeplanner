import { describe, expect, it } from "vitest";
import { PROGRESS_STORAGE_KEY } from "./constants.js";
import { buildRunPlan, type RunSpec } from "./plan.js";
import {
  appendEvent,
  buildProgramResult,
  clearProgress,
  fnv1a64,
  loadProgress,
  packageFingerprint,
  recordRun,
  isCrashLooping,
  packageCheck,
  resumeFrom,
  saveProgress,
  startProgress,
  type RunRecord,
  type StorageLike,
} from "./progress.js";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const device = { userAgent: "test", hardwareConcurrency: 8, deviceMemoryGB: 4 };
const pkg = packageFingerprint({ blobHashes: ["bb", "aa"], init: "2026-09-27T12:00:00Z", memberCount: 29 });
const smallPlan: RunSpec[] = [
  { kind: "pool", id: "pool-4-r0", pool: 4, repeat: 0 },
  { kind: "solo", id: "solo-r0", repeat: 0 },
  { kind: "dummy", id: "dummy-spin-k1-r0", k: 1, variant: "spin", repeat: 0 },
];

function run(index: number, spec: RunSpec, heap: number | null = 12.5): RunRecord {
  return {
    index,
    id: spec.id,
    kind: spec.kind,
    pool: spec.kind === "pool" ? spec.pool : null,
    k: spec.kind === "dummy" ? spec.k : null,
    variant: spec.kind === "dummy" ? spec.variant : null,
    repeat: spec.repeat,
    startedAt: "t",
    wallMs: 1000,
    controlMs: 500,
    ensembleWallMs: null,
    control: [0, null, 400, 9000, 20, heap],
    members: spec.kind === "pool" ? [[1, 0, 300, 8000, 15, heap === null ? null : heap + 3]] : [],
    errors: 0,
    hiddenDuringRun: false,
  };
}

describe("måleprogrammets fremdrift (robusthet.md §6.4)", () => {
  it("pakke-hash er rekkefølgeuavhengig og stabil", () => {
    const a = packageFingerprint({ blobHashes: ["aa", "bb"], init: "x", memberCount: 1 });
    const b = packageFingerprint({ blobHashes: ["bb", "aa"], init: "x", memberCount: 1 });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    // Kjent FNV-1a-64-vektor: tom streng.
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
  });

  it("lagre → laste gir samme fremdrift; ødelagt/fremmed innhold gir null", () => {
    const storage = new MemoryStorage();
    const p = startProgress({ now: "t0", device, pkg, plan: smallPlan });
    expect(saveProgress(storage, p)).toBe(true);
    expect(loadProgress(storage)).toEqual(p);
    storage.map.set(PROGRESS_STORAGE_KEY, "{ikke json");
    expect(loadProgress(storage)).toBeNull();
    storage.map.set(PROGRESS_STORAGE_KEY, JSON.stringify({ schema: "morild-nettbrett-maaling/1" }));
    expect(loadProgress(storage)).toBeNull();
  });

  it("lager som nekter: saveProgress sier fra i stedet for å kaste", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(saveProgress(storage, startProgress({ now: "t0", device, pkg, plan: smallPlan }))).toBe(false);
  });

  it("gjenopptak etter omlasting: fortsetter på neste ukjørte, teller og logger avbruddet", () => {
    const storage = new MemoryStorage();
    let p = startProgress({ now: "t0", device, pkg, plan: smallPlan });
    p = recordRun(p, run(0, smallPlan[0]!), "t1");
    saveProgress(storage, p);

    // Siden forsvinner midt i kjøring 1 og lastes på nytt:
    const decision = resumeFrom(loadProgress(storage), smallPlan, "t2");
    expect(decision.kind).toBe("resume");
    if (decision.kind !== "resume") return;
    expect(decision.progress.nextIndex).toBe(1);
    expect(decision.progress.interruptions).toBe(1);
    expect(decision.progress.runs).toHaveLength(1);
    expect(decision.progress.events.at(-1)).toMatchObject({ kind: "interruption", at: "t2" });
    expect(decision.progress.events.at(-1)?.detail).toContain("solo-r0");

    // Et nytt avbrudd senere teller videre.
    saveProgress(storage, decision.progress);
    const again = resumeFrom(loadProgress(storage), smallPlan, "t3");
    expect(again.kind === "resume" && again.progress.interruptions).toBe(2);
  });

  it("packageCheck: samme fingeravtrykk ⇒ same; annen pakke (cron-bytte) ⇒ mismatch", () => {
    const p = startProgress({ now: "t0", device, pkg, plan: smallPlan });
    expect(packageCheck(p, pkg)).toBe("same");
    const other = packageFingerprint({ blobHashes: ["b".repeat(64)], init: pkg.init, memberCount: pkg.memberCount });
    expect(other.hash).not.toBe(pkg.hash);
    expect(packageCheck(p, other)).toBe("mismatch");
  });

  it("gjentatte avbrudd på SAMME kjøring ⇒ isCrashLooping; en registrert kjøring nullstiller", () => {
    let p = startProgress({ now: "t0", device, pkg, plan: smallPlan });
    p = recordRun(p, run(0, smallPlan[0]!), "t1");
    const first = resumeFrom(p, smallPlan, "t2");
    if (first.kind !== "resume") throw new Error("forventet resume");
    expect(isCrashLooping(first.progress)).toBe(false);
    const second = resumeFrom(first.progress, smallPlan, "t3");
    if (second.kind !== "resume") throw new Error("forventet resume");
    expect(isCrashLooping(second.progress)).toBe(true);
    const moved = recordRun(second.progress, run(1, smallPlan[1]!), "t4");
    expect(isCrashLooping(moved)).toBe(false);
    expect(moved.interruptions).toBe(2);
  });

  it("ingen lagret fremdrift ⇒ none; ferdig ⇒ done (ikke avbrudd); endret plan ⇒ plan-changed", () => {
    expect(resumeFrom(null, smallPlan, "t").kind).toBe("none");
    let p = startProgress({ now: "t0", device, pkg, plan: smallPlan });
    smallPlan.forEach((s, i) => {
      p = recordRun(p, run(i, s), `t${i + 1}`);
    });
    expect(p.status).toBe("done");
    expect(p.finishedAt).toBe("t3");
    const done = resumeFrom(p, smallPlan, "t9");
    expect(done.kind).toBe("done");
    expect(done.kind === "done" && done.progress.interruptions).toBe(0);

    const running = startProgress({ now: "t0", device, pkg, plan: smallPlan });
    expect(resumeFrom(running, buildRunPlan(), "t").kind).toBe("plan-changed");
  });

  it("resultat-JSON: skjema, pakke, konstanter, per-medlem-tupler og Worker-heap på toppnivå", () => {
    let p = startProgress({ now: "t0", device, pkg, plan: smallPlan });
    p = appendEvent(p, { at: "t0b", kind: "wake-lock-acquired" });
    p = recordRun(p, run(0, smallPlan[0]!), "t1");
    const partial = buildProgramResult(p);
    expect(partial.schema).toBe("morild-maaleprogram/1");
    expect(partial.complete).toBe(false);
    expect(partial.plannedRuns).toBe(3);
    expect(partial.package.hash).toBe(pkg.hash);
    expect(partial.constants.poolSizes).toEqual([4, 5, 6, 7]);
    expect(partial.memberTupleFields).toEqual([
      "memberIndex",
      "workerSlot",
      "searchMs",
      "labelsCreated",
      "decodeMs",
      "workerHeapMB",
    ]);
    expect(partial.workerMemoryApi).toBe(true);
    expect(partial.maxWorkerHeapMB).toBe(15.5);
    expect(partial.events.map((e) => e.kind)).toEqual(["program-start", "wake-lock-acquired"]);
    // Rund-tur gjennom JSON (det som faktisk sendes) er tapsfri.
    expect(JSON.parse(JSON.stringify(partial))).toEqual(partial);

    p = recordRun(p, run(1, smallPlan[1]!), "t2");
    p = recordRun(p, run(2, smallPlan[2]!), "t3");
    expect(buildProgramResult(p).complete).toBe(true);
  });

  it("uten performance.memory i Workerne: workerMemoryApi false og maxWorkerHeapMB null — ikke 0", () => {
    let p = startProgress({ now: "t0", device, pkg, plan: smallPlan });
    p = recordRun(p, run(0, smallPlan[0]!, null), "t1");
    const r = buildProgramResult(p);
    expect(r.workerMemoryApi).toBe(false);
    expect(r.maxWorkerHeapMB).toBeNull();
  });

  it("clearProgress fjerner fremdrift og ekstra nøkler", () => {
    const storage = new MemoryStorage();
    saveProgress(storage, startProgress({ now: "t0", device, pkg, plan: smallPlan }));
    storage.setItem("ekstra", "x");
    clearProgress(storage, ["ekstra"]);
    expect(storage.map.size).toBe(0);
  });
});
