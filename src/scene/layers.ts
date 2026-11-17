// The six scene containers, back to front. The builder is generic so that the order is testable without PixiJS.

export const LAYER_ORDER = ["floor", "corridors", "rooms", "selected", "particles", "overlay"] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

export function createLayers<T extends { addChild(child: T): unknown }>(make: (name: LayerName) => T, root: T): Record<LayerName, T> {
  const layers = {} as Record<LayerName, T>;
  for (const name of LAYER_ORDER) {
    const layer = make(name);
    root.addChild(layer);
    layers[name] = layer;
  }
  return layers;
}