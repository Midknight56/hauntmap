import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { loadSample, openSample } from "../../src/features/samples/loadSample";
import { fixture } from "./fixtureFiles";
import { createFakeLayoutClient } from "./fakeLayoutClient";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (body: unknown, status = 200): Response => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function newStore() {
  return createInvestigationStore({ analysisApi, layoutClient: createFakeLayoutClient(), prefs: createPrefsStore(null) });
}

describe("loadSample (1.3, 1.6)", () => {
  it("fetches demo/<id>/sources.json under the base and builds the SourceSet", async () => {
    const fetchImpl = vi.fn(async () => json({ files: [{ path: "src/a.ts", text: "export const a = 1;" }, { path: "src/b.ts", text: "é" }] }));
    const result = await loadSample("manor/before", "./", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("./demo/manor/before/sources.json");
    expect(result).toEqual({
      ok: true,
      sourceSet: {
        rootLabel: "manor/before",
        files: [
          { path: "src/a.ts", text: "export const a = 1;", bytes: 19 },
          { path: "src/b.ts", text: "é", bytes: 2 },
        ],
        skipped: [],
      },
    });
  });

  it("reports a status other than 200 with the sample's label", async () => {
    const manor = await loadSample("manor/before", "/", (async () => json("x", 500)) as unknown as typeof fetch);
    expect(manor).toEqual({ ok: false, message: "The manor sample could not be loaded (500). Reload the page." });
    const annex = await loadSample("annex", "/", (async () => json("x", 404)) as unknown as typeof fetch);
    expect(annex).toEqual({ ok: false, message: "The annex sample could not be loaded (404). Reload the page." });
    const after = await loadSample("manor/after", "/", (async () => json("x", 503)) as unknown as typeof fetch);
    expect(after).toEqual({ ok: false, message: "The manor sample could not be loaded (503). Reload the page." });
  });

  it("reports a network error by its name", async () => {
    const result = await loadSample("annex", "/", (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, message: "The annex sample could not be loaded (TypeError). Reload the page." });
  });

  it("reports a JSON parse failure and a body without files as invalid sources.json", async () => {
    const bad = await loadSample("manor/before", "/", (async () => json("{not json")) as unknown as typeof fetch);
    expect(bad).toEqual({ ok: false, message: "The manor sample could not be loaded (invalid sources.json). Reload the page." });
    for (const body of [{}, { files: "x" }, { files: [{ path: 1, text: "a" }] }, { files: [{ path: "a" }] }, null]) {
      const result = await loadSample("manor/before", "/", (async () => json(body)) as unknown as typeof fetch);
      expect(result).toEqual({ ok: false, message: "The manor sample could not be loaded (invalid sources.json). Reload the page." });
    }
  });

  it("reads the committed manor sources.json through the loader: 40 files", async () => {
    const text = readFileSync(join(REPO, "public", "demo", "manor", "before", "sources.json"), "utf8");
    const result = await loadSample("manor/before", "/", (async () => json(text)) as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourceSet.files).toHaveLength(40);
      expect(result.sourceSet.rootLabel).toBe("manor/before");
    }
  });
});

describe("openSample (1.3, 1.10)", () => {
  const sourcesBody = { files: [{ path: "src/a.ts", text: "export const a = 1;" }] };

  it("analyzes the files and opens the investigation, expanding src/orders with steps only for the manor", async () => {
    const store = newStore();
    const inv = fixture("triad");
    const analyze = vi.fn(async (request: { rootLabel: string; options: unknown }) => (request.rootLabel === "" ? null : inv));
    await openSample("manor/before", { base: "/", fetchImpl: (async () => json(sourcesBody)) as unknown as typeof fetch, analysisClient: { analyze } as never, store });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]?.[0]).toMatchObject({ rootLabel: "manor/before", options: { preset: "static-value" } });
    expect(store.getState().screen).toBe("investigation");
    expect(store.getState().demo).toBe(true);
    expect(store.getState().sourceText?.get("src/a.ts")).toBe("export const a = 1;");
    const annex = newStore();
    await openSample("annex", { base: "/", fetchImpl: (async () => json(sourcesBody)) as unknown as typeof fetch, analysisClient: { analyze } as never, store: annex });
    expect(annex.getState().demo).toBe(false);
    expect(annex.getState().steps).toBeNull();
  });

  it("keeps the landing screen and writes the load message on a failed fetch", async () => {
    const store = newStore();
    await openSample("manor/before", {
      base: "/",
      fetchImpl: (async () => json("x", 500)) as unknown as typeof fetch,
      analysisClient: { analyze: vi.fn() },
      store,
    });
    expect(store.getState().screen).toBe("landing");
    expect(store.getState().status).toBe("The manor sample could not be loaded (500). Reload the page.");
  });

  it("keeps the landing screen and writes the analysis message when the analysis rejects", async () => {
    const store = newStore();
    await openSample("annex", {
      base: "/",
      fetchImpl: (async () => json(sourcesBody)) as unknown as typeof fetch,
      analysisClient: { analyze: async () => Promise.reject(new Error("worker terminated")) },
      store,
    });
    expect(store.getState().screen).toBe("landing");
    expect(store.getState().status).toBe("The annex sample could not be analyzed (worker terminated). Reload the page.");
  });
});