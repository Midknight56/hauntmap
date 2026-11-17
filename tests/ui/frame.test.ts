import { describe, expect, it } from "vitest";
import { MIN_ZOOM, toScreen } from "../../src/scene/camera";
import { frameAround, frameRects } from "../../src/scene/frame";
import type { Rect } from "../../src/scene/layout/types";

// Design pass 2, items 1, 4 and 7: a camera that frames what a view is about inside the part of the map the zoom stack and the
// minimap leave free. Pure; the browser specs check the same on the real map.

const VP = { width: 1232, height: 792 };

function screenRect(camera: { x: number; y: number; zoom: number }, rect: Rect): Rect {
  const a = toScreen(camera, VP, { x: rect.x, y: rect.y });
  return { x: a.x, y: a.y, w: rect.w * camera.zoom, h: rect.h * camera.zoom };
}

function hits(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const ZOOM_STACK: Rect = { x: 16, y: 792 - 16 - 194, w: 140, h: 194 };
const MINIMAP: Rect = { x: 1232 - 16 - 180, y: 792 - 16 - 110, w: 180, h: 110 };

describe("frameAround", () => {
  it("keeps the given point at the center and zooms out until every rectangle is inside and clear of the obstacles", () => {
    const content: Rect[] = [
      { x: -1000, y: 400, w: 96, h: 64 },
      { x: 100, y: -50, w: 96, h: 64 },
      { x: -10, y: -10, w: 20, h: 20 },
    ];
    const camera = frameAround({ x: 0, y: 0 }, content, VP, { padding: 16, maxZoom: 1, obstacles: [ZOOM_STACK, MINIMAP] });
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(camera.zoom).toBeLessThan(1);
    for (const r of content) {
      const s = screenRect(camera, r);
      expect(hits(s, ZOOM_STACK)).toBe(false);
      expect(hits(s, MINIMAP)).toBe(false);
      expect(s.x).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(s.y + s.h).toBeLessThanOrEqual(VP.height - 16 + 1e-6);
    }
    // Not more zoomed out than needed: 5 percent closer breaks a rule.
    const closer = { ...camera, zoom: camera.zoom * 1.05 };
    const broken = content.some((r) => {
      const s = screenRect(closer, r);
      return hits(s, ZOOM_STACK) || hits(s, MINIMAP) || s.x < 16 || s.y < 16 || s.x + s.w > VP.width - 16 || s.y + s.h > VP.height - 16;
    });
    expect(broken).toBe(true);
  });

  it("stays at maxZoom when everything fits there", () => {
    expect(frameAround({ x: 5, y: 5 }, [{ x: 0, y: 0, w: 10, h: 10 }], VP, { padding: 16, maxZoom: 1 })).toEqual({ x: 5, y: 5, zoom: 1 });
  });
});

describe("frameRects", () => {
  it("fits one rectangle with the padding and centers it", () => {
    const camera = frameRects([{ x: 100, y: 200, w: 100, h: 100 }], { width: 400, height: 300 }, { padding: 20 });
    expect(camera.zoom).toBeCloseTo(2.6, 9);
    expect(camera.x).toBe(150);
    expect(camera.y).toBe(250);
  });

  it("never zooms past maxZoom and never under minZoom", () => {
    const small = frameRects([{ x: 0, y: 0, w: 10, h: 10 }], VP, { padding: 16, maxZoom: 1 });
    expect(small.zoom).toBe(1);
    const huge = frameRects([{ x: 0, y: 0, w: 20000, h: 100 }], VP, { padding: 16, minZoom: 0.1 });
    expect(huge.zoom).toBe(0.1);
    expect(frameRects([{ x: 0, y: 0, w: 20000, h: 100 }], VP, { padding: 16 }).zoom).toBe(MIN_ZOOM);
  });

  it("ignores an obstacle that no content reaches", () => {
    // Three wings like the loop of the manor: wide and short, nothing under the zoom stack.
    const wings: Rect[] = [
      { x: 0, y: 13, w: 312, h: 304 },
      { x: 408, y: 89, w: 444, h: 464 },
      { x: 948, y: 0, w: 520, h: 224 },
    ];
    const plain = frameRects(wings, VP, { padding: 16 });
    const clear = frameRects(wings, VP, { padding: 16, obstacles: [ZOOM_STACK, MINIMAP] });
    expect(clear).toEqual(plain);
    expect(plain.zoom).toBeCloseTo((1232 - 32) / 1468, 6);
  });

  it("moves and shrinks the frame so that no content lies under an obstacle", () => {
    // A tall block at the left edge would sit under the zoom stack when centered.
    const content: Rect[] = [
      { x: 0, y: 0, w: 300, h: 700 },
      { x: 1100, y: 0, w: 300, h: 100 },
    ];
    const plain = frameRects(content, VP, { padding: 16 });
    expect(content.some((r) => hits(screenRect(plain, r), ZOOM_STACK))).toBe(true);
    const camera = frameRects(content, VP, { padding: 16, obstacles: [ZOOM_STACK, MINIMAP] });
    for (const r of content) {
      const s = screenRect(camera, r);
      expect(hits(s, ZOOM_STACK), "zoom stack").toBe(false);
      expect(hits(s, MINIMAP), "minimap").toBe(false);
      expect(s.x).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(s.y).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(s.x + s.w).toBeLessThanOrEqual(VP.width - 16 + 1e-6);
      expect(s.y + s.h).toBeLessThanOrEqual(VP.height - 16 + 1e-6);
    }
    expect(camera.zoom).toBeLessThan(plain.zoom);
  });

  it("keeps thin content (a corridor) inside the frame and clear of the obstacles on a grid of cases", () => {
    for (const w of [200, 900, 1400]) {
      for (const h of [80, 400, 760]) {
        const content: Rect[] = [
          { x: 0, y: h, w: 96, h: 64 },
          { x: w, y: 0, w: 96, h: 64 },
          { x: 96, y: 30, w: w - 96, h: 2 },
        ];
        const camera = frameRects(content, VP, { padding: 16, maxZoom: 1, obstacles: [ZOOM_STACK, MINIMAP] });
        for (const r of content) {
          const s = screenRect(camera, r);
          expect(hits(s, ZOOM_STACK), `${w}x${h}`).toBe(false);
          expect(hits(s, MINIMAP), `${w}x${h}`).toBe(false);
          expect(s.x).toBeGreaterThanOrEqual(16 - 1e-6);
          expect(s.x + s.w).toBeLessThanOrEqual(VP.width - 16 + 1e-6);
          expect(s.y).toBeGreaterThanOrEqual(16 - 1e-6);
          expect(s.y + s.h).toBeLessThanOrEqual(VP.height - 16 + 1e-6);
        }
      }
    }
  });
});
