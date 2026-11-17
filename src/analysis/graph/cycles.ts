import type { CycleReport, CyclicComponent, ImportRecord, Investigation, Preset } from "../../contracts/types";
import { presetRelations } from "./presets";

interface Edge {
  to: string;
  relationId: string;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Strongly connected components of the preset's resolved local relations (Tarjan, no recursion,
 * modules in sorted order, each module's relations in sorted `relationId` order). A component
 * of one module is reported only when that module imports itself. Each component has its sorted
 * members and one witness. Time is linear in modules plus relations.
 */
export function findCycles(investigation: Investigation, preset: Preset): CycleReport {
  const ids = investigation.modules.map((m) => m.id).sort(compareText);
  const outgoing = new Map<string, Edge[]>();
  for (const id of ids) outgoing.set(id, []);
  const relations: ImportRecord[] = presetRelations(investigation, preset);
  for (const relation of relations) {
    if (relation.to === null) continue;
    outgoing.get(relation.from)?.push({ to: relation.to, relationId: relation.relationId });
  }

  const components = tarjan(ids, outgoing)
    .filter((members) => members.length > 1 || hasEdge(outgoing, members[0] as string, members[0] as string))
    .map((members) => ({ members, witness: witnessOf(members, outgoing) }))
    .sort((a, b) => compareText(a.members[0] as string, b.members[0] as string));
  return { preset, components };
}

function hasEdge(outgoing: Map<string, Edge[]>, from: string, to: string): boolean {
  return (outgoing.get(from) ?? []).some((edge) => edge.to === to);
}

function tarjan(ids: string[], outgoing: Map<string, Edge[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const root of ids) {
    if (index.has(root)) continue;
    const frames: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    lowlink.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as { node: string; next: number };
      const edges = outgoing.get(frame.node) ?? [];
      if (frame.next < edges.length) {
        const target = (edges[frame.next] as Edge).to;
        frame.next += 1;
        if (!index.has(target)) {
          index.set(target, counter);
          lowlink.set(target, counter);
          counter += 1;
          stack.push(target);
          onStack.add(target);
          frames.push({ node: target, next: 0 });
        } else if (onStack.has(target)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node) as number, index.get(target) as number));
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        lowlink.set(parent.node, Math.min(lowlink.get(parent.node) as number, lowlink.get(frame.node) as number));
      }
      if (lowlink.get(frame.node) === index.get(frame.node)) {
        const members: string[] = [];
        let member: string;
        do {
          member = stack.pop() as string;
          onStack.delete(member);
          members.push(member);
        } while (member !== frame.node);
        result.push(members.sort(compareText));
      }
    }
  }
  return result;
}

/**
 * One closed walk inside the component. It starts at the smallest member and goes depth first,
 * taking the smallest next member first (the smallest `relationId` when two relations reach the
 * same member), with one visited set that is never unmarked. It stops at the first relation that
 * returns to the start. The walk is the stack at that moment, so `modules` does not repeat the
 * start and `relationIds` has one entry for each module.
 */
function witnessOf(members: string[], outgoing: Map<string, Edge[]>): CyclicComponent["witness"] {
  const inside = new Set(members);
  const start = members[0] as string;
  const edgesOf = (node: string): Edge[] =>
    (outgoing.get(node) ?? [])
      .filter((edge) => inside.has(edge.to))
      .sort((a, b) => compareText(a.to, b.to) || compareText(a.relationId, b.relationId));

  const visited = new Set<string>([start]);
  const modules: string[] = [start];
  const entering: string[] = []; // entering[i] is the relation that reached modules[i + 1]
  const frames: { edges: Edge[]; next: number }[] = [{ edges: edgesOf(start), next: 0 }];

  while (frames.length > 0) {
    const frame = frames[frames.length - 1] as { edges: Edge[]; next: number };
    const edge = frame.edges[frame.next];
    if (edge === undefined) {
      frames.pop();
      modules.pop();
      entering.pop();
      continue;
    }
    frame.next += 1;
    if (edge.to === start) return { modules, relationIds: [...entering, edge.relationId] };
    if (visited.has(edge.to)) continue;
    visited.add(edge.to);
    modules.push(edge.to);
    entering.push(edge.relationId);
    frames.push({ edges: edgesOf(edge.to), next: 0 });
  }
  // A strongly connected component always has a way back to its start, so this is not reached.
  throw new Error(`No witness found for the component starting at ${start}`);
}
