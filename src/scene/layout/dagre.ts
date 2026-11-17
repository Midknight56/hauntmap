import { Graph, layout, version } from "@dagrejs/dagre";
import { computeLayout, type GraphRunner } from "./compute";
import type { LayoutEngine } from "./types";

// The layout engine over dagre (MIT, @dagrejs/dagre 3.1.3). Options confirmed on that version:
// `rankdir` "LR" or "TB", `nodesep`, `ranksep`, `marginx` and `marginy` are read from the graph
// label; each node keeps `x`, `y` (centers) and `rank` after `layout`; ranks are even numbers
// because the default `nodeRankFactor` is 2, so compute.ts reduces them to dense ranks.

export const dagreRunner: GraphRunner = (spec) => {
  const graph = new Graph();
  graph.setGraph({ rankdir: spec.direction, nodesep: spec.nodesep, ranksep: spec.ranksep, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of spec.nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of spec.edges) graph.setEdge(edge.from, edge.to, { weight: edge.weight, minlen: 1 });
  layout(graph);
  const nodes = new Map<string, { x: number; y: number; rank: number }>();
  for (const node of spec.nodes) {
    const label = graph.node(node.id) as { x: number; y: number; rank?: number };
    nodes.set(node.id, { x: label.x, y: label.y, rank: label.rank ?? 0 });
  }
  return { nodes };
};

export const dagreEngine: LayoutEngine = {
  name: "dagre",
  version,
  layout: (req, now = () => performance.now()) => computeLayout(req, dagreRunner, { name: "dagre", version }, now),
};
