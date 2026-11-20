import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchFiles, fileUrl, listRepository, listingUrl, resolveUrl, resolveVersion } from "../../src/features/github/jsdelivr";
import type { Candidate } from "../../src/features/import/review";
import { createFakeFetch } from "./fakes";
import { listingBody, listingOf } from "./generators";

// Task 9: the resolve and listing half of jsdelivr.ts (7.3, 7.4, 7.6, 8.8). The fake fetch answers; no network is used.
// The shapes below were observed from this PC with curl on 2026-11-19 (docs/limitations.md, ## Intake).

const HERE = dirname(fileURLToPath(import.meta.url));
const LISTING = JSON.parse(readFileSync(join(HERE, "fixtures", "gh", "listing-small.json"), "utf8")) as { files: { name: string; size: number }[] };
const RESOLVE = "https://data.jsdelivr.com/v1/packages/gh/octo/cat/resolved";
const LIST = "https://data.jsdelivr.com/v1/packages/gh/octo/cat@main?structure=flat";
const signal = () => new AbortController().signal;

describe("URL forms (design, jsDelivr)", () => {
  it("builds the documented v1 resolve and listing URLs", () => {
    expect(resolveUrl("octo", "cat")).toBe(RESOLVE);
    expect(listingUrl("octo", "cat", "main")).toBe(LIST);
    expect(listingUrl("octo", "cat", "v1.2.3")).toBe("https://data.jsdelivr.com/v1/packages/gh/octo/cat@v1.2.3?structure=flat");
    // A ref typed in the Branch or tag field may hold a slash; it is encoded into one path segment (not observed on jsDelivr).
    expect(listingUrl("octo", "cat", "feature/x")).toBe("https://data.jsdelivr.com/v1/packages/gh/octo/cat@feature%2Fx?structure=flat");
  });
});

describe("resolveVersion (7.3)", () => {
  it("asks the resolve endpoint once, with credentials omitted and no header", async () => {
    const fake = createFakeFetch({ [RESOLVE]: { body: { type: "gh", name: "octo/cat", version: "8.3.8", links: {} } } });
    const result = await resolveVersion("octo", "cat", fake.fetch, signal());
    expect(result).toEqual({ ok: true, version: "8.3.8" });
    expect(fake.calls).toEqual([{ url: RESOLVE, method: "GET", credentials: "omit", headers: {} }]);
  });

  it("returns a null version for a repository without tags (observed: 200 with version null)", async () => {
    const fake = createFakeFetch({ [RESOLVE]: { body: { type: "gh", name: "octo/cat", version: null, links: {} } } });
    expect(await resolveVersion("octo", "cat", fake.fetch, signal())).toEqual({ ok: true, version: null });
  });

  it("returns the status text for a response that is not 200", async () => {
    for (const status of [404, 403, 500]) {
      const fake = createFakeFetch({ [RESOLVE]: { status, body: { status, message: "no" } } });
      expect(await resolveVersion("octo", "cat", fake.fetch, signal())).toEqual({ ok: false, status: String(status) });
    }
  });

  it("returns the error name when the request rejects", async () => {
    const fake = createFakeFetch({ [RESOLVE]: { reject: "TypeError" } });
    expect(await resolveVersion("octo", "cat", fake.fetch, signal())).toEqual({ ok: false, status: "TypeError" });
  });

  it("returns an error name for a body that is not the expected JSON", async () => {
    const notJson = createFakeFetch({ [RESOLVE]: { body: "<html>" } });
    expect(await resolveVersion("octo", "cat", notJson.fetch, signal())).toEqual({ ok: false, status: "SyntaxError" });
    const wrong = createFakeFetch({ [RESOLVE]: { body: { version: 7 } } });
    expect(await resolveVersion("octo", "cat", wrong.fetch, signal())).toEqual({ ok: false, status: "InvalidResponse" });
  });

  it("passes the abort signal on and reports an abort by name", async () => {
    const controller = new AbortController();
    const fake = createFakeFetch({ [RESOLVE]: { hold: true } });
    const pending = resolveVersion("octo", "cat", fake.fetch, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, status: "AbortError" });
  });
});

describe("listRepository (7.4, 7.6)", () => {
  it("requests the listing URL with credentials omitted and no header, and removes one leading slash", async () => {
    const fake = createFakeFetch({ [LIST]: { body: LISTING } });
    const result = await listRepository("octo", "cat", "main", fake.fetch, signal());
    expect(fake.calls).toEqual([{ url: LIST, method: "GET", credentials: "omit", headers: {} }]);
    expect(result).toEqual({ ok: true, entries: LISTING.files.map((file) => ({ path: file.name.slice(1), size: file.size })) });
    if (result.ok) {
      expect(result.entries).toHaveLength(8);
      expect(result.entries[0]).toEqual({ path: "src/a.ts", size: 70 });
      expect(result.entries.every((entry) => !entry.path.startsWith("/"))).toBe(true);
    }
  });

  it("removes only one slash, so a path that starts with two keeps one", async () => {
    const fake = createFakeFetch({ [LIST]: { body: { files: [{ name: "//x.ts", hash: "h", size: 3 }] } } });
    expect(await listRepository("octo", "cat", "main", fake.fetch, signal())).toEqual({ ok: true, entries: [{ path: "/x.ts", size: 3 }] });
  });

  it("returns an empty list for a listing with no files", async () => {
    const fake = createFakeFetch({ [LIST]: { body: { type: "gh", files: [] } } });
    expect(await listRepository("octo", "cat", "main", fake.fetch, signal())).toEqual({ ok: true, entries: [] });
  });

  it("returns the status for 404 (missing repository or ref, observed) and 403", async () => {
    for (const status of [404, 403, 429]) {
      const fake = createFakeFetch({ [LIST]: { status, body: { status, message: "Couldn't find version" } } });
      expect(await listRepository("octo", "cat", "main", fake.fetch, signal())).toEqual({ ok: false, status: String(status) });
      expect(fake.calls).toHaveLength(1);
    }
  });

  it("returns the error name for a rejection and for a body that is not a listing", async () => {
    const rejected = createFakeFetch({ [LIST]: { reject: "TypeError" } });
    expect(await listRepository("octo", "cat", "main", rejected.fetch, signal())).toEqual({ ok: false, status: "TypeError" });
    const notJson = createFakeFetch({ [LIST]: { body: "nope" } });
    expect(await listRepository("octo", "cat", "main", notJson.fetch, signal())).toEqual({ ok: false, status: "SyntaxError" });
    for (const body of [{ files: "x" }, { files: [{ name: 3, size: 1 }] }, { files: [{ name: "/a.ts", size: 1.5 }] }, { files: [{ name: "/a.ts" }] }, []]) {
      const fake = createFakeFetch({ [LIST]: { body } });
      expect(await listRepository("octo", "cat", "main", fake.fetch, signal())).toEqual({ ok: false, status: "InvalidResponse" });
    }
  });

  it("sends nothing but the listing request (8.8)", async () => {
    const fake = createFakeFetch({ [LIST]: { body: LISTING } });
    await listRepository("octo", "cat", "main", fake.fetch, signal());
    expect(fake.calls.map((call) => call.url)).toEqual([LIST]);
    expect(new URL(fake.calls[0]?.url ?? "").search).toBe("?structure=flat");
  });
});

// ---- Task 10: fetching with bounded concurrency (8.1, 8.3, 8.4, 8.8) ----

const candidates = (n: number): Candidate[] => listingOf(n).map((entry) => ({ path: entry.path.slice(1), size: entry.size }));
const bodyRoutes = (url: string) => {
  const match = /\/gh\/octo\/cat@main\/(.+)$/.exec(url);
  return match === null ? undefined : { body: listingBody(match[1] ?? "") };
};

describe("fileUrl (8.1)", () => {
  it("builds the cdn URL and encodes each path segment", () => {
    expect(fileUrl("octo", "cat", "main", "src/m1.ts")).toBe("https://cdn.jsdelivr.net/gh/octo/cat@main/src/m1.ts");
    expect(fileUrl("octo", "cat", "main", "src/a b#?.ts")).toBe("https://cdn.jsdelivr.net/gh/octo/cat@main/src/a%20b%23%3F.ts");
    expect(fileUrl("octo", "cat", "feature/x", "src/m1.ts")).toBe("https://cdn.jsdelivr.net/gh/octo/cat@feature%2Fx/src/m1.ts");
  });
});

describe("fetchFiles (8.1, 8.3, 8.4, 8.8)", () => {
  it("fetches exactly the included paths in path order, never more than 6 at once, and reports each settle", async () => {
    const fake = createFakeFetch((url) => ({ ...(bodyRoutes(url) ?? {}), delayMs: 1 + (url.length % 3) }));
    const included = candidates(200);
    const seen: [number, number][] = [];
    const result = await fetchFiles("octo", "cat", "main", included, fake.fetch, signal(), (done, total) => seen.push([done, total]));
    expect(result.ok).toBe(true);
    expect(fake.maxPending).toBeLessThanOrEqual(6);
    expect(fake.maxPending).toBeGreaterThan(1);
    expect(fake.calls.map((call) => call.url)).toEqual(included.map((entry) => fileUrl("octo", "cat", "main", entry.path)));
    expect(seen).toHaveLength(200);
    expect(seen[0]).toEqual([1, 200]);
    expect(seen.at(-1)).toEqual([200, 200]);
    if (result.ok) {
      expect(result.files.map((file) => file.path)).toEqual([...included.map((entry) => entry.path)].sort());
      expect(result.binary).toEqual([]);
      expect(result.files[0]).toEqual({ path: "src/m0.ts", text: "export const m0 = 0;\n", bytes: 21 });
    }
  });

  it("sends every request with credentials omitted, no header and no query (8.8)", async () => {
    const fake = createFakeFetch(bodyRoutes);
    await fetchFiles("octo", "cat", "main", candidates(12), fake.fetch, signal(), () => undefined);
    expect(fake.calls).toHaveLength(12);
    for (const call of fake.calls) {
      expect(call.method).toBe("GET");
      expect(call.credentials).toBe("omit");
      expect(call.headers).toEqual({});
      expect(call.url.startsWith("https://cdn.jsdelivr.net/gh/octo/cat@main/")).toBe(true);
      expect(new URL(call.url).search).toBe("");
    }
  });

  it("an abort propagates as AbortError and no request follows", async () => {
    const controller = new AbortController();
    const fake = createFakeFetch({ ...Object.fromEntries(candidates(50).map((entry) => [fileUrl("octo", "cat", "main", entry.path), { hold: true }])) });
    const pending = fetchFiles("octo", "cat", "main", candidates(50), fake.fetch, controller.signal, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fake.calls).toHaveLength(6);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.calls).toHaveLength(6);
    expect(fake.pending).toBe(0);
  });

  it("an abort before the first request sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = createFakeFetch(bodyRoutes);
    await expect(fetchFiles("octo", "cat", "main", candidates(5), fake.fetch, controller.signal, () => undefined)).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.calls).toHaveLength(0);
  });

  it("a 500 on one file returns its path and status and starts no further file", async () => {
    const bad = fileUrl("octo", "cat", "main", "src/m1.ts");
    const fake = createFakeFetch((url) => (url === bad ? { status: 500, delayMs: 2 } : { ...(bodyRoutes(url) ?? {}), delayMs: 2 }));
    const result = await fetchFiles("octo", "cat", "main", candidates(60), fake.fetch, signal(), () => undefined, 2);
    expect(result).toEqual({ ok: false, path: "src/m1.ts", status: "500" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.calls.length).toBeLessThan(10);
  });

  it("a rejection other than the abort returns the error name", async () => {
    const bad = fileUrl("octo", "cat", "main", "src/m0.ts");
    const fake = createFakeFetch((url) => (url === bad ? { reject: "TypeError" } : bodyRoutes(url)));
    expect(await fetchFiles("octo", "cat", "main", candidates(3), fake.fetch, signal(), () => undefined)).toEqual({ ok: false, path: "src/m0.ts", status: "TypeError" });
  });

  it("skips a body with a NUL in its first 8,192 characters as binary, and measures bytes from the body", async () => {
    const routes: Record<string, { body: string | Uint8Array }> = {
      [fileUrl("octo", "cat", "main", "a.ts")]: { body: new Uint8Array([0x00, 0x01, 0x65]) },
      [fileUrl("octo", "cat", "main", "b.ts")]: { body: "// \u00e9\nexport {};\n" },
      [fileUrl("octo", "cat", "main", "c.ts")]: { body: `${"x".repeat(8192)}\u0000` },
      [fileUrl("octo", "cat", "main", "d.ts")]: { body: new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]) },
    };
    const fake = createFakeFetch(routes);
    const result = await fetchFiles("octo", "cat", "main", ["a.ts", "b.ts", "c.ts", "d.ts"].map((path) => ({ path, size: 1 })), fake.fetch, signal(), () => undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binary).toEqual(["a.ts"]);
    expect(result.files.map((file) => file.path)).toEqual(["b.ts", "c.ts", "d.ts"]);
    expect(result.files[0]).toEqual({ path: "b.ts", text: "// \u00e9\nexport {};\n", bytes: 17 });
    expect(result.files[1]?.text.length).toBe(8193);
    expect(result.files[2]).toEqual({ path: "d.ts", text: "a\r\n", bytes: 6 });
  });

  it("returns an empty result for no files and makes no request", async () => {
    const fake = createFakeFetch(bodyRoutes);
    expect(await fetchFiles("octo", "cat", "main", [], fake.fetch, signal(), () => undefined)).toEqual({ ok: true, files: [], binary: [] });
    expect(fake.calls).toHaveLength(0);
  });
});