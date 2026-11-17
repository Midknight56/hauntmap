import type { Viewport } from "../scene/camera";

// The size of the map area in CSS pixels. The map view writes it when it measures its container;
// the toolbar's zoom and fit buttons read it. Before a measurement it is a plausible default.

let size: Viewport = { width: 1000, height: 600 };

export function getViewportSize(): Viewport {
  return size;
}

export function setViewportSize(next: Viewport): void {
  if (next.width > 0 && next.height > 0) size = { width: next.width, height: next.height };
}