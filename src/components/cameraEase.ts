// Zoom and Fit to view ease out in 300 ms (README of the design, "Motion"); a pan, a drag and the first view do not. The commands that
// ease say so here just before they write the camera; the map reads it once when the new camera arrives. A mark older than
// 150 ms is ignored, so that a command that changed nothing never makes a later pan ease.

let markedAt = Number.NEGATIVE_INFINITY;

export function easeNextCamera(now: number = performance.now()): void {
  markedAt = now;
}

/** True once for a camera that a zoom or a fit has just written. */
export function takeCameraEase(now: number = performance.now()): boolean {
  const eased = now - markedAt <= 150;
  markedAt = Number.NEGATIVE_INFINITY;
  return eased;
}