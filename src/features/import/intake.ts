import { createReadClient } from "./readFiles";
import type { IntakeArgs, IntakeDeps, IntakeKind, IntakeResult, IntakeService, IntakeState } from "./types";

// The intake service (Requirement 1): one dialog at a time, one pending promise, subscribers for the host.

/** True when a new file input has the `webkitdirectory` property, so that a folder can be chosen. */
export function hasDirectoryInput(doc: Document): boolean {
  return "webkitdirectory" in doc.createElement("input");
}

const GITHUB_UNAVAILABLE = "The GitHub route is not available in this build.";
const MAP_SELECTOR = '[role="application"][aria-label="Haunted map"]';

function currentDocument(deps: IntakeDeps): Document | null {
  return deps.doc ?? (typeof document === "undefined" ? null : document);
}

/**
 * Focus goes to the opener when it is still in the page, otherwise to the map wrapper (1.3). The map mounts a moment
 * after the investigation opens, so the wrapper is looked up again for up to two seconds.
 */
function restoreFocus(doc: Document | null, opener: Element | null): void {
  if (doc === null) return;
  const view = doc.defaultView;
  let attempts = 0;
  const attempt = (): void => {
    if (opener instanceof HTMLElement && opener.isConnected) {
      opener.focus();
      return;
    }
    const wrapper = doc.querySelector<HTMLElement>(MAP_SELECTOR);
    if (wrapper !== null) {
      wrapper.focus();
      return;
    }
    attempts += 1;
    if (attempts < 40 && view !== null) view.setTimeout(attempt, 50);
  };
  attempt();
}

export function createIntake(deps: IntakeDeps): IntakeService {
  const kinds: IntakeKind[] = deps.github === null ? ["local"] : ["local", "github"];
  let state: IntakeState = { dialog: null, readDelayMs: 0 };
  let pending: { promise: Promise<IntakeResult>; resolve: (result: IntakeResult) => void } | null = null;
  const listeners = new Set<() => void>();
  const readClient = createReadClient(deps.createReadWorker);

  const set = (next: IntakeState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const service: IntakeService = {
    kinds,
    deps,
    readClient,
    open(args: IntakeArgs) {
      if (state.dialog !== null && pending !== null) return pending.promise;
      if (args.kind === "github" && deps.github === null) return Promise.resolve({ ok: false, reason: "failed", message: GITHUB_UNAVAILABLE });
      let resolve!: (result: IntakeResult) => void;
      const promise = new Promise<IntakeResult>((done) => {
        resolve = done;
      });
      pending = { promise, resolve };
      const doc = currentDocument(deps);
      const active = doc?.activeElement ?? null;
      const opener = active === null || active === doc?.body ? null : active;
      set({ ...state, dialog: { kind: args.kind, purpose: args.purpose, opener } });
      return promise;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolve(result) {
      pending?.resolve(result);
    },
    close(result) {
      const opener = state.dialog?.opener ?? null;
      pending?.resolve(result);
      pending = null;
      if (state.dialog === null) return;
      set({ ...state, dialog: null });
      restoreFocus(currentDocument(deps), opener);
    },
    setReadDelay(ms) {
      set({ ...state, readDelayMs: Math.max(0, ms) });
    },
  };
  return service;
}
