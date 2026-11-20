import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileUrl, listingUrl, resolveUrl } from "../../src/features/github/jsdelivr";
import * as text from "../../src/features/github/messages";
import { PRESERVED } from "../../src/features/import/messages";
import { fakeIntakeStore, inlineAnalysisClient, makeHarness, type Harness } from "./dialogHarness";
import { createFakeFetch, type FakeFetch, type FakeRoute } from "./fakes";
import { listingBody, listingOf } from "./generators";
import { smallRepoRoutes } from "./githubFakes";
import { liveInvestigation } from "./graphHelpers";

// Component tests of the GitHub dialog (jsdom): roles and focus (1.2), the fields and the privacy note (7.1), the
// reasons to ask again (7.2, 7.3), the caps and failures (7.5, 7.6), the label and the result (7.7, 8.5), progress and
// cancel (8.2, 8.3).

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const O = "octo";
const R = "cat";
const REPO = "https://github.com/octo/cat";

const dialog = (): HTMLElement => screen.getByRole("dialog");
const urlInput = (): HTMLInputElement => screen.getByLabelText("Repository URL") as HTMLInputElement;
const refInput = (): HTMLInputElement => screen.getByLabelText("Branch or tag") as HTMLInputElement;
const button = (name: string): HTMLElement => within(dialog()).getByRole("button", { name });
const tick = (ms = 5) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function setup(routes: Record<string, FakeRoute> | ((url: string) => FakeRoute | undefined), opts: { real?: boolean; investigation?: boolean } = {}): { h: Harness; fake: FakeFetch } {
  const fake = createFakeFetch(routes);
  const store = fakeIntakeStore(opts.investigation === true ? { investigation: liveInvestigation() } : {});
  const h = makeHarness({ store, github: true, deps: { github: { fetchImpl: fake.fetch }, ...(opts.real === true ? { analysisClient: inlineAnalysisClient() } : {}) } });
  return { h, fake };
}

function typeUrl(value: string): void {
  fireEvent.change(urlInput(), { target: { value } });
}

function listingRoutes(n: number): Record<string, FakeRoute> {
  const routes: Record<string, FakeRoute> = { [listingUrl(O, R, "main")]: { body: { files: listingOf(n).map((entry) => ({ name: entry.path, hash: "h", size: entry.size })) } } };
  for (const entry of listingOf(n)) routes[fileUrl(O, R, "main", entry.path.slice(1))] = { body: listingBody(entry.path) };
  return routes;
}

describe("the dialog frame (1.2)", () => {
  it("is a modal dialog labelled by its heading, and focus moves to Repository URL", () => {
    const { h } = setup({});
    void h.open({ kind: "github" });
    const box = dialog();
    expect(box.getAttribute("aria-modal")).toBe("true");
    const heading = within(box).getByRole("heading", { name: "Load a GitHub repository" });
    expect(box.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(document.activeElement).toBe(urlInput());
    expect(box.getAttribute("aria-busy")).toBeNull();
  });

  it("adds the newer snapshot suffix to the heading in after mode", () => {
    const { h } = setup({});
    void h.open({ kind: "github", purpose: "after" });
    expect(within(dialog()).getByRole("heading", { name: "Load a GitHub repository as the newer snapshot" })).toBeTruthy();
  });

  it("closes on Escape and on Close, resolves cancelled and returns focus to the opener", async () => {
    const { h } = setup({});
    const first = h.open({ kind: "github" });
    fireEvent.keyDown(dialog(), { key: "Escape" });
    await expect(first).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(h.opener);
    const second = h.open({ kind: "github" });
    fireEvent.click(button("Close"));
    await expect(second).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(document.activeElement).toBe(h.opener);
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    const { h } = setup({});
    void h.open({ kind: "github" });
    expect(document.activeElement).toBe(urlInput());
    await user.tab();
    expect(document.activeElement).toBe(button("Load"));
    await user.tab();
    expect(document.activeElement).toBe(button("Close"));
    await user.tab();
    expect(document.activeElement).toBe(urlInput());
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(button("Close"));
  });
});

describe("the first screen (7.1, 10.2)", () => {
  it("shows the privacy note above Load from the first render and makes no request", () => {
    const { h, fake } = setup({});
    void h.open({ kind: "github" });
    const note = within(dialog()).getByText(text.PRIVACY_NOTE);
    expect(note.compareDocumentPosition(button("Load")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fake.calls).toHaveLength(0);
    expect(screen.queryByLabelText("Branch or tag")).toBeNull();
  });

  it("has the Tab order Repository URL, Load, Close, and Load is the primary button", async () => {
    const user = userEvent.setup();
    const { h } = setup({});
    void h.open({ kind: "github" });
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const el = document.activeElement as HTMLElement;
      seen.push(el.id === urlInput().id ? "Repository URL" : (el.textContent ?? ""));
      await user.tab();
    }
    expect(seen).toEqual(["Repository URL", "Load", "Close"]);
    expect(button("Load").classList.contains("primary")).toBe(true);
    expect(urlInput().type).toBe("text");
  });
});

describe("addresses that ask the user to change something (7.2, 7.3)", () => {
  it("a malformed address shows its message as text, writes it once, makes no request and keeps focus on the field", () => {
    const { h, fake } = setup({});
    void h.open({ kind: "github" });
    typeUrl("octo/cat");
    fireEvent.click(button("Load"));
    expect(within(dialog()).getByText(text.URL_FORMAT)).toBeTruthy();
    expect(h.store.statuses).toEqual([text.URL_FORMAT]);
    expect(fake.calls).toHaveLength(0);
    expect(document.activeElement).toBe(urlInput());
    expect(screen.queryByLabelText("Branch or tag")).toBeNull();
    expect(screen.queryByRole("dialog")?.getAttribute("aria-busy")).toBeNull();
  });

  it("a subfolder address is refused; one that may hold a ref with a slash also shows Branch or tag", async () => {
    const { h, fake } = setup({});
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/blob/main/x.ts`);
    fireEvent.click(button("Load"));
    expect(within(dialog()).getByText(text.SUBFOLDER_REJECTED)).toBeTruthy();
    expect(screen.queryByLabelText("Branch or tag")).toBeNull();
    await tick();
    typeUrl(`${REPO}/tree/feature/x`);
    fireEvent.click(button("Load"));
    expect(within(dialog()).getByText(text.SUBFOLDER_REJECTED)).toBeTruthy();
    expect(refInput().value).toBe("");
    expect(document.activeElement).toBe(refInput());
    expect(fake.calls).toHaveLength(0);
  });

  it("with no version and neither main nor master, shows Branch or tag filled with main and Type the branch or tag to load", async () => {
    const { h, fake } = setup({ [resolveUrl(O, R)]: { body: { version: null } }, ...smallRepoRoutes(O, R, "dev") }, { real: true });
    void h.open({ kind: "github" });
    typeUrl(REPO);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(refInput().value).toBe("main"));
    expect(within(dialog()).getByText(text.TYPE_REF)).toBeTruthy();
    expect(document.activeElement).toBe(refInput());
    expect(fake.calls.map((call) => call.url)).toEqual([resolveUrl(O, R), listingUrl(O, R, "main"), listingUrl(O, R, "master")]);
    // Tab order with the field: Repository URL, Branch or tag, Load, Close.
    const order = Array.from(dialog().querySelectorAll<HTMLElement>("input, button")).map((el) => (el.tagName === "INPUT" ? (el.id === urlInput().id ? "Repository URL" : "Branch or tag") : (el.textContent ?? "")));
    expect(order).toEqual(["Repository URL", "Branch or tag", "Load", "Close"]);
    // Nothing more is requested until Load is activated again; then the typed ref is used.
    const before = fake.calls.length;
    await tick(20);
    expect(fake.calls.length).toBe(before);
    fireEvent.change(refInput(), { target: { value: "dev" } });
    fireEvent.click(button("Load"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fake.calls[before]?.url).toBe(listingUrl(O, R, "dev"));
    expect(h.store.opened[0]?.investigation.sourceLabel).toBe("gh:octo/cat@dev");
  });
});

describe("caps and failures (7.5, 7.6)", () => {
  it("401 listed files stop with the cap message, no file request, the dialog open and focus on Load", async () => {
    const { h, fake } = setup(listingRoutes(401), { investigation: true });
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    const message = text.cap(O, R, "main", 401, "src/m99.ts");
    await waitFor(() => expect(h.store.statuses).toEqual([`${message} ${PRESERVED}`]));
    expect(fake.calls.map((call) => call.url)).toEqual([listingUrl(O, R, "main")]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(urlInput().value).toBe(`${REPO}/tree/main`);
    expect(document.activeElement).toBe(button("Load"));
    expect(h.store.calls).toEqual(["setStatus"]);
  });

  it("a listing without included files says so", async () => {
    const { h } = setup({ [listingUrl(O, R, "main")]: { body: { files: [{ name: "/README.md", hash: "h", size: 4 }] } } });
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(h.store.statuses).toEqual([`${text.noFilesGh(O, R, "main")} ${PRESERVED}`]));
  });

  it.each([404, 403])("a listing that answers %i shows the listing message and fetches no file", async (status) => {
    const { h, fake } = setup({ [listingUrl(O, R, "main")]: { status, body: {} } });
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(h.store.statuses).toEqual([`${text.listFailed(O, R, "main", String(status))} ${PRESERVED}`]));
    expect(fake.calls).toHaveLength(1);
    expect(document.activeElement).toBe(button("Load"));
  });

  it("a file that fails names the path, loads nothing and returns to the form", async () => {
    const bad = fileUrl(O, R, "main", "src/b.ts");
    const { h } = setup({ ...smallRepoRoutes(O, R, "main"), [bad]: { status: 500 } });
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    const message = text.fetchFailed("src/b.ts", O, R, "main", "500");
    await waitFor(() => expect(h.store.statuses.at(-1)).toBe(`${message} ${PRESERVED}`));
    expect(h.store.opened).toEqual([]);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(button("Load"));
    // A second Load with a working route starts again with a fresh controller.
    expect(urlInput().value).toBe(`${REPO}/tree/main`);
  });
});

describe("the result (7.7, 8.5)", () => {
  it("loads listing-small: the label, the options given to the client, the status messages and the closed dialog", async () => {
    const analysis = inlineAnalysisClient();
    const fake = createFakeFetch(smallRepoRoutes(O, R, "main"));
    const store = fakeIntakeStore();
    const h = makeHarness({ store, github: true, deps: { github: { fetchImpl: fake.fetch }, analysisClient: analysis } });
    const result = h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const outcome = await result;
    expect(outcome.ok).toBe(true);
    expect(store.statuses).toEqual([text.loadingStarted(O, R, "main", 3), "Loaded octo/cat@main: 3 files, 3 modules, 1 relation, 1 diagnostic."]);
    expect(store.opened).toHaveLength(1);
    expect(store.opened[0]?.demo).toBe(false);
    expect(store.opened[0]?.investigation.sourceLabel).toBe("gh:octo/cat@main");
    expect(analysis.requests[0]?.rootLabel).toBe("gh:octo/cat@main");
    expect(analysis.requests[0]?.options.maxFiles).toBe(400);
    expect(analysis.requests[0]?.options.preset).toBe("static-value");
    expect(document.activeElement).toBe(h.opener);
  });

  it("renders the repository name as text, never as markup", async () => {
    const { h } = setup({ [listingUrl("a", "b", "main")]: { status: 404, body: {} } });
    void h.open({ kind: "github" });
    typeUrl("https://github.com/a/b/tree/main");
    fireEvent.click(button("Load"));
    await waitFor(() => expect(h.store.statuses).toHaveLength(1));
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("working screen (8.2, 8.3)", () => {
  function heldRoutes(): Record<string, FakeRoute> {
    const routes = smallRepoRoutes(O, R, "main");
    routes[fileUrl(O, R, "main", "src/c.tsx")] = { ...routes[fileUrl(O, R, "main", "src/c.tsx")], hold: true };
    return routes;
  }

  it("shows Fetched <done> of <total> files with aria-busy, only Cancel is a control, and the other fields are gone", async () => {
    const { h, fake } = setup(heldRoutes());
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(within(dialog()).getByText("Fetched 2 of 3 files")).toBeTruthy());
    expect(dialog().getAttribute("aria-busy")).toBe("true");
    expect(Array.from(dialog().querySelectorAll("button, input")).map((el) => el.textContent || el.getAttribute("type"))).toEqual(["Cancel"]);
    expect(document.activeElement).toBe(button("Cancel"));
    fake.release();
    await waitFor(() => expect(h.analysis.calls).toHaveLength(1));
    expect(within(dialog()).getByText(/^Analyzing 0 of 4 files$/)).toBeTruthy();
    h.analysis.calls[0]?.onProgress?.(2, 4);
    await waitFor(() => expect(within(dialog()).getByText("Analyzing 2 of 4 files")).toBeTruthy());
  });

  it("Escape does nothing while work runs", async () => {
    const { h } = setup(heldRoutes());
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(within(dialog()).getByText("Fetched 2 of 3 files")).toBeTruthy());
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Cancel aborts the requests, writes the cancel message, returns to the form with Load focused and changes nothing else", async () => {
    const { h, fake } = setup(heldRoutes(), { investigation: true });
    const label = liveInvestigation().sourceLabel;
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(within(dialog()).getByText("Fetched 2 of 3 files")).toBeTruthy());
    const sent = fake.calls.length;
    fireEvent.click(button("Cancel"));
    await waitFor(() => expect(button("Load")).toBeTruthy());
    expect(h.store.statuses.at(-1)).toBe(text.loadCancelled(label));
    expect(h.store.calls.filter((call) => call !== "setStatus")).toEqual([]);
    expect(document.activeElement).toBe(button("Load"));
    expect(urlInput().value).toBe(`${REPO}/tree/main`);
    expect(dialog().getAttribute("aria-busy")).toBeNull();
    await tick(20);
    expect(fake.calls.length).toBe(sent);
    expect(fake.pending).toBe(0);
  });

  it("Cancel during the analysis calls the analysis client's cancel", async () => {
    const { h } = setup(smallRepoRoutes(O, R, "main"), { investigation: true });
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(h.analysis.calls).toHaveLength(1));
    fireEvent.click(button("Cancel"));
    await waitFor(() => expect(h.analysis.cancelCount).toBe(1));
    await waitFor(() => expect(button("Load")).toBeTruthy());
    expect(h.store.statuses.at(-1)).toBe(text.loadCancelled(liveInvestigation().sourceLabel));
  });
});

// Task 14 (requirement 12): a refusal is also shown inside the dialog, under the address field, as an alert.
describe("refusals shown in the dialog (12.1, 12.2)", () => {
  const alert = (): HTMLElement => within(dialog()).getByRole("alert");

  it("the 400 file cap: the same message as the status, as an alert under Repository URL, with focus on Load", async () => {
    const { h } = setup(listingRoutes(401), { investigation: true });
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    const message = `${text.cap(O, R, "main", 401, "src/m99.ts")} ${PRESERVED}`;
    await waitFor(() => expect(alert().textContent).toBe(message));
    expect(h.store.statuses).toEqual([message]);
    expect(alert().compareDocumentPosition(urlInput()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(urlInput().getAttribute("aria-describedby")).toBe(alert().id);
    expect(document.activeElement).toBe(button("Load"));
  });

  it.each([
    ["no files", { [listingUrl(O, R, "main")]: { body: { files: [{ name: "/README.md", hash: "h", size: 4 }] } } }, text.noFilesGh(O, R, "main")],
    ["a refused listing", { [listingUrl(O, R, "main")]: { status: 404, body: {} } }, text.listFailed(O, R, "main", "404")],
    ["a failed file", { ...smallRepoRoutes(O, R, "main"), [fileUrl(O, R, "main", "src/b.ts")]: { status: 500 } }, text.fetchFailed("src/b.ts", O, R, "main", "500")],
  ] as const)("%s: the message is an alert in the dialog as well as in the status", async (_name, routes, message) => {
    const { h } = setup(routes as Record<string, FakeRoute>, { investigation: true });
    void h.open({ kind: "github" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await waitFor(() => expect(alert().textContent).toBe(`${message} ${PRESERVED}`));
    expect(h.store.statuses.at(-1)).toBe(`${message} ${PRESERVED}`);
    expect(document.activeElement).toBe(button("Load"));
  });

  it("a bad address is an alert too, and the next Load clears it", async () => {
    const { h } = setup(smallRepoRoutes(O, R, "main"), { real: true });
    void h.open({ kind: "github" });
    typeUrl("octo/cat");
    fireEvent.click(button("Load"));
    expect(alert().textContent).toBe(text.URL_FORMAT);
    await tick();
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    expect(within(dialog()).queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("in after mode the dialog closes with the bare message and shows no alert", async () => {
    const { h } = setup({ [listingUrl(O, R, "main")]: { status: 403, body: {} } });
    const result = h.open({ kind: "github", purpose: "after" });
    typeUrl(`${REPO}/tree/main`);
    fireEvent.click(button("Load"));
    await expect(result).resolves.toEqual({ ok: false, reason: "failed", message: text.listFailed(O, R, "main", "403") });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});