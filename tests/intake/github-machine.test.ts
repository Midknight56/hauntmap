import { describe, expect, it } from "vitest";
import { runGithubIntake } from "../../src/features/github/githubIntake";
import { fileUrl, listingUrl, resolveUrl } from "../../src/features/github/jsdelivr";
import * as text from "../../src/features/github/messages";
import { PRESERVED } from "../../src/features/import/messages";
import { createFakeFetch, type FakeFetch, type FakeRoute } from "./fakes";
import { listingBody, listingOf } from "./generators";
import { githubDeps, inlineAnalysisClient, instantAnalysisClient, pendingAnalysisClient, recordingStore, recordingUi, smallRepoRoutes } from "./githubFakes";
import { liveInvestigation } from "./graphHelpers";

// The GitHub state machine (design.md: url, resolving, listing, fetching, analyzing, done) with a fake GithubUi, a fake
// fetch and fake analysis clients. No network is used.

const REPO = "https://github.com/octo/cat";
const O = "octo";
const R = "cat";

function smallRoutes(ref = "main", extra: Record<string, FakeRoute> = {}): Record<string, FakeRoute> {
  return { ...smallRepoRoutes(O, R, ref), ...extra };
}

function listingRoutes(n: number, ref = "main"): Record<string, FakeRoute> {
  const routes: Record<string, FakeRoute> = { [listingUrl(O, R, ref)]: { body: { files: listingOf(n).map((entry) => ({ name: entry.path, hash: "h", size: entry.size })) } } };
  for (const entry of listingOf(n)) routes[fileUrl(O, R, ref, entry.path.slice(1))] = { body: listingBody(entry.path) };
  return routes;
}

const tick = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("runGithubIntake, success (7.3, 7.7, 8.5, 8.7)", () => {
  it("loads listing-small at an explicit ref: three file requests, the real analysis and the loaded message", async () => {
    const fake = createFakeFetch(smallRoutes());
    const store = recordingStore();
    const analysis = inlineAnalysisClient();
    const ui = recordingUi(`${REPO}/tree/main`);
    const outcome = await runGithubIntake(githubDeps(store, analysis, fake), "open", ui);

    expect(outcome.ok).toBe(true);
    expect(ui.states).toEqual(["listing", "fetching", "analyzing"]);
    expect(fake.calls.map((call) => call.url)).toEqual([listingUrl(O, R, "main"), ...["src/a.ts", "src/b.ts", "src/c.tsx"].map((path) => fileUrl(O, R, "main", path))]);
    expect(store.statuses).toEqual([text.loadingStarted(O, R, "main", 3), "Loaded octo/cat@main: 3 files, 3 modules, 1 relation, 1 diagnostic."]);
    expect(store.calls).toEqual(["setStatus", "openInvestigation", "setStatus"]);
    expect(store.opened[0]?.demo).toBe(false);
    expect(store.opened[0]?.investigation.sourceLabel).toBe("gh:octo/cat@main");
    expect([...(store.opened[0]?.source ?? new Map()).keys()]).toEqual(["src/a.ts", "src/b.ts", "src/c.tsx"]);
    const request = analysis.requests[0];
    expect(request?.rootLabel).toBe("gh:octo/cat@main");
    expect(request?.options.maxFiles).toBe(400);
    expect(request?.options.preset).toBe("static-value");
    // The one file over 1 MiB goes in as an empty entry (8.5), after the fetched files.
    expect(request?.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.tsx", "big.ts"]);
    expect(request?.files.at(-1)).toEqual({ path: "big.ts", text: "", bytes: 1_048_577 });
    if (outcome.ok) expect(outcome.label).toBe("gh:octo/cat@main");
  });

  it("without a ref asks for the version first and uses it for the listing and every file", async () => {
    const fake = createFakeFetch({ [resolveUrl(O, R)]: { body: { type: "gh", name: "octo/cat", version: "v2.0.0" } }, ...smallRoutes("v2.0.0") });
    const store = recordingStore();
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", recordingUi(REPO));
    expect(outcome.ok).toBe(true);
    expect(fake.calls.map((call) => call.url).slice(0, 2)).toEqual([resolveUrl(O, R), listingUrl(O, R, "v2.0.0")]);
    expect(fake.calls.slice(2).every((call) => call.url.includes("@v2.0.0/"))).toBe(true);
    expect(store.statuses[0]).toBe("Fetching 3 files from octo/cat@v2.0.0.");
    expect(store.opened[0]?.investigation.sourceLabel).toBe(liveInvestigation().sourceLabel);
  });

  it("makes no resolve request when the URL has a ref or the Branch or tag field has text", async () => {
    const fake = createFakeFetch(smallRoutes("dev"));
    await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(REPO, "dev"));
    expect(fake.calls.some((call) => call.url === resolveUrl(O, R))).toBe(false);
    expect(fake.calls[0]?.url).toBe(listingUrl(O, R, "dev"));
  });

  it("with no tags tries main, then master", async () => {
    const fake = createFakeFetch({ [resolveUrl(O, R)]: { body: { version: null } }, [listingUrl(O, R, "main")]: { status: 404, body: { status: 404 } }, ...smallRoutes("master") });
    const store = recordingStore();
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", recordingUi(REPO));
    expect(outcome.ok).toBe(true);
    expect(fake.calls.slice(0, 3).map((call) => call.url)).toEqual([resolveUrl(O, R), listingUrl(O, R, "main"), listingUrl(O, R, "master")]);
    expect(store.statuses.at(-1)).toContain("octo/cat@master");
  });

  it("with no tags and a main listing, never asks for master", async () => {
    const fake = createFakeFetch({ [resolveUrl(O, R)]: { body: { version: null } }, ...smallRoutes("main") });
    await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(REPO));
    expect(fake.calls.some((call) => call.url === listingUrl(O, R, "master"))).toBe(false);
  });

  it("builds the loaded sentence from the distinct relations and the diagnostics", async () => {
    const fake = createFakeFetch(smallRoutes());
    const store = recordingStore();
    await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", recordingUi(`${REPO}/tree/main`));
    const live = liveInvestigation();
    const relations = new Set(live.imports.map((record) => record.relationId)).size;
    expect(store.statuses.at(-1)).toBe(text.loaded(O, R, "main", 3, live.modules.length, relations, live.diagnostics.length));
  });
});

describe("runGithubIntake, input that needs the user (7.2, 7.3)", () => {
  it.each([
    ["https://github.com/octo/cat/tree/main/src", text.SUBFOLDER_REJECTED, true],
    ["https://github.com/octo/cat/issues", text.SUBFOLDER_REJECTED, false],
    ["octo/cat", text.URL_FORMAT, false],
  ])("a rejected address (%s) makes no request and writes the message once", async (url, message, showsRef) => {
    const fake = createFakeFetch({});
    const store = recordingStore();
    const ui = recordingUi(url);
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", ui);
    expect(outcome).toEqual({ ok: false, reason: "input", message });
    expect(fake.calls).toHaveLength(0);
    expect(store.statuses).toEqual([message]);
    expect(store.calls).toEqual(["setStatus"]);
    expect(ui.notices.at(-1)).toBe(message);
    expect(ui.shownRefField).toEqual(showsRef ? [""] : []);
    expect(ui.focused.at(-1)).toBe(showsRef ? "ref" : "url");
  });

  it("with no tags and neither main nor master, shows the Branch or tag field filled with main and stops", async () => {
    const fake = createFakeFetch({ [resolveUrl(O, R)]: { body: { version: null } } });
    const store = recordingStore();
    const ui = recordingUi(REPO);
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", ui);
    expect(outcome).toEqual({ ok: false, reason: "input", message: text.TYPE_REF });
    expect(ui.shownRefField).toEqual(["main"]);
    expect(ui.focused.at(-1)).toBe("ref");
    expect(fake.calls.map((call) => call.url)).toEqual([resolveUrl(O, R), listingUrl(O, R, "main"), listingUrl(O, R, "master")]);
    expect(store.statuses).toEqual([text.TYPE_REF]);
  });

  it("a blank Branch or tag field counts as no ref and asks for the version", async () => {
    const fake = createFakeFetch({ [resolveUrl(O, R)]: { body: { version: "v3.0.0" } }, ...smallRoutes("v3.0.0") });
    const outcome = await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(REPO, "  "));
    expect(outcome.ok).toBe(true);
    expect(fake.calls[0]?.url).toBe(resolveUrl(O, R));
  });

  it("the Branch or tag field wins over the ref of the URL, trimmed", async () => {
    const fake = createFakeFetch(smallRoutes("dev"));
    await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(`${REPO}/tree/main`, " dev "));
    expect(fake.calls[0]?.url).toBe(listingUrl(O, R, "dev"));
  });

  it("in after mode a rejection writes no status", async () => {
    const store = recordingStore();
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), createFakeFetch({})), "after", recordingUi("nope"));
    expect(outcome).toEqual({ ok: false, reason: "input", message: text.URL_FORMAT });
    expect(store.statuses).toEqual([]);
  });
});

describe("runGithubIntake, failures (7.5, 7.6, 8.4)", () => {
  it.each([404, 403])("a listing that answers %i shows the listing message, fetches nothing and keeps the state", async (status) => {
    const store = recordingStore(liveInvestigation());
    const before = store.snapshot();
    const fake = createFakeFetch({ [listingUrl(O, R, "main")]: { status, body: {} } });
    const ui = recordingUi(`${REPO}/tree/main`);
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", ui);
    const message = text.listFailed(O, R, "main", String(status));
    expect(outcome).toEqual({ ok: false, reason: "failed", message });
    expect(store.statuses).toEqual([`${message} ${PRESERVED}`]);
    expect(store.calls).toEqual(["setStatus"]);
    expect(store.snapshot()).toBe(before);
    expect(fake.calls).toHaveLength(1);
    expect(ui.states.at(-1)).toBe("url");
    expect(ui.focused.at(-1)).toBe("load");
  });

  it("a rejected listing shows the error name", async () => {
    const fake = createFakeFetch({ [listingUrl(O, R, "main")]: { reject: "TypeError" } });
    const outcome = await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(`${REPO}/tree/main`));
    expect(outcome).toEqual({ ok: false, reason: "failed", message: text.listFailed(O, R, "main", "TypeError") });
  });

  it("a failed resolve names the latest version in place of a ref", async () => {
    const fake = createFakeFetch({ [resolveUrl(O, R)]: { status: 404, body: {} } });
    const outcome = await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(REPO));
    expect(outcome).toEqual({ ok: false, reason: "failed", message: text.listFailed(O, R, "latest", "404") });
    expect(fake.calls).toHaveLength(1);
  });

  it("a main listing that fails with something other than 404 does not try master", async () => {
    const fake = createFakeFetch({ [resolveUrl(O, R)]: { body: { version: null } }, [listingUrl(O, R, "main")]: { status: 500, body: {} } });
    const outcome = await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(REPO));
    expect(outcome).toEqual({ ok: false, reason: "failed", message: text.listFailed(O, R, "main", "500") });
    expect(fake.calls).toHaveLength(2);
  });

  it("401 listed files stop with the cap message naming src/m99.ts and no file request", async () => {
    const fake = createFakeFetch(listingRoutes(401));
    const store = recordingStore();
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", recordingUi(`${REPO}/tree/main`));
    const sorted = listingOf(401).map((entry) => entry.path.slice(1)).sort();
    expect(sorted[400]).toBe("src/m99.ts");
    const message = text.cap(O, R, "main", 401, "src/m99.ts");
    expect(outcome).toEqual({ ok: false, reason: "failed", message });
    expect(store.statuses).toEqual([`${message} ${PRESERVED}`]);
    expect(fake.calls).toHaveLength(1);
  });

  it("exactly 400 listed files are fetched", async () => {
    const fake = createFakeFetch(listingRoutes(400));
    const outcome = await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(`${REPO}/tree/main`));
    expect(outcome.ok).toBe(true);
    expect(fake.calls).toHaveLength(401);
    expect(fake.maxPending).toBeLessThanOrEqual(6);
  });

  it("over 25 MiB of listed text stops with the byte message", async () => {
    const files = Array.from({ length: 26 }, (_, i) => ({ name: `/src/big${i}.ts`, hash: "h", size: 1_048_576 }));
    const fake = createFakeFetch({ [listingUrl(O, R, "main")]: { body: { files } } });
    const store = recordingStore();
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", recordingUi(`${REPO}/tree/main`));
    expect(outcome).toEqual({ ok: false, reason: "failed", message: text.capBytes(O, R, "main", "26.0 MiB") });
    expect(fake.calls).toHaveLength(1);
  });

  it("no included file stops with the none message", async () => {
    const fake = createFakeFetch({ [listingUrl(O, R, "main")]: { body: { files: [{ name: "/README.md", hash: "h", size: 10 }, { name: "/node_modules/x/i.js", hash: "h", size: 5 }] } } });
    const outcome = await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(`${REPO}/tree/main`));
    expect(outcome).toEqual({ ok: false, reason: "failed", message: text.noFilesGh(O, R, "main") });
    expect(fake.calls).toHaveLength(1);
  });

  it("a 500 on one file aborts the rest, names the file and loads nothing", async () => {
    const bad = fileUrl(O, R, "main", "src/b.ts");
    const fake = createFakeFetch(smallRoutes("main", { [bad]: { status: 500 } }));
    const store = recordingStore(liveInvestigation());
    const before = store.snapshot();
    const ui = recordingUi(`${REPO}/tree/main`);
    const analysis = instantAnalysisClient();
    const outcome = await runGithubIntake(githubDeps(store, analysis, fake), "open", ui);
    const message = text.fetchFailed("src/b.ts", O, R, "main", "500");
    expect(outcome).toEqual({ ok: false, reason: "failed", message });
    expect(store.statuses).toEqual([text.loadingStarted(O, R, "main", 3), `${message} ${PRESERVED}`]);
    expect(store.snapshot()).toBe(before);
    expect(analysis.requests).toHaveLength(0);
    expect(ui.controller.signal.aborted).toBe(true);
  });

  it("an analysis failure keeps the state and says which kind of thing failed", async () => {
    const analysis = pendingAnalysisClient();
    const store = recordingStore();
    const fake = createFakeFetch(smallRoutes());
    const running = runGithubIntake(githubDeps(store, analysis, fake), "open", recordingUi(`${REPO}/tree/main`));
    await tick(20);
    const broken = new Error("the worker stopped");
    broken.name = "AnalysisFailed";
    analysis.calls[0]?.reject(broken);
    const outcome = await running;
    const message = text.analyzeFailedGh("the worker stopped");
    expect(outcome).toEqual({ ok: false, reason: "failed", message });
    expect(store.statuses.at(-1)).toBe(`${message} ${PRESERVED}`);
    expect(store.calls).toEqual(["setStatus", "setStatus"]);
  });

  it("in after mode a failure resolves the bare message and writes no status", async () => {
    const store = recordingStore();
    const fake = createFakeFetch({ [listingUrl(O, R, "main")]: { status: 404, body: {} } });
    const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "after", recordingUi(`${REPO}/tree/main`));
    expect(outcome).toEqual({ ok: false, reason: "failed", message: text.listFailed(O, R, "main", "404") });
    expect(store.statuses).toEqual([]);
  });
});

describe("runGithubIntake, cancel (8.3)", () => {
  async function cancelAt(state: "resolving" | "listing" | "fetching" | "analyzing", opts: { label?: boolean } = {}) {
    const store = recordingStore(opts.label === false ? null : liveInvestigation());
    const before = store.snapshot();
    const analysis = pendingAnalysisClient();
    let fake: FakeFetch;
    let url = `${REPO}/tree/main`;
    if (state === "resolving") {
      url = REPO;
      fake = createFakeFetch({ [resolveUrl(O, R)]: { hold: true } });
    } else if (state === "listing") fake = createFakeFetch({ [listingUrl(O, R, "main")]: { hold: true } });
    else if (state === "fetching") fake = createFakeFetch(Object.fromEntries(Object.entries(smallRoutes()).map(([key, route]) => [key, key.startsWith("https://cdn.jsdelivr.net/") ? { ...route, hold: true } : route])));
    else fake = createFakeFetch(smallRoutes());
    const ui = recordingUi(url);
    const running = runGithubIntake(githubDeps(store, analysis, fake), "open", ui);
    await tick(30);
    expect(ui.states.at(-1)).toBe(state);
    const requestsBefore = fake.calls.length;
    ui.controller.abort();
    const outcome = await running;
    await tick(10);
    return { outcome, store, before, ui, fake, analysis, requestsBefore };
  }

  it.each(["resolving", "listing", "fetching", "analyzing"] as const)("cancel while %s returns cancelled, writes the message and keeps the six fields", async (state) => {
    const run = await cancelAt(state);
    expect(run.outcome).toEqual({ ok: false, reason: "cancelled" });
    expect(run.store.statuses.at(-1)).toBe(text.loadCancelled(liveInvestigation().sourceLabel));
    expect(run.store.calls.filter((call) => call !== "setStatus")).toEqual([]);
    expect(run.store.snapshot()).toBe(run.before);
    expect(run.ui.states.at(-1)).toBe("url");
    expect(run.ui.focused.at(-1)).toBe("load");
    expect(run.fake.calls.length).toBe(run.requestsBefore);
    expect(run.fake.pending).toBe(0);
    expect(run.analysis.cancelCount).toBe(state === "analyzing" ? 1 : 0);
  });

  it("uses the short message when no investigation is open", async () => {
    const run = await cancelAt("listing", { label: false });
    expect(run.store.statuses.at(-1)).toBe("Loading cancelled.");
  });

  it("cancel in the middle of fetching 200 files sends no request afterwards", async () => {
    const routes = listingRoutes(200);
    const slow = Object.fromEntries(Object.entries(routes).map(([key, route]) => [key, key.startsWith("https://cdn.jsdelivr.net/") ? { ...route, delayMs: 3 } : route]));
    const fake = createFakeFetch(slow);
    const store = recordingStore();
    const ui = recordingUi(`${REPO}/tree/main`);
    const running = runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", ui);
    const start = Date.now();
    while (ui.progress.length < 50 && Date.now() - start < 5000) await tick(2);
    ui.controller.abort();
    const outcome = await running;
    const sent = fake.calls.length;
    await tick(30);
    expect(outcome).toEqual({ ok: false, reason: "cancelled" });
    expect(fake.calls.length).toBe(sent);
    expect(sent).toBeLessThan(201);
    expect(ui.progress.at(-1)?.[0]).toBeLessThan(200);
  });

  it("a result that arrives after the cancel changes nothing", async () => {
    const analysis = pendingAnalysisClient();
    const store = recordingStore();
    const ui = recordingUi(`${REPO}/tree/main`);
    const running = runGithubIntake(githubDeps(store, analysis, createFakeFetch(smallRoutes())), "open", ui);
    await tick(30);
    ui.controller.abort();
    await running;
    analysis.calls[0]?.resolve(liveInvestigation());
    await tick(5);
    expect(store.calls.filter((call) => call !== "setStatus")).toEqual([]);
  });
});

describe("runGithubIntake, progress and after mode (8.2, 9.3)", () => {
  it("reports Fetched <done> of <total> once per settled file, ending at the total", async () => {
    const fake = createFakeFetch(listingRoutes(200));
    const ui = recordingUi(`${REPO}/tree/main`);
    await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", ui);
    expect(ui.progress).toHaveLength(201);
    expect(ui.progress[0]).toEqual([0, 200]);
    expect(ui.progress[1]).toEqual([1, 200]);
    expect(ui.progress.at(-1)).toEqual([200, 200]);
    expect(text.progress(200, 200)).toBe("Fetched 200 of 200 files");
    expect(ui.analysisProgress[0]).toEqual([0, 200]);
    expect(ui.states).toEqual(["listing", "fetching", "analyzing"]);
  });

  it("in after mode writes only the start message, calls no other store action and resolves the result", async () => {
    const store = recordingStore();
    const fake = createFakeFetch(smallRoutes());
    const outcome = await runGithubIntake(githubDeps(store, inlineAnalysisClient(), fake), "after", recordingUi(`${REPO}/tree/main`));
    expect(store.calls).toEqual(["setStatus"]);
    expect(store.statuses).toEqual([text.loadingStarted(O, R, "main", 3)]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.label).toBe("gh:octo/cat@main");
      expect([...(outcome.sourceText ?? new Map()).keys()]).toEqual(["src/a.ts", "src/b.ts", "src/c.tsx"]);
    }
  });
});
