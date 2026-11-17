import { configure, LiveSnapshotControl } from "./LiveSnapshotControl";
import type { LiveDeps } from "./openLiveSnapshot";

/** Called once at app start: stores the dependencies and fills the `live-snapshot` slot. */
export function registerLiveSnapshot(deps: LiveDeps): void {
  configure(deps);
  deps.registry.registerControl("live-snapshot", LiveSnapshotControl);
}