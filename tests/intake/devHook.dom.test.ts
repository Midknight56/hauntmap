import { afterEach, describe, expect, it } from "vitest";
import { installIntakeHook } from "../../src/features/import/devHook";
import { createIntake } from "../../src/features/import/intake";
import type { IntakeDeps } from "../../src/features/import/types";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import { validateInvestigation } from "../../src/contracts/validate";
import { createInlineReadWorkers } from "./fakes";

// The development hook of the intake service (design.md, Development hook): `window.__hauntmap.intake`.

afterEach(() => {
  delete (window as unknown as { __hauntmap?: unknown }).__hauntmap;
});

function service() {
  const deps: IntakeDeps = {
    store: { getState: () => ({ investigation: null, preset: "static-value" }), actions: { openInvestigation: () => undefined, setStatus: () => undefined } },
    analysisClient: { analyze: () => new Promise(() => undefined), cancel: () => undefined },
    defaults: DEFAULT_ANALYSIS_OPTIONS,
    validate: validateInvestigation,
    saved: null,
    createReadWorker: createInlineReadWorkers().create,
    github: null,
  };
  return createIntake(deps);
}

describe("installIntakeHook", () => {
  it("adds intake with the service and setReadDelay to the existing hook object", () => {
    const hook: Record<string, unknown> = { store: "kept" };
    (window as unknown as { __hauntmap?: unknown }).__hauntmap = hook;
    const intake = service();
    installIntakeHook(intake);
    const added = hook["intake"] as { service: unknown; setReadDelay(ms: number): void };
    expect(hook["store"]).toBe("kept");
    expect(added.service).toBe(intake);
    added.setReadDelay(20);
    expect(intake.getState().readDelayMs).toBe(20);
    added.setReadDelay(-5);
    expect(intake.getState().readDelayMs).toBe(0);
  });

  it("does nothing when there is no hook object", () => {
    expect(() => installIntakeHook(service())).not.toThrow();
    expect((window as unknown as { __hauntmap?: unknown }).__hauntmap).toBeUndefined();
  });
});
