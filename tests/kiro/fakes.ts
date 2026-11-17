import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/analysis/index";
import type { Investigation, SourceFile, SourceSet } from "../../src/contracts/types";
import type { LiveDeps } from "../../src/features/liveSnapshot/openLiveSnapshot";

// Fakes for the investigation-ui store and registry, the fetch of demo/live.json, loadSample and
// the analysis client. They follow the shapes that design.md gives for LiveDeps; the real store and
// registry of investigation-ui are not on this branch yet.

export interface FakeState {
  investigation: Investigation | null;
  sourceText: Map<string, string> | null;
  demo: boolean | null;
  status: string;
  camera: { x: number; y: number; zoom: number };
  selection: { kind: "module"; id: string } | null;
  routeFilter: string | null;
  expandedWings: string[];
  layout: { layoutKey: string } | null;
  panel: string | null;
}

export interface FakeStore {
  getState(): FakeState;
  actions: {
    setStatus(message: string): void;
    openInvestigation(investigation: Investigation, sourceText: Map<string, string>, options: { demo: boolean }): void;
  };
  calls: { setStatus: string[]; openInvestigation: { investigation: Investigation; sourceText: Map<string, string>; options: { demo: boolean } }[] };
}

export function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    investigation: null,
    sourceText: null,
    demo: null,
    status: "",
    camera: { x: 10, y: 20, zoom: 1.5 },
    selection: null,
    routeFilter: null,
    expandedWings: ["src/orders"],
    layout: null,
    panel: null,
    ...overrides,
  };
}

export function makeFakeStore(initial: Partial<FakeState> = {}): FakeStore {
  let state = makeState(initial);
  const calls: FakeStore["calls"] = { setStatus: [], openInvestigation: [] };
  return {
    calls,
    getState: () => state,
    actions: {
      setStatus(message) {
        calls.setStatus.push(message);
        state = { ...state, status: message };
      },
      openInvestigation(investigation, sourceText, options) {
        calls.openInvestigation.push({ investigation, sourceText, options });
        state = { ...state, investigation, sourceText, demo: options.demo, layout: { layoutKey: "layout-1" } };
      },
    },
  };
}

export interface HandoffArgs {
  before: Investigation | null;
  after: Investigation;
  layoutKey: string | null;
}

export interface FakeRegistry {
  getHandoff(name: string): ((args: HandoffArgs) => Promise<void>) | null;
  handoffCalls: HandoffArgs[];
}

export function makeFakeRegistry(handoff: ((args: HandoffArgs) => Promise<void>) | null = null): FakeRegistry {
  const handoffCalls: HandoffArgs[] = [];
  return {
    handoffCalls,
    getHandoff: (name) =>
      name === "compare" && handoff !== null
        ? async (args) => {
            handoffCalls.push(args);
            await handoff(args);
          }
        : null,
  };
}

/** A minimal valid investigation with the live label. */
export function liveInvestigation(moduleCount = 2): Investigation {
  return {
    schemaVersion: 1,
    resolverMode: "documented-source-subset",
    sourceLabel: "live:haunts/manor",
    modules: Array.from({ length: moduleCount }, (_, i) => ({ id: `src/m${i}.ts`, sourceHash: "a".repeat(64), language: "ts" as const, parseStatus: "ok" as const })),
    imports: [],
    diagnostics: [],
    options: { ...DEFAULT_ANALYSIS_OPTIONS },
  };
}

export function beforeInvestigation(): Investigation {
  return { ...liveInvestigation(3), sourceLabel: "manor/before" };
}

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers with `respond` and records every call. */
export function makeFetch(respond: () => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function jsonResponse(value: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": contentType } });
}

export function sampleSet(): SourceSet {
  const files: SourceFile[] = [{ path: "src/a.ts", text: "export const a = 1;\n", bytes: 20 }];
  return { rootLabel: "manor/before", files, skipped: [] };
}

export type LoadSampleFake = LiveDeps["loadSample"];
