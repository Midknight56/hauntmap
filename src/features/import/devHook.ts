import type { IntakeService } from "./types";

// The development hook of the intake service (design.md, Development hook). `App.tsx` calls `installIntakeHook` only in
// development builds. It adds `intake` to the existing `window.__hauntmap` through a structural cast, as the comparison
// hook does, and never imports `src/components/devHook.ts`.

export interface DevHookIntake {
  service: IntakeService;
  /** The delay between files in the read worker, so that a cancel can land in the middle of a read. */
  setReadDelay(ms: number): void;
}

export function installIntakeHook(service: IntakeService): void {
  const hook = (window as unknown as { __hauntmap?: Record<string, unknown> }).__hauntmap;
  if (hook === undefined) return;
  const intake: DevHookIntake = {
    service,
    setReadDelay(ms) {
      service.setReadDelay(ms);
    },
  };
  hook["intake"] = intake;
}
