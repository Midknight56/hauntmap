import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fileUrl, listingUrl } from "../../src/features/github/jsdelivr";
import { createMemorySavedStore } from "../../src/features/import/saved";
import type { SavedRecord } from "../../src/features/import/types";
import { openedStore } from "../ui/storeHarness";
import { chooseFiles, fakeIntakeStore, folderInput, heldReadWorkers, inlineAnalysisClient, installDirectoryInput, makeHarness, removeDirectoryInput, type Harness } from "./dialogHarness";
import { createFakeFetch, type FakeFetch, type FakeRoute } from "./fakes";
import { listingOf } from "./generators";
import { smallRepoRoutes } from "./githubFakes";
import { graphFixture, liveInvestigation, liveText } from "./graphHelpers";
import { filesOfManifest, readManifest } from "./materialize";

// Requirement 9: both dialogs in `after` mode supply the newer snapshot of a comparison. They call no store action but
// `setStatus` (1.3), resolve the result to the caller (9.1), resolve a failure as the bare message with no status for it (9.2),
// show no save control (9.3) and leave the six fields of 3.3 as they were (9.4). P5 for the GitHub dialog is in properties.dom.test.ts.

beforeAll(installDirectoryInput);
afterAll(removeDirectoryInput);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const O = "octo";
const R = "cat";
const dialog = (): HTMLElement => screen.getByRole("dialog");
const sampleFiles = (): File[] => filesOfManifest(readManifest("folder"));

function sixFields(state: unknown): unknown {
  const s = state as Record<string, unknown>;
  return structuredClone({ investigation: s["investigation"], selection: s["selection"], routeFilter: s["routeFilter"], camera: s["camera"], expandedWings: s["expandedWings"], layout: s["layout"] });
}

/** A real store with an investigation open, and spies on the four actions that `after` mode must never call. */
function realStore() {
  const real = openedStore("triad");
  const forbidden = {
    openInvestigation: vi.spyOn(real.store.actions, "openInvestigation"),
    restart: vi.spyOn(real.store.actions, "restart"),
    select: vi.spyOn(real.store.actions, "select"),
    setPreset: vi.spyOn(real.store.actions, "setPreset"),
  };
  return { real, store: fakeIntakeStore({ over: real.store }), forbidden, before: sixFields(real.store.getState()) };
}

function expectUntouched(ctx: ReturnType<typeof realStore>): void {
  for (const spy of Object.values(ctx.forbidden)) expect(spy).not.toHaveBeenCalled();
  expect(ctx.store.calls.filter((name) => name !== "setStatus")).toEqual([]);
  expect(sixFields(ctx.real.store.getState())).toEqual(ctx.before);
}

describe("the local dialog in after mode (1.2, 1.3, 9.1 to 9.4)", () => {
  it("heads the dialog with the newer snapshot suffix and has no save control on its way to the result", async () => {
    const ctx = realStore();
    const h = makeHarness({ store: ctx.store, deps: { saved: createMemorySavedStore(), analysisClient: inlineAnalysisClient() } });
    const result = h.open({ purpose: "after" });
    expect(within(dialog()).getByRole("heading", { name: "Analyze a local folder as the newer snapshot" })).toBeTruthy();
    chooseFiles(folderInput(), sampleFiles());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Analyze" }));
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: true, label: "local:sample-local" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save investigation on this device" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Include source text" })).toBeNull();
    if (outcome.ok) {
      expect([...(outcome.sourceText?.keys() ?? [])].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.tsx"]);
    }
    expectUntouched(ctx);
  });

  it("a cancel and a failure leave the six fields alone, and the failure is the bare message with no status for it", async () => {
    const ctx = realStore();
    const held = heldReadWorkers();
    const h = makeHarness({ store: ctx.store, deps: { createReadWorker: held.create } });
    const result = h.open({ purpose: "after" });
    chooseFiles(folderInput(), sampleFiles());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Analyze" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Analyze" }));
    held.workers.at(-1)?.fail("disk unplugged");
    await expect(result).resolves.toEqual({ ok: false, reason: "failed", message: "The folder could not be analyzed (disk unplugged)." });
    expect(ctx.store.statuses.some((text) => text.includes("could not be analyzed") || text.includes("unchanged"))).toBe(false);
    expectUntouched(ctx);
  });

  it("Close resolves cancelled and writes nothing", async () => {
    const ctx = realStore();
    const h = makeHarness({ store: ctx.store });
    const result = h.open({ purpose: "after" });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    await expect(result).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(ctx.store.calls).toEqual([]);
    expectUntouched(ctx);
  });

  it("Open of a saved investigation resolves the record without opening it (9.3)", async () => {
    const saved = createMemorySavedStore();
    const record: SavedRecord = { savedVersion: 1, label: "local:kept", savedAt: "2026-11-18T10:00:00.000Z", investigation: { ...liveInvestigation(), sourceLabel: "local:kept" }, sourceText: { "src/a.ts": "export {};" } };
    await saved.put(record);
    const ctx = realStore();
    const h = makeHarness({ store: ctx.store, deps: { saved } });
    const result = h.open({ purpose: "after" });
    fireEvent.click(await screen.findByRole("button", { name: "Open local:kept" }));
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: true, label: "local:kept" });
    if (outcome.ok) expect(outcome.sourceText?.get("src/a.ts")).toBe("export {};");
    expect(ctx.store.calls).toEqual([]);
    expectUntouched(ctx);
  });

  it("a graph file resolves as the result with no source text, and a bad one as the bare message", async () => {
    const ctx = realStore();
    const good = makeHarness({ store: ctx.store });
    const first = good.open({ purpose: "after" });
    const choose = (file: File): void => {
      const input = screen.getByLabelText("Choose a graph file");
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      fireEvent.change(input);
    };
    choose(new File([liveText()], "live.json"));
    await expect(first).resolves.toMatchObject({ ok: true, label: "live:haunts/manor", sourceText: null });
    cleanup();
    const bad = makeHarness({ store: ctx.store });
    const second = bad.open({ purpose: "after" });
    choose(new File([graphFixture("malformed.json")], "malformed.json"));
    await expect(second).resolves.toEqual({ ok: false, reason: "failed", message: "The graph file is not valid: schemaVersion must be 1 (found 2)." });
    expect(ctx.store.calls).toEqual([]);
    expectUntouched(ctx);
  });
});

function githubSetup(routes: Record<string, FakeRoute> | ((url: string) => FakeRoute | undefined)): { h: Harness; fake: FakeFetch; ctx: ReturnType<typeof realStore> } {
  const fake = createFakeFetch(routes);
  const ctx = realStore();
  const h = makeHarness({ store: ctx.store, github: true, deps: { github: { fetchImpl: fake.fetch }, analysisClient: inlineAnalysisClient() } });
  return { h, fake, ctx };
}

function load(url: string): void {
  fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: url } });
  fireEvent.click(within(dialog()).getByRole("button", { name: "Load" }));
}

describe("the GitHub dialog in after mode (1.2, 1.3, 9.1 to 9.4)", () => {
  it("heads the dialog with the newer snapshot suffix, resolves the loaded repository and opens nothing", async () => {
    const { h, ctx } = githubSetup(smallRepoRoutes(O, R, "main"));
    const result = h.open({ kind: "github", purpose: "after" });
    expect(within(dialog()).getByRole("heading", { name: "Load a GitHub repository as the newer snapshot" })).toBeTruthy();
    load("https://github.com/octo/cat/tree/main");
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: true, label: "gh:octo/cat@main" });
    if (outcome.ok) expect([...(outcome.sourceText?.keys() ?? [])].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.tsx"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The one status message of the start; the loaded message belongs to the comparison's own text in after mode.
    expect(ctx.store.statuses.some((text) => text.startsWith("Loaded "))).toBe(false);
    expectUntouched(ctx);
  });

  it.each([404, 403])("a listing that answers %i resolves the bare message and writes no status for it", async (status) => {
    const { h, ctx } = githubSetup({ [listingUrl(O, R, "main")]: { status, body: { status } } });
    const result = h.open({ kind: "github", purpose: "after" });
    load("https://github.com/octo/cat/tree/main");
    await expect(result).resolves.toEqual({ ok: false, reason: "failed", message: `Could not list octo/cat@main: ${status}. Only public repositories are supported.` });
    expect(ctx.store.statuses).toEqual([]);
    expectUntouched(ctx);
  });

  it("the 400 file cap resolves the bare message with the first excluded path", async () => {
    const files = listingOf(401).map((entry) => ({ name: entry.path, hash: "h", size: entry.size }));
    const { h, ctx } = githubSetup({ [listingUrl(O, R, "main")]: { body: { files } } });
    const result = h.open({ kind: "github", purpose: "after" });
    load("https://github.com/octo/cat/tree/main");
    await expect(result).resolves.toEqual({ ok: false, reason: "failed", message: "octo/cat@main has 401 included files; the limit is 400. First excluded: src/m99.ts." });
    expectUntouched(ctx);
  });

  it("a file that cannot be fetched resolves the bare message", async () => {
    const routes = smallRepoRoutes(O, R, "main");
    routes[fileUrl(O, R, "main", "src/b.ts")] = { status: 500, body: "" };
    const { h, ctx } = githubSetup(routes);
    const result = h.open({ kind: "github", purpose: "after" });
    load("https://github.com/octo/cat/tree/main");
    await expect(result).resolves.toEqual({ ok: false, reason: "failed", message: "Could not fetch src/b.ts from octo/cat@main (500). Nothing was loaded." });
    expectUntouched(ctx);
  });

  it("a cancel while fetching keeps the dialog open at the URL field, and Close then resolves cancelled", async () => {
    const routes = smallRepoRoutes(O, R, "main");
    routes[fileUrl(O, R, "main", "src/a.ts")] = { hold: true, body: "export {};" };
    const { h, ctx } = githubSetup(routes);
    const result = h.open({ kind: "github", purpose: "after" });
    load("https://github.com/octo/cat/tree/main");
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeTruthy());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Load" })).toBeTruthy());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    await expect(result).resolves.toEqual({ ok: false, reason: "cancelled" });
    await act(async () => undefined);
    expectUntouched(ctx);
  });

  it("an address that is not an address asks again and resolves nothing", async () => {
    const { h, fake, ctx } = githubSetup({});
    let settled = false;
    void h.open({ kind: "github", purpose: "after" }).then(() => {
      settled = true;
    });
    load("octo/cat");
    await act(async () => undefined);
    expect(settled).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expectUntouched(ctx);
  });
});
