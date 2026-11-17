# UI integration note

For the writers of `snapshot-comparison` (`src/features/compare`, `src/scene/compare`) and `kiro-integration` (`src/features/liveSnapshot`). It describes what `investigation-ui` provides on `main` and what it expects back. Nothing is registered in this build: no `compare` handoff, no `export` handoff and no control in any slot exist until a feature registers them.

## The one coupling: the registry

`src/features/investigation/registry.ts` exports the shared instance `registry` and `createRegistry()` (tests make their own). Its API:

| Call | Meaning |
| --- | --- |
| `registerControl(slot, component)` | Puts a React component in a toolbar slot. The last control registered in a slot wins. The component receives `{ store }`. |
| `registerHandoff("compare", fn)` | `fn(args: CompareArgs) => Promise<void>`. |
| `registerHandoff("export", fn)` | `fn() => void`. No export feature is built under the revision of 16 November 2026. |
| `unregisterHandoff(name)` | Removes a handoff (used by the development hook). |
| `registerLegendEntries(provider)` | `provider() => { concept, costume }[]`; the legend shows `concept — costume` and shows nothing from a provider that returns an empty list. |
| `getControl(slot)`, `getHandoff(name)`, `legendEntries()` | Reads. |

`tests/ui/feature-boundary.test.ts` (10.6) fails when any file under `src/features/liveSnapshot` or `src/features/compare` imports from `src/components/**` or `src/features/investigation/**`, a type-only import included. A feature therefore exports a function such as `register(registry)` that takes the registry and the store as parameters, and declares the structural types it needs (the shapes below) in its own folder. `src/components/App.tsx` (or `main.tsx`) calls that function at app start; the log row of the task that adds the call names it, as the ownership file requires. The toolbar re-renders when a control is registered after the first render.

## Slots

The toolbar renders the slots after the `Map` and `Evidence` tabs, in this DOM and Tab order. A slot with nothing registered renders nothing: there is no `Export is not available in this build.` text.

| Slot | Registered control must have the accessible name | Owner |
| --- | --- | --- |
| `export` | `Export investigation` | no spec (a stub in tests only) |
| `compare` | `Compare revisions` | `snapshot-comparison` |
| `live-snapshot` | `Open live snapshot` | `kiro-integration` |

Each control is wrapped in `<span class="toolbar-slot" data-slot="<slot>">`. A control that shows or hides a panel carries `aria-expanded`; one that opens a dialog uses `role="dialog"`, `aria-modal="true"`, traps Tab, closes on Escape and returns focus to the control. `Export investigation` moves focus into a dialog headed `Export investigation`.

## Handoffs

```ts
type CompareArgs = {
  before: Investigation;
  after: Investigation | { sample: "manor/after" };
  layoutKey: string | null; // state.layout?.layoutKey ?? null
};
registerHandoff("compare", (args: CompareArgs) => Promise<void>);
registerHandoff("export", () => void);
```

A `compare` handoff resolves when the comparison is shown and rejects when it fails. On failure it writes its own message with `setStatus`; the caller writes no second one.

`callCompareHandoff(store, registry, after)` in `src/features/investigation/handoffs.ts` builds the arguments from the current state, calls the handoff and returns `"done"`, `"failed"` (a rejection, or no open investigation) or `"no-compare"` (nothing registered; it writes `Comparison is not available in this build.`). It never changes `camera`, `selection` or `expandedWings`. The steps panel uses it for step 3. A feature in `src/features/**` cannot import it (10.6), so `kiro-integration` calls `registry.getHandoff("compare")` with the same arguments.

The `layoutKey` lets the comparison compute a union layout that keeps rooms common to both revisions at their coordinates.

## The status region

There is one `role="status"` element (`src/components/StatusRegion.tsx`). Features write to it only through `store.actions.setStatus(message)`. A new message replaces the previous one and stays until the next. A message may contain a segment in backticks; it is rendered verbatim with that segment in a `<code>` element, and everything else is text. The live-snapshot messages of `kiro-integration` rely on this:

```
No live snapshot yet. Run `pnpm hauntmap analyze samples/manor --out public/demo/live.json`, or let the Kiro hook write it.
```

No other element in `src/**` may carry `aria-live` or `role="status"`. A control that reports a failure writes its message and leaves the investigation, selection, camera, route filter and evidence trail as they were (10.5).

## Store actions for features

| Action | Use |
| --- | --- |
| `applyLayout(result: LayoutResult)` | Shows an externally computed layout (the comparison's union layout). Sets `layout`, `layoutStatus: "idle"`, increments `layoutRevision` so a request in flight is discarded, and keeps the camera. |
| `replaceInvestigation(inv, sourceText, { keepLayout: true })` | Swaps the investigation and source text but keeps `layout`, `layoutRevision`, `layoutStatus`, `camera`, `expandedWings`, `preset`, `activeView` and `selection`. Sets `routeFilter` to `null` when any of its module or relation IDs is absent from `inv`; recomputes an open loops panel with the same index and an open who-imports panel with the same origin (closing it when the origin is gone). Sends no layout request. |
| `setLayoutRequestBuilder(builder \| null)` | While a builder is set, `openInvestigation`, `setPreset`, `expandWing`, `collapseWing` and `retryLayout` send the request the builder returns. When it returns `null` the store sends its own request. |
| `setStatus(message)` | See above. |

## Testing with the development hook

The development server and the build made with `--mode devhook` (`pnpm build:devhook`) expose `window.__hauntmap` with `store`, `registry`, `h` (`React.createElement`) and `openInvestigation`. A Playwright spec registers a stub control without bundling React:

```ts
hook.registry.registerControl("export", () => hook.h("button", { type: "button" }, "Export investigation"));
```

The release build has no hook. `tests/e2e/hosted-controls.spec.ts` shows the stubs for 10.3 (backtick message), 10.4 (the `layoutKey` and unchanged camera, selection, route filter and wings), 10.5 (a failure leaves the state deep-equal) and 10.7 (a stub export control and a stub dialog).
