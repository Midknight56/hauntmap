import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { ComparePanel } from "./ComparePanel";
import type { HostState, HostStore } from "./host";
import { getCompareStore } from "./register";
import type { CompareStore } from "./store";
import "./compare.css";

const noop = (): (() => void) => () => undefined;

/** The compare store's state as React state. */
export function useCompareState(cs: CompareStore | null) {
  return useSyncExternalStore(cs?.subscribe ?? noop, () => cs?.getState() ?? null);
}

function useHostState(store: HostStore): HostState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

/**
 * The toolbar control `Compare revisions` (a button with `aria-expanded`) and, while open, the panel right
 * after it in the same slot, so the Tab order runs button, panel, next control. The panel is a popover
 * placed below the button, so the toolbar row does not grow.
 */
export function CompareControl({ store }: { store: HostStore }): ReactElement | null {
  const cs = getCompareStore();
  const compare = useCompareState(cs);
  const host = useHostState(store);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [top, setTop] = useState<number | null>(null);
  const open = compare?.panelOpen === true;

  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      setTop(rect === undefined ? null : Math.round(rect.bottom + 6));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  if (cs === null || compare === null) return null;
  const focusButton = (): void => buttonRef.current?.focus();
  return (
    <>
      <button ref={buttonRef} type="button" aria-expanded={open} onClick={() => (open ? cs.actions.closePanel() : cs.actions.openPanel())}>
        Compare revisions
      </button>
      {open ? (
        <div className="compare-popover" style={top === null ? undefined : { top: `${top}px`, maxHeight: `calc(100vh - ${top + 12}px)` }}>
          <ComparePanel
            cs={cs}
            compare={compare}
            host={host}
            onClose={() => {
              cs.actions.closePanel();
              focusButton();
            }}
            onEnded={focusButton}
          />
        </div>
      ) : null}
    </>
  );
}
