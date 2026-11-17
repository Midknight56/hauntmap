import type { InvestigationStore } from "../features/investigation/store";
import { fitBounds, panBy, zoomAround } from "../scene/camera";
import { easeNextCamera } from "./cameraEase";
import { getViewportSize } from "./viewport";

// Camera commands shared by the toolbar buttons and the map's keyboard shortcuts. They compute with
// the pure math of src/scene/camera.ts and write the result through `setCamera`.

export const ZOOM_STEP = 1.25;
export const FIT_PADDING = 32;
export const PAN_STEP = 80;
export const PAN_STEP_SHIFT = 320;

export function zoomBy(store: InvestigationStore, factor: number): void {
  const viewport = getViewportSize();
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  easeNextCamera();
  store.actions.setCamera(zoomAround(store.getState().camera, viewport, factor, center));
}

export function fitView(store: InvestigationStore): void {
  const layout = store.getState().layout;
  if (layout === null) return;
  easeNextCamera();
  store.actions.setCamera(fitBounds(layout.bounds, getViewportSize(), FIT_PADDING));
}

export function pan(store: InvestigationStore, dx: number, dy: number): void {
  store.actions.setCamera(panBy(store.getState().camera, dx, dy));
}