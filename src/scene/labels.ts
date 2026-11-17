// What a room name or a wing title says at a given room of space and zoom. Pure: no PixiJS, so tests can run it.
// The map keeps every drawn name at least 11 CSS pixels tall: the text is scaled up as the camera zooms out, and
// when the longer words no longer fit in a room, a shorter form is chosen (the full ID stays in the tooltip and
// the inspector).

export const MIN_LABEL_PX = 11;
/** A little above the minimum, so that rounding of the font metrics never lands under 11. */
export const TARGET_LABEL_PX = 11.5;

/** The factor that keeps text of `fontUnits` scene units at `TARGET_LABEL_PX` on screen at `zoom`; 1 once zoomed in. */
export function labelScale(zoom: number, fontUnits: number): number {
  return Math.max(1, TARGET_LABEL_PX / (fontUnits * Math.max(zoom, 0.0001)));
}

/** `src/orders/checkout.ts` becomes `checkout`; a leading dot belongs to the name. */
export function stemOfId(id: string): string {
  const name = id.slice(id.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Pieces of a name that may start a new line: after `-`, `_`, `.`, `/` and before a capital that follows a lowercase letter. */
function pieces(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const prev = text[i - 1];
    if (current !== "" && prev !== undefined && /[a-z0-9]/.test(prev) && /[A-Z]/.test(ch)) {
      out.push(current);
      current = "";
    }
    current += ch;
    if (/[-_./ ]/.test(ch)) {
      out.push(current);
      current = "";
    }
  }
  if (current !== "") out.push(current);
  return out;
}

function truncate(text: string, maxWidth: number, measure: (s: string) => number): string {
  for (let n = text.length - 1; n >= 1; n--) {
    const candidate = `${text.slice(0, n)}\u2026`;
    if (measure(candidate) <= maxWidth) return candidate;
  }
  return "\u2026";
}

function twoLines(text: string, maxWidth: number, measure: (s: string) => number): string[] | null {
  const parts = pieces(text);
  let best: { lines: string[]; width: number } | null = null;
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join("").trimEnd();
    const b = parts.slice(i).join("").trimStart();
    const width = Math.max(measure(a), measure(b));
    if (width <= maxWidth && (best === null || width < best.width)) best = { lines: [a, b], width };
  }
  return best === null ? null : best.lines;
}

/**
 * The lines to draw for a room name. `candidates` run from the longest wording to the shortest (the clipped file
 * name, then the stem). The first that fits on one line wins; then the first that splits into two lines at a word
 * boundary (when `maxLines` allows); otherwise the shortest is cut with an ellipsis.
 */
export function fitLines(candidates: readonly string[], maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  for (const candidate of candidates) if (measure(candidate) <= maxWidth) return [candidate];
  if (maxLines >= 2) {
    for (const candidate of candidates) {
      const split = twoLines(candidate, maxWidth, measure);
      if (split !== null) return split;
    }
  }
  const last = candidates[candidates.length - 1] ?? "";
  return [truncate(last, maxWidth, measure)];
}

/** The title of a wing plate: the full words when they fit, then the wing path, then its last folder, then that folder cut with an ellipsis. */
export function wingTitleFor(wing: string, moduleCount: number, maxWidth: number, measure: (s: string) => number): string {
  const full = `${wing} \u00B7 ${moduleCount} ${moduleCount === 1 ? "module" : "modules"}`;
  const last = wing.slice(wing.lastIndexOf("/") + 1);
  for (const candidate of [full, wing, last]) if (measure(candidate) <= maxWidth) return candidate;
  return truncate(last, maxWidth, measure);
}