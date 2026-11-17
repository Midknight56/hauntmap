import { useEffect, useState } from "react";

/** The widest viewport that gets the phone layout (`app.css` uses the same number). */
export const PHONE_MAX_WIDTH = 720;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/** True while the media query matches. Where `matchMedia` does not exist (the unit-test DOM) it is false. */
export function useMediaQuery(query: string): boolean {
  const read = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** The phone layout: the top bar holds the brand and `More`, and the other controls sit behind `More`. */
export function usePhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
