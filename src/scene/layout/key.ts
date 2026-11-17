import type { LayoutRequest } from "./types";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** SHA-256 hex through Web Crypto, which a worker, a browser and Node 24 all have. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The canonical form of a request: sorted module IDs, sorted relation IDs, sorted boundary
 * relation IDs, expanded wings sorted by name with their sorted shown module IDs, the preset and
 * the engine. The order of the input lists never changes it.
 */
export function canonicalRequest(req: LayoutRequest, engine: { name: string; version: string }): string {
  return JSON.stringify({
    modules: req.modules.map((m) => m.id).sort(compareText),
    relations: req.relations.map((r) => r.relationId).sort(compareText),
    boundaries: req.boundaries.map((b) => b.relationId).sort(compareText),
    expandedWings: [...req.expandedWings]
      .sort((a, b) => compareText(a.wing, b.wing))
      .map((w) => ({ wing: w.wing, shownIds: [...w.shownIds].sort(compareText) })),
    preset: req.preset,
    engine: { name: engine.name, version: engine.version },
  });
}

export function layoutKey(req: LayoutRequest, engine: { name: string; version: string }): Promise<string> {
  return sha256Hex(canonicalRequest(req, engine));
}
