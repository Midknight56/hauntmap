// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/analysis/index";
import { validateInvestigation } from "../../src/contracts/validate";
import { configure, LiveSnapshotControl } from "../../src/features/liveSnapshot/LiveSnapshotControl";
import { openLiveSnapshot } from "../../src/features/liveSnapshot/openLiveSnapshot";
import type { LiveDeps } from "../../src/features/liveSnapshot/openLiveSnapshot";
import { beforeInvestigation, jsonResponse, liveInvestigation, makeFakeRegistry, makeFakeStore, makeFetch, sampleSet } from "./fakes";
import type { FakeStore, HandoffArgs } from "./fakes";

// Requirements 8.1 to 8.9 and 8.11, with a fake store, registry, fetch, loadSample and analysis
// client. Needs jsdom and React Testing Library, which investigation-ui installs; until then this
// file is created but the Vitest include does not collect it. The exact strings are copied from
// design.md, not imported from messages.ts.

const MISSING = "No live snapshot yet. Run `pnpm hauntmap analyze samples/manor --out public/demo/live.json`, or let the Kiro hook write it.";
const NO_COMPARE = "Comparison is not available in this build.";

interface Setup {
  store: FakeStore;
  registry: ReturnType<typeof makeFakeRegistry>;
  deps: LiveDeps;
  fetchCalls: ReturnType<typeof makeFetch>["calls"];
  analyzeCalls: unknown[];
  loadCalls: string[];
}

function setup(options: {
  respond?: () => Response | Promise<Response>;
  withInvestigation?: boolean;
  handoff?: ((args: HandoffArgs) => Promise<void>) | null;
  analyze?: () => Promise<unknown>;
  loadSample?: () => Promise<unknown>;
}): Setup {
  const store = makeFakeStore({ investigation: options.withInvestigation === false ? null : beforeInvestigation() });
  const registry = makeFakeRegistry(options.handoff ?? null);
  const { fetchImpl, calls } = makeFetch(options.respond ?? (() => jsonResponse(liveInvestigation(4))));
  const analyzeCalls: unknown[] = [];
  const loadCalls: string[] = [];
  const deps = {
    store,
    registry,
    base: "/",
    fetchImpl,
    now: () => 12345,
    loadSample: async (name: string) => {
      loadCalls.push(name);
      return options.loadSample !== undefined ? options.loadSample() : { ok: true, sourceSet: sampleSet() };
    },
    analysisClient: {
      analyze: async (request: unknown) => {
        analyzeCalls.push(request);
        return options.analyze !== undefined ? options.analyze() : beforeInvestigation();
      },
    },
    defaults: DEFAULT_ANALYSIS_OPTIONS,
    validate: validateInvestigation,
  } as unknown as LiveDeps;
  return { store, registry, deps, fetchCalls: calls, analyzeCalls, loadCalls };
}

function withoutStatus(state: ReturnType<FakeStore["getState"]>): unknown {
  return { ...state, status: "" };
}

afterEach(() => cleanup());

describe("8.1 the control", () => {
  it("is a button named Open live snapshot, aria-disabled while a run is pending", async () => {
    let release: (response: Response) => void = () => undefined;
    const { deps } = setup({ respond: () => new Promise<Response>((resolve) => (release = resolve)), handoff: async () => undefined });
    configure(deps);
    render(<LiveSnapshotControl store={deps.store} />);
    const button = screen.getByRole("button", { name: "Open live snapshot" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    release(jsonResponse(liveInvestigation()));
    await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
  });

  it("makes no second fetch when activated again while pending", async () => {
    let release: (response: Response) => void = () => undefined;
    const { deps, fetchCalls } = setup({ respond: () => new Promise<Response>((resolve) => (release = resolve)), handoff: async () => undefined });
    configure(deps);
    render(<LiveSnapshotControl store={deps.store} />);
    const button = screen.getByRole("button", { name: "Open live snapshot" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchCalls).toHaveLength(1);
    release(jsonResponse(liveInvestigation()));
    await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
  });
});

describe("8.2 the request", () => {
  it("fetches demo/live.json?t=<now> with cache no-store and credentials omit, once per activation", async () => {
    const { deps, fetchCalls } = setup({ handoff: async () => undefined });
    await openLiveSnapshot(deps);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("/demo/live.json?t=12345");
    expect(fetchCalls[0]?.init?.cache).toBe("no-store");
    expect(fetchCalls[0]?.init?.credentials).toBe("omit");
    await openLiveSnapshot(deps);
    expect(fetchCalls).toHaveLength(2);
  });

  it("returns the pending run for a second activation and fetches once", async () => {
    let release: (response: Response) => void = () => undefined;
    const { deps, fetchCalls } = setup({ respond: () => new Promise<Response>((resolve) => (release = resolve)), handoff: async () => undefined });
    const first = openLiveSnapshot(deps);
    const second = openLiveSnapshot(deps);
    expect(fetchCalls).toHaveLength(1);
    release(jsonResponse(liveInvestigation()));
    expect(await first).toBe("loaded");
    expect(await second).toBe("loaded");
  });
});

describe("8.3 to 8.5 failures keep the whole view and set one message", () => {
  const cases: [string, () => Response | Promise<Response>, string, string][] = [
    ["404", () => new Response("no", { status: 404 }), "missing", MISSING],
    ["hosting fallback (200, text/html)", () => new Response("<!doctype html><title>HauntMap</title>", { status: 200, headers: { "content-type": "text/html" } }), "missing", MISSING],
    [
      "schemaVersion 2",
      () => jsonResponse({ ...liveInvestigation(), schemaVersion: 2 }),
      "malformed",
      "The live snapshot at demo/live.json is not valid: schemaVersion must be 1 (found 2). The current view is unchanged.",
    ],
    ["status 500", () => new Response("x", { status: 500 }), "fetch-failed", "The live snapshot could not be fetched (500). The current view is unchanged."],
    [
      "rejected fetch",
      () => {
        throw new TypeError("Failed to fetch");
      },
      "fetch-failed",
      "The live snapshot could not be fetched (TypeError). The current view is unchanged.",
    ],
  ];

  it.each(cases)("%s", async (_name, respond, outcome, message) => {
    const { deps, store, registry } = setup({ respond, handoff: async () => undefined });
    const before = structuredClone(store.getState());
    expect(await openLiveSnapshot(deps)).toBe(outcome);
    expect(store.calls.setStatus).toEqual([message]);
    expect(withoutStatus(store.getState())).toEqual(withoutStatus(before));
    expect(registry.handoffCalls).toEqual([]);
  });

  it("truncated JSON with a json content type is malformed with the parse message", async () => {
    const { deps, store } = setup({ respond: () => new Response('{"schemaVersion": 1,', { status: 200, headers: { "content-type": "application/json" } }), handoff: async () => undefined });
    expect(await openLiveSnapshot(deps)).toBe("malformed");
    expect(store.calls.setStatus[0]?.startsWith("The live snapshot at demo/live.json is not valid: file is not JSON (")).toBe(true);
    expect(store.calls.setStatus[0]?.endsWith("). The current view is unchanged.")).toBe(true);
  });

  it("a valid file with no compare handoff says so and changes nothing else", async () => {
    const { deps, store } = setup({ handoff: null });
    const before = structuredClone(store.getState());
    expect(await openLiveSnapshot(deps)).toBe("no-compare");
    expect(store.calls.setStatus).toEqual([NO_COMPARE]);
    expect(withoutStatus(store.getState())).toEqual(withoutStatus(before));
  });
});

describe("8.6 and 8.9 the handoff", () => {
  it("passes { before, after, layoutKey } and then sets the loaded message; the live file never goes through openInvestigation", async () => {
    const handoffArgs: HandoffArgs[] = [];
    const { deps, store } = setup({
      handoff: async (args) => {
        handoffArgs.push(args);
      },
    });
    const before = store.getState().investigation;
    const state = structuredClone({ ...store.getState(), investigation: null });
    expect(await openLiveSnapshot(deps)).toBe("loaded");
    expect(handoffArgs).toHaveLength(1);
    expect(handoffArgs[0]?.before).toEqual(before);
    expect(handoffArgs[0]?.after).toEqual(liveInvestigation(4));
    expect(handoffArgs[0]?.layoutKey).toBeNull();
    expect(store.calls.setStatus).toEqual(["Live snapshot loaded: live:samples/manor (4 modules) is the newer snapshot; manor/before is the older one."]);
    expect(store.calls.openInvestigation).toEqual([]);
    const after = store.getState();
    expect(after.camera).toEqual(state.camera);
    expect(after.selection).toEqual(state.selection);
    expect(after.expandedWings).toEqual(state.expandedWings);
    expect(after.routeFilter).toEqual(state.routeFilter);
  });
});

describe("8.8 no investigation open", () => {
  it("loads manor/before, analyzes it under static-value, opens it with the sample's files and { demo: false }, then hands off", async () => {
    const { deps, store, registry, analyzeCalls, loadCalls } = setup({ withInvestigation: false, handoff: async () => undefined });
    expect(await openLiveSnapshot(deps)).toBe("loaded");
    expect(loadCalls).toEqual(["manor/before"]);
    expect(analyzeCalls).toEqual([{ files: sampleSet().files, rootLabel: "manor/before", options: { ...DEFAULT_ANALYSIS_OPTIONS, preset: "static-value" } }]);
    expect(store.calls.openInvestigation).toHaveLength(1);
    const opened = store.calls.openInvestigation[0];
    expect(opened?.investigation).toEqual(beforeInvestigation());
    expect([...(opened?.sourceText ?? new Map()).entries()]).toEqual(sampleSet().files.map((f) => [f.path, f.text]));
    expect(opened?.options).toEqual({ demo: false });
    expect(registry.handoffCalls).toHaveLength(1);
    expect(registry.handoffCalls[0]?.before).toEqual(beforeInvestigation());
    expect(registry.handoffCalls[0]?.after).toEqual(liveInvestigation(4));
  });

  it("a sample that cannot be loaded sets the investigation-ui message and returns sample-failed", async () => {
    const { deps, store, registry } = setup({ withInvestigation: false, handoff: async () => undefined, loadSample: async () => ({ ok: false, message: "The sample could not be loaded." }) });
    expect(await openLiveSnapshot(deps)).toBe("sample-failed");
    expect(store.calls.setStatus).toEqual(["The sample could not be loaded."]);
    expect(store.getState().investigation).toBeNull();
    expect(registry.handoffCalls).toEqual([]);
  });
});

describe("8.11 failures after the file is valid", () => {
  it("a rejecting analysis client gives the sample-analysis message and sample-failed", async () => {
    const { deps, store, registry } = setup({
      withInvestigation: false,
      handoff: async () => undefined,
      analyze: async () => {
        throw new Error("worker failed");
      },
    });
    expect(await openLiveSnapshot(deps)).toBe("sample-failed");
    expect(store.calls.setStatus).toEqual(["The manor sample could not be analyzed (worker failed). Reload the page."]);
    expect(store.getState().investigation).toBeNull();
    expect(registry.handoffCalls).toEqual([]);
  });

  it("a rejecting handoff gives compare-failed, writes no status after it and leaves no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): number => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const { deps, store, registry } = setup({
        handoff: async () => {
          throw new Error("handoff failed");
        },
      });
      expect(await openLiveSnapshot(deps)).toBe("compare-failed");
      expect(registry.handoffCalls).toHaveLength(1);
      expect(store.calls.setStatus).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
});
