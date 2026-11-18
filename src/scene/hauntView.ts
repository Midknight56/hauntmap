import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { HauntReading } from "./haunt";
import { TOKENS } from "./styles";
import type { TextureCache } from "./textures";

// The nodes that show a haunt: one sprite for each critter slot (the cached silhouette of a bat or a cat) and one small circle for each
// puff of dust, all made once when the loop is drawn and reused. `apply` moves, scales, fades and shows or hides them from a reading of the
// haunt. Nothing is created per frame, no texture is made here, and nothing here reads the graph, the selection or the steps.

export interface HauntView {
  /** Show the reading: the critters and the puffs that are on screen, hidden when they would cover a name. */
  apply(reading: HauntReading): void;
  /** Hide everything (the haunt has ended). */
  clear(): void;
}

export function createHauntView(parent: Container, textures: TextureCache<Texture>, critterSlots: number, puffSlots: number): HauntView {
  const layer = new Container();
  layer.label = "haunt";
  const sprites: Sprite[] = [];
  const bat = textures.get("critter", "bat");
  const cat = textures.get("critter", "cat");
  for (let i = 0; i < critterSlots; i++) {
    const s = new Sprite(bat);
    s.anchor.set(0.5);
    s.visible = false;
    layer.addChild(s);
    sprites.push(s);
  }
  const puffs: Graphics[] = [];
  for (let i = 0; i < puffSlots; i++) {
    const g = new Graphics();
    g.circle(0, 0, 1).fill({ color: TOKENS.light, alpha: 0.9 });
    g.visible = false;
    layer.addChild(g);
    puffs.push(g);
  }
  parent.addChild(layer);
  let shown = false;
  return {
    apply(reading) {
      shown = true;
      sprites.forEach((s, i) => {
        const c = reading.critters[i];
        if (c === undefined || !c.visible || c.alpha <= 0 || s.destroyed) {
          s.visible = false;
          return;
        }
        const texture = c.kind === "bat" ? bat : cat;
        if (s.texture !== texture) s.texture = texture;
        s.visible = true;
        s.alpha = c.alpha;
        s.position.set(c.x, c.y);
        // The box is the size on the screen (14 to 20 px at the zoom of the frame); a flip turns the silhouette to face its way.
        s.scale.set((c.flip * c.box.w) / Math.max(texture.width, 1), (c.box.h * c.flap) / Math.max(texture.height, 1));
      });
      puffs.forEach((g, i) => {
        const p = reading.puffs[i];
        if (p === undefined || !p.visible || p.alpha <= 0 || g.destroyed) {
          g.visible = false;
          return;
        }
        g.visible = true;
        g.alpha = p.alpha;
        g.position.set(p.x, p.y);
        g.scale.set(p.r);
      });
    },
    clear() {
      if (!shown) return;
      shown = false;
      for (const s of sprites) if (!s.destroyed) s.visible = false;
      for (const g of puffs) if (!g.destroyed) g.visible = false;
    },
  };
}
