import { useEffect, useState, type ReactElement, type RefObject } from "react";
import { analysisApi, type AnalysisApi } from "../features/investigation/analysisApi";
import { tooltipLines } from "../features/investigation/tooltip";
import type { InvestigationStore } from "../features/investigation/store";
import type { HitKind, SceneHandle } from "../scene/types";
import { useViewState } from "./useStore";

export { tooltipLines };

interface Target {
  kind: HitKind;
  id: string;
  /** The DOM item that has focus, when the tooltip comes from focus rather than from the pointer. */
  element?: Element;
}

const TIP_WIDTH = 320;

function same(a: Target | null, b: Target | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id && a.element === b.element);
}

/**
 * The tooltip of requirement 5.2. It shows for the element under the pointer and for the Evidence-view,
 * inspector or trail item that has focus (those items carry `data-tip-kind` and `data-tip-id`), and goes
 * away on blur, on pointer leave and on Escape. It is anchored to the element's screen rectangle on the
 * map; with the map hidden or the element not drawn it is anchored to the focused item instead.
 */
export function Tooltip({
  store,
  scene,
  wrapper,
  api = analysisApi,
}: {
  store: InvestigationStore;
  scene: SceneHandle | null;
  wrapper: RefObject<HTMLElement | null>;
  api?: AnalysisApi;
}): ReactElement | null {
  const state = useViewState(store);
  const [hover, setHover] = useState<Target | null>(null);
  const [focused, setFocused] = useState<Target | null>(null);

  useEffect(() => {
    const host = wrapper.current;
    if (host === null || scene === null) return;
    const move = (event: PointerEvent): void => {
      const hit = scene.hitTest(event.clientX, event.clientY);
      const next: Target | null = hit === null ? null : { kind: hit.kind, id: hit.id };
      setHover((previous) => (same(previous, next) ? previous : next));
    };
    const leave = (): void => setHover(null);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, [scene, wrapper]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const item = event.target instanceof Element ? event.target.closest("[data-tip-kind]") : null;
      const kind = item?.getAttribute("data-tip-kind");
      const id = item?.getAttribute("data-tip-id");
      setFocused(item === null || item === undefined || !kind || id === null || id === undefined ? null : { kind: kind as HitKind, id, element: item });
    };
    const onFocusOut = (): void => setFocused(null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setHover(null);
      setFocused(null);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const target = focused ?? hover;
  const inv = state.investigation;
  if (target === null || inv === null) return null;

  let anchor: { x: number; y: number; width: number; height: number } | null = null;
  const mapVisible = state.activeView === "map";
  if (scene !== null && mapVisible) {
    try {
      anchor = scene.screenRectOf({ kind: target.kind, id: target.id });
    } catch {
      anchor = null;
    }
  }
  if (anchor === null && target.element !== undefined) anchor = target.element.getBoundingClientRect();
  if (anchor === null) return null;

  const [first, second] = tooltipLines(target, inv, api, state.routeFilter);
  const left = Math.max(4, Math.min(anchor.x, window.innerWidth - TIP_WIDTH - 4));
  const top = Math.min(anchor.y + anchor.height + 6, window.innerHeight - 60);
  return (
    <div role="tooltip" className="tooltip" style={{ left, top, maxWidth: TIP_WIDTH }}>
      <p className="tooltip-concept">{first}</p>
      <p className="tooltip-fact">{second}</p>
    </div>
  );
}