// Design tokens and the style of every element state. The facts the map may show are the ones of the
// plan's visual-language table (module, wing, relation, cycle witness, trace, boundary, comparison
// state, filter state); `STATE_STYLES` has no key outside that list, and no size, color or glow here
// encodes risk, failure, coverage or churn.

export const TOKENS = {
  floor: "#141019",
  wing: "#241d30",
  wingInk: "#d8cfe6",
  room: "#3a3150",
  roomInk: "#f3ecff",
  roomSubdued: "#211c2c",
  roomSubduedInk: "#d8cfe6",
  door: "#e9d8a6",
  corridor: "#8f6bff",
  sealed: "#b8b0c4",
  light: "#7df9ff",
  panel: "#1b1622",
  ink: "#f1ecf7",
  inkMuted: "#b9b0c7",
  focus: "#f5b700",
} as const;

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
  fill: string;
  /** In scene units. Every non-default state differs from `default` by this, the glyph or the label. */
  outlineWidth: number;
  glyph: string | null;
  label: string | null;
}

export const STATE_STYLES: Record<State, StateStyle> = {
  default: { fill: TOKENS.room, outlineWidth: 1, glyph: null, label: null },
  selected: { fill: TOKENS.room, outlineWidth: 3, glyph: null, label: null },
  subdued: { fill: TOKENS.roomSubdued, outlineWidth: 1, glyph: null, label: "Not in this traversal" },
  witness: { fill: TOKENS.room, outlineWidth: 2, glyph: null, label: "Step number" },
  trace: { fill: TOKENS.room, outlineWidth: 2, glyph: null, label: "Step number" },
  focusHalo: { fill: TOKENS.room, outlineWidth: 4, glyph: null, label: "Focus" },
  "comparison-changed": { fill: TOKENS.room, outlineWidth: 1, glyph: "\u25C8", label: "Changed source" },
  "comparison-removed": { fill: TOKENS.roomSubdued, outlineWidth: 2, glyph: null, label: "Removed in the newer snapshot" },
  "comparison-added": { fill: TOKENS.room, outlineWidth: 1, glyph: "+", label: "Added in the newer snapshot" },
};

/** Concept words for the glyph drawn on a sealed doorway. */
export const SEALED_GLYPH = "?";