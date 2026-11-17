import type { InvestigationStore } from "../features/investigation/store";
import { useViewState } from "./useStore";

/** `<sourceLabel> › <wing>`: the wing under the camera center. It depends on the camera and the layout, never on the selection. */
export function Breadcrumb({ store }: { store: InvestigationStore }) {
  const { investigation, layout, camera } = useViewState(store);
  if (investigation === null) return null;
  const wing = layout?.wings.find((w) => camera.x >= w.x && camera.x <= w.x + w.w && camera.y >= w.y && camera.y <= w.y + w.h);
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      {wing === undefined ? investigation.sourceLabel : `${investigation.sourceLabel} \u203A ${wing.wing}`}
    </nav>
  );
}