import { useEffect, useRef, useState, type ReactElement } from "react";
import { openLiveSnapshot } from "./openLiveSnapshot";
import type { LiveDeps, LiveStore } from "./openLiveSnapshot";

let current: LiveDeps | null = null;

/** The dependencies the control uses; `registerLiveSnapshot` calls it at app start, tests call it with fakes. */
export function configure(deps: LiveDeps): void {
  current = deps;
}

/** The toolbar button `Open live snapshot`; a second activation while a run is pending is ignored. */
export function LiveSnapshotControl(props: { store: LiveStore }): ReactElement {
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = (): void => {
    if (pending || current === null) return;
    setPending(true);
    void openLiveSnapshot({ ...current, store: props.store }).finally(() => {
      if (mounted.current) setPending(false);
    });
  };
  return (
    <button type="button" aria-disabled={pending ? "true" : undefined} onClick={run}>
      Open live snapshot
    </button>
  );
}