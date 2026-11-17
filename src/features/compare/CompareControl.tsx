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
  const [at, setAt] = useState<{ top: number; left: number | null } | null>(null);
  const open = compare?.panelOpen === true;

  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      // On a larger screen the button is in the side bar and the popover opens to its right; on a phone it spans the screen under the button.
      setAt(rect === undefined ? null : window.innerWidth > 720 ? { top: Math.round(rect.top), left: Math.round(rect.right + 8) } : { top: Math.round(rect.bottom + 6), left: null });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  if (cs === null || compare === null) return null;
  const focusButton = (): void => buttonRef.current?.focus();
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={() => (open ? cs.actions.closePanel() : cs.actions.openPanel())}
        onKeyDown={(event) => {
          // Escape closes the popover from its own button as well as from inside it; focus stays on the button.
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          cs.actions.closePanel();
        }}
      >
        Compare revisions
      </button>
      {open ? (
        <div
          className="compare-popover"
          style={at === null ? undefined : { top: `${at.top}px`, ...(at.left === null ? {} : { left: `${at.left}px`, right: "auto" }), maxHeight: `calc(100vh - ${at.top + 12}px)` }}
        >
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
