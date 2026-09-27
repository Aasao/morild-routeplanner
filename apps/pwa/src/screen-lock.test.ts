import { describe, expect, it } from "vitest";
import {
  createScreenLock,
  screenLockStatusText,
  type ScreenLockEvent,
  type ScreenLockState,
  type VisibilityDocumentLike,
  type WakeLockLike,
  type WakeLockSentinelLike,
} from "./screen-lock.js";

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  private readonly listeners: (() => void)[] = [];
  addEventListener(_type: "release", listener: () => void): void {
    this.listeners.push(listener);
  }
  release(): Promise<void> {
    if (!this.released) {
      this.released = true;
      this.listeners.forEach((l) => l());
    }
    return Promise.resolve();
  }
  /** Systemet slipper låsen (fanen skjult). */
  systemRelease(): void {
    void this.release();
  }
}

class FakeWakeLock implements WakeLockLike {
  readonly sentinels: FakeSentinel[] = [];
  deny: Error | null = null;
  request(): Promise<WakeLockSentinelLike> {
    if (this.deny !== null) return Promise.reject(this.deny);
    const s = new FakeSentinel();
    this.sentinels.push(s);
    return Promise.resolve(s);
  }
}

class FakeDocument implements VisibilityDocumentLike {
  visibilityState = "visible";
  private listeners: (() => void)[] = [];
  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.push(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  setVisibility(v: string): void {
    this.visibilityState = v;
    this.listeners.forEach((l) => l());
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(opts: { secure?: boolean; wakeLock?: FakeWakeLock | undefined } = {}) {
  const doc = new FakeDocument();
  const wakeLock = "wakeLock" in opts ? opts.wakeLock : new FakeWakeLock();
  const states: ScreenLockState[] = [];
  const events: ScreenLockEvent[] = [];
  const lock = createScreenLock({
    wakeLock,
    isSecureContext: opts.secure ?? true,
    document: doc,
    onState: (s) => states.push(s),
    onEvent: (e) => events.push(e),
  });
  return { doc, wakeLock, states, events, lock };
}

describe("skjermlås-tilstandsmaskinen (robusthet.md §6.4)", () => {
  it("tas ved start og slippes når beregningen er ferdig", async () => {
    const { lock, wakeLock, events } = setup();
    await lock.acquire();
    expect(lock.state()).toBe("held");
    await lock.release();
    expect(lock.state()).toBe("released-done");
    expect(wakeLock!.sentinels[0]!.released).toBe(true);
    expect(events).toEqual([{ kind: "acquired" }, { kind: "released", by: "app" }]);
    expect(screenLockStatusText(lock.state())).toBe("Skjermlås: sluppet — beregningen er ferdig");
  });

  it("tas på nytt ved visibilitychange → synlig mens beregningen pågår", async () => {
    const { lock, wakeLock, doc } = setup();
    await lock.acquire();
    doc.visibilityState = "hidden";
    wakeLock!.sentinels[0]!.systemRelease();
    doc.setVisibility("hidden");
    expect(lock.state()).toBe("released-by-system");
    doc.setVisibility("visible");
    await flush();
    expect(lock.state()).toBe("held");
    expect(wakeLock!.sentinels).toHaveLength(2);
  });

  it("tas IKKE på nytt etter at beregningen er ferdig", async () => {
    const { lock, wakeLock, doc } = setup();
    await lock.acquire();
    await lock.release();
    doc.setVisibility("hidden");
    doc.setVisibility("visible");
    await flush();
    expect(wakeLock!.sentinels).toHaveLength(1);
    expect(lock.state()).toBe("released-done");
  });

  it("usikker kontekst: ærlig «krever sikker kontekst», aldri «holdt»", async () => {
    const { lock } = setup({ secure: false });
    await lock.acquire();
    expect(lock.state()).toBe("unavailable-insecure");
    expect(screenLockStatusText(lock.state())).toBe(
      "Skjermlås: ikke tilgjengelig: krever sikker kontekst (https eller localhost)",
    );
    await lock.release();
    expect(lock.state()).toBe("unavailable-insecure");
  });

  it("mangler API-et: egen tekst", async () => {
    const { lock } = setup({ wakeLock: undefined });
    await lock.acquire();
    expect(lock.state()).toBe("unavailable-unsupported");
  });

  it("avslått av nettleseren: status og hendelse", async () => {
    const wl = new FakeWakeLock();
    wl.deny = new Error("NotAllowedError");
    const { lock, events } = setup({ wakeLock: wl });
    await lock.acquire();
    expect(lock.state()).toBe("denied");
    expect(screenLockStatusText(lock.state())).toBe("Skjermlås: avslått av nettleseren");
    expect(events).toEqual([{ kind: "denied", message: "NotAllowedError" }]);
  });

  it("sent avslag etter at beregningen er ferdig overskriver ikke «sluppet — ferdig»", async () => {
    let rejectRequest: (err: Error) => void = () => undefined;
    const slow: WakeLockLike = {
      request: () =>
        new Promise<WakeLockSentinelLike>((_, reject) => {
          rejectRequest = reject;
        }),
    };
    const { lock, events } = setup({ wakeLock: slow as FakeWakeLock });
    const pending = lock.acquire();
    await lock.release();
    rejectRequest(new Error("NotAllowedError"));
    await pending;
    expect(lock.state()).toBe("released-done");
    expect(events).toEqual([]);
  });

  it("skjult side ved start: venter og tar låsen når siden blir synlig", async () => {
    const { lock, doc, wakeLock } = setup();
    doc.visibilityState = "hidden";
    await lock.acquire();
    expect(wakeLock!.sentinels).toHaveLength(0);
    doc.setVisibility("visible");
    await flush();
    expect(lock.state()).toBe("held");
  });

  it("dispose fjerner lytteren", () => {
    const { lock, doc } = setup();
    expect(doc.listenerCount).toBe(1);
    lock.dispose();
    expect(doc.listenerCount).toBe(0);
  });
});
