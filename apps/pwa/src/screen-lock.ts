/**
 * Skjermlås under beregning (robusthet.md §6.4, D13.3 a): appen holder en
 * Screen Wake Lock fra værflyten starter til ensemble, perturbasjon og
 * nødhavnprofil er ferdige, og slipper den deretter. Slipper SYSTEMET låsen
 * (fanen skjult, skjermen av) mens beregningen pågår, tas den på nytt ved
 * `visibilitychange` → synlig.
 *
 * Ren tilstandsmaskin med injisert `wakeLock`/`document` — ingen globaler
 * leses her, så den testes uten nettleser (`screen-lock.test.ts`). Ren
 * UI/plattform: rører verken motor eller robustness.
 *
 * Ærlig status (N2): hver tilstand har én fast tekst i diagnostikken, og
 * «utilgjengelig» skiller mellom usikker kontekst (http over LAN-IP — det
 * vanlige tilfellet på nettbrettet uten Chrome-flagget) og en nettleser som
 * mangler API-et.
 */

/** Den delmengden av `WakeLockSentinel` vi bruker. */
export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

/** Den delmengden av `navigator.wakeLock` vi bruker. */
export interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/** Den delmengden av `document` vi bruker. */
export interface VisibilityDocumentLike {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export type ScreenLockState =
  /** Ikke bedt om ennå. */
  | "idle"
  /** Forespørsel sendt, svar ikke kommet. */
  | "requesting"
  | "held"
  /** Beregningen er ferdig og vi slapp låsen selv. */
  | "released-done"
  /** Systemet slapp låsen (fanen skjult) mens beregningen pågår — tas igjen ved synlig. */
  | "released-by-system"
  | "unavailable-insecure"
  | "unavailable-unsupported"
  | "denied";

/** Faste statustekster (spec-en §6.4 gir de fire første ordrett). */
export function screenLockStatusText(state: ScreenLockState): string {
  switch (state) {
    case "held":
      return "Skjermlås: holdt";
    case "released-done":
      return "Skjermlås: sluppet — beregningen er ferdig";
    case "unavailable-insecure":
      return "Skjermlås: ikke tilgjengelig: krever sikker kontekst (https eller localhost)";
    case "denied":
      return "Skjermlås: avslått av nettleseren";
    case "unavailable-unsupported":
      return "Skjermlås: ikke tilgjengelig: nettleseren mangler Wake Lock-API-et";
    case "released-by-system":
      return "Skjermlås: sluppet av systemet (fanen skjult) — tas på nytt når fanen er synlig";
    case "requesting":
      return "Skjermlås: ber om lås …";
    case "idle":
      return "Skjermlås: ikke bedt om";
  }
}

/** Hendelser til måleprogrammets logg (§6.4). */
export type ScreenLockEvent =
  | { readonly kind: "acquired" }
  | { readonly kind: "released"; readonly by: "app" | "system" }
  | { readonly kind: "denied"; readonly message: string }
  | { readonly kind: "visibility"; readonly state: string };

export interface ScreenLockDeps {
  /** `navigator.wakeLock` — `undefined` når API-et mangler. */
  readonly wakeLock: WakeLockLike | undefined;
  /** `window.isSecureContext`. */
  readonly isSecureContext: boolean;
  readonly document: VisibilityDocumentLike;
  readonly onState?: ((state: ScreenLockState) => void) | undefined;
  readonly onEvent?: ((event: ScreenLockEvent) => void) | undefined;
}

export interface ScreenLock {
  /** Beregningen starter: ta låsen og hold den (tas på nytt ved synlig). */
  acquire(): Promise<void>;
  /** Beregningen er ferdig: slipp låsen og slutt å ta den på nytt. */
  release(): Promise<void>;
  state(): ScreenLockState;
  /** Fjern `visibilitychange`-lytteren (tester/nedrigging). */
  dispose(): void;
}

export function createScreenLock(deps: ScreenLockDeps): ScreenLock {
  let state: ScreenLockState = "idle";
  /** Sant fra `acquire()` til `release()` — beregningen pågår. */
  let wanted = false;
  let sentinel: WakeLockSentinelLike | null = null;

  const setState = (next: ScreenLockState): void => {
    state = next;
    deps.onState?.(next);
  };

  async function request(): Promise<void> {
    if (!deps.isSecureContext) {
      setState("unavailable-insecure");
      return;
    }
    if (deps.wakeLock === undefined) {
      setState("unavailable-unsupported");
      return;
    }
    // Wake Lock kan bare tas på en synlig side; skjult ⇒ vent på synlig.
    if (deps.document.visibilityState !== "visible") {
      setState("released-by-system");
      return;
    }
    setState("requesting");
    try {
      const s = await deps.wakeLock.request("screen");
      if (!wanted) {
        // Beregningen ble ferdig mens forespørselen var ute.
        await s.release();
        return;
      }
      sentinel = s;
      s.addEventListener("release", () => {
        if (sentinel !== s) return;
        sentinel = null;
        if (wanted) {
          deps.onEvent?.({ kind: "released", by: "system" });
          setState("released-by-system");
        }
      });
      deps.onEvent?.({ kind: "acquired" });
      setState("held");
    } catch (err) {
      // Ble beregningen ferdig mens forespørselen var ute, står
      // «sluppet — ferdig»; et sent avslag skal ikke overskrive det.
      if (!wanted) return;
      const message = err instanceof Error ? err.message : String(err);
      deps.onEvent?.({ kind: "denied", message });
      setState("denied");
    }
  }

  const onVisibility = (): void => {
    const vis = deps.document.visibilityState;
    deps.onEvent?.({ kind: "visibility", state: vis });
    if (wanted && vis === "visible" && sentinel === null && state !== "requesting") {
      void request();
    }
  };
  deps.document.addEventListener("visibilitychange", onVisibility);

  return {
    async acquire() {
      wanted = true;
      if (sentinel !== null && !sentinel.released) return;
      await request();
    },
    async release() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      if (s !== null && !s.released) {
        await s.release();
        deps.onEvent?.({ kind: "released", by: "app" });
      }
      // Utilgjengelig/avslått forblir ærlig stående — vi har aldri holdt noe.
      if (state === "held" || state === "released-by-system" || state === "requesting") {
        setState("released-done");
      }
    },
    state: () => state,
    dispose() {
      deps.document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/** Nettleserens `navigator.wakeLock`/`document`/`isSecureContext` — kun i hovedtråden. */
export function browserScreenLockDeps(): Pick<ScreenLockDeps, "wakeLock" | "isSecureContext" | "document"> {
  const nav = navigator as unknown as { readonly wakeLock?: WakeLockLike };
  return {
    wakeLock: nav.wakeLock,
    isSecureContext: window.isSecureContext,
    document,
  };
}
