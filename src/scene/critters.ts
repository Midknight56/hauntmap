import { Container, Graphics } from "pixi.js";
import { CRITTER_PX } from "./haunt";
import { TOKENS } from "./styles";

// The silhouettes of the haunt: a bat and a black cat. Each is drawn once into a cached texture (`textures.get("critter", kind)`), never
// again per frame. Dark body with a thin light rim, so that they read on the dark floor and on the lit rooms. Drawing only.

export type CritterShape = "bat" | "cat";

/** The frame of each silhouette is its size on the screen (`CRITTER_PX`, with the rim); the drawing below is made in a small design grid and scaled into it. */
const CRITTER_UNITS = CRITTER_PX;

/** The light rim around the dark body, in screen pixels (1.5 to 2). */
const RIM_PX = 1.75;
/** The scale of the design grid to the screen, and the margin of the rim inside the frame, for each shape. */
const FIT = { bat: { k: 24 / 18, x: 2, y: 2 }, cat: { k: 1.28, x: 1.8, y: 2 } } as const;

const BODY = "#0b0710";
const EYE = "#f0dc86";

/** The half of the bat from the top of its head to the tip of its tail, right side; the left side is its mirror. */
const BAT_RIGHT: readonly (readonly [number, number])[] = [
  [9, 3.4],
  [10.3, 0.8],
  [11, 3.2],
  [12.2, 2.8],
  [14.8, 1.2],
  [17.4, 2.6],
  [15.1, 4.7],
  [14.9, 7.4],
  [12.7, 5.6],
  [11.4, 8.4],
  [10, 6.4],
  [9, 9.8],
];

function batPoints(): number[] {
  const out: number[] = [];
  for (const [x, y] of BAT_RIGHT) out.push(x, y);
  for (let i = BAT_RIGHT.length - 2; i >= 1; i--) {
    const [x, y] = BAT_RIGHT[i] as readonly [number, number];
    out.push(18 - x, y);
  }
  return out;
}

/** Draw one pass of a shape: the wide light pass first (the rim), then the dark pass on top of it. */
function twice(node: Container, k: number, shape: (g: Graphics, grow: number, color: string) => void): void {
  const rim = new Graphics();
  shape(rim, (2 * RIM_PX) / k, TOKENS.light);
  node.addChild(rim);
  const body = new Graphics();
  shape(body, 0, BODY);
  node.addChild(body);
}

/** The bat: head and ears, two wings with three points along the lower edge. */
function bat(node: Container): void {
  const points = batPoints();
  twice(node, FIT.bat.k, (g, grow, color) => {
    g.poly(points).fill(color);
    if (grow > 0) g.poly(points).stroke({ width: grow, color, join: "round" });
  });
}

/** The cat, seen from the side and facing right: body, head with two pointed ears, a raised tail, four legs in a run, one pale eye. */
function cat(node: Container): void {
  twice(node, FIT.cat.k, (g, grow, color) => {
    g.ellipse(9.5, 7.4, 6.2 + grow / 2, 2.7 + grow / 2).fill(color);
    // The arched back: a hump over the middle of the body.
    g.ellipse(8.4, 5.4, 4.3 + grow / 2, 3 + grow / 2).fill(color);
    g.circle(16, 5.2, 2.7 + grow / 2).fill(color);
    for (const ear of [
      [14.3, 3.6, 14.7, 0.8, 16.3, 2.7],
      [16, 2.6, 17.8, 0.8, 18.2, 3.8],
    ]) {
      g.poly(ear).fill(color);
      if (grow > 0) g.poly(ear).stroke({ width: grow, color, join: "round" });
    }
    g.moveTo(3.8, 6.4).quadraticCurveTo(0.8, 6, 1.2, 2.2).stroke({ width: 1.7 + grow, color, cap: "round", join: "round" });
    for (const [x1, y1, x2, y2] of [
      [6, 8.6, 5, 11],
      [8, 9.4, 8.4, 11.2],
      [11.4, 9.4, 12.8, 11],
      [13.6, 8.4, 15.4, 10.6],
    ] as const) {
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 1.7 + grow, color, cap: "round", join: "round" });
    }
  });
  const eye = new Graphics();
  eye.circle(17.3, 4.9, 0.75).fill(EYE);
  node.addChild(eye);
}

/** The display object of one silhouette, in its own units, for the texture cache. */
export function drawCritter(kind: string): { node: Container; w: number; h: number } {
  const shape: CritterShape = kind === "cat" ? "cat" : "bat";
  const node = new Container();
  if (shape === "cat") cat(node);
  else bat(node);
  node.scale.set(FIT[shape].k);
  node.position.set(FIT[shape].x, FIT[shape].y);
  return { node, ...CRITTER_UNITS[shape] };
}
