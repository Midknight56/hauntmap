import { Graphics, Sprite, Text } from "pixi.js";
import { FONT } from "./elements";
import type { DrawContext } from "./rooms";
import type { LayoutResult, Point } from "./layout/types";
import { TOKENS, type State } from "./styles";

function arrowColor(state: State): string {
  return state === "witness" ? TOKENS.corridor : state === "trace" ? TOKENS.light : state === "selected" ? TOKENS.focus : TOKENS.door;
}

/** Doors with arrows, sealed doorways with `?`, and the step numbers of a witness or trace route. */
export function drawDoors(ctx: DrawContext, layout: LayoutResult): void {
  for (const door of layout.doors) {
    const info = ctx.states.doors.get(door.relationId) ?? { state: "default" as State, step: null };
    const layer = info.state === "default" ? ctx.layers.rooms : ctx.layers.selected;
    const color = arrowColor(info.state);
    const width = info.state === "default" ? 1.5 : 3;
    const line = new Graphics();
    const [from, to] = [door.arrow[0], door.arrow[door.arrow.length - 1]] as [Point, Point];
    line.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width, color });
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = 7;
    line
      .poly([
        to.x,
        to.y,
        to.x - head * Math.cos(angle - 0.45),
        to.y - head * Math.sin(angle - 0.45),
        to.x - head * Math.cos(angle + 0.45),
        to.y - head * Math.sin(angle + 0.45),
      ])
      .fill(color);
    layer.addChild(line);
    const sprite = new Sprite(ctx.textures.get("door", info.state));
    sprite.position.set(door.x, door.y);
    sprite.width = door.w;
    sprite.height = door.h;
    layer.addChild(sprite);
    if (info.step !== null) layer.addChild(stepMark(info.step, door.x + door.w / 2, door.y + door.h / 2 - 14));
  }
  for (const sealed of layout.sealed) {
    const state = ctx.states.sealed.get(sealed.relationId) ?? "default";
    const sprite = new Sprite(ctx.textures.get("sealed", state));
    sprite.position.set(sealed.x, sealed.y);
    sprite.width = sealed.w;
    sprite.height = sealed.h;
    (state === "default" ? ctx.layers.rooms : ctx.layers.selected).addChild(sprite);
  }
}

/** A step number: the number itself is the companion to the route color. */
export function stepMark(step: number, x: number, y: number): Text {
  const text = new Text({ text: String(step), style: { fontFamily: FONT, fontSize: 13, fill: TOKENS.ink, fontWeight: "700", stroke: { color: TOKENS.panel, width: 4 } } });
  text.anchor.set(0.5);
  text.position.set(x, y);
  return text;
}