import { useEffect, useState } from "react";
import { DEFAULT_PREFS, effectiveReducedMotion, type Prefs } from "../features/investigation/prefs";

const QUERY = "(prefers-reduced-motion: reduce)";

/** The media query, or null where the environment has none (the system preference is then "no preference"). */
function mediaQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
}

/** Whether motion is reduced: the `Motion` toggle, or the system preference while the toggle is `system`. */
export function useReducedMotion(motion: Prefs["motion"]): boolean {
  const [matches, setMatches] = useState<boolean>(() => mediaQuery()?.matches ?? false);
  useEffect(() => {
    const query = mediaQuery();
    if (query === null) return;
    const update = (): void => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return effectiveReducedMotion({ ...DEFAULT_PREFS, motion }, matches);
}