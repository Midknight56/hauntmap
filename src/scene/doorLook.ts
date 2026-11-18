import { easeInOut } from "./effects";

// The look of a door as numbers: how big it is drawn at a camera zoom, and how far its panel opens. Pure, no PixiJS, so that the
// numbers are tested without a scene. The drawing (elements.ts for the frame, doors.ts for the panel) reads them and draws only.

/** The size of a door in the layout, in scene units. */
export const DOOR_BASE_UNITS = 16;
/** A door is drawn this wide on the screen at the first view (the band to hit is 16 to 20 px). */
export const DOOR_TARGET_PX = 18;
/** The most a door grows past its layout size, so that a far zoom out never makes a door cover a room. */
export const DOOR_MAX_GROW = 2.4;

/**
 * How many times the 16 unit door is drawn at `zoom`: the factor that makes it `DOOR_TARGET_PX` wide on the screen, between 1 (a zoomed in
 * door keeps its natural size) and `DOOR_MAX_GROW`, in steps of a tenth so that a camera move changes it rarely.
 */
export function doorGrow(zoom: number): number {
  const raw = DOOR_TARGET_PX / (DOOR_BASE_UNITS * Math.max(zoom, 0.0001));
  return Math.round(Math.min(DOOR_MAX_GROW, Math.max(1, raw)) * 10) / 10;
}

/**
 * A door opens when the ghost (28 px wide) or the traveling light comes within this many screen pixels of it: the ghost starts to cover a
 * door 18 px wide at 23 px, and the swing takes 120 ms, in which the ghost walks 7 px. So the door is open before the ghost covers it, and
 * it shuts only when the ghost is this far on the other side, when it has long cleared the door.
 */
export const DOOR_REACH_PX = 32;

/** The reach of a door in scene units at `zoom`. */
export function doorReachUnits(zoom: number): number {
  return DOOR_REACH_PX / Math.max(zoom, 0.0001);
}

/** The width of a door on the screen at `zoom`, in pixels. */
export function doorPxAt(zoom: number): number {
  return DOOR_BASE_UNITS * doorGrow(zoom) * zoom;
}

/** The frame in the 16 unit grid of the door: two jambs, a lintel arch, and the opening between them (the hinge is the left jamb). */
export const FRAME = {
  outerLeft: 0.6,
  outerRight: 15.4,
  outerArchCenterY: 8,
  outerArchRadius: 7.4,
  innerLeft: 2.6,
  innerRight: 13.4,
  innerArchCenterY: 8.3,
  innerArchRadius: 5.4,
  bottom: 15.4,
} as const;

/** The width of the opening between the jambs, in grid units. */
export const OPENING_UNITS = FRAME.innerRight - FRAME.innerLeft;

/** The panel is a thin edge at the hinge when fully open: it never narrows to nothing. */
const PANEL_EDGE = 0.12;

/** The horizontal scale of the panel at an open fraction (0 shut, 1 open): it narrows toward its hinge, showing the dark opening behind it. */
export function panelScaleAt(open: number): number {
  const f = Math.min(1, Math.max(0, open));
  return 1 - (1 - PANEL_EDGE) * easeInOut(f);
}

/** The share of the door width that shows the dark opening at an open fraction: 0 when shut, at least a half when fully open. */
export function openingShare(open: number): number {
  return (OPENING_UNITS / DOOR_BASE_UNITS) * (1 - panelScaleAt(open));
}
