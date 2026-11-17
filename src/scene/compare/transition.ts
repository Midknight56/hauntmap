import { Container, Graphics } from "pixi.js";
import type { Animator } from "../animation";
import { stepMark } from "../doors";
import type { LayoutResult, Point, Rect } from "../layout/types";
import { TOKENS } from "../styles";
import { CLOSING_MS } from "./index";

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * The closing corridor (6.3): the witness corridor and its step numbers, still drawn, fade from alpha 1 to 0
 * over 600 ms through the scene's animator, then are removed. Alpha only: no room moves. Under reduced motion
 * nothing is drawn, so the change is complete in the same frame.
 */
export function closeCorridor(opts: {
  parent: Container;
  layout: LayoutResult;
  route: { modules: readonly string[]; relationIds: readonly string[] };
  animator: Animator;
  reduced: boolean;
}): void {
  if (opts.reduced) return;
  const rooms = new Map(opts.layout.rooms.map((r) => [r.id, r] as const));
  const points: Point[] = [];
  for (const id of opts.route.modules) {
    const room = rooms.get(id);
    if (room !== undefined) points.push(center(room));
  }
  if (points.length < 2) return;
  points.push(points[0] as Point);
  const fading = new Container();
  fading.label = "closing-corridor";
  const line = new Graphics();
  line.moveTo((points[0] as Point).x, (points[0] as Point).y);
  for (const p of points.slice(1)) line.lineTo(p.x, p.y);
  line.stroke({ width: 4, color: TOKENS.corridor });
  fading.addChild(line);
  const doors = new Map(opts.layout.doors.map((d) => [d.relationId, d] as const));
  opts.route.relationIds.forEach((id, i) => {
    const door = doors.get(id);
    const a = points[i];
    const b = points[i + 1];
    const at = door !== undefined ? center(door) : a !== undefined && b !== undefined ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    if (at !== null) fading.addChild(stepMark(i + 1, at.x, door !== undefined ? at.y - 14 : at.y));
  });
  opts.parent.addChild(fading);
  opts.animator.tween({
    duration: CLOSING_MS,
    update: (p) => {
      if (!fading.destroyed) fading.alpha = 1 - p;
    },
    onDone: () => {
      if (!fading.destroyed) fading.destroy({ children: true });
    },
  });
}