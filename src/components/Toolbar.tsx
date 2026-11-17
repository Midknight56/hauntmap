import { useId, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import type { Preset } from "../contracts/types";
import type { Registry, Slot } from "../features/investigation/registry";
import type { InvestigationStore } from "../features/investigation/store";
import { fitView, zoomBy, ZOOM_STEP } from "./cameraControls";
import { watchRegistry } from "./registryBridge";
import { useViewState } from "./useStore";

const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];
const SLOTS: Slot[] = ["export", "compare", "live-snapshot"];

interface Props {
  store: InvestigationStore;
  registry: Registry;
  /** The `Search modules` combobox (task 7); nothing renders there until it exists. */
  search?: React.ReactNode;
}

/** A registered control, or nothing when the slot is empty. */
function SlotControl({ store, registry, slot }: { store: InvestigationStore; registry: Registry; slot: Slot }) {
  const Control = registry.getControl(slot);
  if (Control === null) return null;
  return (
    <span className="toolbar-slot" data-slot={slot}>
      <Control store={store} />
    </span>
  );
}

export const VIEWS = ["map", "evidence"] as const;

export function Toolbar({ store, registry, search }: Props) {
  const state = useViewState(store);
  const watcher = watchRegistry(registry);
  useSyncExternalStore(watcher.subscribe, watcher.getVersion, watcher.getVersion);
  const presetId = useId();
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const reduced = state.motion === "reduce";

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const index = VIEWS.indexOf(state.activeView);
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % VIEWS.length,
      ArrowLeft: (index + VIEWS.length - 1) % VIEWS.length,
      Home: 0,
      End: VIEWS.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const view = VIEWS[next] as (typeof VIEWS)[number];
    store.actions.setView(view);
    tabs.current[view]?.focus();
  };

  return (
    <div className="toolbar" role="group" aria-label="Toolbar">
      <button type="button" onClick={() => store.actions.restart()}>
        Restart demo
      </button>
      <span className="toolbar-search" data-mount="search">
        {search}
      </span>
      <span className="toolbar-field">
        <label htmlFor={presetId}>Relation preset</label>
        <select id={presetId} aria-label="Relation preset" value={state.preset} onChange={(e) => store.actions.setPreset(e.target.value as Preset)}>
          {PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </span>
      <button type="button" onClick={() => store.actions.openLoops()}>
        Dependency loops
      </button>
      <button type="button" aria-expanded={state.legendOpen} onClick={() => store.actions.setLegendOpen(!state.legendOpen)}>
        Legend
      </button>
      <button type="button" aria-label="Motion" aria-pressed={reduced} onClick={() => store.actions.setMotion(reduced ? "system" : "reduce")}>
        Motion: {reduced ? "Reduce" : "System"}
      </button>
      <button type="button" onClick={() => zoomBy(store, ZOOM_STEP)}>
        Zoom in
      </button>
      <button type="button" onClick={() => zoomBy(store, 1 / ZOOM_STEP)}>
        Zoom out
      </button>
      <button type="button" onClick={() => fitView(store)}>
        Fit to view
      </button>
      <button type="button" onClick={() => store.actions.clearSelection()}>
        Clear selection
      </button>
      <div role="tablist" aria-label="View" className="toolbar-tabs">
        {VIEWS.map((view) => (
          <button
            key={view}
            ref={(el) => {
              tabs.current[view] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${view}`}
            aria-selected={state.activeView === view}
            aria-controls="view-panel"
            tabIndex={state.activeView === view ? 0 : -1}
            onClick={() => store.actions.setView(view)}
            onKeyDown={onTabKey}
          >
            {view === "map" ? "Map" : "Evidence"}
          </button>
        ))}
      </div>
      {state.steps !== null ? (
        <button type="button" onClick={() => store.actions.openSteps()}>
          Show steps
        </button>
      ) : null}
      {SLOTS.map((slot) => (
        <SlotControl key={slot} store={store} registry={registry} slot={slot} />
      ))}
    </div>
  );
}