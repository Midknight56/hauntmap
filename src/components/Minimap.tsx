import type { MouseEvent } from "react";
import type { InvestigationStore } from "../features/investigation/store";
import { useViewState } from "./useStore";
import { getViewportSize } from "./viewport";

export const MINIMAP_W = 160;
export const MINIMAP_H = 100;

/** A 160 x 100 overview of the wing regions with the viewport rectangle. Decorative: every move it offers is also in search and the Evidence view. */
export function Minimap({ store }: { store: InvestigationStore }) {
  const { layout, camera } = useViewState(store);
  if (layout === null || layout.bounds.w <= 0 || layout.bounds.h <= 0) return null;
  const { bounds } = layout;
  const scale = Math.min(MINIMAP_W / bounds.w, MINIMAP_H / bounds.h);
  const offsetX = (MINIMAP_W - bounds.w * scale) / 2;
  const offsetY = (MINIMAP_H - bounds.h * scale) / 2;
  const toBox = (x: number, y: number): { x: number; y: number } => ({ x: offsetX + (x - bounds.x) * scale, y: offsetY + (y - bounds.y) * scale });
  const viewport = getViewportSize();
  const half = { w: viewport.width / 2 / camera.zoom, h: viewport.height / 2 / camera.zoom };
  const corner = toBox(camera.x - half.w, camera.y - half.h);

  const onClick = (event: MouseEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left - offsetX) / scale + bounds.x;
    const y = (event.clientY - box.top - offsetY) / scale + bounds.y;
    store.actions.setCamera({ x, y, zoom: camera.zoom });
  };

  return (
    <svg className="minimap" width={MINIMAP_W} height={MINIMAP_H} viewBox={`0 0 ${MINIMAP_W} ${MINIMAP_H}`} aria-hidden="true" onClick={onClick}>
      {layout.wings.map((w) => {
        const p = toBox(w.x, w.y);
        return <rect key={w.wing} data-wing={w.wing} x={p.x} y={p.y} width={w.w * scale} height={w.h * scale} className="minimap-wing" />;
      })}
      <rect data-viewport="" x={corner.x} y={corner.y} width={half.w * 2 * scale} height={half.h * 2 * scale} className="minimap-viewport" />
    </svg>
  );
}