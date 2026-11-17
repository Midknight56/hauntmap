import { createElement } from "react";
import type { Investigation } from "../contracts/types";
import type { Registry } from "../features/investigation/registry";
import type { InvestigationStore } from "../features/investigation/store";
import type { SceneHandle } from "../scene/types";
import { setTheme, type ThemeName } from "../styles/theme";

// The development hook `window.__hauntmap`. It exists only in the development server and in the build
// made with `--mode devhook` (`VITE_HAUNTMAP_DEVHOOK=1`); the release build contains none of it.

export const DEVHOOK_ENABLED: boolean = import.meta.env.DEV || import.meta.env["VITE_HAUNTMAP_DEVHOOK"] === "1";

export interface DevState {
  forceFailure: boolean;
  failAnalysis: "cycles" | "trace" | null;
  crashNext: boolean;
  scene: SceneHandle | null;
}

export const devState: DevState = { forceFailure: false, failAnalysis: null, crashNext: false, scene: null };

/** Throws once when the hook asked the next call of `name` to fail, then clears the request. */
export function forcedFailureGate(name: "cycles" | "trace"): void {
  if (devState.failAnalysis === name) {
    devState.failAnalysis = null;
    throw new Error("forced");
  }
}

/** Called by the error boundary once it has caught the forced render error. */
export function forcedCrashHandled(): void {
  devState.crashNext = false;
}

export interface DevHook {
  store: InvestigationStore;
  registry: Registry;
  /** `React.createElement`, so that a spec can register a stub control without bundling React. */
  h: typeof createElement;
  openInvestigation(inv: Investigation, source?: Record<string, string>): void;
  forceRendererFailure(on: boolean): void;
  loseContext(): void;
  failAnalysis(kind: "cycles" | "trace" | null): void;
  crashNextRender(): void;
  scene(): SceneHandle | null;
  /** Switch the palette (`candlelit-manor`, `moonlit-crypt` or `graveyard-fog`); the scene and the page follow at once. */
  setTheme(name: ThemeName): void;
}

declare global {
  interface Window {
    __hauntmap?: DevHook;
  }
}

export function installDevHook(store: InvestigationStore, registry: Registry): void {
  const hook: DevHook = {
    store,
    registry,
    h: createElement,
    openInvestigation(inv, source) {
      store.actions.openInvestigation(inv, source === undefined ? null : new Map(Object.entries(source)), { demo: false });
    },
    forceRendererFailure(on) {
      devState.forceFailure = on;
    },
    loseContext() {
      const canvas = document.querySelector("canvas");
      if (canvas === null) return;
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const extension = gl?.getExtension("WEBGL_lose_context") ?? null;
      if (extension !== null) extension.loseContext();
      else canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    },
    failAnalysis(kind) {
      devState.failAnalysis = kind;
    },
    crashNextRender() {
      devState.crashNext = true;
    },
    scene: () => devState.scene,
    setTheme(name) {
      setTheme(name);
    },
  };
  window.__hauntmap = hook;
}
