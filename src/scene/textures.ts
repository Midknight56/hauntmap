// One texture per (element kind, state), created once and reused. The renderer is structural so that
// the cache can be tested with a fake; the adapter supplies the PixiJS-backed one.

export interface TextureLike {
  destroy(): void;
}

export interface TextureRenderer<T extends TextureLike> {
  create(kind: string, state: string): T;
}

export interface TextureCache<T extends TextureLike> {
  get(kind: string, state: string): T;
  /** Destroy every texture and create the same keys again (after a context restore). */
  rebuild(): void;
  destroy(): void;
  readonly size: number;
}

export function textureKey(kind: string, state: string): string {
  return `${kind}:${state}`;
}

export function createTextureCache<T extends TextureLike>(renderer: TextureRenderer<T>): TextureCache<T> {
  const entries = new Map<string, { kind: string; state: string; texture: T }>();
  return {
    get(kind, state) {
      const key = textureKey(kind, state);
      const found = entries.get(key);
      if (found !== undefined) return found.texture;
      const texture = renderer.create(kind, state);
      entries.set(key, { kind, state, texture });
      return texture;
    },
    rebuild() {
      const old = [...entries.values()];
      entries.clear();
      for (const entry of old) {
        try {
          entry.texture.destroy();
        } catch {
          // The context that owned the texture is gone; there is nothing left to release.
        }
        entries.set(textureKey(entry.kind, entry.state), { ...entry, texture: renderer.create(entry.kind, entry.state) });
      }
    },
    destroy() {
      for (const entry of entries.values()) {
        try {
          entry.texture.destroy();
        } catch {
          // Already released with the context.
        }
      }
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}