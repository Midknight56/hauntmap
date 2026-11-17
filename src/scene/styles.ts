// Design tokens and the style of every element state. The facts the map may show are the ones of the
// plan's visual-language table (module, wing, relation, cycle witness, trace, boundary, comparison
// state, filter state); `STATE_STYLES` has no key outside that list, and no size, color or glow here
// encodes risk, failure, coverage or churn.

import { liveTokens, type Palette } from "../styles/theme";

// The live palette of src/styles/theme.ts (Candlelit manor unless `setTheme` chose another). Read it at draw time, never copy a value.
export const TOKENS: Palette = liveTokens;

export type ElementKind = "room" | "wing" | "door" | "sealed" | "corridor" | "grouped";

export type State =
  | "default"
  | "selected"
  | "subdued"
  | "witness"
  | "trace"
  | "focusHalo"
  | "comparison-changed"
  | "comparison-removed"
  | "comparison-added";

export interface StateStyle {
  /** The palette color at the time of reading, so a theme change reaches every state. */
  readonly fill: string;
  /** In scene units. Every non-default state differs from `default` by this, the glyph or the label. */
  outlineWidth: number;
  glyph: string | null;
  label: string | null;
  /** `dashed` for the ghost outline of `comparison-removed`, `dotted` for the inner rail of a subdued room; absent means `solid`. */
  outlineStyle?: "solid" | "dashed" | "dotted";
}

export const STATE_STYLES: Record<State, StateStyle> = {
  default: { get fill() { return TOKENS.room; }, outlineWidth: 1, glyph: null, label: null },
  selected: { get fill() { return TOKENS.room; }, outlineWidth: 3, glyph: null, label: null },
  subdued: { get fill() { return TOKENS.roomSubdued; }, outlineWidth: 1, outlineStyle: "dotted", glyph: null, label: "Not in this traversal" },
  witness: { get fill() { return TOKENS.room; }, outlineWidth: 2, glyph: null, label: "Step number" },
  trace: { get fill() { return TOKENS.room; }, outlineWidth: 2, glyph: null, label: "Step number" },
  focusHalo: { get fill() { return TOKENS.room; }, outlineWidth: 4, glyph: null, label: "Focus" },
  // The lamp of `comparison-changed` is drawn on the north edge by src/scene/compare/states.ts in `changed`.
  "comparison-changed": { get fill() { return TOKENS.room; }, outlineWidth: 0, glyph: null, label: "changed" },
  "comparison-removed": { get fill() { return TOKENS.roomSubdued; }, outlineWidth: 2, outlineStyle: "dashed", glyph: null, label: "removed" },
  "comparison-added": { get fill() { return TOKENS.room; }, outlineWidth: 2, glyph: "+", label: "added" },
};

/** Concept words for the glyph drawn on a sealed doorway. */
export const SEALED_GLYPH = "?";