import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import { validateInvestigation } from "../../src/contracts/validate";
import { createIntake, hasDirectoryInput } from "../../src/features/import/intake";
import type { IntakeDeps } from "../../src/features/import/types";
import { createInlineReadWorkers } from "./fakes";

// 1.1 kinds, 1.4 one dialog at a time, and the folder input probe (2.1). The service has no DOM of its own.

function deps(overrides: Partial<IntakeDeps> = {}): IntakeDeps {
  return {
    store: {
      getState: () => ({ investigation: null, preset: "static-value" }),
      actions: { openInvestigation: () => undefined, setStatus: () => undefined },
    },
    analysisClient: { analyze: () => new Promise(() => undefined), cancel: () => undefined },
    defaults: DEFAULT_ANALYSIS_OPTIONS,
    validate: validateInvestigation,
    saved: null,
    createReadWorker: createInlineReadWorkers().create,
    github: null,
    ...overrides,
  };
}

describe("intake service (1.1)", () => {
  it("offers only the local route when no GitHub opener is wired", () => {
    expect(createIntake(deps()).kinds).toEqual(["local"]);
  });

  it("offers both routes when deps.github is set", () => {
    expect(createIntake(deps({ github: { fetchImpl: (() => Promise.reject(new Error("unused"))) as typeof fetch } })).kinds).toEqual(["local", "github"]);
  });

  it("starts with no dialog and a read delay of 0", () => {
    expect(createIntake(deps()).getState()).toEqual({ dialog: null, readDelayMs: 0 });
  });
});

describe("one dialog at a time (1.4)", () => {
  it("returns the pending promise of the open dialog and opens nothing else", async () => {
    const service = createIntake(deps());
    const first = service.open({ purpose: "open", kind: "local" });
    const stateAfterFirst = service.getState();
    const second = service.open({ purpose: "after", kind: "local" });
    expect(second).toBe(first);
    expect(service.getState()).toBe(stateAfterFirst);
    expect(service.getState().dialog).toMatchObject({ kind: "local", purpose: "open" });
    service.close({ ok: false, reason: "cancelled" });
    await expect(first).resolves.toEqual({ ok: false, reason: "cancelled" });
  });

  it("opens a new dialog after the first one closed, and notifies subscribers of each change", async () => {
    const service = createIntake(deps());
    let notified = 0;
    const unsubscribe = service.subscribe(() => {
      notified += 1;
    });
    const first = service.open({ purpose: "open", kind: "local" });
    service.close({ ok: false, reason: "cancelled" });
    await first;
    expect(service.getState().dialog).toBeNull();
    const second = service.open({ purpose: "after", kind: "local" });
    expect(second).not.toBe(first);
    expect(service.getState().dialog).toMatchObject({ purpose: "after" });
    expect(notified).toBe(3);
    unsubscribe();
    service.close({ ok: false, reason: "cancelled" });
    expect(notified).toBe(3);
    await second;
  });

  it("resolves a call for the GitHub route as failed when no GitHub opener is wired", async () => {
    const service = createIntake(deps());
    const result = await service.open({ purpose: "open", kind: "github" });
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(service.getState().dialog).toBeNull();
  });

  it("resolve() settles the promise but keeps the dialog open, and close() does not settle it twice", async () => {
    const service = createIntake(deps());
    const pending = service.open({ purpose: "open", kind: "local" });
    const done = { ok: true as const, investigation: {} as never, sourceText: null, label: "local:x" };
    service.resolve(done);
    await expect(pending).resolves.toBe(done);
    expect(service.getState().dialog).not.toBeNull();
    service.close({ ok: false, reason: "cancelled" });
    await expect(pending).resolves.toBe(done);
    expect(service.getState().dialog).toBeNull();
  });
});

describe("hasDirectoryInput (2.1)", () => {
  const docWith = (props: object): Document => ({ createElement: () => props }) as unknown as Document;

  it("is true when a new file input has the webkitdirectory property", () => {
    expect(hasDirectoryInput(docWith({ webkitdirectory: false }))).toBe(true);
  });

  it("is false when it has not", () => {
    expect(hasDirectoryInput(docWith({}))).toBe(false);
  });
});
