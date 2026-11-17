import { describe, expect, it } from "vitest";
import { LAYER_ORDER, createLayers } from "../../src/scene/layers";

interface Node {
  name: string;
  children: Node[];
  addChild(child: Node): void;
}

function make(name: string): Node {
  const node: Node = { name, children: [], addChild: (child) => void node.children.push(child) };
  return node;
}

describe("scene layers (2.7)", () => {
  it("names the six containers in back-to-front order", () => {
    expect([...LAYER_ORDER]).toEqual(["floor", "corridors", "rooms", "selected", "particles", "overlay"]);
  });

  it("adds one container per name to the root in that order", () => {
    const root = make("root");
    const layers = createLayers(make, root);
    expect(root.children.map((c) => c.name)).toEqual([...LAYER_ORDER]);
    for (const name of LAYER_ORDER) expect(layers[name].name).toBe(name);
  });
});