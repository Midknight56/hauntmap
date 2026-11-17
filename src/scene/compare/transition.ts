import { Container, Graphics } from "pixi.js";
import type { Animator } from "../animation";
import { stepMark } from "../doors";
import type { LayoutResult, Point, Rect } from "../layout/types";
import { witnessLegs } from "../walk";
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
  const legs = witnessLegs(opts.layout, opts.route);
  if (legs.length === 0) return;
  const fading = new Container();
  fading.label = "closing-corridor";
  const line = new Graphics();
  for (const leg of legs) {
    const first = leg.points[0] as Point;
    line.moveTo(first.x, first.y);
    for (const p of leg.points.slice(1)) line.lineTo(p.x, p.y);
  }
  line.stroke({ width: 4, color: TOKENS.corridor, join: "round", cap: "round" });
  fading.addChild(line);
  const doors = new Map(opts.layout.doors.map((d) => [d.relationId, d] as const));
  opts.route.relationIds.forEach((id, i) => {
    const door = doors.get(id);
    const start = legs[i]?.points[0];
    if (door !== undefined) fading.addChild(stepMark(i + 1, center(door).x, center(door).y - 14));
    else if (start !== undefined) fading.addChild(stepMark(i + 1, start.x, start.y));
  });  opts.parent.addChild(fading);
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