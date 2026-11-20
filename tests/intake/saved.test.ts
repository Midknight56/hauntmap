import { describe, expect, it } from "vitest";
import { createMemorySavedStore, createSavedStore, recordSize } from "../../src/features/import/saved";
import type { SavedRecord } from "../../src/features/import/types";
import { liveInvestigation } from "./graphHelpers";

// Requirements 5.2, 5.3, 5.4 and 5.6: the store behind the interface, run against the memory adapter.
// The IndexedDB adapter is exercised once in a real browser by tests/intake/e2e/local.spec.ts.

function record(label: string, savedAt: string, sourceText: Record<string, string> | null = null): SavedRecord {
  return { savedVersion: 1, label, savedAt, investigation: { ...liveInvestigation(), sourceLabel: label }, sourceText };
}

describe("the memory store (5.2, 5.3)", () => {
  it("puts a record and lists it back unchanged", async () => {
    const store = createMemorySavedStore();
    const one = record("local:a", "2026-11-19T10:00:00.000Z", { "src/a.ts": "export {};\n" });
    await store.put(one);
    expect(await store.list()).toEqual([one]);
  });

  it("replaces a record with the same label", async () => {
    const store = createMemorySavedStore();
    await store.put(record("local:a", "2026-11-19T10:00:00.000Z"));
    const newer = record("local:a", "2026-11-19T11:00:00.000Z", { "x.ts": "1" });
    await store.put(newer);
    expect(await store.list()).toEqual([newer]);
  });

  it("lists the newest savedAt first", async () => {
    const store = createMemorySavedStore();
    await store.put(record("local:old", "2026-11-17T10:00:00.000Z"));
    await store.put(record("local:new", "2026-11-19T10:00:00.000Z"));
    await store.put(record("local:mid", "2026-11-18T10:00:00.000Z"));
    expect((await store.list()).map((r) => r.label)).toEqual(["local:new", "local:mid", "local:old"]);
  });

  it("deletes by label and ignores a label that is not there", async () => {
    const store = createMemorySavedStore();
    await store.put(record("local:a", "2026-11-19T10:00:00.000Z"));
    await store.put(record("local:b", "2026-11-19T11:00:00.000Z"));
    await store.delete("local:a");
    await store.delete("local:missing");
    expect((await store.list()).map((r) => r.label)).toEqual(["local:b"]);
  });

  it("returns copies, so changing a listed record changes nothing stored", async () => {
    const store = createMemorySavedStore();
    await store.put(record("local:a", "2026-11-19T10:00:00.000Z", { "a.ts": "1" }));
    const [first] = await store.list();
    (first as SavedRecord).sourceText = null;
    expect((await store.list())[0]?.sourceText).toEqual({ "a.ts": "1" });
  });
});

describe("recordSize (5.2)", () => {
  it("is the UTF-8 byte length of the JSON text", () => {
    const one = record("local:é", "2026-11-19T10:00:00.000Z", { "a.ts": "é" });
    expect(recordSize(one)).toBe(new TextEncoder().encode(JSON.stringify(one)).length);
    expect(recordSize(one)).toBeGreaterThan(JSON.stringify(one).length - 1);
  });
});

describe("the browser adapter (5.4, 5.6)", () => {
  it("is null when indexedDB is undefined", () => {
    expect(createSavedStore(undefined)).toBeNull();
  });

  it("rejects list, put and delete with the error name when the database cannot be opened", async () => {
    const failing = {
      open() {
        const request: { error: { name: string } | null; onerror: (() => void) | null; onsuccess: (() => void) | null; onupgradeneeded: (() => void) | null } = {
          error: { name: "SecurityError" },
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    } as unknown as IDBFactory;
    const store = createSavedStore(failing);
    expect(store).not.toBeNull();
    await expect(store?.list()).rejects.toMatchObject({ name: "SecurityError" });
    await expect(store?.put(record("local:a", "2026-11-19T10:00:00.000Z"))).rejects.toMatchObject({ name: "SecurityError" });
    await expect(store?.delete("local:a")).rejects.toMatchObject({ name: "SecurityError" });
  });

  it("rejects with the error name when open throws", async () => {
    const throwing = {
      open() {
        const error = new Error("blocked");
        error.name = "InvalidStateError";
        throw error;
      },
    } as unknown as IDBFactory;
    await expect(createSavedStore(throwing)?.list()).rejects.toMatchObject({ name: "InvalidStateError" });
  });
});
