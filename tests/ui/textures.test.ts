import { describe, expect, it } from "vitest";
import { createTextureCache, textureKey, type TextureLike } from "../../src/scene/textures";

function fakeRenderer() {
  const created: { key: string; texture: TextureLike & { destroyed: boolean } }[] = [];
  return {
    created,
    renderer: {
      create(kind: string, state: string) {
        const texture = { destroyed: false, destroy() { texture.destroyed = true; } };
        created.push({ key: `${kind}:${state}`, texture });
        return texture;
      },
    },
  };
}

describe("texture cache (9.3)", () => {
  it("keys textures as <kind>:<state>", () => {
    expect(textureKey("room", "selected")).toBe("room:selected");
  });

  it("returns the same object for the same key and creates it once", () => {
    const { renderer, created } = fakeRenderer();
    const cache = createTextureCache(renderer);
    const a = cache.get("room", "default");
    expect(cache.get("room", "default")).toBe(a);
    expect(cache.get("room", "selected")).not.toBe(a);
    expect(created.map((c) => c.key)).toEqual(["room:default", "room:selected"]);
    expect(cache.size).toBe(2);
  });

  it("rebuild destroys every texture and recreates the same keys", () => {
    const { renderer, created } = fakeRenderer();
    const cache = createTextureCache(renderer);
    const old = cache.get("door", "default");
    cache.get("sealed", "default");
    cache.rebuild();
    expect(created).toHaveLength(4);
    expect((old as { destroyed: boolean }).destroyed).toBe(true);
    expect(cache.size).toBe(2);
    expect(cache.get("door", "default")).not.toBe(old);
    expect(created).toHaveLength(4);
  });

  it("destroy empties the cache and destroys every texture", () => {
    const { renderer, created } = fakeRenderer();
    const cache = createTextureCache(renderer);
    cache.get("wing", "default");
    cache.destroy();
    expect(cache.size).toBe(0);
    expect(created[0]?.texture.destroyed).toBe(true);
  });

  it("holds at most 24 entries for the manor state set (one selection, one witness)", () => {
    const { renderer } = fakeRenderer();
    const cache = createTextureCache(renderer);
    const kinds = ["room", "wing", "door", "sealed", "corridor", "grouped"] as const;
    const states = ["default", "selected", "subdued", "witness"] as const;
    for (let load = 0; load < 3; load++) for (const k of kinds) for (const s of states) cache.get(k, s);
    expect(cache.size).toBeLessThanOrEqual(24);
  });
});