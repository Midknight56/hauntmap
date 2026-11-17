import type { Registry } from "../features/investigation/registry";

// The registry has no subscription of its own (its API shape is fixed by tests/ui/registry.test.ts).
// This wrapper counts registrations so that the toolbar can re-render when a feature, or the
// development hook, registers a control after the first render.

interface Watched {
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}

const watched = new WeakMap<Registry, Watched>();

export function watchRegistry(registry: Registry): Watched {
  const existing = watched.get(registry);
  if (existing !== undefined) return existing;
  let version = 0;
  const listeners = new Set<() => void>();
  const bump = (): void => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };
  const registerControl = registry.registerControl.bind(registry);
  const registerHandoff = registry.registerHandoff.bind(registry) as (name: "compare" | "export", fn: never) => void;
  const unregisterHandoff = registry.unregisterHandoff.bind(registry);
  registry.registerControl = (slot, component) => {
    registerControl(slot, component);
    bump();
  };
  registry.registerHandoff = ((name: "compare" | "export", fn: never) => {
    registerHandoff(name, fn);
    bump();
  }) as Registry["registerHandoff"];
  registry.unregisterHandoff = (name) => {
    unregisterHandoff(name);
    bump();
  };
  const result: Watched = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
  };
  watched.set(registry, result);
  return result;
}