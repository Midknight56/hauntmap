import { describe, expect, it } from "vitest";
import { createFakeFetch, guardedFile } from "./fakes";

describe("guarded File", () => {
  it("throws on every read method until allowRead() and keeps name, path and size", async () => {
    const file = guardedFile("src/a.ts", "export {};\n", "sample-local");
    expect(file.name).toBe("a.ts");
    expect(file.webkitRelativePath).toBe("sample-local/src/a.ts");
    expect(file.size).toBe(11);
    expect(() => file.slice(0, 1)).toThrow(/slice/);
    expect(() => file.stream()).toThrow(/stream/);
    expect(() => file.text()).toThrow(/text/);
    expect(() => file.arrayBuffer()).toThrow(/arrayBuffer/);
    expect(file.attempts).toEqual(["slice", "stream", "text", "arrayBuffer"]);
    file.allowRead();
    expect(await file.text()).toBe("export {};\n");
    expect((await file.arrayBuffer()).byteLength).toBe(11);
  });
});

describe("fake fetch", () => {
  it("records URL, headers, credentials and method, and answers from the routing table", async () => {
    const fake = createFakeFetch({ "https://example.test/a": { body: "hello" }, "https://example.test/j": { body: { n: 1 } } });
    const response = await fake.fetch("https://example.test/a", { credentials: "omit", headers: { Accept: "text/plain" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
    const json = await fake.fetch(new URL("https://example.test/j"));
    expect(await json.json()).toEqual({ n: 1 });
    expect(fake.calls).toEqual([
      { url: "https://example.test/a", method: "GET", credentials: "omit", headers: { accept: "text/plain" } },
      { url: "https://example.test/j", method: "GET", credentials: undefined, headers: {} },
    ]);
  });

  it("answers an unknown URL with 404 and a route status as given", async () => {
    const fake = createFakeFetch({ "https://example.test/x": { status: 500, body: "no" } });
    expect((await fake.fetch("https://example.test/x")).status).toBe(500);
    expect((await fake.fetch("https://example.test/none")).status).toBe(404);
  });

  it("counts pending requests, holds them until released and tracks the maximum", async () => {
    const fake = createFakeFetch({ "https://example.test/1": { hold: true, body: "1" }, "https://example.test/2": { hold: true, body: "2" } });
    const first = fake.fetch("https://example.test/1");
    const second = fake.fetch("https://example.test/2");
    expect(fake.pending).toBe(2);
    expect(fake.maxPending).toBe(2);
    fake.release("https://example.test/1");
    expect(await (await first).text()).toBe("1");
    expect(fake.pending).toBe(1);
    fake.release();
    expect(await (await second).text()).toBe("2");
    expect(fake.pending).toBe(0);
    expect(fake.maxPending).toBe(2);
  });

  it("answers after delayMs and rejects with AbortError when the signal aborts", async () => {
    const fake = createFakeFetch({ "https://example.test/slow": { hold: true } });
    const controller = new AbortController();
    const request = fake.fetch("https://example.test/slow", { signal: controller.signal });
    expect(fake.pending).toBe(1);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.pending).toBe(0);
    const timed = createFakeFetch({ "https://example.test/t": { delayMs: 5, body: "t" } });
    expect(await (await timed.fetch("https://example.test/t")).text()).toBe("t");
  });

  it("rejects with the named error for a reject route", async () => {
    const fake = createFakeFetch({ "https://example.test/r": { reject: "TypeError" } });
    await expect(fake.fetch("https://example.test/r")).rejects.toMatchObject({ name: "TypeError" });
    expect(fake.calls).toHaveLength(1);
  });
});
