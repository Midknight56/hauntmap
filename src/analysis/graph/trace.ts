import type { Investigation, Preset, TraceResult } from "../../contracts/types";
import { presetRelations } from "./presets";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Breadth first search from `origin` over the preset's resolved local relations: forward for
 * `imports`, backward for `imported-by`. Neighbours are visited in sorted order, so `predecessor`
 * (the module a module was first reached from) is the same on every run and gives a shortest path.
 * The origin is in `visited` with distance 0 and is never in `direct`, `indirect` or `predecessor`.
 * Throws an Error that names the origin when it is not a module. Time is linear in modules plus relations.
 */
export function trace(
  investigation: Investigation,
  origin: string,
  direction: "imports" | "imported-by",
  preset: Preset,
): TraceResult {
  if (!investigation.modules.some((m) => m.id === origin)) {
    throw new Error(`Cannot trace "${origin}": it is not a module of this investigation.`);
  }

  const neighbours = new Map<string, string[]>();
  for (const relation of presetRelations(investigation, preset)) {
    if (relation.to === null) continue;
    const [from, to] = direction === "imports" ? [relation.from, relation.to] : [relation.to, relation.from];
    const list = neighbours.get(from);
    if (list === undefined) neighbours.set(from, [to]);
    else list.push(to);
  }

  const distance: Record<string, number> = { [origin]: 0 };
  const predecessor: Record<string, string> = {};
  const queue: string[] = [origin];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as string;
    const next = [...new Set(neighbours.get(current) ?? [])].sort(compareText);
    for (const target of next) {
      if (Object.hasOwn(distance, target)) continue;
      distance[target] = (distance[current] as number) + 1;
      predecessor[target] = current;
      queue.push(target);
    }
  }

  const visited = [...queue].sort(compareText);
  const others = visited.filter((id) => id !== origin);
  return {
    origin,
    direction,
    preset,
    visited,
    direct: others.filter((id) => distance[id] === 1),
    indirect: others.filter((id) => (distance[id] as number) > 1),
    predecessor,
    distance,
  };
}
