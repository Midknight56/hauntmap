import { useSyncExternalStore } from "react";
import { LocalFolderDialog } from "./LocalFolderDialog";
import type { IntakeService } from "./types";
import "./intake.css";

/**
 * Renders the open dialog of the intake service. `App` renders it next to the status region, outside the landing and
 * investigation screens, so that a dialog stays mounted when the screen changes (1.1).
 */
export function IntakeHost({ service }: { service: IntakeService }) {
  const state = useSyncExternalStore(service.subscribe, service.getState, service.getState);
  const dialog = state.dialog;
  if (dialog === null) return null;
  return (
    <div className="intake-backdrop">
      {dialog.kind === "local" ? <LocalFolderDialog service={service} purpose={dialog.purpose} /> : null}
    </div>
  );
}
