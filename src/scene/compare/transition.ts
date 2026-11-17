import { Container, Graphics } from "pixi.js";
import type { Animator } from "../animation";
import { stepMark, STEP_FONT } from "../doors";
import { labelScale } from "../labels";
import type { LayoutResult, Point, Rect } from "../layout/types";
import { witnessLegs } from "../walk";
import { TOKENS } from "../styles";
import { playFarewell } from "../effects";
import { makeGhost } from "../corridors";

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * The closing corridor (6.3): the witness corridor and its step numbers, still drawn, fade from alpha 1 to 0
 * over 600 ms through the scene's animator; the ghost that walked it stands where it was and fades last, over 400 ms.
 * Then both are removed. Alpha only: no room moves. Under reduced motion nothing is drawn, so the change is complete in
 * the same frame.
 */
export function closeCorridor(opts: {
  parent: Container;
  layout: LayoutResult;
  route: { modules: readonly string[]; relationIds: readonly string[] };
  animator: Animator;
  reduced: boolean;
  /** The camera zoom when the corridor starts to fade; its step numbers keep 11 CSS pixels at that zoom for the 600 ms. */
  zoom: number;
  /** Where the ghost stands (scene units) and its scale; it fades after the corridor. */
  ghost?: { at: Point; scale: number } | null;
  /** Called with the alpha of the corridor and of the ghost while they fade, and with null when they are gone. */
  onFade?(state: { corridor: number; ghost: number } | null): void;
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
    const at = door !== undefined ? { x: center(door).x, y: center(door).y - 14 } : start;
    if (at === undefined) return;
    const mark = stepMark(i + 1, at.x, at.y);
    mark.scale.set(labelScale(opts.zoom, STEP_FONT));
    fading.addChild(mark);
  });
  opts.parent.addChild(fading);
  let ghost: Container | null = null;
  if (opts.ghost !== undefined && opts.ghost !== null) {
    ghost = makeGhost();
    ghost.position.set(opts.ghost.at.x, opts.ghost.at.y);
    ghost.scale.set(opts.ghost.scale);
    opts.parent.addChild(ghost);
  }
  const report = (): void => opts.onFade?.({ corridor: fading.destroyed ? 0 : fading.alpha, ghost: ghost === null || ghost.destroyed ? 0 : ghost.alpha });
  // The two fade in turn: the corridor over 600 ms, then the ghost over 400 ms. `report` follows both.
  const levels = { corridor: 1, ghost: 1 };
  const apply = (): void => {
    if (!fading.destroyed) fading.alpha = levels.corridor;
    if (ghost !== null && !ghost.destroyed) ghost.alpha = levels.ghost;
    report();
  };
  const watch = (key: "corridor" | "ghost"): { alpha: number } => ({
    get alpha() {
      return levels[key];
    },
    set alpha(value: number) {
      levels[key] = value;
      apply();
    },
  });
  playFarewell(opts.animator, { corridor: watch("corridor"), ghost: ghost === null ? null : watch("ghost") });  // The last frame: both are gone. Removed on the next tick of the animator so that a reader sees the end state first.
  opts.animator.tween({
    duration: 1100,
    update: () => undefined,
    onDone: () => {
      if (!fading.destroyed) fading.destroy({ children: true });
      if (ghost !== null && !ghost.destroyed) ghost.destroy({ children: true });
      opts.onFade?.(null);
    },
  });
}