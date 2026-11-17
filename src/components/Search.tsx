import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";
import { searchModules } from "../features/investigation/search";
import type { InvestigationStore } from "../features/investigation/store";
import { INSPECTOR_HEADING_ID } from "./Inspector";
import { selectModule } from "./selecting";
import { useViewState } from "./useStore";

/** The text shown above the options: `<n> matches`, or `20 of <n> matches` when more were found. */
export function matchCountText(shown: number, total: number): string {
  return total > shown ? `${shown} of ${total} matches` : `${total} matches`;
}

export function noMatchText(query: string): string {
  return `No module matches "${query}".`;
}

/**
 * The `Search modules` combobox (4.1 to 4.3). The query lives in the store; the list is computed on
 * every keystroke, so it is there well within 200 ms. Choosing a module selects it, expands its wing,
 * and moves focus to the inspector heading; the map centers on it through the shared selection effect.
 */
export function Search({ store }: { store: InvestigationStore }): ReactElement {
  const state = useViewState(store);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const query = state.searchQuery;
  const ids = useMemo(() => state.investigation?.modules.map((m) => m.id) ?? [], [state.investigation]);
  const { shown, total } = useMemo(() => searchModules(ids, query), [ids, query]);
  const listed = open && query !== "";
  const noMatch = listed && total === 0;
  const optionId = (index: number): string => `${listId}-option-${index}`;

  // The no-match message also goes to the status region, once for each query.
  useEffect(() => {
    if (listed && total === 0) store.actions.setStatus(noMatchText(query));
  }, [store, listed, total, query]);

  const choose = (id: string): void => {
    selectModule(store, id);
    setOpen(false);
    setActive(null);
    document.getElementById(INSPECTOR_HEADING_ID)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        if (query === "") return;
        event.preventDefault();
        setOpen(true);
        setActive(shown.length === 0 ? null : active === null ? 0 : Math.min(shown.length - 1, active + 1));
        break;
      case "ArrowUp":
        if (!listed) return;
        event.preventDefault();
        setActive(shown.length === 0 ? null : active === null ? shown.length - 1 : Math.max(0, active - 1));
        break;
      case "Enter": {
        const id = active === null ? undefined : shown[active];
        if (!listed || id === undefined) return;
        event.preventDefault();
        choose(id);
        break;
      }
      case "Escape":
        if (!listed) return;
        event.preventDefault();
        setOpen(false);
        setActive(null);
        break;
      default:
    }
  };

  return (
    <span className="search">
      <input
        type="text"
        role="combobox"
        aria-label="Search modules"
        placeholder="Search modules"
        aria-autocomplete="list"
        aria-expanded={listed && !noMatch}
        aria-controls={listed && !noMatch ? listId : undefined}
        aria-activedescendant={listed && active !== null && shown[active] !== undefined ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          store.actions.setSearch(event.target.value);
          setOpen(true);
          setActive(null);
        }}
        onKeyDown={onKeyDown}
      />
      {listed ? (
        <div className="search-popup">
          <p className="search-count">{noMatch ? noMatchText(query) : matchCountText(shown.length, total)}</p>
          {noMatch ? null : (
            <ul id={listId} role="listbox" aria-label="Matching modules">
              {shown.map((id, index) => (
                <li
                  key={id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={active === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(id)}
                >
                  {id}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </span>
  );
}