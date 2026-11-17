import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, clampZoom, fitBounds, panBy, toScene, toScreen, zoomAround } from "../../src/scene/camera";
import type { Camera } from "../../src/scene/layout/types";

const VP = { width: 1000, height: 600 };

describe("camera math (4.5)", () => {
  it("clamps zoom to [0.25, 4]", () => {
    expect(MIN_ZOOM).toBe(0.25);
    expect(MAX_ZOOM).toBe(4);
    expect(clampZoom(0.01)).toBe(0.25);
    expect(clampZoom(99)).toBe(4);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("maps the camera center to the viewport center and round-trips", () => {
    const cam: Camera = { x: 120, y: -40, zoom: 2 };
    expect(toScreen(cam, VP, { x: 120, y: -40 })).toEqual({ x: 500, y: 300 });
    const p = { x: 33, y: 71 };
    const back = toScene(cam, VP, toScreen(cam, VP, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it("pans by 80 and 320 screen pixels, independent of zoom in screen terms", () => {
    const cam: Camera = { x: 0, y: 0, zoom: 2 };
    expect(panBy(cam, 80, 0)).toEqual({ x: 40, y: 0, zoom: 2 });
    expect(panBy(cam, 0, -320)).toEqual({ x: 0, y: -160, zoom: 2 });
    expect(panBy({ x: 0, y: 0, zoom: 0.5 }, 80, 80)).toEqual({ x: 160, y: 160, zoom: 0.5 });
  });

  it("keeps the scene point under the pointer fixed while zooming", () => {
    const cam: Camera = { x: 10, y: 20, zoom: 1 };
    const pointer = { x: 800, y: 100 };
    const before = toScene(cam, VP, pointer);
    const next = zoomAround(cam, VP, 1.25, pointer);
    expect(next.zoom).toBeCloseTo(1.25, 9);
    const after = toScene(next, VP, pointer);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("does not move when the zoom is already clamped", () => {
    const cam: Camera = { x: 5, y: 6, zoom: 4 };
    expect(zoomAround(cam, VP, 1.25, { x: 10, y: 10 })).toEqual(cam);
    const low: Camera = { x: 5, y: 6, zoom: 0.25 };
    expect(zoomAround(low, VP, 0.8, { x: 10, y: 10 })).toEqual(low);
  });

  it("fits bounds with 32 px padding and centers them", () => {
    const cam = fitBounds({ x: 0, y: 0, w: 936, h: 536 }, VP, 32);
    expect(cam.zoom).toBeCloseTo(1, 9);
    expect(cam.x).toBe(468);
    expect(cam.y).toBe(268);
    const wide = fitBounds({ x: 100, y: 100, w: 3000, h: 100 }, VP, 32);
    expect(wide.zoom).toBeCloseTo((1000 - 64) / 3000, 9);
    expect(wide.x).toBe(1600);
    expect(fitBounds({ x: 0, y: 0, w: 10, h: 10 }, VP, 32).zoom).toBe(4);
    expect(fitBounds({ x: 0, y: 0, w: 1e9, h: 1e9 }, VP, 32).zoom).toBe(0.25);
  });
});