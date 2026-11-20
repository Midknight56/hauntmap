import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

// The frame both dialogs share (Requirements 1.2, 10.3): role, label, Tab trap, Escape, aria-busy and focus on each screen.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const tabindex = el.getAttribute("tabindex");
    return tabindex === null || Number(tabindex) >= 0;
  });
}

export interface DialogFrameProps {
  title: string;
  /** Work is running: `aria-busy="true"`, and Escape does nothing (Cancel is the way out). */
  busy: boolean;
  /** Focus moves again whenever this changes (a new screen). */
  screenKey: string;
  onEscape(): void;
  children: ReactNode;
}

export function DialogFrame({ title, busy, screenKey, onEscape, children }: DialogFrameProps) {
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);

  // A screen marks its own first control with data-autofocus (the review focuses Analyze); otherwise the first focusable element gets focus.
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const target = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? null;
    target?.focus();
  }, [screenKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      if (!busy) onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const root = ref.current;
    if (root === null) return;
    const items = focusables(root);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = root.ownerDocument.activeElement;
    const inside = active !== null && root.contains(active);
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-busy={busy ? "true" : undefined} className="intake-dialog" onKeyDown={onKeyDown}>
      <h2 id={headingId} className="intake-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}
