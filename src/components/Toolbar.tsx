import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import type { Preset } from "../contracts/types";
import type { Registry, Slot } from "../features/investigation/registry";
import type { InvestigationStore } from "../features/investigation/store";
import { fitView, zoomBy, ZOOM_STEP } from "./cameraControls";
import { watchRegistry } from "./registryBridge";
import { useViewState } from "./useStore";
import { usePhone } from "./useMediaQuery";

const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];
const SLOTS: Slot[] = ["export", "compare", "live-snapshot"];
/** What each preset shows, in plain words, under the select (blind test fixes of 20 November 2026). */
export const PRESET_HINTS: Record<Preset, string> = {
  "static-value": "static-value: imports that run. Imports of types only are left out.",
  "type-inclusive": "type-inclusive: imports that run and imports of types only.",
  "dynamic-inclusive": "dynamic-inclusive: imports that run and import() calls with a fixed path.",
};

interface Props {
  store: InvestigationStore;
  registry: Registry;
  /** The `Search modules` combobox (task 7); nothing renders there until it exists. */
  search?: React.ReactNode;
  /** The breadcrumb, at the right end of the top bar. */
  trailing?: ReactNode;
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

/** A labelled group (`role="group"` named by its visible label). */
function Group({ label, className, children, hiddenLabel }: { label: string; className?: string; children: ReactNode; hiddenLabel?: boolean }) {
  const id = useId();
  return (
    <div className={className === undefined ? "toolbar-group" : `toolbar-group ${className}`} role="group" aria-labelledby={id}>
      <span id={id} className={hiddenLabel === true ? "toolbar-group-label visually-hidden" : "toolbar-group-label"}>
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The toolbar, in the order of the design: the side bar (`View`, `Snapshots`, `Help`), the top bar (`Find`), the zoom
 * buttons over the map, then `Restart demo`, which the style sheet pins to the bottom of the side bar. On a phone the
 * top bar holds the brand and `More`; View, Snapshots, Help, the preset, the zoom buttons and `Restart demo` sit behind it.
 */
export function Toolbar({ store, registry, search, trailing }: Props) {
  const state = useViewState(store);
  const watcher = watchRegistry(registry);
  useSyncExternalStore(watcher.subscribe, watcher.getVersion, watcher.getVersion);
  const presetId = useId();
  const presetHintId = useId();
  const moreId = useId();
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const moreButton = useRef<HTMLButtonElement>(null);
  const reduced = state.motion === "reduce";
  const phone = usePhone();
  const [moreOpen, setMoreOpen] = useState(false);
  const showControls = !phone || moreOpen;

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const index = VIEWS.indexOf(state.activeView);
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % VIEWS.length,
      ArrowLeft: (index + VIEWS.length - 1) % VIEWS.length,
      ArrowDown: (index + 1) % VIEWS.length,
      ArrowUp: (index + VIEWS.length - 1) % VIEWS.length,
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

  const onMoreKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (!phone || event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    setMoreOpen(false);
    moreButton.current?.focus();
  };

  const hasSlot = SLOTS.some((slot) => registry.getControl(slot) !== null);

  // On a desktop the hint is the first thing of the second row of the top bar, next to the breadcrumb, so that the bar keeps its height.
  const presetHint = (
    <span id={presetHintId} className="preset-hint">
      {PRESET_HINTS[state.preset]}
    </span>
  );

  const presetField = (
    <span className="toolbar-field">
      <label htmlFor={presetId}>Relation preset</label>
      <select id={presetId} aria-label="Relation preset" aria-describedby={presetHintId} value={state.preset} onChange={(e) => store.actions.setPreset(e.target.value as Preset)}>
        {PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}
          </option>
        ))}
      </select>
      {phone ? presetHint : null}
    </span>
  );

  const zoom = (
    <Group label="Zoom" className="toolbar-zoom" hiddenLabel>
      <button type="button" onClick={() => fitView(store)}>
        Fit to view
      </button>
      <button type="button" onClick={() => zoomBy(store, ZOOM_STEP)}>
        Zoom in
      </button>
      <button type="button" onClick={() => zoomBy(store, 1 / ZOOM_STEP)}>
        Zoom out
      </button>
      <button type="button" onClick={() => store.actions.clearSelection()}>
        Clear selection
      </button>
    </Group>
  );

  const restart = (
    <button type="button" className="toolbar-restart" onClick={() => store.actions.restart()}>
      Restart demo
    </button>
  );

  return (
    <div className="toolbar" role="group" aria-label="Toolbar" data-view={state.activeView}>
      <div className="toolbar-side" onKeyDown={onMoreKey}>
        <div className="brand-row">
          <span className="brand">HauntMap</span>
          {phone ? (
            <button ref={moreButton} type="button" className="more-button" aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen(!moreOpen)}>
              More
            </button>
          ) : null}
        </div>
        {showControls ? (
          <div id={moreId} className="toolbar-more">
            <Group label="View">
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
            </Group>
            {hasSlot ? (
              <Group label="Snapshots">
                {SLOTS.map((slot) => (
                  <SlotControl key={slot} store={store} registry={registry} slot={slot} />
                ))}
              </Group>
            ) : null}
            <Group label="Help">
              <button type="button" aria-expanded={state.legendOpen} onClick={() => store.actions.setLegendOpen(!state.legendOpen)}>
                Legend
              </button>
              {state.steps !== null ? (
                <button type="button" id="show-steps" aria-expanded={!state.steps.dismissed} onClick={() => store.actions.openSteps()}>
                  Show steps
                </button>
              ) : null}
              <button type="button" aria-label="Motion" aria-pressed={reduced} data-state={reduced ? "Reduce" : "System"} onClick={() => store.actions.setMotion(reduced ? "system" : "reduce")}>
                Motion
              </button>
            </Group>
            {phone ? presetField : null}
            {phone ? zoom : null}
            {phone ? restart : null}
          </div>
        ) : null}
      </div>
      <div className="toolbar-top">
        <Group label="Find" className="toolbar-find" hiddenLabel={phone}>
          <span className="toolbar-search" data-mount="search">
            {search}
          </span>
          {phone ? null : presetField}
          <button type="button" className="primary toolbar-main" onClick={() => store.actions.openLoops()}>
            Dependency loops
          </button>
        </Group>
        {phone ? null : presetHint}
        {trailing}
      </div>
      {phone ? null : zoom}
      {phone ? null : restart}
    </div>
  );
}
