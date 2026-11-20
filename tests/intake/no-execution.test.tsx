import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chooseFiles, folderInput, inlineAnalysisClient, installDirectoryInput, itemsOf, makeHarness, removeDirectoryInput } from "./dialogHarness";
import { filesOfManifest, readManifest } from "./materialize";

// 4.5: chosen files are data. A folder whose index.html sets a cookie if it is rendered, and whose postinstall.js sets a
// global if it is run, goes through the whole local flow; neither happens, and no request is made.

beforeAll(installDirectoryInput);
afterAll(removeDirectoryInput);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("chosen files are never run, rendered or fetched (4.5)", () => {
  it("reviews and analyzes the folder with no cookie, no global marker, no request and no script element", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no request is allowed")));
    vi.stubGlobal("fetch", fetchSpy);
    const xhr = vi.fn();
    vi.stubGlobal("XMLHttpRequest", xhr);
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const scriptsBefore = document.querySelectorAll("script").length;

    const h = makeHarness({ deps: { analysisClient: inlineAnalysisClient() } });
    void h.open();
    chooseFiles(folderInput(), filesOfManifest(readManifest("folder-exec")));
    const box = screen.getByRole("dialog");
    expect(itemsOf("Included files (2)")).toEqual(["postinstall.js", "src/a.ts"]);
    expect(itemsOf("Skipped files (1)")).toEqual(["index.html \u00b7 other file type"]);
    fireEvent.click(within(box).getByRole("button", { name: "Analyze" }));
    await waitFor(() => expect(h.store.opened).toHaveLength(1));

    expect(document.cookie).not.toContain("marker");
    expect((globalThis as { __intakeMarker?: unknown }).__intakeMarker).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(document.querySelectorAll("script").length).toBe(scriptsBefore);
    expect(document.querySelector("iframe, object, embed")).toBeNull();
    const investigation = h.store.opened[0]?.investigation;
    expect(investigation?.modules.map((m) => m.id)).toEqual(["postinstall.js", "src/a.ts"]);
    expect(h.store.opened[0]?.source?.get("postinstall.js")).toBe("globalThis.__intakeMarker = 1;\n");
  });
});
